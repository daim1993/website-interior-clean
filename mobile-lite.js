(function(){
  "use strict";
  var mq = window.matchMedia || function(){ return { matches:false }; };
  var small = mq("(max-width: 760px)").matches;
  var coarse = mq("(pointer: coarse)").matches;
  var saveData = !!(navigator.connection && navigator.connection.saveData);
  var lite = small || coarse || saveData;
  if(lite) document.documentElement.classList.add("mobile-lite");
  window.__saveData = saveData;
  try{
    Object.defineProperty(window, "__mobileLite", {
      configurable:true,
      get:function(){ return lite || document.documentElement.classList.contains("mobile-lite"); }
    });
  }catch(e){ window.__mobileLite = lite; }
})();
