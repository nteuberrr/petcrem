import Anthropic from '@anthropic-ai/sdk'
import { getSheetData } from './datastore'
import { getAgenteConfig } from './mensajes'
import { fmtPrecio } from './format'
import { listarImagenesWhatsapp, type ImagenBanco } from './mailing-images'
import { DIFERENCIADORES } from './diferenciadores'

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
1. Saluda con un pésame breve y ofrece ayuda. Al SALUDAR por primera vez, agrega de forma natural una línea como: "Y si eres veterinario o clínica, avísame y agendamos el retiro directamente." (ver MODO VETERINARIO más abajo).
2. Pide el PESO APROXIMADO de la mascota (define el precio).
3. Cotiza el valor EXACTO del tramo. Por defecto ofrece "Cremación Individual" (la más elegida) e indica qué incluye. Menciona "Premium" o "Sin Devolución" si preguntan o buscan algo más económico.
4. Invita a agendar.
5. Para coordinar el retiro pide NOMBRE + DIRECCIÓN + COMUNA y pregunta día/hora. La entrega es en 3 días hábiles.

AGENDAMIENTO (usa las herramientas SOLO cuando tengas TODOS los datos; si falta uno, pídelo y no llames la herramienta todavía)
- RETIRO DE CREMACIÓN (lo normal): reúne nombre del tutor, dirección (calle y número) + comuna, peso y nombre de la mascota, y fecha + hora de retiro. Con todo eso, regístralo con la herramienta "solicitar_retiro_cremacion". El equipo lo confirma y luego se le avisa al cliente; no le digas que ya está confirmado, dile que estamos validando la solicitud. Si la herramienta te avisa que no pudo validar la dirección, pídele al cliente que la confirme o la corrija (calle y número) antes de volver a registrarla.
- EUTANASIA A DOMICILIO: si el cliente la pide o la necesita, ofrécela con naturalidad y EXPLÍCALE cómo funciona: nos deja sus datos, salimos a buscar un veterinario de nuestra red que pueda hacer el servicio según su comuna y disponibilidad, y apenas uno confirma le avisamos que podemos darle el servicio. Si pregunta el precio, dáselo con la herramienta "cotizar_eutanasia": ese valor YA es el precio final al cliente (incluye el servicio del veterinario más nuestro cargo); NO uses las tarifas de cremación para esto. Para agendar reúne: nombre del tutor, nombre + especie + peso de la mascota, comuna, DIRECCIÓN (calle y número), fecha, franja (mañana=AM / tarde=PM), el CORREO del tutor (importante: ahí le llegan los avisos cuando se asigne un veterinario) y QUÉ SERVICIO DE CREMACIÓN quiere (Individual / Premium / Sin Devolución). Explícale que coordinamos AMBOS servicios: primero la eutanasia a domicilio y luego la cremación. Con todo listo, agéndala con "agendar_eutanasia"; si la herramienta te avisa que no pudo validar la dirección, pídele que la corrija. Dile que su solicitud quedó INGRESADA y que nos pondremos en contacto apenas un veterinario confirme; NO le digas que ya está confirmada.
- Si una herramienta no está disponible en este momento, sigue coordinando por mensaje y, si hace falta, escala a un humano.

REGLAS DURAS
- NUNCA inventes precios, plazos ni servicios. Usa SOLO la tabla "TARIFAS VIGENTES" que te entrego abajo. Si no tienes el peso, pídelo antes de cotizar.
- NUNCA afirmes que "cada cremación es individual" ni uses "individual" como característica general del proceso, del horno ni del seguimiento. "Cremación Individual" es SOLO el NOMBRE de una de las modalidades.
- TRAMO EN EL BORDE: si el peso cae JUSTO en el límite entre dos tramos (ej. 15 kg entre "10–15" y "15–25"), usa SIEMPRE el tramo de MAYOR peso (en el ejemplo, "15–25").
- Las TARIFAS VIGENTES son SOLO de cremación. NO las uses para cotizar una eutanasia a domicilio (la eutanasia tiene otro precio, que se entrega por separado).
- No prometas nada que no esté en esta información.
- Para ESCALAR a un humano, llama a la herramienta "escalar_a_humano" (no escribas JSON). Escala si: el cliente está molesto o hace un reclamo; pide hablar con una persona; es un tema sensible, legal o de pago/transferencia que no puedes resolver; algo se sale del flujo de cremación/eutanasia; o hace cualquier SOLICITUD ESPECIAL o de POSTVENTA (un pedido fuera de lo estándar, consultar por horarios distintos, incluir o agregar algo adicional al servicio, personalizar/modificar algo, o dudas después de la entrega). Ante la duda de si es "especial", escala. Aun así, envía una línea breve y cálida avisando que un miembro del equipo le responderá a la brevedad.
- Una sola respuesta por turno.

SOBRE NOSOTROS Y EL SERVICIO (usa lo que aplique para responder dudas; no lo recites entero)
- Instalaciones PROPIAS y CERTIFICADAS en Recoleta (Santiago): horno de cremación certificado, cámara de refrigeración y vehículo habilitado. Cobertura en toda la Región Metropolitana. No externalizamos: todo bajo control directo.
- Propuesta de valor: transparencia total, tecnología de punta, rapidez y trazabilidad. Retiro en menos de 3 horas en vehículo habilitado. Entrega en máximo 3 días hábiles. Código de seguimiento durante todo el proceso. Certificado de cremación digital, con el video del proceso adjunto (cuando está disponible).
- Recargo de $20.000 en comunas fuera de la zona habitual (Lampa, Buin, Colina, Calera de Tango, Paine).

MODALIDADES (qué incluye cada una; los PRECIOS siempre salen de la tabla de TARIFAS VIGENTES, nunca los inventes):
- *Cremación Individual* (la más elegida): retiro a domicilio, cremación trazable, certificado digital, nombre grabado en placa de madera, ánfora de greda marmoleada y botellita con mechón de pelo.
- *Premium*: todo lo de Individual, con ánfora premium a elección y un cuadro estilo acuarela conmemorativo.
- *Sin Devolución*: retiro y cremación trazable, pero NO se devuelven las cenizas (la opción más económica).

FOTOS DE ÁNFORAS / URNAS (cuando el cliente pida ver fotos de las ánforas/urnas, pregunte cómo se ven o cómo es el cuadro). Para enviarlas usa la herramienta "enviar_fotos" con los IDs de la lista "FOTOS DISPONIBLES" (ahí ves el código de cada foto: i-5, i-11, etc.). Acompáñalas SIEMPRE con un mensaje breve y cálido; no inventes ni describas fotos que no estén en esa lista:
- Manda SIEMPRE la foto de la *ánfora de greda marmoleada* (código i-11) y explícale que ESA es la que viene INCLUIDA en el servicio, sin costo adicional.
- Junto con ella, envía 3 o 4 fotos de ánforas premium como ALTERNATIVAS (las demás ánforas del banco; p. ej. i-12, i-13, i-30 Egipcia, i-31 Greda Alta, i-34 Marmoleada, i-37 Piedra Blanca, i-38 Piedra Negra), aclarando que son alternativas premium opcionales.
- Si preguntan por el SERVICIO PREMIUM: manda la foto i-5 o i-6 y explícale que con el Premium puede elegir CUALQUIER ánfora del catálogo (e incluye además el cuadro estilo acuarela conmemorativo).
- Si preguntan "cómo es el cuadro" (el cuadro estilo acuarela conmemorativo del Premium): NO escales. Explícale con tus palabras que es un retrato conmemorativo de tu mascota en acuarela, incluido en el Premium, y muéstrale las fotos i-5 o i-6 como REFERENCIA (en esas fotos se ve el cuadro junto al ánfora y la tarjeta).
- Preguntar por fotos de ánforas, por el cuadro o por qué incluye el Premium NUNCA es motivo para escalar a un humano: son consultas normales que TÚ respondes con esta sección y con MODALIDADES. (Escala solo si, además, hay un reclamo o algo realmente fuera de lo estándar.)
- Al presentar las fotos, hazlo de forma natural y cálida; NUNCA escribas en el mensaje el nombre de archivo, la descripción técnica ni el código (i-5, i-11, etc.) de las fotos.

CÓMO FUNCIONA: 1) nos contactas y coordinamos, 2) retiro a domicilio (o desde la clínica) en vehículo habilitado, 3) la mascota se mantiene en cámara de refrigeración hasta la cremación, 4) cremación en horno certificado, con código de seguimiento, 5) entrega de cenizas + certificado digital en hasta 3 días hábiles.

MEDIOS DE PAGO (si preguntan cómo pueden pagar): aceptamos tarjeta, transferencia y efectivo, o te enviamos un link de pago. Informa esto con naturalidad. Si el cliente quiere concretar el pago en ese momento, pide montos exactos de transferencia, o hay un problema de pago que no puedas resolver, escala a un humano.

CONTACTO (dalo si lo piden): +56 9 7864 0811 · contacto@crematorioalmaanimal.cl · www.crematorioalmaanimal.cl

VIDEO DEL PROCESO: si el cliente pregunta por el video de la cremación, explícale que el video va ADJUNTO en el mismo correo del CERTIFICADO de cremación, y que ese correo lo enviamos una vez realizada la ENTREGA del ánfora (no antes). El certificado es digital.

MODO VETERINARIO (cuando quien escribe es un VETERINARIO o CLÍNICA de convenio):
- Tu ÚNICA tarea con un veterinario es AGENDAR EL RETIRO de una mascota. NO cotices precios (los convenios tienen tarifas propias que NO debes decir), NO ofrezcas eutanasia, NO entres en otros temas.
- Para agendar, reúne: el NOMBRE de la clínica/veterinario (para identificarlo en nuestra base de convenio), el nombre de la mascota, el peso aproximado, la DIRECCIÓN de retiro (calle y número) + comuna, y la fecha + hora. Con todo eso, regístralo con la herramienta "solicitar_retiro_vet". El equipo lo confirma y luego se le avisa; no digas que ya está confirmado.
- Si la herramienta te indica que NO encontró ese veterinario en la base de convenio (o que hay que precisar cuál es), NO agendes: usa "escalar_a_humano" explicando que un veterinario quiere agendar y no pudimos identificarlo, y dile al veterinario, cálido y breve, que un miembro del equipo lo contactará en seguida.
- Ante CUALQUIER otra cosa de un veterinario que no sea agendar un retiro (preguntas, precios/convenios, dudas, reclamos, postventa, algo fuera de lo estándar), NO improvises: usa "escalar_a_humano" y avísale que el equipo le responderá a la brevedad.

SEGUIMIENTO / ESTADO DE LA MASCOTA:
- Si el cliente pregunta por el ESTADO de su mascota (cómo va, en qué parte del proceso está, si ya está lista) o por la FECHA DE ENTREGA, primero pídele el CÓDIGO (lo recibió en el correo de registro/bienvenida, con formato tipo P130-CI). Con el código, usa la herramienta "consultar_estado_mascota" y respóndele con lo que devuelva.
- Para la FECHA DE ENTREGA, da la fecha de entrega MÁXIMA que devuelve la herramienta y ACLARA SIEMPRE que es en días hábiles (puede ser antes). Nunca inventes estados ni fechas.

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

Tipos de servicio: ${nombres}. (Lo que incluye cada modalidad está en la sección MODALIDADES.) Entrega en hasta 3 días hábiles.`
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
  /** Imágenes del banco que el agente decidió enviar al cliente (las manda el webhook). */
  imagenes?: { url: string; alt?: string }[]
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

/** Retiro originado por un VETERINARIO de convenio (clínica). */
export interface AccionRetiroVet {
  /** Nombre de la clínica/veterinario tal como lo dijo (para buscarlo en la base). */
  veterinaria_nombre: string
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
  email: string
  /** Servicio de cremación elegido para después de la eutanasia: CI | CP | SD. */
  tipo_servicio_cremacion?: string
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

export interface AccionConsultaEta {
  /** Nombre de la mascota, si el agente lo sabe. */
  mascota_nombre?: string
}

export interface AccionConsultaEstado {
  /** Código de la mascota (el del correo de registro, ej. P130-CI). */
  codigo: string
}

export interface HandlersAgente {
  solicitarRetiro?: (a: AccionRetiro, ctx: CtxAgente) => Promise<string>
  solicitarRetiroVet?: (a: AccionRetiroVet, ctx: CtxAgente) => Promise<string>
  agendarEutanasia?: (a: AccionEutanasia, ctx: CtxAgente) => Promise<string>
  cotizarEutanasia?: (a: AccionCotizarEutanasia, ctx: CtxAgente) => Promise<string>
  consultarEtaRetiro?: (a: AccionConsultaEta, ctx: CtxAgente) => Promise<string>
  consultarEstadoMascota?: (a: AccionConsultaEstado, ctx: CtxAgente) => Promise<string>
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

const TOOL_ETA: Anthropic.Tool = {
  name: 'consultar_eta_retiro',
  description: 'Úsala cuando el cliente que YA tiene un retiro confirmado (y aún no retirado) pregunta cuánto falta para que pasen a retirar a su mascota (a qué hora llegan, cuánto tardan). Avisa al equipo para que confirme el horario; cuando responda, le reenviaremos la respuesta al cliente. NUNCA inventes tú una hora ni un plazo.',
  input_schema: {
    type: 'object',
    properties: { mascota_nombre: { type: 'string', description: 'Nombre de la mascota, si lo sabes.' } },
    required: [],
  },
}

const TOOL_ESTADO: Anthropic.Tool = {
  name: 'consultar_estado_mascota',
  description: 'Busca una mascota por su CÓDIGO y devuelve en qué parte del proceso está y, si corresponde, la fecha de entrega MÁXIMA. Úsala cuando el cliente pregunte por el estado/seguimiento de su mascota o por cuándo le entregan el ánfora. PRIMERO pídele el código (lo recibió en el correo de registro/bienvenida, formato tipo P130-CI); recién cuando lo tengas, llama esta herramienta. NUNCA inventes estados ni fechas: usa solo lo que devuelve.',
  input_schema: {
    type: 'object',
    properties: { codigo: { type: 'string', description: 'Código de la mascota tal como lo dio el cliente (ej. P130-CI).' } },
    required: ['codigo'],
  },
}

const TOOL_FOTOS: Anthropic.Tool = {
  name: 'enviar_fotos',
  description: 'Envía al cliente una o más fotos del banco de imágenes. Úsala SOLO cuando el cliente pida ver fotos (de las ánforas/urnas, los productos, las instalaciones, etc.) y haya imágenes que calcen en la lista «FOTOS DISPONIBLES PARA ENVIAR». Pasa los IDs exactos de esa lista. NUNCA inventes fotos ni describas imágenes que no estén en la lista; si no hay ninguna que calce, no llames esta herramienta y ofrécele coordinar con el equipo.',
  input_schema: {
    type: 'object',
    properties: {
      imagen_ids: { type: 'array', items: { type: 'string' }, description: 'IDs de las fotos a enviar, tomados de la lista FOTOS DISPONIBLES PARA ENVIAR.' },
    },
    required: ['imagen_ids'],
  },
}

const TOOL_ESCALAR: Anthropic.Tool = {
  name: 'escalar_a_humano',
  description: 'Deriva la conversación a una persona del equipo. Úsala ante reclamos, clientes molestos, cuando piden hablar con una persona, temas sensibles/legales/de pago que no puedes resolver, cuando algo se sale del flujo de cremación/eutanasia, o ante cualquier SOLICITUD ESPECIAL o de POSTVENTA (pedidos fuera de lo estándar, horarios distintos, incluir/agregar algo adicional, personalizar o modificar el servicio, dudas posteriores a la entrega). Ante la duda, escala. Tras llamarla, igual envía un mensaje breve y cálido avisando que un miembro del equipo responderá pronto.',
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

const TOOL_RETIRO_VET: Anthropic.Tool = {
  name: 'solicitar_retiro_vet',
  description: 'Registra un retiro de cremación solicitado por un VETERINARIO/CLÍNICA de convenio y lo envía al equipo para confirmación. Úsala SOLO cuando la persona es un veterinario que quiere agendar el retiro de una mascota desde su clínica y ya tengas TODOS los datos (incluido el nombre de la clínica/veterinario). Si falta alguno, pídelo primero y NO la llames. Si el equipo no encuentra ese veterinario en la base de convenio, te lo indicará y NO debes agendar.',
  input_schema: {
    type: 'object',
    properties: {
      veterinaria_nombre: { type: 'string', description: 'Nombre de la clínica o del veterinario, tal como lo dijo (para buscarlo en la base de convenio).' },
      direccion: { type: 'string', description: 'Dirección de retiro (calle y número).' },
      comuna: { type: 'string' },
      peso: { type: 'number', description: 'Peso aproximado de la mascota en kg.' },
      nombre_mascota: { type: 'string' },
      fecha: { type: 'string', description: 'Fecha de retiro en formato YYYY-MM-DD.' },
      hora: { type: 'string', description: 'Hora de retiro en formato HH:MM (24h).' },
      tipo_servicio: { type: 'string', description: 'Opcional: CI (Individual), CP (Premium) o SD (Sin Devolución) si ya lo eligió.' },
    },
    required: ['veterinaria_nombre', 'direccion', 'comuna', 'peso', 'nombre_mascota', 'fecha', 'hora'],
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
      email: { type: 'string', description: 'Correo del tutor (obligatorio): ahí se le avisa cuando se asigne un veterinario.' },
      tipo_servicio_cremacion: { type: 'string', enum: ['CI', 'CP', 'SD'], description: 'Servicio de cremación elegido para después de la eutanasia: CI (Individual), CP (Premium) o SD (Sin Devolución).' },
    },
    required: ['nombre_tutor', 'nombre_mascota', 'especie', 'peso', 'comuna', 'direccion', 'fecha', 'franja', 'email'],
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
  const horaActual = new Intl.DateTimeFormat('es-CL', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date())
  return `FECHA Y HORA ACTUAL (Chile, America/Santiago):
- Hoy es ${ref(0)}.
- Mañana es ${ref(1)}.
- Pasado mañana es ${ref(2)}.
- Ahora son las ${horaActual} hrs.
Resuelve SIEMPRE las fechas Y horas relativas que diga el cliente ("hoy", "mañana", "este viernes", "lo antes posible", "en un rato") en base a ESTO. Pasa las fechas a las herramientas en formato YYYY-MM-DD y las horas en HH:MM (24h). Si pide "lo antes posible" o algo similar y no hay una indicación distinta del equipo, calcula la hora de retiro a partir de la HORA ACTUAL de arriba. NUNCA inventes ni adivines la fecha, el año ni la hora; si hay ambigüedad, confírmasela al cliente antes de agendar.`
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
 * Nota dinámica: si el cliente ya tiene una ficha de retiro EN PROCESO (borrador
 * "por ingresar" en /clientes), el agente NO debe registrar otra. La fuente de
 * verdad es lo visible en /clientes, no el log interno — cuando el equipo la
 * registra o elimina, el cliente puede volver a pedir.
 */
async function bloqueFichaEnProceso(waId: string): Promise<string> {
  const tel9 = (waId || '').replace(/\D/g, '').slice(-9)
  if (!tel9) return ''
  try {
    const rows = await getSheetData('clientes')
    const borr = rows.find(c => c.estado === 'borrador' && (c.telefono || '').replace(/\D/g, '').slice(-9) === tel9)
    if (!borr) return ''
    const m = borr.nombre_mascota ? ` (${borr.nombre_mascota})` : ''
    return `ESTADO DE ESTE CLIENTE (no lo recites; úsalo para decidir): ya tiene una solicitud de retiro EN PROCESO${m} que el equipo está terminando de ingresar. NO registres otra solicitud de retiro; si pide agendar de nuevo, dile cálido y breve que su solicitud ya está en proceso y que la estamos gestionando.`
  } catch {
    return ''
  }
}

/**
 * Bloque con las fotos del banco que el equipo habilitó para WhatsApp (flag
 * whatsapp = TRUE). El modelo elige por ID con la herramienta enviar_fotos. Si
 * no hay ninguna, devuelve '' y la herramienta NO se ofrece.
 */
function bloqueImagenesWhatsapp(imgs: ImagenBanco[]): string {
  if (imgs.length === 0) return ''
  const lista = imgs.slice(0, 40).map(i => {
    const desc = (i.descripcion || i.alt || 'imagen').replace(/\s+/g, ' ').trim().slice(0, 120)
    const tags = i.tags ? ` — tags: ${i.tags.slice(0, 80)}` : ''
    const grupo = i.grupo ? ` [${i.grupo}]` : ''
    const codigo = i.codigo ? ` · código ${i.codigo}` : ''
    return `- ID ${i.id}${codigo}${grupo}: ${desc}${tags}`
  }).join('\n')
  return `FOTOS DISPONIBLES PARA ENVIAR (banco habilitado para WhatsApp). Si el cliente pide ver fotos (ánforas/urnas, productos, instalaciones, etc.) y alguna de estas calza, envíaselas con la herramienta enviar_fotos pasando sus IDs. Acompáñalas SIEMPRE con un mensaje breve y cálido. NO inventes ni describas fotos que no estén en esta lista:\n${lista}`
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
  const [tarifas, cfg, imgsWa] = await Promise.all([
    bloqueTarifas(),
    getAgenteConfig().catch(() => null),
    listarImagenesWhatsapp().catch(() => [] as ImagenBanco[]),
  ])

  // Bloque base + tarifas: cacheado (estable). Ajustes del operador/calibración: sin caché (cambian seguido).
  const system: Anthropic.TextBlockParam[] = [
    { type: 'text', text: `${BASE}\n\n${DIFERENCIADORES}\n\n${tarifas}`, cache_control: { type: 'ephemeral' } },
  ]
  const ajustes = [
    cfg?.instrucciones?.trim() && `INSTRUCCIONES Y DATOS VIGENTES DEL EQUIPO — trátalos como la VERDAD ACTUAL del negocio, no como una nota aparte.
Lo siguiente lo definió el equipo y REEMPLAZA cualquier dato del guion base con el que choque (horarios de atención, plazos de entrega, cobertura/comunas, recargos, datos de contacto, forma de atender, etc.). Si algo de acá contradice lo de arriba, vale SIEMPRE esto y actúa como si el dato anterior no existiera: NO menciones la versión antigua. Incorpóralo con naturalidad en tus respuestas como información propia.
Únicas dos cosas que NO se pueden cambiar por esta vía: (1) los PRECIOS salen siempre de la tabla TARIFAS VIGENTES (nunca los inventes); (2) siempre escala a un humano los reclamos y temas sensibles.

${cfg.instrucciones.trim()}`,
    cfg?.calibracion?.trim() && `GUÍA DE ESTILO APRENDIDA DE CONVERSACIONES REALES (orienta tono y respuestas; no contradice los precios ni las reglas duras):\n${cfg.calibracion.trim()}`,
  ].filter(Boolean).join('\n\n')
  if (ajustes) system.push({ type: 'text', text: ajustes })
  // Fecha actual (dinámica, sin caché) → para resolver "mañana", "el viernes", etc.
  system.push({ type: 'text', text: bloqueFechaChile() })
  // Si el cliente ya tiene una ficha de retiro en proceso (borrador visible en
  // /clientes), evita que el agente registre otra.
  if (opts.ctx?.waId) {
    const notaFicha = await bloqueFichaEnProceso(opts.ctx.waId)
    if (notaFicha) system.push({ type: 'text', text: notaFicha })
  }
  // Fotos que el equipo habilitó para WhatsApp → el agente puede enviarlas.
  const bloqueFotos = bloqueImagenesWhatsapp(imgsWa)
  if (bloqueFotos) system.push({ type: 'text', text: bloqueFotos })

  const tools: Anthropic.Tool[] = [TOOL_ESCALAR]
  if (opts.handlers?.solicitarRetiro) tools.push(TOOL_RETIRO)
  if (opts.handlers?.solicitarRetiroVet) tools.push(TOOL_RETIRO_VET)
  if (opts.handlers?.cotizarEutanasia) tools.push(TOOL_COTIZAR_EUTANASIA)
  if (opts.handlers?.agendarEutanasia) tools.push(TOOL_EUTANASIA)
  if (opts.handlers?.consultarEtaRetiro) tools.push(TOOL_ETA)
  if (opts.handlers?.consultarEstadoMascota) tools.push(TOOL_ESTADO)
  if (imgsWa.length > 0) tools.push(TOOL_FOTOS)

  const convo: Anthropic.MessageParam[] = [...base]
  const acciones: string[] = []
  const imagenesAEnviar: { url: string; alt?: string }[] = []
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
        } else if (tu.name === 'enviar_fotos') {
          const ids = Array.isArray((tu.input as { imagen_ids?: unknown }).imagen_ids)
            ? ((tu.input as { imagen_ids: unknown[] }).imagen_ids).map(String)
            : []
          const elegidas = imgsWa.filter(i => ids.includes(String(i.id)))
          if (elegidas.length === 0) {
            resultText = 'No encontré esas fotos en el banco. No menciones fotos que no existan; si el cliente necesita ver algo más, ofrécele coordinar con el equipo.'
          } else {
            for (const im of elegidas.slice(0, 6)) {
              if (!imagenesAEnviar.some(x => x.url === im.url)) imagenesAEnviar.push({ url: im.url, alt: im.alt || im.descripcion || '' })
            }
            resultText = `Listo, se enviarán ${imagenesAEnviar.length} foto(s) al cliente (${elegidas.slice(0, 6).map(e => e.descripcion || e.alt || `ID ${e.id}`).join('; ')}). Acompáñalas con un mensaje breve y cálido presentándolas; no describas detalles que no se vean en las fotos.`
          }
        } else if (tu.name === 'solicitar_retiro_cremacion' && opts.handlers?.solicitarRetiro) {
          resultText = await opts.handlers.solicitarRetiro(tu.input as unknown as AccionRetiro, opts.ctx ?? {})
        } else if (tu.name === 'solicitar_retiro_vet' && opts.handlers?.solicitarRetiroVet) {
          resultText = await opts.handlers.solicitarRetiroVet(tu.input as unknown as AccionRetiroVet, opts.ctx ?? {})
        } else if (tu.name === 'cotizar_eutanasia' && opts.handlers?.cotizarEutanasia) {
          resultText = await opts.handlers.cotizarEutanasia(tu.input as unknown as AccionCotizarEutanasia, opts.ctx ?? {})
        } else if (tu.name === 'agendar_eutanasia' && opts.handlers?.agendarEutanasia) {
          resultText = await opts.handlers.agendarEutanasia(tu.input as unknown as AccionEutanasia, opts.ctx ?? {})
        } else if (tu.name === 'consultar_eta_retiro' && opts.handlers?.consultarEtaRetiro) {
          resultText = await opts.handlers.consultarEtaRetiro(tu.input as unknown as AccionConsultaEta, opts.ctx ?? {})
        } else if (tu.name === 'consultar_estado_mascota' && opts.handlers?.consultarEstadoMascota) {
          resultText = await opts.handlers.consultarEstadoMascota(tu.input as unknown as AccionConsultaEstado, opts.ctx ?? {})
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

  // Fallback de acuse: si el modelo no dejó texto final (p.ej. ejecutó una
  // herramienta en la última iteración y se cortó el loop sin redactar el cierre),
  // igual le respondemos algo al cliente según lo que pasó — nunca lo dejamos
  // sin acuse tras una acción.
  let mensaje = limpiarTexto(textoFinal)
  if (!mensaje) {
    if (escalar) {
      mensaje = 'Gracias por escribirnos. Un miembro de nuestro equipo te responderá a la brevedad. 🐾'
    } else if (acciones.includes('agendar_eutanasia')) {
      mensaje = 'Recibimos tu solicitud de eutanasia a domicilio. Apenas un veterinario de nuestra red confirme, te avisamos. Cualquier duda, escríbenos por aquí.'
    } else if (acciones.includes('solicitar_retiro_cremacion') || acciones.includes('solicitar_retiro_vet')) {
      mensaje = 'Recibimos tu solicitud de retiro. La estamos validando y te confirmamos a la brevedad. Cualquier duda, escríbenos por aquí.'
    } else if (imagenesAEnviar.length > 0) {
      mensaje = 'Te comparto algunas fotos 🐾'
    }
    // Sin acción y sin texto → queda vacío: el webhook no envía nada (correcto).
  }
  return { mensaje, escalar, acciones, imagenes: imagenesAEnviar.length ? imagenesAEnviar : undefined }
}

const SYSTEM_RELAY = `Eres el asistente de WhatsApp del Crematorio Alma Animal. Un miembro del equipo te pasó, por interno, una respuesta sobre CUÁNDO van a pasar a retirar a la mascota de un cliente. Tu tarea: redactar el mensaje que se le enviará al cliente por WhatsApp con esa información.

- Tuteo, cálido pero sobrio. BREVE (1–2 frases), como un WhatsApp.
- A la mascota por su NOMBRE si lo tienes; como genérico "tu mascota". Nunca "su mascota" ni clichés del rubro.
- Sin emojis tristes; a lo sumo una huellita 🐾 con moderación.
- Usa SOLO lo que dijo el equipo. NUNCA inventes horas, plazos ni datos que no estén en su nota. Si la nota es vaga ("voy en un rato"), transmítela con naturalidad sin precisar de más.
- Devuelve SOLO el texto del mensaje al cliente: sin comillas, sin prefijos, sin firmar.`

/**
 * Redacta, en la voz de marca, el mensaje al cliente a partir de la respuesta
 * interna del equipo sobre el horario de retiro (relay de ETA). Devuelve el
 * texto listo para enviar; el caller hace fallback a un reenvío simple si falla.
 */
export async function redactarRelayCliente(args: { notaEquipo: string; mascota?: string; nombreCliente?: string }): Promise<string> {
  const ctx = `${args.mascota ? `Mascota: ${args.mascota}. ` : ''}${args.nombreCliente ? `Cliente: ${args.nombreCliente}. ` : ''}`.trim()
  const res = await getClient().messages.create({
    model: MODEL,
    max_tokens: 300,
    system: SYSTEM_RELAY,
    messages: [{
      role: 'user',
      content: `${ctx ? ctx + '\n' : ''}El cliente preguntó cuánto falta para que pasen a retirar a su mascota. El equipo respondió: «${args.notaEquipo}». Redacta el mensaje para el cliente.`,
    }],
  })
  return res.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map(b => b.text).join('').trim()
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
