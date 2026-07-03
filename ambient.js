/* Elevé — ambient.js: signature ambience for the simple pages.
   Injects (idempotently): interactive blueprint grid, custom square cursor,
   page-fade transitions. Pages with their own inline versions are untouched. */
(function(){
  "use strict";
  var reduce=window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;

  function ready(fn){ if(document.readyState!=="loading") fn(); else document.addEventListener("DOMContentLoaded",fn); }

  /* ---------- page fade ---------- */
  ready(function(){
    var pf=document.getElementById("pfade");
    if(!pf){
      pf=document.createElement("div"); pf.id="pfade";
      pf.style.cssText="position:fixed;inset:0;z-index:990;pointer-events:none;opacity:1;background:linear-gradient(135deg,#edeff2,#f4f5f7 45%,#e8eaee);transition:opacity .8s ease";
      if(reduce) pf.style.display="none";
      document.body.appendChild(pf);
      function show(){ pf.style.opacity="0"; }
      if(document.readyState==="complete") requestAnimationFrame(show);
      else window.addEventListener("load",function(){ requestAnimationFrame(show); });
      setTimeout(show,1200);
      document.addEventListener("click",function(e){
        var a=e.target.closest?e.target.closest("a"):null; if(!a) return;
        var href=a.getAttribute("href")||"";
        if(a.target==="_blank"||e.metaKey||e.ctrlKey||e.shiftKey) return;
        if(href===""||href.charAt(0)==="#"||/^mailto:|^tel:/.test(href)) return;
        if(/\.html(\?[^#]*)?(#.*)?$/.test(href)||/\/$/.test(href)){
          e.preventDefault(); pf.style.opacity="1";
          setTimeout(function(){ location.href=href; },720);
        }
      });
    }

    /* ---------- interactive grid ---------- */
    if(!document.getElementById("gridfx")){
      var cv=document.createElement("canvas"); cv.id="gridfx";
      cv.style.cssText="position:fixed;inset:0;z-index:0;width:100%;height:100%;pointer-events:none";
      document.body.insertBefore(cv,document.body.firstChild);
      var cx=cv.getContext("2d"), dpr=Math.min(2,devicePixelRatio||1), CELL=38, cw=0, ch=0;
      var fine=!(window.matchMedia&&matchMedia("(pointer:coarse)").matches);
      var tx=-9999,ty=-9999,mx=-9999,my=-9999,cells={},ripples=[];
      function size(){ cw=document.documentElement.clientWidth; ch=document.documentElement.clientHeight;
        cv.width=cw*dpr; cv.height=ch*dpr; cv.style.width=cw+"px"; cv.style.height=ch+"px"; cx.setTransform(dpr,0,0,dpr,0,0); }
      size(); addEventListener("resize",size);
      if(fine){
        addEventListener("mousemove",function(e){ tx=e.clientX; ty=e.clientY; });
        addEventListener("mouseout",function(){ tx=-9999; ty=-9999; });
        addEventListener("pointerdown",function(e){ ripples.push({x:e.clientX,y:e.clientY,t:performance.now()}); if(ripples.length>8) ripples.shift(); });
      }
      var HOVR=72;
      function ax(){ return (((cw/2-CELL/2)%CELL)+CELL)%CELL; }
      function ay(){ return (((-(scrollY||0))%CELL)+CELL)%CELL; }
      (function frame(){
        mx+=(tx-mx)*0.16; my+=(ty-my)*0.16;
        cx.clearRect(0,0,cw,ch);
        var ox=ax(), oy=ay();
        cx.strokeStyle="rgba(23,24,27,0.05)"; cx.lineWidth=1; cx.beginPath();
        for(var x=ox;x<=cw+1;x+=CELL){ var px=Math.round(x)+0.5; cx.moveTo(px,0); cx.lineTo(px,ch); }
        for(var y=oy;y<=ch+1;y+=CELL){ var py=Math.round(y)+0.5; cx.moveTo(0,py); cx.lineTo(cw,py); }
        cx.stroke();
        if(mx>-500){
          var g0x=Math.floor((mx-HOVR-ox)/CELL),g1x=Math.floor((mx+HOVR-ox)/CELL),
              g0y=Math.floor((my-HOVR-oy)/CELL),g1y=Math.floor((my+HOVR-oy)/CELL);
          for(var gy=g0y;gy<=g1y;gy++) for(var gx=g0x;gx<=g1x;gx++){
            var lx=gx*CELL+ox, ly=gy*CELL+oy, d=Math.hypot(lx+CELL/2-mx,ly+CELL/2-my);
            if(d<HOVR){ var inten=1-d/HOVR, k=gx+","+gy, c=cells[k]||(cells[k]={gx:gx,gy:gy,v:0}); if(inten>c.v) c.v=inten; }
          }
        }
        for(var key in cells){ var ce=cells[key]; ce.v*=0.965; if(ce.v<0.02){ delete cells[key]; continue; }
          var lx2=ce.gx*CELL+ox, ly2=ce.gy*CELL+oy;
          cx.fillStyle="rgba(23,24,27,"+(ce.v*0.09).toFixed(3)+")"; cx.fillRect(Math.round(lx2)+1,Math.round(ly2)+1,CELL-1,CELL-1); }
        var now=performance.now(),LIFE=1400,SPEED=0.3,BAND=50;
        for(var ri=ripples.length-1;ri>=0;ri--){ var rp=ripples[ri],age=now-rp.t;
          if(age>LIFE){ ripples.splice(ri,1); continue; }
          var rad=age*SPEED,fade=1-age/LIFE;
          var rx0=Math.floor((rp.x-rad-BAND-ox)/CELL),rx1=Math.floor((rp.x+rad+BAND-ox)/CELL),
              ry0=Math.floor((rp.y-rad-BAND-oy)/CELL),ry1=Math.floor((rp.y+rad+BAND-oy)/CELL);
          for(var ry=ry0;ry<=ry1;ry++) for(var rxx=rx0;rxx<=rx1;rxx++){
            var lx3=rxx*CELL+ox,ly3=ry*CELL+oy,dd=Math.abs(Math.hypot(lx3+CELL/2-rp.x,ly3+CELL/2-rp.y)-rad);
            if(dd<BAND){ var a=(1-dd/BAND)*fade*0.18;
              if(a>0.004){ cx.fillStyle="rgba(23,24,27,"+a.toFixed(3)+")"; cx.fillRect(Math.round(lx3)+1,Math.round(ly3)+1,CELL-1,CELL-1); } } }
        }
        requestAnimationFrame(frame);
      })();
    }

    /* ---------- custom square cursor ---------- */
    if(!document.getElementById("cur-dot") && window.matchMedia && matchMedia("(hover:hover) and (pointer:fine)").matches){
      var st=document.createElement("style");
      st.textContent="body{cursor:none}a,button,input,select,textarea,label,[role=button]{cursor:none}"+
        "#cur-dot{position:fixed;top:0;left:0;width:8px;height:8px;background:#17181b;z-index:1000;pointer-events:none;will-change:transform;transition:transform .08s linear,opacity .25s}"+
        "#cur-ring{position:fixed;top:0;left:0;width:28px;height:28px;border:1.5px solid #17181b;z-index:1000;pointer-events:none;will-change:transform,width,height;transition:width .26s cubic-bezier(.22,1,.36,1),height .26s cubic-bezier(.22,1,.36,1),background .2s,opacity .25s}"+
        "#cur-ring.hover{width:44px;height:44px;background:rgba(23,24,27,.05)}"+
        "#cur-ring.down{width:16px;height:16px;background:rgba(23,24,27,.12)}";
      document.head.appendChild(st);
      var d=document.createElement("div"); d.id="cur-dot";
      var r=document.createElement("div"); r.id="cur-ring";
      document.body.appendChild(d); document.body.appendChild(r);
      var mx2=innerWidth/2,my2=innerHeight/2,rx2=mx2,ry2=my2;
      function setT(el,x,y){ el.style.transform="translate("+x+"px,"+y+"px) translate(-50%,-50%)"; }
      setT(d,mx2,my2); setT(r,rx2,ry2);
      addEventListener("mousemove",function(e){ mx2=e.clientX; my2=e.clientY; setT(d,mx2,my2); });
      (function loop(){ rx2+=(mx2-rx2)*0.2; ry2+=(my2-ry2)*0.2; setT(r,rx2,ry2); requestAnimationFrame(loop); })();
      addEventListener("mousedown",function(){ r.classList.add("down"); });
      addEventListener("mouseup",function(){ r.classList.remove("down"); });
      var SEL="a,button,input,select,textarea,label,[role=button]";
      document.addEventListener("mouseover",function(e){ if(e.target.closest&&e.target.closest(SEL)) r.classList.add("hover"); });
      document.addEventListener("mouseout",function(e){ if(e.target.closest&&e.target.closest(SEL)) r.classList.remove("hover"); });
      document.documentElement.addEventListener("mouseleave",function(){ d.style.opacity=0; r.style.opacity=0; });
      document.documentElement.addEventListener("mouseenter",function(){ d.style.opacity=1; r.style.opacity=1; });
    }
  });
})();
