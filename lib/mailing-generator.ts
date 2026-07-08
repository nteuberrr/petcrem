import Anthropic from '@anthropic-ai/sdk'
import { BRAND, LOGO_URL, getContacto, type Contacto } from './email-layout'
import { isNanoBananaConfigurado } from './nano-banana'
import { listarImagenes, generarYGuardarImagen, reducirParaVision, type ImagenBanco } from './mailing-images'
import { MARCA_VISUAL } from './marca-visual'
import { GUIA_EMAIL } from './marketing-guia'
import { DIFERENCIADORES, MODALIDADES_SERVICIOS } from './diferenciadores'
import { LINKS_PUBLICOS } from './links-publicos'
import { getTarifasContexto } from './tarifas-html'

/**
 * Generador IA de campañas de mailing (B2B a la base de veterinarios).
 *
 * Dos modelos colaboran:
 *  - CLAUDE dirige: redacta asunto/preview + el HTML completo del correo con
 *    libertad total de diseño (según el formato pedido) y planifica las imágenes.
 *  - NANO BANANA PRO (Gemini 3 Pro Image) genera las imágenes fotorrealistas que
 *    Claude pide → se suben a R2 y se registran en el BANCO (mailing_imagenes).
 *
 * RECICLAJE: Claude recibe el banco de imágenes existentes y, cuando una calza
 * con el contexto, la reutiliza (pone su URL directo en el <img src>) en vez de
 * pedir una nueva. Solo genera imágenes nuevas cuando ninguna del banco sirve.
 *
 * Soporta iteración: regenerar una versión distinta o ajustar la actual con un
 * comentario libre (las imágenes ya generadas quedan en el banco y se reusan, así
 * ajustar no re-genera ni re-cobra imágenes sin necesidad).
 */

let client: Anthropic | null = null
function getClient(): Anthropic {
  if (client) return client
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) throw new Error('ANTHROPIC_API_KEY no configurada')
  client = new Anthropic({ apiKey: key })
  return client
}

export function isGeneradorConfigurado(): boolean {
  return !!process.env.ANTHROPIC_API_KEY
}

// Sonnet por defecto (costo): ~5x más barato que Opus. El linter de marca + las reglas
// inviolables sostienen la calidad. Override con ANTHROPIC_MAILING_MODEL si se quiere Opus.
const MODEL = process.env.ANTHROPIC_MAILING_MODEL || 'claude-sonnet-4-6'

/** Tope de imágenes nuevas por generación (control de costo/latencia). */
const MAX_NUEVAS = 5
/** Cuántas imágenes del banco se le muestran a Claude (más recientes). */
const BANCO_VISIBLE = 40

const GRUPO_DESC: Record<string, string> = {
  todos: 'Toda la base de veterinarios (prospectos, clientes en convenio e inactivos). Mensaje amplio que sirva a todos.',
  prospecto: 'Veterinarios PROSPECTO: aún no trabajan con nosotros. Objetivo: presentarnos con seriedad, mostrar el valor del convenio y generar interés / una primera conversación.',
  cliente: 'Veterinarios que YA son clientes / están en convenio. Objetivo: fidelizar, informar novedades o mejoras del servicio, agradecer la confianza y reforzar el uso.',
  inactivo: 'Veterinarios INACTIVOS: dejaron de derivar pacientes. Objetivo: reconectar con respeto, recordar lo que ofrecemos y reactivar la relación.',
}

const FORMATO_DESC: Record<string, string> = {
  auto: 'Elige tú el formato que mejor sirva al objetivo del mensaje.',
  newsletter: 'NEWSLETTER: varias secciones/novedades con un encabezado claro, bloques separados y jerarquía visual. Ideal para informar varias cosas.',
  correo: 'CORREO SIMPLE: un mensaje directo y enfocado — saludo, uno o dos párrafos y un único llamado a la acción. Sobrio y personal.',
  folleto: 'FOLLETO / PROMOCIONAL: pieza BREVE, SIMPLE y CONCRETA. Una imagen, un título potente, 2-3 ideas o beneficios en pocas palabras y un solo CTA destacado. Nada de párrafos largos ni varias secciones: directo y de un vistazo.',
  anuncio: 'ANUNCIO / NOVEDAD: una sola noticia destacada (lanzamiento, cambio, oferta). Breve, contundente y con un CTA claro.',
}

function bloqueBanco(banco: ImagenBanco[]): string {
  if (banco.length === 0) {
    return 'BANCO DE IMÁGENES: (vacío por ahora — no hay imágenes para reutilizar).'
  }
  const lineas = banco.slice(0, BANCO_VISIBLE).map(b => {
    const desc = b.descripcion || b.alt || b.prompt || '(sin descripción)'
    const grupo = b.grupo ? ` | grupo: ${b.grupo}` : ''
    const tags = b.tags ? ` | tags: ${b.tags}` : ''
    const aspect = b.aspect ? ` | aspecto: ${b.aspect}` : ''
    return `- URL: ${b.url}\n  ${desc}${grupo}${tags}${aspect}`
  }).join('\n')
  return `BANCO DE IMÁGENES DISPONIBLES PARA REUTILIZAR (revísalo SIEMPRE primero):
${lineas}

Para REUTILIZAR una de estas imágenes, copia su URL EXACTA en el atributo src del <img>. Reutiliza cuando la imagen calce razonablemente con el contexto (no fuerces). Solo pide una imagen NUEVA si ninguna del banco sirve. Las imágenes con grupo "instalaciones" son fotos REALES del equipo: úsalas si el correo se beneficia de mostrar las instalaciones (tú nunca generas fotos de instalaciones). Las imágenes con grupo "marca" son el LOGO/sello oficial de Alma Animal: reutilízalas como logo/firma del correo cuando corresponda (tampoco las generas tú).`
}

function systemPrompt(contacto: Contacto, puedeGenerar: boolean): string {
  const web = contacto.web?.startsWith('http') ? contacto.web : `https://${contacto.web || 'crematorioalmaanimal.cl'}`
  const tel = (contacto.telefono || '').replace(/[^\d+]/g, '')
  const imgInstr = puedeGenerar
    ? `${MARCA_VISUAL}

IMÁGENES NUEVAS (cuando ninguna del banco sirve):
  - En el HTML escribe el <img> con su tamaño/estilo y pon en el src un marcador: src="GEN:slot1" (slot2, slot3…). El sistema generará cada imagen y reemplazará el marcador por la URL real.
  - Por CADA marcador agrega una entrada en "nuevas" con: slot (ej. "slot1"), prompt (descripción FOTOGRÁFICA detallada de la escena, en español o inglés), alt (texto alternativo), aspect (ej. "16:9", "1:1", "4:5"), descripcion (1 línea para el banco), tags (palabras clave separadas por coma) y grupo (uno de: mascotas, personas, productos, otro).
  - PROPORCIÓN (CRÍTICO): el "aspect" de cada imagen DEBE coincidir con la FORMA del recuadro donde la pones en el HTML. Si la usas como banner/hero de ancho completo (ancho 600, alto bajo), pide una imagen HORIZONTAL ancha ("16:9" o "3:2") — NUNCA vertical. Si va como retrato en una columna angosta, usa vertical ("4:5"/"3:4"); si es cuadrada, "1:1". Una foto vertical metida en una banda ancha se recorta y CORTA AL SUJETO (cabezas, caras). Regla de oro: la forma de la foto = la forma de su recuadro.
  - RECORTE: si usas object-fit:cover con altura fija, usa object-position:center. NUNCA "center top" ni "bottom" (decapita al sujeto).
  - TODAS las imágenes son FOTORREALISTAS: personas y mascotas REALES, luz natural, como una foto editorial. Nada de ilustración, cartoon, 3D ni texto incrustado en la imagen.
  - PROHIBIDO generar fotos de INSTALACIONES, locales, hornos, salas, fachada, vehículos o cualquier dependencia del crematorio. Esas fotos SOLO se muestran reutilizando imágenes del banco con grupo "instalaciones" (las sube el equipo). Si el correo necesitaría mostrar instalaciones y no hay ninguna en el banco, omite esa imagen — NO la inventes.
  - Máximo ${MAX_NUEVAS} imágenes nuevas por campaña. PRIORIZA reutilizar del banco cuando haya una imagen que CALCE de verdad (reutilizar es gratis; generar cuesta) — pero con VARIEDAD: no repitas siempre las mismas fotos entre campañas, rotá entre las disponibles. Generá una nueva solo si ninguna del banco encaja o si vendrías repitiendo lo ya usado.`
    : `IMÁGENES: la generación de imágenes nuevas NO está disponible ahora. Usa SOLO imágenes del banco (si hay) o diseña un correo atractivo sin fotos (bloques de color, tipografía, el logo). No uses marcadores GEN: ni inventes URLs.`

  return `Eres diseñador senior de email marketing del **Crematorio Alma Animal** (cremación de mascotas, Recoleta, Santiago de Chile; cobertura Región Metropolitana; lema "Huellas que no se borran"). Diseñas campañas para la BASE DE VETERINARIOS (B2B): clínicas en convenio o potenciales socios. Tienes LIBERTAD TOTAL de diseño para crear una pieza de excelencia.

Devuelves SIEMPRE con la herramienta "generar_campana": asunto, preview_text, html y (si pides imágenes nuevas) el arreglo "nuevas".

QUÉ ENTREGAS EN html:
  - Un documento de correo HTML COMPLETO y autosuficiente (<!doctype html>… <html>…</html>), listo para enviarse. Tú decides toda la estructura: encabezado, secciones, imágenes, botones, pie.
  - Incluye tú el encabezado de marca y un pie con los datos de contacto (NO los pone nadie más).

AUDIENCIA Y VOZ (B2B veterinarios):
  - Profesional, técnica, eficiente: hablas como un socio confiable (datos, plazos, procesos claros). Cercana pero sobria.
  - Español neutro de Chile. NUNCA voseo argentino (nada de "tenés", "podés", "querés").
  - Sin humor, sin referencias religiosas, sin clichés del rubro ("puente del arcoíris", "angelitos", "tu ángel").
  - Diferenciadores que puedes comunicar si aplican: instalaciones propias en Recoleta (no se externaliza), trazabilidad total, entrega en 3 días hábiles, retiro a domicilio o desde la clínica, certificado digital, tecnología de punta, red de eutanasia a domicilio para clínicas en convenio.
  - PRECIOS: NUNCA los inventes. Pero SÍ tienes las tarifas reales en el bloque "PRECIOS DE CREMACIÓN" (más abajo): cuando la campaña pida mostrar precios o una TABLA DE PRECIOS, INCLÚYELOS usando EXACTAMENTE esas cifras. Tienes ahí una tabla HTML lista para pegar tal cual en el cuerpo. No inventes descuentos, plazos ni promesas que no estén en la instrucción del usuario ni en ese bloque.

REGISTRO SEGÚN EL TONO PEDIDO (importante — adaptá la ENERGÍA del correo al tono que pida el usuario):
  - Por defecto, sobrio y profesional. PERO si piden un tono CONVOCATORIO / VENDEDOR / PROMOCIONAL / ENTUSIASTA (o algo parecido, en el campo de tono o en la instrucción), subí el voltaje comercial y ponéle "cuento": un GANCHO potente en el titular, los beneficios concretos al frente (rápido, conveniente, siempre disponible, todo bajo control), una invitación CÁLIDA y DIRECTA a sumarse, y un CTA imperativo y entusiasta ("Súmate hoy", "Trabajemos juntos", "Llámanos y accede a las nuevas tarifas"). Contá el "para qué" y por qué conviene ahora — que el correo INVITE a unirse, que no parezca un informe. Podés usar un signo de exclamación puntual y verbos de acción.
  - Se mantiene SIEMPRE, sea cual sea el tono: la voz de marca (profesional y cercana, sin clichés del rubro ni religiosos), español neutro (nunca voseo), y jamás inventar precios/descuentos/plazos.
  - Deliverability (para NO caer en spam), incluso en tono vendedor: en el ASUNTO nada de "!!!", NADA de MAYÚSCULAS SOSTENIDAS, ni palabras quemadas ("GRATIS", "URGENTE", "PROMO", "OFERTA", "YA"). El gancho se logra con un beneficio claro + un verbo de acción, no con signos ni gritos. En el CUERPO tenés más libertad de energía (un "!" puntual está bien), pero sin exceso de signos.

HTML SEGURO PARA EMAIL (obligatorio — Gmail / Outlook / Apple Mail):
  - Solo estilos EN LÍNEA (atributo style="..."). Prohibido: <style> en <head> con clases, flexbox, grid, position, JavaScript. (Un poco de CSS en <style> para media queries simples es tolerable, pero todo lo esencial debe ir inline porque muchos clientes ignoran <style>.)
  - Maqueta con <table role="presentation" cellpadding="0" cellspacing="0" border="0">. Contenedor centrado de máx 600px. Imágenes con width fijo, display:block y border:0; que escalen (style="max-width:100%").
  - Botones "bulletproof" basados en tabla: fondo de color, texto blanco, padding ~12px 26px, border-radius.
  - Tipografía del sistema (font-family con fallbacks). Texto ~15-16px, line-height ~1.6.
  - Paleta de marca: azul ${BRAND.navy} (estructura, títulos, botones), dorado/ámbar ${BRAND.amber} (realces, filetes), fondos blanco/crema ${BRAND.cream}, texto ${BRAND.ink}, secundario ${BRAND.muted}. Regla 60-70% blanco/crema · 20-30% azul · 5-10% dorado.
  - Logo de marca (úsalo en el encabezado): ${LOGO_URL}
    REGLAS DEL LOGO (que no se vea desproporcionado): ponle SIEMPRE una altura fija moderada (height ~44px, máximo 56px) con width:auto; NUNCA le fijes un width grande ni lo estires (no deformar la proporción). Estilo recomendado: style="height:48px;width:auto;display:block;border:0". Va una sola vez, en el encabezado.

${imgInstr}

PERSONALIZACIÓN: puedes insertar variables que se reemplazan por cada destinatario. Usa SOLO estas: {{primer_nombre}}, {{nombre}}, {{veterinaria}}, {{comuna}}, {{telefono}}. Para saludar usa "Hola {{primer_nombre}},".

CONTACTO (inclúyelo en el pie y/o en los CTA, con enlaces reales):
  - Sitio web: ${web}
  - Correo: ${contacto.correo} (mailto:${contacto.correo})
  - Teléfono: ${contacto.telefono} (tel:${tel})

${LINKS_PUBLICOS()}
  Úsalos como BOTÓN principal cuando el objetivo de la campaña calce (ej. campaña de captación → botón "Inscribe tu clínica al convenio" apuntando al link de inscripción). Fuera de estos links y el contacto, no inventes otros enlaces ni formularios.

${GUIA_EMAIL}

asunto: corto y frontal, máx ~8 palabras (~40-45 caracteres, para que no se trunque en móvil), la info clave al inicio. Si piden tono vendedor/convocatorio, hacelo con GANCHO: un verbo de acción + el beneficio ("Baja tus costos de cremación", "Suma un servicio a tu clínica"). Pero SIEMPRE, aun vendedor: sin mayúsculas sostenidas, sin "!!!", sin palabras quemadas (GRATIS/URGENTE/PROMO/YA) y sin emojis llamativos — eso manda el correo a spam. Nunca prometas algo que el cuerpo no cumpla.
preview_text: una frase que COMPLEMENTA el asunto (no lo repite), máx ~90 caracteres.

Responde siempre llamando a la herramienta "generar_campana".`
}

const TOOL: Anthropic.Tool = {
  name: 'generar_campana',
  description: 'Entrega la campaña: asunto, preview_text, el HTML completo del correo y (opcional) las imágenes nuevas a generar.',
  input_schema: {
    type: 'object',
    properties: {
      asunto: { type: 'string', description: 'Asunto, máx ~60 caracteres.' },
      preview_text: { type: 'string', description: 'Frase que complementa el asunto, máx ~110 caracteres.' },
      html: { type: 'string', description: 'Documento HTML COMPLETO del correo, email-safe. Imágenes nuevas usan src="GEN:slotN"; imágenes reutilizadas usan la URL exacta del banco.' },
      nuevas: {
        type: 'array',
        description: 'Imágenes nuevas a generar (máx 5). Vacío si solo reutilizas o no hay imágenes.',
        items: {
          type: 'object',
          properties: {
            slot: { type: 'string', description: 'Identificador del marcador, ej. "slot1" (debe coincidir con src="GEN:slot1").' },
            prompt: { type: 'string', description: 'Descripción fotográfica detallada de la escena a generar (fotorrealista). NUNCA instalaciones/locales del crematorio.' },
            alt: { type: 'string', description: 'Texto alternativo de la imagen.' },
            aspect: { type: 'string', description: 'Relación de aspecto, ej. "16:9", "1:1", "4:5".' },
            descripcion: { type: 'string', description: 'Descripción de 1 línea para el banco de imágenes.' },
            tags: { type: 'string', description: 'Palabras clave separadas por coma para reutilizar la imagen a futuro.' },
            grupo: { type: 'string', enum: ['mascotas', 'personas', 'productos', 'otro'], description: 'Grupo de la imagen. NUNCA "instalaciones" (esas no se generan).' },
          },
          required: ['slot', 'prompt', 'alt'],
        },
      },
    },
    required: ['asunto', 'preview_text', 'html'],
  },
}

interface NuevaImagen {
  slot: string
  prompt: string
  alt?: string
  aspect?: string
  descripcion?: string
  tags?: string
  grupo?: string
}

export interface ImagenUsada {
  url: string
  alt: string
  origen: 'ai' | 'reuse'
  id?: string
}

export interface CampanaActual {
  asunto: string
  preview_text: string
  html: string
}

export interface GenerarOpts {
  instruccion: string
  categoria: string
  tono?: string
  formato?: string
  actual?: CampanaActual
  comentario?: string
  variar?: boolean
  creadoPor?: string
}

export interface CampanaGenerada extends CampanaActual {
  imagenes: ImagenUsada[]
  /** Avisos no fatales (ej. una imagen no se pudo generar). */
  avisos: string[]
}

function construirInstruccion(opts: GenerarOpts): string {
  const grupo = GRUPO_DESC[opts.categoria] || GRUPO_DESC.todos
  const formato = FORMATO_DESC[opts.formato || 'auto'] || FORMATO_DESC.auto
  const partes: string[] = []
  partes.push(`GRUPO DESTINO: ${grupo}`)
  partes.push(`FORMATO: ${formato}`)
  if (opts.tono?.trim()) partes.push(`TONO PEDIDO: ${opts.tono.trim()}`)
  partes.push(`QUÉ QUIERE COMUNICAR LA CAMPAÑA:\n${opts.instruccion.trim()}`)

  if (opts.actual && opts.comentario?.trim()) {
    partes.push(
      `CAMPAÑA ACTUAL (ajústala según el comentario; conserva lo que funciona, incluidas las imágenes ya presentes —deja sus URLs tal cual— y cambia solo lo necesario):\n` +
      `asunto: ${opts.actual.asunto}\n` +
      `preview_text: ${opts.actual.preview_text}\n` +
      `html:\n${opts.actual.html}`
    )
    partes.push(`COMENTARIO DEL USUARIO (qué ajustar): ${opts.comentario.trim()}`)
  } else if (opts.variar && opts.actual) {
    partes.push(
      `Ya generaste una versión antes; crea una ALTERNATIVA claramente DISTINTA (otro enfoque, otra estructura y otro asunto) sobre el mismo tema. Asunto anterior: ${opts.actual.asunto}`
    )
  }
  return partes.join('\n\n')
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// ─── Encaje foto ↔ recuadro (fix determinista del recorte) ───────────────────
// El modelo elige el `aspect` de cada imagen por su cuenta y a veces no coincide
// con la FORMA del recuadro donde la pone en el HTML (ej. pidió una vertical 3:4
// y la usó como hero horizontal 600×260 → object-fit:cover recorta y corta al
// sujeto). Acá derivamos el aspecto REAL del slot para generar la foto con esa
// forma, así entra sin recortar. Es la fuente de verdad: la imagen debe caber en
// su caja de despliegue.

// Relaciones que nano-banana conoce (ASPECT_HINT). La imagen se snapea a la más cercana.
const RATIOS: Array<{ s: string; r: number }> = [
  { s: '16:9', r: 16 / 9 }, { s: '3:2', r: 3 / 2 }, { s: '4:3', r: 4 / 3 },
  { s: '1:1', r: 1 }, { s: '4:5', r: 4 / 5 }, { s: '3:4', r: 3 / 4 }, { s: '9:16', r: 9 / 16 },
]
export function snapAspect(ratio: number): string {
  let best = RATIOS[0]
  for (const x of RATIOS) if (Math.abs(x.r - ratio) < Math.abs(best.r - ratio)) best = x
  return best.s
}

function numDe(re: RegExp, s: string): number | null {
  const m = s.match(re)
  const n = m ? parseInt(m[1], 10) : NaN
  return Number.isFinite(n) && n > 0 ? n : null
}

/**
 * Deriva el aspecto de generación desde el recuadro real del slot `GEN:slotN` en
 * el HTML. Si el slot fija ancho Y alto → devuelve el ratio snappeado (para que la
 * foto ENTRE sin recortar al sujeto). Si el alto es auto/desconocido → null (no hay
 * riesgo de recorte, se respeta el aspect que pidió el modelo).
 */
export function aspectoDelSlot(html: string, slot: string): string | null {
  const tagM = html.match(new RegExp(`<img\\b[^>]*\\bsrc=["']GEN:${escapeRegex(slot)}["'][^>]*>`, 'i'))
  if (!tagM) return null
  const tag = tagM[0]
  const style = (tag.match(/\bstyle=["']([^"']*)["']/i) || [])[1] || ''
  const h = numDe(/height\s*:\s*(\d+)\s*px/i, style) ?? numDe(/\bheight=["'](\d+)["']/i, tag)
  const w = numDe(/max-width\s*:\s*(\d+)\s*px/i, style)
    ?? numDe(/\bwidth\s*:\s*(\d+)\s*px/i, style)
    ?? numDe(/\bwidth=["'](\d+)["']/i, tag)
  if (!h || !w) return null // sin alto fijo → no fuerza recorte, no override
  return snapAspect(w / h)
}

/**
 * Segunda red: para las fotos de contenido con object-fit:cover, centra el recorte
 * (object-position:center). Evita "center top"/"bottom" que corta cabezas/caras.
 */
export function centrarRecorteAI(html: string, urls: string[]): string {
  if (!urls.length) return html
  const set = new Set(urls)
  return html.replace(/<img\b[^>]*>/gi, tag => {
    const src = (tag.match(/\bsrc=["']([^"']+)["']/i) || [])[1]
    if (!src || !set.has(src)) return tag
    if (!/object-fit\s*:\s*cover/i.test(tag)) return tag
    return /object-position\s*:/i.test(tag)
      ? tag.replace(/object-position\s*:\s*[^;"']*/i, 'object-position:center')
      : tag
  })
}

/** Genera (o ajusta) una campaña: Claude dirige, Nano Banana genera las imágenes. */
export async function generarCampana(opts: GenerarOpts): Promise<CampanaGenerada> {
  if (!opts.instruccion?.trim()) throw new Error('Falta la instrucción de la campaña')
  const puedeGenerar = isNanoBananaConfigurado()
  const [contacto, banco] = await Promise.all([getContacto(), listarImagenes().catch(() => [] as ImagenBanco[])])

  const tarifas = await getTarifasContexto()
  const system: Anthropic.TextBlockParam[] = [
    { type: 'text', text: systemPrompt(contacto, puedeGenerar) },
    { type: 'text', text: DIFERENCIADORES },
    { type: 'text', text: MODALIDADES_SERVICIOS },
    { type: 'text', text: bloqueBanco(banco) },
  ]
  if (tarifas.hayTarifas) {
    system.push({
      type: 'text',
      text: `PRECIOS DE CREMACIÓN (cifras REALES y vigentes — úsalas SOLO de acá, nunca inventes otras). Si la campaña pide mostrar precios o una tabla de precios, incluílos; podés pegar la TABLA HTML de abajo tal cual dentro del cuerpo del correo (ya es email-safe y con la paleta de marca).\n\n${tarifas.texto}\n\nTABLA HTML LISTA PARA PEGAR (cópiala tal cual donde quieras mostrar los precios):\n${tarifas.tablaHtml}`,
    })
  }

  const res = await getClient().messages.create({
    model: MODEL,
    // El HTML de un correo completo (con tabla de precios + diseño) supera los 8k
    // tokens; con 8000 el modelo truncaba y devolvía el html vacío (stop_reason=max_tokens).
    max_tokens: 16000,
    system,
    tools: [TOOL],
    tool_choice: { type: 'tool', name: 'generar_campana' },
    messages: [{ role: 'user', content: construirInstruccion(opts) }],
  })

  const toolUse = res.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === 'generar_campana'
  )
  if (!toolUse) throw new Error('El modelo no devolvió una campaña')
  const out = toolUse.input as { asunto?: string; preview_text?: string; html?: string; nuevas?: NuevaImagen[] }
  const asunto = (out.asunto || '').trim()
  const preview_text = (out.preview_text || '').trim()
  let html = (out.html || '').trim()
  if (!html) {
    throw new Error(
      `El modelo no devolvió el HTML del correo (stop_reason=${res.stop_reason}, ` +
      `output_tokens=${res.usage?.output_tokens ?? '?'}, campos=[${Object.keys(out).join(', ')}])`,
    )
  }

  const avisos: string[] = []
  const imagenes: ImagenUsada[] = []

  // Imágenes REUTILIZADAS: detectar URLs del banco presentes en el HTML.
  for (const b of banco) {
    if (b.url && html.includes(b.url)) {
      imagenes.push({ url: b.url, alt: b.alt || b.descripcion || '', origen: 'reuse', id: b.id })
    }
  }

  // Guardrail: la IA NUNCA genera fotos de instalaciones — quitar esos marcadores.
  const pedidas = (out.nuevas || []).filter(n => n?.slot && n?.prompt)
  for (const n of pedidas) {
    if ((n.grupo || '').toLowerCase() === 'instalaciones') {
      const token = `GEN:${n.slot}`
      html = html.replace(new RegExp(`<img\\b[^>]*\\bsrc=["']${escapeRegex(token)}["'][^>]*>`, 'gi'), '')
      avisos.push('Se omitió una imagen de instalaciones: esas fotos solo se usan si las subes tú al banco (grupo «instalaciones»).')
    }
  }

  // Imágenes NUEVAS: generar con Nano Banana (en paralelo, acotadas) y reemplazar marcadores.
  const nuevas = pedidas.filter(n => (n.grupo || '').toLowerCase() !== 'instalaciones').slice(0, MAX_NUEVAS)

  // FIX DE ENCAJE: antes de generar, forzamos el aspecto de cada imagen al de su
  // recuadro real en el HTML (si el slot fija ancho×alto). Así la foto entra sin
  // recortar al sujeto, aunque el modelo haya pedido otra proporción.
  for (const n of nuevas) {
    const a = aspectoDelSlot(html, n.slot)
    if (a && a !== n.aspect) {
      avisos.push(`Ajusté la foto ${n.slot} a proporción ${a} para que entre en su recuadro sin recortarse.`)
      n.aspect = a
    }
  }

  const genBuffers: { label: string; buffer: Buffer; mime: string }[] = []
  if (nuevas.length > 0 && puedeGenerar) {
    const resultados = await Promise.all(nuevas.map(async n => {
      try {
        const r = await generarYGuardarImagen({
          prompt: n.prompt,
          alt: n.alt,
          descripcion: n.descripcion || n.alt,
          tags: n.tags,
          grupo: n.grupo || 'otro',
          aspect: n.aspect,
          creadoPor: opts.creadoPor,
        })
        return { slot: n.slot, ok: true as const, r }
      } catch (e) {
        return { slot: n.slot, ok: false as const, error: e instanceof Error ? e.message : String(e) }
      }
    }))
    for (const res2 of resultados) {
      const token = `GEN:${res2.slot}`
      if (res2.ok) {
        html = html.split(token).join(res2.r.imagen.url)
        imagenes.push({ url: res2.r.imagen.url, alt: res2.r.imagen.alt || '', origen: 'ai', id: res2.r.imagen.id })
        genBuffers.push({ label: res2.r.imagen.alt || res2.slot, buffer: res2.r.buffer, mime: res2.r.mime })
      } else {
        // Quitar la <img> que apuntaba al marcador fallido (mejor que dejarla rota).
        html = html.replace(new RegExp(`<img\\b[^>]*\\bsrc=["']${escapeRegex(token)}["'][^>]*>`, 'gi'), '')
        avisos.push(`No se pudo generar la imagen ${res2.slot}: ${res2.error}`)
      }
    }
  }

  // Limpiar cualquier marcador GEN: que haya quedado sin resolver (slot sin entrada en "nuevas").
  if (/GEN:/.test(html)) {
    html = html.replace(/<img\b[^>]*\bsrc=["']GEN:[^"']*["'][^>]*>/gi, '')
    if (/GEN:/.test(html)) html = html.replace(/GEN:[\w-]+/g, '')
  }

  if (nuevas.length > 0 && !puedeGenerar) {
    avisos.push('El modelo pidió imágenes nuevas pero la generación no está disponible (falta GEMINI_API_KEY).')
  }

  // PASE DE REVISIÓN: antes de entregar, el agente revisa la consistencia visual
  // de las imágenes generadas (con visión) y la composición del correo, y pule el
  // HTML. Best-effort: si falla, se entrega lo generado igual.
  try {
    const revisado = await revisarYPulir(html, genBuffers)
    if (revisado.html) html = revisado.html
    if (revisado.avisos.length) avisos.push(...revisado.avisos)
  } catch (e) {
    console.warn('[mailing-generator] revisión final falló:', e)
  }

  // Red final: centrar el recorte de las fotos de contenido (por si el revisor dejó
  // un object-position:top/bottom que corta caras).
  html = centrarRecorteAI(html, imagenes.map(i => i.url))

  return { asunto, preview_text, html, imagenes, avisos }
}

// ─── Pase de revisión / pulido (director de arte + QA) ───────────────────────

const REVIEW_SYSTEM = `Eres director de arte y QA de email marketing del Crematorio Alma Animal. Recibes el HTML final de un correo (y, si las hay, las imágenes generadas para él). Tu trabajo es revisar y PULIR antes de entregar.

Revisa y CORRIGE en el HTML:
- Composición y equilibrio: jerarquía clara, espaciado consistente, alineación prolija, que no se vea recargado ni vacío.
- Consistencia visual: anchos de imagen coherentes, mismos radios/bordes, uso de la paleta de marca (azul ${BRAND.navy}, ámbar ${BRAND.amber}, crema ${BRAND.cream}) bien dosificado (60-70% claro · 20-30% azul · 5-10% ámbar).
- LOGO: altura moderada (44-56px) con width:auto, SIN estirar ni desproporcionar; una sola vez en el encabezado.
- Email-safe: estilos inline, tablas role="presentation", contenedor ~600px centrado, imágenes con max-width:100% y display:block.

NO cambies: el copy/mensaje, las variables {{...}}, ni las URLs de las imágenes (atributo src). Solo ajusta el markup/estilos para que quede impecable.

Si te paso imágenes generadas, verifica que sean FOTORREALISTAS y CONSISTENTES entre sí y con el correo. Si alguna NO calza (estilo distinto, no realista, mal recortada), NO la quites: anótala en "avisos" para que el equipo la regenere.

ENCAJE FOTO ↔ RECUADRO (importante — este es el error más común): revisá cada <img> contra el tamaño del recuadro donde va. Si una foto es claramente VERTICAL (retrato) pero se usa como banner/hero de ancho completo con object-fit:cover y poca altura, se va a recortar y CORTAR AL SUJETO (mostrará pared/techo en vez de la persona). En ese caso corregí el recuadro: dale height:auto (que se vea la foto completa) o una altura acorde a su proporción; y usa object-position:center (nunca "top"/"bottom"). Cada banner ancho necesita una foto horizontal; cada retrato, un recuadro vertical o cuadrado.

Verificá TAMBIÉN contra la guía de email (asunto/preheader, 600px, UN solo CTA botón, nada de email 100% imagen, alt text, footer con baja):
${GUIA_EMAIL}

Devuelve con la herramienta "entregar_revision".`

const REVIEW_TOOL: Anthropic.Tool = {
  name: 'entregar_revision',
  description: 'Devuelve el HTML pulido y los avisos de la revisión.',
  input_schema: {
    type: 'object',
    properties: {
      html_final: { type: 'string', description: 'HTML completo del correo, pulido. Mantiene copy, variables {{...}} y URLs de imágenes.' },
      avisos: { type: 'array', items: { type: 'string' }, description: 'Problemas que NO se pudieron corregir (ej. una imagen inconsistente). Vacío si todo quedó bien.' },
    },
    required: ['html_final'],
  },
}

async function revisarYPulir(
  html: string,
  imgs: { label: string; buffer: Buffer; mime: string }[],
): Promise<{ html: string; avisos: string[] }> {
  const content: Anthropic.ContentBlockParam[] = [
    { type: 'text', text: `HTML del correo a revisar y pulir:\n\n${html}` },
  ]
  if (imgs.length > 0) {
    content.push({ type: 'text', text: 'Imágenes generadas para este correo (revisa su consistencia visual entre sí y con el correo):' })
    for (const im of imgs) {
      // ~768px: la QA no necesita resolución completa → menos tokens de visión.
      const mini = await reducirParaVision(im.buffer)
      content.push({ type: 'text', text: `Imagen: ${im.label}` })
      content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: mini.data.toString('base64') } })
    }
  }
  const res = await getClient().messages.create({
    model: MODEL,
    // Re-emite el HTML COMPLETO pulido → necesita el mismo margen que la generación.
    max_tokens: 16000,
    system: REVIEW_SYSTEM,
    tools: [REVIEW_TOOL],
    tool_choice: { type: 'tool', name: 'entregar_revision' },
    messages: [{ role: 'user', content }],
  })
  const tu = res.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === 'entregar_revision'
  )
  if (!tu) return { html, avisos: [] }
  const out = tu.input as { html_final?: string; avisos?: string[] }
  return {
    html: (out.html_final || '').trim() || html,
    avisos: Array.isArray(out.avisos) ? out.avisos.filter(Boolean) : [],
  }
}
