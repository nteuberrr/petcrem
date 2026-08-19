import './_env-preload'
import { desglosePrompt } from '../lib/agente-mensajes'
import { getMensajesSupabase } from '../lib/supabase'

/**
 * Qué pesa cada pieza del prompt del bot, y cuál se paga a precio lleno.
 *
 *   npx tsx scripts/medir-prompt-agente.ts [conversacion_id]
 *
 * Por qué (revisión de costos, 19-08-2026): el bot es el 64% del gasto de IA y
 * dentro de él, el 45% —unos US$26 al mes— son tokens de ENTRADA que no pasan por
 * la caché: 3.555 por llamada, a $3 el millón en vez de $0,30. Antes de recortar
 * nada hay que saber cuáles son; este script lo dice con datos reales en vez de
 * suposiciones.
 *
 * Sin argumento toma la conversación con más mensajes del último mes, que es el
 * peor caso realista. No llama a la API de Anthropic: solo arma el prompt y lo mide.
 */

/** Español ~3,6 caracteres por token. Sirve para comparar piezas, no para facturar. */
const CHARS_POR_TOKEN = 3.6
const tok = (chars: number) => Math.round(chars / CHARS_POR_TOKEN)

/** USD por millón de tokens de Sonnet: entrada llena vs lectura de caché. */
const USD_ENTRADA = 3
const USD_CACHE = 0.3
/** Respuestas reales del bot en agosto (18 días), para proyectar a un mes. */
const LLAMADAS_MES = Math.round(2439 / 18 * 30)

async function conversacionMasLarga(): Promise<{ id: number; turnos: Array<{ rol: 'cliente' | 'nosotros'; texto: string; ts: string }> } | null> {
  const sb = getMensajesSupabase()
  const { data } = await sb.from('mensajes_mensajes')
    .select('conversacion_id, direccion, cuerpo, ts')
    .gte('ts', new Date(Date.now() - 30 * 86400_000).toISOString())
    .order('id', { ascending: true }).limit(4000)
  const porConv = new Map<number, Array<{ rol: 'cliente' | 'nosotros'; texto: string; ts: string }>>()
  for (const m of (data ?? []) as Array<{ conversacion_id: number; direccion: string; cuerpo: string | null; ts: string }>) {
    const texto = (m.cuerpo ?? '').trim()
    if (!texto) continue
    const arr = porConv.get(m.conversacion_id) ?? []
    arr.push({ rol: m.direccion === 'entrante' ? 'cliente' : 'nosotros', texto, ts: m.ts })
    porConv.set(m.conversacion_id, arr)
  }
  let mejor: { id: number; turnos: typeof porConv extends Map<number, infer T> ? T : never } | null = null
  for (const [id, turnos] of porConv) {
    if (!mejor || turnos.length > mejor.turnos.length) mejor = { id, turnos }
  }
  return mejor
}

async function main() {
  const idPedido = parseInt(process.argv[2] || '', 10)
  let historial: Array<{ rol: 'cliente' | 'nosotros'; texto: string; ts: string }> = []
  let convId = 0

  if (Number.isFinite(idPedido)) {
    const sb = getMensajesSupabase()
    const { data } = await sb.from('mensajes_mensajes').select('direccion, cuerpo, ts')
      .eq('conversacion_id', idPedido).order('id', { ascending: true })
    historial = ((data ?? []) as Array<{ direccion: string; cuerpo: string | null; ts: string }>)
      .filter(m => (m.cuerpo ?? '').trim())
      .map(m => ({ rol: (m.direccion === 'entrante' ? 'cliente' : 'nosotros') as 'cliente' | 'nosotros', texto: (m.cuerpo ?? '').trim(), ts: m.ts }))
    convId = idPedido
  } else {
    const c = await conversacionMasLarga()
    if (c) { historial = c.turnos; convId = c.id }
  }

  const d = await desglosePrompt({ historial })

  const cacheadoChars = d.cacheado.reduce((s, b) => s + b.chars, 0) + d.tools
  const dinamicoChars = d.dinamico.reduce((s, b) => s + b.chars, 0)

  const linea = (nombre: string, chars: number, total: number) => {
    const t = tok(chars)
    const pct = total > 0 ? ((chars / total) * 100).toFixed(0) : '0'
    console.log(`   ${nombre.padEnd(46)}${t.toLocaleString('es-CL').padStart(8)} tok${(pct + '%').padStart(6)}`)
  }

  console.log(`PROMPT DEL BOT — medido con la conversación #${convId} (${historial.length} mensajes)\n`)

  console.log('  CACHEADO — se lee a $0,30 el millón')
  for (const b of d.cacheado) linea(b.nombre, b.chars, cacheadoChars)
  linea('herramientas (JSON de las tools)', d.tools, cacheadoChars)
  console.log(`   ${'—'.repeat(46)}${tok(cacheadoChars).toLocaleString('es-CL').padStart(8)} tok\n`)

  console.log('  SIN CACHEAR — se paga $3 el millón, en CADA respuesta')
  for (const b of d.dinamico) linea(b.nombre, b.chars, dinamicoChars)
  console.log(`   ${'—'.repeat(46)}${tok(dinamicoChars).toLocaleString('es-CL').padStart(8)} tok\n`)

  const costoDin = (tok(dinamicoChars) * USD_ENTRADA / 1e6) * LLAMADAS_MES
  const costoCache = (tok(cacheadoChars) * USD_CACHE / 1e6) * LLAMADAS_MES
  console.log(`  A ${LLAMADAS_MES.toLocaleString('es-CL')} respuestas al mes:`)
  console.log(`    lo cacheado cuesta   US$${costoCache.toFixed(2)}`)
  console.log(`    lo dinámico cuesta   US$${costoDin.toFixed(2)}   ← acá está el margen`)
  console.log('\n  Nota: los tokens son una estimación por caracteres (~3,6 por token).')
  console.log('  La cifra que manda es la de uso_ia, que viene del propio proveedor.')
}

main().catch(e => { console.error(e); process.exit(1) })
