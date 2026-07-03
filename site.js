/* Elevé — privacy-friendly analytics beacon, cookie/consent banner, client error log.
   No cookies, no third parties, no PII. Analytics only after explicit consent. */
(function(){
  var base=(location.protocol==="http:"||location.protocol==="https:")?"":"http://localhost:4000";
  function send(ev){ try{ fetch(base+"/api/analytics",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({event:ev,page:location.pathname}),keepalive:true}).catch(function(){}); }catch(e){} }
  // client-side error reporting (helps catch physics/3D/audio breakage in the wild)
  window.addEventListener("error",function(e){ try{ fetch(base+"/api/log",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({msg:(e.message||"error")+" @ "+location.pathname}),keepalive:true}).catch(function(){}); }catch(x){} });
  /* anonymous live-presence heartbeat — powers the admin "who's on now" panel.
     No cookies, no PII: an ephemeral id in sessionStorage (gone when the tab closes), runs regardless of consent. */
  (function(){
    var p=location.pathname, area=/builder\.html/i.test(p)?"builder":(/portal\.html/i.test(p)?"portal":"site");
    var id; try{ id=sessionStorage.getItem("eleve_hb"); if(!id){ id=Math.random().toString(36).slice(2)+Date.now().toString(36); sessionStorage.setItem("eleve_hb",id); } }catch(e){ id=Math.random().toString(36).slice(2); }
    function beat(){ if(document.visibilityState==="hidden") return; try{ fetch(base+"/api/presence",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({id:id,area:area,path:p}),keepalive:true}).catch(function(){}); }catch(e){} }
    beat(); setInterval(beat,30000);
    document.addEventListener("visibilitychange",function(){ if(document.visibilityState==="visible") beat(); });
  })();
  var consent=null; try{ consent=localStorage.getItem("eleve_consent"); }catch(e){}
  if(consent==="yes"){ send("pageview"); return; }
  if(consent==="no") return;
  // banner
  function banner(){
    var b=document.createElement("div");
    b.setAttribute("role","dialog"); b.setAttribute("aria-label","Privacy");
    b.style.cssText="position:fixed;left:14px;right:14px;bottom:14px;z-index:1500;max-width:560px;margin:0 auto;background:rgba(246,247,249,.97);border:1px solid #17181b;padding:.85rem 1rem;display:flex;gap:.8rem;align-items:center;flex-wrap:wrap;font-family:Inter,system-ui,sans-serif;font-size:.8rem;color:#17181b;backdrop-filter:blur(6px)";
    b.innerHTML='<span style="flex:1;min-width:200px">We use privacy-first, cookie-free analytics to improve this site. No personal data, ever. <a href="/privacy.html" style="text-decoration:underline">Privacy</a>.</span>';
    function mk(t){ var x=document.createElement("button"); x.textContent=t; x.style.cssText="font:inherit;font-size:.72rem;letter-spacing:.06em;text-transform:uppercase;padding:.5rem .8rem;border:1px solid #17181b;cursor:pointer;background:"+(t==="Accept"?"#17181b":"transparent")+";color:"+(t==="Accept"?"#fff":"#17181b"); return x; }
    var yes=mk("Accept"), no=mk("Decline");
    yes.addEventListener("click",function(){ try{localStorage.setItem("eleve_consent","yes");}catch(e){} b.remove(); send("pageview"); });
    no.addEventListener("click",function(){ try{localStorage.setItem("eleve_consent","no");}catch(e){} b.remove(); });
    b.appendChild(yes); b.appendChild(no); document.body.appendChild(b);
  }
  if(document.readyState!=="loading") banner(); else document.addEventListener("DOMContentLoaded",banner);
})();
