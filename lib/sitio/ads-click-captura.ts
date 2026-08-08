/**
 * ATRIBUCIÓN DE GOOGLE ADS en el sitio público — la mitad del navegador.
 *
 * El problema que resuelve: el contacto ocurre en WhatsApp, fuera del sitio, así
 * que el clic del anuncio y la venta nunca se tocaban. Google terminaba pujando
 * hacia «alguien apretó el botón de WhatsApp», sin saber cuáles de esos clics
 * traían una mascota y por cuánto.
 *
 * Lo que hace este bloque, en dos tiempos:
 *   1. Si la URL trae gclid / gbraid / wbraid, lo manda a /api/ads/click y guarda
 *      el CÓDIGO corto que devuelve (90 días en localStorage — la ventana de
 *      atribución de Google es de 90, y una despedida se decide en días).
 *   2. Le agrega ese código al texto prellenado de todo link de WhatsApp, para
 *      que llegue con el primer mensaje del tutor. El webhook lo lee, lo borra
 *      del mensaje y le pega el teléfono al clic.
 *
 * Se reescribe también en el momento del clic, en fase de CAPTURA, porque el
 * widget flotante de WhatsApp inyecta su enlace después de que carga la página
 * (la misma razón por la que lib/sitio/ads-conversion.ts mide así).
 */

export const CLAVE_REF = 'aa_ads_ref'
export const DIAS_ATRIBUCION = 90

export function scriptCapturaAds(): string {
  return `<script>(function(){
var CLAVE='${CLAVE_REF}',MS=${DIAS_ATRIBUCION}*86400000;
function guardar(c){try{localStorage.setItem(CLAVE,JSON.stringify({c:c,t:Date.now()}))}catch(e){}}
function leer(){try{
  var v=JSON.parse(localStorage.getItem(CLAVE)||'null');
  if(!v||!v.c||(Date.now()-v.t)>MS)return null;
  return v.c;
}catch(e){return null}}

function esWhatsapp(href){
  href=(href||'').toLowerCase();
  return href.indexOf('wa.me/')>-1||href.indexOf('api.whatsapp.com')>-1||href.indexOf('web.whatsapp.com')>-1;
}

// Agrega [#CODIGO] al final del texto prellenado, una sola vez por enlace.
function marcar(a,codigo){
  try{
    if(!a||!esWhatsapp(a.getAttribute('href')||''))return;
    var u=new URL(a.href,location.href);
    var t=u.searchParams.get('text')||'';
    if(t.indexOf('[#')>-1)return;
    u.searchParams.set('text',(t?t+' ':'')+'[#'+codigo+']');
    a.setAttribute('href',u.toString());
  }catch(e){}
}
function marcarTodos(){
  var codigo=leer();if(!codigo)return;
  var links=document.getElementsByTagName('a');
  for(var i=0;i<links.length;i++)marcar(links[i],codigo);
}

// 1. ¿Venimos de un anuncio? Registrar y guardar el código.
try{
  var p=new URLSearchParams(location.search);
  var g=p.get('gclid'),gb=p.get('gbraid'),wb=p.get('wbraid');
  if(g||gb||wb){
    fetch('/api/ads/click',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({gclid:g,gbraid:gb,wbraid:wb,landing:location.pathname}),
      keepalive:true
    }).then(function(r){return r.json()}).then(function(j){
      if(j&&j.codigo){guardar(j.codigo);marcarTodos();}
    }).catch(function(){});
  }
}catch(e){}

// 2. Marcar los enlaces que ya están, y los que aparezcan después.
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',marcarTodos);
else marcarTodos();

document.addEventListener('click',function(ev){
  var codigo=leer();if(!codigo)return;
  var t=ev.target;
  var a=t&&t.closest?t.closest('a[href]'):null;
  if(a)marcar(a,codigo);
},true);
})();</script>`
}

/** Inserta el bloque antes de `</body>`. Idempotente. */
export function inyectarCapturaAds(html: string): string {
  if (html.includes(CLAVE_REF)) return html
  const bloque = scriptCapturaAds()
  const i = html.lastIndexOf('</body>')
  return i === -1 ? html + bloque : html.slice(0, i) + bloque + html.slice(i)
}
