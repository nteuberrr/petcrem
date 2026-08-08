/**
 * Verifica la tubería de ATRIBUCIÓN de Google Ads sin tocar la base ni la cuenta.
 *
 *   npx tsx scripts/verificar-atribucion-ads.ts
 *
 * Comprueba las piezas puras del recorrido clic → ficha:
 *  1. el marcador `[#CODIGO]` sobrevive el viaje por la URL de wa.me y se lee/limpia bien;
 *  2. el script del sitio queda inyectado en las landings y en las páginas espejo;
 *  3. el link de WhatsApp se reescribe como corresponde (simulando el navegador);
 *  4. `fechaHoraAds` produce el formato exacto que exige la API de Google.
 *
 * Lo que NO cubre (necesita la tabla `ads_clicks` creada en Supabase y una cuenta
 * real): el registro del clic y la subida de la conversión.
 */
import './_env-preload'
import { leerMarcador, limpiarMarcador, RE_MARCADOR } from '../lib/ads-clicks'
import { fechaHoraAds } from '../lib/google-ads'
import { inyectarCapturaAds, CLAVE_REF } from '../lib/sitio/ads-click-captura'
import { LANDINGS, renderLanding, waLink } from '../lib/sitio/landings'

let fallos = 0
function chequeo(nombre: string, ok: boolean, detalle = '') {
  console.log(`  ${ok ? '✔' : '✘'} ${nombre}${detalle ? ` — ${detalle}` : ''}`)
  if (!ok) fallos++
}

// ── 1. El marcador ───────────────────────────────────────────────────────────
console.log('\n1. Marcador en el mensaje')
{
  const codigo = 'K7MP34'
  const msg = 'Hola! Necesito información sobre la cremación de mi mascota'
  // Lo que hace el navegador: agrega el marcador al parámetro `text`.
  const u = new URL(waLink(msg))
  u.searchParams.set('text', `${msg} [#${codigo}]`)
  // Lo que llega al webhook: WhatsApp entrega el texto ya decodificado.
  const recibido = new URL(u.toString()).searchParams.get('text') || ''

  chequeo('el marcador sobrevive la codificación de la URL', recibido.includes(`[#${codigo}]`), recibido.slice(-14))
  chequeo('se lee el código del mensaje', leerMarcador(recibido) === codigo)
  chequeo('se limpia del mensaje que ve el equipo', limpiarMarcador(recibido) === msg, limpiarMarcador(recibido))
  chequeo('acepta minúsculas', leerMarcador(`hola [#${codigo.toLowerCase()}]`) === codigo)
  chequeo('no confunde texto normal', leerMarcador('mi perro pesa 10 kilos [más o menos]') === null)
  chequeo('no rompe un mensaje sin marcador', limpiarMarcador(msg) === msg)
  chequeo('el alfabeto excluye caracteres ambiguos', !RE_MARCADOR.source.includes('O') && !RE_MARCADOR.source.includes('1'))
}

// ── 2. Inyección en el sitio ─────────────────────────────────────────────────
console.log('\n2. Script en las páginas')
{
  const landing = renderLanding(LANDINGS['cremacion-de-mascotas'], { 'cremacion-individual': 120000 })
  const conScript = inyectarCapturaAds(landing)
  chequeo('se inyecta en la landing', conScript.includes(CLAVE_REF))
  chequeo('va antes de </body>', conScript.lastIndexOf(CLAVE_REF) < conScript.lastIndexOf('</body>'))
  chequeo('es idempotente', inyectarCapturaAds(conScript) === conScript)
  chequeo('llama al endpoint público', conScript.includes('/api/ads/click'))
  chequeo('contempla gbraid/wbraid (iOS)', conScript.includes('gbraid') && conScript.includes('wbraid'))
}

// ── 3. Contenido nuevo de la landing ─────────────────────────────────────────
console.log('\n3. Landing de cremación (experiencia de landing)')
{
  const html = renderLanding(LANDINGS['cremacion-de-mascotas'], {
    'cremacion-individual': 120000, 'cremacion-premium': 160000, 'cremacion-sin-devolucion-de-cenizas': 80000,
  })
  chequeo('muestra precios', html.includes('Nuestras modalidades y precios'))
  chequeo('explica el proceso', html.includes('Cómo es el proceso'))
  chequeo('tiene los 5 pasos', (html.match(/class="paso"/g) || []).length === 5)
  chequeo('tiene bloque de confianza', html.includes('Dónde estamos'))
  chequeo('8 preguntas frecuentes', (html.match(/<details>/g) || []).length === 8)
  chequeo('datos estructurados de negocio', html.includes('"LocalBusiness"') && html.includes('"Service"'))
  chequeo('NO inventa reseñas', !html.includes('aggregateRating'))
}

// ── 4. Formato de fecha para la API ──────────────────────────────────────────
console.log('\n4. conversion_date_time')
{
  // Invierno en Chile: -04:00. (En verano austral, -03:00 — por eso se calcula.)
  const invierno = fechaHoraAds(new Date('2026-08-07T16:30:00Z'))
  const verano = fechaHoraAds(new Date('2026-01-15T16:30:00Z'))
  const FORMATO = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/
  chequeo('formato exigido por Google', FORMATO.test(invierno), invierno)
  chequeo('desfase de invierno', invierno.endsWith('-04:00'), invierno)
  chequeo('desfase de verano (horario de verano)', verano.endsWith('-03:00'), verano)
  chequeo('medianoche no sale como 24', !fechaHoraAds(new Date('2026-08-07T04:00:00Z')).includes(' 24:'))
}

console.log(fallos === 0 ? '\n✅ La tubería de atribución está sana.\n' : `\n❌ ${fallos} chequeo(s) fallaron.\n`)
process.exit(fallos ? 1 : 0)
