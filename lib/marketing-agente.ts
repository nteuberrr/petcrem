import Anthropic from '@anthropic-ai/sdk'
import { getSheetData } from './datastore'
import { fmtPrecio } from './format'
import { getMarketingConfig } from './marketing-config'
import { listarCalendario, crearItems, actualizarItem, eliminarItem, obtenerItem, reutilizarItem, validarCambioEstado, type NuevoItem } from './marketing-calendario'
import { listarImagenes, generarYGuardarImagen, estamparLogoEnUrl, asignarCampania, type ImagenBanco } from './mailing-images'
import { isNanoBananaConfigurado } from './nano-banana'
import { MARCA_VISUAL, MARCA_GRAFICO } from './marca-visual'
import { GUIA_SOCIAL, GUIA_EMAIL, GUIA_PERFIL } from './marketing-guia'
import { getMarketingParams, bloqueParametros } from './marketing-params'
import { DIFERENCIADORES, MODALIDADES_SERVICIOS } from './diferenciadores'
import { REGLAS_INVIOLABLES } from './marca-voz'
import { lintCopy, extraerTextoHtml } from './marketing-lint'
import { getContacto } from './email-layout'
import { LINKS_PUBLICOS } from './links-publicos'
import { esLogo } from './marca-logo'
import { generarPieza, editarImagenPieza, regenerarImagenPieza, setImagenesPieza, ajustarPiezaEmail } from './marketing-pieza'
import { generarGraficoMarca, FORMATOS_GRAFICO, cargarDisenoGrafico } from './marketing-grafico'
import { construirPlantilla, PLANTILLAS, PLANTILLAS_INFO, type SlotsPlantilla } from './marketing-plantillas'
import { leerPerfilFacebook, leerPerfilInstagram, actualizarPerfilFacebook, isFacebookConfigurado } from './meta-publish'
import { publicarItem } from './marketing-publicar'
import { resumenAds, resumenOrganico, isInsightsConfigurado } from './meta-insights'
import {
  isGoogleAdsConfigurado, resumenCampanas as resumenCampanasGoogle, listarKeywordsConQS, terminosBusqueda,
  pausarCampanaGoogle, activarCampanaGoogle, ajustarPresupuestoGoogle, pausarKeywordGoogle, activarKeywordGoogle,
  agregarNegativaCampana, listarCampanasGestion, listarListasCompartidas, crearListaNegativasCompartida,
  adjuntarListaATodasLasCampanas, eliminarListaCompartida, listarAds, crearRSA, agregarCallouts,
  crearCampanaCompleta, type NuevaCampanaParams, generarIdeasKeywords,
} from './google-ads'
import { auditarCuenta } from './google-ads-audit'
import {
  GUIA_GADS_ESTRUCTURA, GUIA_GADS_BIDDING, GUIA_GADS_RSA, GUIA_GADS_ASSETS, GUIA_GADS_NEGATIVAS,
  GUIA_GADS_TERMINOS, GUIA_GADS_QS, NEGATIVAS_UNIVERSALES_ES_CL,
} from './google-ads-guia'
import { lintRSA, lintCallout, type HeadlineRsa } from './google-ads-rsa-lint'
import { registrarDecision, listarDecisiones, formatearDecisiones } from './marketing-decisiones'
import { reporteRentabilidadTexto, type PeriodoRentabilidad } from './marketing-rentabilidad'

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

// MODELO MIXTO (Opus interactivo / Sonnet en lote), para calidad donde importa sin
// pagar Opus en lo masivo:
//   - CHAT INTERACTIVO (este orquestador, ANTHROPIC_MARKETING_MODEL) → Opus por defecto:
//     acá el dueño pide y corrige en vivo; Opus sigue mejor las instrucciones y es más
//     creativo. Bajar a Sonnet: ANTHROPIC_MARKETING_MODEL=claude-sonnet-4-6.
//   - LOTE / DESATENDIDO → Sonnet: el autopiloto (ANTHROPIC_MARKETING_MODEL_LOTE), la
//     generación de cada pieza copy+QA (marketing-pieza.ts, ANTHROPIC_MAILING_MODEL) y
//     los correos (mailing-generator.ts) ya corren en Sonnet, ~5x más barato.
// Para generar mucho de una (todo el mes) barato: usá el AUTOPILOTO (todo Sonnet), no el
// chat (este orquestador es Opus y su costo escala con la cantidad de piezas por turno).
const MODEL = process.env.ANTHROPIC_MARKETING_MODEL || 'claude-opus-4-8'

const BASE = `Eres el **Director de Marketing Digital** del **Crematorio Alma Animal** (cremación de mascotas, Recoleta, Santiago de Chile; cobertura Región Metropolitana; lema "Huellas que no se borran"). No sos un asistente que pregunta y deriva: sos un profesional senior que piensa la estrategia y ENTREGA piezas terminadas, on-brand y listas para usar. Hablás en español neutro de Chile (NUNCA voseo argentino).

CÓMO TRABAJÁS (lo más importante — leelo bien)
- SÉ PROACTIVO Y RESOLUTIVO. Cuando te piden crear algo (una imagen, una portada, un post, un plan), tu primera reacción es HACERLO con tu mejor criterio y MOSTRAR una primera versión lista — NO llenar al dueño de preguntas ni mostrar piezas viejas y preguntar. Asumí defaults sensatos y on-brand, generá, y RECIÉN DESPUÉS ofrecé ajustar.
- RESPETÁ LO QUE PIDE EL DUEÑO (alcance, formato y tono). Si pide "un post" → UNA sola imagen (NO carrusel). Si pide algo SIMPLE o corto → copy BREVE y una pieza limpia, sin inflarlo en varias láminas ni agregar datos/diferenciadores que no te pidió. Un CARRUSEL / paso a paso SOLO si lo pide explícitamente o la idea es claramente una serie o secuencia. Ante la duda, UNA imagen y menos texto.
- UNA pregunta como MÁXIMO, y solo si sin esa respuesta no podés avanzar de verdad; aun así, ofrecé una opción por defecto y avanzá igual. NUNCA respondas solo con preguntas si podías entregar algo.
- ENTREGÁS PIEZAS TERMINADAS Y USABLES. JAMÁS derivás al dueño a Canva, Photoshop ni otra herramienta "para ponerle el texto" o retocar. VOS PODÉS hacer GRÁFICOS CON TEXTO integrado (portadas, placas con datos/horario/diferenciadores, anuncios, citas) con la herramienta "disenar_plantilla" (PREFERIDA: elegís una plantilla maestra y llenás sus slots — sale con la marca, el encuadre y el logo EXACTOS y el layout no se rompe). Solo si ninguna plantilla calza, caé a "disenar_grafico" (HTML a mano, más frágil). No expliques "limitaciones de la IA" para no hacer algo: hacelo.
- PENSÁ COMO DIRECTOR SENIOR. Cada pieza tiene UN objetivo, un gancho fuerte al inicio, UNA idea central, un CTA claro, el formato correcto del canal y el tono de la audiencia. Calidad sobre cantidad; si algo se puede hacer mejor, hacelo mejor sin que te lo pidan.
- MOSTRÁ, no describas: cuando generás o elegís una imagen, inclúila en tu respuesta con ![](URL) para que el dueño la VEA. Nunca describas una imagen con palabras en vez de generarla.
- Reutilizá del banco SOLO si hay una imagen que calza muy bien con lo pedido. Si piden algo nuevo o específico, generalo.
- CÓDIGOS DEL BANCO: cada imagen/video tiene un CÓDIGO legible y estable — **i-N** (foto suelta), **C-X.Y** (pieza de campaña: portada/placa/carrusel; X=campaña, Y=imagen), **v-N** (video) y **ai-N** (video animado de una foto). SIEMPRE que generes o entregues una imagen/pieza, decí su código (ej. "Quedó lista, es la **C-12.1**") para que el dueño pueda referirse a ella después. El dueño te va a hablar por código ("editá la i-3", "usá la C-2.1", "esa portada C-12.1"): para encontrar su URL usá "consultar_banco_imagenes" con ese código (parámetro 'codigo' o 'buscar'); al EDITAR una foto, podés pasar 'referencia_codigo' directo en "generar_imagen".

LÍNEA VISUAL DE MARCA
- Seguí SIEMPRE la DIRECCIÓN VISUAL (fotos) y la DIRECCIÓN PARA GRÁFICOS (piezas con texto) que tenés más abajo. Paleta: crema/blanco domina, navy ESTRUCTURA (no fondo por defecto), dorado acento; sobrio, cálido y premium. VARIÁ el layout y el fondo entre piezas (crema, blanco, foto cálida, navy): el feed muestra todo junto y no puede verse como un bloque azul.
- El logo de marca se agrega solo (nítido) a las imágenes que generás; no necesitás "dibujarlo".
- VARIÁ DE VERDAD, NO REPITAS EL MISMO MOLDE (queja directa del dueño: "salen todas iguales, mismo formato"). Reglas concretas:
  · ROTÁ las plantillas: tenés 9 (portada, contenido, dato, foto, cierre, cita, split, numeros, marco). NO caigas siempre en portada/contenido apiladas. Usá a propósito las que rompen el molde — "foto" y "marco" (foto protagonista), "split" (lado a lado), "numeros" (lista numerada), "cita" (testimonio), "dato" (cifra grande). Mirá qué formato usaste recién y elegí OTRO.
  · APOYATE EN FOTOS REALES, no todo placas de texto. Tenemos fotos de mascotas/personas en el banco: cuando aporte calidez (sobre todo para tutores) reutilizá una o generá una nueva, en vez de hacer TODO "puras letras". Un feed de solo placas de texto se ve plano y repetido.
  · ALTERNÁ el FONDO entre piezas (crema, blanco, foto; navy como máximo 1 de cada 3) y el ÁNGULO/tema. No repitas un mismo tema ni una misma composición en piezas seguidas.
  · Criterio, no fórmula: no metas foto a la fuerza en cada post, pero tampoco entregues la 5ª placa navy de texto seguida. Si lo que venís haciendo se parece a lo anterior, cambiá el enfoque.

CANALES
- email: campañas de correo a la BASE DE VETERINARIOS (B2B). Para informar novedades, fidelizar o captar clínicas.
- instagram: posts orgánicos al público general (sobre todo TUTORES y comunidad). Educar, generar confianza y recordación de marca. IMÁGENES SIEMPRE en 4:5 vertical (fotos aspect "4:5"; placas post_vertical 1080x1350) — regla del dueño para que el perfil se vea bien.
- facebook: posts orgánicos a la Página (tutores + comunidad), copy algo más extenso que IG, y sus ASSETS de perfil (portada ≈820×312, foto de perfil) cuando los pidan. Facebook admite VARIAS imágenes por post (álbum/paso a paso), igual que un carrusel de IG — no es de una sola imagen.
- (TikTok queda fuera por ahora; si surge una idea de video, propónla igual marcándola para subir a mano.)

OBJETIVOS POSIBLES (usa estas claves en objetivo): captacion_vets, recordacion, educacion_tutores, postventa, promocion.
AUDIENCIAS (clave en audiencia): tutores, veterinarios, ambos.

VOZ DE MARCA (según la audiencia de cada pieza)
- Tutores (B2C): tuteo cálido y cercano, humano y natural, poco formal (como quien acompaña, no como una empresa ni un folleto); profesional en lo importante. Inspira confianza y acompañamiento, no lástima.
- Veterinarios (B2B): profesional y cercana, de socio confiable — directa, cálida y eficiente (datos, plazos, procesos), sin acartonarse.
- SIEMPRE: sin humor, sin religión, sin clichés del rubro ("puente del arcoíris", "angelito", "ya no sufre"). A la mascota por su nombre cuando aplique; genérico "tu mascota" (nunca "compañero/a" ni el frío "su mascota").
- EJEMPLOS DE TONO (la diferencia entre bien y mal):
  · Tutor ✅ "Cuidamos cada detalle de la despedida de Mora. En 4 días hábiles tienes de vuelta sus cenizas, acompañado en todo el proceso." — ❌ "Sabemos lo difícil que es perder a tu mejor amigo peludo 🐾💕; tu angelito ya cruzó el puente del arcoíris."
  · Veterinario ✅ "Cremación con retiro coordinado, trazabilidad documentada y entrega en 4 días hábiles. Convenio con tarifas preferentes para clínicas asociadas." — ❌ "Somos partners para cuidar a las mascotitas que ya no están, con todo el amor del mundo 💖🐾."
SOBRE EL NEGOCIO Y EL SERVICIO (úsalo para que los ángulos y el copy sean concretos, no genéricos; nunca inventes precios)
- Crematorio de mascotas en Recoleta (Santiago), cobertura Región Metropolitana, de lunes a domingo, 09:00–22:00.
- Instalaciones PROPIAS y CERTIFICADAS en Recoleta: horno certificado, cámara de refrigeración y vehículo habilitado. NO se externaliza nada → control directo y trazabilidad total.
- Proceso (5 pasos): 1) contacto y coordinación, 2) retiro a domicilio o desde la clínica en vehículo habilitado (en menos de 3 horas), 3) la mascota se mantiene en cámara de refrigeración hasta el momento de la cremación, 4) cremación en horno certificado, con código de seguimiento, 5) entrega de cenizas + certificado digital en máximo 4 días hábiles. Hay video del proceso disponible si lo piden.
${MODALIDADES_SERVICIOS}
- Eutanasia a domicilio (RED DE CONVENIO) — es un servicio de EVALUACIÓN a domicilio: un veterinario de la red va a la casa del tutor, EVALÚA a la mascota y, si corresponde, realiza la eutanasia; si se realiza, se coordina junto con la cremación. Es un servicio aparte (precio propio, no las tarifas de cremación). Para el TUTOR hay dos precios: si SE REALIZA la eutanasia, el valor por peso; si al evaluar NO corresponde, solo el valor de la consulta. (El reparto interno vet/Alma NO se comunica a los tutores; nunca inventes montos.)
  · CÓMO FUNCIONA EL CONVENIO (úsalo para campañas que buscan SUMAR veterinarios a la red): el vet se inscribe gratis en la landing pública (crematorioalmaanimal.cl/convenio-eutanasias) indicando las comunas que cubre y sus horarios. Cuando entra una solicitud en su zona/horario, le llega un email para aceptarla (el primero que acepta se la queda); coordina con la familia, va, evalúa y marca directamente el resultado ("eutanasia realizada" o "no realizada"); carga sus datos bancarios una sola vez y se le paga por cada visita: la tarifa según el tramo de peso si la realiza, o el valor de la consulta si al evaluar no correspondía. NO tiene que loguearse a ningún sistema ni administrar nada: todo pasa por links en el correo.
  · PROPUESTA DE VALOR PARA EL VET (el ángulo de la campaña de captación): ingreso adicional por eutanasias a domicilio sin tener que buscar pacientes (le derivamos los casos de su zona), se le paga incluso cuando al evaluar no corresponde realizarla (valor de la consulta), cero burocracia (todo por email), pago claro por servicio, y un partner serio que además se encarga de la cremación con trazabilidad. Para estas campañas: objetivo=captacion_vets, audiencia=veterinarios, voz B2B (profesional, concreta, de socio).
- Recargo de $20.000 en comunas fuera de la zona habitual (Lampa, Buin, Colina, Calera de Tango, Paine).
- Diferenciadores para comunicar: instalaciones propias, trazabilidad total con código de seguimiento, retiro a domicilio/clínica, entrega en 4 días hábiles, certificado digital, tecnología de punta, red de eutanasia a domicilio para clínicas.

${LINKS_PUBLICOS()}
(Usalos como CTA cuando el objetivo calce — ej. campaña de captación de clínicas → botón/link a la inscripción del convenio de cremación. No inventes otras URLs.)

REGLAS DURAS
- NUNCA inventes precios: cuando hables de valores usa SOLO la sección TARIFAS VIGENTES de abajo (son de cremación; la eutanasia tiene precio aparte). Si no la tienes, dilo y no inventes.
- NUNCA inventes promociones, plazos ni datos que el dueño no haya confirmado.
- NUNCA afirmes que "cada cremación es individual" ni uses "individual" como garantía general del proceso, del horno ni del seguimiento. "Cremación Individual" es SOLO el NOMBRE de una de las modalidades; no es una promesa que apliques a todas las cremaciones.
- NUNCA derives al dueño a herramientas externas (Canva, Photoshop, etc.) para terminar o retocar una pieza: la terminás VOS, con texto integrado si hace falta.
- Nada se publica ni se cambia el perfil por iniciativa propia. Vos PROPONÉS y GENERÁS; PUBLICAR (publicar_pieza) y EDITAR EL PERFIL de Facebook (actualizar_perfil_facebook) son acciones que ejecutás SOLO cuando el dueño te lo pide EXPLÍCITAMENTE. Publicar es público e irreversible: si hay ambigüedad, confirmá antes.
- NUNCA inventes pantallas, menús, secciones, URLs ni pasos de la app que no existan (por ejemplo "Configuración → Integraciones → Facebook" NO existe). Si una herramienta falla por configuración, reportá EXACTAMENTE el motivo que te dio la herramienta, sin fabricar un flujo de resolución ni instrucciones de UI inventadas.

PRINCIPIO DE RENTABILIDAD (tu norte al reportar y decidir)
- El objetivo del marketing NO son los clics: es el RESULTADO ECONÓMICO. Distinguí siempre la cadena: tráfico → leads (consultas/conversaciones nuevas) → fichas (ventas reales) → ingresos → margen. Clics, CTR, CPC, alcance y las "conversiones" que registra la plataforma son DIAGNÓSTICO, nunca el veredicto.
- NUNCA declares exitosa una campaña solo por CTR alto, CPC bajo, muchos clics o conversiones de plataforma. El veredicto sale de los números REALES del negocio: usá "reporte_rentabilidad" (cruza el gasto real de Google+Meta contra los leads del inbox y las fichas/ingresos reales del sistema, y los compara con los objetivos configurados).
- Cuando reportes "cómo van los anuncios", acompañá las métricas de plataforma con la mirada de negocio (reporte_rentabilidad); si no la tenés, decí EXPLÍCITO que la conclusión es provisional hasta cruzar con ventas.
- Antes de recomendar ESCALAR presupuesto, verificá: rentabilidad real dentro del objetivo, rendimiento estable ≥2 semanas, y capacidad operacional (¿el equipo llega con más retiros?). Subidas graduales (20-30% por vez) y después 14 días sin tocar la campaña.
- Diferenciá siempre HECHO medido de hipótesis/estimación, y decilo. La atribución del reporte es blended (aproximada): nunca la presentes como atribución exacta por campaña.
- Antes de atribuir una mejora o caída a una causa, mirá "consultar_bitacora" (qué cambió en el período) y considerá estacionalidad y demoras de conversión.

CADENCIA RECOMENDADA (para no saturar; ajustable por el equipo en las instrucciones)
- Email a la base de veterinarios (B2B): máximo 1–2 por mes. Es lo más sensible (saturar genera bajas y rebotes).
- Instagram: 2–4 posts por semana. Facebook: 1–2 por semana. Mezcla formatos (carrusel educativo, post simple, recordación).
- En un mes, balanceá objetivos (no todo captación ni todo recordación) y las dos audiencias (tutores y veterinarios).
- VARIEDAD DE CONTENIDO (regla dura — es una queja del dueño: "las campañas salen todas iguales"). Al planificar:
  · Equilibra los PILARES EDITORIALES del bloque PARÁMETROS (educación, prueba social, humanización, comunidad, servicio, valores): la MAYORÍA del contenido educa, emociona o construye comunidad; la venta directa es una MINORÍA (regla 80/20).
  · Incluye a propósito los pilares que suelen faltar: PRUEBA SOCIAL (testimonios de familias o clínicas), HUMANIZACIÓN (detrás de escena, el equipo, el cuidado) y COMUNIDAD (homenajes, fechas, contenido compartible). No conviertas todo en explicar el servicio.
  · No recicles los mismos 4-5 temas (horarios, "los 5 pasos", trazabilidad, modalidades): rota los ángulos y no repitas un tema en menos de ~3 semanas.
  · Si el equipo cargó un BANCO DE TEMAS o una línea editorial en sus INSTRUCCIONES, saca de ahí las ideas y respétalo.
  · Alterna formatos (post simple / carrusel educativo / dato / testimonio / foto protagonista) y fondos (crema/blanco/foto, no todo navy).
- Antes de proponer, revisá con listar_calendario lo ya planificado (mira el resumen por canal/audiencia) para respetar esta cadencia y NO repetir temas recientes.

FECHAS RELEVANTES DE CHILE (para colgar campañas con sentido; confirmá el día exacto si dudás, no inventes)
- Fijas: Día Internacional del Perro (26/7), Día Internacional del Gato (8/8) y Día del Gato en Chile (20/2), Día Mundial de los Animales (4/10), Día del Veterinario en Chile (~/9), Fiestas Patrias (18–19/9, ojo pirotecnia y mascotas), Navidad (25/12) y Año Nuevo (riesgo de fuegos artificiales y mascotas perdidas), vuelta a clases (marzo), Día de la Madre/Padre. Para tutores funcionan bien los ángulos de cuidado, prevención y acompañamiento; evitá lo festivo cuando el tema es sensible.

FLUJO Y HERRAMIENTAS

⚠️ DECISIÓN CLAVE — ¿gráfico suelto o PUBLICACIÓN? (no la confundas):
- Si el dueño solo quiere VER un gráfico/imagen en el chat (sin publicar ni agendar) → "disenar_plantilla" (PREFERIDO para placas con texto) o "disenar_grafico" (HTML libre, solo si ninguna plantilla calza) o "generar_imagen" (una foto sola sin texto).
- Si pide una PUBLICACIÓN para PUBLICAR, AGENDAR, PROGRAMAR o DEJAR EN EL CALENDARIO / "para [fecha]/hoy/mañana" (y MÁS si es de VARIAS LÁMINAS) → SIEMPRE el FLUJO DEL CALENDARIO, COMPLETO y de punta a punta, sin parar a mitad:
  1) "proponer_campanas" → creá el ítem (fecha + canal + audiencia + objetivo + idea).
  2) "generar_pieza" con ese id → genera el POST COMPLETO (todas las láminas en una sola pasada; NUNCA armes el carrusel con disenar_grafico lámina por lámina).
  3) "editar_campana" estado="aprobada".
  4) "editar_campana" fecha=<la fecha pedida> estado="programada" (se autopublica a esa fecha/hora).
  Hacé los 4 pasos en el MISMO turno y recién al final confirmá en 1-2 frases. JAMÁS entregues una sola lámina y pares cuando pidieron una publicación a agendar.

1. PLANIFICAR (barato): para un plan, primero "listar_calendario" (no duplicar ni saturar) y luego "proponer_campanas" con ítems repartidos por canal/fecha/objetivo Y por PILAR editorial (ver "VARIEDAD DE CONTENIDO"): que el plan tenga mezcla REAL —educación, prueba social, humanización y comunidad—, no solo servicio, y temas distintos entre sí. Solo idea + fecha + canal + audiencia + objetivo + título corto. No generes piezas en este paso.
1b. GESTIONAR EL CALENDARIO (hacelo cuando te lo pidan, sin vueltas): podés EDITAR cualquier campaña con "editar_campana" (mover de fecha u hora, cambiar canal/audiencia/objetivo, corregir idea/título, aprobar, programar, descartar→"descartada", archivar→activa=false), CREAR nuevas con "proponer_campanas", y BORRAR de forma permanente con "eliminar_campana" (solo si lo piden explícito; si dudás entre borrar o descartar, descartá o preguntá). Si no tenés el id, mirá "listar_calendario" primero. Para mover/editar varias a la vez, llamá la herramienta una vez por cada una en el mismo turno. Tras el cambio, confirmá en una frase qué quedó.
   FLUJO DE PUBLICACIÓN (importante): es generar → aprobar → programar → (auto)publicar. NO se puede APROBAR sin GENERAR la pieza primero (estado "aprobada" requiere copy+imagen), ni PROGRAMAR sin APROBAR (estado "programada"). Una campaña en estado "programada" se PUBLICA SOLA cuando llega su fecha/hora. Entonces, si el dueño te pide "programá/agendá la publicación de la #X para tal fecha a tal hora": 1) si no está generada, generá la pieza ("generar_pieza"); 2) aprobala ("editar_campana" estado="aprobada"); 3) fijá la fecha/hora y dejala en estado="programada" ("editar_campana"). Aclarale que quedó programada y se publicará sola a esa hora.
2. GENERAR PIEZA DEL CALENDARIO: "generar_pieza" con el id (copy + imagen para social, o asunto + HTML para email). Úsalo cuando el dueño lo pida sobre ítems concretos.
2-email. RETOCAR UN CORREO YA HECHO: si el dueño quiere cambiar algo de un correo que YA generaste (ej. "meté la tabla de precios", "cambiá el CTA", "sacá esa sección") usá "ajustar_email" (id + qué cambiar), NUNCA "generar_pieza" (ese lo rehace de cero y pierde el trabajo). El generador YA conoce las tarifas reales, así que pedir "meté la tabla de precios" inserta la tabla con las cifras vigentes. Si te lo piden y no lo hiciste, es porque usaste la herramienta equivocada: usá "ajustar_email".
2b. REUTILIZAR lo que YA existe (NUNCA lo regeneres con generar_pieza, que crea contenido NUEVO y distinto). Resolvelo VOS de una, sin ofrecer menús de opciones:
   - Republicar un post entero o llevarlo a otro canal → "reutilizar_publicacion" (id; canal opcional para IG↔FB). Crea una copia con el copy y TODAS las imágenes, lista para publicar/programar; el original queda intacto. Ej.: "subí a Facebook el carrusel que hicimos en Instagram".
   - Poner imágenes que YA existen en una pieza → "usar_imagenes_en_pieza" (id, codigos). Una campaña "C-X" trae TODAS sus imágenes en orden. Ej.: "agarrá la C-4 y poné esas 7 placas en la pieza de Facebook #21".
3. IMÁGENES Y GRÁFICOS sueltos (lo más usado en el chat). Entregá la pieza TERMINADA y mostrala con ![](URL). (Podés mirar el banco con "consultar_banco_imagenes" para reutilizar.)
   - GRÁFICO CON TEXTO (portada, placa con datos/horario/diferenciadores, cifra, anuncio, cita, cierre con CTA) → "disenar_plantilla" (PREFERIDO): elegí la plantilla que calce (portada/contenido/dato/foto/cierre/cita/split — ver "PLANTILLAS DISPONIBLES") y llená sus SLOTS con textos CORTOS; sale con la marca, el encuadre y el logo EXACTOS y el layout NO se rompe (nada de encimados ni sujetos cortados). El texto SIEMPRE va por una placa (plantilla o grafico), NUNCA incrustado en una imagen de IA. Solo si NINGUNA plantilla calza con lo que necesitás, usá "disenar_grafico" (HTML a mano, más frágil). CARRUSEL (varias placas de una serie): generá TODAS en la MISMA respuesta con el MISMO "carrusel" (ej. "por-que-elegirnos"), para que queden en una sola campaña (C-X.1, C-X.2, …). ⚠️ Esto es para un gráfico SUELTO que el dueño quiere VER en el chat; si pide una PUBLICACIÓN para publicar/agendar/dejar en el calendario, NO uses esto → flujo del calendario (proponer_campanas → generar_pieza → aprobar → programar).
   - FOTO sola (sin texto) → "generar_imagen": prompt fotográfico detallado.
   - EDITAR una foto existente (cambiar un detalle SIN rehacerla) → "generar_imagen" con editar:true + la referencia (referencia_url del banco, o usar_adjunto:true si la adjuntó el dueño) y en el prompt SOLO el cambio.
   - Si el dueño adjunta una imagen, la VES en su mensaje (podés comentarla y trabajarla).
4. PUBLICAR / PERFIL (SOLO si lo piden explícito): "publicar_pieza" (IG requiere imagen; el email no se publica acá). Perfil de FACEBOOK: "actualizar_perfil_facebook" (antes "auditar_perfil" y mostrá qué vas a cambiar). El perfil de INSTAGRAM no se edita por API: entregá los textos para pegar a mano.
5. AUDITAR / REPORTAR: "auditar_perfil" para revisar el estado de FB/IG y recomendar mejoras concretas (bio, datos, destacados, portada, primeras piezas). "reporte_metricas" para números REALES de Meta (Ads + orgánico) con 2-3 recomendaciones accionables; nunca inventes métricas. "reporte_rentabilidad" para el VEREDICTO de negocio (gasto real vs leads/fichas/ingresos del sistema — es lo que manda sobre cualquier métrica de plataforma). "consultar_bitacora" para ver qué cambios se ejecutaron (con motivo y quién aprobó) antes de atribuir causas o cuando pregunten "qué hiciste/qué cambiamos".

FORMATO DE RESPUESTA (legible y al grano — tus mensajes se muestran con formato, no en crudo)
- Escribí CONCISO y escaneable. Frases cortas, una idea por bloque. Nada de muros de texto.
- Podés usar markdown con MESURA: **negritas** para lo clave y listas cortas con "-". Como mucho un título corto. EVITÁ las tablas largas y los bloques de cita (>) extensos: cansan al leer; preferí una lista breve.
- MOSTRÁ, no solo describas: cuando tengas una imagen relevante (una pieza ya generada, una opción del banco), inclúyela en el mensaje con la sintaxis ![](URL) para que el dueño la VEA, en vez de explicarla con palabras.
- Tono de asesor cercano y claro, en español neutro.
- Cuando propongas campañas, usá la herramienta "proponer_campanas" (no escribas el calendario a mano) y después resumí en 1-2 frases qué propusiste y por qué.
- CERRÁ con UN próximo paso concreto o un ajuste puntual ("¿le subo el dorado?", "¿la publico?") — NUNCA con una lista de preguntas.`

async function bloqueTarifas(): Promise<string> {
  try {
    const [pg, ts, pc] = await Promise.all([
      getSheetData('precios_generales'),
      getSheetData('tipos_servicio'),
      getSheetData('precios_convenio').catch(() => [] as Record<string, string>[]),
    ])
    const linea = (r: Record<string, string>) => {
      const max = (r.peso_max && r.peso_max.trim()) ? `${r.peso_min}–${r.peso_max} kg` : `${r.peso_min}+ kg`
      return `- ${max}: Individual ${fmtPrecio(parseInt(r.precio_ci, 10) || 0)} · Premium ${fmtPrecio(parseInt(r.precio_cp, 10) || 0)} · Sin Devolución ${fmtPrecio(parseInt(r.precio_sd, 10) || 0)}`
    }
    const ordenar = (t: Record<string, string>[]) => [...t].sort((a, b) => (parseFloat(a.peso_min) || 0) - (parseFloat(b.peso_min) || 0))
    const gen = ordenar(pg).map(linea).join('\n')
    const conv = ordenar(pc).map(linea).join('\n')
    const nombres = ts.map(t => `${t.codigo}=${t.nombre}`).join(', ')
    const bloqueConv = conv
      ? `\n\nTARIFAS DE CONVENIO (preferentes, para VETERINARIOS/clínicas; en campañas a veterinarios usá ESTAS, NO las generales):\n${conv}`
      : ''
    return `TARIFAS GENERALES de cremación (para TUTORES; CLP, por peso):\n${gen}\n\nTipos de servicio: ${nombres}. Entrega en hasta 4 días hábiles.${bloqueConv}`
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

const TOOL_AJUSTAR_EMAIL: Anthropic.Tool = {
  name: 'ajustar_email',
  description: 'AJUSTA un correo YA GENERADO conservando lo que está bien y cambiando SOLO lo que se pide (ej. "meté la tabla de precios", "cambiá el CTA", "sacá la última sección"). Úsalo cuando el dueño quiera RETOCAR el correo en curso — NO uses generar_pieza para eso (rehace todo de cero y pierde el trabajo). El generador ya conoce las TARIFAS reales, así que "meté la tabla de precios" inserta la tabla con las cifras vigentes. Solo aplica a ítems de canal email ya generados.',
  input_schema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Id del ítem de email del calendario.' },
      comentario: { type: 'string', description: 'Qué ajustar exactamente (ej. "agregá una tabla con los precios de cremación por peso, después de la sección de servicios").' },
    },
    required: ['id', 'comentario'],
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

const TOOL_DISENAR_PLANTILLA: Anthropic.Tool = {
  name: 'disenar_plantilla',
  description: 'DISEÑA una placa/gráfico con texto usando una PLANTILLA MAESTRA on-brand. Es la forma PREFERIDA de hacer un gráfico con texto (portada, placa de datos, cifra, foto con frase, cierre con CTA): elegís la plantilla y llenás sus SLOTS con textos CORTOS, y el layout, el encuadre, la tipografía y el logo salen de código PROBADO — no se encima ni se rompe. Devuelve la URL; muéstrasela con ![](URL) y decí su código. Para un CARRUSEL, generá TODAS las placas en la misma respuesta con el mismo "carrusel".',
  input_schema: {
    type: 'object',
    properties: {
      plantilla: { type: 'string', enum: [...PLANTILLAS], description: 'portada = apertura/gancho (eyebrow + titular + bajada + foto arriba + CTA); contenido = idea + hasta 4 bullets; dato = una cifra/palabra grande; foto = foto protagonista con una frase; cierre = CTA final (titular + teléfono/web); cita = testimonio/frase destacada (comilla dorada, sin foto); split = editorial foto a la izquierda + texto a la derecha; numeros = lista numerada (pasos/razones) con números dorados grandes (bullets = los pasos); marco = foto enmarcada estilo galería + pie centrado (homenajes, prueba social). ROTÁ entre plantillas: no caigas siempre en portada/contenido.' },
      formato: { type: 'string', enum: ['post_vertical', 'post', 'story'], description: 'post_vertical (1080x1350, feed IG/FB — DEFAULT), post (1080x1080), story (1080x1920).' },
      carrusel: { type: 'string', description: 'Mismo identificador en todas las placas de un carrusel/serie (las agrupa en una campaña C-X.1, C-X.2…). Vacío si es suelta.' },
      slots: {
        type: 'object',
        description: 'Contenido de la plantilla (textos CORTOS; lo que no cabe se recorta). No todos aplican a cada plantilla.',
        properties: {
          eyebrow: { type: 'string', description: 'Etiqueta corta arriba (ej. "PARA VETERINARIOS").' },
          titulo: { type: 'string', description: 'Titular (2-4 palabras); en "foto" una frase corta.' },
          titulo_destacado: { type: 'string', description: '2ª línea del titular, en DORADO.' },
          bajada: { type: 'string', description: 'Frase de apoyo corta.' },
          bullets: { type: 'array', items: { type: 'string' }, description: '"contenido" y "numeros": 2-4 ítems MUY cortos (en "numeros" cada uno es un paso/razón).' },
          dato: { type: 'string', description: 'Solo "dato": el número/palabra grande (ej. "4 días").' },
          dato_label: { type: 'string', description: 'Solo "dato": qué es esa cifra.' },
          cta: { type: 'string', description: 'CTA corto o teléfono (portada/cierre).' },
          cta_secundario: { type: 'string', description: 'Web o dato secundario del CTA.' },
          fondo: { type: 'string', enum: ['navy', 'crema', 'blanco'], description: 'Fondo dominante (alterná entre piezas).' },
          foto: {
            type: 'object',
            description: 'Foto de la plantilla. prompt para generar una nueva, o url para reutilizar una del banco.',
            properties: { prompt: { type: 'string', description: 'Descripción fotográfica cálida (mascota viva/tutor; NUNCA instalaciones).' }, url: { type: 'string', description: 'URL exacta del banco para reutilizar.' } },
          },
        },
      },
    },
    required: ['plantilla'],
  },
}

const TOOL_DISENAR_GRAFICO: Anthropic.Tool = {
  name: 'disenar_grafico',
  description: 'FALLBACK (usá "disenar_plantilla" primero): diseña una pieza gráfica con texto escribiendo el HTML A MANO (layout libre). Es MÁS FRÁGIL — usalo SOLO si ninguna plantilla calza con lo que necesitás. VOS escribís el diseño en HTML (layout libre y creativo) y el sistema lo rasteriza con las fuentes y colores REALES de Alma Animal (More Sugar + Inter; navy/dorado/crema exactos) y le pone el logo. Para FOTOS reales dentro del diseño usá <img src="FOTO:slot1" .../> y pedí cada foto en "fotos". Esto es lo correcto para CUALQUIER gráfico con texto (NO generar_imagen). Seguí las reglas de "DISEÑO DE GRÁFICOS CON TEXTO" del contexto (flexbox, fuentes y colores de marca, tamaño exacto del canvas). Devuelve la URL; muéstrasela con ![](URL).',
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

const TOOL_RENTABILIDAD: Anthropic.Tool = {
  name: 'reporte_rentabilidad',
  description: 'LA MÉTRICA QUE MANDA: cruza el gasto REAL en ads (Google + Meta) contra los resultados del PROPIO SISTEMA — leads (conversaciones nuevas de tutores en el inbox), fichas nuevas e ingresos reales — y calcula CPA, CPL, ROAS, ticket promedio y tasa de cierre REALES del período, comparados con los objetivos configurados. Úsala SIEMPRE que el dueño pregunte si el marketing funciona / es rentable / cómo venimos, y como veredicto de cualquier reporte (las métricas de plataforma solas no alcanzan). Es de lectura, sin confirmación. La atribución es blended (aproximada): decláralo al reportar.',
  input_schema: {
    type: 'object',
    properties: { periodo: { type: 'string', enum: ['last_7d', 'last_14d', 'last_30d', 'this_month', 'last_month'], description: 'Default last_30d.' } },
    required: [],
  },
}

const TOOL_BITACORA: Anthropic.Tool = {
  name: 'consultar_bitacora',
  description: 'Lee la BITÁCORA de decisiones: los cambios que ejecutaste con aprobación del dueño (pausas, presupuestos, negativas, RSAs, campañas nuevas, publicaciones, perfil) con fecha, detalle, motivo y quién aprobó. Úsala ANTES de atribuir una mejora o caída a una causa (¿qué cambió en el período?), cuando el dueño pregunte "qué hiciste / qué cambiamos", y como parte de toda auditoría. Es de lectura.',
  input_schema: {
    type: 'object',
    properties: {
      dias: { type: 'number', description: 'Cuántos días hacia atrás (default 30, máx 365).' },
      area: { type: 'string', enum: ['google_ads', 'meta', 'contenido'], description: 'Filtrar por área (opcional).' },
    },
    required: [],
  },
}

// ─── Google Ads (Fase A del plan de agente Google Ads) ─────────────────────────
// REGLA DURA: toda tool de ESCRITURA exige el parámetro confirmado=true. El agente
// debe resumir la acción exacta (qué campaña/keyword/monto) y esperar un sí explícito
// del dueño en el chat ANTES de llamar la tool con confirmado=true — nunca en cadena.
const TOOL_GADS_RESUMEN: Anthropic.Tool = {
  name: 'gads_resumen',
  description: 'Trae el estado REAL de Google Ads: campañas con gasto/CTR/CPC/conversiones e Impression Share (cuánto % de las búsquedas elegibles se está ganando y por qué se pierde el resto). Úsala cuando el dueño pregunte cómo van los anuncios de Google.',
  input_schema: {
    type: 'object',
    properties: { periodo: { type: 'string', enum: ['last_7d', 'last_14d', 'last_30d', 'this_month', 'last_month'], description: 'Default last_30d.' } },
    required: [],
  },
}
const TOOL_GADS_KEYWORDS: Anthropic.Tool = {
  name: 'gads_keywords',
  description: 'Lista las keywords activas de Google Ads con Quality Score, gasto, clics y CTR. Úsala para revisar rendimiento de keywords o detectar candidatas a pausar (basura/QS bajo).',
  input_schema: {
    type: 'object',
    properties: { periodo: { type: 'string', enum: ['last_7d', 'last_14d', 'last_30d', 'this_month', 'last_month'], description: 'Default last_30d.' } },
    required: [],
  },
}
const TOOL_GADS_TERMINOS: Anthropic.Tool = {
  name: 'gads_terminos',
  description: 'Lista los términos de búsqueda REALES (lo que la gente escribió, no la keyword que activó el anuncio) con gasto e impresiones, para el workflow de negativas (ver GUIA_GADS_TERMINOS: candidato = ≥100 impresiones y ≥$10.000 sin conversión; nunca negativar sin mostrar la tabla y esperar aprobación).',
  input_schema: {
    type: 'object',
    properties: { periodo: { type: 'string', enum: ['last_7d', 'last_14d', 'last_30d', 'this_month', 'last_month'], description: 'Default last_30d.' } },
    required: [],
  },
}
const TOOL_GADS_IDEAS_KEYWORDS: Anthropic.Tool = {
  name: 'gads_ideas_keywords',
  description: 'Busca IDEAS DE KEYWORDS NUEVAS con datos reales de Google (Keyword Planner): volumen de búsqueda mensual, competencia y rango de puja sugerida, a partir de palabras semilla y/o una URL de referencia. Es de LECTURA (no crea ni cambia nada) — no requiere confirmación. Sin geoTargetConstants, usa automáticamente la cobertura geográfica real de la cuenta (RM/Chile). Semillas deben salir del NEGOCIO REAL (servicios: cremación individual/colectiva, eutanasia a domicilio, urnas/ánforas, retiro a domicilio/clínica; comunas de la RM) — nunca sugieras ni busques temas sin relación con cremación/eutanasia de mascotas. Cruzá el resultado contra gads_keywords/gads_terminos para no repetir lo que ya está activo o ya se negativó.',
  input_schema: {
    type: 'object',
    properties: {
      semillas: { type: 'array', items: { type: 'string' }, description: 'Palabras/frases semilla (ideal 3-10), en español, específicas del negocio (ej. "cremacion de mascotas", "eutanasia a domicilio santiago", "urna para gato").' },
      url: { type: 'string', description: 'Opcional: URL de referencia (ej. una landing del sitio) para que Google saque ideas relacionadas a ese contenido.' },
      limite: { type: 'number', description: 'Máximo de ideas a devolver, default 40.' },
    },
    required: [],
  },
}
const TOOL_GADS_AUDITAR: Anthropic.Tool = {
  name: 'gads_auditar',
  description: 'Corre la auditoría completa de la cuenta de Google Ads (bidding vs playbook, valores de conversión incoherentes, RSAs incompletos/sin pinning, recursos insuficientes, keywords basura, Impression Share perdido, negativas, higiene) y devuelve los hallazgos con severidad y $ estimado. Úsala cuando el dueño pida "auditar la cuenta" o un diagnóstico general.',
  input_schema: { type: 'object', properties: {}, required: [] },
}
const TOOL_GADS_PAUSAR_CAMPANA: Anthropic.Tool = {
  name: 'gads_pausar_campana',
  description: 'PAUSA una campaña de Google Ads. Acción de escritura: antes de llamarla con confirmado=true, resumile al dueño la campaña exacta y su gasto reciente, y esperá un sí explícito.',
  input_schema: {
    type: 'object',
    properties: {
      campaignId: { type: 'string', description: 'Id numérico de la campaña (de gads_resumen).' },
      motivo: { type: 'string', description: 'Por qué se hace este cambio (1 frase; queda en la bitácora de decisiones).' },
      confirmado: { type: 'boolean', description: 'true SOLO después de que el dueño confirmó explícitamente en el chat.' },
    },
    required: ['campaignId'],
  },
}
const TOOL_GADS_ACTIVAR_CAMPANA: Anthropic.Tool = {
  name: 'gads_activar_campana',
  description: 'ACTIVA (des-pausa) una campaña de Google Ads. Acción de escritura: requiere confirmado=true tras un sí explícito del dueño.',
  input_schema: {
    type: 'object',
    properties: {
      campaignId: { type: 'string', description: 'Id numérico de la campaña.' },
      motivo: { type: 'string', description: 'Por qué se hace este cambio (1 frase; queda en la bitácora de decisiones).' },
      confirmado: { type: 'boolean', description: 'true SOLO después de que el dueño confirmó explícitamente en el chat.' },
    },
    required: ['campaignId'],
  },
}
const TOOL_GADS_PRESUPUESTO: Anthropic.Tool = {
  name: 'gads_presupuesto',
  description: 'Cambia el presupuesto DIARIO (en CLP) de una campaña de Google Ads. Bloquea automáticamente si el presupuesto es compartido con otras campañas. Acción de escritura: requiere confirmado=true tras un sí explícito del dueño, mostrando el monto anterior y el nuevo.',
  input_schema: {
    type: 'object',
    properties: {
      campaignId: { type: 'string', description: 'Id numérico de la campaña.' },
      montoClp: { type: 'number', description: 'Nuevo presupuesto diario en pesos chilenos.' },
      motivo: { type: 'string', description: 'Por qué se hace este cambio (1 frase; queda en la bitácora de decisiones).' },
      confirmado: { type: 'boolean', description: 'true SOLO después de que el dueño confirmó explícitamente en el chat.' },
    },
    required: ['campaignId', 'montoClp'],
  },
}
const TOOL_GADS_KEYWORD_ESTADO: Anthropic.Tool = {
  name: 'gads_keyword_estado',
  description: 'Pausa o activa una keyword de Google Ads por su resourceName (de gads_keywords). Acción de escritura: requiere confirmado=true tras un sí explícito del dueño.',
  input_schema: {
    type: 'object',
    properties: {
      resourceName: { type: 'string', description: 'resourceName exacto de la keyword (viene de gads_keywords).' },
      estado: { type: 'string', enum: ['pausar', 'activar'] },
      motivo: { type: 'string', description: 'Por qué se hace este cambio (1 frase; queda en la bitácora de decisiones).' },
      confirmado: { type: 'boolean', description: 'true SOLO después de que el dueño confirmó explícitamente en el chat.' },
    },
    required: ['resourceName', 'estado'],
  },
}
const TOOL_GADS_NEGATIVA: Anthropic.Tool = {
  name: 'gads_negativa',
  description: 'Agrega UN término como palabra clave NEGATIVA a nivel de campaña (concordancia de frase por defecto). Para varios términos aprobados a la vez, usá gads_negativas_lote en su lugar (evita llamar esta una por una). Úsala SOLO después de aplicar el workflow de GUIA_GADS_TERMINOS (mostrar tabla de candidatos con veredicto BAD/KEEP/UNCERTAIN y esperar aprobación explícita — los UNCERTAIN necesitan un sí por término). Acción de escritura: requiere confirmado=true.',
  input_schema: {
    type: 'object',
    properties: {
      campaignId: { type: 'string', description: 'Id numérico de la campaña (de gads_terminos).' },
      texto: { type: 'string', description: 'Término a negativar.' },
      matchType: { type: 'string', enum: ['EXACT', 'PHRASE', 'BROAD'], description: 'Default PHRASE.' },
      motivo: { type: 'string', description: 'Por qué se negativa (1 frase; queda en la bitácora de decisiones).' },
      confirmado: { type: 'boolean', description: 'true SOLO después de que el dueño confirmó explícitamente en el chat.' },
    },
    required: ['campaignId', 'texto'],
  },
}
const TOOL_GADS_NEGATIVAS_LOTE: Anthropic.Tool = {
  name: 'gads_negativas_lote',
  description: 'Agrega VARIOS términos como negativas a nivel de campaña en una sola pasada (concordancia de frase por defecto). Úsala para el cierre del workflow de GUIA_GADS_TERMINOS cuando el dueño aprueba un lote de una vez (ej. "agregá todos los BAD") — evita llamar gads_negativa término por término. Acción de escritura: requiere confirmado=true, y solo después de haber mostrado la tabla completa con veredictos.',
  input_schema: {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        description: 'Términos a negativar, cada uno con la campaña a la que pertenece.',
        items: {
          type: 'object',
          properties: {
            campaignId: { type: 'string' },
            texto: { type: 'string' },
            matchType: { type: 'string', enum: ['EXACT', 'PHRASE', 'BROAD'] },
          },
          required: ['campaignId', 'texto'],
        },
      },
      motivo: { type: 'string', description: 'Por qué se negativa este lote (1 frase; queda en la bitácora de decisiones).' },
      confirmado: { type: 'boolean', description: 'true SOLO después de que el dueño aprobó explícitamente el lote completo en el chat.' },
    },
    required: ['items'],
  },
}
const TOOL_GADS_LISTAS_NEGATIVAS: Anthropic.Tool = {
  name: 'gads_listas_negativas',
  description: 'Lista las listas de negativas COMPARTIDAS que existen hoy en la cuenta (nombre, cantidad de términos, a qué campañas están adjuntas). Úsala antes de proponer crear una nueva, para no duplicar.',
  input_schema: { type: 'object', properties: {}, required: [] },
}
const TOOL_GADS_CREAR_LISTA_NEGATIVAS: Anthropic.Tool = {
  name: 'gads_crear_lista_negativas_universal',
  description: 'Crea la lista de negativas UNIVERSAL ES-CL del rubro (empleo, educación, DIY/informacional, gratis, segunda mano — ver GUIA_GADS_NEGATIVAS) como lista COMPARTIDA y la adjunta a TODAS las campañas de la cuenta de una vez. Salta automáticamente los términos que ya existen como negativa (a nivel campaña o en otra lista). ⚠️ Acción de ALTO IMPACTO: afecta TODAS las campañas a la vez, no una sola — resumíselo así al dueño explícitamente antes de pedir confirmación ("esto va a aplicar a las N campañas de la cuenta"). Acción de escritura: requiere confirmado=true.',
  input_schema: {
    type: 'object',
    properties: {
      nombre: { type: 'string', description: 'Nombre de la lista (sugerido: "Negativas universales ES-CL"). Opcional, tiene default.' },
      motivo: { type: 'string', description: 'Por qué se crea (1 frase; queda en la bitácora de decisiones).' },
      confirmado: { type: 'boolean', description: 'true SOLO después de que el dueño confirmó explícitamente en el chat, entendiendo que aplica a TODAS las campañas.' },
    },
    required: [],
  },
}
const TOOL_GADS_ELIMINAR_LISTA_NEGATIVAS: Anthropic.Tool = {
  name: 'gads_eliminar_lista_negativas',
  description: 'Elimina una lista de negativas compartida completa (se desadjunta de todas las campañas que la usaban). Acción de escritura irreversible desde el chat: requiere confirmado=true tras un sí explícito, mostrando antes cuántos términos y campañas afecta (usá gads_listas_negativas primero).',
  input_schema: {
    type: 'object',
    properties: {
      resourceName: { type: 'string', description: 'resourceName exacto de la lista (de gads_listas_negativas).' },
      motivo: { type: 'string', description: 'Por qué se elimina (1 frase; queda en la bitácora de decisiones).' },
      confirmado: { type: 'boolean', description: 'true SOLO después de que el dueño confirmó explícitamente en el chat.' },
    },
    required: ['resourceName'],
  },
}

const TOOL_GADS_ANUNCIOS: Anthropic.Tool = {
  name: 'gads_anuncios',
  description: 'Lista los RSAs (anuncios) activos por grupo de anuncios: cantidad de titulares/pinneados/descripciones, Ad Strength, URL final e id del grupo. Usala antes de gads_crear_rsa para saber en qué grupo falta completar y con qué URL final debe coincidir.',
  input_schema: { type: 'object', properties: {}, required: [] },
}
const TOOL_GADS_CREAR_RSA: Anthropic.Tool = {
  name: 'gads_crear_rsa',
  description: 'Crea un RSA NUEVO (siempre en pausa) en un grupo de anuncios existente — NO reemplaza el anuncio actual, se suma para que el dueño lo revise en Google Ads y decida activarlo (y pausar el viejo si corresponde). Antes de llamarla, redactá el copy siguiendo GUIA_GADS_RSA al pie de la letra: EXACTAMENTE 15 titulares (≤30 chars, 3 con pinnedSlot1=true = variantes de la keyword, cubriendo los 6 ángulos) y EXACTAMENTE 4 descripciones (≤90 chars). El servidor corre un linter determinista antes de crear — si rechaza, corregí el texto según los errores devueltos y volvé a llamar la tool SIN pedir de nuevo confirmación (no es una decisión nueva, es corregir formato). Acción de escritura: requiere confirmado=true tras mostrarle el copy completo al dueño y recibir el sí.',
  input_schema: {
    type: 'object',
    properties: {
      grupoAnuncioId: { type: 'string', description: 'Id del grupo de anuncios (de gads_anuncios).' },
      headlines: {
        type: 'array',
        description: 'EXACTAMENTE 15 titulares.',
        items: { type: 'object', properties: { texto: { type: 'string' }, pinnedSlot1: { type: 'boolean', description: 'true SOLO para las 3 variantes de keyword en slot 1.' } }, required: ['texto'] },
      },
      descriptions: { type: 'array', description: 'EXACTAMENTE 4 descripciones.', items: { type: 'string' } },
      finalUrl: { type: 'string', description: 'URL final — debe coincidir con la del resto de anuncios del mismo grupo (modelo SKAG, ver gads_anuncios).' },
      path1: { type: 'string', description: 'Display URL path1, opcional, ≤15 chars.' },
      path2: { type: 'string', description: 'Display URL path2, opcional, ≤15 chars.' },
      motivo: { type: 'string', description: 'Por qué se crea este RSA (1 frase; queda en la bitácora de decisiones).' },
      confirmado: { type: 'boolean', description: 'true SOLO después de que el dueño confirmó explícitamente el copy completo en el chat.' },
    },
    required: ['grupoAnuncioId', 'headlines', 'descriptions', 'finalUrl'],
  },
}
const TOOL_GADS_AGREGAR_CALLOUTS: Anthropic.Tool = {
  name: 'gads_agregar_callouts',
  description: 'Agrega callouts NUEVOS a nivel campaña (se suman al pool existente, no lo reemplazan — ver GUIA_GADS_ASSETS: 8-12 recomendado, diferenciados, sin repetir lo que ya dicen los titulares). Acción de escritura: requiere confirmado=true tras mostrarle la lista propuesta al dueño.',
  input_schema: {
    type: 'object',
    properties: {
      campaignId: { type: 'string', description: 'Id numérico de la campaña.' },
      textos: { type: 'array', items: { type: 'string' }, description: 'Callouts propuestos, cada uno ≤25 caracteres.' },
      motivo: { type: 'string', description: 'Por qué se agregan (1 frase; queda en la bitácora de decisiones).' },
      confirmado: { type: 'boolean', description: 'true SOLO después de que el dueño confirmó explícitamente en el chat.' },
    },
    required: ['campaignId', 'textos'],
  },
}
const TOOL_GADS_CREAR_CAMPANA: Anthropic.Tool = {
  name: 'gads_crear_campana',
  description: 'WIZARD de campaña NUEVA de cero: crea de una sola vez (atómico) presupuesto + campaña de Búsqueda (Maximize Conversions, solo Google Search sin socios/display, Presencia) + cobertura geográfica copiada de una campaña existente (por defecto la de mayor gasto = misma cobertura RM ya probada) + idioma español + las negativas universales ES-CL + 1 grupo de anuncios + la keyword (phrase) + 1 RSA. TODO queda EN PAUSA para que el dueño revise en Google Ads y active él — nada gasta hasta que lo active. FLUJO OBLIGATORIO (modelo SKAG, ver GUIA_GADS_ESTRUCTURA/RSA): 1) juntá los datos con el dueño (servicio/keyword, presupuesto diario en CLP, URL final; opcional: de qué campaña copiar el geo); 2) redactá el RSA completo (15 titulares con 3 pinneados slot 1, 4 descripciones) siguiendo GUIA_GADS_RSA; 3) mostrale al dueño TODO el resumen (nombre, presupuesto, keyword, URL, los 15 titulares y 4 descripciones) y pedí el sí; 4) recién ahí llamá con confirmado=true. El servidor corre el linter de RSA antes de crear; si rechaza, corregí y reintentá sin volver a pedir confirmación. Acción de escritura de ALTO IMPACTO: requiere confirmado=true.',
  input_schema: {
    type: 'object',
    properties: {
      nombreCampana: { type: 'string', description: 'Nombre de la campaña (ej. "Búsqueda - Cremación Premium").' },
      presupuestoClpDiario: { type: 'number', description: 'Presupuesto diario en pesos chilenos (idealmente 3-5× el CPA objetivo).' },
      keyword: { type: 'string', description: 'La keyword principal (modelo SKAG: una keyword por grupo).' },
      matchType: { type: 'string', enum: ['EXACT', 'PHRASE', 'BROAD'], description: 'Default PHRASE.' },
      finalUrl: { type: 'string', description: 'URL final de la landing (idealmente una página que matchee la keyword).' },
      headlines: {
        type: 'array', description: 'EXACTAMENTE 15 titulares (3 con pinnedSlot1=true).',
        items: { type: 'object', properties: { texto: { type: 'string' }, pinnedSlot1: { type: 'boolean' } }, required: ['texto'] },
      },
      descriptions: { type: 'array', description: 'EXACTAMENTE 4 descripciones.', items: { type: 'string' } },
      path1: { type: 'string', description: 'Display URL path1, opcional, ≤15 chars.' },
      path2: { type: 'string', description: 'Display URL path2, opcional, ≤15 chars.' },
      geoTemplateCampaignId: { type: 'string', description: 'Id de la campaña de la que copiar la cobertura geográfica (opcional; por defecto la de mayor gasto).' },
      motivo: { type: 'string', description: 'Por qué se crea esta campaña (1 frase; queda en la bitácora de decisiones).' },
      confirmado: { type: 'boolean', description: 'true SOLO después de mostrarle al dueño el resumen COMPLETO (incluyendo los 15 titulares y 4 descripciones) y recibir el sí explícito.' },
    },
    required: ['nombreCampana', 'presupuestoClpDiario', 'keyword', 'finalUrl', 'headlines', 'descriptions'],
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
      quitar_logo: { type: 'boolean', description: 'true SOLO si el dueño pide QUITAR el logo de esta imagen. Sin esto, el sistema re-estampa el logo automáticamente en cada edición (regla de marca) y el pedido de quitarlo NO surte efecto — con true, esa imagen queda deliberadamente sin logo.' },
    },
    required: ['id', 'instruccion'],
  },
}

const TOOL_NUEVA_IMAGEN: Anthropic.Tool = {
  name: 'nueva_imagen_pieza',
  description: 'CONSERVA el copy de una pieza del calendario y regenera SOLO la imagen DESDE CERO — nueva y CLARAMENTE DISTINTA a la actual, con plantilla on-brand. Úsala cuando al dueño le gustó el TEXTO pero quiere OTRA imagen ("dejá el copy y hacé otra imagen", "misma copy pero una imagen completamente distinta"). Diferencias: editar_imagen_pieza solo RETOCA la imagen actual (se ancla en ella, no sirve para algo totalmente nuevo); generar_pieza rehace TODO incluido el copy. Esta conserva el copy y solo cambia la imagen.',
  input_schema: {
    type: 'object',
    properties: { id: { type: 'string', description: 'Id de la pieza del calendario.' } },
    required: ['id'],
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

  const [tarifas, cfg, banco, empresa, contacto, params] = await Promise.all([
    bloqueTarifas(),
    getMarketingConfig().catch(() => null),
    listarImagenes().catch(() => [] as ImagenBanco[]),
    bloqueEmpresa(),
    getContacto().catch(() => null),
    getMarketingParams(),
  ])

  const system: Anthropic.TextBlockParam[] = [
    { type: 'text', text: `${REGLAS_INVIOLABLES}\n\n${BASE}\n\n${DIFERENCIADORES}\n\n${MARCA_VISUAL}\n\n${PLANTILLAS_INFO}\n\n${MARCA_GRAFICO}\n\n${GUIA_SOCIAL}\n\n${GUIA_EMAIL}\n\n${GUIA_PERFIL}\n\n${tarifas}`, cache_control: { type: 'ephemeral' } },
  ]
  if (isGoogleAdsConfigurado()) {
    system.push({
      type: 'text',
      text: `GOOGLE ADS — tenés herramientas gads_* para leer y gestionar la cuenta real de Google Ads (además de Meta). REGLA DURA e inviolable: TODA tool de escritura (gads_pausar_campana, gads_activar_campana, gads_presupuesto, gads_keyword_estado, gads_negativa, gads_negativas_lote, gads_crear_lista_negativas_universal, gads_eliminar_lista_negativas, gads_crear_rsa, gads_agregar_callouts) exige confirmado=true, y SOLO podés pasarlo después de resumirle al dueño la acción EXACTA (qué campaña/keyword, monto anterior→nuevo, gasto reciente) y recibir un sí explícito en el chat. Nunca encadenes varias escrituras sin confirmar cada una (o el lote explícito que el dueño aprobó). En TODA escritura pasá también "motivo" (1 frase: por qué se hace) — queda en la BITÁCORA de decisiones junto con el detalle y quién aprobó; esa bitácora (consultar_bitacora) es tu memoria durable de cambios: revisala antes de comparar períodos o atribuir una mejora/caída a una causa. Para negativas de términos de búsqueda, seguí SIEMPRE el workflow de GUIA_GADS_TERMINOS (mostrar la tabla con veredicto BAD/KEEP/UNCERTAIN y esperar aprobación — para un lote aprobado de una vez usá gads_negativas_lote, no llames gads_negativa repetidas veces). gads_crear_lista_negativas_universal es de ALTO IMPACTO (afecta TODAS las campañas a la vez, no una sola) — avisale eso al dueño explícitamente antes de pedir el sí; revisá primero con gads_listas_negativas que no exista ya una lista similar. gads_crear_rsa SIEMPRE crea un anuncio PAUSADO nuevo, nunca reemplaza el que ya está corriendo — aclaráselo al dueño (revisa y activa él desde Google Ads o pidiéndotelo). gads_crear_campana (wizard de campaña nueva) crea TODO en PAUSA de una vez (presupuesto+campaña+geo+idioma+negativas+grupo+keyword+RSA) y es de ALTO IMPACTO: antes de pedir el sí, mostrale al dueño el resumen COMPLETO (nombre, presupuesto diario, keyword, URL final y los 15 titulares + 4 descripciones) y aclarale que queda en pausa hasta que él la active en Google Ads. Usá gads_auditar cuando te pidan un diagnóstico general. Cuando pidan buscar/investigar keywords NUEVAS (no las que ya están corriendo), usá gads_ideas_keywords con semillas del negocio real (servicios + comunas RM) — es de lectura, no requiere confirmación; mostrale al dueño una tabla con volumen de búsqueda, competencia y puja sugerida, y solo si te pide armar campaña con alguna encadená gads_crear_campana (con confirmación).\n\n${GUIA_GADS_ESTRUCTURA}\n\n${GUIA_GADS_BIDDING}\n\n${GUIA_GADS_RSA}\n\n${GUIA_GADS_ASSETS}\n\n${GUIA_GADS_NEGATIVAS}\n\n${GUIA_GADS_TERMINOS}\n\n${GUIA_GADS_QS}`,
      cache_control: { type: 'ephemeral' },
    })
  }
  const ajustes = [
    cfg?.instrucciones?.trim() && `INSTRUCCIONES Y DATOS VIGENTES DEL EQUIPO (trátalos como la verdad actual; REEMPLAZAN el guion base si chocan, salvo: precios siempre de TARIFAS VIGENTES):\n${cfg.instrucciones.trim()}`,
    cfg?.calibracion?.trim() && `GUÍA DE ESTILO / LÍNEA EDITORIAL:\n${cfg.calibracion.trim()}`,
  ].filter(Boolean).join('\n\n')
  if (ajustes) system.push({ type: 'text', text: ajustes })
  // Parámetros vigentes (cadencia + pilares + presupuesto): sin caché, reflejan
  // ediciones al instante y REEMPLAZAN la cadencia genérica del guion base.
  system.push({ type: 'text', text: bloqueParametros(params) })
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

  const tools = [TOOL_LISTAR, TOOL_PROPONER, TOOL_EDITAR_CAMPANA, TOOL_ELIMINAR_CAMPANA, TOOL_PRECIOS, TOOL_BANCO, TOOL_GENERAR, TOOL_AJUSTAR_EMAIL, TOOL_AUDITAR, TOOL_GENERAR_IMG, TOOL_DISENAR_PLANTILLA, TOOL_DISENAR_GRAFICO, TOOL_PUBLICAR, TOOL_PERFIL_FB, TOOL_METRICAS, TOOL_RENTABILIDAD, TOOL_BITACORA, TOOL_EDITAR_IMG, TOOL_NUEVA_IMAGEN, TOOL_REUTILIZAR, TOOL_USAR_IMGS]
  if (isGoogleAdsConfigurado()) {
    tools.push(
      TOOL_GADS_RESUMEN, TOOL_GADS_KEYWORDS, TOOL_GADS_TERMINOS, TOOL_GADS_IDEAS_KEYWORDS, TOOL_GADS_AUDITAR,
      TOOL_GADS_PAUSAR_CAMPANA, TOOL_GADS_ACTIVAR_CAMPANA, TOOL_GADS_PRESUPUESTO,
      TOOL_GADS_KEYWORD_ESTADO, TOOL_GADS_NEGATIVA, TOOL_GADS_NEGATIVAS_LOTE,
      TOOL_GADS_LISTAS_NEGATIVAS, TOOL_GADS_CREAR_LISTA_NEGATIVAS, TOOL_GADS_ELIMINAR_LISTA_NEGATIVAS,
      TOOL_GADS_ANUNCIOS, TOOL_GADS_CREAR_RSA, TOOL_GADS_AGREGAR_CALLOUTS, TOOL_GADS_CREAR_CAMPANA,
    )
  }
  const convo: Anthropic.MessageParam[] = [...base]
  const acciones: string[] = []
  let cambios = false
  let textoFinal = ''
  // Carruseles de disenar_grafico en este turno: identificador → campaña compartida.
  const campaniasCarrusel = new Map<string, string>()
  // Bitácora: registra cada ESCRITURA ejecutada (best-effort, nunca corta la acción).
  const anotar = (area: string, accion: string, detalle: string, motivo?: string) =>
    registrarDecision({ area, accion, detalle, motivo, aprobadoPor: opts.creadoPor })

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
        } else if (tu.name === 'ajustar_email') {
          const inp = tu.input as { id?: string; comentario?: string }
          const id = String(inp.id || '')
          const comentario = String(inp.comentario || '')
          if (!id || !comentario.trim()) {
            resultText = 'Faltan datos: el id del correo y qué ajustar.'
          } else {
            try {
              const r = await ajustarPiezaEmail(id, comentario, opts.creadoPor)
              cambios = true
              resultText = `Correo ajustado (asunto: "${r.item.titulo}"). Se conservó lo que estaba y se aplicó el cambio pedido. Sigue como borrador en Mailing. Resumí en una frase qué cambiaste; no pegues el HTML.${r.avisos.length ? '\n\nAvisos: ' + r.avisos.join('; ') : ''}`
            } catch (e) {
              resultText = `No se pudo ajustar el correo: ${e instanceof Error ? e.message : String(e)}.`
            }
          }
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
        } else if (tu.name === 'disenar_plantilla') {
          const inp = tu.input as { plantilla?: string; formato?: string; slots?: SlotsPlantilla; carrusel?: string }
          const s = inp.slots || {}
          const textos = [s.eyebrow, s.titulo, s.titulo_destacado, s.bajada, s.dato, s.dato_label, s.cta, s.cta_secundario, ...(s.bullets || [])].filter(Boolean).join(' · ')
          const lintP = textos.trim() ? lintCopy({ placas: [textos], telefono: contacto?.telefono, web: contacto?.web }) : []
          if (!inp.plantilla) {
            resultText = 'Falta indicar qué plantilla usar.'
          } else if (lintP.length) {
            resultText = 'RECHAZADO por reglas de marca (corregí los textos de los slots y volvé a llamar disenar_plantilla):\n- ' + lintP.map(h => `[${h.campo}] ${h.problema}`).join('\n- ')
          } else {
            const logos = banco.filter(esLogo)
            const dd = (l: ImagenBanco) => `${l.descripcion || ''} ${l.alt || ''}`.toLowerCase()
            const logoBlanco = logos.find(l => /blanc/.test(dd(l)))?.url || logos[0]?.url
            const logoNavy = logos.find(l => /azul|navy|oscuro/.test(dd(l)))?.url || logoBlanco
            let campania: string | undefined
            const carrKey = (inp.carrusel || '').trim()
            if (carrKey) {
              campania = campaniasCarrusel.get(carrKey)
              if (!campania) { campania = await asignarCampania(); campaniasCarrusel.set(carrKey, campania) }
            }
            const formato = String(inp.formato || 'post_vertical')
            const { html, fotos } = construirPlantilla(inp.plantilla, s, { formato, logoBlanco, logoNavy })
            const r = await generarGraficoMarca({ formato, html, fotos, creadoPor: opts.creadoPor, campania })
            cambios = true
            resultText = `Placa on-brand generada con la plantilla "${inp.plantilla}" (marca, encuadre y logo exactos) — código ${r.codigo || '(sin código)'}. Muéstrasela al dueño con ![](${r.url}) y decile su código (${r.codigo || ''}).${r.avisos.length ? ' Avisos: ' + r.avisos.join('; ') : ''}`
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
          if (!r.yaPublicado) await anotar('contenido', 'publicar_pieza', `Pieza #${id} publicada en ${r.item?.canal || 'la red'}${r.post?.url ? ` (${r.post.url})` : ''}`)
        } else if (tu.name === 'actualizar_perfil_facebook') {
          if (!isFacebookConfigurado()) {
            resultText = 'No puedo aplicar cambios al perfil: Facebook no figura conectado en este entorno (faltan las variables META_GRAPH_TOKEN / META_PAGE_ID en el servidor/Vercel). NO existe ninguna pantalla de "Integraciones/Facebook" en la app: la conexión se carga en las variables de entorno de Vercel y requiere redeploy. Decile esto al dueño TAL CUAL (sin inventar otro flujo). Igual podés entregarle los textos listos para que los pegue a mano en la Página.'
          } else {
            const campos = tu.input as Record<string, string>
            await actualizarPerfilFacebook(campos)
            const aplicados = Object.keys(campos).filter(k => ['about', 'description', 'phone', 'website', 'emails'].includes(k))
            resultText = `Perfil de Facebook actualizado (${aplicados.join(', ') || 'sin cambios'}). Confirmale al dueño qué se cambió.`
            if (aplicados.length) await anotar('meta', 'actualizar_perfil_facebook', `Campos actualizados: ${aplicados.join(', ')}`)
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
          const inp = tu.input as { id?: string; instruccion?: string; indice?: number; quitar_logo?: boolean }
          const r = await editarImagenPieza(String(inp.id || ''), String(inp.instruccion || ''), inp.indice, opts.creadoPor, { quitarLogo: inp.quitar_logo === true })
          cambios = true
          resultText = r.aplicado === false
            ? `NO se pudo aplicar el cambio pedido en la pieza #${r.item.id}: la imagen quedó IGUAL a como estaba.${r.avisos.length ? ' Motivo: ' + r.avisos.join('; ') : ''} Decíselo así de claro al dueño (no digas "listo"/"ajustada"), y sugerile reformular el pedido o dividirlo en pasos si tenía más de un cambio.`
            : `Imagen(es) ajustada(s) en la pieza #${r.item.id}.${r.avisos.length ? ' Avisos: ' + r.avisos.join('; ') : ''}${r.item.imagen_url ? ` Mostrale el resultado al dueño con ![](${r.item.imagen_url}).` : ''}`
        } else if (tu.name === 'nueva_imagen_pieza') {
          const inp = tu.input as { id?: string }
          const r = await regenerarImagenPieza(String(inp.id || ''), opts.creadoPor)
          cambios = true
          resultText = `Listo: conservé el copy de la pieza #${r.item.id} y generé una imagen NUEVA y distinta.${r.avisos.length ? ' Avisos: ' + r.avisos.join('; ') : ''}${r.item.imagen_url ? ` Mostrásela al dueño con ![](${r.item.imagen_url}).` : ''}`
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
            resultText = `La pieza #${r.item.id} (${r.item.canal}) quedó con ${r.n} imagen(es) de ${codigos.join(', ')}${aviso}, en orden y SIN regenerar.${r.item.imagen_url ? ` Mostrá la primera con ![](${r.item.imagen_url}).` : ''} Si el dueño lo pide, publicala o programala.`
          }
        } else if (tu.name === 'reporte_rentabilidad') {
          const inp = tu.input as { periodo?: PeriodoRentabilidad }
          resultText = await reporteRentabilidadTexto(inp.periodo || 'last_30d')
        } else if (tu.name === 'consultar_bitacora') {
          const inp = tu.input as { dias?: number; area?: string }
          const dias = Math.min(365, Math.max(1, inp.dias || 30))
          const decs = await listarDecisiones({ dias, area: inp.area, limite: 60 })
          resultText = `BITÁCORA DE DECISIONES (últimos ${dias} días${inp.area ? `, área ${inp.area}` : ''}):\n${formatearDecisiones(decs)}`
        } else if (tu.name === 'gads_resumen') {
          if (!isGoogleAdsConfigurado()) { resultText = 'Google Ads no está configurado en este entorno.' }
          else {
            const inp = tu.input as { periodo?: string }
            const periodo = inp.periodo || 'last_30d'
            const [r, gestion] = await Promise.all([resumenCampanasGoogle(periodo), listarCampanasGestion()])
            const porId = new Map(gestion.campanas.map(c => [c.id, c]))
            const lineas = r.campanas.map(c => {
              const g = porId.get(c.id)
              return `- ${c.nombre} [${c.status}] (id=${c.id}): gasto ${fmtPrecio(c.gasto)}${g ? ` · presupuesto diario ${fmtPrecio(g.presupuestoClp)}${g.compartido ? ' (COMPARTIDO)' : ''}` : ''} · impresiones ${c.impresiones} · clics ${c.clicks} · CTR ${c.ctr.toFixed(2)}% · CPC ${fmtPrecio(c.cpc)} · conversiones ${c.conversiones}`
            }).join('\n')
            resultText = `GOOGLE ADS (${periodo}, ${r.moneda}) — CUENTA: gasto ${fmtPrecio(r.cuenta.gasto)} · clics ${r.cuenta.clicks} · CTR ${r.cuenta.ctr.toFixed(2)}% · CPC ${fmtPrecio(r.cuenta.cpc)} · conversiones ${r.cuenta.conversiones}\nPOR CAMPAÑA:\n${lineas || '(sin campañas con datos)'}`
          }
        } else if (tu.name === 'gads_keywords') {
          if (!isGoogleAdsConfigurado()) { resultText = 'Google Ads no está configurado en este entorno.' }
          else {
            const inp = tu.input as { periodo?: string }
            const { keywords, moneda } = await listarKeywordsConQS(inp.periodo || 'last_30d')
            const lineas = keywords.slice(0, 40).map(k => `- "${k.texto}" [${k.matchType}] (${k.campana}, id campaña=${k.campanaId})${k.enVivo ? '' : ' ⚠️ NO está gastando de verdad: su campaña o grupo de anuncios está pausado, aunque la keyword en sí figure "enabled"'}: QS=${k.qualityScore ?? 's/d'} · gasto ${fmtPrecio(k.gasto)} · clics ${k.clicks} · CTR ${k.ctr.toFixed(2)}% · resourceName=${k.resourceName}`).join('\n')
            resultText = `KEYWORDS con status propio ENABLED (${moneda}, ordenadas por gasto) — OJO: el status propio de la keyword NO refleja si su campaña/grupo están pausados; fijate en el aviso ⚠️ de cada línea antes de decir que algo "está activo":\n${lineas || '(sin keywords con datos)'}`
          }
        } else if (tu.name === 'gads_terminos') {
          if (!isGoogleAdsConfigurado()) { resultText = 'Google Ads no está configurado en este entorno.' }
          else {
            const inp = tu.input as { periodo?: string }
            const { terminos, moneda } = await terminosBusqueda(inp.periodo || 'last_30d')
            const lineas = terminos.map(t => `- "${t.termino}" (${t.campana}, id campaña=${t.campanaId}): impresiones ${t.impresiones} · gasto ${fmtPrecio(t.gasto)} · conversiones ${t.conversiones}`).join('\n')
            resultText = `TÉRMINOS DE BÚSQUEDA REALES (${moneda}, ordenados por gasto):\n${lineas || '(sin términos con datos)'}\n\nAplicá el workflow de GUIA_GADS_TERMINOS: candidato = ≥100 impresiones y ≥$10.000 sin conversión; mostrale al dueño la tabla con veredicto BAD/KEEP/UNCERTAIN y esperá aprobación antes de llamar gads_negativa.`
          }
        } else if (tu.name === 'gads_ideas_keywords') {
          if (!isGoogleAdsConfigurado()) { resultText = 'Google Ads no está configurado en este entorno.' }
          else {
            const inp = tu.input as { semillas?: string[]; url?: string; limite?: number }
            const { ideas } = await generarIdeasKeywords({ semillas: inp.semillas, url: inp.url, limite: inp.limite })
            if (ideas.length === 0) resultText = 'Google no devolvió ideas para esas semillas. Probá con términos más genéricos o una URL de referencia.'
            else {
              const lineas = ideas.map(k => `- "${k.texto}": ${k.busquedasMensuales} búsquedas/mes · competencia ${k.competencia} (${k.competenciaIndex}) · puja sugerida ${fmtPrecio(k.pujaBajaClp)}–${fmtPrecio(k.pujaAltaClp)}`).join('\n')
              resultText = `IDEAS DE KEYWORDS (Keyword Planner, ordenadas por volumen de búsqueda mensual):\n${lineas}\n\nSon ideas NUEVAS con datos reales de Google — para agregarlas a una campaña existente hace falta que el dueño lo pida explícitamente (no hay tool de escritura para esto todavía); para armar una campaña de cero desde acá, se puede usar gads_crear_campana.`
            }
          }
        } else if (tu.name === 'gads_auditar') {
          if (!isGoogleAdsConfigurado()) { resultText = 'Google Ads no está configurado en este entorno.' }
          else {
            const [hallazgos, decisiones] = await Promise.all([
              auditarCuenta(),
              listarDecisiones({ dias: 30, area: 'google_ads', limite: 30 }).catch(() => []),
            ])
            if (hallazgos.length === 0) resultText = 'Auditoría sin hallazgos relevantes por ahora.'
            else resultText = hallazgos.map(h => `[${h.severidad.toUpperCase()}] (${h.area}) ${h.titulo}${h.dolaresEstimados ? ` — ~${fmtPrecio(h.dolaresEstimados)}` : ''}\n  ${h.detalle}\n  → ${h.accionSugerida}`).join('\n\n')
            resultText += `\n\nCAMBIOS RECIENTES EN LA CUENTA (bitácora, últimos 30 días — consideralos antes de atribuir mejoras/caídas a una causa):\n${formatearDecisiones(decisiones)}`
          }
        } else if (tu.name === 'gads_pausar_campana' || tu.name === 'gads_activar_campana') {
          if (!isGoogleAdsConfigurado()) { resultText = 'Google Ads no está configurado en este entorno.' }
          else {
            const inp = tu.input as { campaignId?: string; motivo?: string; confirmado?: boolean }
            if (!inp.confirmado) resultText = 'Falta confirmación explícita del dueño en el chat antes de ejecutar esta acción (pasá confirmado=true recién después de que diga que sí).'
            else if (!inp.campaignId) resultText = 'Falta el id de la campaña.'
            else {
              const pausar = tu.name === 'gads_pausar_campana'
              if (pausar) await pausarCampanaGoogle(inp.campaignId)
              else await activarCampanaGoogle(inp.campaignId)
              resultText = `Listo: campaña id=${inp.campaignId} ${pausar ? 'pausada' : 'activada'} en Google Ads.`
              await anotar('google_ads', pausar ? 'pausar_campana' : 'activar_campana', `Campaña id=${inp.campaignId} ${pausar ? 'pausada' : 'activada'}`, inp.motivo)
            }
          }
        } else if (tu.name === 'gads_presupuesto') {
          if (!isGoogleAdsConfigurado()) { resultText = 'Google Ads no está configurado en este entorno.' }
          else {
            const inp = tu.input as { campaignId?: string; montoClp?: number; motivo?: string; confirmado?: boolean }
            if (!inp.confirmado) resultText = 'Falta confirmación explícita del dueño en el chat antes de ejecutar esta acción (pasá confirmado=true recién después de que diga que sí).'
            else if (!inp.campaignId || !inp.montoClp) resultText = 'Faltan datos (campaignId y montoClp).'
            else {
              await ajustarPresupuestoGoogle(inp.campaignId, inp.montoClp)
              resultText = `Listo: presupuesto diario de la campaña id=${inp.campaignId} ajustado a ${fmtPrecio(inp.montoClp)}.`
              await anotar('google_ads', 'presupuesto', `Presupuesto diario campaña id=${inp.campaignId} → ${fmtPrecio(inp.montoClp)}`, inp.motivo)
            }
          }
        } else if (tu.name === 'gads_keyword_estado') {
          if (!isGoogleAdsConfigurado()) { resultText = 'Google Ads no está configurado en este entorno.' }
          else {
            const inp = tu.input as { resourceName?: string; estado?: string; motivo?: string; confirmado?: boolean }
            if (!inp.confirmado) resultText = 'Falta confirmación explícita del dueño en el chat antes de ejecutar esta acción (pasá confirmado=true recién después de que diga que sí).'
            else if (!inp.resourceName || !inp.estado) resultText = 'Faltan datos (resourceName y estado).'
            else {
              if (inp.estado === 'pausar') await pausarKeywordGoogle(inp.resourceName)
              else await activarKeywordGoogle(inp.resourceName)
              resultText = `Listo: keyword ${inp.estado === 'pausar' ? 'pausada' : 'activada'}.`
              await anotar('google_ads', 'keyword_estado', `Keyword ${inp.estado === 'pausar' ? 'pausada' : 'activada'} (${inp.resourceName})`, inp.motivo)
            }
          }
        } else if (tu.name === 'gads_negativa') {
          if (!isGoogleAdsConfigurado()) { resultText = 'Google Ads no está configurado en este entorno.' }
          else {
            const inp = tu.input as { campaignId?: string; texto?: string; matchType?: 'EXACT' | 'PHRASE' | 'BROAD'; motivo?: string; confirmado?: boolean }
            if (!inp.confirmado) resultText = 'Falta confirmación explícita del dueño en el chat antes de ejecutar esta acción (pasá confirmado=true recién después de que diga que sí, tras mostrar la tabla de candidatos con veredicto).'
            else if (!inp.campaignId || !inp.texto) resultText = 'Faltan datos (campaignId y texto).'
            else {
              await agregarNegativaCampana(inp.campaignId, inp.texto, inp.matchType || 'PHRASE')
              resultText = `Listo: "${inp.texto}" agregada como negativa (${inp.matchType || 'PHRASE'}) en la campaña id=${inp.campaignId}.`
              await anotar('google_ads', 'negativa', `"${inp.texto}" (${inp.matchType || 'PHRASE'}) → campaña id=${inp.campaignId}`, inp.motivo)
            }
          }
        } else if (tu.name === 'gads_negativas_lote') {
          if (!isGoogleAdsConfigurado()) { resultText = 'Google Ads no está configurado en este entorno.' }
          else {
            const inp = tu.input as { items?: { campaignId?: string; texto?: string; matchType?: 'EXACT' | 'PHRASE' | 'BROAD' }[]; motivo?: string; confirmado?: boolean }
            const items = (inp.items || []).filter(i => i?.campaignId && i?.texto)
            if (!inp.confirmado) resultText = 'Falta confirmación explícita del dueño en el chat antes de ejecutar esta acción (pasá confirmado=true recién después de que apruebe el lote completo, tras mostrar la tabla con veredicto).'
            else if (items.length === 0) resultText = 'No recibí términos válidos (cada uno necesita campaignId y texto).'
            else {
              let ok = 0
              const errores: string[] = []
              for (const it of items) {
                try { await agregarNegativaCampana(String(it.campaignId), String(it.texto), it.matchType || 'PHRASE'); ok++ }
                catch (e) { errores.push(`"${it.texto}": ${e instanceof Error ? e.message : 'error'}`) }
              }
              resultText = `Listo: ${ok}/${items.length} negativas agregadas.${errores.length ? ` Fallaron: ${errores.join('; ')}.` : ''}`
              if (ok > 0) await anotar('google_ads', 'negativas_lote', `${ok}/${items.length} negativas: ${items.map(i => `"${i.texto}"`).join(', ').slice(0, 600)}`, inp.motivo)
            }
          }
        } else if (tu.name === 'gads_listas_negativas') {
          if (!isGoogleAdsConfigurado()) { resultText = 'Google Ads no está configurado en este entorno.' }
          else {
            const listas = await listarListasCompartidas()
            resultText = listas.length === 0
              ? 'No hay listas de negativas compartidas todavía (todas las negativas están a nivel campaña).'
              : listas.map(l => `- "${l.nombre}" (${l.resourceName}): ${l.cantidadTerminos} términos, adjunta a: ${l.campanas.join(', ') || '(ninguna campaña)'}`).join('\n')
          }
        } else if (tu.name === 'gads_crear_lista_negativas_universal') {
          if (!isGoogleAdsConfigurado()) { resultText = 'Google Ads no está configurado en este entorno.' }
          else {
            const inp = tu.input as { nombre?: string; motivo?: string; confirmado?: boolean }
            if (!inp.confirmado) resultText = 'Falta confirmación explícita del dueño en el chat antes de ejecutar esta acción — recordale que esto aplica a TODAS las campañas de la cuenta, no a una sola.'
            else {
              const nombre = inp.nombre?.trim() || 'Negativas universales ES-CL'
              const r = await crearListaNegativasCompartida(nombre, NEGATIVAS_UNIVERSALES_ES_CL)
              if (r.agregados === 0) resultText = `No se creó la lista: los ${r.duplicados} términos ya existían como negativa (a nivel campaña o en otra lista).`
              else {
                const attach = await adjuntarListaATodasLasCampanas(r.resourceName)
                resultText = `Lista "${nombre}" creada con ${r.agregados} términos (${r.duplicados} ya existían y se saltaron) y adjuntada a ${attach.adjuntadas} campaña(s)${attach.yaTenian ? ` (${attach.yaTenian} ya la tenían)` : ''}.`
                await anotar('google_ads', 'crear_lista_negativas', `Lista "${nombre}" (${r.agregados} términos) adjuntada a ${attach.adjuntadas} campaña(s)`, inp.motivo)
              }
            }
          }
        } else if (tu.name === 'gads_eliminar_lista_negativas') {
          if (!isGoogleAdsConfigurado()) { resultText = 'Google Ads no está configurado en este entorno.' }
          else {
            const inp = tu.input as { resourceName?: string; motivo?: string; confirmado?: boolean }
            if (!inp.confirmado) resultText = 'Falta confirmación explícita del dueño en el chat antes de ejecutar esta acción.'
            else if (!inp.resourceName) resultText = 'Falta el resourceName de la lista (usá gads_listas_negativas para verlo).'
            else {
              await eliminarListaCompartida(inp.resourceName)
              resultText = 'Lista eliminada y desadjuntada de todas las campañas que la usaban.'
              await anotar('google_ads', 'eliminar_lista_negativas', `Lista ${inp.resourceName} eliminada`, inp.motivo)
            }
          }
        } else if (tu.name === 'gads_anuncios') {
          if (!isGoogleAdsConfigurado()) { resultText = 'Google Ads no está configurado en este entorno.' }
          else {
            const ads = await listarAds()
            resultText = ads.map(a => `- ${a.campana} / ${a.grupoAnuncio} (grupoAnuncioId=${a.grupoAnuncioId}): ${a.headlines} titulares (${a.headlinesPinned} pinneados) · ${a.descripciones} descripciones · strength=${a.adStrength} · url=${a.finalUrl}`).join('\n') || 'Sin anuncios activos.'
          }
        } else if (tu.name === 'gads_crear_rsa') {
          if (!isGoogleAdsConfigurado()) { resultText = 'Google Ads no está configurado en este entorno.' }
          else {
            const inp = tu.input as { grupoAnuncioId?: string; headlines?: HeadlineRsa[]; descriptions?: string[]; finalUrl?: string; path1?: string; path2?: string; motivo?: string; confirmado?: boolean }
            if (!inp.confirmado) resultText = 'Falta confirmación explícita del dueño en el chat antes de crear el anuncio (mostrale el copy completo primero).'
            else if (!inp.grupoAnuncioId || !inp.finalUrl) resultText = 'Faltan datos (grupoAnuncioId y finalUrl).'
            else {
              const headlines = inp.headlines || []
              const descriptions = inp.descriptions || []
              const errores = lintRSA({ headlines, descriptions })
              if (errores.length) {
                resultText = 'RECHAZADO por el linter (corregí el copy y volvé a llamar gads_crear_rsa, sin pedir confirmación de nuevo):\n- ' + errores.map(e => `[${e.campo}] ${e.problema}`).join('\n- ')
              } else {
                const rn = await crearRSA(inp.grupoAnuncioId, headlines, descriptions, inp.finalUrl, { path1: inp.path1, path2: inp.path2 })
                resultText = `Listo: RSA nuevo creado en PAUSA (${rn}) en el grupo de anuncios ${inp.grupoAnuncioId}. El anuncio anterior sigue corriendo tal cual — el dueño lo revisa en Google Ads y decide activarlo.`
                await anotar('google_ads', 'crear_rsa', `RSA nuevo EN PAUSA en grupo ${inp.grupoAnuncioId} → ${inp.finalUrl} (${rn})`, inp.motivo)
              }
            }
          }
        } else if (tu.name === 'gads_agregar_callouts') {
          if (!isGoogleAdsConfigurado()) { resultText = 'Google Ads no está configurado en este entorno.' }
          else {
            const inp = tu.input as { campaignId?: string; textos?: string[]; motivo?: string; confirmado?: boolean }
            const textos = (inp.textos || []).filter(Boolean)
            if (!inp.confirmado) resultText = 'Falta confirmación explícita del dueño en el chat antes de ejecutar esta acción (mostrale la lista propuesta primero).'
            else if (!inp.campaignId || textos.length === 0) resultText = 'Faltan datos (campaignId y textos).'
            else {
              const rechazados = textos.map(t => ({ t, err: lintCallout(t) })).filter(x => x.err)
              if (rechazados.length) {
                resultText = 'RECHAZADO por el linter (corregí y volvé a llamar, sin pedir confirmación de nuevo):\n- ' + rechazados.map(x => `"${x.t}": ${x.err}`).join('\n- ')
              } else {
                const n = await agregarCallouts(inp.campaignId, textos)
                resultText = `Listo: ${n} callout(s) nuevo(s) agregados a la campaña id=${inp.campaignId}.`
                await anotar('google_ads', 'agregar_callouts', `${n} callout(s) → campaña id=${inp.campaignId}: ${textos.join(' · ').slice(0, 400)}`, inp.motivo)
              }
            }
          }
        } else if (tu.name === 'gads_crear_campana') {
          if (!isGoogleAdsConfigurado()) { resultText = 'Google Ads no está configurado en este entorno.' }
          else {
            const inp = tu.input as NuevaCampanaParams & { motivo?: string; confirmado?: boolean }
            if (!inp.confirmado) resultText = 'Falta confirmación explícita del dueño en el chat antes de crear la campaña (mostrale el resumen COMPLETO primero: nombre, presupuesto, keyword, URL y los 15 titulares + 4 descripciones).'
            else if (!inp.nombreCampana || !inp.presupuestoClpDiario || !inp.keyword || !inp.finalUrl) resultText = 'Faltan datos (nombreCampana, presupuestoClpDiario, keyword, finalUrl).'
            else {
              const errores = lintRSA({ headlines: inp.headlines || [], descriptions: inp.descriptions || [] })
              if (errores.length) {
                resultText = 'RECHAZADO por el linter de RSA (corregí el copy y volvé a llamar gads_crear_campana, sin pedir confirmación de nuevo):\n- ' + errores.map(e => `[${e.campo}] ${e.problema}`).join('\n- ')
              } else {
                const r = await crearCampanaCompleta({ ...inp, negativas: NEGATIVAS_UNIVERSALES_ES_CL })
                resultText = `Listo: campaña "${inp.nombreCampana}" creada COMPLETA y EN PAUSA (${r.campaignResourceName}) — presupuesto ${fmtPrecio(inp.presupuestoClpDiario)}/día, cobertura de ${r.geoComunas} comuna(s), idioma español, ${NEGATIVAS_UNIVERSALES_ES_CL.length} negativas universales, keyword "${inp.keyword}" (${inp.matchType || 'PHRASE'}) y 1 RSA. Nada gasta hasta que el dueño la active en Google Ads (campaña + grupo + anuncio están en pausa).`
                await anotar('google_ads', 'crear_campana', `Campaña "${inp.nombreCampana}" creada EN PAUSA: ${fmtPrecio(inp.presupuestoClpDiario)}/día, keyword "${inp.keyword}" (${inp.matchType || 'PHRASE'}), ${inp.finalUrl}`, inp.motivo)
              }
            }
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
