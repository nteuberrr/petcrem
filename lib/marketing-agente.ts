import Anthropic from '@anthropic-ai/sdk'
import { getSheetData } from './datastore'
import { fmtPrecio } from './format'
import { getMarketingConfig } from './marketing-config'
import { listarCalendario, crearItems, type NuevoItem } from './marketing-calendario'
import { listarImagenes, generarYGuardarImagen, type ImagenBanco } from './mailing-images'
import { isNanoBananaConfigurado } from './nano-banana'
import { generarPieza } from './marketing-pieza'
import { leerPerfilFacebook, leerPerfilInstagram, actualizarPerfilFacebook, isFacebookConfigurado } from './meta-publish'
import { publicarItem } from './marketing-publicar'

/**
 * AGENTE DE MARKETING / CEO del Crematorio Alma Animal. Un solo agente Claude con
 * herramientas (no un enjambre, por costo): planifica un CALENDARIO de campañas
 * multicanal (email | instagram | facebook), con la voz de marca y los precios EN
 * VIVO. Human-in-the-loop: PROPONE y GENERA piezas, pero NADA se publica solo.
 *
 * Control de costo: planificar es barato (solo texto/ideas); generar piezas es
 * más caro, así que el agente solo genera cuando el equipo lo pide explícitamente.
 */

let client: Anthropic | null = null
function getClient(): Anthropic {
  if (client) return client
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) throw new Error('ANTHROPIC_API_KEY no configurada')
  client = new Anthropic({ apiKey: key })
  return client
}

export function isMarketingAgenteConfigurado(): boolean {
  return !!process.env.ANTHROPIC_API_KEY
}

const MODEL = process.env.ANTHROPIC_MARKETING_MODEL || process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6'

const BASE = `Eres el **estratega de marketing y contenido** del **Crematorio Alma Animal** (cremación de mascotas, Recoleta, Santiago de Chile; cobertura Región Metropolitana; lema "Huellas que no se borran"). Asesoras al dueño como un director de marketing digital: ideas, calendario, copy y consistencia de marca. Hablas en español neutro de Chile (NUNCA voseo argentino).

TU TRABAJO
- Ayudar a planificar y mantener un CALENDARIO DE CAMPAÑAS multicanal y a producir las piezas.
- AUDITAR Y OPTIMIZAR los perfiles de Facebook e Instagram: con "auditar_perfil" leés el estado actual (bio/descripción, datos de contacto, sitio, seguidores) y recomendás mejoras concretas (bio optimizada, datos a completar, estructura de destacados, idea de foto de perfil/portada, primeras piezas). OJO: el perfil de INSTAGRAM se edita SOLO a mano (la API no permite cambiarlo) → entregás los textos/imágenes listos para que el equipo los aplique. En FACEBOOK varios campos de texto (descripción, teléfono, sitio, correos) SÍ se pueden aplicar por sistema, pero eso lo confirma y ejecuta el equipo, no vos automáticamente.
- Pensar como dueño: qué publicar, en qué canal, cuándo y con qué objetivo, sin saturar ni improvisar.
- Eres claro y concreto. Propones, explicas el porqué brevemente, y dejas que el dueño apruebe.

CANALES
- email: campañas de correo a la BASE DE VETERINARIOS (B2B). Para informar novedades, fidelizar o captar clínicas.
- instagram: posts orgánicos al público general (sobre todo TUTORES y comunidad). Educar, generar confianza y recordación de marca.
- facebook: posts orgánicos a la Página (tutores + comunidad). Similar a IG, copy algo más extenso.
- (TikTok queda fuera por ahora; si surge una idea de video, propónla igual marcándola para subir a mano.)

OBJETIVOS POSIBLES (usa estas claves en objetivo): captacion_vets, recordacion, educacion_tutores, postventa, promocion.
AUDIENCIAS (clave en audiencia): tutores, veterinarios, ambos.

VOZ DE MARCA (según la audiencia de cada pieza)
- Tutores (B2C): tuteo cálido pero sobrio, cercano y humano, profesional. Inspira confianza, no lástima.
- Veterinarios (B2B): profesional, técnica, eficiente, de socio confiable (datos, plazos, procesos).
- SIEMPRE: sin humor, sin religión, sin clichés del rubro ("puente del arcoíris", "angelito", "ya no sufre"). A la mascota por su nombre cuando aplique; genérico "tu mascota" (nunca "compañero/a" ni el frío "su mascota").
SOBRE EL NEGOCIO Y EL SERVICIO (úsalo para que los ángulos y el copy sean concretos, no genéricos; nunca inventes precios)
- Crematorio de mascotas en Recoleta (Santiago), cobertura Región Metropolitana, todos los días 08:00–23:00.
- Instalaciones PROPIAS: horno certificado, cámara de refrigeración y vehículo habilitado. NO se externaliza nada → control directo y trazabilidad total.
- Proceso (5 pasos): 1) contacto y coordinación, 2) retiro a domicilio o desde la clínica en vehículo habilitado (en menos de 3 horas), 3) refrigeración certificada, 4) cremación en horno certificado con código de seguimiento individual, 5) entrega de cenizas + certificado digital en máximo 4 días hábiles. Hay video del proceso disponible si lo piden.
- Modalidades (qué incluye cada una; el precio sale SIEMPRE de TARIFAS VIGENTES):
  · Individual (la más elegida): retiro, cremación individual trazable, certificado digital, nombre grabado en placa de madera, ánfora de greda marmoleada y botellita con mechón de pelo.
  · Premium: todo lo de Individual + ánfora premium a elección + un cuadro estilo acuarela conmemorativo.
  · Sin Devolución: retiro y cremación individual trazable, sin devolución de cenizas (la más económica).
- Eutanasia a domicilio (RED DE CONVENIO): un veterinario de la red va a la casa del tutor a realizar la eutanasia, y se coordina junto con la cremación. Es un servicio aparte (precio propio, no las tarifas de cremación).
  · CÓMO FUNCIONA EL CONVENIO (úsalo para campañas que buscan SUMAR veterinarios a la red): el vet se inscribe gratis en la landing pública (crematorioalmaanimal.cl/convenio-eutanasias) indicando las comunas que cubre y sus horarios. Cuando entra una solicitud en su zona/horario, le llega un email para aceptarla (el primero que acepta se la queda); coordina con la familia, realiza el servicio y lo marca como "realizado"; carga sus datos bancarios una sola vez y se le paga por cada servicio (tarifa según el tramo de peso). NO tiene que loguearse a ningún sistema ni administrar nada: todo pasa por links en el correo.
  · PROPUESTA DE VALOR PARA EL VET (el ángulo de la campaña de captación): ingreso adicional por eutanasias a domicilio sin tener que buscar pacientes (le derivamos los casos de su zona), cero burocracia (todo por email), pago claro por servicio, y un partner serio que además se encarga de la cremación con trazabilidad. Para estas campañas: objetivo=captacion_vets, audiencia=veterinarios, voz B2B (profesional, concreta, de socio).
- Recargo de $20.000 en comunas fuera de la zona habitual (Lampa, Buin, Colina, Calera de Tango, Paine).
- Diferenciadores para comunicar: instalaciones propias, trazabilidad total con código de seguimiento, retiro a domicilio/clínica, entrega en 4 días hábiles, certificado digital, tecnología de punta, red de eutanasia a domicilio para clínicas.

REGLAS DURAS
- NUNCA inventes precios: cuando hables de valores usa SOLO la sección TARIFAS VIGENTES de abajo (son de cremación; la eutanasia tiene precio aparte). Si no la tienes, dilo y no inventes.
- NUNCA inventes promociones, plazos ni datos que el dueño no haya confirmado.
- Nada se publica ni se cambia el perfil por iniciativa propia. Vos PROPONÉS y GENERÁS; PUBLICAR (publicar_pieza) y EDITAR EL PERFIL de Facebook (actualizar_perfil_facebook) son acciones que ejecutás SOLO cuando el dueño te lo pide EXPLÍCITAMENTE. Publicar es público e irreversible: si hay ambigüedad, confirmá antes.

CADENCIA RECOMENDADA (para no saturar; ajustable por el equipo en las instrucciones)
- Email a la base de veterinarios (B2B): máximo 1–2 por mes. Es lo más sensible (saturar genera bajas y rebotes).
- Instagram: 2–4 posts por semana. Facebook: 1–2 por semana. Mezcla formatos (carrusel educativo, post simple, recordación).
- En un mes, balanceá objetivos (no todo captación ni todo recordación) y las dos audiencias (tutores y veterinarios).
- Antes de proponer, revisá con listar_calendario lo ya planificado (mira el resumen por canal/audiencia) para respetar esta cadencia.

FECHAS RELEVANTES DE CHILE (para colgar campañas con sentido; confirmá el día exacto si dudás, no inventes)
- Fijas: Día Internacional del Perro (26/7), Día Internacional del Gato (8/8) y Día del Gato en Chile (20/2), Día Mundial de los Animales (4/10), Día del Veterinario en Chile (~/9), Fiestas Patrias (18–19/9, ojo pirotecnia y mascotas), Navidad (25/12) y Año Nuevo (riesgo de fuegos artificiales y mascotas perdidas), vuelta a clases (marzo), Día de la Madre/Padre. Para tutores funcionan bien los ángulos de cuidado, prevención y acompañamiento; evitá lo festivo cuando el tema es sensible.

FLUJO DE TRABAJO (síguelo)
1. PLANIFICAR (barato): cuando te pidan un plan ("armá el plan de julio", "ideas para esta semana"), primero usa "listar_calendario" para ver qué ya hay (no duplicar ni saturar un canal), y luego propón con "proponer_campanas" un conjunto de ítems repartidos por canal/fecha/objetivo. En el plan da SOLO idea + fecha + canal + audiencia + objetivo (y un título/gancho corto opcional). NO generes las piezas todavía.
2. GENERAR (más caro): solo cuando el dueño lo pida explícitamente sobre ítems concretos ("generá la pieza de la #5", "escribí el post del lunes"), usa "generar_pieza" con el id. No generes piezas por iniciativa propia ni en lote sin que te lo pidan.
3. Si te piden ideas de imágenes, mira el banco con "consultar_banco_imagenes" y prioriza reutilizar lo que ya existe.
4. CREAR/EDITAR IMÁGENES sueltas (a pedido): si el dueño pide una imagen puntual (no una pieza del calendario), o adjunta una imagen en el chat para que hagas algo con ella, usá "generar_imagen". Para CREAR alcanza con un prompt fotográfico detallado. Para EDITAR/VARIAR a partir de una imagen del banco (por ej. incorporar el LOGO de marca, grupo "marca"), pasá su referencia_url; para basarte en lo que el dueño adjuntó, usá usar_adjunto:true. Cuando el dueño adjunta imágenes las VES en su mensaje (podés comentarlas). Después mostrá el resultado con ![](URL).
5. PUBLICAR / PERFIL (SOLO si te lo piden explícito): para publicar una pieza ya aprobada/generada en su red usá "publicar_pieza" con su id (Instagram requiere imagen; el email no se publica acá). Para aplicar cambios al perfil de FACEBOOK usá "actualizar_perfil_facebook" (antes leé el estado con "auditar_perfil" y mostrá qué vas a cambiar). El perfil de INSTAGRAM no se edita por API: entregá los textos para aplicarlos a mano.

FORMATO DE RESPUESTA (legible y al grano — tus mensajes se muestran con formato, no en crudo)
- Escribí CONCISO y escaneable. Frases cortas, una idea por bloque. Nada de muros de texto.
- Podés usar markdown con MESURA: **negritas** para lo clave y listas cortas con "-". Como mucho un título corto. EVITÁ las tablas largas y los bloques de cita (>) extensos: cansan al leer; preferí una lista breve.
- MOSTRÁ, no solo describas: cuando tengas una imagen relevante (una pieza ya generada, una opción del banco), inclúyela en el mensaje con la sintaxis ![](URL) para que el dueño la VEA, en vez de explicarla con palabras.
- Tono de asesor cercano y claro, en español neutro.
- Cuando propongas campañas, usá la herramienta "proponer_campanas" (no escribas el calendario a mano) y después resumí en 1-2 frases qué propusiste y por qué.`

async function bloqueTarifas(): Promise<string> {
  try {
    const [pg, ts] = await Promise.all([getSheetData('precios_generales'), getSheetData('tipos_servicio')])
    const tramos = [...pg]
      .sort((a, b) => (parseFloat(a.peso_min) || 0) - (parseFloat(b.peso_min) || 0))
      .map(r => {
        const max = (r.peso_max && r.peso_max.trim()) ? `${r.peso_min}–${r.peso_max} kg` : `${r.peso_min}+ kg`
        return `- ${max}: Individual ${fmtPrecio(parseInt(r.precio_ci, 10) || 0)} · Premium ${fmtPrecio(parseInt(r.precio_cp, 10) || 0)} · Sin Devolución ${fmtPrecio(parseInt(r.precio_sd, 10) || 0)}`
      }).join('\n')
    const nombres = ts.map(t => `${t.codigo}=${t.nombre}`).join(', ')
    return `TARIFAS VIGENTES de cremación (CLP, por peso):\n${tramos}\n\nTipos de servicio: ${nombres}. Entrega en hasta 4 días hábiles.`
  } catch {
    return 'TARIFAS: (no disponibles ahora — no inventes precios).'
  }
}

function bloqueFechaChile(): string {
  const TZ = 'America/Santiago'
  const fecha = new Intl.DateTimeFormat('es-CL', { timeZone: TZ, weekday: 'long', year: 'numeric', month: 'long', day: '2-digit' }).format(new Date())
  const iso = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  return `FECHA ACTUAL (Chile): hoy es ${fecha} (${iso}). Usa esto para planificar fechas. Las fechas van en formato YYYY-MM-DD. Considera fechas relevantes del año si aplican (no inventes campañas atadas a fechas que no existan).`
}

function bloqueBanco(banco: ImagenBanco[]): string {
  if (banco.length === 0) return 'BANCO DE IMÁGENES: vacío.'
  const porGrupo: Record<string, number> = {}
  for (const b of banco) porGrupo[b.grupo || 'otro'] = (porGrupo[b.grupo || 'otro'] || 0) + 1
  const resumen = Object.entries(porGrupo).map(([g, n]) => `${g}: ${n}`).join(', ')
  return `BANCO DE IMÁGENES (${banco.length} imágenes — ${resumen}). Usa "consultar_banco_imagenes" para ver detalles y prioriza reutilizar.`
}

// ─── Herramientas ─────────────────────────────────────────────────────────────

const TOOL_LISTAR: Anthropic.Tool = {
  name: 'listar_calendario',
  description: 'Lee el calendario de campañas en un rango de fechas para no duplicar ni saturar un canal antes de proponer. Devuelve los ítems existentes con su estado.',
  input_schema: {
    type: 'object',
    properties: {
      desde: { type: 'string', description: 'Fecha inicio YYYY-MM-DD (opcional).' },
      hasta: { type: 'string', description: 'Fecha fin YYYY-MM-DD (opcional).' },
    },
    required: [],
  },
}

const TOOL_PROPONER: Anthropic.Tool = {
  name: 'proponer_campanas',
  description: 'Crea uno o varios ítems en el calendario con estado "propuesta" para que el dueño los apruebe. Úsalo para entregar un plan. Solo idea/fecha/canal/audiencia/objetivo (NO generes las piezas acá).',
  input_schema: {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        description: 'Campañas propuestas.',
        items: {
          type: 'object',
          properties: {
            fecha: { type: 'string', description: 'Fecha planificada YYYY-MM-DD.' },
            canal: { type: 'string', enum: ['email', 'instagram', 'facebook'] },
            audiencia: { type: 'string', enum: ['tutores', 'veterinarios', 'ambos'] },
            objetivo: { type: 'string', enum: ['captacion_vets', 'recordacion', 'educacion_tutores', 'postventa', 'promocion'] },
            idea: { type: 'string', description: 'Qué comunica la campaña (1-2 frases).' },
            titulo: { type: 'string', description: 'Gancho/título corto opcional.' },
          },
          required: ['fecha', 'canal', 'idea'],
        },
      },
    },
    required: ['items'],
  },
}

const TOOL_PRECIOS: Anthropic.Tool = {
  name: 'leer_precios',
  description: 'Devuelve las tarifas vigentes de cremación (ya las tienes en el contexto, pero úsala si necesitas reconfirmar antes de mencionar un valor).',
  input_schema: { type: 'object', properties: {}, required: [] },
}

const TOOL_BANCO: Anthropic.Tool = {
  name: 'consultar_banco_imagenes',
  description: 'Lista imágenes del banco (para reutilizar en piezas). Filtra por grupo opcional (mascotas, personas, productos, instalaciones, otro).',
  input_schema: {
    type: 'object',
    properties: { grupo: { type: 'string', description: 'Grupo a filtrar (opcional).' } },
    required: [],
  },
}

const TOOL_GENERAR: Anthropic.Tool = {
  name: 'generar_pieza',
  description: 'Genera la pieza (copy + imagen para social, o asunto + HTML para email) de un ítem del calendario por su id. Es más caro: úsalo SOLO cuando el dueño lo pida explícitamente sobre ítems concretos.',
  input_schema: {
    type: 'object',
    properties: { id: { type: 'string', description: 'Id del ítem del calendario.' } },
    required: ['id'],
  },
}

const TOOL_AUDITAR: Anthropic.Tool = {
  name: 'auditar_perfil',
  description: 'Lee el estado actual de los perfiles de Facebook (Página) e Instagram (bio/descripción, datos de contacto, sitio web, seguidores, etc.) para poder auditarlos y recomendar mejoras. Úsala cuando el dueño pida revisar, completar u optimizar el perfil.',
  input_schema: { type: 'object', properties: {}, required: [] },
}

const TOOL_GENERAR_IMG: Anthropic.Tool = {
  name: 'generar_imagen',
  description: 'Crea o EDITA una imagen suelta a pedido del dueño y la guarda en el banco. CREAR: pasa un prompt fotográfico detallado. EDITAR/VARIAR: además una referencia — usar_adjunto:true para basarte en la imagen que el dueño adjuntó en este turno, o referencia_url con la URL EXACTA de una imagen del banco (ej. el LOGO de marca) para incorporarla/variarla. Devuelve la URL; muéstrasela al dueño con ![](URL). NO uses esto para piezas del calendario (para eso es generar_pieza).',
  input_schema: {
    type: 'object',
    properties: {
      prompt: { type: 'string', description: 'Descripción fotográfica detallada de la imagen a crear/editar (fotorrealista; NUNCA instalaciones del crematorio).' },
      aspect: { type: 'string', description: 'Relación de aspecto, ej. "1:1", "16:9", "4:5" (opcional).' },
      descripcion: { type: 'string', description: 'Descripción de 1 línea para el banco (opcional).' },
      tags: { type: 'string', description: 'Palabras clave separadas por coma (opcional).' },
      grupo: { type: 'string', enum: ['mascotas', 'personas', 'productos', 'otro'], description: 'Grupo del banco (opcional, default otro).' },
      subgrupo: { type: 'string', description: 'Etiqueta/campaña para ordenar en el banco (opcional).' },
      usar_adjunto: { type: 'boolean', description: 'true para usar como referencia la(s) imagen(es) que el dueño adjuntó en este turno.' },
      referencia_url: { type: 'string', description: 'URL exacta de una imagen del banco para usar como referencia (ej. el logo de marca).' },
    },
    required: ['prompt'],
  },
}

const TOOL_PUBLICAR: Anthropic.Tool = {
  name: 'publicar_pieza',
  description: 'PUBLICA EN VIVO en la red social (Instagram o Facebook) una pieza del calendario por su id. Acción PÚBLICA e IRREVERSIBLE: úsala SOLO cuando el dueño lo pida explícitamente ("publicá la #5", "subila ahora"). La pieza debe estar aprobada/generada y tener copy (e imagen para Instagram). El email NO se publica acá.',
  input_schema: {
    type: 'object',
    properties: { id: { type: 'string', description: 'Id del ítem del calendario a publicar.' } },
    required: ['id'],
  },
}

const TOOL_PERFIL_FB: Anthropic.Tool = {
  name: 'actualizar_perfil_facebook',
  description: 'Aplica cambios de TEXTO al perfil de la Página de FACEBOOK (campos: about, description, phone, website, emails). Solo Facebook — el perfil de Instagram se edita a mano. Úsala SOLO cuando el dueño apruebe los cambios explícitamente; antes conviene leer el estado actual con auditar_perfil y mostrar qué se va a cambiar.',
  input_schema: {
    type: 'object',
    properties: {
      about: { type: 'string', description: 'Descripción corta (about).' },
      description: { type: 'string', description: 'Descripción larga de la Página.' },
      phone: { type: 'string', description: 'Teléfono de contacto.' },
      website: { type: 'string', description: 'Sitio web (URL).' },
      emails: { type: 'string', description: 'Correo(s) de contacto.' },
    },
    required: [],
  },
}

export interface RespuestaMarketing {
  mensaje: string
  acciones: string[]
  /** Ítems creados/afectados en este turno (para refrescar la UI). */
  cambios: boolean
}
export interface TurnoMarketing { rol: 'usuario' | 'agente'; texto: string }

function construirMensajes(historial: TurnoMarketing[]): Anthropic.MessageParam[] {
  const out: Anthropic.MessageParam[] = []
  for (const t of historial) {
    if (!t.texto?.trim()) continue
    const role = t.rol === 'usuario' ? 'user' : 'assistant'
    const last = out[out.length - 1]
    if (last && last.role === role) last.content = `${last.content}\n${t.texto}`
    else out.push({ role, content: t.texto })
  }
  while (out.length && out[0].role === 'assistant') out.shift()
  return out
}

interface ProponerInput { items?: Array<{ fecha?: string; canal?: string; audiencia?: string; objetivo?: string; idea?: string; titulo?: string }> }

/**
 * Genera la respuesta del agente de marketing con tool-use: planifica el
 * calendario, lee precios/banco y (si se lo piden) genera piezas.
 */
export async function generarRespuestaMarketing(
  historial: TurnoMarketing[],
  opts: { creadoPor?: string; adjuntos?: { mime: string; data: Buffer }[] } = {},
): Promise<RespuestaMarketing> {
  const base = construirMensajes(historial.slice(-20))
  if (base.length === 0) return { mensaje: '', acciones: [], cambios: false }
  // Adjuntos del turno actual → se agregan como imágenes (visión) al último mensaje del usuario.
  if (opts.adjuntos?.length) {
    const last = base[base.length - 1]
    if (last && last.role === 'user' && typeof last.content === 'string') {
      const imgs: Anthropic.ImageBlockParam[] = opts.adjuntos.map(a => ({
        type: 'image', source: { type: 'base64', media_type: a.mime as 'image/png', data: a.data.toString('base64') },
      }))
      last.content = [...imgs, { type: 'text', text: last.content }]
    }
  }

  const [tarifas, cfg, banco] = await Promise.all([
    bloqueTarifas(),
    getMarketingConfig().catch(() => null),
    listarImagenes().catch(() => [] as ImagenBanco[]),
  ])

  const system: Anthropic.TextBlockParam[] = [
    { type: 'text', text: `${BASE}\n\n${tarifas}`, cache_control: { type: 'ephemeral' } },
  ]
  const ajustes = [
    cfg?.instrucciones?.trim() && `INSTRUCCIONES Y DATOS VIGENTES DEL EQUIPO (trátalos como la verdad actual; REEMPLAZAN el guion base si chocan, salvo: precios siempre de TARIFAS VIGENTES):\n${cfg.instrucciones.trim()}`,
    cfg?.calibracion?.trim() && `GUÍA DE ESTILO / LÍNEA EDITORIAL:\n${cfg.calibracion.trim()}`,
  ].filter(Boolean).join('\n\n')
  if (ajustes) system.push({ type: 'text', text: ajustes })
  system.push({ type: 'text', text: bloqueFechaChile() })
  system.push({ type: 'text', text: bloqueBanco(banco) })

  const tools = [TOOL_LISTAR, TOOL_PROPONER, TOOL_PRECIOS, TOOL_BANCO, TOOL_GENERAR, TOOL_AUDITAR, TOOL_GENERAR_IMG, TOOL_PUBLICAR, TOOL_PERFIL_FB]
  const convo: Anthropic.MessageParam[] = [...base]
  const acciones: string[] = []
  let cambios = false
  let textoFinal = ''

  for (let iter = 0; iter < 6; iter++) {
    const res = await getClient().messages.create({ model: MODEL, max_tokens: 2200, system, messages: convo, tools })
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
        if (tu.name === 'listar_calendario') {
          const inp = tu.input as { desde?: string; hasta?: string }
          const items = await listarCalendario({ desde: inp.desde, hasta: inp.hasta })
          if (items.length === 0) resultText = 'El calendario no tiene ítems en ese rango.'
          else {
            const porCanal: Record<string, number> = {}
            const porAud: Record<string, number> = {}
            for (const it of items) {
              porCanal[it.canal] = (porCanal[it.canal] || 0) + 1
              porAud[it.audiencia || 'sin audiencia'] = (porAud[it.audiencia || 'sin audiencia'] || 0) + 1
            }
            const resumen = `Resumen: ${items.length} ítems · canal {${Object.entries(porCanal).map(([k, v]) => `${k}:${v}`).join(', ')}} · audiencia {${Object.entries(porAud).map(([k, v]) => `${k}:${v}`).join(', ')}}`
            const lineas = items.map(it => `#${it.id} ${it.fecha} [${it.canal} · ${it.audiencia || '—'}] (${it.estado}) ${it.objetivo || ''} — ${it.idea || it.titulo}`.trim()).join('\n')
            resultText = `${resumen}\n${lineas}`
          }
        } else if (tu.name === 'proponer_campanas') {
          const inp = tu.input as ProponerInput
          const nuevos: NuevoItem[] = (inp.items || [])
            .filter(i => i?.idea && i?.fecha && i?.canal)
            .map(i => ({
              fecha: String(i.fecha),
              canal: String(i.canal),
              audiencia: i.audiencia || 'ambos',
              objetivo: i.objetivo || '',
              idea: String(i.idea),
              titulo: i.titulo || '',
              estado: 'propuesta',
              generado_por: 'ia',
              creadoPor: opts.creadoPor,
            }))
          if (nuevos.length === 0) {
            resultText = 'No recibí ítems válidos (cada uno necesita fecha, canal e idea).'
          } else {
            const creados = await crearItems(nuevos)
            cambios = true
            resultText = `Creadas ${creados.length} propuestas: ${creados.map(c => `#${c.id} (${c.fecha}, ${c.canal})`).join(', ')}.`
          }
        } else if (tu.name === 'leer_precios') {
          resultText = await bloqueTarifas()
        } else if (tu.name === 'consultar_banco_imagenes') {
          const grupo = (tu.input as { grupo?: string }).grupo
          const lista = banco.filter(b => !grupo || b.grupo === grupo).slice(0, 40)
          resultText = lista.length === 0
            ? 'No hay imágenes en el banco con ese filtro.'
            : lista.map(b => `#${b.id} [${b.grupo || 'otro'}] ${b.descripcion || b.alt || '(sin descripción)'} — ${b.url}`).join('\n')
              + '\n\nSi le mostrás alguna al dueño, inclúyela con ![](URL).'
        } else if (tu.name === 'generar_pieza') {
          const id = String((tu.input as { id?: string }).id || '')
          const r = await generarPieza(id, opts.creadoPor)
          cambios = true
          let prev: string
          if (r.item.canal === 'email') {
            prev = `Correo generado (asunto: "${r.item.titulo}"). Quedó como borrador en Mailing para revisar y enviar. No pegues el HTML; resumí en una frase de qué trata.`
          } else {
            prev = `Post generado para ${r.item.canal}.\n\nCOPY:\n${r.item.cuerpo}`
              + (r.item.imagen_url ? `\n\nMostrale al dueño este copy y la imagen incluyéndola con ![](${r.item.imagen_url}).` : '\n\n(sin imagen)')
          }
          resultText = `${prev}${r.avisos.length ? '\n\nAvisos: ' + r.avisos.join('; ') : ''}`
        } else if (tu.name === 'auditar_perfil') {
          const [fb, ig] = await Promise.all([
            leerPerfilFacebook().catch(() => null),
            leerPerfilInstagram().catch(() => null),
          ])
          const partes: string[] = []
          partes.push(fb ? `FACEBOOK (Página) — estado actual:\n${JSON.stringify(fb, null, 2)}` : 'FACEBOOK: no configurado o sin datos.')
          partes.push(ig ? `INSTAGRAM — estado actual:\n${JSON.stringify(ig, null, 2)}` : 'INSTAGRAM: todavía no conectado (se conecta el 30/06); aún no hay datos para leer.')
          partes.push('Recordá: el perfil de Instagram se edita SOLO a mano; en Facebook los campos de texto se pueden aplicar (lo hace el equipo). Entregá recomendaciones concretas y accionables (bio, datos a completar, destacados, foto/portada, primeras piezas).')
          resultText = partes.join('\n\n')
        } else if (tu.name === 'generar_imagen') {
          if (!isNanoBananaConfigurado()) {
            resultText = 'No puedo generar imágenes ahora (falta GEMINI_API_KEY).'
          } else {
            const inp = tu.input as { prompt?: string; aspect?: string; descripcion?: string; tags?: string; grupo?: string; subgrupo?: string; usar_adjunto?: boolean; referencia_url?: string }
            const refs: { data: Buffer; mime: string }[] = []
            if (inp.usar_adjunto && opts.adjuntos?.length) refs.push(...opts.adjuntos)
            if (inp.referencia_url) {
              try {
                const rr = await fetch(inp.referencia_url)
                if (rr.ok) refs.push({ data: Buffer.from(await rr.arrayBuffer()), mime: rr.headers.get('content-type') || 'image/png' })
              } catch { /* referencia no accesible: seguimos sin ella */ }
            }
            const grupoImg = ['mascotas', 'personas', 'productos', 'otro'].includes(String(inp.grupo)) ? String(inp.grupo) : 'otro'
            const g = await generarYGuardarImagen({
              prompt: String(inp.prompt || ''),
              aspect: inp.aspect,
              descripcion: inp.descripcion,
              tags: inp.tags,
              grupo: grupoImg,
              subgrupo: inp.subgrupo,
              referencias: refs.length ? refs : undefined,
              creadoPor: opts.creadoPor,
            })
            cambios = true
            resultText = `Imagen ${refs.length ? 'editada/variada' : 'creada'} y guardada en el banco (grupo ${grupoImg}). Muéstrasela al dueño incluyéndola con ![](${g.imagen.url}).`
          }
        } else if (tu.name === 'publicar_pieza') {
          const id = String((tu.input as { id?: string }).id || '')
          const r = await publicarItem(id)
          cambios = true
          resultText = r.yaPublicado
            ? `Esa pieza ya estaba publicada${r.post?.url ? ` (${r.post.url})` : ''}.`
            : `✅ Publicado en ${r.item?.canal || 'la red'}${r.post?.url ? `: ${r.post.url}` : ''}. Pasale el link al dueño.`
        } else if (tu.name === 'actualizar_perfil_facebook') {
          if (!isFacebookConfigurado()) {
            resultText = 'Facebook no está configurado (faltan META_GRAPH_TOKEN / META_PAGE_ID).'
          } else {
            const campos = tu.input as Record<string, string>
            await actualizarPerfilFacebook(campos)
            const aplicados = Object.keys(campos).filter(k => ['about', 'description', 'phone', 'website', 'emails'].includes(k))
            resultText = `Perfil de Facebook actualizado (${aplicados.join(', ') || 'sin cambios'}). Confirmale al dueño qué se cambió.`
          }
        } else {
          resultText = 'Herramienta no disponible.'
        }
      } catch (e) {
        resultText = `No se pudo completar la acción: ${e instanceof Error ? e.message : String(e)}.`
      }
      results.push({ type: 'tool_result', tool_use_id: tu.id, content: resultText })
    }
    convo.push({ role: 'user', content: results })
  }

  return { mensaje: textoFinal.trim(), acciones, cambios }
}
