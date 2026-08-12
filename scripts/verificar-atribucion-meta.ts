import './_env-preload'
import { getSupabase } from '../lib/supabase'
import { getMensajesSupabase } from '../lib/supabase'

/**
 * VERIFICA LA ATRIBUCIÓN DE META Y EL SEGUNDO TOQUE DE SEGUIMIENTO.
 *
 * Comprueba lo que el DDL tiene que haber dejado (supabase/atribucion-meta-y-
 * seguimiento.sql) y que las piezas que dependen de él estén realmente en pie:
 * las columnas nuevas, el backfill del contador, la configuración de la
 * Conversions API y el estado del número de WhatsApp.
 *
 *   npx tsx scripts/verificar-atribucion-meta.ts
 *
 * Es READ-ONLY salvo por una fila de prueba en `ads_clicks` que borra al
 * terminar. No informa ninguna conversión a Meta ni le escribe a nadie.
 */

const ok = (s: string) => console.log(`  ✓ ${s}`)
const mal = (s: string) => { console.log(`  ✗ ${s}`); fallas++ }
const nota = (s: string) => console.log(`    ${s}`)
let fallas = 0

async function columnasAdsClicks() {
  console.log('\n── ads_clicks: columnas nuevas ──')
  const sb = getSupabase()
  const { data, error } = await sb.from('ads_clicks')
    .select('id, fbclid, ctwa_clid, meta_lead_at, meta_compra_at').limit(1)
  if (error) { mal(`no se pueden leer las columnas nuevas: ${error.message}`); return false }
  ok('fbclid · ctwa_clid · meta_lead_at · meta_compra_at existen')
  void data
  return true
}

async function insertRealFbclid() {
  console.log('\n── ads_clicks: escritura real con fbclid ──')
  const { registrarClick } = await import('../lib/ads-clicks')
  const codigo = await registrarClick({ fbclid: 'PRUEBA.verificacion.1', landing: '/prueba-verificacion' })
  if (!codigo) { mal('registrarClick devolvió null — el insert con fbclid falló'); return }
  ok(`insert con fbclid OK (código ${codigo})`)
  const sb = getSupabase()
  const { data } = await sb.from('ads_clicks').select('id, fbclid').eq('codigo', codigo).limit(1)
  const fila = (data ?? [])[0] as { id?: number; fbclid?: string } | undefined
  if (fila?.fbclid === 'PRUEBA.verificacion.1') ok('el fbclid se guardó tal cual')
  else mal(`el fbclid no quedó guardado (leído: ${fila?.fbclid ?? 'nada'})`)
  if (fila?.id) { await sb.from('ads_clicks').delete().eq('id', fila.id); nota('fila de prueba eliminada') }
}

async function pendientes() {
  console.log('\n── Qué hay para informarle a Meta ──')
  const { pendientesMetaLead, pendientesMetaCompra, pendientesDeSubir } = await import('../lib/ads-clicks')
  const [lead, compra, google] = await Promise.all([
    pendientesMetaLead(500), pendientesMetaCompra(500), pendientesDeSubir(500),
  ])
  ok(`Meta: ${lead.length} lead(s) y ${compra.length} compra(s) pendientes`)
  ok(`Google: ${google.length} conversión(es) pendientes`)
  if (google.some(g => !g.gclid && !g.gbraid && !g.wbraid)) {
    mal('hay pendientes de Google SIN identificador de Google — el filtro no está aplicando')
  } else {
    ok('los pendientes de Google traen todos su identificador (el filtro separa bien las plataformas)')
  }
  const sb = getSupabase()
  const { count } = await sb.from('ads_clicks').select('id', { count: 'exact', head: true }).not('fbclid', 'is', null)
  nota(`clics con fbclid registrados hasta ahora: ${count ?? 0} (0 es lo esperado antes de desplegar)`)
}

async function seguimiento() {
  console.log('\n── mensajes_conversaciones: contador de toques ──')
  const sb = getMensajesSupabase()
  const { data, error } = await sb.from('mensajes_conversaciones')
    .select('id, seguimiento_n, seguimiento_at').not('seguimiento_at', 'is', null).limit(2000)
  if (error) { mal(`no se puede leer seguimiento_n: ${error.message}`); return }
  const filas = (data ?? []) as Array<{ seguimiento_n: number | null; seguimiento_at: string }>
  ok(`seguimiento_n existe · ${filas.length} conversación(es) con seguimiento`)
  const sinBackfill = filas.filter(f => Number(f.seguimiento_n ?? 0) === 0).length
  if (sinBackfill > 0) mal(`${sinBackfill} conversación(es) con seguimiento_at pero seguimiento_n=0 — el backfill no corrió (recibirían el toque 1 de nuevo)`)
  else ok('el backfill quedó aplicado: ninguna con toque enviado quedó en 0')
  const conteo = new Map<number, number>()
  for (const f of filas) conteo.set(Number(f.seguimiento_n ?? 0), (conteo.get(Number(f.seguimiento_n ?? 0)) ?? 0) + 1)
  nota(`reparto: ${[...conteo.entries()].sort((a, b) => a[0] - b[0]).map(([n, c]) => `n=${n}: ${c}`).join(' · ')}`)

  // Ritmo semanal → cuánto tarda el grupo de control en tener tamaño útil.
  const hace7d = new Date(Date.now() - 7 * 864e5).toISOString()
  const recientes = filas.filter(f => f.seguimiento_at >= hace7d).length
  nota(`seguimientos en los últimos 7 días: ${recientes}`)
  if (recientes > 0) {
    const semanas = Math.ceil(10 / Math.max(0.1, recientes * 0.1))
    nota(`con el holdout al 10%, el grupo de control llega a 10 leads en ~${semanas} semana(s)`)
  }
}

async function metaCapi() {
  console.log('\n── Conversions API de Meta ──')
  const { isMetaCapiConfigurado } = await import('../lib/meta-capi')
  if (!isMetaCapiConfigurado()) {
    mal('no configurada: falta META_CAPI_TOKEN (o META_GRAPH_TOKEN) — el cron no va a subir nada')
    return
  }
  ok('hay token configurado')
  const pixel = process.env.META_PIXEL_ID || '1324716849538772'
  const token = process.env.META_CAPI_TOKEN || process.env.META_GRAPH_TOKEN || ''
  const v = process.env.META_API_VERSION || process.env.WHATSAPP_API_VERSION || 'v22.0'
  try {
    const res = await fetch(`https://graph.facebook.com/${v}/${pixel}?fields=name,id&access_token=${encodeURIComponent(token)}`)
    const j = await res.json() as { name?: string; id?: string; error?: { message?: string } }
    if (!res.ok) mal(`el token no puede leer el dataset ${pixel}: ${j?.error?.message || res.status}`)
    else ok(`el token ve el dataset «${j.name ?? '—'}» (${j.id ?? pixel})`)
  } catch (e) { mal(`no se pudo consultar el dataset: ${e instanceof Error ? e.message : e}`) }
}

async function saludWa() {
  console.log('\n── Estado del número de WhatsApp ──')
  const { consultarSaludWhatsapp } = await import('../lib/whatsapp-salud')
  const s = await consultarSaludWhatsapp()
  if (!s.consultado) { mal(`no se pudo consultar: ${s.error}`); return }
  if (s.puedeEnviar) ok('puede enviar (sin bloqueos)')
  else mal(`BLOQUEADO: ${s.bloqueos.map(b => `${b.entidad} ${b.codigo}`).join(', ')}`)
  if (s.calidad === null) nota('calidad: Meta no la informa todavía')
  else if (s.calidad === 'GREEN' || s.calidad === 'UNKNOWN') ok(`calidad ${s.calidad}`)
  else mal(`calidad ${s.calidad} — el aviso por correo va a saltar`)
  nota(`límite de conversaciones iniciadas: ${s.limite ?? '—'}`)
}

async function main() {
  console.log('VERIFICACIÓN — atribución de Meta + segundo toque de seguimiento')
  if (await columnasAdsClicks()) await insertRealFbclid()
  await pendientes()
  await seguimiento()
  await metaCapi()
  await saludWa()
  console.log(fallas === 0 ? '\n✅ Todo en orden.' : `\n❌ ${fallas} problema(s).`)
  process.exit(fallas === 0 ? 0 : 1)
}

main().catch(e => { console.error(e); process.exit(1) })
