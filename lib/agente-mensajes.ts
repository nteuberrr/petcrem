import Anthropic from '@anthropic-ai/sdk'
import { getSheetData } from './google-sheets'
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
  const tarifas = await bloqueTarifas()
  const res = await getClient().messages.create({
    model: MODEL,
    max_tokens: 600,
    system: [{ type: 'text', text: `${BASE}\n\n${tarifas}`, cache_control: { type: 'ephemeral' } }],
    messages: mensajes,
  })
  const text = res.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map(b => b.text).join('')
  return parseRespuesta(text)
}
