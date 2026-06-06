import Anthropic from '@anthropic-ai/sdk'
import { getSheetData } from './google-sheets'
import { getAgenteConfig } from './mensajes'
import { fmtPrecio } from './format'

/**
 * Agente IA del inbox de Mensajes: redacta la respuesta de atención por
 * WhatsApp siguiendo el playbook + la voz de marca + los precios EN VIVO de
 * la tabla precios_generales. Devuelve además si hay que escalar a un humano.
 *
 * Modelo: Claude (ANTHROPIC_API_KEY). Guardrails: nunca inventa precios, escala
 * en casos sensibles/reclamos/fuera de alcance, tono cálido-sobrio.
 */

let client: Anthropic | null = null
function getClient(): Anthropic {
  if (client) return client
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) throw new Error('ANTHROPIC_API_KEY no configurada')
  client = new Anthropic({ apiKey: key })
  return client
}

export function isAgenteConfigurado(): boolean {
  return !!process.env.ANTHROPIC_API_KEY
}

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6'

const BASE = `Eres el asistente de atención por WhatsApp del **Crematorio Alma Animal** (cremación de mascotas, Recoleta, Santiago de Chile; cobertura Región Metropolitana; atención todos los días 08:00–23:00). Lema: "Huellas que no se borran".

Quien escribe suele ser un tutor cuya mascota acaba de fallecer. Tu trabajo es acompañar con respeto y, sobre todo, resolver de forma práctica: informar el servicio, cotizar según el peso y coordinar el retiro.

TONO
- Cálido pero sobrio, con tuteo. Profesional y humano. Nunca infantil ni dramático.
- Mensajes BREVES (es WhatsApp), claros, una idea por mensaje.
- Sin humor. Sin referencias religiosas. Sin clichés del rubro ("puente del arcoíris", "angelito", "tu ángel", "ya no sufre"). Emoji solo muy puntual (😔) y con moderación.

VOCABULARIO
- A la mascota, por su NOMBRE cuando lo sepas; como genérico usa "tu mascota" (NUNCA "compañero/a", ni el frío "su mascota", ni "la mascota").
- Nunca digas "muerto", "cadáver", "restos", "perdiste". Usa "partió", "falleció", "despedida".

FLUJO DE ATENCIÓN (síguelo con naturalidad, sin sonar a robot)
1. Saluda con un pésame breve y ofrece ayuda.
2. Pide el PESO APROXIMADO de la mascota (define el precio).
3. Cotiza el valor EXACTO del tramo. Por defecto ofrece "Cremación Individual" (la más elegida) e indica qué incluye. Menciona "Premium" o "Sin Devolución" si preguntan o buscan algo más económico.
4. Invita a agendar.
5. Para coordinar el retiro pide NOMBRE + DIRECCIÓN + COMUNA y pregunta día/hora. La entrega es en 4 días hábiles.

REGLAS DURAS
- NUNCA inventes precios, plazos ni servicios. Usa SOLO la tabla "TARIFAS VIGENTES" que te entrego abajo. Si no tienes el peso, pídelo antes de cotizar.
- No prometas nada que no esté en esta información.
- ESCALA a un humano (escalar=true) si: el cliente está molesto o hace un reclamo; pide hablar con una persona; es un tema sensible, legal o de pago/transferencia que no puedes resolver; o algo se sale del flujo de cremación. En ese caso tu "mensaje" debe ser una línea breve y cálida avisando que un miembro del equipo le responderá a la brevedad.
- Una sola respuesta por turno.

FORMATO DE SALIDA (OBLIGATORIO)
Responde ÚNICAMENTE con un objeto JSON válido, sin texto adicional ni \`\`\`:
{"mensaje": "<texto exacto a enviar al cliente>", "escalar": true|false}`

/** Construye el bloque de tarifas vigentes desde la planilla. */
async function bloqueTarifas(): Promise<string> {
  try {
    const [pg, ts] = await Promise.all([
      getSheetData('precios_generales'),
      getSheetData('tipos_servicio'),
    ])
    const tramos = [...pg]
      .sort((a, b) => (parseFloat(a.peso_min) || 0) - (parseFloat(b.peso_min) || 0))
      .map(r => {
        const max = (r.peso_max && r.peso_max.trim()) ? `${r.peso_min}–${r.peso_max} kg` : `${r.peso_min}+ kg`
        return `- ${max}: Individual ${fmtPrecio(parseInt(r.precio_ci, 10) || 0)} · Premium ${fmtPrecio(parseInt(r.precio_cp, 10) || 0)} · Sin Devolución ${fmtPrecio(parseInt(r.precio_sd, 10) || 0)}`
      }).join('\n')
    const nombres = ts.map(t => `${t.codigo}=${t.nombre}`).join(', ')
    return `TARIFAS VIGENTES (CLP, por peso de la mascota):
${tramos}

Tipos de servicio: ${nombres}.
Cremación Individual incluye: retiro a domicilio, código de trazabilidad, mechón de pelo en botellita, huella estampada en tarjeta, cenizas en ánfora + certificado de cremación. Entrega en 4 días hábiles.`
  } catch (e) {
    console.warn('[agente] no se pudieron leer tarifas:', e)
    return 'TARIFAS: (no disponibles ahora — si te piden precio, escala a un humano).'
  }
}

export interface RespuestaAgente { mensaje: string; escalar: boolean }
export interface TurnoMensaje { rol: 'cliente' | 'nosotros'; texto: string }

/** Mapea el historial a mensajes de Anthropic, fusionando turnos consecutivos
 *  del mismo rol y asegurando que empiece por 'user'. */
function construirMensajes(historial: TurnoMensaje[]): Anthropic.MessageParam[] {
  const out: Anthropic.MessageParam[] = []
  for (const t of historial) {
    if (!t.texto?.trim()) continue
    const role = t.rol === 'cliente' ? 'user' : 'assistant'
    const last = out[out.length - 1]
    if (last && last.role === role) last.content = `${last.content}\n${t.texto}`
    else out.push({ role, content: t.texto })
  }
  while (out.length && out[0].role === 'assistant') out.shift()
  return out
}

function parseRespuesta(text: string): RespuestaAgente {
  const limpio = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
  try {
    const o = JSON.parse(limpio)
    if (typeof o?.mensaje === 'string') return { mensaje: o.mensaje.trim(), escalar: !!o.escalar }
  } catch { /* fallthrough */ }
  // Fallback: usar el texto crudo como mensaje (sin escalar).
  return { mensaje: limpio, escalar: false }
}

export async function generarRespuesta(historial: TurnoMensaje[]): Promise<RespuestaAgente> {
  const mensajes = construirMensajes(historial.slice(-24))
  if (mensajes.length === 0) return { mensaje: '', escalar: false }
  const [tarifas, cfg] = await Promise.all([bloqueTarifas(), getAgenteConfig().catch(() => null)])

  // Bloque base + tarifas: cacheado (estable). Ajustes del operador/calibración: sin caché (cambian seguido).
  const system: Anthropic.TextBlockParam[] = [
    { type: 'text', text: `${BASE}\n\n${tarifas}`, cache_control: { type: 'ephemeral' } },
  ]
  const ajustes = [
    cfg?.instrucciones?.trim() && `INSTRUCCIONES DEL OPERADOR (tienen prioridad sobre lo anterior, EXCEPTO las REGLAS DURAS de no inventar precios y de escalar):\n${cfg.instrucciones.trim()}`,
    cfg?.calibracion?.trim() && `GUÍA DE ESTILO APRENDIDA DE CONVERSACIONES REALES (orienta tono y respuestas; no contradice los precios ni las reglas duras):\n${cfg.calibracion.trim()}`,
  ].filter(Boolean).join('\n\n')
  if (ajustes) system.push({ type: 'text', text: ajustes })

  const res = await getClient().messages.create({ model: MODEL, max_tokens: 600, system, messages: mensajes })
  const text = res.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map(b => b.text).join('')
  return parseRespuesta(text)
}

const SYSTEM_CALIBRACION = `Eres analista de atención al cliente del Crematorio Alma Animal. Vas a recibir conversaciones reales de WhatsApp (Cliente = el tutor; Nosotros = nuestro equipo). Extrae una GUÍA DE CALIBRACIÓN accionable para un asistente automático que atiende este mismo canal.

Reglas:
- Español neutro, concreto, máximo ~450 palabras.
- Organiza en secciones: TONO Y ESTILO (con frases reales que usamos), PREGUNTAS FRECUENTES Y MEJOR RESPUESTA, OBJECIONES Y CÓMO LAS MANEJAMOS, QUÉ LLEVA A QUE EL CLIENTE AGENDE.
- NO inventes datos. Si ves precios, NO los cites como regla (los precios vienen de otra fuente, en vivo).
- Devuelve SOLO la guía, sin preámbulos.`

/** Analiza transcripciones reales y devuelve una guía de calibración (texto). */
export async function calibrarDesdeTranscripts(transcripts: string[]): Promise<string> {
  const corpus = transcripts.map((t, i) => `### Conversación ${i + 1}\n${t}`).join('\n\n').slice(0, 120000)
  const res = await getClient().messages.create({
    model: MODEL,
    max_tokens: 1500,
    system: SYSTEM_CALIBRACION,
    messages: [{ role: 'user', content: `Conversaciones reales a analizar (${transcripts.length}):\n\n${corpus}` }],
  })
  return res.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map(b => b.text).join('').trim()
}
