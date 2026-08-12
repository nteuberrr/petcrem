/**
 * VERIFICA EL KEEP-ALIVE DE LA CACHÉ DEL BOT.
 *
 * El ping (`pingCacheAgente`) solo sirve si manda EXACTAMENTE el mismo prefijo
 * que una respuesta real: la caché de Anthropic se acierta por prefijo exacto, así
 * que un solo byte de diferencia hace que el ping escriba una SEGUNDA entrada en
 * vez de refrescar la del bot — y en vez de ahorrar, duplica el gasto. Eso no se
 * ve en los logs: los dos caminos responden bien igual.
 *
 * Este script levanta un servidor local, apunta el SDK ahí con ANTHROPIC_BASE_URL
 * e intercepta los dos requests (el del agente y el del ping) SIN llamar a la API
 * real. Después compara herramienta por herramienta y bloque por bloque hasta la
 * marca de caché.
 *
 *   npx tsx scripts/verificar-cache-agente.ts
 *
 * Correr ante cualquier cambio en el prompt, en las herramientas o en
 * `construirPrefijo`. No envía nada a ningún cliente ni escribe en la base.
 *
 * Con `--vivo` hace la prueba de punta a punta contra la API REAL: manda dos
 * pings seguidos y comprueba que el segundo LEE de caché en vez de reescribirla.
 * Cuesta unos centavos de dólar (una escritura si estaba fría, más una lectura) y
 * deja las dos filas en `uso_ia`, porque es gasto de verdad.
 */
import './_env-preload'
import http from 'node:http'
import crypto from 'node:crypto'

interface Bloque { type: string; text: string; cache_control?: unknown }
interface Captura { system: Bloque[]; tools?: Array<{ name?: string }>; messages: unknown[] }

const capturas: Captura[] = []

/**
 * Prueba de punta a punta contra la API real: dos pings seguidos. El segundo
 * TIENE que leer de caché — si vuelve a escribir, el prefijo no está calzando y
 * el keep-alive estaría pagando 2× en cada tirada en vez de ahorrar.
 */
async function vivo() {
  const { pingCacheAgente } = await import('../lib/agente-mensajes')
  const usd = (lec: number, esc: number) => (lec * 0.3 + esc * 6) / 1e6
  console.log('\nPRUEBA EN VIVO — dos pings contra la API real\n')
  const r1 = await pingCacheAgente()
  if (!r1.ok) { console.error('✗ el primer ping falló:', r1.error); process.exit(1) }
  console.log(`  1er ping: leídos ${r1.leidos} · escritos ${r1.escritos} → US$${usd(r1.leidos, r1.escritos).toFixed(4)}  ${r1.escritos > 0 ? '(la caché estaba fría: la acaba de dejar caliente)' : '(la caché ya estaba viva)'}`)
  await new Promise(r => setTimeout(r, 3000))
  const r2 = await pingCacheAgente()
  if (!r2.ok) { console.error('✗ el segundo ping falló:', r2.error); process.exit(1) }
  console.log(`  2do ping: leídos ${r2.leidos} · escritos ${r2.escritos} → US$${usd(r2.leidos, r2.escritos).toFixed(4)}`)

  if (r2.leidos > 1000 && r2.escritos === 0) {
    const porDia = usd(r2.leidos, 0) * 16
    console.log(`\n✓ El segundo ping LEYÓ ${r2.leidos.toLocaleString()} tokens de caché y no escribió nada.`)
    console.log(`  Mantenerla viva todo el día cuesta ~US$${porDia.toFixed(2)}; cada caída evitada vale US$${usd(0, r2.leidos).toFixed(2)}.`)
    process.exit(0)
  }
  console.error(`\n✗ El segundo ping NO leyó de caché (leídos ${r2.leidos}, escritos ${r2.escritos}).`)
  console.error('  Con el prefijo calzando esto no debería pasar: revisá que no haya nada dinámico antes de la marca cache_control.')
  process.exit(1)
}

async function main() {
  if (process.argv.includes('--vivo')) return vivo()
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', c => { body += c })
    req.on('end', () => {
      try { capturas.push(JSON.parse(body) as Captura) } catch { /* ignore */ }
      res.writeHead(200, { 'content-type': 'application/json' })
      // Sin `usage`: registrarUso() lo ignora y no ensucia la tabla uso_ia.
      res.end(JSON.stringify({
        id: 'msg_local', type: 'message', role: 'assistant', model: 'local',
        content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn', stop_sequence: null,
      }))
    })
  })
  await new Promise<void>(r => server.listen(8788, '127.0.0.1', r))
  process.env.ANTHROPIC_BASE_URL = 'http://127.0.0.1:8788'
  if (!process.env.ANTHROPIC_API_KEY) process.env.ANTHROPIC_API_KEY = 'sk-local'

  const { generarRespuesta, pingCacheAgente } = await import('../lib/agente-mensajes')
  const { handlersAgente } = await import('../lib/agente-acciones')

  // 1) Una respuesta real del bot, con los handlers que inyecta el webhook.
  await generarRespuesta(
    [{ rol: 'cliente', texto: 'Hola, cuánto vale cremar a mi perrita de 10 kilos?', ts: new Date().toISOString() }],
    { ctx: { waId: '56900000000', nombreContacto: 'Prueba', canal: 'whatsapp' }, handlers: handlersAgente() },
  )
  // 2) El ping de mantención.
  await pingCacheAgente()
  await new Promise<void>(r => server.close(() => r()))

  if (capturas.length < 2) {
    console.error(`✗ Se esperaban 2 requests y se capturaron ${capturas.length}.`)
    process.exit(1)
  }
  const [agente, ping] = capturas

  // El prefijo cacheado = tools + los bloques del system HASTA la marca de caché
  // (inclusive). Lo que viene después no participa del acierto.
  const prefijo = (c: Captura) => {
    const corte = c.system.reduce((acc, b, i) => (b.cache_control ? i : acc), -1)
    return { tools: c.tools || [], bloques: c.system.slice(0, corte + 1), corte }
  }
  const a = prefijo(agente)
  const p = prefijo(ping)
  const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 12)

  let falla = false
  console.log('\n── HERRAMIENTAS ──')
  const nomA = a.tools.map(t => t.name).join(', ')
  const nomP = p.tools.map(t => t.name).join(', ')
  if (JSON.stringify(a.tools) === JSON.stringify(p.tools)) {
    console.log(`✓ idénticas (${a.tools.length}): ${nomA}`)
  } else {
    falla = true
    console.log(`✗ DIFIEREN\n  agente (${a.tools.length}): ${nomA}\n  ping   (${p.tools.length}): ${nomP}`)
    const soloA = a.tools.filter(t => !p.tools.some(x => x.name === t.name)).map(t => t.name)
    const soloP = p.tools.filter(t => !a.tools.some(x => x.name === t.name)).map(t => t.name)
    if (soloA.length) console.log(`  falta en el ping: ${soloA.join(', ')}  → agregá su handler a opts_ping`)
    if (soloP.length) console.log(`  sobra en el ping: ${soloP.join(', ')}`)
  }

  console.log('\n── BLOQUES CACHEADOS DEL SYSTEM ──')
  if (a.corte < 0 || p.corte < 0) {
    falla = true
    console.log(`✗ Falta la marca cache_control (agente: ${a.corte}, ping: ${p.corte})`)
  }
  if (a.bloques.length !== p.bloques.length) {
    falla = true
    console.log(`✗ Distinta cantidad de bloques: agente ${a.bloques.length}, ping ${p.bloques.length}`)
  }
  const n = Math.max(a.bloques.length, p.bloques.length)
  for (let i = 0; i < n; i++) {
    const ta = a.bloques[i]?.text ?? '(no existe)'
    const tp = p.bloques[i]?.text ?? '(no existe)'
    const titulo = (ta.split('\n')[0] || '').slice(0, 58)
    if (ta === tp) {
      console.log(`  ✓ [${i}] ${sha(ta)} ${String(ta.length).padStart(7)} car  ${titulo}`)
    } else {
      falla = true
      console.log(`  ✗ [${i}] DIFIERE  agente ${sha(ta)} (${ta.length} car) · ping ${sha(tp)} (${tp.length} car)  ${titulo}`)
      const j = [...ta].findIndex((c, k) => c !== tp[k])
      if (j >= 0) console.log(`      primera diferencia en el carácter ${j}: …${ta.slice(Math.max(0, j - 40), j + 40)}…`)
    }
  }

  // La marca de caché tiene que ir en el ÚLTIMO bloque estable, no en el primero:
  // si no, todo lo que viene después se paga entero en cada mensaje.
  console.log('\n── UBICACIÓN DE LA MARCA ──')
  const ttl = (agente.system[a.corte]?.cache_control as { ttl?: string } | undefined)?.ttl
  console.log(`  corte en el bloque ${a.corte} de ${agente.system.length - 1} · TTL ${ttl || '5m (por defecto)'}`)
  if (a.corte < agente.system.length - 1) {
    console.log(`  ✓ hay ${agente.system.length - 1 - a.corte} bloque(s) dinámico(s) después, sin cachear (correcto)`)
  } else {
    console.log('  ⚠ no hay ningún bloque después de la marca: revisá que lo dinámico no esté quedando adentro')
  }

  console.log(falla
    ? '\n✗ EL PING NO VA A ACERTAR LA CACHÉ DEL BOT: escribiría una segunda entrada y el gasto SUBE.'
    : '\n✓ El ping manda el mismo prefijo que el agente: renueva la caché en vez de duplicarla.')
  process.exit(falla ? 1 : 0)
}

main().catch(e => { console.error(e); process.exit(1) })
