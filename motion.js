/* Elevé — motion.js: shared animation engine.
   Split-line headlines, staggered reveals, magnetic hover, tilt, count-up,
   marquee loop, parallax, local time. Dependency-free, reduced-motion aware. */
(function(){
  "use strict";
  var reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  var fine = window.matchMedia && matchMedia("(hover:hover) and (pointer:fine)").matches;

  function ready(fn){ if(document.readyState!=="loading") fn(); else document.addEventListener("DOMContentLoaded",fn); }

  ready(function(){

    /* ---- film grain layer (idempotent) ---- */
    if(!document.querySelector(".e-grain") && !document.body.hasAttribute("data-no-grain")){
      var g=document.createElement("div"); g.className="e-grain"; g.setAttribute("aria-hidden","true");
      document.body.appendChild(g);
    }

    /* ---- split headlines into animated word masks ---- */
    document.querySelectorAll("[data-split]").forEach(function(el){
      if(el.__split) return; el.__split=true;
      var base=parseFloat(el.getAttribute("data-split-delay")||"0");
      var step=parseFloat(el.getAttribute("data-split-step")||"0.075");
      var i=0;
      function wrap(node){
        var parts=node.textContent.split(/(\s+)/), frag=document.createDocumentFragment();
        parts.forEach(function(p){
          if(!p) return;
          if(/^\s+$/.test(p)){ frag.appendChild(document.createTextNode(" ")); return; }
          var w=document.createElement("span"); w.className="e-w";
          var s=document.createElement("span"); s.textContent=p; s.style.setProperty("--d",(base+(i++)*step)+"s");
          w.appendChild(s); frag.appendChild(w);
        });
        node.parentNode.replaceChild(frag,node);
      }
      Array.prototype.slice.call(el.childNodes).forEach(function(n){
        if(n.nodeType===3 && n.textContent.trim()) wrap(n);
        else if(n.nodeType===1 && !n.classList.contains("e-w")){
          Array.prototype.slice.call(n.childNodes).forEach(function(nn){
            if(nn.nodeType===3 && nn.textContent.trim()) wrap(nn);
          });
        }
      });
    });

    /* ---- stagger children ---- */
    document.querySelectorAll("[data-stagger]").forEach(function(p){
      var step=parseFloat(p.getAttribute("data-stagger")||"0.08");
      Array.prototype.forEach.call(p.children,function(c,i){ c.style.setProperty("--d",(i*step).toFixed(3)+"s"); });
    });

    /* ---- reveal observer ---- */
    var toWatch=document.querySelectorAll("[data-split],[data-reveal],.e-rule[data-draw]");
    if("IntersectionObserver" in window && toWatch.length){
      var io=new IntersectionObserver(function(es){
        es.forEach(function(e){
          if(e.isIntersecting){ e.target.classList.add("is-in"); io.unobserve(e.target); }
        });
      },{threshold:.14,rootMargin:"0px 0px -6% 0px"});
      toWatch.forEach(function(el){ io.observe(el); });
    } else { toWatch.forEach(function(el){ el.classList.add("is-in"); }); }

    /* ---- fail-safe: content must NEVER stay hidden.
       1) Anything already in the viewport gets .is-in shortly after load
          (covers throttled tabs where IO/transitions stall).
       2) A hard override class then snaps any still-pending reveal visible. ---- */
    setTimeout(function(){
      toWatch.forEach(function(el){
        if(el.classList.contains("is-in")) return;
        var r=el.getBoundingClientRect();
        if(r.top<innerHeight && r.bottom>0) el.classList.add("is-in");
      });
    },1400);
    setTimeout(function(){
      document.documentElement.classList.add("e-settled");
      toWatch.forEach(function(el){ el.classList.add("is-in"); });
    },3800);

    /* ---- count-up numbers ---- */
    var nums=document.querySelectorAll("[data-countup]");
    if(nums.length && "IntersectionObserver" in window){
      var nio=new IntersectionObserver(function(es){
        es.forEach(function(e){
          if(!e.isIntersecting) return; nio.unobserve(e.target);
          var el=e.target, to=parseFloat(el.getAttribute("data-countup"))||0,
              suf=el.getAttribute("data-suffix")||"", dur=1400, t0=performance.now();
          if(reduce){ el.textContent=to+suf; return; }
          (function step(now){
            var k=Math.min(1,(now-t0)/dur), v=Math.round(to*(1-Math.pow(1-k,3)));
            el.textContent=v+suf; if(k<1) requestAnimationFrame(step);
          })(t0);
        });
      },{threshold:.5});
      nums.forEach(function(el){ nio.observe(el); });
    }

    /* ---- marquee: duplicate track once for a seamless loop ---- */
    document.querySelectorAll(".e-marquee-track").forEach(function(t){
      if(t.__dup) return; t.__dup=true;
      t.innerHTML=t.innerHTML+t.innerHTML;
    });

    /* ---- magnetic hover ---- */
    if(fine && !reduce){
      document.querySelectorAll("[data-magnetic]").forEach(function(el){
        var str=parseFloat(el.getAttribute("data-magnetic")||"0.24");
        el.style.willChange="transform";
        el.addEventListener("mousemove",function(e){
          var r=el.getBoundingClientRect();
          var x=(e.clientX-r.left-r.width/2)*str, y=(e.clientY-r.top-r.height/2)*str;
          el.style.transform="translate("+x.toFixed(1)+"px,"+y.toFixed(1)+"px)";
        });
        el.addEventListener("mouseleave",function(){
          el.style.transition="transform .5s cubic-bezier(.22,1,.36,1)";
          el.style.transform="";
          setTimeout(function(){ el.style.transition=""; },500);
        });
      });

      /* ---- card tilt ---- */
      document.querySelectorAll("[data-tilt]").forEach(function(el){
        var max=parseFloat(el.getAttribute("data-tilt")||"5");
        el.style.transformStyle="preserve-3d";
        el.addEventListener("mousemove",function(e){
          var r=el.getBoundingClientRect();
          var rx=((e.clientY-r.top)/r.height-.5)*-2*max, ry=((e.clientX-r.left)/r.width-.5)*2*max;
          el.style.transform="perspective(900px) rotateX("+rx.toFixed(2)+"deg) rotateY("+ry.toFixed(2)+"deg)";
        });
        el.addEventListener("mouseleave",function(){
          el.style.transition="transform .6s cubic-bezier(.22,1,.36,1)";
          el.style.transform="";
          setTimeout(function(){ el.style.transition=""; },600);
        });
      });
    }

    /* ---- gentle parallax (works with transform-scroll pages too) ---- */
    var pEls=Array.prototype.slice.call(document.querySelectorAll("[data-parallax]"));
    if(pEls.length && !reduce){
      (function loop(){
        var vh=innerHeight;
        pEls.forEach(function(el){
          var r=el.getBoundingClientRect();
          if(r.bottom<0||r.top>vh) return;
          var f=parseFloat(el.getAttribute("data-parallax"))||.14;
          var c=(r.top+r.height/2-vh/2)/vh;
          el.style.transform="translate3d(0,"+(c*f*100).toFixed(2)+"px,0)";
        });
        requestAnimationFrame(loop);
      })();
    }

    /* ---- footer year + local studio time ---- */
    document.querySelectorAll("[data-e-year]").forEach(function(el){ el.textContent=new Date().getFullYear(); });
    var tEls=document.querySelectorAll("[data-e-time]");
    if(tEls.length){
      function tick(){
        var s;
        try{ s=new Intl.DateTimeFormat("en-GB",{hour:"2-digit",minute:"2-digit",timeZone:"Europe/Lisbon"}).format(new Date()); }
        catch(e){ var d=new Date(); s=("0"+d.getHours()).slice(-2)+":"+("0"+d.getMinutes()).slice(-2); }
        tEls.forEach(function(el){ el.textContent="Lisbon "+s; });
      }
      tick(); setInterval(tick,30000);
    }
  });
})();
