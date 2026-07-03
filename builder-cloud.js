/* Elevé builder — autosave/recovery + cloud projects (save, list, share).
   Requires the backend (server/). Falls back to local autosave when offline. */
(function(){
  var base=(location.protocol==="http:"||location.protocol==="https:")?"":"http://localhost:4000";
  var AK="eleve_builder_autosave", PK="eleve_builder_pid", TK="eleve_token";
  function B(){ return window.__BUILDER; }
  function toast(msg,ms){ var t=document.createElement("div"); t.textContent=msg; t.style.cssText="position:fixed;left:50%;bottom:20px;transform:translateX(-50%);z-index:1600;background:#17181b;color:#fff;font:500 .8rem Inter,system-ui,sans-serif;padding:.7rem 1rem;letter-spacing:.03em"; document.body.appendChild(t); setTimeout(function(){t.remove();}, ms||2200); }
  function api(path,method,body,tok){ return fetch(base+"/api"+path,{method:method||"GET",headers:Object.assign({"Content-Type":"application/json"},tok?{Authorization:"Bearer "+tok}:{}),body:body?JSON.stringify(body):undefined}); }
  function token(){ try{return localStorage.getItem(TK);}catch(e){return null;} }

  /* autosave + crash recovery (works offline) */
  var last="";
  function autosave(){ if(!B())return; try{ var snap=JSON.stringify(B().serialize()); if(snap!==last){ last=snap; localStorage.setItem(AK, JSON.stringify({t:Date.now(),data:snap})); } }catch(e){} }
  setInterval(autosave, 4000);
  window.addEventListener("beforeunload", autosave);
  function offerRecovery(){
    var raw; try{ raw=localStorage.getItem(AK); }catch(e){}
    if(!raw || sessionStorage.getItem("eleve_builder_session")) return;
    sessionStorage.setItem("eleve_builder_session","1");
    var rec; try{ rec=JSON.parse(raw); }catch(e){ return; } if(!rec||!rec.data) return;
    var bar=document.createElement("div");
    bar.style.cssText="position:fixed;left:50%;top:74px;transform:translateX(-50%);z-index:1600;background:rgba(246,247,249,.98);border:1px solid #17181b;padding:.7rem .9rem;display:flex;gap:.7rem;align-items:center;font:500 .8rem Inter,system-ui,sans-serif;color:#17181b";
    bar.innerHTML='<span>Recover unsaved work from '+new Date(rec.t).toLocaleString()+'?</span>';
    function mk(t,solid){var b=document.createElement("button");b.textContent=t;b.style.cssText="font:inherit;font-size:.72rem;text-transform:uppercase;letter-spacing:.06em;padding:.45rem .7rem;border:1px solid #17181b;cursor:pointer;background:"+(solid?"#17181b":"transparent")+";color:"+(solid?"#fff":"#17181b");return b;}
    var yes=mk("Restore",true), no=mk("Dismiss",false);
    yes.addEventListener("click",function(){ try{ B().load(JSON.parse(rec.data)); toast("Recovered ✓"); }catch(e){} bar.remove(); });
    no.addEventListener("click",function(){ bar.remove(); });
    bar.appendChild(yes); bar.appendChild(no); document.body.appendChild(bar);
  }

  /* auth (sign-in only — accounts are issued by the studio) — branded dialogs */
  function ensureAuth(cb){
    var t=token(); if(t) return cb(t);
    eleveUI.prompt("Email — the account the studio set up for you.",{title:"Cloud account",type:"email",placeholder:"you@email.com",ok:"Continue"}).then(function(email){
      if(!email) return;
      eleveUI.prompt("Password — use the sign-in details from the studio.",{title:"Cloud account",type:"password",ok:"Sign in"}).then(function(pw){
        if(!pw) return;
        fetch(base+"/api/auth/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email:email,password:pw})})
          .then(function(r){ return r.json().then(function(j){ if(!r.ok) throw j; return j; }); })
          .then(function(j){ localStorage.setItem(TK,j.token); toast("Signed in ✓"); cb(j.token); })
          .catch(function(e){ eleveUI.alert((e&&e.error==="Invalid credentials")?"Unknown email or wrong password — cloud accounts are set up by the studio.":((e&&e.error)||"Sign-in failed — is the server running? (cd server && npm start)"),{title:"Cloud account"}); });
      });
    });
  }

  function cloudSave(){ ensureAuth(function(tok){ var data=B().serialize(); var pid=null; try{pid=localStorage.getItem(PK);}catch(e){}
    if(pid){ api("/projects/"+pid,"PUT",{data:data},tok).then(function(r){ if(r.status===404){ localStorage.removeItem(PK); return cloudSave(); } if(!r.ok) throw 0; return r.json(); }).then(function(){ toast("Cloud saved ✓ (version added)"); }).catch(function(){ eleveUI.alert("Save failed.",{title:"Cloud save"}); }); }
    else { eleveUI.prompt("Name this project",{title:"Cloud save",value:"Elevé plan",ok:"Save"}).then(function(nm){
      if(nm===null) return; nm=(nm||"").trim()||"Elevé plan";
      api("/projects","POST",{name:nm,data:data},tok).then(function(r){ if(r.status===402) return r.json().then(function(e){eleveUI.alert(e.error,{title:"Cloud save"});}); if(!r.ok) throw 0; return r.json(); }).then(function(j){ if(j&&j.id){ localStorage.setItem(PK,j.id); toast("Saved to cloud ✓"); } }).catch(function(){ eleveUI.alert("Save failed.",{title:"Cloud save"}); });
    }); }
  }); }
  function myProjects(){ ensureAuth(function(tok){ api("/projects","GET",null,tok).then(function(r){return r.json();}).then(function(j){ var list=j.projects||[]; if(!list.length){ eleveUI.alert("No cloud projects yet — use Cloud save first.",{title:"Projects"}); return; }
    var items=list.map(function(p){ return p.name+"  ·  "+new Date(p.updatedAt).toLocaleDateString()+"  ·  "+p.versions+" versions"; });
    eleveUI.choose("Pick a project to open.",items,{title:"Your projects"}).then(function(idx){
      if(idx==null||!list[idx]) return; var id=list[idx].id;
      api("/projects/"+id,"GET",null,tok).then(function(r){return r.json();}).then(function(pj){ if(pj&&pj.project){ B().load(pj.project.data); localStorage.setItem(PK,id); toast("Opened: "+pj.project.name); } });
    }); }).catch(function(){ eleveUI.alert("Could not load projects.",{title:"Projects"}); }); }); }
  function shareProj(){ ensureAuth(function(tok){ var pid=null; try{pid=localStorage.getItem(PK);}catch(e){} if(!pid){ eleveUI.alert("Cloud save first, then Share.",{title:"Share link"}); return; } api("/projects/"+pid+"/share","POST",null,tok).then(function(r){return r.json();}).then(function(j){ if(j&&j.shareId){ var url=location.origin+"/builder.html?share="+j.shareId; try{navigator.clipboard.writeText(url);}catch(e){} eleveUI.prompt("Read-only share link — copied to your clipboard.",{title:"Share link",value:url,readonly:true,ok:"Done",cancel:"Close"}); } }); }); }

  function onboard(){
    var ov=document.createElement("div");
    ov.style.cssText="position:fixed;inset:0;z-index:1700;background:rgba(20,21,24,.55);display:flex;align-items:center;justify-content:center;padding:1rem";
    var box=document.createElement("div");
    box.style.cssText="max-width:440px;background:#f6f7f9;border:1px solid #17181b;padding:1.8rem;font:400 .9rem Inter,system-ui,sans-serif;color:#17181b;box-shadow:10px 10px 0 rgba(23,24,27,.12)";
    box.innerHTML="<p style=\"font-family:'Playfair Display',serif;font-size:1.4rem;margin:0 0 .2rem\">Welcome to the room builder</p>"+
      "<p style=\"color:#6b6f76;margin:0 0 1rem;font-size:.85rem\">A 60-second orientation:</p>"+
      "<ul style=\"margin:0 0 1.2rem;padding-left:1.1rem;line-height:1.7;font-size:.86rem\">"+
      "<li><b>Draw a room</b> - press <b>R</b>oom tool and drag on the sheet.</li>"+
      "<li><b>Add furniture</b> - pick a category, click an item; drag to place, <b>R</b> to rotate.</li>"+
      "<li><b>Door / Window / Opening</b> - press D / W, then click a wall.</li>"+
      "<li><b>See it in 3D</b> - the 3D view button; right-drag moves the light.</li>"+
      "<li><b>Save</b> - Cloud save keeps versions; work also autosaves locally.</li>"+
      "<li><b>Export</b> - PDF spec, DXF (CAD) or OBJ (3D).</li></ul>"+
      "<button id=\"obGo\" style=\"font:inherit;font-size:.74rem;letter-spacing:.1em;text-transform:uppercase;padding:.7rem 1.1rem;border:1px solid #17181b;background:#17181b;color:#fff;cursor:pointer\">Start designing</button>";
    ov.appendChild(box); document.body.appendChild(ov);
    function done(){ try{localStorage.setItem("eleve_onboarded","1");}catch(e){} ov.remove(); }
    box.querySelector("#obGo").addEventListener("click",done);
    ov.addEventListener("click",function(e){ if(e.target===ov) done(); });
  }
  function wire(){
    var s=document.getElementById("cloudSave"), m=document.getElementById("myProjects"), sh=document.getElementById("shareProj");
    if(s)s.addEventListener("click",cloudSave); if(m)m.addEventListener("click",myProjects); if(sh)sh.addEventListener("click",shareProj);
    var hb=document.createElement("button"); hb.textContent="? Tips";
    hb.style.cssText="position:fixed;left:1.2rem;bottom:1.1rem;z-index:1401;font:500 .72rem Inter,system-ui,sans-serif;letter-spacing:.06em;padding:.5rem .7rem;border:1px solid #17181b;background:rgba(255,255,255,.7);color:#17181b;cursor:pointer";
    hb.addEventListener("click",function(){ onboard(); });
    document.body.appendChild(hb);
    var q=null; try{ q=new URLSearchParams(location.search).get("share"); }catch(e){}
    if(q){ api("/shared/"+q,"GET").then(function(r){return r.ok?r.json():null;}).then(function(j){ if(j&&j.data&&B()){ B().load(j.data); toast("Viewing shared plan: "+(j.name||"")); } }).catch(function(){}); }
    else { var seen=null; try{seen=localStorage.getItem("eleve_onboarded");}catch(e){} if(!seen) setTimeout(onboard,600); offerRecovery(); }
  }
  if(document.readyState!=="loading") wire(); else document.addEventListener("DOMContentLoaded",wire);
})();
