/**
 * Conversiones de Google Ads en el sitio público (crematorioalmaanimal.cl).
 *
 * ⚠️ POR QUÉ EXISTE ESTE ARCHIVO (incidente 2026-07-14):
 * En el sitio de Webflow, las conversiones de Ads las disparaba un widget/GTM
 * atado al DOM de Webflow. Al pasar el dominio a la app (cutover del 14-jul) las
 * plantillas se copiaron con GTM/GA4/Meta, pero el tag de CONVERSIONES de Google
 * Ads (AW-…) se quedó afuera: desde el 15-jul las conversiones de la cuenta
 * cayeron de ~5/día a 0–2 con los clics intactos, y el Smart Bidding quedó
 * repartiendo el presupuesto con una señal muerta.
 *
 * La solución NO depende de clases de Webflow ni de triggers de GTM: un único
 * listener delegado en captura reconoce el DESTINO del enlace (wa.me, tel:,
 * mailto:) y dispara la conversión correspondiente. Así sobrevive a cualquier
 * rediseño del sitio.
 *
 * Las etiquetas salen de las acciones de conversión reales de la cuenta
 * (conversion_action.tag_snippets, cuenta 865-036-1913). Si se crea una acción
 * nueva en Google Ads, agregarla acá.
 */

export const AW_ID = 'AW-17738539772'

/** send_to de cada acción (AW-<id>/<label>), tal como los entrega la API de Ads. */
export const CONVERSIONES = {
  /** Clic en cualquier enlace a WhatsApp. Es LA conversión principal del negocio. */
  whatsapp: `${AW_ID}/oN4JCIG0jsYbEPzFsopC`,   // "Join Chat"
  /** Clic en un teléfono (tel:). */
  telefono: `${AW_ID}/ATK9CP6zjsYbEPzFsopC`,   // "Click Teléfono"
  /** Clic en un correo (mailto:). */
  correo: `${AW_ID}/K1nwCPuzjsYbEPzFsopC`,     // "Click Mail"
} as const

/**
 * Bloque a inyectar en TODAS las páginas del sitio público. Reutiliza el `gtag`
 * que ya define GA4 en las plantillas (no lo pisa) y agrega la cuenta de Ads.
 * El listener va en fase de CAPTURA para que ningún handler del widget de
 * WhatsApp pueda detener la propagación antes de que midamos.
 */
export function scriptConversiones(): string {
  return `<script async src="https://www.googletagmanager.com/gtag/js?id=${AW_ID}"></script>
<script>(function(){
window.dataLayer=window.dataLayer||[];
if(typeof window.gtag!=='function'){window.gtag=function(){window.dataLayer.push(arguments)};window.gtag('js',new Date());}
window.gtag('config','${AW_ID}');
var ULTIMO={};
function medir(destino,evento){
  var ahora=Date.now();
  if(ULTIMO[destino]&&ahora-ULTIMO[destino]<2000)return; // el mismo clic no cuenta dos veces
  ULTIMO[destino]=ahora;
  try{window.gtag('event','conversion',{send_to:destino});}catch(e){}
  try{window.dataLayer.push({event:evento});}catch(e){}
}
document.addEventListener('click',function(ev){
  var t=ev.target;
  var a=t&&t.closest?t.closest('a[href]'):null;
  if(!a)return;
  var href=(a.getAttribute('href')||'').toLowerCase();
  if(href.indexOf('wa.me/')>-1||href.indexOf('api.whatsapp.com')>-1||href.indexOf('web.whatsapp.com')>-1){
    medir('${CONVERSIONES.whatsapp}','contacto_whatsapp');
  }else if(href.indexOf('tel:')===0){
    medir('${CONVERSIONES.telefono}','contacto_telefono');
  }else if(href.indexOf('mailto:')===0){
    medir('${CONVERSIONES.correo}','contacto_correo');
  }
},true);
})();</script>`
}

/**
 * Inserta el bloque antes de `</body>` (o al final si la página no lo trae).
 * Idempotente: si la página ya lo tiene, la devuelve intacta.
 */
export function inyectarConversiones(html: string): string {
  if (html.includes(AW_ID)) return html
  const bloque = scriptConversiones()
  const i = html.lastIndexOf('</body>')
  return i === -1 ? html + bloque : html.slice(0, i) + bloque + html.slice(i)
}
