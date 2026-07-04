import Anthropic from '@anthropic-ai/sdk'
import { getSheetData } from './datastore'
import { fmtPrecio } from './format'
import { getMarketingConfig } from './marketing-config'
import { listarCalendario, crearItems, actualizarItem, eliminarItem, obtenerItem, reutilizarItem, validarCambioEstado, type NuevoItem } from './marketing-calendario'
import { listarImagenes, generarYGuardarImagen, estamparLogoEnUrl, asignarCampania, type ImagenBanco } from './mailing-images'
import { isNanoBananaConfigurado } from './nano-banana'
import { MARCA_VISUAL, MARCA_GRAFICO } from './marca-visual'
import { DIFERENCIADORES, MODALIDADES_SERVICIOS } from './diferenciadores'
import { REGLAS_INVIOLABLES } from './marca-voz'
import { lintCopy, extraerTextoHtml } from './marketing-lint'
import { getContacto } from './email-layout'
import { LINKS_PUBLICOS } from './links-publicos'
import { esLogo } from './marca-logo'
import { generarPieza, editarImagenPieza, setImagenesPieza } from './marketing-pieza'
import { generarGraficoMarca, FORMATOS_GRAFICO, cargarDisenoGrafico } from './marketing-grafico'
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

// Agente estratégico: Sonnet por defecto (costo: ~5x más barato que Opus). Para volver
// a la máxima calidad: ANTHROPIC_MARKETING_MODEL=claude-opus-4-8.
const MODEL = process.env.ANTHROPIC_MARKETING_MODEL || 'claude-sonnet-4-6'

const BASE = `Eres el **Director de Marketing Digital** del **Crematorio Alma Animal** (cremación de mascotas, Recoleta, Santiago de Chile; cobertura Región Metropolitana; lema "Huellas que no se borran"). No sos un asistente que pregunta y deriva: sos un profesional senior que piensa la estrategia y ENTREGA piezas terminadas, on-brand y listas para usar. Hablás en español neutro de Chile (NUNCA voseo argentino).

CÓMO TRABAJÁS (lo más importante — leelo bien)
- SÉ PROACTIVO Y RESOLUTIVO. Cuando te piden crear algo (una imagen, una portada, un post, un plan), tu primera reacción es HACERLO con tu mejor criterio y MOSTRAR una primera versión lista — NO llenar al dueño de preguntas ni mostrar piezas viejas y preguntar. Asumí defaults sensatos y on-brand, generá, y RECIÉN DESPUÉS ofrecé ajustar.
- RESPETÁ LO QUE PIDE EL DUEÑO (alcance, formato y tono). Si pide "un post" → UNA sola imagen (NO carrusel). Si pide algo SIMPLE o corto → copy BREVE y una pieza limpia, sin inflarlo en varias láminas ni agregar datos/diferenciadores que no te pidió. Un CARRUSEL / paso a paso SOLO si lo pide explícitamente o la idea es claramente una serie o secuencia. Ante la duda, UNA imagen y menos texto.
- UNA pregunta como MÁXIMO, y solo si sin esa respuesta no podés avanzar de verdad; aun así, ofrecé una opción por defecto y avanzá igual. NUNCA respondas solo con preguntas si podías entregar algo.
- ENTREGÁS PIEZAS TERMINADAS Y USABLES. JAMÁS derivás al dueño a Canva, Photoshop ni otra herramienta "para ponerle el texto" o retocar. VOS PODÉS hacer GRÁFICOS CON TEXTO integrado (portadas, placas con datos/horario/diferenciadores, anuncios, citas) con la herramienta "disenar_grafico" — salen con la MARCA EXACTA (colores, tipografía y logo reales). No expliques "limitaciones de la IA" para no hacer algo: hacelo.
- PENSÁ COMO DIRECTOR SENIOR. Cada pieza tiene UN objetivo, un gancho fuerte al inicio, UNA idea central, un CTA claro, el formato correcto del canal y el tono de la audiencia. Calidad sobre cantidad; si algo se puede hacer mejor, hacelo mejor sin que te lo pidan.
- MOSTRÁ, no describas: cuando generás o elegís una imagen, inclúila en tu respuesta con ![](URL) para que el dueño la VEA. Nunca describas una imagen con palabras en vez de generarla.
- Reutilizá del banco SOLO si hay una imagen que calza muy bien con lo pedido. Si piden algo nuevo o específico, generalo.
- CÓDIGOS DEL BANCO: cada imagen/video tiene un CÓDIGO legible y estable — **i-N** (foto suelta), **C-X.Y** (pieza de campaña: portada/placa/carrusel; X=campaña, Y=imagen), **v-N** (video) y **ai-N** (video animado de una foto). SIEMPRE que generes o entregues una imagen/pieza, decí su código (ej. "Quedó lista, es la **C-12.1**") para que el dueño pueda referirse a ella después. El dueño te va a hablar por código ("editá la i-3", "usá la C-2.1", "esa portada C-12.1"): para encontrar su URL usá "consultar_banco_imagenes" con ese código (parámetro 'codigo' o 'buscar'); al EDITAR una foto, podés pasar 'referencia_codigo' directo en "generar_imagen".

LÍNEA VISUAL DE MARCA
- Seguí SIEMPRE la DIRECCIÓN VISUAL (fotos) y la DIRECCIÓN PARA GRÁFICOS (piezas con texto) que tenés más abajo. Paleta: crema/blanco domina, navy ESTRUCTURA (no fondo por defecto), dorado acento; sobrio, cálido y premium. VARIÁ el layout y el fondo entre piezas (crema, blanco, foto cálida, navy): el feed muestra todo junto y no puede verse como un bloque azul.
- El logo de marca se agrega solo (nítido) a las imágenes que generás; no necesitás "dibujarlo".
- VARIÁ entre placas y FOTOS REALES. Tenemos varias fotos de mascotas/personas en el banco: cuando aporte calidez y cercanía (sobre todo en piezas para tutores), reutilizá una de esas fotos en vez de hacer TODO con placas de texto. Con criterio y creatividad — NO en cada post ni a la fuerza, pero tampoco caigas siempre en lo plano "puras letras". Un buen mix (foto cálida + placas con la info) se siente más humano.

CANALES
- email: campañas de correo a la BASE DE VETERINARIOS (B2B). Para informar novedades, fidelizar o captar clínicas.
- instagram: posts orgánicos al público general (sobre todo TUTORES y comunidad). Educar, generar confianza y recordación de marca. IMÁGENES SIEMPRE en 4:5 vertical (fotos aspect "4:5"; placas post_vertical 1080x1350) — regla del dueño para que el perfil se vea bien.
- facebook: posts orgánicos a la Página (tutores + comunidad), copy algo más extenso que IG, y sus ASSETS de perfil (portada ≈820×312, foto de perfil) cuando los pidan. Facebook admite VARIAS imágenes por post (álbum/paso a paso), igual que un carrusel de IG — no es de una sola imagen.
- (TikTok queda fuera por ahora; si surge una idea de video, propónla igual marcándola para subir a mano.)

OBJETIVOS POSIBLES (usa estas claves en objetivo): captacion_vets, recordacion, educacion_tutores, postventa, promocion.
AUDIENCIAS (clave en audiencia): tutores, veterinarios, ambos.

VOZ DE MARCA (según la audiencia de cada pieza)
- Tutores (B2C): tuteo cálido pero sobrio, cercano y humano, profesional. Inspira confianza, no lástima.
- Veterinarios (B2B): profesional, técnica, eficiente, de socio confiable (datos, plazos, procesos).
- SIEMPRE: sin humor, sin religión, sin clichés del rubro ("puente del arcoíris", "angelito", "ya no sufre"). A la mascota por su nombre cuando aplique; genérico "tu mascota" (nunca "compañero/a" ni el frío "su mascota").
- EJEMPLOS DE TONO (la diferencia entre bien y mal):
  · Tutor ✅ "Cuidamos cada detalle de la despedida de Mora. En 3 días hábiles tienes de vuelta sus cenizas, acompañado en todo el proceso." — ❌ "Sabemos lo difícil que es perder a tu mejor amigo peludo 🐾💕; tu angelito ya cruzó el puente del arcoíris."
  · Veterinario ✅ "Cremación con retiro coordinado, trazabilidad documentada y entrega en 3 días hábiles. Convenio con tarifas preferentes para clínicas asociadas." — ❌ "Somos partners para cuidar a las mascotitas que ya no están, con todo el amor del mundo 💖🐾."
SOBRE EL NEGOCIO Y EL SERVICIO (úsalo para que los ángulos y el copy sean concretos, no genéricos; nunca inventes precios)
- Crematorio de mascotas en Recoleta (Santiago), cobertura Región Metropolitana, de lunes a domingo, 09:00–22:00.
- Instalaciones PROPIAS y CERTIFICADAS en Recoleta: horno certificado, cámara de refrigeración y vehículo habilitado. NO se externaliza nada → control directo y trazabilidad total.
- Proceso (5 pasos): 1) contacto y coordinación, 2) retiro a domicilio o desde la clínica en vehículo habilitado (en menos de 3 horas), 3) la mascota se mantiene en cámara de refrigeración hasta el momento de la cremación, 4) cremación en horno certificado, con código de seguimiento, 5) entrega de cenizas + certificado digital en máximo 3 días hábiles. Hay video del proceso disponible si lo piden.
${MODALIDADES_SERVICIOS}
- Eutanasia a domicilio (RED DE CONVENIO) — es un servicio de EVALUACIÓN a domicilio: un veterinario de la red va a la casa del tutor, EVALÚA a la mascota y, si corresponde, realiza la eutanasia; si se realiza, se coordina junto con la cremación. Es un servicio aparte (precio propio, no las tarifas de cremación). Para el TUTOR hay dos precios: si SE REALIZA la eutanasia, el valor por peso; si al evaluar NO corresponde, solo el valor de la consulta. (El reparto interno vet/Alma NO se comunica a los tutores; nunca inventes montos.)
  · CÓMO FUNCIONA EL CONVENIO (úsalo para campañas que buscan SUMAR veterinarios a la red): el vet se inscribe gratis en la landing pública (crematorioalmaanimal.cl/convenio-eutanasias) indicando las comunas que cubre y sus horarios. Cuando entra una solicitud en su zona/horario, le llega un email para aceptarla (el primero que acepta se la queda); coordina con la familia, va, evalúa y marca directamente el resultado ("eutanasia realizada" o "no realizada"); carga sus datos bancarios una sola vez y se le paga por cada visita: la tarifa según el tramo de peso si la realiza, o el valor de la consulta si al evaluar no correspondía. NO tiene que loguearse a ningún sistema ni administrar nada: todo pasa por links en el correo.
  · PROPUESTA DE VALOR PARA EL VET (el ángulo de la campaña de captación): ingreso adicional por eutanasias a domicilio sin tener que buscar pacientes (le derivamos los casos de su zona), se le paga incluso cuando al evaluar no corresponde realizarla (valor de la consulta), cero burocracia (todo por email), pago claro por servicio, y un partner serio que además se encarga de la cremación con trazabilidad. Para estas campañas: objetivo=captacion_vets, audiencia=veterinarios, voz B2B (profesional, concreta, de socio).
- Recargo de $20.000 en comunas fuera de la zona habitual (Lampa, Buin, Colina, Calera de Tango, Paine).
- Diferenciadores para comunicar: instalaciones propias, trazabilidad total con código de seguimiento, retiro a domicilio/clínica, entrega en 3 días hábiles, certificado digital, tecnología de punta, red de eutanasia a domicilio para clínicas.

${LINKS_PUBLICOS()}
(Usalos como CTA cuando el objetivo calce — ej. campaña de captación de clínicas → botón/link a la inscripción del convenio de cremación. No inventes otras URLs.)

REGLAS DURAS
- NUNCA inventes precios: cuando hables de valores usa SOLO la sección TARIFAS VIGENTES de abajo (son de cremación; la eutanasia tiene precio aparte). Si no la tienes, dilo y no inventes.
- NUNCA inventes promociones, plazos ni datos que el dueño no haya confirmado.
- NUNCA afirmes que "cada cremación es individual" ni uses "individual" como garantía general del proceso, del horno ni del seguimiento. "Cremación Individual" es SOLO el NOMBRE de una de las modalidades; no es una promesa que apliques a todas las cremaciones.
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

⚠️ DECISIÓN CLAVE — ¿gráfico suelto o PUBLICACIÓN? (no la confundas):
- Si el dueño solo quiere VER un gráfico/imagen en el chat (sin publicar ni agendar) → "disenar_grafico" (uno) o "generar_imagen".
- Si pide una PUBLICACIÓN para PUBLICAR, AGENDAR, PROGRAMAR o DEJAR EN EL CALENDARIO / "para [fecha]/hoy/mañana" (y MÁS si es de VARIAS LÁMINAS) → SIEMPRE el FLUJO DEL CALENDARIO, COMPLETO y de punta a punta, sin parar a mitad:
  1) "proponer_campanas" → creá el ítem (fecha + canal + audiencia + objetivo + idea).
  2) "generar_pieza" con ese id → genera el POST COMPLETO (todas las láminas en una sola pasada; NUNCA armes el carrusel con disenar_grafico lámina por lámina).
  3) "editar_campana" estado="aprobada".
  4) "editar_campana" fecha=<la fecha pedida> estado="programada" (se autopublica a esa fecha/hora).
  Hacé los 4 pasos en el MISMO turno y recién al final confirmá en 1-2 frases. JAMÁS entregues una sola lámina y pares cuando pidieron una publicación a agendar.

1. PLANIFICAR (barato): para un plan, primero "listar_calendario" (no duplicar ni saturar) y luego "proponer_campanas" con ítems repartidos por canal/fecha/objetivo (solo idea + fecha + canal + audiencia + objetivo + título corto). No generes piezas en este paso.
1b. GESTIONAR EL CALENDARIO (hacelo cuando te lo pidan, sin vueltas): podés EDITAR cualquier campaña con "editar_campana" (mover de fecha u hora, cambiar canal/audiencia/objetivo, corregir idea/título, aprobar, programar, descartar→"descartada", archivar→activa=false), CREAR nuevas con "proponer_campanas", y BORRAR de forma permanente con "eliminar_campana" (solo si lo piden explícito; si dudás entre borrar o descartar, descartá o preguntá). Si no tenés el id, mirá "listar_calendario" primero. Para mover/editar varias a la vez, llamá la herramienta una vez por cada una en el mismo turno. Tras el cambio, confirmá en una frase qué quedó.
   FLUJO DE PUBLICACIÓN (importante): es generar → aprobar → programar → (auto)publicar. NO se puede APROBAR sin GENERAR la pieza primero (estado "aprobada" requiere copy+imagen), ni PROGRAMAR sin APROBAR (estado "programada"). Una campaña en estado "programada" se PUBLICA SOLA cuando llega su fecha/hora. Entonces, si el dueño te pide "programá/agendá la publicación de la #X para tal fecha a tal hora": 1) si no está generada, generá la pieza ("generar_pieza"); 2) aprobala ("editar_campana" estado="aprobada"); 3) fijá la fecha/hora y dejala en estado="programada" ("editar_campana"). Aclarale que quedó programada y se publicará sola a esa hora.
2. GENERAR PIEZA DEL CALENDARIO: "generar_pieza" con el id (copy + imagen para social, o asunto + HTML para email). Úsalo cuando el dueño lo pida sobre ítems concretos.
2b. REUTILIZAR lo que YA existe (NUNCA lo regeneres con generar_pieza, que crea contenido NUEVO y distinto). Resolvelo VOS de una, sin ofrecer menús de opciones:
   - Republicar un post entero o llevarlo a otro canal → "reutilizar_publicacion" (id; canal opcional para IG↔FB). Crea una copia con el copy y TODAS las imágenes, lista para publicar/programar; el original queda intacto. Ej.: "subí a Facebook el carrusel que hicimos en Instagram".
   - Poner imágenes que YA existen en una pieza → "usar_imagenes_en_pieza" (id, codigos). Una campaña "C-X" trae TODAS sus imágenes en orden. Ej.: "agarrá la C-4 y poné esas 7 placas en la pieza de Facebook #21".
3. IMÁGENES Y GRÁFICOS sueltos (lo más usado en el chat). Entregá la pieza TERMINADA y mostrala con ![](URL). (Podés mirar el banco con "consultar_banco_imagenes" para reutilizar.)
   - GRÁFICO CON TEXTO (portada de FB, placa con datos/horario/diferenciadores, anuncio, cita, post con texto) → "disenar_grafico": VOS diseñás el HTML (libre y creativo) y sale con la marca EXACTA (More Sugar + Inter, navy/dorado/crema exactos, logo real). Seguí las reglas de "DISEÑO DE GRÁFICOS CON TEXTO" del contexto. El texto SIEMPRE va por acá, NUNCA con una imagen generada por IA. CARRUSEL (varias placas de una serie): generá TODAS las placas en la MISMA respuesta y poné el MISMO valor en "carrusel" (ej. "por-que-elegirnos") en todas, para que queden agrupadas como una sola campaña (C-X.1, C-X.2, …) y no como campañas sueltas. ⚠️ disenar_grafico es para un gráfico SUELTO que el dueño quiere VER en el chat; si pide una PUBLICACIÓN para publicar/agendar/dejar en el calendario, NO uses esto → flujo del calendario (proponer_campanas → generar_pieza → aprobar → programar).
   - FOTO sola (sin texto) → "generar_imagen": prompt fotográfico detallado.
   - EDITAR una foto existente (cambiar un detalle SIN rehacerla) → "generar_imagen" con editar:true + la referencia (referencia_url del banco, o usar_adjunto:true si la adjuntó el dueño) y en el prompt SOLO el cambio.
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
    return `TARIFAS VIGENTES de cremación (CLP, por peso):\n${tramos}\n\nTipos de servicio: ${nombres}. Entrega en hasta 3 días hábiles.`
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
  return `BANCO DE IMÁGENES (${banco.length} imágenes — ${resumen}). Cada imagen tiene un CÓDIGO (i-N foto · C-X.Y pieza). Usa "consultar_banco_imagenes" (con \`codigo\` o \`buscar\` para resolver una referencia del dueño, o \`grupo\` para filtrar) y prioriza reutilizar.`
}

/** Variantes del logo (grupo "marca") con su URL, para que el agente las coloque en
 *  los gráficos (disenar_grafico) eligiendo la que contraste con el fondo. */
function bloqueLogos(banco: ImagenBanco[]): string {
  const logos = banco.filter(esLogo)
  if (logos.length === 0) return ''
  const lineas = logos.map(l => {
    const d = `${l.descripcion || l.alt || ''}`.toLowerCase()
    const hint = /blanc/.test(d) ? ' → sobre fondos OSCUROS/navy' : /azul|navy|oscuro/.test(d) ? ' → sobre fondos CLAROS/crema' : ''
    return `- ${l.descripcion || `logo #${l.id}`}: ${l.url}${hint}`
  }).join('\n')
  return `LOGOS DE MARCA (al diseñar un gráfico con "disenar_grafico", poné el logo con <img src="URL"> usando UNA de estas URLs; elegí la que CONTRASTE con el fondo donde lo ubiques):\n${lineas}`
}

/**
 * Recupera el ÚLTIMO gráfico que el agente diseñó (su HTML final + las fotos), para
 * inyectarlo en el contexto del turno siguiente.
 *
 * POR QUÉ: el chat solo persiste TEXTO ({rol,texto}); el HTML que el agente diseñó y
 * las URLs de las fotos viven en bloques tool que se descartan entre requests. Sin
 * esto, al pedir un ajuste el agente NO tiene cómo recuperar lo que hizo → rehace el
 * diseño de cero y vuelve a pedir la foto (por eso "se le cambia la imagen" y la
 * calidad deriva en cada ajuste). Le devolvemos el HTML EXACTO para que edite sobre él.
 */
async function bloqueUltimoGrafico(historial: TurnoMarketing[]): Promise<string> {
  // URLs de imagen que el agente mostró (![](url)), de la más reciente a la más antigua.
  const urls: string[] = []
  for (let i = historial.length - 1; i >= 0 && urls.length < 6; i--) {
    const t = historial[i]
    if (t.rol !== 'agente' || !t.texto) continue
    const enTurno: string[] = []
    const re = /!\[[^\]]*\]\(([^)\s]+)\)/g
    let m: RegExpExecArray | null
    while ((m = re.exec(t.texto))) enTurno.push(m[1])
    urls.push(...enTurno.reverse()) // dentro del turno, la última imagen primero
  }
  for (const url of urls.slice(0, 6)) {
    const d = await cargarDisenoGrafico(url)
    if (!d) continue // no es un gráfico con sidecar (foto suelta, etc.) → seguimos
    const fotosTxt = d.fotos.length
      ? `\nFotos ya generadas (sus URLs YA están en los <img> de abajo; dejalas IGUAL salvo que te pidan explícitamente otra foto): ${d.fotos.map(f => `${f.slot}=${f.url}`).join(', ')}.`
      : ''
    return `ÚLTIMO GRÁFICO QUE DISEÑASTE (formato=${d.formato}). Si el dueño pide AJUSTAR / cambiar / corregir esta portada/placa/gráfico (o dice "el último", "este", "lo de antes", "mantené el resto"), NO empieces de cero: llamá "disenar_grafico" con el MISMO formato, copiá EXACTAMENTE este HTML y cambiá SOLO lo que te pidan, manteniendo idénticos tamaños, colores, posiciones, el logo y LAS MISMAS FOTOS (por su URL real, que ya está en el <img>). NO uses FOTO:slot ni mandes "fotos" salvo que te pidan otra foto distinta.${fotosTxt}\nHTML EXACTO del último gráfico (editá sobre esto):\n\`\`\`html\n${d.html}\n\`\`\``
  }
  return ''
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

const TOOL_EDITAR_CAMPANA: Anthropic.Tool = {
  name: 'editar_campana',
  description: 'Edita uno o varios campos de un ítem del calendario por su id: fecha, hora, canal, audiencia, objetivo, idea, título, estado o si está activa. Úsalo cuando el dueño pida CAMBIAR o MOVER una campaña (otra fecha/hora, otro canal, corregir la idea/título), APROBARLA, DESCARTARLA o archivarla/reactivarla. Si no sabés el id, primero usá listar_calendario. Cambiá SOLO lo que te pidan; el resto queda igual. (Generar la pieza y publicar son acciones aparte: generar_pieza y publicar_pieza.) Podés llamarla varias veces en un mismo turno para editar varias campañas.',
  input_schema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Id del ítem del calendario a editar.' },
      fecha: { type: 'string', description: 'Nueva fecha YYYY-MM-DD (opcional).' },
      hora: { type: 'string', description: 'Nueva hora HH:MM 24h (opcional). Pasá string vacío para quitarla.' },
      canal: { type: 'string', enum: ['email', 'instagram', 'facebook'], description: 'Nuevo canal (opcional).' },
      audiencia: { type: 'string', enum: ['tutores', 'veterinarios', 'ambos'], description: 'Nueva audiencia (opcional).' },
      objetivo: { type: 'string', enum: ['captacion_vets', 'recordacion', 'educacion_tutores', 'postventa', 'promocion'], description: 'Nuevo objetivo (opcional).' },
      idea: { type: 'string', description: 'Nueva idea/descripción de la campaña (opcional).' },
      titulo: { type: 'string', description: 'Nuevo título/gancho (opcional).' },
      estado: { type: 'string', enum: ['propuesta', 'aprobada', 'programada', 'descartada'], description: 'Nuevo estado (opcional). Aprobar="aprobada"; descartar sin borrar="descartada".' },
      activa: { type: 'boolean', description: 'true=activa; false=archivar (sacar del calendario sin borrarla).' },
      notas: { type: 'string', description: 'Notas internas (opcional).' },
    },
    required: ['id'],
  },
}

const TOOL_ELIMINAR_CAMPANA: Anthropic.Tool = {
  name: 'eliminar_campana',
  description: 'BORRA de forma permanente un ítem del calendario por su id. Úsalo SOLO cuando el dueño pida explícitamente eliminar/borrar una campaña — es irreversible. Si solo quiere sacarla del plan sin borrarla, usá editar_campana con estado="descartada" o activa=false. Si no sabés el id, usá listar_calendario.',
  input_schema: {
    type: 'object',
    properties: { id: { type: 'string', description: 'Id del ítem del calendario a borrar.' } },
    required: ['id'],
  },
}

const TOOL_PRECIOS: Anthropic.Tool = {
  name: 'leer_precios',
  description: 'Devuelve las tarifas vigentes de cremación (ya las tienes en el contexto, pero úsala si necesitas reconfirmar antes de mencionar un valor).',
  input_schema: { type: 'object', properties: {}, required: [] },
}

const TOOL_BANCO: Anthropic.Tool = {
  name: 'consultar_banco_imagenes',
  description: 'Lista/busca imágenes del banco (para reutilizar o para RESOLVER un código que mencionó el dueño a su URL). Filtros opcionales: codigo (exacto, ej. "i-3" o "C-2.1"), buscar (texto libre sobre código/descripción/tags), grupo (mascotas, personas, productos, instalaciones, otro). Devuelve cada imagen con su código y su URL.',
  input_schema: {
    type: 'object',
    properties: {
      codigo: { type: 'string', description: 'Código exacto a resolver (ej. "i-3", "C-2.1"). Úsalo cuando el dueño se refiera a una imagen por su código.' },
      buscar: { type: 'string', description: 'Texto libre para buscar en código/descripción/tags (opcional).' },
      grupo: { type: 'string', description: 'Grupo a filtrar (opcional).' },
    },
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
  description: 'Crea o EDITA una FOTO suelta (fotorrealista) y la guarda en el banco. CREAR: prompt fotográfico detallado. EDITAR (cambiar un detalle SIN rehacer la imagen): editar:true + la referencia (usar_adjunto:true para la que adjuntó el dueño, o referencia_url con la URL EXACTA del banco) y en "prompt" SOLO el cambio. El LOGO de marca se agrega AUTOMÁTICAMENTE a lo que entregás (crear o editar), salvo sin_logo; NO pidas dibujar el logo. ⚠️ Para GRÁFICOS CON TEXTO (portadas, placas con datos/horario/diferenciadores, anuncios, citas) NO uses esto: usá "disenar_grafico" (sale con la marca EXACTA). Devuelve la URL; muéstrasela con ![](URL). NO uses esto para piezas del calendario (para eso, generar_pieza; para corregir imágenes de una pieza, editar_imagen_pieza).',
  input_schema: {
    type: 'object',
    properties: {
      prompt: { type: 'string', description: 'CREAR: descripción fotográfica detallada (fotorrealista; NUNCA instalaciones del crematorio; NO pidas dibujar el logo ni texto). EDITAR (editar:true): SOLO el cambio puntual (ej. "cambia el collar a rojo"), no toda la escena.' },
      editar: { type: 'boolean', description: 'true = EDITAR la imagen de referencia preservando todo lo demás y cambiando solo lo que digas en "prompt" (requiere usar_adjunto o referencia_url). false u omitir = crear una imagen nueva.' },
      aspect: { type: 'string', description: 'Relación de aspecto, ej. "1:1", "16:9", "4:5", "9:16". Se ignora al editar (la salida sigue el aspecto de la imagen base).' },
      descripcion: { type: 'string', description: 'Descripción de 1 línea para el banco (opcional).' },
      tags: { type: 'string', description: 'Palabras clave separadas por coma (opcional).' },
      grupo: { type: 'string', enum: ['mascotas', 'personas', 'productos', 'otro'], description: 'Grupo del banco (opcional, default otro).' },
      subgrupo: { type: 'string', description: 'Etiqueta/campaña para ordenar en el banco (opcional).' },
      usar_adjunto: { type: 'boolean', description: 'true para usar como referencia la(s) imagen(es) que el dueño adjuntó en este turno.' },
      referencia_url: { type: 'string', description: 'URL exacta de una imagen del banco para usar como referencia (al editar, la imagen a modificar).' },
      referencia_codigo: { type: 'string', description: 'Código del banco (ej. "i-3", "C-2.1") a usar como referencia/imagen a editar. Más cómodo que referencia_url cuando el dueño se refiere a la imagen por su código.' },
      logo_url: { type: 'string', description: 'Opcional: URL exacta de una variante de logo del banco (grupo "marca") para usar en vez de la que se elige automáticamente.' },
      sin_logo: { type: 'boolean', description: 'true para entregar la imagen SIN el logo de marca (por defecto TODO lo generado/editado lo lleva).' },
    },
    required: ['prompt'],
  },
}

const TOOL_DISENAR_GRAFICO: Anthropic.Tool = {
  name: 'disenar_grafico',
  description: 'Diseña una PIEZA GRÁFICA CON TEXTO con la MARCA EXACTA (portada de Facebook, placa con datos/horario/diferenciadores, anuncio, cita, post con texto). VOS escribís el diseño en HTML (layout libre y creativo) y el sistema lo rasteriza con las fuentes y colores REALES de Alma Animal (More Sugar + Inter; navy/dorado/crema exactos) y le pone el logo. Para FOTOS reales dentro del diseño usá <img src="FOTO:slot1" .../> y pedí cada foto en "fotos". Esto es lo correcto para CUALQUIER gráfico con texto (NO generar_imagen). Seguí las reglas de "DISEÑO DE GRÁFICOS CON TEXTO" del contexto (flexbox, fuentes y colores de marca, tamaño exacto del canvas). Devuelve la URL; muéstrasela con ![](URL).',
  input_schema: {
    type: 'object',
    properties: {
      formato: { type: 'string', enum: FORMATOS_GRAFICO, description: 'Tamaño/uso: portada_fb (portada de Facebook 1640x624), post (1080x1080), post_vertical (1080x1350), story (1080x1920), horizontal (1200x675).' },
      carrusel: { type: 'string', description: 'Si esta placa es parte de un CARRUSEL/serie, poné el MISMO identificador en TODAS las placas del carrusel (ej. "por-que-elegirnos"). Así quedan agrupadas en UNA campaña (C-X.1, C-X.2, …). Generá TODAS las placas del carrusel en esta misma respuesta. Dejalo vacío si es una placa suelta.' },
      html: { type: 'string', description: 'El diseño en HTML (un solo <div> raíz del tamaño exacto del canvas; estilos inline; flexbox; font-family \'More Sugar\' solo para el título y \'Inter\' para el resto; colores hex de marca; NO dibujes el logo; usá <img src="FOTO:slotN"> para fotos).' },
      fotos: {
        type: 'array',
        description: 'Fotos reales a generar e insertar (una por cada <img src="FOTO:slotN"> del HTML). Vacío si el gráfico no lleva fotos.',
        items: {
          type: 'object',
          properties: {
            slot: { type: 'string', description: 'Identificador, ej. "slot1" (debe coincidir con src="FOTO:slot1").' },
            prompt: { type: 'string', description: 'Descripción fotográfica detallada (fotorrealista, cálida, on-brand; NUNCA instalaciones).' },
            aspect: { type: 'string', description: 'Relación de aspecto de la foto, ej. "4:5", "1:1", "16:9" (acompañá el tamaño del contenedor).' },
            recortar: { type: 'boolean', description: 'true = CUTOUT: mascota recortada (PNG transparente) para "asomándose"/recortada sobre el color de fondo. Para foto full-bleed o panel rectangular, false.' },
          },
          required: ['slot', 'prompt'],
        },
      },
    },
    required: ['formato', 'html'],
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
  description: 'Ajusta UNA imagen de una pieza del calendario ya generada, PRESERVANDO el resto. Si es una placa de marca, edita su texto/diseño y la re-renderiza (gratis); si es una foto, la edita image-to-image. Ej: "arreglá la slide 3 de la #123" (indice=3). SIEMPRE indicá el "indice" de la slide a ajustar: en un carrusel NO se editan todas a la vez (si el dueño quiere cambiar varias, llamá la herramienta una vez por cada slide con su indice). En la instrucción describí SOLO el cambio puntual.',
  input_schema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Id de la pieza del calendario.' },
      instruccion: { type: 'string', description: 'Qué ajustar en esa slide (ej. "cambiá el título a X", "corregí el dato del horario").' },
      indice: { type: 'number', description: 'Posición de la slide a editar (1 = primera). OBLIGATORIO en carruseles (2+ imágenes): se edita SOLO esa.' },
    },
    required: ['id', 'instruccion'],
  },
}

const TOOL_REUTILIZAR: Anthropic.Tool = {
  name: 'reutilizar_publicacion',
  description: 'Reutiliza una publicación ANTIGUA (ya generada o publicada) para volver a usarla: crea una COPIA nueva en el calendario con el MISMO copy y TODAS sus imágenes, lista para publicar o programar. Sirve para republicar un post que funcionó, o para llevar un post de un canal a otro (ej. reusar en Facebook el carrusel que hicimos en Instagram → se copian TODAS las placas, no una sola). El original queda intacto. Para republicar tal cual NO cambies el canal. Si no sabés el id, usá listar_calendario. Después confirmá; publicar/programar es aparte y solo si lo pide.',
  input_schema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Id de la publicación a reutilizar (el original).' },
      canal: { type: 'string', enum: ['instagram', 'facebook'], description: 'Canal de la copia (opcional; por defecto el mismo del original). Útil para llevar un post de IG a FB o viceversa.' },
      fecha: { type: 'string', description: 'Fecha de la copia YYYY-MM-DD (opcional; por defecto hoy).' },
      hora: { type: 'string', description: 'Hora HH:MM 24h (opcional).' },
    },
    required: ['id'],
  },
}

const TOOL_USAR_IMGS: Anthropic.Tool = {
  name: 'usar_imagenes_en_pieza',
  description: 'Pone en una pieza del calendario (por su id) imágenes que YA EXISTEN en el banco, reemplazando las que tenga, SIN regenerar nada. En "codigos": un código de CAMPAÑA (ej. "C-4") trae TODAS sus imágenes en orden (C-4.1, C-4.2, …); también podés pasar códigos sueltos (ej. ["i-5","C-2.1"]) en el orden que quieras. Úsalo cuando el dueño quiera reutilizar fotos/placas que YA existen en una publicación (ej. "subí a Facebook las mismas 7 placas de la C-4"): para eso NUNCA uses generar_pieza (genera otras distintas). Funciona en Instagram y Facebook (ambos admiten varias imágenes).',
  input_schema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Id de la pieza del calendario.' },
      codigos: { type: 'array', items: { type: 'string' }, description: 'Códigos del banco: una campaña "C-X" (todas sus imágenes en orden) o códigos sueltos (i-N, C-X.Y) en el orden deseado.' },
    },
    required: ['id', 'codigos'],
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

  const [tarifas, cfg, banco, empresa, contacto] = await Promise.all([
    bloqueTarifas(),
    getMarketingConfig().catch(() => null),
    listarImagenes().catch(() => [] as ImagenBanco[]),
    bloqueEmpresa(),
    getContacto().catch(() => null),
  ])

  const system: Anthropic.TextBlockParam[] = [
    { type: 'text', text: `${REGLAS_INVIOLABLES}\n\n${BASE}\n\n${DIFERENCIADORES}\n\n${MARCA_VISUAL}\n\n${MARCA_GRAFICO}\n\n${tarifas}`, cache_control: { type: 'ephemeral' } },
  ]
  const ajustes = [
    cfg?.instrucciones?.trim() && `INSTRUCCIONES Y DATOS VIGENTES DEL EQUIPO (trátalos como la verdad actual; REEMPLAZAN el guion base si chocan, salvo: precios siempre de TARIFAS VIGENTES):\n${cfg.instrucciones.trim()}`,
    cfg?.calibracion?.trim() && `GUÍA DE ESTILO / LÍNEA EDITORIAL:\n${cfg.calibracion.trim()}`,
  ].filter(Boolean).join('\n\n')
  if (ajustes) system.push({ type: 'text', text: ajustes })
  if (empresa) system.push({ type: 'text', text: empresa })
  system.push({ type: 'text', text: bloqueFechaChile() })
  system.push({ type: 'text', text: bloqueBanco(banco) })
  const logos = bloqueLogos(banco)
  if (logos) system.push({ type: 'text', text: logos })
  // Estado del último gráfico (para que los AJUSTES editen el HTML exacto en vez de
  // rehacerlo y regenerar las fotos). Va sin cache (cambia cada turno).
  const ultimoGrafico = await bloqueUltimoGrafico(historial)
  if (ultimoGrafico) system.push({ type: 'text', text: ultimoGrafico })
  // Reglas inviolables REPETIDAS al final (máxima saliencia; se validan además por código).
  system.push({ type: 'text', text: REGLAS_INVIOLABLES })

  const tools = [TOOL_LISTAR, TOOL_PROPONER, TOOL_EDITAR_CAMPANA, TOOL_ELIMINAR_CAMPANA, TOOL_PRECIOS, TOOL_BANCO, TOOL_GENERAR, TOOL_AUDITAR, TOOL_GENERAR_IMG, TOOL_DISENAR_GRAFICO, TOOL_PUBLICAR, TOOL_PERFIL_FB, TOOL_METRICAS, TOOL_EDITAR_IMG, TOOL_REUTILIZAR, TOOL_USAR_IMGS]
  const convo: Anthropic.MessageParam[] = [...base]
  const acciones: string[] = []
  let cambios = false
  let textoFinal = ''
  // Carruseles de disenar_grafico en este turno: identificador → campaña compartida.
  const campaniasCarrusel = new Map<string, string>()

  for (let iter = 0; iter < 8; iter++) {
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
        } else if (tu.name === 'editar_campana') {
          const inp = tu.input as { id?: string; fecha?: string; hora?: string; canal?: string; audiencia?: string; objetivo?: string; idea?: string; titulo?: string; estado?: string; activa?: boolean; notas?: string }
          const id = String(inp.id || '')
          const actual = id ? await obtenerItem(id) : null
          if (!id) resultText = 'Falta el id de la campaña a editar.'
          else if (!actual) resultText = `No existe una campaña con id #${id}. Usá listar_calendario para ver los ids.`
          else {
            const patch: Record<string, string> = {}
            const campos: string[] = []
            const set = (k: string, v?: string) => { if (v != null && String(v).trim() !== '') { patch[k] = String(v).trim(); campos.push(k) } }
            // hora admite "" para borrarla (caso especial: el set normal ignora vacíos)
            set('fecha', inp.fecha); set('canal', inp.canal); set('audiencia', inp.audiencia)
            set('objetivo', inp.objetivo); set('idea', inp.idea); set('titulo', inp.titulo); set('estado', inp.estado); set('notas', inp.notas)
            if (inp.hora !== undefined) { patch.hora = String(inp.hora).trim(); campos.push('hora') }
            if (inp.activa !== undefined) { patch.activa = inp.activa ? 'TRUE' : 'FALSE'; campos.push('activa') }
            const errEstado = patch.estado ? validarCambioEstado(actual, patch.estado) : null
            if (campos.length === 0) resultText = 'No indicaste ningún cambio para esa campaña.'
            else if (errEstado) resultText = errEstado
            else {
              const it = await actualizarItem(id, patch)
              cambios = true
              resultText = `Campaña #${id} actualizada (${campos.join(', ')}). Quedó: ${it.fecha}${it.hora ? ' ' + it.hora : ''} · ${it.canal} · ${it.estado}${it.activa === 'FALSE' ? ' (archivada)' : ''} — ${it.idea || it.titulo || ''}.`
            }
          }
        } else if (tu.name === 'eliminar_campana') {
          const id = String((tu.input as { id?: string }).id || '')
          const actual = id ? await obtenerItem(id) : null
          if (!id) resultText = 'Falta el id de la campaña a borrar.'
          else if (!actual) resultText = `No existe una campaña con id #${id}.`
          else {
            await eliminarItem(id)
            cambios = true
            resultText = `Campaña #${id} (${actual.fecha} · ${actual.canal} — ${actual.idea || actual.titulo || ''}) eliminada del calendario de forma permanente.`
          }
        } else if (tu.name === 'leer_precios') {
          resultText = await bloqueTarifas()
        } else if (tu.name === 'consultar_banco_imagenes') {
          const inp = tu.input as { grupo?: string; codigo?: string; buscar?: string }
          const codigo = (inp.codigo || '').trim().toLowerCase()
          const buscar = (inp.buscar || '').trim().toLowerCase()
          let lista = banco.filter(b => !inp.grupo || b.grupo === inp.grupo)
          if (codigo) lista = lista.filter(b => (b.codigo || '').toLowerCase() === codigo)
          if (buscar) lista = lista.filter(b => `${b.codigo} ${b.descripcion} ${b.alt} ${b.tags}`.toLowerCase().includes(buscar))
          lista = lista.slice(0, 40)
          resultText = lista.length === 0
            ? (codigo ? `No encontré ninguna imagen con código "${inp.codigo}".` : 'No hay imágenes en el banco con ese filtro.')
            : lista.map(b => `${b.codigo || '#' + b.id} [${b.grupo || 'otro'}] ${b.descripcion || b.alt || '(sin descripción)'} — ${b.url}`).join('\n')
              + '\n\nSi le mostrás alguna al dueño, inclúyela con ![](URL) y nombrá su código.'
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
            const inp = tu.input as { prompt?: string; editar?: boolean; aspect?: string; descripcion?: string; tags?: string; grupo?: string; subgrupo?: string; usar_adjunto?: boolean; referencia_url?: string; referencia_codigo?: string; logo_url?: string; sin_logo?: boolean }
            const refs: { data: Buffer; mime: string }[] = []
            if (inp.usar_adjunto && opts.adjuntos?.length) refs.push(...opts.adjuntos)
            // Referencia por código (i-3, C-2.1): resolver a su URL desde el banco.
            let refUrl = inp.referencia_url
            if (!refUrl && inp.referencia_codigo) {
              const cod = inp.referencia_codigo.trim().toLowerCase()
              refUrl = banco.find(b => (b.codigo || '').toLowerCase() === cod)?.url
              if (!refUrl) { resultText = `No encontré ninguna imagen con código "${inp.referencia_codigo}" para usar de referencia.` ; results.push({ type: 'tool_result', tool_use_id: tu.id, content: resultText }); continue }
            }
            if (refUrl) {
              try {
                const rr = await fetch(refUrl)
                if (rr.ok) refs.push({ data: Buffer.from(await rr.arrayBuffer()), mime: rr.headers.get('content-type') || 'image/png' })
              } catch { /* referencia no accesible: seguimos sin ella */ }
            }
            // Editar (preservar la base y cambiar solo lo pedido) requiere referencia.
            // Si el dueño adjuntó/eligió una imagen para modificar, asumimos edición.
            const editar = (inp.editar ?? refs.length > 0) && refs.length > 0
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
            resultText = `Imagen ${editar ? 'editada' : 'creada'}${conLogoOk ? ' con el logo de marca' : ''} — código ${g.imagen.codigo || '(sin código)'} (guardada en el banco, grupo ${grupoImg}). Muéstrasela al dueño incluyéndola con ![](${urlFinal}) y decile su código (${g.imagen.codigo || ''}).`
          }
        } else if (tu.name === 'disenar_grafico') {
          const inp = tu.input as { formato?: string; html?: string; carrusel?: string; fotos?: { slot?: string; prompt?: string; aspect?: string; recortar?: boolean }[] }
          const lintH = inp.html?.trim() ? lintCopy({ placas: [extraerTextoHtml(String(inp.html))], telefono: contacto?.telefono, web: contacto?.web }) : []
          if (!inp.html?.trim()) {
            resultText = 'Falta el HTML del diseño.'
          } else if (lintH.length) {
            resultText = 'RECHAZADO por reglas de marca (corregí el HTML y volvé a llamar disenar_grafico, sin tocar el resto):\n- ' + lintH.map(h => `[${h.campo}] ${h.problema}`).join('\n- ')
          } else {
            const fotos = (inp.fotos || [])
              .filter(f => f?.slot && f?.prompt)
              .map(f => ({ slot: String(f.slot), prompt: String(f.prompt), aspect: f.aspect, recortar: f.recortar }))
            // Carrusel: todas las placas con el MISMO 'carrusel' comparten una campaña
            // (C-X.1, C-X.2, …). Se reserva una vez por identificador en este turno.
            let campania: string | undefined
            const carrKey = (inp.carrusel || '').trim()
            if (carrKey) {
              campania = campaniasCarrusel.get(carrKey)
              if (!campania) { campania = await asignarCampania(); campaniasCarrusel.set(carrKey, campania) }
            }
            const r = await generarGraficoMarca({
              formato: String(inp.formato || 'post'),
              html: String(inp.html),
              fotos,
              creadoPor: opts.creadoPor,
              campania,
            })
            cambios = true
            const fotosTxt = r.fotos.length
              ? ` Fotos usadas (si después SOLO cambiás texto, REUSÁ esta URL exacta en el <img>, NO generes otra): ${r.fotos.map(f => `${f.slot}=${f.url}`).join(', ')}.`
              : ''
            resultText = `Gráfico de marca generado (colores, tipografía y logo exactos) — código ${r.codigo || '(sin código)'}. Muéstraselo al dueño con ![](${r.url}) y decile su código (${r.codigo || ''}).${fotosTxt}${r.avisos.length ? ' Avisos: ' + r.avisos.join('; ') : ''}`
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
        } else if (tu.name === 'reutilizar_publicacion') {
          const inp = tu.input as { id?: string; canal?: string; fecha?: string; hora?: string }
          const id = String(inp.id || '')
          const orig = id ? await obtenerItem(id) : null
          if (!id) resultText = 'Falta el id de la publicación a reutilizar.'
          else if (!orig) resultText = `No existe una publicación con id #${id}. Usá listar_calendario para ver los ids.`
          else {
            const nuevo = await reutilizarItem(id, { canal: inp.canal, fecha: inp.fecha, hora: inp.hora, creadoPor: opts.creadoPor })
            cambios = true
            let nImgs = 0
            try { const a = nuevo.imagenes_json ? JSON.parse(nuevo.imagenes_json) : []; nImgs = Array.isArray(a) ? a.length : 0 } catch { /* */ }
            if (!nImgs && nuevo.imagen_url) nImgs = 1
            const cc = nuevo.canal !== orig.canal ? ` (${orig.canal}→${nuevo.canal})` : ''
            resultText = `Copié la publicación #${orig.id} como #${nuevo.id}${cc}, con su copy y ${nImgs} imagen(es), en estado "generada" (lista para publicar o programar). El original quedó intacto.${nuevo.imagen_url ? ` Mostrá la primera con ![](${nuevo.imagen_url}).` : ''} Preguntale al dueño si la publica ahora o la programa; NO la publiques sin que lo pida.`
          }
        } else if (tu.name === 'usar_imagenes_en_pieza') {
          const inp = tu.input as { id?: string; codigos?: string[] }
          const id = String(inp.id || '')
          const codigos = Array.isArray(inp.codigos) ? inp.codigos.map(String).filter(Boolean) : []
          if (!id) resultText = 'Falta el id de la pieza.'
          else if (codigos.length === 0) resultText = 'Pasá al menos un código (ej. "C-4" para toda la campaña, o "i-5").'
          else {
            const r = await setImagenesPieza(id, codigos)
            cambios = true
            const aviso = r.noEncontrados.length ? ` (no encontré: ${r.noEncontrados.join(', ')})` : ''
            resultText = `La pieza #${r.item.id} (${r.item.canal}) quedó con ${r.n} imagen(es) de ${codigos.join(', ')}${aviso}, en orden y SIN regenerar.${r.item.imagen_url ? ` Mostrá la primera con ![](${r.item.imagen_url}).` : ''} Si el dueño lo pide, publicала o programала.`
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
