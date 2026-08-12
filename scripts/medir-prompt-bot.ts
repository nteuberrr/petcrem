/**
 * MEDIR EL PROMPT DEL BOT — cuánto pesa cada bloque, en tokens y en plata.
 *
 * El costo del bot es casi todo ENTRADA: lo que se paga es el tamaño del prompt
 * multiplicado por la cantidad de mensajes del día. Este script lo mide de verdad
 * (no estima): levanta un servidor local, apunta el SDK de Anthropic ahí con
 * ANTHROPIC_BASE_URL, corre `generarRespuesta` con una conversación de prueba e
 * intercepta el request EXACTO que se habría enviado. Después cuenta los tokens
 * de cada bloque con la API real (count_tokens es gratis).
 *
 *   npx tsx scripts/medir-prompt-bot.ts
 *
 * No envía nada a ningún cliente ni escribe en la base: la respuesta viene del
 * servidor local y no trae `usage`, así que tampoco deja fila en `uso_ia`.
 */
import './_env-preload'
import http from 'node:http'
import Anthropic from '@anthropic-ai/sdk'

interface Captura {
  system: Array<{ type: string; text: string; cache_control?: unknown }>
  tools?: Array<Record<string, unknown>>
  messages: unknown[]
  max_tokens?: number
  model?: string
}

async function capturar(): Promise<Captura> {
  let capturado: Captura | null = null
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', c => { body += c })
    req.on('end', () => {
      try { capturado = JSON.parse(body) as Captura } catch { /* ignore */ }
      res.writeHead(200, { 'content-type': 'application/json' })
      // Sin `usage` a propósito: registrarUso() lo ignora y no ensucia uso_ia.
      res.end(JSON.stringify({
        id: 'msg_local', type: 'message', role: 'assistant', model: 'local',
        content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn', stop_sequence: null,
      }))
    })
  })
  await new Promise<void>(r => server.listen(8787, '127.0.0.1', r))
  process.env.ANTHROPIC_BASE_URL = 'http://127.0.0.1:8787'
  if (!process.env.ANTHROPIC_API_KEY) process.env.ANTHROPIC_API_KEY = 'sk-local'

  const { generarRespuesta } = await import('../lib/agente-mensajes')
  const ok = async () => 'ok'
  await generarRespuesta(
    [{ rol: 'cliente', texto: 'Hola, cuánto vale cremar a mi perrita de 10 kilos? Estoy en Ñuñoa', ts: new Date().toISOString() }],
    {
      ctx: { waId: '56900000000', nombreContacto: 'Prueba', canal: 'whatsapp' },
      handlers: {
        solicitarRetiro: ok, reprogramarRetiro: ok, solicitarRetiroVet: ok, agendarEutanasia: ok,
        cotizarCremacion: ok, cotizarEutanasia: ok, consultarEtaRetiro: ok, consultarEstadoMascota: ok,
        enviarCatalogo: ok, agregarAdicional: ok, cancelarAgendamiento: ok,
      },
    },
  )
  await new Promise<void>(r => server.close(() => r()))
  if (!capturado) throw new Error('no se capturó el request')
  return capturado
}

async function main() {
  const req = await capturar()
  delete process.env.ANTHROPIC_BASE_URL
  const api = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY!, baseURL: 'https://api.anthropic.com' })
  const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6'

  const contar = async (partes: { system?: unknown; tools?: unknown }): Promise<number> => {
    const r = await api.messages.countTokens({
      model: MODEL,
      messages: [{ role: 'user', content: 'x' }],
      ...(partes.system ? { system: partes.system as never } : {}),
      ...(partes.tools ? { tools: partes.tools as never } : {}),
    })
    return r.input_tokens
  }

  const vacio = await contar({})
  const filas: Array<{ nombre: string; tokens: number; cacheado: boolean }> = []

  const tools = (req.tools || []) as Array<Record<string, unknown>>
  if (tools.length) {
    filas.push({ nombre: `HERRAMIENTAS (${tools.length}: ${tools.map(t => t.name).join(', ')})`, tokens: await contar({ tools }) - vacio, cacheado: true })
  }

  // El corte de caché es el ÚLTIMO bloque con cache_control: todo lo anterior
  // (incl. las tools) viaja en el prefijo cacheado.
  let corte = -1
  req.system.forEach((b, i) => { if (b.cache_control) corte = i })

  for (const [i, b] of req.system.entries()) {
    const t = await contar({ system: [{ type: 'text', text: b.text }] }) - vacio
    const titulo = (b.text.split('\n')[0] || '').slice(0, 70)
    filas.push({ nombre: `[${i}] ${titulo}`, tokens: t, cacheado: i <= corte })
  }

  const totalSys = filas.reduce((a, f) => a + f.tokens, 0)
  const cacheados = filas.filter(f => f.cacheado).reduce((a, f) => a + f.tokens, 0)
  const frescos = totalSys - cacheados

  console.log(`\nPROMPT DEL BOT — modelo ${MODEL}, max_tokens ${req.max_tokens}\n`)
  console.log('tok      caché  bloque')
  for (const f of [...filas].sort((a, b) => b.tokens - a.tokens)) {
    console.log(`${String(f.tokens).padStart(6)}   ${f.cacheado ? ' SÍ ' : ' no '}  ${f.nombre}`)
  }
  console.log(`\nTOTAL system+tools: ${totalSys} tok — cacheado ${cacheados} · fresco cada vez ${frescos}`)

  // Plata: 130 respuestas/día es el ritmo de agosto-2026.
  const LLAM_DIA = 130
  const usdMes = (tok: number, precio: number) => (tok * precio / 1e6) * LLAM_DIA * 30
  console.log(`\nA ${LLAM_DIA} llamadas/día (ritmo de agosto):`)
  console.log(`  leer el prefijo cacheado: US$${usdMes(cacheados, 0.30).toFixed(2)}/mes`)
  console.log(`  pagar lo fresco del system: US$${usdMes(frescos, 3).toFixed(2)}/mes`)
  console.log('\n(los mensajes de la conversación van aparte y también se pagan a $3/M)')
}

main().catch(e => { console.error(e); process.exit(1) })
