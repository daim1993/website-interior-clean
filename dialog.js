/* Elevé — dialog.js: branded replacements for alert / confirm / prompt.
   Monochrome, squared corners, Playfair titles, mono buttons, corner ticks.
   Promise-based API on window.eleveUI. Esc cancels · Enter confirms. */
(function(){
  "use strict";

  var CSS=""+
  "#e-dlg-ov{position:fixed;inset:0;z-index:2600;background:rgba(23,24,27,.44);"+
    "-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);display:flex;align-items:center;justify-content:center;"+
    "padding:1.2rem;opacity:0;transition:opacity .22s ease}"+
  "#e-dlg-ov.on{opacity:1}"+
  "#e-dlg-ov,#e-dlg-ov *{cursor:auto!important;box-sizing:border-box}"+
  "#e-dlg-ov button,#e-dlg-ov .e-dlg-item{cursor:pointer!important}"+
  ".e-dlg{position:relative;width:min(430px,94vw);background:#f6f7f9;border:1px solid #17181b;"+
    "box-shadow:10px 10px 0 rgba(23,24,27,.14);padding:1.7rem 1.6rem 1.4rem;"+
    "font:400 .92rem/1.65 Inter,system-ui,sans-serif;color:#17181b;border-radius:0;"+
    "transform:translateY(14px);opacity:0;transition:transform .3s cubic-bezier(.22,1,.36,1),opacity .25s ease}"+
  "#e-dlg-ov.on .e-dlg{transform:none;opacity:1}"+
  ".e-dlg::before,.e-dlg::after{content:'';position:absolute;width:13px;height:13px;border:0 solid rgba(23,24,27,.6);pointer-events:none}"+
  ".e-dlg::before{left:7px;top:7px;border-left-width:1px;border-top-width:1px}"+
  ".e-dlg::after{right:7px;bottom:7px;border-right-width:1px;border-bottom-width:1px}"+
  ".e-dlg .t{font-family:'Playfair Display',Georgia,serif;font-size:1.35rem;font-weight:600;line-height:1.2;margin:0 0 .55rem}"+
  ".e-dlg .t em{font-style:italic;font-weight:500}"+
  ".e-dlg .k{font-family:'JetBrains Mono',ui-monospace,monospace;font-size:.58rem;letter-spacing:.28em;text-transform:uppercase;color:#8b8f97;margin:0 0 .8rem}"+
  ".e-dlg .m{color:#3c3e44;margin:0 0 1.25rem;white-space:pre-line;overflow-wrap:break-word}"+
  ".e-dlg input[type=text],.e-dlg input[type=password],.e-dlg input[type=email]{width:100%;font:inherit;font-size:.98rem;color:#17181b;"+
    "background:transparent;border:none;border-bottom:1px solid rgba(23,24,27,.35);padding:.55rem 0;outline:none;margin:-.4rem 0 1.35rem;border-radius:0}"+
  ".e-dlg input:focus{border-bottom-color:#17181b}"+
  ".e-dlg .row{display:flex;gap:.6rem;justify-content:flex-end;flex-wrap:wrap}"+
  ".e-dlg .b{font-family:'JetBrains Mono',ui-monospace,monospace;font-size:.64rem;font-weight:500;letter-spacing:.16em;"+
    "text-transform:uppercase;padding:.68rem 1.05rem;border:1px solid #17181b;background:transparent;color:#17181b;transition:.2s;border-radius:0}"+
  ".e-dlg .b:hover{background:#17181b;color:#fff}"+
  ".e-dlg .b.solid{background:#17181b;color:#fff}"+
  ".e-dlg .b.solid:hover{background:#000;box-shadow:0 8px 18px rgba(23,24,27,.25)}"+
  ".e-dlg .list{display:flex;flex-direction:column;gap:.4rem;margin:0 0 1.25rem;max-height:46vh;overflow:auto}"+
  ".e-dlg .e-dlg-item{display:flex;justify-content:space-between;gap:.8rem;align-items:baseline;text-align:left;width:100%;"+
    "font:inherit;font-size:.88rem;color:#17181b;background:#fff;border:1px solid #d7d9de;padding:.7rem .8rem;transition:.18s;border-radius:0}"+
  ".e-dlg .e-dlg-item:hover{border-color:#17181b;background:#17181b;color:#fff}"+
  ".e-dlg .e-dlg-item .no{font-family:'JetBrains Mono',ui-monospace,monospace;font-size:.6rem;letter-spacing:.1em;opacity:.6}"+
  "#e-toast{position:fixed;left:50%;bottom:22px;transform:translateX(-50%) translateY(8px);z-index:2700;background:#17181b;color:#fff;"+
    "font:500 .78rem/1 Inter,system-ui,sans-serif;letter-spacing:.04em;padding:.75rem 1.05rem;opacity:0;transition:.3s;pointer-events:none;border-radius:0}"+
  "#e-toast.on{opacity:1;transform:translateX(-50%)}"+
  "@media(prefers-reduced-motion:reduce){#e-dlg-ov,.e-dlg,#e-toast{transition:none}}";

  function ensureCSS(){ if(document.getElementById("e-dlg-css"))return;
    var s=document.createElement("style"); s.id="e-dlg-css"; s.textContent=CSS; document.head.appendChild(s); }

  function esc(s){ return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }

  function open(build){
    ensureCSS();
    return new Promise(function(resolve){
      var prev=document.activeElement;
      var ov=document.createElement("div"); ov.id="e-dlg-ov"; ov.setAttribute("role","dialog"); ov.setAttribute("aria-modal","true");
      var box=document.createElement("div"); box.className="e-dlg"; ov.appendChild(box);
      var api={ close:function(val){
        ov.classList.remove("on");
        window.removeEventListener("keydown",onKey,true);
        setTimeout(function(){ ov.remove(); if(prev&&prev.focus)try{prev.focus();}catch(e){} },200);
        resolve(val);
      }};
      var onKey=function(e){
        if(e.key==="Escape"){ e.preventDefault(); e.stopPropagation(); api.close(api.escVal); }
        else if(e.key==="Enter" && api.onEnter){ e.preventDefault(); e.stopPropagation(); api.onEnter(); }
      };
      build(box,api);
      window.addEventListener("keydown",onKey,true);
      ov.addEventListener("mousedown",function(e){ if(e.target===ov) api.close(api.escVal); });
      document.body.appendChild(ov);
      requestAnimationFrame(function(){ requestAnimationFrame(function(){ ov.classList.add("on"); if(api.focus)api.focus(); }); });
    });
  }

  function head(box,opts,fallbackTitle){
    return "<p class='k'>Elevé</p>"+
           "<h3 class='t'>"+(opts&&opts.title?esc(opts.title):fallbackTitle)+"</h3>";
  }

  var eleveUI={
    alert:function(msg,opts){ opts=opts||{};
      return open(function(box,api){
        box.innerHTML=head(box,opts,"Notice")+"<p class='m'>"+esc(msg)+"</p>"+
          "<div class='row'><button class='b solid' data-ok>"+esc(opts.ok||"OK")+"</button></div>";
        var ok=box.querySelector("[data-ok]");
        ok.addEventListener("click",function(){api.close(undefined);});
        api.escVal=undefined; api.onEnter=function(){api.close(undefined);}; api.focus=function(){ok.focus();};
      });
    },
    confirm:function(msg,opts){ opts=opts||{};
      return open(function(box,api){
        box.innerHTML=head(box,opts,"Please confirm")+"<p class='m'>"+esc(msg)+"</p>"+
          "<div class='row'><button class='b' data-no>"+esc(opts.cancel||"Cancel")+"</button>"+
          "<button class='b solid' data-ok>"+esc(opts.ok||"Confirm")+"</button></div>";
        box.querySelector("[data-no]").addEventListener("click",function(){api.close(false);});
        var ok=box.querySelector("[data-ok]");
        ok.addEventListener("click",function(){api.close(true);});
        api.escVal=false; api.onEnter=function(){api.close(true);}; api.focus=function(){ok.focus();};
      });
    },
    prompt:function(msg,opts){ opts=opts||{};
      return open(function(box,api){
        box.innerHTML=head(box,opts,"Your input")+"<p class='m' style='margin-bottom:.9rem'>"+esc(msg)+"</p>"+
          "<input type='"+(opts.type==="password"?"password":(opts.type==="email"?"email":"text"))+"' "+
          (opts.readonly?"readonly ":"")+"value='"+esc(opts.value||"")+"' placeholder='"+esc(opts.placeholder||"")+"' />"+
          "<div class='row'><button class='b' data-no>"+esc(opts.cancel||"Cancel")+"</button>"+
          "<button class='b solid' data-ok>"+esc(opts.ok||"OK")+"</button></div>";
        var inp=box.querySelector("input");
        box.querySelector("[data-no]").addEventListener("click",function(){api.close(null);});
        box.querySelector("[data-ok]").addEventListener("click",function(){api.close(inp.value);});
        api.escVal=null; api.onEnter=function(){api.close(inp.value);};
        api.focus=function(){ inp.focus(); if(opts.readonly||opts.selectAll)try{inp.select();}catch(e){} };
      });
    },
    choose:function(msg,items,opts){ opts=opts||{};
      return open(function(box,api){
        var rows=(items||[]).map(function(it,i){
          return "<button class='e-dlg-item' data-i='"+i+"'><span>"+esc(it)+"</span><span class='no'>"+String(i+1).padStart(2,"0")+"</span></button>";
        }).join("");
        box.innerHTML=head(box,opts,"Choose")+"<p class='m' style='margin-bottom:.9rem'>"+esc(msg)+"</p>"+
          "<div class='list'>"+rows+"</div>"+
          "<div class='row'><button class='b' data-no>"+esc(opts.cancel||"Cancel")+"</button></div>";
        box.querySelector("[data-no]").addEventListener("click",function(){api.close(null);});
        Array.prototype.forEach.call(box.querySelectorAll(".e-dlg-item"),function(b){
          b.addEventListener("click",function(){api.close(parseInt(b.getAttribute("data-i"),10));});
        });
        api.escVal=null; api.focus=function(){ var f=box.querySelector(".e-dlg-item"); if(f)f.focus(); };
      });
    },
    toast:function(msg,ms){
      ensureCSS();
      var t=document.getElementById("e-toast");
      if(!t){ t=document.createElement("div"); t.id="e-toast"; document.body.appendChild(t); }
      t.textContent=msg; clearTimeout(t.__h);
      requestAnimationFrame(function(){ t.classList.add("on"); });
      t.__h=setTimeout(function(){ t.classList.remove("on"); }, ms||2400);
    }
  };
  window.eleveUI=eleveUI;
})();
