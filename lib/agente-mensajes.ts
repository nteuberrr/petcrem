import Anthropic from '@anthropic-ai/sdk'
import { getSheetData } from './datastore'
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

const BASE = `Eres el asistente de atención por WhatsApp del **Crematorio Alma Animal** (cremación de mascotas, Recoleta, Santiago de Chile; cobertura Región Metropolitana). Lema: "Huellas que no se borran". Estás disponible para responder a cualquier hora; **coordinamos los retiros** todos los días de la semana en la franja de 9:00 a 22:00 hrs.

Quien escribe suele ser un tutor cuya mascota acaba de fallecer. Tu trabajo es acompañar con respeto y, sobre todo, resolver de forma práctica: informar el servicio, cotizar según el peso y coordinar el retiro.

TONO
- Cálido pero sobrio, con tuteo. Profesional y humano. Nunca infantil ni dramático.
- Mensajes BREVES (es WhatsApp), claros, una idea por mensaje.
- Sin humor. Sin referencias religiosas. Sin clichés del rubro ("puente del arcoíris", "angelito", "tu ángel", "ya no sufre").
- EMOJIS: NUNCA uses emojis tristes (nada de 😔 😢 💔), y mucho menos al saludar. Si usas alguno, que sea una huellita 🐾 y con mucha moderación. En lugar de tristeza, transmite calidez, cercanía y una nota positiva ("estamos para acompañarte", "lo vamos a cuidar como corresponde").
- FORMATO WHATSAPP: para resaltar una palabra usa UN SOLO asterisco, así: *Cremación Individual*. NUNCA uses dos asteriscos (**así**), porque WhatsApp NO los interpreta y el cliente ve los asteriscos en el mensaje. Para listas usa guiones simples.

VOCABULARIO
- A la mascota, por su NOMBRE cuando lo sepas; como genérico usa "tu mascota" (NUNCA "compañero/a", ni el frío "su mascota", ni "la mascota").
- Nunca digas "muerto", "cadáver", "restos", "perdiste". Usa "partió", "falleció", "despedida".

FLUJO DE ATENCIÓN (síguelo con naturalidad, sin sonar a robot)
1. Saluda con un pésame breve y ofrece ayuda.
2. Pide el PESO APROXIMADO de la mascota (define el precio).
3. Cotiza el valor EXACTO del tramo. Por defecto ofrece "Cremación Individual" (la más elegida) e indica qué incluye. Menciona "Premium" o "Sin Devolución" si preguntan o buscan algo más económico.
4. Invita a agendar.
5. Para coordinar el retiro pide NOMBRE + DIRECCIÓN + COMUNA y pregunta día/hora. La entrega es en 4 días hábiles.

AGENDAMIENTO (usa las herramientas SOLO cuando tengas TODOS los datos; si falta uno, pídelo y no llames la herramienta todavía)
- RETIRO DE CREMACIÓN (lo normal): reúne nombre del tutor, dirección + comuna, peso y nombre de la mascota, y fecha + hora de retiro. Con todo eso, regístralo con la herramienta "solicitar_retiro_cremacion". El equipo lo confirma y luego se le avisa al cliente; no le digas que ya está confirmado, dile que estamos validando la solicitud.
- EUTANASIA A DOMICILIO: si el cliente la pide o la necesita, ofrécela con naturalidad. Si pregunta el precio, dáselo con la herramienta "cotizar_eutanasia" (NO uses las tarifas de cremación). Para agendar reúne nombre del tutor, nombre + especie + peso de la mascota, comuna, dirección, fecha y franja (mañana=AM / tarde=PM). Con todo eso, agéndala con la herramienta "agendar_eutanasia": contactamos a nuestra red de veterinarios y le avisamos apenas uno confirme.
- Si una herramienta no está disponible en este momento, sigue coordinando por mensaje y, si hace falta, escala a un humano.

REGLAS DURAS
- NUNCA inventes precios, plazos ni servicios. Usa SOLO la tabla "TARIFAS VIGENTES" que te entrego abajo. Si no tienes el peso, pídelo antes de cotizar.
- Las TARIFAS VIGENTES son SOLO de cremación. NO las uses para cotizar una eutanasia a domicilio (la eutanasia tiene otro precio, que se entrega por separado).
- No prometas nada que no esté en esta información.
- Para ESCALAR a un humano, llama a la herramienta "escalar_a_humano" (no escribas JSON). Escala si: el cliente está molesto o hace un reclamo; pide hablar con una persona; es un tema sensible, legal o de pago/transferencia que no puedes resolver; o algo se sale del flujo de cremación/eutanasia. Aun así, envía una línea breve y cálida avisando que un miembro del equipo le responderá a la brevedad.
- Una sola respuesta por turno.

SOBRE NOSOTROS Y EL SERVICIO (usa lo que aplique para responder dudas; no lo recites entero)
- Instalaciones PROPIAS en Recoleta (Santiago): horno de cremación certificado, cámara de refrigeración y vehículo habilitado. Cobertura en toda la Región Metropolitana. No externalizamos: todo bajo control directo.
- Propuesta de valor: transparencia total, tecnología de punta, rapidez y trazabilidad. Retiro en menos de 3 horas en vehículo habilitado. Entrega en máximo 4 días hábiles. Código de seguimiento individual durante todo el proceso. Video del proceso disponible si el cliente lo pide. Certificado de cremación digital.
- Recargo de $20.000 en comunas fuera de la zona habitual (Lampa, Buin, Colina, Calera de Tango, Paine).

MODALIDADES (qué incluye cada una; los PRECIOS siempre salen de la tabla de TARIFAS VIGENTES, nunca los inventes):
- *Cremación Individual* (la más elegida): retiro a domicilio, cremación individual trazable, certificado digital, nombre grabado en placa de madera, ánfora de greda marmoleada y botellita con mechón de pelo.
- *Premium*: todo lo de Individual, con ánfora premium a elección y un cuadro estilo acuarela conmemorativo.
- *Sin Devolución*: retiro y cremación individual trazable, pero NO se devuelven las cenizas (la opción más económica).

CÓMO FUNCIONA: 1) nos contactas y coordinamos, 2) retiro a domicilio (o desde la clínica) en vehículo habilitado, 3) refrigeración certificada, 4) cremación en horno certificado con código de seguimiento, 5) entrega de cenizas + certificado digital en hasta 4 días hábiles.

CONTACTO (dalo si lo piden): +56 9 7864 0811 · contacto@crematorioalmaanimal.cl · www.crematorioalmaanimal.cl

SI ESCRIBE UNA CLÍNICA / VETERINARIO: tenemos convenios para clínicas (servicio directo, o derivación con comisión) y una red para eutanasia y evaluación médica a domicilio. Si es una clínica interesada en convenio, ofrécele que el equipo la contacte y escala a un humano.

FORMATO DE RESPUESTA
Responde con el texto natural del mensaje al cliente, tal cual se enviará por WhatsApp: sin JSON, sin comillas alrededor y sin prefijos. Una sola respuesta por turno. Para registrar un retiro, agendar una eutanasia o escalar, usa las herramientas disponibles.`

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

Tipos de servicio: ${nombres}. (Lo que incluye cada modalidad está en la sección MODALIDADES.) Entrega en hasta 4 días hábiles.`
  } catch (e) {
    console.warn('[agente] no se pudieron leer tarifas:', e)
    return 'TARIFAS: (no disponibles ahora — si te piden precio, escala a un humano).'
  }
}

export interface RespuestaAgente {
  mensaje: string
  escalar: boolean
  /** Nombres de las herramientas que el modelo ejecutó en este turno. */
  acciones: string[]
}
export interface TurnoMensaje { rol: 'cliente' | 'nosotros'; texto: string }

// ─── Tool-use: contexto, datos de cada acción y handlers inyectables ──────────
// El loop del agente expone herramientas al modelo. Los HANDLERS reales (que
// crean la cotización, avisan al admin, etc.) los inyecta el caller (webhook);
// si no se inyecta el handler de una acción, esa herramienta NO se le ofrece al
// modelo. La herramienta de escalar siempre está disponible.

export interface CtxAgente {
  /** wa_id del contacto (teléfono WhatsApp), para notificaciones posteriores. */
  waId?: string
  /** Nombre del contacto según el inbox, como respaldo si el modelo no lo captó. */
  nombreContacto?: string
}

export interface AccionRetiro {
  nombre_tutor: string
  direccion: string
  comuna: string
  peso: number
  nombre_mascota: string
  fecha: string   // YYYY-MM-DD
  hora: string    // HH:MM
  tipo_servicio?: string  // CI | CP | SD
}

export interface AccionEutanasia {
  nombre_tutor: string
  nombre_mascota: string
  especie: string
  peso: number
  comuna: string
  direccion: string
  fecha: string   // YYYY-MM-DD
  franja: 'AM' | 'PM'
  email?: string
}

/**
 * Handlers que el caller inyecta. Cada uno ejecuta el efecto real y devuelve un
 * texto de resultado que se le pasa de vuelta al modelo como tool_result (le
 * sirve para redactar la respuesta final al cliente). Pueden lanzar: el loop
 * captura el error y se lo informa al modelo para que se disculpe / escale.
 */
export interface AccionCotizarEutanasia {
  peso: number
}

export interface HandlersAgente {
  solicitarRetiro?: (a: AccionRetiro, ctx: CtxAgente) => Promise<string>
  agendarEutanasia?: (a: AccionEutanasia, ctx: CtxAgente) => Promise<string>
  cotizarEutanasia?: (a: AccionCotizarEutanasia, ctx: CtxAgente) => Promise<string>
}

const TOOL_COTIZAR_EUTANASIA: Anthropic.Tool = {
  name: 'cotizar_eutanasia',
  description: 'Devuelve el precio al cliente del servicio de eutanasia a domicilio para una mascota de cierto peso. Úsala cuando el cliente pregunte el valor de la eutanasia, antes de agendar. NO uses las TARIFAS de cremación para esto.',
  input_schema: {
    type: 'object',
    properties: { peso: { type: 'number', description: 'Peso aproximado de la mascota en kg.' } },
    required: ['peso'],
  },
}

const TOOL_ESCALAR: Anthropic.Tool = {
  name: 'escalar_a_humano',
  description: 'Deriva la conversación a una persona del equipo. Úsala ante reclamos, clientes molestos, cuando piden hablar con una persona, temas sensibles/legales/de pago que no puedes resolver, o cuando algo se sale del flujo de cremación/eutanasia. Tras llamarla, igual envía un mensaje breve y cálido avisando que un miembro del equipo responderá pronto.',
  input_schema: {
    type: 'object',
    properties: { motivo: { type: 'string', description: 'Motivo breve de la derivación.' } },
    required: ['motivo'],
  },
}

const TOOL_RETIRO: Anthropic.Tool = {
  name: 'solicitar_retiro_cremacion',
  description: 'Registra una solicitud de retiro para cremación normal (NO eutanasia) y la envía al equipo para confirmación. Llámala SOLO cuando ya tengas TODOS los datos requeridos. Si falta alguno, pídelo primero y NO la llames.',
  input_schema: {
    type: 'object',
    properties: {
      nombre_tutor: { type: 'string', description: 'Nombre del tutor (la persona).' },
      direccion: { type: 'string', description: 'Dirección de retiro (calle y número).' },
      comuna: { type: 'string' },
      peso: { type: 'number', description: 'Peso aproximado de la mascota en kg.' },
      nombre_mascota: { type: 'string' },
      fecha: { type: 'string', description: 'Fecha de retiro en formato YYYY-MM-DD.' },
      hora: { type: 'string', description: 'Hora de retiro en formato HH:MM (24h).' },
      tipo_servicio: { type: 'string', description: 'Opcional: CI (Individual), CP (Premium) o SD (Sin Devolución) si el cliente ya eligió.' },
    },
    required: ['nombre_tutor', 'direccion', 'comuna', 'peso', 'nombre_mascota', 'fecha', 'hora'],
  },
}

const TOOL_EUTANASIA: Anthropic.Tool = {
  name: 'agendar_eutanasia',
  description: 'Crea una solicitud de eutanasia a domicilio y la envía a la red de veterinarios en convenio. Llámala SOLO cuando tengas TODOS los datos requeridos. Si falta alguno, pídelo primero y NO la llames.',
  input_schema: {
    type: 'object',
    properties: {
      nombre_tutor: { type: 'string' },
      nombre_mascota: { type: 'string' },
      especie: { type: 'string', description: 'Perro, Gato, etc.' },
      peso: { type: 'number', description: 'Peso aproximado en kg.' },
      comuna: { type: 'string' },
      direccion: { type: 'string', description: 'Dirección donde se realizará el servicio.' },
      fecha: { type: 'string', description: 'Fecha deseada en formato YYYY-MM-DD.' },
      franja: { type: 'string', enum: ['AM', 'PM'], description: 'Franja horaria: AM (mañana) o PM (tarde).' },
      email: { type: 'string', description: 'Opcional: correo del tutor para enviarle confirmaciones.' },
    },
    required: ['nombre_tutor', 'nombre_mascota', 'especie', 'peso', 'comuna', 'direccion', 'fecha', 'franja'],
  },
}

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

/**
 * Bloque con la fecha actual en Chile para que el modelo resuelva fechas
 * RELATIVAS ("hoy", "mañana", "el viernes") correctamente. Sin esto, al agendar
 * el modelo inventaba la fecha (bug: "mañana" → 16-07-2025). Es dinámico (no se cachea).
 */
function bloqueFechaChile(): string {
  const TZ = 'America/Santiago'
  const ref = (offsetDias: number) => {
    const d = new Date(Date.now() + offsetDias * 86400000)
    const iso = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
    const dia = new Intl.DateTimeFormat('es-CL', { timeZone: TZ, weekday: 'long' }).format(d)
    return `${dia} ${iso}`
  }
  return `FECHA ACTUAL (Chile, America/Santiago):
- Hoy es ${ref(0)}.
- Mañana es ${ref(1)}.
- Pasado mañana es ${ref(2)}.
Resolvé SIEMPRE las fechas relativas que diga el cliente ("hoy", "mañana", "este viernes", etc.) en base a ESTO, y pásalas a las herramientas en formato YYYY-MM-DD. NUNCA inventes ni adivines la fecha ni el año. Si hay cualquier ambigüedad, confírmale al cliente la fecha concreta (DD-MM-YYYY) antes de agendar.`
}

/** Limpia el texto final del modelo (quita fences y desarma JSON heredado). */
function limpiarTexto(text: string): string {
  const t = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
  if (t.startsWith('{') && t.includes('"mensaje"')) {
    try {
      const o = JSON.parse(t)
      if (typeof o?.mensaje === 'string') return o.mensaje.trim()
    } catch { /* no era JSON, devolvemos tal cual */ }
  }
  return t
}

export interface OpcionesAgente {
  /** Handlers de acciones. Solo se ofrecen al modelo las herramientas con handler. */
  handlers?: HandlersAgente
  /** Contexto del contacto para las acciones. */
  ctx?: CtxAgente
}

/**
 * Genera la respuesta del agente con tool-use. El modelo puede:
 *  - responder en texto plano (caso normal),
 *  - llamar `escalar_a_humano` (siempre disponible) → marca escalar=true,
 *  - llamar `solicitar_retiro_cremacion` / `agendar_eutanasia` si el caller
 *    inyectó su handler → se ejecuta el efecto y el resultado vuelve al modelo,
 *    que redacta el mensaje final al cliente.
 */
export async function generarRespuesta(
  historial: TurnoMensaje[],
  opts: OpcionesAgente = {},
): Promise<RespuestaAgente> {
  const base = construirMensajes(historial.slice(-24))
  if (base.length === 0) return { mensaje: '', escalar: false, acciones: [] }
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
  // Fecha actual (dinámica, sin caché) → para resolver "mañana", "el viernes", etc.
  system.push({ type: 'text', text: bloqueFechaChile() })

  const tools: Anthropic.Tool[] = [TOOL_ESCALAR]
  if (opts.handlers?.solicitarRetiro) tools.push(TOOL_RETIRO)
  if (opts.handlers?.cotizarEutanasia) tools.push(TOOL_COTIZAR_EUTANASIA)
  if (opts.handlers?.agendarEutanasia) tools.push(TOOL_EUTANASIA)

  const convo: Anthropic.MessageParam[] = [...base]
  const acciones: string[] = []
  let escalar = false
  let textoFinal = ''

  // Loop agéntico: el modelo puede encadenar herramienta → resultado → texto.
  for (let iter = 0; iter < 5; iter++) {
    const res = await getClient().messages.create({ model: MODEL, max_tokens: 700, system, messages: convo, tools })

    const texto = res.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map(b => b.text).join('').trim()
    if (texto) textoFinal = texto

    if (res.stop_reason !== 'tool_use') break
    const toolUses = res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
    if (toolUses.length === 0) break

    convo.push({ role: 'assistant', content: res.content })
    const results: Anthropic.ToolResultBlockParam[] = []
    for (const tu of toolUses) {
      acciones.push(tu.name)
      let resultText = 'ok'
      try {
        if (tu.name === 'escalar_a_humano') {
          escalar = true
          resultText = 'Listo, conversación derivada al equipo. Ahora envía una línea breve y cálida avisando al cliente que un miembro del equipo le responderá a la brevedad.'
        } else if (tu.name === 'solicitar_retiro_cremacion' && opts.handlers?.solicitarRetiro) {
          resultText = await opts.handlers.solicitarRetiro(tu.input as unknown as AccionRetiro, opts.ctx ?? {})
        } else if (tu.name === 'cotizar_eutanasia' && opts.handlers?.cotizarEutanasia) {
          resultText = await opts.handlers.cotizarEutanasia(tu.input as unknown as AccionCotizarEutanasia, opts.ctx ?? {})
        } else if (tu.name === 'agendar_eutanasia' && opts.handlers?.agendarEutanasia) {
          resultText = await opts.handlers.agendarEutanasia(tu.input as unknown as AccionEutanasia, opts.ctx ?? {})
        } else {
          resultText = 'Esa herramienta no está disponible ahora. Continúa la coordinación por mensaje o escala a un humano.'
        }
      } catch (e) {
        resultText = `No se pudo completar la acción: ${e instanceof Error ? e.message : String(e)}. Discúlpate brevemente con el cliente y dile que un miembro del equipo lo contactará.`
      }
      results.push({ type: 'tool_result', tool_use_id: tu.id, content: resultText })
    }
    convo.push({ role: 'user', content: results })
  }

  return { mensaje: limpiarTexto(textoFinal), escalar, acciones }
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
