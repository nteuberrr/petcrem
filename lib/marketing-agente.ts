import Anthropic from '@anthropic-ai/sdk'
import { getSheetData } from './datastore'
import { fmtPrecio } from './format'
import { getMarketingConfig } from './marketing-config'
import { listarCalendario, crearItems, type NuevoItem } from './marketing-calendario'
import { listarImagenes, generarYGuardarImagen, estamparLogoEnUrl, type ImagenBanco } from './mailing-images'
import { isNanoBananaConfigurado } from './nano-banana'
import { MARCA_VISUAL, MARCA_GRAFICO } from './marca-visual'
import { generarPieza, editarImagenPieza } from './marketing-pieza'
import { leerPerfilFacebook, leerPerfilInstagram, actualizarPerfilFacebook, isFacebookConfigurado } from './meta-publish'
import { publicarItem } from './marketing-publicar'
import { resumenAds, resumenOrganico, isInsightsConfigurado } from './meta-insights'

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

// Agente estratégico: usa el modelo más capaz por defecto (calidad > costo, por
// pedido del dueño). Override con ANTHROPIC_MARKETING_MODEL si hiciera falta.
const MODEL = process.env.ANTHROPIC_MARKETING_MODEL || 'claude-opus-4-8'

const BASE = `Eres el **Director de Marketing Digital** del **Crematorio Alma Animal** (cremación de mascotas, Recoleta, Santiago de Chile; cobertura Región Metropolitana; lema "Huellas que no se borran"). No sos un asistente que pregunta y deriva: sos un profesional senior que piensa la estrategia y ENTREGA piezas terminadas, on-brand y listas para usar. Hablás en español neutro de Chile (NUNCA voseo argentino).

CÓMO TRABAJÁS (lo más importante — leelo bien)
- SÉ PROACTIVO Y RESOLUTIVO. Cuando te piden crear algo (una imagen, una portada, un post, un plan), tu primera reacción es HACERLO con tu mejor criterio y MOSTRAR una primera versión lista — NO llenar al dueño de preguntas ni mostrar piezas viejas y preguntar. Asumí defaults sensatos y on-brand, generá, y RECIÉN DESPUÉS ofrecé ajustar.
- UNA pregunta como MÁXIMO, y solo si sin esa respuesta no podés avanzar de verdad; aun así, ofrecé una opción por defecto y avanzá igual. NUNCA respondas solo con preguntas si podías entregar algo.
- ENTREGÁS PIEZAS TERMINADAS Y USABLES. JAMÁS derivás al dueño a Canva, Photoshop ni otra herramienta "para ponerle el texto" o retocar. VOS PODÉS generar imágenes y GRÁFICOS CON TEXTO integrado (portadas, placas con datos/horario/diferenciadores, anuncios, citas) en la línea visual de la marca: si la pieza necesita texto en la imagen, generala CON el texto adentro (generar_imagen con con_texto:true). No expliques "limitaciones de la IA" para no hacer algo: hacelo.
- PENSÁ COMO DIRECTOR SENIOR. Cada pieza tiene UN objetivo, un gancho fuerte al inicio, UNA idea central, un CTA claro, el formato correcto del canal y el tono de la audiencia. Calidad sobre cantidad; si algo se puede hacer mejor, hacelo mejor sin que te lo pidan.
- MOSTRÁ, no describas: cuando generás o elegís una imagen, inclúila en tu respuesta con ![](URL) para que el dueño la VEA. Nunca describas una imagen con palabras en vez de generarla.
- Reutilizá del banco SOLO si hay una imagen que calza muy bien con lo pedido. Si piden algo nuevo o específico, generalo.

LÍNEA VISUAL DE MARCA
- Seguí SIEMPRE la DIRECCIÓN VISUAL (fotos) y la DIRECCIÓN PARA GRÁFICOS (piezas con texto) que tenés más abajo. Los gráficos replican el estilo de nuestros correos (barra navy + "ALMA ANIMAL" + filete dorado + fondo crema; sobrio, cálido y premium). Paleta: crema/blanco domina, navy estructura, dorado acento.
- El logo de marca se agrega solo (nítido) a las imágenes que generás; no necesitás "dibujarlo".

CANALES
- email: campañas de correo a la BASE DE VETERINARIOS (B2B). Para informar novedades, fidelizar o captar clínicas.
- instagram: posts orgánicos al público general (sobre todo TUTORES y comunidad). Educar, generar confianza y recordación de marca.
- facebook: posts orgánicos a la Página (tutores + comunidad), copy algo más extenso que IG, y sus ASSETS de perfil (portada ≈820×312, foto de perfil) cuando los pidan.
- (TikTok queda fuera por ahora; si surge una idea de video, propónla igual marcándola para subir a mano.)

OBJETIVOS POSIBLES (usa estas claves en objetivo): captacion_vets, recordacion, educacion_tutores, postventa, promocion.
AUDIENCIAS (clave en audiencia): tutores, veterinarios, ambos.

VOZ DE MARCA (según la audiencia de cada pieza)
- Tutores (B2C): tuteo cálido pero sobrio, cercano y humano, profesional. Inspira confianza, no lástima.
- Veterinarios (B2B): profesional, técnica, eficiente, de socio confiable (datos, plazos, procesos).
- SIEMPRE: sin humor, sin religión, sin clichés del rubro ("puente del arcoíris", "angelito", "ya no sufre"). A la mascota por su nombre cuando aplique; genérico "tu mascota" (nunca "compañero/a" ni el frío "su mascota").
- EJEMPLOS DE TONO (la diferencia entre bien y mal):
  · Tutor ✅ "Cuidamos cada detalle de la despedida de Mora. En 4 días hábiles tienes de vuelta sus cenizas, acompañado en todo el proceso." — ❌ "Sabemos lo difícil que es perder a tu mejor amigo peludo 🐾💕; tu angelito ya cruzó el puente del arcoíris."
  · Veterinario ✅ "Cremación con retiro coordinado, trazabilidad documentada y entrega en 4 días hábiles. Convenio con tarifas preferentes para clínicas asociadas." — ❌ "Somos partners para cuidar a las mascotitas que ya no están, con todo el amor del mundo 💖🐾."
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
- NUNCA derives al dueño a herramientas externas (Canva, Photoshop, etc.) para terminar o retocar una pieza: la terminás VOS, con texto integrado si hace falta.
- Nada se publica ni se cambia el perfil por iniciativa propia. Vos PROPONÉS y GENERÁS; PUBLICAR (publicar_pieza) y EDITAR EL PERFIL de Facebook (actualizar_perfil_facebook) son acciones que ejecutás SOLO cuando el dueño te lo pide EXPLÍCITAMENTE. Publicar es público e irreversible: si hay ambigüedad, confirmá antes.
- NUNCA inventes pantallas, menús, secciones, URLs ni pasos de la app que no existan (por ejemplo "Configuración → Integraciones → Facebook" NO existe). Si una herramienta falla por configuración, reportá EXACTAMENTE el motivo que te dio la herramienta, sin fabricar un flujo de resolución ni instrucciones de UI inventadas.

CADENCIA RECOMENDADA (para no saturar; ajustable por el equipo en las instrucciones)
- Email a la base de veterinarios (B2B): máximo 1–2 por mes. Es lo más sensible (saturar genera bajas y rebotes).
- Instagram: 2–4 posts por semana. Facebook: 1–2 por semana. Mezcla formatos (carrusel educativo, post simple, recordación).
- En un mes, balanceá objetivos (no todo captación ni todo recordación) y las dos audiencias (tutores y veterinarios).
- Antes de proponer, revisá con listar_calendario lo ya planificado (mira el resumen por canal/audiencia) para respetar esta cadencia.

FECHAS RELEVANTES DE CHILE (para colgar campañas con sentido; confirmá el día exacto si dudás, no inventes)
- Fijas: Día Internacional del Perro (26/7), Día Internacional del Gato (8/8) y Día del Gato en Chile (20/2), Día Mundial de los Animales (4/10), Día del Veterinario en Chile (~/9), Fiestas Patrias (18–19/9, ojo pirotecnia y mascotas), Navidad (25/12) y Año Nuevo (riesgo de fuegos artificiales y mascotas perdidas), vuelta a clases (marzo), Día de la Madre/Padre. Para tutores funcionan bien los ángulos de cuidado, prevención y acompañamiento; evitá lo festivo cuando el tema es sensible.

FLUJO Y HERRAMIENTAS
1. PLANIFICAR (barato): para un plan, primero "listar_calendario" (no duplicar ni saturar) y luego "proponer_campanas" con ítems repartidos por canal/fecha/objetivo (solo idea + fecha + canal + audiencia + objetivo + título corto). No generes piezas en este paso.
2. GENERAR PIEZA DEL CALENDARIO: "generar_pieza" con el id (copy + imagen para social, o asunto + HTML para email). Úsalo cuando el dueño lo pida sobre ítems concretos.
3. CREAR/EDITAR IMÁGENES O GRÁFICOS sueltos (lo más usado en el chat): "generar_imagen". Entregá la pieza TERMINADA y mostrala con ![](URL). (Podés mirar el banco con "consultar_banco_imagenes" si conviene reutilizar.)
   - FOTO nueva: prompt fotográfico detallado (con_texto omitido).
   - GRÁFICO CON TEXTO (portada de FB, placa con datos/horario/diferenciadores, anuncio, cita): con_texto:true, y poné EN EL PROMPT el texto EXACTO y corto a mostrar + qué se ve. Elegí el aspect correcto: portada de Facebook "21:9", foto de perfil "1:1", feed "1:1"/"4:5", story "9:16".
   - EDITAR una imagen existente (cambiar un detalle SIN rehacerla): editar:true + la referencia (referencia_url del banco, o usar_adjunto:true si la adjuntó el dueño) y en el prompt SOLO el cambio. Ej.: si dice "la foto #85 con estos 4 valores", EDITÁ la #85 (referencia_url de esa imagen), no generes una nueva de cero.
   - Si el dueño adjunta una imagen, la VES en su mensaje (podés comentarla y trabajarla).
4. PUBLICAR / PERFIL (SOLO si lo piden explícito): "publicar_pieza" (IG requiere imagen; el email no se publica acá). Perfil de FACEBOOK: "actualizar_perfil_facebook" (antes "auditar_perfil" y mostrá qué vas a cambiar). El perfil de INSTAGRAM no se edita por API: entregá los textos para pegar a mano.
5. AUDITAR / REPORTAR: "auditar_perfil" para revisar el estado de FB/IG y recomendar mejoras concretas (bio, datos, destacados, portada, primeras piezas). "reporte_metricas" para números REALES de Meta (Ads + orgánico) con 2-3 recomendaciones accionables; nunca inventes métricas.

FORMATO DE RESPUESTA (legible y al grano — tus mensajes se muestran con formato, no en crudo)
- Escribí CONCISO y escaneable. Frases cortas, una idea por bloque. Nada de muros de texto.
- Podés usar markdown con MESURA: **negritas** para lo clave y listas cortas con "-". Como mucho un título corto. EVITÁ las tablas largas y los bloques de cita (>) extensos: cansan al leer; preferí una lista breve.
- MOSTRÁ, no solo describas: cuando tengas una imagen relevante (una pieza ya generada, una opción del banco), inclúyela en el mensaje con la sintaxis ![](URL) para que el dueño la VEA, en vez de explicarla con palabras.
- Tono de asesor cercano y claro, en español neutro.
- Cuando propongas campañas, usá la herramienta "proponer_campanas" (no escribas el calendario a mano) y después resumí en 1-2 frases qué propusiste y por qué.
- CERRÁ con UN próximo paso concreto o un ajuste puntual ("¿le subo el dorado?", "¿la publico?") — NUNCA con una lista de preguntas.`

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

/** Datos de la empresa/contacto (Configuración → empresa_config), leídos EN VIVO
 *  para que el agente use el contacto vigente en correos/piezas y vea los cambios
 *  apenas el dueño actualiza sus datos. */
async function bloqueEmpresa(): Promise<string> {
  try {
    const rows = await getSheetData('empresa_config')
    const row = rows.find(r => String(r.id) === '1') || rows[0]
    if (!row) return ''
    const lineas = Object.entries(row)
      .filter(([k, v]) => k !== 'id' && String(v ?? '').trim())
      .map(([k, v]) => `- ${k}: ${v}`)
    if (lineas.length === 0) return ''
    return `DATOS DE LA EMPRESA Y CONTACTO (de Configuración → Datos Personales; son la FUENTE DE VERDAD: usá estos datos de contacto en correos/piezas y respetá cualquier actualización que veas acá):\n${lineas.join('\n')}`
  } catch { return '' }
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
            hora: { type: 'string', description: 'Hora sugerida HH:MM (24h), opcional.' },
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
  description: 'Crea o EDITA una imagen suelta a pedido del dueño y la guarda en el banco. CREAR FOTO: prompt fotográfico detallado. CREAR GRÁFICO CON TEXTO (portada de FB, placa con datos/horario/diferenciadores, anuncio, cita): con_texto:true y poné el texto EXACTO a mostrar en "prompt" (sale en la línea visual de los correos; entregás la pieza TERMINADA, sin derivar a Canva). EDITAR (cambiar un detalle SIN rehacer la imagen): editar:true + la referencia (usar_adjunto:true para la que adjuntó el dueño, o referencia_url con la URL EXACTA del banco) y en "prompt" SOLO el cambio. El LOGO de marca se agrega AUTOMÁTICAMENTE a TODO lo que generás (crear o editar): elegimos la mejor variante del banco —grupo "marca"— y la pegamos nítida abajo a la derecha; NO pidas dibujar el logo. Elegí el aspect correcto (portada FB "21:9", perfil "1:1", feed "1:1"/"4:5", story "9:16"). Devuelve la URL; muéstrasela con ![](URL). NO uses esto para piezas del calendario (para eso es generar_pieza; para corregir imágenes de una pieza ya generada, editar_imagen_pieza).',
  input_schema: {
    type: 'object',
    properties: {
      prompt: { type: 'string', description: 'FOTO: descripción fotográfica detallada (fotorrealista; NUNCA instalaciones del crematorio; NO pidas dibujar el logo). GRÁFICO (con_texto:true): describí el diseño Y poné el TEXTO EXACTO y CORTO a mostrar (un título + a lo sumo 3-4 bullets). EDITAR (editar:true): SOLO el cambio puntual (ej. "cambia el collar a rojo"), no toda la escena.' },
      con_texto: { type: 'boolean', description: 'true = GRÁFICO con texto integrado (portada, placa con datos, anuncio, cita), en la línea visual de los correos. Poné el texto exacto en "prompt". Default false = foto sin texto.' },
      editar: { type: 'boolean', description: 'true = EDITAR la imagen de referencia preservando todo lo demás y cambiando solo lo que digas en "prompt" (requiere usar_adjunto o referencia_url). false u omitir = crear una imagen nueva.' },
      aspect: { type: 'string', description: 'Relación de aspecto, ej. "1:1", "16:9", "4:5", "21:9" (portada FB), "9:16" (story). Se ignora al editar (la salida sigue el aspecto de la imagen base).' },
      descripcion: { type: 'string', description: 'Descripción de 1 línea para el banco (opcional).' },
      tags: { type: 'string', description: 'Palabras clave separadas por coma (opcional).' },
      grupo: { type: 'string', enum: ['mascotas', 'personas', 'productos', 'otro'], description: 'Grupo del banco (opcional, default otro).' },
      subgrupo: { type: 'string', description: 'Etiqueta/campaña para ordenar en el banco (opcional).' },
      usar_adjunto: { type: 'boolean', description: 'true para usar como referencia la(s) imagen(es) que el dueño adjuntó en este turno.' },
      referencia_url: { type: 'string', description: 'URL exacta de una imagen del banco para usar como referencia (al editar, la imagen a modificar).' },
      logo_url: { type: 'string', description: 'Opcional: URL exacta de una variante de logo del banco (grupo "marca") para usar en vez de la que se elige automáticamente.' },
      sin_logo: { type: 'boolean', description: 'true para entregar la imagen SIN el logo de marca (por defecto TODO lo generado/editado lo lleva).' },
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

const TOOL_METRICAS: Anthropic.Tool = {
  name: 'reporte_metricas',
  description: 'Trae métricas REALES de Meta para reportar: "ads" (campañas pagadas de Meta Ads: gasto, alcance, clics, CTR, CPC, resultados), "organico" (seguidores + rendimiento de los posts publicados) o "ambos". Úsala cuando el dueño pregunte cómo van los anuncios / posts / redes. Después resumí los números de forma clara y dá 2-3 recomendaciones; NUNCA inventes métricas que no vengan de la herramienta.',
  input_schema: {
    type: 'object',
    properties: {
      que: { type: 'string', enum: ['ads', 'organico', 'ambos'], description: 'Qué reportar (default ambos).' },
      periodo: { type: 'string', enum: ['today', 'yesterday', 'last_7d', 'last_14d', 'last_30d', 'last_90d', 'this_month', 'last_month'], description: 'Período para Ads (default last_30d).' },
    },
    required: [],
  },
}

const TOOL_EDITAR_IMG: Anthropic.Tool = {
  name: 'editar_imagen_pieza',
  description: 'Ajusta la(s) imagen(es) de una pieza del calendario YA generada PRESERVANDO el resto (image-to-image: usa la imagen actual como base y cambia SOLO lo que pidas, sin rehacerla ni reencuadrarla). Ej: "arreglá la imagen 5 de la #123 que se ve mal" (indice=5), o "poné el logo en todas las imágenes de la #123" (sin indice → todas; si la instrucción menciona el logo/marca, lo incorpora como referencia). En la instrucción describí SOLO el cambio puntual. Úsalo cuando el dueño pida corregir o uniformar imágenes de una pieza concreta.',
  input_schema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Id de la pieza del calendario.' },
      instruccion: { type: 'string', description: 'Qué ajustar (ej. "corregí las manos", "incorporá el logo arriba a la derecha").' },
      indice: { type: 'number', description: 'Posición de la imagen a editar (1 = primera). Omitir para aplicar a TODAS las del carrusel.' },
    },
    required: ['id', 'instruccion'],
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

interface ProponerInput { items?: Array<{ fecha?: string; hora?: string; canal?: string; audiencia?: string; objetivo?: string; idea?: string; titulo?: string }> }

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

  const [tarifas, cfg, banco, empresa] = await Promise.all([
    bloqueTarifas(),
    getMarketingConfig().catch(() => null),
    listarImagenes().catch(() => [] as ImagenBanco[]),
    bloqueEmpresa(),
  ])

  const system: Anthropic.TextBlockParam[] = [
    { type: 'text', text: `${BASE}\n\n${MARCA_VISUAL}\n\n${MARCA_GRAFICO}\n\n${tarifas}`, cache_control: { type: 'ephemeral' } },
  ]
  const ajustes = [
    cfg?.instrucciones?.trim() && `INSTRUCCIONES Y DATOS VIGENTES DEL EQUIPO (trátalos como la verdad actual; REEMPLAZAN el guion base si chocan, salvo: precios siempre de TARIFAS VIGENTES):\n${cfg.instrucciones.trim()}`,
    cfg?.calibracion?.trim() && `GUÍA DE ESTILO / LÍNEA EDITORIAL:\n${cfg.calibracion.trim()}`,
  ].filter(Boolean).join('\n\n')
  if (ajustes) system.push({ type: 'text', text: ajustes })
  if (empresa) system.push({ type: 'text', text: empresa })
  system.push({ type: 'text', text: bloqueFechaChile() })
  system.push({ type: 'text', text: bloqueBanco(banco) })

  const tools = [TOOL_LISTAR, TOOL_PROPONER, TOOL_PRECIOS, TOOL_BANCO, TOOL_GENERAR, TOOL_AUDITAR, TOOL_GENERAR_IMG, TOOL_PUBLICAR, TOOL_PERFIL_FB, TOOL_METRICAS, TOOL_EDITAR_IMG]
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
              hora: i.hora ? String(i.hora) : '',
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
            const inp = tu.input as { prompt?: string; con_texto?: boolean; editar?: boolean; aspect?: string; descripcion?: string; tags?: string; grupo?: string; subgrupo?: string; usar_adjunto?: boolean; referencia_url?: string; logo_url?: string; sin_logo?: boolean }
            const refs: { data: Buffer; mime: string }[] = []
            if (inp.usar_adjunto && opts.adjuntos?.length) refs.push(...opts.adjuntos)
            if (inp.referencia_url) {
              try {
                const rr = await fetch(inp.referencia_url)
                if (rr.ok) refs.push({ data: Buffer.from(await rr.arrayBuffer()), mime: rr.headers.get('content-type') || 'image/png' })
              } catch { /* referencia no accesible: seguimos sin ella */ }
            }
            // Editar (preservar la base y cambiar solo lo pedido) requiere referencia.
            // Si el dueño adjuntó/eligió una imagen para modificar, asumimos edición.
            const editar = (inp.editar ?? refs.length > 0) && refs.length > 0
            const conTexto = !!inp.con_texto && !editar
            const grupoImg = ['mascotas', 'personas', 'productos', 'otro'].includes(String(inp.grupo)) ? String(inp.grupo) : 'otro'
            const g = await generarYGuardarImagen({
              prompt: String(inp.prompt || ''),
              aspect: inp.aspect,
              descripcion: inp.descripcion,
              tags: inp.tags,
              grupo: grupoImg,
              subgrupo: inp.subgrupo,
              referencias: refs.length ? refs : undefined,
              editar,
              conTexto,
              creadoPor: opts.creadoPor,
            })
            // Logo de marca (paso de cierre): SIEMPRE en lo que se entrega (crear o
            // editar), salvo que pidan sin_logo. El banco queda con la versión limpia.
            let urlFinal = g.imagen.url
            let conLogoOk = false
            if (!inp.sin_logo) {
              const urlLogo = await estamparLogoEnUrl(g.imagen.url, banco, { preferUrl: inp.logo_url })
              conLogoOk = urlLogo !== g.imagen.url
              urlFinal = urlLogo
            }
            cambios = true
            resultText = `Imagen ${editar ? 'editada' : 'creada'}${conLogoOk ? ' con el logo de marca' : ''} (guardada en el banco, grupo ${grupoImg}). Muéstrasela al dueño incluyéndola con ![](${urlFinal}).`
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
            resultText = 'No puedo aplicar cambios al perfil: Facebook no figura conectado en este entorno (faltan las variables META_GRAPH_TOKEN / META_PAGE_ID en el servidor/Vercel). NO existe ninguna pantalla de "Integraciones/Facebook" en la app: la conexión se carga en las variables de entorno de Vercel y requiere redeploy. Decile esto al dueño TAL CUAL (sin inventar otro flujo). Igual podés entregarle los textos listos para que los pegue a mano en la Página.'
          } else {
            const campos = tu.input as Record<string, string>
            await actualizarPerfilFacebook(campos)
            const aplicados = Object.keys(campos).filter(k => ['about', 'description', 'phone', 'website', 'emails'].includes(k))
            resultText = `Perfil de Facebook actualizado (${aplicados.join(', ') || 'sin cambios'}). Confirmale al dueño qué se cambió.`
          }
        } else if (tu.name === 'reporte_metricas') {
          if (!isInsightsConfigurado()) {
            resultText = 'No hay credenciales de Meta para leer métricas.'
          } else {
            const inp = tu.input as { que?: string; periodo?: string }
            const que = inp.que || 'ambos'
            const partes: string[] = []
            if (que === 'ads' || que === 'ambos') {
              try {
                const a = await resumenAds({ datePreset: inp.periodo })
                const c = a.cuenta
                const accs = c.acciones.map(x => `${x.tipo}=${x.valor}`).join(', ') || 'sin resultados registrados'
                const top = a.campanas.slice(0, 8).map(k =>
                  `  - ${k.nombre}: ${fmtPrecio(k.spend)} · alcance ${k.alcance} · clics ${k.clicks} · CTR ${k.ctr.toFixed(2)}% · CPC ${fmtPrecio(k.cpc)}`
                ).join('\n') || '  (sin campañas con datos en el período)'
                partes.push(`ADS PAGADOS (${a.periodo}, ${a.moneda}):\nCUENTA: gasto ${fmtPrecio(c.spend)} · alcance ${c.alcance} · impresiones ${c.impresiones} · clics ${c.clicks} · CTR ${c.ctr.toFixed(2)}% · CPC ${fmtPrecio(c.cpc)} · resultados: ${accs}\nPOR CAMPAÑA:\n${top}`)
              } catch (e) { partes.push(`ADS: no disponible (${e instanceof Error ? e.message : 'error'}).`) }
            }
            if (que === 'organico' || que === 'ambos') {
              try {
                const o = await resumenOrganico()
                const posts = o.posts.slice(0, 6).map(p =>
                  `  - ${(p.fecha || '').slice(0, 10)} — ${p.mensaje || '(sin texto)'} → ${p.impresiones} impresiones, ${p.reacciones + p.comentarios + p.compartidos} interacciones`
                ).join('\n') || '  (sin posts recientes)'
                partes.push(`ORGÁNICO (Facebook):\nSeguidores: ${o.seguidores}\nÚltimos posts:\n${posts}`)
              } catch (e) { partes.push(`ORGÁNICO: no disponible (${e instanceof Error ? e.message : 'error'}).`) }
            }
            resultText = partes.join('\n\n') + '\n\nResumí estos números para el dueño de forma clara y dale 2-3 recomendaciones concretas (NO inventes métricas que no estén acá).'
          }
        } else if (tu.name === 'editar_imagen_pieza') {
          const inp = tu.input as { id?: string; instruccion?: string; indice?: number }
          const r = await editarImagenPieza(String(inp.id || ''), String(inp.instruccion || ''), inp.indice, opts.creadoPor)
          cambios = true
          resultText = `Imagen(es) ajustada(s) en la pieza #${r.item.id}.${r.avisos.length ? ' Avisos: ' + r.avisos.join('; ') : ''}${r.item.imagen_url ? ` Mostrale el resultado al dueño con ![](${r.item.imagen_url}).` : ''}`
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
