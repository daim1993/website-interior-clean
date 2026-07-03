/* Elevé — content apply + backend sync (public pages)
   Applies published CMS content to [data-cms] / [data-cms-img], and pulls the
   latest from the backend when reachable. Falls back to localStorage offline. */
(function(){
  var KEY="eleve_cms";
  var base=(location.protocol==="http:"||location.protocol==="https:")?"":"http://localhost:4000";
  var d; try{ d=JSON.parse(localStorage.getItem(KEY)||"{}"); }catch(e){ d={}; }
  d.text=d.text||{}; d.img=d.img||{}; d.gallery=d.gallery||{};
  window.__CMS=d;

  function safeImageUrl(u){
    u=String(u||"").trim();
    if(!u || /[\r\n"'()\\]/.test(u)) return "";
    if(/^data:image\/(?:png|jpe?g|webp|gif);base64,[a-z0-9+/=]+$/i.test(u)) return u;
    if(/^blob:https?:\/\//i.test(u) || /^https?:\/\/[^\s]+$/i.test(u)) return u;
    if(/^\/?[A-Za-z0-9._~/%-]+\.(?:png|jpe?g|webp|gif|svg)$/i.test(u)) return u;
    return "";
  }
  function apply(){
    document.querySelectorAll("[data-cms]").forEach(function(el){ var k=el.getAttribute("data-cms"); var v=d.text[k]; if(v!=null&&v!=="") el.textContent=v; });
    document.querySelectorAll("[data-cms-img]").forEach(function(el){ var k=el.getAttribute("data-cms-img"); var u=safeImageUrl(d.img[k]); if(u){ el.style.backgroundImage='url("'+u+'")'; el.style.backgroundSize="cover"; el.style.backgroundPosition="center"; } });
  }
  if(document.readyState!=="loading") apply(); else document.addEventListener("DOMContentLoaded",apply);

  /* pull latest published content from the backend; if newer, cache + refresh once */
  try{
    fetch(base+"/api/content",{cache:"no-store"})
      .then(function(r){ return r.ok?r.json():null; })
      .then(function(j){
        if(!j||!j.content) return;
        /* Only take the server copy when it is at least as new as what's cached here.
           This preserves unpublished "Apply" edits made in the CMS on this same browser
           (they carry a newer __ts) instead of clobbering them with older published content. */
        var srvTs=+j.content.__ts||0, localTs=0;
        try{ localTs=+(JSON.parse(localStorage.getItem(KEY)||"{}").__ts)||0; }catch(e){}
        if(srvTs<localTs) return;
        var inc=JSON.stringify(j.content), cur=localStorage.getItem(KEY)||"{}";
        if(inc!==cur){
          localStorage.setItem(KEY,inc);
          if(!sessionStorage.getItem("eleve_srv_refreshed")){ sessionStorage.setItem("eleve_srv_refreshed","1"); location.reload(); }
        }
      })
      .catch(function(){ /* offline / no server → use cached localStorage */ });
  }catch(e){}
})();
