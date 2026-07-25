/**
 * Script cliente que mide la velocidad REAL de cada visita al sitio público y la
 * manda a /api/web-vitals (ver lib/web-vitals.ts para el porqué de medir nosotros).
 *
 * Diseño:
 *  - `PerformanceObserver` nativo, sin librerías: cero peso agregado de red.
 *  - Se envía UNA sola vez, cuando la pestaña se oculta o se descarga, con
 *    `sendBeacon` (no bloquea la navegación ni pierde el dato al salir).
 *  - Si el navegador no soporta alguna métrica, se manda lo que haya.
 */

export function scriptMedicionVelocidad(): string {
  return `<script>(function(){
try{
if(!('PerformanceObserver' in window))return;
var m={lcp:null,cls:0,inp:null,ttfb:null},enviado=false;
try{var nav=performance.getEntriesByType('navigation')[0];if(nav)m.ttfb=Math.round(nav.responseStart);}catch(e){}
function obs(tipo,cb,extra){
  try{var o=new PerformanceObserver(function(l){l.getEntries().forEach(cb)});
      o.observe(Object.assign({type:tipo,buffered:true},extra||{}));return o}catch(e){return null}
}
obs('largest-contentful-paint',function(e){m.lcp=Math.round(e.startTime)});
obs('layout-shift',function(e){if(!e.hadRecentInput)m.cls+=e.value});
// INP aproximado: la interaccion mas lenta de la visita (duracion del evento).
obs('event',function(e){if(e.interactionId){var d=Math.round(e.duration);if(m.inp===null||d>m.inp)m.inp=d}},{durationThreshold:40});
function enviar(){
  if(enviado)return;enviado=true;
  var datos={
    ruta:location.pathname.slice(0,120),
    dispositivo:(window.innerWidth<768||/Mobi|Android|iPhone|iPad/i.test(navigator.userAgent))?'movil':'escritorio',
    fuente:/[?&](gclid|gbraid|wbraid|fbclid|utm_)/i.test(location.search)?'ads':'organico',
    lcp:m.lcp,cls:m.cls?Math.round(m.cls*1000)/1000:0,inp:m.inp,ttfb:m.ttfb
  };
  if(datos.lcp===null&&datos.ttfb===null)return;
  try{
    var blob=new Blob([JSON.stringify(datos)],{type:'application/json'});
    if(navigator.sendBeacon)navigator.sendBeacon('/api/web-vitals',blob);
    else fetch('/api/web-vitals',{method:'POST',body:JSON.stringify(datos),headers:{'Content-Type':'application/json'},keepalive:true});
  }catch(e){}
}
addEventListener('visibilitychange',function(){if(document.visibilityState==='hidden')enviar()});
addEventListener('pagehide',enviar);
}catch(e){}
})();</script>`
}
