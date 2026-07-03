const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "eleve-server-"));
process.env.NODE_ENV = "test";
process.env.SECRET = "test-secret-change-me-please";
process.env.ADMIN_PASSWORD = "test-admin-password";
process.env.DB_FILE = path.join(tmp, "db.json");
process.env.LOG_FILE = path.join(tmp, "events.log");
process.env.PORTAL_DIR = path.join(tmp, "portals");
process.env.BACKUP_DIR = path.join(tmp, "backups");
delete process.env.DATABASE_URL;
delete process.env.RENDER;
delete process.env.STRIPE_SECRET;
delete process.env.STRIPE_PRICE_PRO;
delete process.env.STRIPE_PRICE_ID;
delete process.env.STRIPE_WEBHOOK_SECRET;

fs.writeFileSync(process.env.DB_FILE, '{"__proto__":{"polluted":"yes"},"users":[]}');

const app = require("./server");

let server;
let base;
let adminToken;

async function adminHeaders(){
  if(!adminToken){
    const login = await fetch(base + "/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "owner@example.com", password: "secret123" })
    });
    if(login.status === 200) adminToken = (await login.json()).token;
  }
  if(!adminToken){
    const register = await fetch(base + "/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "owner@example.com", password: "secret123" })
    });
    assert.equal(register.status, 200);
    adminToken = (await register.json()).token;
  }
  return { Authorization: "Bearer " + adminToken };
}

test.before(async () => {
  await app.ready;
  server = app.listen(0);
  await new Promise(resolve => server.once("listening", resolve));
  base = "http://127.0.0.1:" + server.address().port;
});

test.after(async () => {
  await new Promise(resolve => server.close(resolve));
  await new Promise(resolve => setTimeout(resolve, 300));
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("serves public pages but not backend files", async () => {
  const page = await fetch(base + "/index.html");
  assert.equal(page.status, 200);

  for (const url of ["/server/db.json", "/server/server.js", "/server/backups/db-test.json", "/Procfile"]) {
    const res = await fetch(base + url);
    assert.equal(res.status, 404, url);
  }
});

test("strips prototype-pollution keys from stored and incoming JSON", async () => {
  assert.equal({}.polluted, undefined);

  const res = await fetch(base + "/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: '{"email":"owner@example.com","password":"secret123","__proto__":{"polluted":"yes"}}'
  });
  assert.equal(res.status, 200);
  adminToken = (await res.json()).token;
  assert.equal({}.polluted, undefined);
});

test("reports billing setup instead of silently faking checkout", async () => {
  const res = await fetch(base + "/api/billing/checkout", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await adminHeaders()) },
    body: JSON.stringify({ plan: "pro" })
  });
  assert.equal(res.status, 501);
  const body = await res.json();
  assert.deepEqual(body.missing.sort(), ["STRIPE_PRICE_PRO", "STRIPE_SECRET"]);
});

test("creates and lists admin-only compressed backups", async () => {
  const denied = await fetch(base + "/api/admin/backups");
  assert.equal(denied.status, 403);

  const run = await fetch(base + "/api/admin/backups/run", {
    method: "POST",
    headers: await adminHeaders()
  });
  assert.equal(run.status, 200);
  const created = await run.json();
  assert.equal(created.backup.ok, true);
  assert.match(created.backup.name, /^snapshot-.*\.json\.gz$/);

  const list = await fetch(base + "/api/admin/backups", { headers: await adminHeaders() });
  assert.equal(list.status, 200);
  const body = await list.json();
  assert.equal(body.keep, 30);
  assert.ok(body.backups.some(b => b.name === created.backup.name));
  assert.ok(fs.existsSync(path.join(process.env.BACKUP_DIR, created.backup.name)));
});
