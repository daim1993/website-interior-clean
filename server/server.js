/* Elevé backend v2.1 — accounts, content, builder projects (versions + sharing),
   live portal sync (SSE), Stripe billing, analytics, backups, rate limiting, security headers, static hosting.
   Run:  npm install && npm start   → http://localhost:4000
   Uses built-in fs/crypto/zlib plus express, cors, pg, and stripe. */
const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const zlib = require("zlib");

const app = express();
const PORT = process.env.PORT || 4000;
const IS_PROD = process.env.NODE_ENV==="production" || !!process.env.RENDER;
const HOST = process.env.HOST || (IS_PROD ? "" : "127.0.0.1");
const SECRET = process.env.SECRET || "eleve-dev-secret-change-me";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "eleve-admin";
const STRIPE_KEY = process.env.STRIPE_SECRET || "";
const STRIPE_PRICE_PRO = process.env.STRIPE_PRICE_PRO || process.env.STRIPE_PRICE_ID || "";
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "";
const SLACK_WEBHOOK = process.env.SLACK_WEBHOOK || "";
const APP_URL = String(process.env.APP_URL || process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || "").replace(/\/+$/,"");
const SUPPORT_EMAIL = String(process.env.SUPPORT_EMAIL || "studio@example.com").trim().slice(0,200);
const SITE = path.resolve(__dirname, "..");
const DB = path.resolve(process.env.DB_FILE || path.join(__dirname, "db.json"));
const LOG = path.resolve(process.env.LOG_FILE || path.join(__dirname, "events.log"));
const BACKUPS = path.resolve(process.env.BACKUP_DIR || path.join(__dirname, "backups"));
const PORTALS = path.resolve(process.env.PORTAL_DIR || path.join(__dirname, "portals"));
function envInt(name,fallback,min,max){
  const n=parseInt(process.env[name]||"",10);
  if(!Number.isFinite(n)) return fallback;
  return Math.max(min,Math.min(max,n));
}
const BACKUP_KEEP = envInt("BACKUP_KEEP", 30, 1, 365);
const BACKUP_INTERVAL_MS = envInt("BACKUP_INTERVAL_MS", 1000*60*60*6, 1000*60*5, 1000*60*60*24);

function stripUnsafeKeys(value, depth){
  if(!value || typeof value!=="object" || depth>80) return value;
  if(Array.isArray(value)){
    for(const item of value) stripUnsafeKeys(item, depth+1);
    return value;
  }
  for(const k of Object.keys(value)){
    if(k==="__proto__" || k==="prototype" || k==="constructor") delete value[k];
    else stripUnsafeKeys(value[k], depth+1);
  }
  return value;
}
function readJsonFile(file){
  try{ return stripUnsafeKeys(JSON.parse(fs.readFileSync(file, "utf8")), 0); }
  catch(e){ return null; }
}
function blankDb(){ return { content: {}, users: [], projects: [], analytics: [], messages: [], subscribers: [], consults: [] }; }
function mergeDb(seed){
  const out=blankDb();
  if(seed && typeof seed==="object"){
    ["content","users","projects","analytics","messages","subscribers","consults","portal"].forEach(k=>{
      if(Object.prototype.hasOwnProperty.call(seed,k)) out[k]=seed[k];
    });
  }
  return out;
}

/* ---------- tiny JSON DB (debounced atomic write) ---------- */
let db = mergeDb(readJsonFile(DB));
let saveT = null;
function writeDbNow() { try { fs.writeFileSync(DB + ".tmp", JSON.stringify(db)); fs.renameSync(DB + ".tmp", DB); } catch (e) { console.error("persist", e.message); } }
function persist() { clearTimeout(saveT); saveT = setTimeout(() => { writeDbNow(); pgMark("db"); }, 200); }
function logline(o){ try{ fs.appendFileSync(LOG, JSON.stringify(Object.assign({t:Date.now()},o))+"\n"); }catch(e){} }
function readPortalSnapshots(){
  const portals={};
  try{
    if(fs.existsSync(PORTALS)) for(const name of fs.readdirSync(PORTALS)){
      if(!/^[A-Za-z0-9_-]+\.json$/.test(name)) continue;
      const id=name.slice(0,-5);
      const doc=readJsonFile(path.join(PORTALS,name));
      if(doc) portals[id]=doc;
    }
  }catch(e){}
  try{
    if(typeof pCache!=="undefined") for(const [id,doc] of pCache){
      if(doc) portals[id]=stripUnsafeKeys(JSON.parse(JSON.stringify(doc)),0);
    }
  }catch(e){}
  return portals;
}
function pruneBackups(){
  const keep=fs.readdirSync(BACKUPS).filter(function(x){return /^(snapshot|db)-.*\.(?:json|json\.gz)$/.test(x);}).sort();
  while(keep.length>BACKUP_KEEP){ try{ fs.unlinkSync(path.join(BACKUPS,keep.shift())); }catch(e){} }
}
function backup(){
  try{
    if(!fs.existsSync(BACKUPS)) fs.mkdirSync(BACKUPS,{recursive:true});
    try{ clearTimeout(saveT); writeDbNow(); }catch(e){}
    const stamp=new Date().toISOString().replace(/[:.]/g,"-");
    const snapshot={ schema:1, t:Date.now(), generatedAt:new Date().toISOString(), db:db, portals:readPortalSnapshots() };
    const raw=Buffer.from(JSON.stringify(snapshot));
    const gz=zlib.gzipSync(raw);
    const name="snapshot-"+stamp+".json.gz";
    fs.writeFileSync(path.join(BACKUPS,name), gz);
    if(fs.existsSync(DB)) fs.copyFileSync(DB, path.join(BACKUPS,"db-"+stamp+".json"));
    pruneBackups();
    return { ok:true, name:name, bytes:gz.length, portals:Object.keys(snapshot.portals).length };
  }catch(e){ console.error("backup", e.message); return { ok:false, error:e.message }; }
}

/* ---------- optional Postgres persistence (hosts with ephemeral disks) ----------
   Set DATABASE_URL (e.g. a free Neon database) and db + client portals survive
   redeploys/restarts on Render's free tier. Local JSON files stay as the dev mode
   and a warm cache; Postgres is the source of truth when enabled. */
const PG_URL = process.env.DATABASE_URL || "";
let pgPool = null, pgSaveT = null; const pgDirty = new Set();
async function pgInit(){
  if(!PG_URL) return;
  const { Pool } = require("pg");
  pgPool = new Pool({ connectionString: PG_URL, max: 3,
    ssl: /localhost|127\.0\.0\.1/.test(PG_URL) ? undefined : { rejectUnauthorized: false } });
  try{ await pgPool.query("CREATE TABLE IF NOT EXISTS eleve_kv (k TEXT PRIMARY KEY, v TEXT NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now())"); }
  catch(e){ console.error("pg create table (continuing — table may already exist):", e.message); }
  const r = await pgPool.query("SELECT k, v FROM eleve_kv");
  let hadDb = false;
  for(const row of r.rows){
    if(row.k === "db"){ try{ db = mergeDb(stripUnsafeKeys(JSON.parse(row.v),0)); hadDb = true; }catch(e){ console.error("pg db parse", e.message); } }
    else if(row.k.indexOf("portal:") === 0){ try{ pCache.set(portalId(row.k.slice(7)), stripUnsafeKeys(JSON.parse(row.v),0)); }catch(e){} }
  }
  if(!hadDb && fs.existsSync(DB)) pgMark("db"); // first boot after enabling PG: seed from the local file
  console.log("Postgres persistence: on ("+r.rows.length+" rows loaded)");
}
function pgMark(k){ if(!pgPool) return; pgDirty.add(k); clearTimeout(pgSaveT); pgSaveT = setTimeout(pgFlush, 1500); }
async function pgFlush(){
  if(!pgPool || !pgDirty.size) return;
  const keys = [...pgDirty]; pgDirty.clear();
  for(const k of keys){
    try{
      const v = (k === "db") ? JSON.stringify(db) : JSON.stringify(pCache.get(k.slice(7)) || null);
      await pgPool.query("INSERT INTO eleve_kv (k, v, updated_at) VALUES ($1, $2, now()) ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v, updated_at = now()", [k, v]);
    }catch(e){ console.error("pg persist", e.message); pgDirty.add(k); clearTimeout(pgSaveT); pgSaveT = setTimeout(pgFlush, 5000); }
  }
}

/* ---------- helpers ---------- */
const uid = () => crypto.randomBytes(9).toString("base64url");
function hash(pw, salt){ return crypto.scryptSync(String(pw), salt, 64).toString("hex"); }
function safeEq(a,b){ const A=Buffer.from(String(a)), B=Buffer.from(String(b));
  if(A.length!==B.length){ try{ crypto.timingSafeEqual(A,A); }catch(e){} return false; }
  try{ return crypto.timingSafeEqual(A,B); }catch(e){ return false; } }
function sign(p){ const b=Buffer.from(JSON.stringify(p)).toString("base64url"); return b+"."+crypto.createHmac("sha256",SECRET).update(b).digest("base64url"); }
function verify(t){ if(!t) return null; const p=String(t).split("."); if(p.length!==2) return null;
  if(!safeEq(crypto.createHmac("sha256",SECRET).update(p[0]).digest("base64url"), p[1])) return null;
  try{ const o=JSON.parse(Buffer.from(p[0],"base64url").toString()); if(o.exp&&Date.now()>o.exp) return null; return o; }catch(e){ return null; } }
function tokenFor(u){ return sign({ uid:u.id, tv:u.tv||0, role:u.role, plan:u.plan, exp:Date.now()+1000*60*60*24*30 }); }
function authUser(req){ const t=verify((req.headers.authorization||"").replace(/^Bearer\s+/i,"")); if(!t) return null;
  if(t.uid){ const u=db.users.find(x=>x.id===t.uid);
    if(!u) return null;                        // deleted accounts lose access immediately
    if((t.tv||0)!==(u.tv||0)) return null;     // password changed → every older session is signed out
    return u; }
  return (t.role==="admin")?{id:"admin",role:"admin",plan:"pro",email:"studio@master"}:null; // uid-less = the CMS master-password login (synthetic identity so its actions are attributed)
}
const safeUser = u => u && ({ id:u.id, email:u.email, role:u.role, plan:u.plan, createdAt:u.createdAt, can:permsOf(u) });

/* ---------- hardening: production guard, timing-safe compares, brute-force shield ---------- */
if(process.env.TRUST_PROXY || process.env.RENDER) app.set("trust proxy", 1);
if(IS_PROD && (SECRET==="eleve-dev-secret-change-me" || ADMIN_PASSWORD==="eleve-admin")){
  console.error("FATAL: default SECRET / ADMIN_PASSWORD detected in production. Set both environment variables, then restart.");
  process.exit(1);
}
/* sign-in brute force: a generous 12 tries, then a short 60-second cool-off that
   grows only if attacks keep coming (auto-expires, logged). Kind to typos, hard on bots. */
const authFails=new Map();
const BRUTE_FREE=12, BRUTE_BASE=60*1000, BRUTE_MAX=10*60*1000;
function bruteKey(req,who){ return (req.ip||"?")+"|"+String(who||"").toLowerCase().slice(0,80); }
function bruteLocked(key){ const e=authFails.get(key); if(!e) return 0;
  if(e.until && Date.now()>e.until){ authFails.delete(key); return 0; } // a real lock-window expired → fresh start
  return e.n>BRUTE_FREE ? Math.ceil((e.until-Date.now())/1000) : 0; }
function bruteFail(req,who){ const key=bruteKey(req,who); const e=authFails.get(key)||{n:0,until:0};
  e.n++;
  if(e.n>BRUTE_FREE){ const over=e.n-BRUTE_FREE; e.until=Date.now()+Math.min(BRUTE_MAX, BRUTE_BASE*over); } // 60s, 120s, 180s… capped 10m
  authFails.set(key,e);
  logline({ev:"login-fail",ip:req.ip,who:String(who||"").slice(0,80)});
  if(authFails.size>5000) for(const [k,v] of authFails){ if(Date.now()>v.until) authFails.delete(k); } }
function bruteOk(req,who){ authFails.delete(bruteKey(req,who)); }

/* ---------- middleware ---------- */
// Allow the studio tools to talk to the API even when a page is opened via
// file:// or a different dev-server port (Chrome Private Network Access).
app.use((req,res,next)=>{ if(!IS_PROD && req.method==="OPTIONS") res.setHeader("Access-Control-Allow-Private-Network","true"); next(); });
/* CORS: open in local dev; locked to an allow-list when ORIGINS is set (comma-separated, e.g. your Pages URL) */
const ORIGINS=(process.env.ORIGINS||"").split(",").map(s=>s.trim()).filter(Boolean);
if(ORIGINS.length) app.use(cors({ origin:(origin,cb)=>cb(null, !origin||ORIGINS.includes(origin)) }));
else if(!IS_PROD) app.use(cors());
/* Content-Security-Policy: everything self-hosted except Google Fonts + the two CDNs the builder/home use.
   Inline scripts are part of this site's design, so 'unsafe-inline' stays; object/base/frame are locked down. */
const CSP="default-src 'self'; script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net; "+
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; "+
  "img-src 'self' data: blob:; media-src 'self' data: blob:; connect-src 'self' data: blob: https://cdnjs.cloudflare.com https://cdn.jsdelivr.net; "+
  "worker-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'self'; form-action 'self'";
app.use((req,res,next)=>{ // security headers
  res.setHeader("X-Content-Type-Options","nosniff");
  res.setHeader("X-Frame-Options","SAMEORIGIN");
  res.setHeader("Referrer-Policy","strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy","geolocation=(), microphone=(), camera=()");
  res.setHeader("Content-Security-Policy",CSP);
  res.setHeader("Cross-Origin-Opener-Policy","same-origin");
  if(String(req.headers["x-forwarded-proto"]||"").includes("https"))
    res.setHeader("Strict-Transport-Security","max-age=31536000; includeSubDomains");
  next();
});
// simple in-memory rate limiter for /api (per IP)
const hits = new Map();
app.use("/api", (req,res,next)=>{
  const ip=req.ip||req.headers["x-forwarded-for"]||"local", now=Date.now();
  let b=hits.get(ip); if(!b||now>b.reset){ b={n:0,reset:now+60000}; hits.set(ip,b); }
  if(hits.size>5000) for(const [k,v] of hits){ if(now>v.reset) hits.delete(k); }
  if(++b.n>240){ res.setHeader("Retry-After","60"); return res.status(429).json({error:"Too many requests"}); }
  next();
});
const jsonSmall=express.json({ limit:"1mb", inflate:false });
const jsonLarge=express.json({ limit:"26mb", inflate:false });
function largeJsonAllowed(req){
  if(req.method==="POST" && req.path==="/api/content") return true;
  if((req.method==="POST"||req.method==="PUT") && /^\/api\/projects(?:\/|$)/.test(req.path)) return true;
  if(req.method==="PUT" && /^\/api\/admin\/portal\/[^/]+$/.test(req.path)) return true;
  return false;
}
function stripeClient(){ if(!STRIPE_KEY) return null; const Stripe=require("stripe"); return Stripe(STRIPE_KEY); }
function applyStripeEvent(event){
  const obj=event && event.data && event.data.object;
  if(!obj) return false;
  const uid=(obj.client_reference_id || (obj.metadata&&obj.metadata.uid) || (obj.subscription_details&&obj.subscription_details.metadata&&obj.subscription_details.metadata.uid) || "");
  const u=uid && db.users.find(x=>x.id===uid);
  if(!u) return false;
  if(event.type==="checkout.session.completed" || event.type==="customer.subscription.updated"){
    u.plan="pro";
    if(obj.customer) u.stripeCustomerId=obj.customer;
    if(obj.subscription) u.stripeSubscriptionId=obj.subscription;
    persist(); logline({ev:"billing-pro",uid:u.id,email:u.email}); insDirty();
    return true;
  }
  if(event.type==="customer.subscription.deleted"){
    u.plan="free"; persist(); logline({ev:"billing-free",uid:u.id,email:u.email}); insDirty();
    return true;
  }
  return false;
}
app.post("/api/billing/webhook", express.raw({ type:"application/json", limit:"1mb", inflate:false }), (req,res)=>{
  if(!STRIPE_KEY || !STRIPE_WEBHOOK_SECRET) return res.status(501).json({error:"Stripe webhook is not configured"});
  try{
    const stripe=stripeClient();
    const event=stripe.webhooks.constructEvent(req.body, req.headers["stripe-signature"], STRIPE_WEBHOOK_SECRET);
    applyStripeEvent(event);
    res.json({received:true});
  }catch(e){ logline({ev:"stripe-webhook-error",msg:e.message}); res.status(400).send("Webhook error"); }
});
app.use((req,res,next)=>(largeJsonAllowed(req)?jsonLarge:jsonSmall)(req,res,next));
app.use((req,res,next)=>{ if(req.body && typeof req.body==="object") stripUnsafeKeys(req.body,0); next(); });
app.use((err,req,res,next)=>{
  if(err && (err.type==="entity.too.large" || err.status===413)) return res.status(413).json({error:"Request body too large"});
  if(err && err.type==="encoding.unsupported") return res.status(415).json({error:"Compressed request bodies are not accepted"});
  if(err instanceof SyntaxError && "body" in err) return res.status(400).json({error:"Invalid JSON"});
  next(err);
});
function validStr(v,max){ return typeof v==="string" && v.length<=max; }
function cleanEmail(v){ const s=String(v||"").trim().toLowerCase(); return (s.length<=200 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) ? s : ""; }
function publicReview(p,u){
  const r=p&&p.review;
  if(!r || !validStr(r.text,1200) || !r.text.trim()) return null;
  return {
    id:u.id,
    name:validStr(r.name,80)&&r.name.trim()?r.name.trim():String(u.email||"Client").split("@")[0],
    role:validStr(r.role,120)&&r.role.trim()?r.role.trim():"Eleve client",
    rating:Math.max(1,Math.min(5,parseInt(r.rating,10)||5)),
    text:r.text.trim().slice(0,1200),
    t:r.t||0
  };
}

/* ---------- content (marketing / CMS) ---------- */
app.get("/healthz",(req,res)=> res.json({ ok:true, up:Math.round(process.uptime()), users:(db.users||[]).length, projects:(db.projects||[]).length }));
app.get("/api/content", (req,res)=> res.json({ content: db.content||{} }));
app.get("/api/reviews",(req,res)=>{
  const reviews=db.users.filter(u=>u.role==="user").map(u=>publicReview(loadPortal(u.id),u)).filter(Boolean)
    .sort((a,b)=>(b.t||0)-(a.t||0)).slice(0,24);
  res.json({ reviews });
});
app.post("/api/login", (req,res)=>{ // studio master password (used by the CMS)
  const locked=bruteLocked(bruteKey(req,"admin"));
  if(locked) return res.status(429).json({ error:"Too many attempts — locked for "+locked+"s." });
  if(req.body && safeEq(req.body.password||"", ADMIN_PASSWORD)){
    bruteOk(req,"admin");
    return res.json({ token: sign({ role:"admin", exp:Date.now()+1000*60*60*24*30 }) });
  }
  bruteFail(req,"admin");
  res.status(401).json({ error:"Wrong password" });
});
app.post("/api/content", (req,res)=>{
  const u=can(req,res,"site","publish"); if(!u) return;
  if(!req.body || typeof req.body.content!=="object") return res.status(400).json({error:"Bad content"});
  db.content=req.body.content; persist(); logline({ev:"content-publish",by:u.email}); insDirty(); res.json({ ok:true, savedAt:Date.now() });
});

/* ---------- accounts ---------- */
app.post("/api/auth/register",(req,res)=>{
  // Public self-registration is CLOSED — the studio creates every account in the CMS (Accounts tab).
  // Single exception: a fresh, empty server accepts its very first account, which becomes the admin (bootstrap).
  if(db.users.length>0) return res.status(403).json({error:"Accounts are created by the studio — sign in with the details you were given."});
  const { password } = req.body||{}, email = cleanEmail(req.body&&req.body.email);
  if(!email||!validStr(password,200)||password.length<6) return res.status(400).json({error:"Valid email and 6+ char password required"});
  const salt=crypto.randomBytes(16).toString("hex");
  const u={ id:uid(), email, salt, pass:hash(password,salt), role:"admin", plan:"free", createdAt:Date.now() };
  db.users.push(u); persist(); logline({ev:"register-bootstrap",uid:u.id});
  res.json({ token:tokenFor(u), user:safeUser(u) });
});
app.post("/api/auth/login",(req,res)=>{
  const { password } = req.body||{}, email = cleanEmail(req.body&&req.body.email);
  const locked=bruteLocked(bruteKey(req,email));
  if(locked) return res.status(429).json({ error:"Too many attempts — locked for "+locked+"s." });
  const u=email && db.users.find(x=>x.email===email);
  if(!u || !safeEq(u.pass, hash(String(password||""),u.salt))){
    bruteFail(req,email);
    return res.status(401).json({error:"Invalid credentials"});
  }
  bruteOk(req,email);
  res.json({ token:tokenFor(u), user:safeUser(u) });
});
app.get("/api/me",(req,res)=>{ const u=authUser(req); if(!u) return res.status(401).json({error:"Unauthorized"}); res.json({ user:safeUser(u) }); });

/* ---------- builder projects (per user, versioned, shareable) ---------- */
function ownProject(u,id){ return db.projects.find(p=>p.id===id && p.ownerId===u.id); }
app.get("/api/projects",(req,res)=>{ const u=authUser(req); if(!u) return res.status(401).json({error:"Unauthorized"});
  res.json({ projects: db.projects.filter(p=>p.ownerId===u.id).map(p=>({id:p.id,name:p.name,updatedAt:p.updatedAt,shareId:p.shareId||null,versions:(p.versions||[]).length})) }); });
app.post("/api/projects",(req,res)=>{ const u=authUser(req); if(!u) return res.status(401).json({error:"Unauthorized"});
  const name=validStr(req.body&&req.body.name,120)?req.body.name:"Untitled";
  if(u.plan==="free" && db.projects.filter(p=>p.ownerId===u.id).length>=5) return res.status(402).json({error:"Free plan limit reached (5 projects). Upgrade to Pro.",upgrade:true});
  const p={ id:uid(), ownerId:u.id, name, data:req.body&&req.body.data||{}, updatedAt:Date.now(), versions:[] };
  db.projects.push(p); persist(); res.json({ id:p.id }); });
app.get("/api/projects/:id",(req,res)=>{ const u=authUser(req); if(!u) return res.status(401).json({error:"Unauthorized"});
  const p=ownProject(u,req.params.id); if(!p) return res.status(404).json({error:"Not found"}); res.json({ project:p }); });
app.put("/api/projects/:id",(req,res)=>{ const u=authUser(req); if(!u) return res.status(401).json({error:"Unauthorized"});
  const p=ownProject(u,req.params.id); if(!p) return res.status(404).json({error:"Not found"});
  if(req.body && typeof req.body.data==="object"){ p.versions=p.versions||[];
    /* silent auto-saves only cut a new version every 10 min — manual saves always do */
    const lastV=p.versions[p.versions.length-1];
    if(!req.body.autosave || !lastV || (Date.now()-(lastV.t||0))>600000){
      p.versions.push({t:p.updatedAt,data:p.data}); if(p.versions.length>30) p.versions.shift(); }
    p.data=req.body.data; }
  if(validStr(req.body&&req.body.name,120)) p.name=req.body.name;
  p.updatedAt=Date.now(); persist(); res.json({ ok:true, versions:(p.versions||[]).length }); });
app.delete("/api/projects/:id",(req,res)=>{ const u=authUser(req); if(!u) return res.status(401).json({error:"Unauthorized"});
  const i=db.projects.findIndex(p=>p.id===req.params.id && p.ownerId===u.id); if(i<0) return res.status(404).json({error:"Not found"});
  db.projects.splice(i,1); persist(); res.json({ ok:true }); });
app.get("/api/projects/:id/versions",(req,res)=>{ const u=authUser(req); if(!u) return res.status(401).json({error:"Unauthorized"});
  const p=ownProject(u,req.params.id); if(!p) return res.status(404).json({error:"Not found"});
  res.json({ versions:(p.versions||[]).map((v,i)=>({index:i,t:v.t})) }); });
app.get("/api/projects/:id/versions/:vi",(req,res)=>{ const u=authUser(req); if(!u) return res.status(401).json({error:"Unauthorized"});
  const p=ownProject(u,req.params.id); if(!p) return res.status(404).json({error:"Not found"});
  const v=(p.versions||[])[+req.params.vi]; if(!v) return res.status(404).json({error:"No version"}); res.json({ data:v.data,t:v.t }); });
app.post("/api/projects/:id/share",(req,res)=>{ const u=authUser(req); if(!u) return res.status(401).json({error:"Unauthorized"});
  const p=ownProject(u,req.params.id); if(!p) return res.status(404).json({error:"Not found"});
  p.shareId=p.shareId||uid(); persist(); res.json({ shareId:p.shareId }); });
app.get("/api/shared/:shareId",(req,res)=>{ const p=db.projects.find(x=>x.shareId===req.params.shareId); if(!p) return res.status(404).json({error:"Not found"});
  res.json({ name:p.name, data:p.data, updatedAt:p.updatedAt }); });

/* ---------- plans / billing (Stripe) ---------- */
app.get("/api/plans",(req,res)=> res.json({ plans:[
  { id:"free", name:"Studio Free", price:0, features:["5 cloud projects","DXF / OBJ / PDF export","Version history (30)"] },
  { id:"pro", name:"Studio Pro", price:24, features:["Unlimited projects","Share links","Priority render","Team seats (soon)"], checkoutReady:!!(STRIPE_KEY&&STRIPE_PRICE_PRO) }
], support:{ email:SUPPORT_EMAIL } }));
function publicBase(req){
  const fromReq=(req.protocol||"http")+"://"+req.get("host");
  return (APP_URL || fromReq).replace(/\/+$/,"");
}
app.post("/api/billing/checkout", async (req,res)=>{ const u=authUser(req); if(!u) return res.status(401).json({error:"Unauthorized"});
  const plan=(req.body&&req.body.plan)||"pro";
  if(plan!=="pro") return res.status(400).json({error:"Only the Pro plan requires checkout."});
  const missing=[];
  if(!STRIPE_KEY) missing.push("STRIPE_SECRET");
  if(!STRIPE_PRICE_PRO) missing.push("STRIPE_PRICE_PRO");
  if(missing.length) return res.status(501).json({ error:"Billing is not configured. Set "+missing.join(", ")+" and restart the server.", missing, plan });
  try{
    const stripe=stripeClient(), base=publicBase(req);
    const session=await stripe.checkout.sessions.create({
      mode:"subscription",
      customer_email:u.email&&u.email.indexOf("@")>0?u.email:undefined,
      client_reference_id:u.id,
      line_items:[{ price:STRIPE_PRICE_PRO, quantity:1 }],
      success_url:(process.env.STRIPE_SUCCESS_URL || (base+"/pricing.html?checkout=success&session_id={CHECKOUT_SESSION_ID}")),
      cancel_url:(process.env.STRIPE_CANCEL_URL || (base+"/pricing.html?checkout=cancelled")),
      metadata:{ uid:u.id, email:u.email||"", plan:"pro" },
      subscription_data:{ metadata:{ uid:u.id, email:u.email||"", plan:"pro" } }
    });
    logline({ev:"billing-checkout",uid:u.id,email:u.email,session:session.id});
    res.json({ ok:true, id:session.id, url:session.url });
  }catch(e){
    logline({ev:"billing-error",uid:u.id,email:u.email,msg:e.message});
    res.status(502).json({error:"Stripe checkout failed: "+e.message});
  }
});
app.get("/api/support",(req,res)=> res.json({ email:SUPPORT_EMAIL, billingConfigured:!!(STRIPE_KEY&&STRIPE_PRICE_PRO), backups:{ keep:BACKUP_KEEP, intervalMs:BACKUP_INTERVAL_MS } }));

/* ---------- contact form ---------- */
app.post("/api/contact",(req,res)=>{
  var b=req.body||{};
  var name=(b.name||"").toString().trim().slice(0,120), email=cleanEmail(b.email), message=(b.message||"").toString().trim().slice(0,4000);
  if(!name || !email || message.length<2) return res.status(400).json({error:"Please enter your name, a valid email and a message."});
  var m={ id:uid(), name:name, email:email, message:message, t:Date.now(), read:false };
  db.messages=db.messages||[]; db.messages.unshift(m); if(db.messages.length>1000) db.messages.pop(); persist();
  logline({ev:"contact",email:email}); insDirty();
  if(SLACK_WEBHOOK){ try{ fetch(SLACK_WEBHOOK,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({text:"New Elevé enquiry from "+name+" <"+email+">:\n"+message})}).catch(function(){}); }catch(e){} }
  res.json({ ok:true });
});
app.get("/api/messages",(req,res)=>{ const u=can(req,res,"site","view"); if(!u) return;
  res.json({ messages: db.messages||[] }); });
app.post("/api/subscribe",(req,res)=>{ var email=cleanEmail(req.body&&req.body.email);
  if(!email) return res.status(400).json({error:"Please enter a valid email."});
  db.subscribers=db.subscribers||[]; if(!db.subscribers.find(x=>x.email===email)){ db.subscribers.push({email:email,t:Date.now()}); persist(); logline({ev:"subscribe",email:email}); }
  res.json({ ok:true }); });
app.post("/api/consult",(req,res)=>{ var b=req.body||{};
  var name=(b.name||"").toString().trim().slice(0,120), email=cleanEmail(b.email), date=(b.date||"").toString().trim().slice(0,40), time=(b.time||"").toString().trim().slice(0,20), note=(b.note||"").toString().trim().slice(0,2000);
  if(!name||!email||!date) return res.status(400).json({error:"Name, valid email and a preferred date are required."});
  var c={ id:uid(), name:name, email:email, date:date, time:time, note:note, t:Date.now() };
  db.consults=db.consults||[]; db.consults.unshift(c); if(db.consults.length>1000) db.consults.pop(); persist(); logline({ev:"consult",email:email,date:date}); insDirty();
  if(SLACK_WEBHOOK){ try{ fetch(SLACK_WEBHOOK,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({text:"New consultation booking: "+name+" <"+email+"> on "+date+" "+time+(note?("\n"+note):"")})}).catch(function(){}); }catch(e){} }
  res.json({ ok:true }); });
app.get("/api/admin/inbox",(req,res)=>{ const u=can(req,res,"site","view"); if(!u) return;
  res.json({ messages:db.messages||[], consults:db.consults||[], subscribers:db.subscribers||[] }); });
app.post("/api/admin/inbox/read",(req,res)=>{ const u=can(req,res,"site","view"); if(!u) return;
  const { id, read }=req.body||{};
  const m=(db.messages||[]).find(x=>x.id===id); if(!m) return res.status(404).json({error:"Message not found"});
  m.read=!!read; persist(); res.json({ ok:true }); });
app.post("/api/admin/inbox/delete",(req,res)=>{ const u=can(req,res,"site","view"); if(!u) return;
  const { kind, id }=req.body||{};
  if(kind==="message"){ const n=(db.messages||[]).length; db.messages=(db.messages||[]).filter(x=>x.id!==id);
    if(db.messages.length===n) return res.status(404).json({error:"Message not found"}); }
  else if(kind==="consult"){ const n=(db.consults||[]).length; db.consults=(db.consults||[]).filter(x=>x.id!==id);
    if(db.consults.length===n) return res.status(404).json({error:"Booking not found"}); }
  else if(kind==="subscriber"){ const n=(db.subscribers||[]).length; db.subscribers=(db.subscribers||[]).filter(x=>x.email!==id);
    if(db.subscribers.length===n) return res.status(404).json({error:"Subscriber not found"}); }
  else return res.status(400).json({error:"Unknown kind"});
  persist(); logline({ev:"inbox-delete",by:u.email||"admin",kind}); res.json({ ok:true }); });

/* ---------- CLIENT PORTAL (production) ----------
   Each client owns an ISOLATED database file: server/portals/<uid>.json
   (atomic debounced writes, in-memory cache, migration from legacy db.portal).
   Clients get an empty workspace until the studio publishes content through
   the CMS master-control desk; every event lands in the portal's activity log. */
try{ if(!fs.existsSync(PORTALS)) fs.mkdirSync(PORTALS,{recursive:true}); }catch(e){}
const pCache=new Map(), pTimers=new Map();
function portalId(uidStr){
  const id=String(uidStr||"");
  if(!/^[A-Za-z0-9_-]{1,80}$/.test(id)) throw new Error("Invalid portal id");
  return id;
}
function pFile(uidStr){
  const fp=path.resolve(PORTALS, portalId(uidStr)+".json");
  if(fp!==PORTALS && !fp.startsWith(PORTALS+path.sep)) throw new Error("Invalid portal path");
  return fp;
}
/* ----- live sync (Server-Sent Events): every save pushes to open portals/CMS ----- */
const pSubs=new Map(); // uid -> Set<res>
function pNotify(uidStr,doc){
  const set=pSubs.get(uidStr); if(!set||!set.size) return;
  const payload="data:"+JSON.stringify({updatedAt:doc.updatedAt})+"\n\n";
  for(const r of set){ try{ r.write(payload); }catch(e){} }
}
function sseOpen(req,res,uidStr){
  res.writeHead(200,{ "Content-Type":"text/event-stream", "Cache-Control":"no-cache, no-transform", "Connection":"keep-alive", "X-Accel-Buffering":"no" });
  res.write("retry: 3000\n\n");
  let set=pSubs.get(uidStr); if(!set){ set=new Set(); pSubs.set(uidStr,set); } set.add(res);
  const hb=setInterval(()=>{ try{ res.write(":hb\n\n"); }catch(e){} },25000);
  req.on("close",()=>{ clearInterval(hb); set.delete(res); if(!set.size) pSubs.delete(uidStr); });
}
function savePortal(uidStr,doc,immediate){
  let id; try{ id=portalId(uidStr); }catch(e){ console.error("portal persist",e.message); return; }
  doc.updatedAt=Date.now(); stripUnsafeKeys(doc,0); pCache.set(id,doc); pNotify(id,doc); insDirty();
  clearTimeout(pTimers.get(id));
  const write=()=>{ try{ fs.writeFileSync(pFile(id)+".tmp",JSON.stringify(doc)); fs.renameSync(pFile(id)+".tmp",pFile(id)); }catch(e){ console.error("portal persist",e.message); } pgMark("portal:"+id); };
  if(immediate) write(); else pTimers.set(id,setTimeout(write,200));
}
function loadPortal(uidStr){
  let id; try{ id=portalId(uidStr); }catch(e){ return null; }
  if(pCache.has(id)) return pCache.get(id);
  let doc=null;
  try{ doc=stripUnsafeKeys(JSON.parse(fs.readFileSync(pFile(id),"utf8")),0); }catch(e){}
  if(!doc && db.portal && db.portal[id]){ doc=stripUnsafeKeys(db.portal[id],0); doc.activity=doc.activity||[]; delete db.portal[id]; persist(); savePortal(id,doc,true); }
  pCache.set(id,doc||null); return doc||null;
}
function pact(doc,by,text,who){ doc.activity=doc.activity||[]; doc.activity.unshift({t:Date.now(),by:String(by).slice(0,80),text:String(text).slice(0,300),who:who?String(who).slice(0,120):undefined}); if(doc.activity.length>300) doc.activity.pop(); }
function emptyPortal(){ return { project:null, actions:[], moodboards:{rooms:[]}, reactions:{}, comments:{}, review:null,
  renders:{rooms:[]}, approvals:[], materials:[], budget:{currency:"€",categories:[],milestones:[]},
  threads:[{id:uid(),title:"General",messages:[]}], schedule:[], activity:[], updatedAt:Date.now() }; }
function portalOf(u){ let d=loadPortal(u.id); if(!d){ d=emptyPortal(); pact(d,"system","Workspace created for "+(u.email||u.id)); savePortal(u.id,d,true); } return d; }
function demoPortal(){
  const g=(a,c1,c2)=>"linear-gradient("+a+"deg,"+c1+","+c2+")";
  const now=Date.now(), day=86400000;
  return {
    project:{ name:"Aurora Penthouse", location:"Lisbon · Residential", code:"ELV-2461",
      phases:["Concept","Design Development","Procurement","Execution","Styling"], phase:1,
      startedAt:now-60*day, targetAt:now+140*day },
    actions:[
      { id:"a1", label:"Approve the Living Room moodboard", tab:"moodboards", done:false },
      { id:"a2", label:"Review Kitchen render v2", tab:"renders", done:false },
      { id:"a3", label:"Confirm marble slab selection", tab:"approvals", done:false },
      { id:"a4", label:"Sign off Design Development milestone", tab:"budget", done:false }
    ],
    moodboards:{ rooms:[
      { id:"living", name:"Living Room", items:[
        { id:"mb1", name:"Travertine wall", cat:"Stone", sw:g(135,"#d9dce1","#b9bec6") },
        { id:"mb2", name:"Smoked oak floor", cat:"Wood", sw:g(150,"#c9cdd4","#a9aeb6") },
        { id:"mb3", name:"Bouclé sofa", cat:"Furniture", sw:g(120,"#e6e8eb","#cdd1d7"), ai:"Matches your travertine + oak palette" },
        { id:"mb4", name:"Brushed brass sconce", cat:"Lighting", sw:g(160,"#d4d7dc","#b2b7bf") },
        { id:"mb5", name:"Linen drapery", cat:"Fabric", sw:g(140,"#eceef1","#d3d6db") },
        { id:"mb6", name:"Basalt coffee table", cat:"Furniture", sw:g(125,"#b7bcc4","#d9dce1"), ai:"Pairs with the smoked oak tone" }
      ]},
      { id:"suite", name:"Master Suite", items:[
        { id:"mb7", name:"Lime-washed walls", cat:"Finish", sw:g(140,"#e3e5e9","#c8ccd2") },
        { id:"mb8", name:"Walnut headboard", cat:"Wood", sw:g(150,"#c2c6cd","#a5aab2") },
        { id:"mb9", name:"Wool rug — undyed", cat:"Fabric", sw:g(130,"#e8eaee","#d0d4d9"), ai:"Completes the suite's soft neutrals" },
        { id:"mb10", name:"Paper pendant", cat:"Lighting", sw:g(155,"#dfe1e5","#c2c6cd") }
      ]},
      { id:"kitchen", name:"Kitchen", items:[
        { id:"mb11", name:"Honed basalt counter", cat:"Stone", sw:g(135,"#b2b7bf","#d4d7dc") },
        { id:"mb12", name:"Rift oak cabinetry", cat:"Wood", sw:g(145,"#cdd1d7","#aeb3bb") },
        { id:"mb13", name:"Linear pendant", cat:"Lighting", sw:g(120,"#dcdfe4","#bfc4cb") }
      ]}
    ]},
    reactions:{}, comments:{
      "mb3":[ { id:uid(), by:"studio", who:"Camille — Lead Designer", text:"We softened the arm profile from the first pass — sits lower against the window line.", t:now-6*day } ],
      "render:living:v2":[ { id:uid(), by:"studio", who:"Atelier — 3D", text:"Lighting re-balanced for the 6pm sun study you asked about.", t:now-2*day } ]
    },
    renders:{ rooms:[
      { id:"living", name:"Living Room", approved:null, versions:[
        { v:"v1", label:"Concept v1", before:g(135,"#e3e5e9","#c9cdd4"), after:g(135,"#cdd1d7","#9fa4ac"), note:"First massing + palette" },
        { v:"v2", label:"Concept v2", before:g(135,"#e3e5e9","#c9cdd4"), after:g(150,"#c2c6cd","#8f949c"), note:"Lower sofa line, warmer light" },
        { v:"final", label:"Final", before:g(135,"#e3e5e9","#c9cdd4"), after:g(160,"#b7bcc4","#7d828a"), note:"Presentation render" } ]},
      { id:"suite", name:"Master Suite", approved:null, versions:[
        { v:"v1", label:"Concept v1", before:g(140,"#e8eaee","#d0d4d9"), after:g(140,"#c9cdd4","#a2a7af"), note:"Initial layout" },
        { v:"final", label:"Final", before:g(140,"#e8eaee","#d0d4d9"), after:g(155,"#b2b7bf","#878c94"), note:"Presentation render" } ]},
      { id:"kitchen", name:"Kitchen", approved:null, versions:[
        { v:"v1", label:"Concept v1", before:g(130,"#e6e8eb","#cdd1d7"), after:g(130,"#c2c6cd","#989da5"), note:"Island study" },
        { v:"v2", label:"Concept v2", before:g(130,"#e6e8eb","#cdd1d7"), after:g(145,"#aeb3bb","#7d828a"), note:"Pendant + counter revised" } ]}
    ]},
    approvals:[
      { id:"ap1", title:"Living Room moodboard", room:"Living Room", due:now+3*day, status:"pending" },
      { id:"ap2", title:"Kitchen render v2", room:"Kitchen", due:now+5*day, status:"pending" },
      { id:"ap3", title:"Marble slab — Estremoz lot #14", room:"Bathrooms", due:now+7*day, status:"pending" },
      { id:"ap4", title:"Suite lighting concept", room:"Master Suite", due:now-9*day, status:"approved", decidedAt:now-9*day }
    ],
    materials:[
      { id:"m1", name:"Estremoz marble", cat:"Stone", finish:"Honed", sku:"EST-014", supplier:"Solancis", status:"lead", lead:"6 wks", room:"Bathrooms" },
      { id:"m2", name:"Smoked oak — wide plank", cat:"Wood", finish:"UV oil", sku:"OAK-220W", supplier:"Dinesen", status:"stock", room:"Living Room" },
      { id:"m3", name:"Lime paint — Bone", cat:"Paint", finish:"Matt", sku:"LP-BN-05", supplier:"Bauwerk", status:"stock", room:"Whole home" },
      { id:"m4", name:"Brushed brass sconce", cat:"Lighting", finish:"Satin", sku:"SC-114-BR", supplier:"Apparatus", status:"lead", lead:"10 wks", room:"Living Room" },
      { id:"m5", name:"Bouclé — natural", cat:"Fabric", finish:"—", sku:"BC-020", supplier:"Dedar", status:"back", room:"Living Room" },
      { id:"m6", name:"Honed basalt slab", cat:"Stone", finish:"Honed", sku:"BAS-3cm", supplier:"Solancis", status:"lead", lead:"4 wks", room:"Kitchen" }
    ],
    budget:{ currency:"€", categories:[
      { id:"b1", name:"Joinery & millwork", est:64000, actual:58200 },
      { id:"b2", name:"Stone & surfaces", est:38000, actual:41500 },
      { id:"b3", name:"Furniture", est:72000, actual:47300 },
      { id:"b4", name:"Lighting", est:22000, actual:19800 },
      { id:"b5", name:"Fabric & styling", est:18000, actual:6100 } ],
      milestones:[
      { id:"pm1", label:"Engagement — signed", amount:24000, due:now-55*day, status:"paid" },
      { id:"pm2", label:"Concept approval", amount:36000, due:now-20*day, status:"paid" },
      { id:"pm3", label:"Design Development sign-off", amount:48000, due:now+10*day, status:"due" },
      { id:"pm4", label:"Procurement release", amount:60000, due:now+45*day, status:"upcoming" } ]},
    threads:[
      { id:"t1", title:"General", messages:[
        { id:uid(), by:"studio", who:"Camille — Lead Designer", text:"Welcome to your portal. Everything we decide together lives here — moodboards, renders, approvals and the schedule.", t:now-58*day },
        { id:uid(), by:"studio", who:"Rui — Project Manager", text:"Site measurements are confirmed. Design Development is underway.", t:now-30*day } ]},
      { id:"t2", title:"Living Room", messages:[
        { id:uid(), by:"studio", who:"Camille — Lead Designer", text:"Two sofa directions are on the moodboard — the bouclé is our recommendation for the light in that room.", t:now-6*day } ]},
      { id:"t3", title:"Procurement", messages:[
        { id:uid(), by:"studio", who:"Rui — Project Manager", text:"The Dedar bouclé is backordered at the mill. We have two alternatives ready if the 12-week window doesn't work.", t:now-1*day } ]}
    ],
    schedule:[
      { id:"s1", date:now-60*day, title:"Engagement begins — Concept phase", kind:"phase", status:"done" },
      { id:"s2", date:now-32*day, title:"Site survey & measurements", kind:"site", status:"done" },
      { id:"s3", date:now-20*day, title:"Concept approved", kind:"phase", status:"done" },
      { id:"s4", date:now+10*day, title:"Design Development sign-off", kind:"phase", status:"next" },
      { id:"s5", date:now+24*day, title:"Site visit — services first fix", kind:"site", status:"planned" },
      { id:"s6", date:now+45*day, title:"Procurement release", kind:"phase", status:"planned" },
      { id:"s7", date:now+96*day, title:"Stone & joinery delivery", kind:"delivery", status:"planned" },
      { id:"s8", date:now+126*day, title:"Installation week", kind:"install", status:"planned" },
      { id:"s9", date:now+140*day, title:"Styling & reveal", kind:"phase", status:"planned" }
    ]
  };
}
/* ----- client endpoints (each writes to the client's own DB file) ----- */
app.get("/api/portal",(req,res)=>{ const u=authUser(req); if(!u) return res.status(401).json({error:"Unauthorized"});
  res.json({ portal: portalOf(u), user: safeUser(u) }); });
/* live stream — EventSource can't send headers, so the token rides in ?t= */
app.get("/api/portal/events",(req,res)=>{
  const t=verify(String(req.query.t||"")); if(!t) return res.status(401).json({error:"Unauthorized"});
  const u=db.users.find(x=>x.id===t.uid); if(!u) return res.status(401).json({error:"Unauthorized"});
  if((t.tv||0)!==(u.tv||0)) return res.status(401).json({error:"Unauthorized"});
  sseOpen(req,res,u.id);
});
app.post("/api/portal/react",(req,res)=>{ const u=authUser(req); if(!u) return res.status(401).json({error:"Unauthorized"});
  const p=portalOf(u), { itemId, like }=req.body||{};
  if(!validStr(itemId,60)) return res.status(400).json({error:"Bad item"});
  if(like===true||like===false){ p.reactions[itemId]={like,t:Date.now()}; pact(p,"client",(like?"Liked":"Passed on")+" a moodboard item", u.email); }
  else delete p.reactions[itemId];
  savePortal(u.id,p); res.json({ ok:true, reactions:p.reactions }); });
app.post("/api/portal/comment",(req,res)=>{ const u=authUser(req); if(!u) return res.status(401).json({error:"Unauthorized"});
  const p=portalOf(u), { refId, text }=req.body||{};
  if(!validStr(refId,80)||!validStr(text,2000)||!text.trim()) return res.status(400).json({error:"A comment is required"});
  p.comments[refId]=p.comments[refId]||[];
  const c={ id:uid(), by:"client", text:text.trim().slice(0,2000), t:Date.now() };
  p.comments[refId].push(c); pact(p,"client","Commented on "+refId, u.email);
  savePortal(u.id,p); res.json({ ok:true, comment:c }); });
app.post("/api/portal/review",(req,res)=>{ const u=authUser(req); if(!u) return res.status(401).json({error:"Unauthorized"});
  const p=portalOf(u), b=req.body||{};
  const text=validStr(b.text,1200)?b.text.trim():"";
  if(!text) return res.status(400).json({error:"A review is required"});
  p.review={
    id:u.id,
    name:validStr(b.name,80)&&b.name.trim()?b.name.trim().slice(0,80):String(u.email||"Client").split("@")[0],
    role:validStr(b.role,120)&&b.role.trim()?b.role.trim().slice(0,120):"",
    rating:Math.max(1,Math.min(5,parseInt(b.rating,10)||5)),
    text:text.slice(0,1200),
    t:Date.now()
  };
  pact(p,"client","Posted a public review",u.email);
  savePortal(u.id,p); res.json({ ok:true, review:p.review }); });
app.post("/api/portal/approve",(req,res)=>{ const u=authUser(req); if(!u) return res.status(401).json({error:"Unauthorized"});
  const p=portalOf(u), { id, action, note }=req.body||{};
  const a=p.approvals.find(x=>x.id===id); if(!a) return res.status(404).json({error:"Not found"});
  if(action==="approve"){ a.status="approved"; a.decidedAt=Date.now(); delete a.note; pact(p,"client","Approved: "+a.title, u.email); }
  else if(action==="changes"){ a.status="changes"; a.decidedAt=Date.now(); a.note=validStr(note,2000)?note.trim().slice(0,2000):""; pact(p,"client","Requested changes: "+a.title, u.email); }
  else return res.status(400).json({error:"Bad action"});
  savePortal(u.id,p); res.json({ ok:true, approval:a }); });
app.post("/api/portal/render-approve",(req,res)=>{ const u=authUser(req); if(!u) return res.status(401).json({error:"Unauthorized"});
  const p=portalOf(u), { roomId, version }=req.body||{};
  const r=p.renders.rooms.find(x=>x.id===roomId); if(!r) return res.status(404).json({error:"Not found"});
  if(!r.versions.find(v=>v.v===version)) return res.status(400).json({error:"Bad version"});
  r.approved=version; pact(p,"client","Approved render "+version+" — "+r.name, u.email);
  savePortal(u.id,p); res.json({ ok:true, approved:version }); });
app.post("/api/portal/message",(req,res)=>{ const u=authUser(req); if(!u) return res.status(401).json({error:"Unauthorized"});
  const p=portalOf(u), { threadId, text }=req.body||{};
  const t=p.threads.find(x=>x.id===threadId); if(!t) return res.status(404).json({error:"Not found"});
  if(!validStr(text,4000)||!text.trim()) return res.status(400).json({error:"A message is required"});
  const m={ id:uid(), by:"client", text:text.trim().slice(0,4000), t:Date.now() };
  t.messages.push(m); pact(p,"client","Message in “"+t.title+"”", u.email);
  savePortal(u.id,p); res.json({ ok:true, message:m }); });
app.post("/api/portal/action",(req,res)=>{ const u=authUser(req); if(!u) return res.status(401).json({error:"Unauthorized"});
  const p=portalOf(u), { id, done }=req.body||{};
  const a=p.actions.find(x=>x.id===id); if(!a) return res.status(404).json({error:"Not found"});
  a.done=!!done; if(done) pact(p,"client","Completed action: "+a.label, u.email);
  savePortal(u.id,p); res.json({ ok:true }); });

/* ----- studio MASTER CONTROL (staff roles; used by the CMS desk) -----
   admin    → everything (accounts, site content, portals)
   editor   → edits & publishes the public website content
   designer → runs client portals: publishes sections, replies to clients
   user     → a client; portal access only, never staff surfaces */
/* ----- per-user privileges: the role gives defaults, u.perms overrides individual switches.
   Areas × actions:  site: view, publish · portal: view, edit, reply, reset · accounts: view, create, edit, delete
   Admins are never restricted; clients (role "user") never gain staff privileges. */
const PERM_SHAPE={ site:["view","publish"], portal:["view","edit","reply","reset"], accounts:["view","create","edit","delete"] };
const DEFAULT_PERMS={
  admin:   { site:["view","publish"], portal:["view","edit","reply","reset"], accounts:["view","create","edit","delete"] },
  editor:  { site:["view","publish"], portal:[], accounts:[] },
  designer:{ site:[], portal:["view","edit","reply","reset"], accounts:[] },
  user:    { site:[], portal:[], accounts:[] }
};
function permsOf(u){
  const role=u.role||"user", out={};
  for(const area in PERM_SHAPE){ out[area]={};
    for(const k of PERM_SHAPE[area]){
      let v=(DEFAULT_PERMS[role]&&DEFAULT_PERMS[role][area]||[]).indexOf(k)>=0;
      if(role==="admin") v=true;
      else if(role!=="user"&&u.perms&&u.perms[area]&&(k in u.perms[area])) v=!!u.perms[area][k];
      else if(role==="user") v=false;
      out[area][k]=v;
    } }
  return out;
}
function can(req,res,area,action){
  const u=authUser(req);
  if(!u){ res.status(401).json({error:"Unauthorized"}); return null; }
  const p=permsOf(u);
  if(!p[area]||!p[area][action]){ res.status(403).json({error:"Missing privilege: "+area+"."+action}); return null; }
  return u;
}
const P_SECTIONS=["project","actions","moodboards","renders","approvals","materials","budget","threads","schedule"];
app.get("/api/admin/portal/clients",(req,res)=>{ if(!can(req,res,"portal","view")) return;
  const list=db.users.filter(u=>u.role==="user").map(u=>{ const d=loadPortal(u.id); // clients only — staff never appear as clients
    return { id:u.id, email:u.email, createdAt:u.createdAt,
      project:d&&d.project?d.project.name:null, phase:d&&d.project?d.project.phases[d.project.phase]:null,
      pending:d?d.approvals.filter(a=>a.status==="pending").length:0,
      msgs:d?d.threads.reduce((s,t)=>s+t.messages.length,0):0,
      updatedAt:d?d.updatedAt:null }; });
  res.json({ clients:list }); });
app.get("/api/admin/portal/:uid",(req,res)=>{ if(!can(req,res,"portal","view")) return;
  const target=db.users.find(x=>x.id===req.params.uid); if(!target) return res.status(404).json({error:"No such client"});
  let d=loadPortal(target.id); if(!d){ d=emptyPortal(); pact(d,"studio","Workspace created"); savePortal(target.id,d,true); }
  res.json({ portal:d, client:safeUser(target) }); });
/* live stream for the master-control desk (staff token in ?t= — admin or designer) */
app.get("/api/admin/portal/:uid/events",(req,res)=>{
  const t=verify(String(req.query.t||"")); if(!t) return res.status(401).json({error:"Unauthorized"});
  let eu=null;
  if(t.uid){ eu=db.users.find(x=>x.id===t.uid);
    if(!eu||(t.tv||0)!==(eu.tv||0)) return res.status(401).json({error:"Unauthorized"}); }
  else if(t.role==="admin") eu={id:"admin",role:"admin"};
  if(!eu||!permsOf(eu).portal.view) return res.status(401).json({error:"Unauthorized"});
  const target=db.users.find(x=>x.id===req.params.uid); if(!target) return res.status(404).json({error:"No such client"});
  sseOpen(req,res,target.id);
});
app.put("/api/admin/portal/:uid",(req,res)=>{ const actor=can(req,res,"portal","edit"); if(!actor) return;
  const target=db.users.find(x=>x.id===req.params.uid); if(!target) return res.status(404).json({error:"No such client"});
  const { section, data }=req.body||{};
  if(P_SECTIONS.indexOf(section)<0) return res.status(400).json({error:"Unknown section"});
  if(JSON.stringify(data||null).length>24_000_000) return res.status(413).json({error:"Section too large — try smaller images"});
  let d=loadPortal(target.id)||emptyPortal();
  d[section]=data; pact(d,"studio","Updated "+section, actor.email);
  savePortal(target.id,d,true); logline({ev:"portal-admin-edit",by:actor.email,client:target.email,section});
  res.json({ ok:true, updatedAt:d.updatedAt }); });
app.post("/api/admin/portal/:uid/reply",(req,res)=>{ const actor=can(req,res,"portal","reply"); if(!actor) return;
  const target=db.users.find(x=>x.id===req.params.uid); if(!target) return res.status(404).json({error:"No such client"});
  const d=loadPortal(target.id)||emptyPortal();
  const { threadId, refId, text, who }=req.body||{};
  if(!validStr(text,4000)||!text.trim()) return res.status(400).json({error:"A message is required"});
  const entry={ id:uid(), by:"studio", who:validStr(who,80)&&who.trim()?who.trim():"Elevé Studio", text:text.trim().slice(0,4000), t:Date.now() };
  if(threadId){ const t=d.threads.find(x=>x.id===threadId); if(!t) return res.status(404).json({error:"Thread not found"});
    t.messages.push(entry); pact(d,"studio","Replied in “"+t.title+"”", actor.email); }
  else if(validStr(refId,80)){ d.comments[refId]=d.comments[refId]||[]; d.comments[refId].push(entry); pact(d,"studio","Replied on "+refId, actor.email); }
  else return res.status(400).json({error:"threadId or refId required"});
  savePortal(target.id,d,true); logline({ev:"portal-reply",by:actor.email,client:target.email}); res.json({ ok:true, message:entry }); });
app.post("/api/admin/portal/:uid/seed-demo",(req,res)=>{ const actor=can(req,res,"portal","edit"); if(!actor) return;
  const target=db.users.find(x=>x.id===req.params.uid); if(!target) return res.status(404).json({error:"No such client"});
  const d=demoPortal(); d.activity=[]; pact(d,"studio","Published the Aurora Penthouse showcase", actor.email);
  savePortal(target.id,d,true); logline({ev:"portal-seed",by:actor.email,client:target.email}); res.json({ ok:true }); });
app.post("/api/admin/portal/:uid/reset",(req,res)=>{ const actor=can(req,res,"portal","reset"); if(!actor) return;
  const target=db.users.find(x=>x.id===req.params.uid); if(!target) return res.status(404).json({error:"No such client"});
  const d=emptyPortal(); pact(d,"studio","Workspace reset", actor.email);
  savePortal(target.id,d,true); logline({ev:"portal-reset",by:actor.email,client:target.email}); res.json({ ok:true }); });

/* ----- ACCOUNT MANAGEMENT (admin only; used by the CMS Accounts desk) ----- */
app.get("/api/admin/users",(req,res)=>{ if(!can(req,res,"accounts","view")) return;
  res.json({ users: db.users.map(u=>{ const d=loadPortal(u.id);
    return { id:u.id, email:u.email, role:u.role, plan:u.plan, createdAt:u.createdAt,
      can:permsOf(u), perms:u.perms||null,
      project:d&&d.project?d.project.name:null,
      msgs:d?d.threads.reduce((s,t)=>s+t.messages.length,0):0,
      builderProjects:db.projects.filter(p=>p.ownerId===u.id).length }; }) }); });
app.post("/api/admin/users",(req,res)=>{ const actor=can(req,res,"accounts","create"); if(!actor) return;
  const { password, role }=req.body||{}, email=cleanEmail(req.body&&req.body.email);
  if(!email) return res.status(400).json({error:"A valid email is required"});
  if(!validStr(password,200)||password.length<6) return res.status(400).json({error:"Password must be at least 6 characters"});
  if(db.users.find(u=>u.email===email)) return res.status(409).json({error:"That email is already registered"});
  const salt=crypto.randomBytes(16).toString("hex");
  const ROLE_OK=["user","designer","editor","admin"];
  const u={ id:uid(), email, salt, pass:hash(password,salt), role:ROLE_OK.indexOf(role)>=0?role:"user", plan:"free", createdAt:Date.now() };
  db.users.push(u); persist(); logline({ev:"admin-user-create",by:actor.email,email:u.email,role:u.role}); insDirty();
  res.json({ ok:true, user:safeUser(u) }); });
app.put("/api/admin/users/:uid",(req,res)=>{ const actor=can(req,res,"accounts","edit"); if(!actor) return;
  const u=db.users.find(x=>x.id===req.params.uid); if(!u) return res.status(404).json({error:"No such account"});
  const b=req.body||{};
  if(b.perms!==undefined){ /* per-user privilege overrides (staff roles only; admin is never restricted) */
    const p={}; let any=false;
    if(b.perms&&typeof b.perms==="object") for(const area in PERM_SHAPE){
      if(b.perms[area]&&typeof b.perms[area]==="object"){ p[area]={};
        for(const k of PERM_SHAPE[area]) if(k in b.perms[area]){ p[area][k]=!!b.perms[area][k]; any=true; } }
    }
    if(any) u.perms=p; else delete u.perms;
  }
  if(b.email!==undefined){
    const e=cleanEmail(b.email); if(!e) return res.status(400).json({error:"Invalid email"});
    if(db.users.find(x=>x.email===e&&x.id!==u.id)) return res.status(409).json({error:"That email is already registered"});
    u.email=e;
  }
  if(b.role!==undefined){
    const r=(["user","designer","editor","admin"].indexOf(b.role)>=0)?b.role:"user";
    if(u.role==="admin"&&r!=="admin"&&db.users.filter(x=>x.role==="admin").length<=1)
      return res.status(409).json({error:"This is the only admin account — make someone else admin first."});
    if(r!==u.role&&b.perms===undefined) delete u.perms; // role change resets custom privileges to the new role's defaults
    u.role=r;
  }
  if(b.password!==undefined&&b.password!==""){
    if(!validStr(b.password,200)||b.password.length<6) return res.status(400).json({error:"Password must be at least 6 characters"});
    u.salt=crypto.randomBytes(16).toString("hex"); u.pass=hash(b.password,u.salt);
    u.tv=(u.tv||0)+1; // sign out every existing session for this account, everywhere
  }
  persist(); logline({ev:"admin-user-edit",by:actor.email,email:u.email,changed:Object.keys(b).join(",")}); insDirty();
  res.json({ ok:true, user:safeUser(u) }); });
app.delete("/api/admin/users/:uid",(req,res)=>{ const actor=can(req,res,"accounts","delete"); if(!actor) return;
  const i=db.users.findIndex(x=>x.id===req.params.uid); if(i<0) return res.status(404).json({error:"No such account"});
  const u=db.users[i];
  if(u.role==="admin"&&db.users.filter(x=>x.role==="admin").length<=1)
    return res.status(409).json({error:"This is the only admin account — it can't be deleted."});
  db.users.splice(i,1);
  db.projects=db.projects.filter(p=>p.ownerId!==u.id);          // their builder projects
  try{ if(fs.existsSync(pFile(u.id))) fs.unlinkSync(pFile(u.id)); }catch(e){}  // their portal DB
  pCache.delete(u.id); clearTimeout(pTimers.get(u.id)); pTimers.delete(u.id);
  const subs=pSubs.get(u.id); if(subs){ for(const r of subs){ try{ r.end(); }catch(e){} } pSubs.delete(u.id); }
  persist(); logline({ev:"admin-user-delete",by:actor.email,email:u.email}); insDirty();
  res.json({ ok:true }); });

/* ---------- analytics (privacy-friendly, no PII/cookies) + client log ---------- */
app.post("/api/analytics",(req,res)=>{ const { page, event } = req.body||{};
  if(validStr(page,200)&&validStr(event,60)){ db.analytics.push({ t:Date.now(), page:page.slice(0,200), event:event.slice(0,60) }); if(db.analytics.length>5000) db.analytics.shift(); persist(); insDirty(); }
  res.json({ ok:true }); });
app.get("/api/analytics/summary",(req,res)=>{ const u=authUser(req); if(!u||u.role!=="admin") return res.status(401).json({error:"Unauthorized"});
  const by={}; (db.analytics||[]).forEach(a=>{ const k=a.event+" "+a.page; by[k]=(by[k]||0)+1; }); res.json({ total:(db.analytics||[]).length, by }); });
app.post("/api/log",(req,res)=>{ const m=req.body&&req.body.msg; if(validStr(m,1000)) logline({ev:"clienterror",msg:m.slice(0,1000)}); res.json({ok:true}); });

/* ---------- live presence (anonymous, ephemeral — powers "who's on now") ---------- */
const presence=new Map(); // ephemeral id -> { area, t, path }  (never persisted, no PII)
function sweepPresence(){ const cut=Date.now()-70000; for(const [k,v] of presence) if(v.t<cut) presence.delete(k); }
function liveCounts(){ sweepPresence(); const by={site:0,builder:0,portal:0,cms:0};
  for(const v of presence.values()) if(by[v.area]!=null) by[v.area]++;
  return { site:by.site, builder:by.builder, portal:by.portal, cms:by.cms, total:by.site+by.builder+by.portal+by.cms }; }
app.post("/api/presence",(req,res)=>{ const b=req.body||{};
  const id=validStr(b.id,60)?b.id:null;
  const area=["site","builder","portal","cms"].indexOf(b.area)>=0?b.area:"site";
  if(id){ presence.set(id,{ area, t:Date.now(), path:validStr(b.path,200)?b.path.slice(0,200):"" }); if(presence.size>3000) sweepPresence(); }
  res.json({ ok:true }); });

/* ---------- realtime push for the admin Insights dashboard ----------
   Tiny "something changed" pings (SSE); the admin's browser then refetches the
   cheap aggregate once, debounced. Bursts coalesce so it stays efficient. */
const insSubs=new Set(); let insPingT=null, lastLive="";
function insEmit(){ const p="data:"+JSON.stringify({t:Date.now()})+"\n\n"; for(const r of insSubs){ try{ r.write(p); }catch(e){} } }
function insDirty(){ if(!insSubs.size||insPingT) return; insPingT=setTimeout(()=>{ insPingT=null; insEmit(); }, 400); } // coalesce a burst into one push (~400ms)
const insLiveTimer=setInterval(()=>{ if(!insSubs.size) return; const lc=JSON.stringify(liveCounts()); if(lc!==lastLive){ lastLive=lc; insEmit(); } }, 5000); // presence join/leave → push within 5s
if(insLiveTimer.unref) insLiveTimer.unref();
app.get("/api/admin/insights/events",(req,res)=>{
  const t=verify(String(req.query.t||"")); let ok=false;
  if(t&&t.uid){ const u=db.users.find(x=>x.id===t.uid); ok=!!u&&u.role==="admin"&&(t.tv||0)===(u.tv||0); }
  else if(t&&t.role==="admin"&&!t.uid) ok=true;
  if(!ok){ res.status(403).end(); return; }
  res.writeHead(200,{ "Content-Type":"text/event-stream","Cache-Control":"no-cache, no-transform","Connection":"keep-alive","X-Accel-Buffering":"no" });
  res.write("retry: 3000\n\n"); insSubs.add(res);
  const hb=setInterval(()=>{ try{ res.write(":hb\n\n"); }catch(e){} },25000);
  req.on("close",()=>{ clearInterval(hb); insSubs.delete(res); });
});

/* ---------- ADMIN INSIGHTS (admin only): live, analytics, all activity, totals ---------- */
function tailEvents(n){ try{ const st=fs.statSync(LOG), size=Math.min(st.size, 256*1024), buf=Buffer.alloc(size), fd=fs.openSync(LOG,"r");
  try{ fs.readSync(fd,buf,0,size,st.size-size); }finally{ fs.closeSync(fd); }
  const lines=buf.toString("utf8").trim().split(/\r?\n/), out=[];
  for(let i=lines.length-1;i>=0&&out.length<n;i--){ try{ out.push(JSON.parse(lines[i])); }catch(e){} } return out; }catch(e){ return []; } }
app.get("/api/admin/insights",(req,res)=>{ const u=authUser(req); if(!u||u.role!=="admin") return res.status(403).json({error:"Admins only"});
  const byRole={admin:0,editor:0,designer:0,user:0};
  db.users.forEach(x=>{ byRole[x.role]=(byRole[x.role]||0)+1; });
  let pendingApprovals=0, openComments=0, portalCount=0, clientMsgs=0; const activity=[];
  db.users.filter(x=>x.role==="user").forEach(x=>{ const d=loadPortal(x.id); if(!d) return; portalCount++;
    pendingApprovals+=(d.approvals||[]).filter(a=>a.status==="pending").length;
    const C=d.comments||{}; for(const k in C) openComments+=(C[k]||[]).length;
    (d.threads||[]).forEach(t=>{ clientMsgs+=t.messages.filter(m=>m.by==="client").length; });
    (d.activity||[]).slice(0,20).forEach(a=>activity.push({ t:a.t, by:a.by, who:a.who, text:a.text, client:x.email }));
  });
  activity.sort((a,b)=>b.t-a.t);
  const A=db.analytics||[], pv={}, ev={}, perDay={}, dayCut=Date.now()-7*86400000;
  A.forEach(a=>{ ev[a.event]=(ev[a.event]||0)+1; if(a.event==="pageview") pv[a.page]=(pv[a.page]||0)+1;
    if(a.t>=dayCut){ const key=new Date(a.t).toISOString().slice(0,10); perDay[key]=(perDay[key]||0)+1; } });
  res.json({
    live: liveCounts(),
    totals: { users:db.users.length, admins:byRole.admin, editors:byRole.editor, designers:byRole.designer, clients:byRole.user,
      staff:byRole.admin+byRole.editor+byRole.designer, builderProjects:(db.projects||[]).length, portals:portalCount,
      subscribers:(db.subscribers||[]).length, messages:(db.messages||[]).length, consults:(db.consults||[]).length,
      pendingApprovals, openComments, clientMsgs },
    analytics: { total:A.length, pageviews:pv, events:ev, perDay },
    activity: activity.slice(0,40),
    events: tailEvents(60),
    enquiries: { messages:(db.messages||[]).slice(0,10), consults:(db.consults||[]).slice(0,10) }
  });
});

/* ---------- production backup operations (admin only) ---------- */
function listBackups(){
  try{
    if(!fs.existsSync(BACKUPS)) return [];
    return fs.readdirSync(BACKUPS)
      .filter(name=>/^(snapshot|db)-.*\.(?:json|json\.gz)$/.test(name))
      .map(name=>{ const st=fs.statSync(path.join(BACKUPS,name)); return { name, bytes:st.size, updatedAt:st.mtimeMs }; })
      .sort((a,b)=>b.updatedAt-a.updatedAt);
  }catch(e){ return []; }
}
app.get("/api/admin/backups",(req,res)=>{ const u=authUser(req); if(!u||u.role!=="admin") return res.status(403).json({error:"Admins only"});
  res.json({ backups:listBackups(), keep:BACKUP_KEEP, intervalMs:BACKUP_INTERVAL_MS });
});
app.post("/api/admin/backups/run",(req,res)=>{ const u=authUser(req); if(!u||u.role!=="admin") return res.status(403).json({error:"Admins only"});
  const b=backup(); if(!b.ok) return res.status(500).json({error:b.error||"Backup failed"});
  logline({ev:"backup-run",by:u.email,name:b.name}); res.json({ backup:b });
});

/* ---------- static site ---------- */
const PUBLIC_STATIC_EXT=new Set([".html",".css",".js",".svg",".xml",".txt",".webmanifest",".png",".jpg",".jpeg",".webp",".gif",".mp3",".wav",".glb",".woff",".woff2"]);
function publicStaticAllowed(reqPath){
  let p=String(reqPath||"/");
  try{ p=decodeURIComponent(p); }catch(e){}
  p="/"+p.replace(/\\/g,"/").replace(/^\/+/,"");
  if(p.indexOf("\0")>=0) return false;
  const parts=p.split("/").filter(Boolean);
  if(parts[0]==="server") return false;
  if(parts.some(part=>part.charAt(0)===".")) return false;
  const resolved=path.resolve(SITE, "."+p);
  if(resolved!==SITE && !resolved.startsWith(SITE+path.sep)) return false;
  const ext=path.extname(p).toLowerCase();
  if(!ext){
    if(p==="/" || p.endsWith("/")) return true;
    return fs.existsSync(resolved+".html") || fs.existsSync(path.join(resolved,"index.html"));
  }
  return PUBLIC_STATIC_EXT.has(ext);
}
app.use((req,res,next)=>{
  if((req.method==="GET"||req.method==="HEAD") && !req.path.startsWith("/api/") && !publicStaticAllowed(req.path))
    return res.status(404).end();
  next();
});
app.use(express.static(SITE, { extensions:["html"], setHeaders:function(res,fp){
  if(/\.(js|css|mp3|wav|glb|svg|png|jpg|jpeg|webp|woff2?)$/i.test(fp)) res.setHeader("Cache-Control","public, max-age=604800");
  else if(/\.html$/i.test(fp)) res.setHeader("Cache-Control","no-cache");
}, dotfiles:"ignore" }));
app.use((req,res)=>{ res.status(404); if(req.accepts("html")) return res.sendFile(path.join(SITE,"404.html"),err=>{ if(err) res.send("Not found"); }); res.json({error:"Not found"}); });

app.ready = pgInit();          // resolves immediately when DATABASE_URL is not set
app.ready.catch(()=>{});       // avoid unhandled-rejection kill when used as a module; main mode handles it below
if (require.main === module) {
  app.ready.then(()=>{
  backup(); const backupTimer=setInterval(backup, BACKUP_INTERVAL_MS); if(backupTimer.unref) backupTimer.unref();
  ["SIGTERM","SIGINT"].forEach(sig=>process.on(sig, ()=>{  // flush pending writes on shutdown (deploys, spin-down)
    try{ clearTimeout(saveT); writeDbNow(); }catch(e){}
    Promise.resolve(pgFlush()).catch(()=>{}).then(()=>process.exit(0));
  }));
  const onListen=()=>{
    console.log("Elevé server \u2192 http://"+(HOST||"0.0.0.0")+":"+PORT);
    console.log("Admin password: "+(process.env.ADMIN_PASSWORD?"(env)":"eleve-admin (default \u2014 change it)"));
    console.log("Persistence: "+(PG_URL?"Postgres (DATABASE_URL)":"local JSON file (dev)"));
    console.log("Billing: "+(STRIPE_KEY?"Stripe key present":"not configured (set STRIPE_SECRET)"));
  };
  if(HOST) app.listen(PORT, HOST, onListen);
  else app.listen(PORT, onListen);
  }).catch(e=>{ console.error("FATAL: could not reach Postgres (DATABASE_URL): "+e.message); process.exit(1); });
}
module.exports = app;
