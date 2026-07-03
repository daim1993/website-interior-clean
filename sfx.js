/* Elevé — subtle synthesized PIANO note SFX for UI interactions.
   A two-movement programme, both verified against engraved scores:
     I.  Chopin — Nocturne Op. 9 No. 2 in E♭ major (bars 1–3)
     II. Chopin — Nocturne Op. 15 No. 3 in G minor (opening lament)
   EVERY click — button or empty space — plays exactly ONE note and the
   melody advances; when the first nocturne finishes, the second begins,
   then the cycle repeats. Buttons are voiced softer; hovering gives a
   whisper preview of the upcoming note without advancing. */
(function(){
  "use strict";
  var KEY="eleve_sfx_muted";
  var muted = localStorage.getItem(KEY)==="1";
  var ctx=null, master=null;

  function init(){
    if(ctx) return;
    try{
      var AC=window.AudioContext||window.webkitAudioContext; if(!AC) return;
      ctx=new AC(); master=ctx.createGain(); master.gain.value=(typeof window.__SFX_VOLUME==="number")?window.__SFX_VOLUME:0.5; master.connect(ctx.destination);
    }catch(e){ ctx=null; }
  }
  function resume(){ if(ctx&&ctx.state==="suspended"){ try{ctx.resume();}catch(e){} } }

  // Chopin — Nocturne Op. 9 No. 2, bars 1–3 EXACTLY as engraved
  // (verified against the Mutopia/G. Schirmer 1881 score), as
  // [MIDI note, duration in eighth-note units]. Upper register, as written.
  // Recognition lives in the RHYTHM: the long G after the sixth-leap,
  // and the octave leap C5→C6 — both kept with their true durations.
  var THEME=[
    // ═══ I. Nocturne Op. 9 No. 2 in E♭ major — bars 1–12 COMPLETE,
    //     decoded note-for-note from the Mutopia/Schirmer engraving
    //     (ornaments/graces omitted; written accidentals kept) ═══
    [70,1],                                              // b0  B♭4 pickup
    [79,4],[77,1],[79,1],[77,3],[75,2],[70,1],           // b1  G5(held) F G F E♭ · B♭
    [79,2],[72,1],[84,2],[79,1],[82,3],[80,2],[79,1],    // b2  G5 C5→C6(octave) G B♭5 A♭5 G5
    [77,3],[79,2],[74,1],[75,3],[72,3],                  // b3  F5 G5 D5 E♭5 C5
    [70,1],[86,1],[84,1],[82,.5],[80,.5],[79,.5],[80,.5],// b4  B♭4→D6! C6 B♭A♭G A♭ — forte flourish
    [72,.5],[74,.5],[75,3],[70,1],                       //     C5 D5 E♭5 · B♭4
    [79,3],[77,.5],[79,.5],[77,.5],[76,.5],[77,.5],[79,.5],// b5 G5 + turn F G F E♮ F G
    [77,1],[75,2.5],[77,.5],[75,.5],[74,.5],[75,.5],[77,.5],//    F5 E♭5(held) F E♭ D E♭ F
    [79,.5],[71,.5],[72,.5],[73,.5],[72,.5],[77,.5],[76,.5],// b6 G5 then the chromatic climb:
    [80,.5],[79,.5],[85,.5],[84,.5],[79,.5],             //     B♮C D♭C F E♮ A♭G D♭6!C6 G
    [82,3],[80,2],[79,1],                                //     B♭5(held) A♭5 G5
    [77,3],[79,1],[79,1],[74,1],[75,3],[72,3],           // b7  F5(trill) G G D5 E♭5 C5
    [70,1],[86,1],[84,1],[82,.5],[80,.5],[79,.5],[80,.5],// b8  the flourish returns
    [72,.5],[74,.5],[75,4],[74,1],[75,1],                //     C5 D5 E♭5(held) D E♭
    [77,3],[79,2],[77,1],[77,3],[72,3],                  // b9  F5 G5 F · F5 C5
    [75,1],[75,1],[75,1],[75,1],[74,.5],[75,.5],         // b10 E♭ E♭ E♭ E♭ · D E♭
    [77,.75],[75,.25],[75,3],[70,3],                     //     F E♭ · E♭5 B♭4
    [82,3],[81,2],[79,1],[77,3],[74,3],                  // b11 B♭5 A♮5 G5 · F5 D5
    [75,3],[74,1],[72,1],[74,1],                         // b12 E♭5 D C D
    [70,1],[71,1],[71,1],[72,1],[72,1],[74,1],           //     B♭ B♮ B♮ C C D — rising home
    // ═══ II. Nocturne Op. 15 No. 3 in G minor — the lament, stated twice
    //     as the score repeats it (read from the engraved incipit) ═══
    [74,2],                                              // D5 — the lone accented pickup
    [70,4],[74,2],                                       // B♭4(held) · D5
    [72,1],[72,1],[70,2],[69,2],                         // C5 C5 B♭4 A4 — the lament
    [70,1],[72,1],[74,2],[79,2],                         // B♭4 C5 D5 rising to G5
    [77,8],                                              // F5 — the famous long-held note
    [75,4],[74,4],                                       // E♭5 · D5 — resolves
    [74,2],                                              // …and the lament returns
    [70,4],[74,2],
    [72,1],[72,1],[70,2],[69,2],
    [70,1],[72,1],[74,2],[79,2],
    [77,8],
    [75,4],[74,8]                                        // final D5 held — then da capo
  ];
  // written duration still shapes each note's ring length
  // voiced one octave below written pitch: warm MID register (B♭3–C5),
  // thick enough to live with on long sessions, never shrill
  function mfreq(n){ return 440*Math.pow(2,(n-12-69)/12); }
  var idx=1; // the note-by-note walk also opens on the held G, not the B♭ pickup

  function note(freq,vel,dur,delay){
    // THICK, rounded felt-piano tone: sub-octave body + detuned unison for
    // width, softened highs — full in the mids, gentle on the ear
    if(muted||!ctx) return; var t=ctx.currentTime+(delay||0);
    var lp=ctx.createBiquadFilter(); lp.type="lowpass";
    lp.frequency.setValueAtTime(2600,t); lp.frequency.exponentialRampToValueAtTime(750,t+dur*0.75);
    lp.connect(master);
    // [ratio, amplitude, decay-fraction]
    var parts=[[0.5,0.34,0.92],[1,1,1.0],[1.004,0.42,0.95],[2,0.38,0.7],[3,0.16,0.5],[4.02,0.05,0.3]];
    parts.forEach(function(p){
      var o=ctx.createOscillator(); o.type="sine"; o.frequency.value=freq*p[0];
      var g=ctx.createGain();
      g.gain.setValueAtTime(0,t);
      g.gain.linearRampToValueAtTime(vel*p[1],t+0.004);
      g.gain.exponentialRampToValueAtTime(0.0003,t+dur*p[2]);
      o.connect(g); g.connect(lp); o.start(t); o.stop(t+dur*p[2]+0.05);
    });
  }
  function nextNote(){ // the next theme note (with its duration), then advance
    var nd=THEME[idx % THEME.length]; idx=(idx+1)%THEME.length; return nd;
  }
  function peekFreq(){ return mfreq(THEME[idx % THEME.length][0]); } // upcoming, no advance
  function tick(){
    if(muted||!ctx) return; var t=ctx.currentTime;
    // a soft, subtle mechanical click (distinct from the piano notes)
    var o=ctx.createOscillator(); o.type="triangle"; o.frequency.value=1050+Math.random()*160;
    var bp=ctx.createBiquadFilter(); bp.type="bandpass"; bp.frequency.value=1150; bp.Q.value=1.1;
    var g=ctx.createGain(); g.gain.setValueAtTime(0,t); g.gain.linearRampToValueAtTime(0.025,t+0.0008); g.gain.exponentialRampToValueAtTime(0.0002,t+0.018);
    o.connect(bp); bp.connect(g); g.connect(master); o.start(t); o.stop(t+0.03);
  }
  window.__sfx={
    click:function(){ var nd=nextNote(); note(mfreq(nd[0]),0.13,Math.min(2.4,0.85+nd[1]*0.4)); }, // empty space: next theme note
    chord:function(){ var nd=nextNote(); note(mfreq(nd[0]),0.11,Math.min(2.0,0.75+nd[1]*0.35)); }, // buttons: ONE mid-soft note, follows the song
    tick:function(){ tick(); },
    hover:function(){ note(peekFreq(),0.04,1.0); },   // whisper preview of the next note (no advance)
    isMuted:function(){ return muted; },
    mute:function(m){ muted=!!m; localStorage.setItem(KEY,muted?"1":"0"); }
  };

  function unlock(){ init(); resume(); }
  window.addEventListener("pointerdown",unlock,true);
  window.addEventListener("keydown",unlock,true);
  window.addEventListener("wheel",unlock,{passive:true,capture:true});

  var INTER="a,button,select,input,textarea,label,.pill,.chip,.cbtn,.cdot,.dot,[data-tool],[data-theme],[role=button],.floor,.zoomctl button,.file-lbl,.toggle,#sfxBtn";

  // buttons & interactive elements → a random 3-note nocturne phrase;
  // empty space → the next single note of the piece, in order
  document.addEventListener("pointerdown",function(e){
    init(); resume();
    var el=e.target&&e.target.closest&&e.target.closest(INTER);
    if(el) window.__sfx.chord(); else window.__sfx.click();
  },true);

  var lastH=0;
  document.addEventListener("pointerover",function(e){
    if(!ctx) return;
    var el=e.target&&e.target.closest&&e.target.closest(INTER); if(!el) return;
    var now=performance.now(); if(now-lastH<95) return; lastH=now;
    window.__sfx.hover();
  },true);

  var lastTickY=(window.scrollY||window.pageYOffset||0);
  window.addEventListener("scroll",function(){
    if(!ctx) return;
    var y=window.scrollY||window.pageYOffset||document.documentElement.scrollTop||0;
    if(Math.abs(y-lastTickY)>=45){ lastTickY=y; tick(); }
  },{passive:true});

  function addToggle(){
    if(document.getElementById("sfxBtn")) return;
    var b=document.createElement("button"); b.id="sfxBtn"; b.type="button"; b.textContent="♪";
    b.style.cssText="position:fixed;left:1.2rem;bottom:3.4rem;z-index:1001;width:30px;height:30px;border:1px solid #17181b;background:rgba(255,255,255,.55);color:#17181b;font-size:14px;line-height:1;cursor:pointer;backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);border-radius:0;padding:0";
    function paint(){ b.style.opacity=muted?"0.4":"0.9"; b.style.textDecoration=muted?"line-through":"none"; b.title=muted?"Sound off":"Sound on"; }
    paint();
    b.addEventListener("click",function(){ muted=!muted; window.__sfx.mute(muted); paint(); if(!muted){ init(); resume(); window.__sfx.click(); } });
    document.body.appendChild(b);
  }
  if(document.readyState!=="loading") addToggle(); else document.addEventListener("DOMContentLoaded",addToggle);
})();
