import Anthropic from '@anthropic-ai/sdk'
import { BRAND, getContacto } from './email-layout'
import { MARCA_VISUAL, MARCA_GRAFICO } from './marca-visual'
import { GUIA_SOCIAL, GUIA_QA } from './marketing-guia'
import { construirPlantilla, PLANTILLAS, PLANTILLAS_INFO, type SlotsPlantilla } from './marketing-plantillas'
import { DIFERENCIADORES, MODALIDADES_SERVICIOS } from './diferenciadores'
import { REGLAS_INVIOLABLES } from './marca-voz'
import { lintCopy, extraerTextoHtml } from './marketing-lint'
import { listarImagenes, generarYGuardarImagen, estamparLogoEnUrl, asignarCampania, reducirParaVision, eliminarImagenPorUrl, type ImagenBanco } from './mailing-images'
import { generarGraficoMarca, cargarDisenoGrafico, type FotoGrafico } from './marketing-grafico'
import { esLogo } from './marca-logo'
import { isNanoBananaConfigurado } from './nano-banana'
import { generarCampana } from './mailing-generator'
import { obtenerItem, actualizarItem, listarCalendario, type ItemCalendario } from './marketing-calendario'
import { getNextId, appendRow, getSheetData, updateById } from './datastore'
import { uploadToR2 } from './cloudflare-r2'
import { todayISO } from './dates'

/** Mapea objetivo/audiencia del ítem al segmento del generador de mailing (B2B vets). */
function mapCategoriaEmail(objetivo: string): string {
  if (objetivo === 'captacion_vets') return 'prospecto'
  if (objetivo === 'postventa' || objetivo === 'recordacion') return 'cliente'
  return 'todos'
}

/**
 * Materializa (o actualiza) un borrador real en mailing_campanas para que el correo
 * generado entre al pipeline de envío de Mail (no quede huérfano). Devuelve el id.
 */
async function materializarBorradorEmail(args: {
  asunto: string; preview: string; html: string; categoria: string; creadoPor?: string; existingId?: string
}): Promise<string> {
  // Reusar el borrador ya creado para este ítem (al regenerar), si sigue en borrador.
  if (args.existingId) {
    const rows = await getSheetData('mailing_campanas')
    const row = rows.find(r => String(r.id) === String(args.existingId))
    if (row && row.estado === 'borrador') {
      const key = `mailing/campanas/${args.existingId}.html`
      const up = await uploadToR2(Buffer.from(args.html, 'utf8'), key, 'text/html; charset=utf-8')
      await updateById('mailing_campanas', args.existingId, {
        ...row, asunto: args.asunto, preview_text: args.preview,
        html_key: up.key, html_url: up.url, filtros_json: JSON.stringify({ categoria: args.categoria }),
      })
      return args.existingId
    }
    // Si ya no existe o ya se envió, creamos uno nuevo abajo.
  }
  const id = await getNextId('mailing_campanas')
  const key = `mailing/campanas/${id}.html`
  const up = await uploadToR2(Buffer.from(args.html, 'utf8'), key, 'text/html; charset=utf-8')
  await appendRow('mailing_campanas', {
    id, asunto: args.asunto, html_key: up.key, html_url: up.url,
    preview_text: args.preview, reply_to: '',
    fecha_envio: '', hora_envio: '', total_destinatarios: '0',
    enviados: '0', entregados: '0', aperturas: '0', clicks: '0', rebotes: '0', spam: '0', fallidos: '0',
    estado: 'borrador', filtros_json: JSON.stringify({ categoria: args.categoria }), attachments_json: '',
    creado_por: args.creadoPor || '', fecha_creacion: todayISO(),
  })
  return id
}

/**
 * Generación de la PIEZA de una fila del calendario (control de costo: solo se
 * llama sobre ítems aprobados, nunca en el paso de planificación).
 *
 *  - email   → reutiliza el generador de campañas (Claude + Nano Banana): asunto
 *              + HTML completo. Queda como borrador para refinar/enviar en Mailing.
 *  - social  → Claude redacta el copy (con la voz de la audiencia) y arma las
 *              imágenes mezclando PLACAS DE MARCA (texto sobre el diseño, vía satori,
 *              sin costo), fotos del banco y fotos NUEVAS cuando suman variedad. La
 *              MEMORIA DE VARIEDAD (columna `estilo` del calendario) evita repetir
 *              layout/fondo/fotos entre piezas. NUNCA instalaciones ni stock corporativo.
 */

let client: Anthropic | null = null
function getClient(): Anthropic {
  if (client) return client
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) throw new Error('ANTHROPIC_API_KEY no configurada')
  client = new Anthropic({ apiKey: key })
  return client
}

export function isPiezaConfigurada(): boolean {
  return !!process.env.ANTHROPIC_API_KEY
}

// Sonnet por defecto (costo): ~5x más barato que Opus para planificación/QA/edición de
// placas. El linter + las reglas inviolables sostienen la marca. Override con ANTHROPIC_MAILING_MODEL.
const MODEL = process.env.ANTHROPIC_MAILING_MODEL || 'claude-sonnet-4-6'
const BANCO_VISIBLE = 40

const VOZ_AUDIENCIA: Record<string, string> = {
  tutores: `AUDIENCIA: TUTORES (B2C), adultos en duelo por su mascota. Voz: tuteo cálido pero sobrio, cercana y humana, profesional. Inspira confianza, NO lástima. Sin clichés del rubro ("puente del arcoíris", "angelito", "ya no sufre"), sin humor, sin religión. A la mascota por su nombre cuando aplique; genérico "tu mascota".`,
  veterinarios: `AUDIENCIA: VETERINARIOS / CLÍNICAS (B2B). Voz: profesional, técnica, eficiente, de socio confiable (datos, plazos, procesos). Cercana pero sobria. Los argumentos que MANDAN, en este orden (dueño): retiro en menos de 3 horas, operamos de lunes a domingo, entrega en 3 días hábiles, precios convenientes y trazabilidad total; complementos: instalaciones propias y red de eutanasia a domicilio.`,
  ambos: `AUDIENCIA: MIXTA (tutores y veterinarios). Voz cercana y profesional, español neutro de Chile. Sin clichés del rubro, sin humor, sin religión.`,
}

const CANAL_HINT: Record<string, string> = {
  instagram: 'Instagram (feed): copy breve y con gancho. El HOOK va en los primeros ~125 caracteres (funciona solo, sin relleno) e incluí la KEYWORD principal como la buscaría la gente en las primeras 2 líneas. Al final, 3-5 hashtags NICHO y específicos (mascotas/Chile/comuna; más de 5 baja el alcance) — nunca genéricos (#amor #mascotas). Emojis con MUCHA moderación (a lo sumo una huellita 🐾). Instagram admite CARRUSEL (varias imágenes que el usuario desliza). DIMENSIÓN (regla del dueño): TODAS las imágenes de Instagram van en 4:5 VERTICAL — aspect "4:5" en fotos y lienzo post_vertical 1080x1350 en las placas (así se ven bien en el perfil).',
  facebook: 'Facebook (Página): copy un poco más extenso que IG, 2-4 frases, puede incluir un llamado a la acción y el sitio web. Pocos o ningún hashtag. Sin emojis tristes. Facebook admite VARIAS imágenes en un mismo post (álbum/paso a paso): si la idea es una secuencia o varias ideas, hacé varias placas.',
}

/** Tope de imágenes por pieza y de imágenes NUEVAS a generar (control de costo). */
const MAX_IMGS = 10
const MAX_NUEVAS = 10

interface EspecieImagen {
  modo?: 'reuse' | 'nueva' | 'grafico' | 'plantilla'
  /** modo=plantilla: nombre de la plantilla maestra + sus slots. */
  plantilla?: string
  slots?: SlotsPlantilla
  url?: string
  prompt?: string
  alt?: string
  descripcion?: string
  tags?: string
  grupo?: string
  aspect?: string
  /** modo=grafico: el HTML de la PLACA de marca (ver MARCA_GRAFICO). */
  html?: string
  /** modo=grafico: fotos reales a insertar en la placa (FOTO:slot). */
  fotos?: { slot?: string; prompt?: string; aspect?: string; recortar?: boolean }[]
  /** Declarados por el modelo para la MEMORIA DE VARIEDAD entre piezas. */
  layout?: string
  fondo?: string
}
interface SalidaPost {
  caption?: string
  /** Imágenes EN ORDEN. 1 = post simple; 2+ = carrusel (Instagram). */
  imagenes?: EspecieImagen[]
}
/** Una imagen ya resuelta (reutilizada, generada o placa de marca). */
interface ImagenResuelta { url: string; alt: string; id: string; grafico?: boolean }

/** Relación de aspecto del carrusel → formato del motor de placas (satori). */
function aspectoAFormato(aspect?: string): string {
  switch ((aspect || '1:1').trim()) {
    case '4:5': return 'post_vertical'
    case '9:16': return 'story'
    case '16:9': return 'horizontal'
    default: return 'post' // 1:1
  }
}

/** Variantes del logo de marca (grupo "marca") para que el modelo las ponga en las placas. */
function bloqueLogosPieza(banco: ImagenBanco[]): string {
  const logos = banco.filter(esLogo)
  if (logos.length === 0) return ''
  const lineas = logos.map(l => {
    const d = `${l.descripcion || l.alt || ''}`.toLowerCase()
    const hint = /blanc/.test(d) ? ' → sobre fondos OSCUROS/navy' : /azul|navy|oscuro/.test(d) ? ' → sobre fondos CLAROS/crema' : ''
    return `- ${l.descripcion || `logo #${l.id}`}: ${l.url}${hint}`
  }).join('\n')
  return `LOGOS DE MARCA (al diseñar una placa, poné el logo con <img src="URL"> eligiendo la variante que CONTRASTE con el fondo):\n${lineas}`
}

/** Resuelve las URLs del logo por contraste (blanco para fondos oscuros/foto, navy
 *  para fondos claros), para pasárselas a las plantillas maestras. */
function resolverLogos(banco: ImagenBanco[]): { blanco?: string; navy?: string } {
  const logos = banco.filter(esLogo)
  const desc = (l: ImagenBanco) => `${l.descripcion || ''} ${l.alt || ''}`.toLowerCase()
  const blanco = logos.find(l => /blanc/.test(desc(l)))?.url
  const navy = logos.find(l => /azul|navy|oscuro/.test(desc(l)))?.url
  return { blanco: blanco || logos[0]?.url, navy: navy || blanco || logos[0]?.url }
}

function bancoBloque(banco: ImagenBanco[], fotosUsadas?: Set<string>): string {
  if (banco.length === 0) return 'BANCO DE IMÁGENES: (vacío — no hay imágenes para reutilizar).'
  const esFotoReal = (b: ImagenBanco) => ['mascotas', 'personas', 'productos'].includes((b.grupo || '').toLowerCase())
  const fmt = (b: ImagenBanco) => {
    const desc = b.descripcion || b.alt || b.prompt || '(sin descripción)'
    const tags = b.tags ? ` | tags: ${b.tags}` : ''
    const usada = fotosUsadas?.has(b.url) ? ' ⚠️ USADA en las últimas piezas — NO la repitas' : ''
    return `- ${b.url}\n  ${desc} (grupo: ${b.grupo || 'otro'})${tags}${usada}`
  }
  const fotos = banco.filter(esFotoReal)
  const otras = banco.filter(b => !esFotoReal(b))
  const partes: string[] = []
  if (fotos.length) {
    partes.push(`FOTOS REALES (mascotas/personas/productos) — reutilizá una de estas (modo "reuse", URL exacta) cuando una FOTO cálida aporte cercanía a la pieza. Pero con VARIEDAD: rotá entre las disponibles, NO pongas siempre la misma; las marcadas "USADA en las últimas piezas" están VETADAS (el feed las muestra juntas y repetir foto se nota mucho más que el costo de una nueva). Si ninguna libre calza, generá una foto NUEVA — está bien generar:\n${fotos.slice(0, 24).map(fmt).join('\n')}`)
  }
  if (otras.length) {
    partes.push(`OTRAS IMÁGENES (placas/varios):\n${otras.slice(0, Math.max(0, BANCO_VISIBLE - Math.min(fotos.length, 24))).map(fmt).join('\n')}`)
  }
  return `BANCO DE IMÁGENES PARA REUTILIZAR (revísalo SIEMPRE primero):\n${partes.join('\n\n')}`
}

/**
 * MEMORIA DE VARIEDAD: resume el estilo (layout/fondo/fotos del banco) de las últimas
 * piezas sociales generadas, para inyectarlo al generar la siguiente. Es el mecanismo
 * anti-monotonía: cada pieza se generaba a ciegas de las anteriores y todas convergían
 * al mismo molde navy. Devuelve el bloque de texto + el set de fotos vetadas.
 */
async function memoriaVariedad(exceptoId: string): Promise<{ bloque: string; fotosUsadas: Set<string> }> {
  const vacio = { bloque: '', fotosUsadas: new Set<string>() }
  try {
    const recientes = (await listarCalendario({}))
      .filter(it => String(it.id) !== String(exceptoId) && (it.canal === 'instagram' || it.canal === 'facebook'))
      .filter(it => it.activa !== 'FALSE' && (it.cuerpo || '').trim() !== '' && (it.estilo || '').trim() !== '')
      .sort((a, b) => (parseInt(b.id, 10) || 0) - (parseInt(a.id, 10) || 0))
      .slice(0, 6)
    if (recientes.length === 0) return vacio
    const fotosUsadas = new Set<string>()
    const lineas = recientes.map(it => {
      let e: { portada?: string; fondos?: string[]; fotos?: string[] } = {}
      try { e = JSON.parse(it.estilo) } catch { /* estilo corrupto: se lista sin detalle */ }
      for (const f of e.fotos || []) fotosUsadas.add(f)
      const fondos = (e.fondos || []).join(', ') || '?'
      return `- "${(it.titulo || it.idea || '').slice(0, 60)}" (${it.fecha || 's/f'}): portada ${e.portada || '?'}; fondos: ${fondos}${(e.fotos || []).length ? `; fotos del banco: ${(e.fotos || []).length}` : ''}`
    })
    return {
      bloque: `ÚLTIMAS PIEZAS GENERADAS (el feed las muestra JUNTAS — memoria de variedad):\n${lineas.join('\n')}\nREGLA DURA: para ESTA pieza elegí un layout y un fondo de portada DISTINTOS a los que dominan arriba. Si arriba domina el navy, esta portada va en crema/blanco o foto protagonista. Las fotos del banco marcadas "USADA" están vetadas.`,
      fotosUsadas,
    }
  } catch { return vacio }
}

const TOOL_POST: Anthropic.Tool = {
  name: 'entregar_post',
  description: 'Entrega el copy del post y sus imágenes EN ORDEN (1 imagen = post simple; 2 a 10 = varias imágenes: carrusel en Instagram o álbum/paso a paso en Facebook). Cada imagen se reutiliza del banco o se genera nueva.',
  input_schema: {
    type: 'object',
    properties: {
      caption: { type: 'string', description: 'Texto del post listo para publicar (incluye hashtags si corresponde al canal). Si es carrusel, el copy puede invitar a deslizar.' },
      imagenes: {
        type: 'array',
        description: 'Imágenes del post EN ORDEN. 1 imagen = post simple. Para VARIAS imágenes (carrusel en Instagram, álbum/paso a paso en Facebook) devolvé 2 a 10 coherentes entre sí — AMBOS canales lo admiten. Vacío si no hay imagen. Mezclá con criterio: placas con foto integrada, fotos del banco y fotos nuevas — lo importante es VARIAR layout y fondo.',
        items: {
          type: 'object',
          properties: {
            modo: { type: 'string', enum: ['plantilla', 'grafico', 'reuse', 'nueva'], description: 'plantilla = PLACA de una PLANTILLA MAESTRA on-brand (RECOMENDADO para casi todo: elegís plantilla + slots y el layout no se rompe); reuse = usar una foto del banco; nueva = generar una foto fotorrealista NUEVA; grafico = HTML libre (SOLO si ninguna plantilla calza — es más frágil).' },
            plantilla: { type: 'string', enum: [...PLANTILLAS], description: 'Si modo=plantilla: qué plantilla usar (portada = apertura/gancho; contenido = idea + bullets; dato = una cifra fuerte; foto = foto protagonista casi sin texto; cierre = CTA final).' },
            slots: {
              type: 'object',
              description: 'Si modo=plantilla: el CONTENIDO de la plantilla (textos CORTOS; lo que no cabe se recorta). No todos aplican a cada plantilla — mirá PLANTILLAS DISPONIBLES.',
              properties: {
                eyebrow: { type: 'string', description: 'Etiqueta corta arriba (ej. "PARA VETERINARIOS").' },
                titulo: { type: 'string', description: 'Titular (2-4 palabras). En "foto" es una frase corta.' },
                titulo_destacado: { type: 'string', description: '2ª línea del titular; sale en DORADO, en su propia línea.' },
                bajada: { type: 'string', description: 'Una frase de apoyo, corta.' },
                bullets: { type: 'array', items: { type: 'string' }, description: 'Solo "contenido": 2-4 bullets MUY cortos.' },
                dato: { type: 'string', description: 'Solo "dato": el número/palabra grande (ej. "3 días").' },
                dato_label: { type: 'string', description: 'Solo "dato": qué es esa cifra.' },
                cta: { type: 'string', description: 'Llamado a la acción corto o teléfono (portada/cierre).' },
                cta_secundario: { type: 'string', description: 'Web o dato secundario del CTA.' },
                fondo: { type: 'string', enum: ['navy', 'crema', 'blanco'], description: 'Color de fondo dominante (alterná entre piezas).' },
                foto: {
                  type: 'object',
                  description: 'Foto de la plantilla (banda o full-bleed). prompt para generar una nueva, o url para reutilizar una del banco.',
                  properties: { prompt: { type: 'string', description: 'Descripción fotográfica cálida (mascota viva/tutor; NUNCA instalaciones).' }, url: { type: 'string', description: 'URL exacta del banco para reutilizar.' } },
                },
              },
            },
            layout: { type: 'string', enum: ['foto_full', 'foto_protagonista', 'recorte_color', 'asomandose', 'editorial', 'placa_texto', 'foto_banco'], description: 'Layout de ESTA imagen (memoria de variedad: se guarda para que la próxima pieza no repita el molde).' },
            fondo: { type: 'string', enum: ['navy', 'crema', 'blanco', 'foto'], description: 'Fondo/color DOMINANTE de esta imagen (para alternar entre piezas y dentro del carrusel).' },
            html: { type: 'string', description: 'Si modo=grafico: el HTML de la placa (ver "DISEÑO DE GRÁFICOS CON TEXTO": un solo <div> raíz del tamaño del formato, flexbox, More Sugar solo el título / Inter el resto, hex de marca, el logo con <img>, fotos con <img src="FOTO:slotN">).' },
            fotos: {
              type: 'array',
              description: 'Si modo=grafico y la placa incluye fotos reales: una por cada <img src="FOTO:slotN">. Vacío si la placa es solo texto/diseño.',
              items: {
                type: 'object',
                properties: {
                  slot: { type: 'string', description: 'ej. "slot1" (debe coincidir con src="FOTO:slot1").' },
                  prompt: { type: 'string', description: 'Descripción fotográfica (fotorrealista, cálida, on-brand; NUNCA instalaciones).' },
                  aspect: { type: 'string' },
                  recortar: { type: 'boolean', description: 'true = CUTOUT (mascota recortada, PNG transparente) para asomándose/recortada sobre el color; false para full-bleed o panel.' },
                },
                required: ['slot', 'prompt'],
              },
            },
            url: { type: 'string', description: 'Si modo=reuse: URL EXACTA del banco.' },
            prompt: { type: 'string', description: 'Si modo=nueva: descripción fotográfica detallada (fotorrealista, CÁLIDA y on-brand: una mascota viva tranquila/feliz o un tutor con su mascota). NUNCA fotos ejecutivas/corporativas/de oficina/financieras; NUNCA instalaciones.' },
            alt: { type: 'string' },
            descripcion: { type: 'string', description: 'Si modo=nueva: 1 línea para el banco.' },
            tags: { type: 'string', description: 'Si modo=nueva: palabras clave separadas por coma.' },
            grupo: { type: 'string', enum: ['mascotas', 'personas', 'productos', 'otro'], description: 'Si modo=nueva. NUNCA "instalaciones".' },
            aspect: { type: 'string', description: 'Relación de aspecto, ej. "1:1", "4:5". En Instagram SIEMPRE "4:5" (vertical, se ve bien en el perfil). En un carrusel usa el MISMO aspecto en TODAS (Instagram recorta según la primera).' },
          },
          required: ['modo'],
        },
      },
    },
    required: ['caption'],
  },
}

async function generarPiezaSocial(item: ItemCalendario, creadoPor?: string, opts: { soloImagen?: boolean } = {}): Promise<{ cuerpo: string; imagenUrl: string; imagenId: string; imagenesJson: string; estiloJson: string; avisos: string[] }> {
  const puedeGenerar = isNanoBananaConfigurado()
  const [contacto, banco, memoria] = await Promise.all([
    getContacto(),
    listarImagenes().catch(() => [] as ImagenBanco[]),
    memoriaVariedad(item.id),
  ])
  const web = contacto.web?.startsWith('http') ? contacto.web : `https://${contacto.web || 'crematorioalmaanimal.cl'}`
  const voz = VOZ_AUDIENCIA[item.audiencia] || VOZ_AUDIENCIA.ambos
  const canalHint = CANAL_HINT[item.canal] || ''

  // Modo "solo imagen": conserva el copy actual y diseña imágenes NUEVAS y distintas
  // (misma cantidad). Veta las fotos que la pieza usa hoy para forzar variedad.
  let notaSoloImagen = ''
  if (opts.soloImagen) {
    let nActual = 1
    try { const a = JSON.parse(item.imagenes_json || '[]'); if (Array.isArray(a) && a.length) nActual = a.length } catch { /* */ }
    let actualTxt = ''
    try {
      const e = JSON.parse(item.estilo || '{}') as { fotos?: string[]; portada?: string }
      for (const f of e.fotos || []) memoria.fotosUsadas.add(f)
      if (e.portada) actualTxt = ` (la actual usa: ${e.portada})`
    } catch { /* */ }
    notaSoloImagen = `\n\n⚠️ MODO SOLO-IMAGEN: EL COPY YA ESTÁ DECIDIDO Y NO SE CAMBIA. Devolvé EXACTAMENTE este mismo texto en "caption", sin tocar ni una palabra:\n«${(item.cuerpo || '').trim()}»\nTu ÚNICA tarea es diseñar la(s) IMAGEN(es): hacelas NUEVAS y CLARAMENTE DISTINTAS a las actuales${actualTxt} — otra plantilla/layout, otra foto, otro fondo. Entregá ${nActual} imagen(es) (la misma cantidad que ahora).`
  }

  const system = `Eres community manager senior del **Crematorio Alma Animal** (cremación de mascotas, Recoleta, Santiago de Chile; cobertura RM; lema "Huellas que no se borran"). Redactas un post orgánico para ${item.canal === 'facebook' ? 'Facebook' : 'Instagram'}.

${voz}

CANAL — ${canalHint}

REGLAS:
- Español neutro de Chile. NUNCA voseo argentino. Sin humor, sin religión, sin clichés del rubro.
- NUNCA inventes precios, promociones, plazos ni datos que no estén en la idea entregada.
- La marca: paleta azul ${BRAND.navy}, dorado ${BRAND.amber}; cercana, confiable, respetuosa.
- Contacto si hace falta un CTA: ${web} · ${contacto.telefono}.

${MARCA_VISUAL}

${MARCA_GRAFICO}

IMÁGENES (campo "imagenes", EN ORDEN) — OBLIGATORIO:
- Una pieza social SIEMPRE lleva imagen(es). Instagram NO se puede publicar sin imagen. POR DEFECTO un POST = UNA sola imagen (un buen diseño con título + hasta 3 bullets alcanza de sobra). Hacé un CARRUSEL (2 a ${MAX_IMGS}) SOLO si el dueño lo pidió explícitamente (carrusel / varias láminas / paso a paso) o si la idea es claramente una SERIE o secuencia de pasos. Ante la duda, UNA imagen. NO infles un pedido simple en varias láminas.
- RESPETÁ EL ALCANCE PEDIDO: si el pedido es SIMPLE, corto o "un post", entregá UNA imagen limpia con copy BREVE; no agregues slides, ni más bullets/datos de los necesarios, ni copy largo.
- VARIEDAD ante todo (es la queja del dueño, textual: "todas son muy iguales, muy azules, muy recicladas"). Las marcas buenas del rubro usan MUCHA foto real (mascota viva, feliz o serena) y MUCHOS layouts distintos. Somos un crematorio, pero el feed debe verse VIVO, cálido y bonito — de vez en cuando un post puramente estético (foto protagonista) que embellezca el perfil. NO repitas el molde ni el fondo de las últimas piezas.
- En cada imagen DECLARÁ "layout" y "fondo" (se guardan como memoria para que la próxima pieza no repita).
- Modos por imagen (PREFERÍ SIEMPRE "plantilla"):
  · "plantilla" = una PLANTILLA MAESTRA on-brand (ver "PLANTILLAS DISPONIBLES"): elegís la plantilla (portada/contenido/dato/foto/cierre) y llenás sus SLOTS con textos CORTOS. El layout, el encuadre, la marca y el logo salen de código PROBADO — NO se encima ni se rompe. Es lo que debés usar para CASI TODO (portadas, láminas de carrusel, datos, cierres). Las fotos van dentro de la plantilla (slot foto: "prompt" para una nueva, o "url" del banco para reutilizar). Variá la plantilla y el fondo entre piezas.
  · "grafico" = HTML de diseño LIBRE (ver "DISEÑO DE GRÁFICOS CON TEXTO"). Es MÁS FRÁGIL porque lo armás vos: usalo SOLO si ninguna plantilla calza con lo que necesitás.
  · "reuse" = usar una FOTO del banco (URL exacta) como imagen completa de la slide — NUNCA una marcada "USADA en las últimas piezas".
  · "nueva" = generar una FOTO nueva (cálida: mascota viva tranquila/feliz, o un tutor con su mascota; variá especie/raza/escena) SIN texto. NUNCA fotos de oficina/financieras; NUNCA instalaciones. (Para una foto CON texto encima, usá la plantilla "foto".)
- B2B (clínicas/veterinarios): igual va con fotos cálidas (mascota viva, atención cercana) + diseño on-brand; el profesionalismo se transmite con el diseño, NO con placas frías de puro texto ni stock de oficina.
- Carrusel: portada con una FOTO potente + gancho cuando se pueda → slides que MEZCLAN foto y datos VARIANDO el layout (no todas iguales) → cierre con CTA + contacto. Mismo aspecto en TODAS (Instagram: SIEMPRE 4:5; Facebook: 1:1 o 4:5). Si numerás pasos, badge IDÉNTICO en todas.
${puedeGenerar ? '' : '- (Generación de FOTOS nuevas no disponible ahora: REUTILIZÁ fotos del banco + placas; igual DEBE llevar imágenes y variar el layout.)\n'}
Devuelve SIEMPRE con la herramienta "entregar_post", con el copy Y las imágenes.`

  const instruccion = [
    `OBJETIVO: ${item.objetivo || '(general)'}`,
    `FECHA PLANIFICADA: ${item.fecha}`,
    item.titulo && `GANCHO/TÍTULO SUGERIDO: ${item.titulo}`,
    `IDEA A COMUNICAR:\n${item.idea}`,
    item.notas && `NOTAS: ${item.notas}`,
  ].filter(Boolean).join('\n\n') + notaSoloImagen

  // REGLAS_INVIOLABLES al INICIO y al FINAL (máxima saliencia; evita lost-in-the-middle).
  const systemBlocks: Anthropic.TextBlockParam[] = [
    { type: 'text', text: REGLAS_INVIOLABLES },
    { type: 'text', text: system },
    { type: 'text', text: PLANTILLAS_INFO },
    { type: 'text', text: GUIA_SOCIAL },
    { type: 'text', text: DIFERENCIADORES },
    { type: 'text', text: MODALIDADES_SERVICIOS },
    { type: 'text', text: bancoBloque(banco, memoria.fotosUsadas) },
    ...(bloqueLogosPieza(banco) ? [{ type: 'text' as const, text: bloqueLogosPieza(banco) }] : []),
    ...(memoria.bloque ? [{ type: 'text' as const, text: memoria.bloque }] : []),
    { type: 'text', text: REGLAS_INVIOLABLES },
  ]

  const avisos: string[] = []
  // AUTO-RECHAZO + reintento: si el linter determinista detecta violaciones de marca
  // (compañero, cámara certificada, teléfono que no coincide, glifos rotos), se le
  // devuelve el hallazgo al modelo y se regenera (hasta 3 intentos). Así lo binario no
  // depende de que el modelo recuerde la regla.
  const convo: Anthropic.MessageParam[] = [{ role: 'user', content: instruccion }]
  let out: SalidaPost | null = null
  let cuerpo = ''
  for (let intento = 0; intento < 3; intento++) {
    const res = await getClient().messages.create({
      model: MODEL,
      max_tokens: 16000, // Copy + el HTML de VARIAS placas (verboso) → margen amplio para no truncar.
      system: systemBlocks,
      tools: [TOOL_POST],
      tool_choice: { type: 'tool', name: 'entregar_post' },
      messages: convo,
    })
    const tu = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === 'entregar_post')
    if (!tu) throw new Error('El modelo no devolvió el post')
    out = tu.input as SalidaPost
    cuerpo = (out.caption || '').trim()
    const placaTextos = (out.imagenes || [])
      .filter(im => im.modo === 'grafico' && (im.html || '').trim())
      .map(im => extraerTextoHtml(String(im.html)))
    const hallazgos = lintCopy({ caption: opts.soloImagen ? undefined : cuerpo, placas: placaTextos, telefono: contacto.telefono, web })
    // Regla del dueño: en Instagram TODO va 4:5 vertical (el render usa las dimensiones
    // del root del HTML, así que se valida acá y se regenera con feedback si no cumple).
    if (item.canal === 'instagram') {
      ;(out.imagenes || []).forEach((im, i) => {
        if (im.modo === 'grafico' && (im.html || '').trim()) {
          const st = /<div[^>]*style\s*=\s*"([^"]*)"/i.exec(String(im.html))?.[1] || ''
          const w = parseInt(/\bwidth:\s*(\d+)px/i.exec(st)?.[1] || '', 10)
          const h = parseInt(/\bheight:\s*(\d+)px/i.exec(st)?.[1] || '', 10)
          if (w && h && Math.abs(w / h - 4 / 5) > 0.02) {
            hallazgos.push({ campo: `imagen ${i + 1}`, problema: `En Instagram TODAS las imágenes van en 4:5 VERTICAL: el root de la placa debe ser 1080x1350px (el tuyo es ${w}x${h}). Rediseñá el layout para ese lienzo.` })
          }
        } else if ((im.modo === 'nueva' || im.modo === 'reuse') && (im.aspect || '4:5') !== '4:5') {
          hallazgos.push({ campo: `imagen ${i + 1}`, problema: 'En Instagram TODAS las imágenes van en aspect "4:5" (vertical).' })
        }
      })
    }
    if (hallazgos.length === 0) break
    if (intento === 2) {
      avisos.push('Tras reintentar, la pieza aún podría tener problemas de marca: ' + hallazgos.map(h => `${h.campo}: ${h.problema}`).join('; '))
      break
    }
    convo.push({ role: 'assistant', content: res.content })
    convo.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: tu.id, content: 'RECHAZADO por reglas de marca. Corregí EXACTAMENTE esto y volvé a entregar con entregar_post (mantené el resto igual):\n- ' + hallazgos.map(h => `[${h.campo}] ${h.problema}`).join('\n- ') }] })
  }
  if (!out) throw new Error('El modelo no devolvió el post')
  // En modo solo-imagen se conserva el copy actual (el caption del modelo se ignora).
  if (opts.soloImagen) cuerpo = (item.cuerpo || cuerpo).trim()
  if (!cuerpo) throw new Error('El modelo no devolvió el texto del post')
  // Instagram (carrusel) y Facebook (álbum) admiten hasta MAX_IMGS imágenes.
  const tope = MAX_IMGS
  const specs = (out.imagenes || []).slice(0, tope)
  const esCarrusel = specs.length > 1
  // COHERENCIA DEL CARRUSEL: todas las imágenes comparten el MISMO aspecto (IG
  // recorta el carrusel según la primera), y las imágenes nuevas usan la primera
  // imagen generada como REFERENCIA para mantener sujeto/estilo/paleta entre slides.
  // Instagram va SIEMPRE en 4:5 vertical (regla del dueño: se ve bien en el perfil).
  const aspectoForzado = item.canal === 'instagram' ? '4:5' : (esCarrusel ? (specs[0]?.aspect || '1:1') : undefined)
  let nuevasUsadas = 0
  // Toda la pieza comparte UN código de campaña (C-X); cada imagen nueva queda C-X.Y.
  // Se reserva perezosamente (solo si se genera al menos una imagen nueva).
  let campania = ''
  let refImagen: { data: Buffer; mime: string } | null = null
  // Secuencial (no Promise.all): para poder encadenar la imagen de referencia.
  const resueltas: ImagenResuelta[] = []
  // MEMORIA DE VARIEDAD: estilo declarado por imagen (alineado con `resueltas`) y
  // fotos del banco que la pieza terminó usando (reuse directo o dentro de una placa).
  const estilos: { layout: string; fondo: string }[] = []
  const fotosDelBanco = new Set<string>()
  const { blanco: logoBlanco, navy: logoNavy } = resolverLogos(banco)
  for (const sp of specs) {
    // PLANTILLA MAESTRA (preferido): el layout sale de código probado, no del modelo.
    if (sp.modo === 'plantilla' && sp.plantilla) {
      try {
        if (!campania) campania = await asignarCampania()
        const formato = aspectoAFormato(aspectoForzado || sp.aspect)
        const { html, fotos } = construirPlantilla(sp.plantilla, sp.slots || {}, { formato, logoBlanco, logoNavy })
        const g = await generarGraficoMarca({ formato, html, fotos, creadoPor, campania })
        resueltas.push({ url: g.url, alt: sp.alt || '', id: '', grafico: true })
        estilos.push({ layout: `plantilla:${sp.plantilla}`, fondo: sp.slots?.fondo || (sp.slots?.foto ? 'foto' : 'navy') })
        for (const b of banco) { if (!esLogo(b) && b.url && html.includes(b.url)) fotosDelBanco.add(b.url) }
        avisos.push(...g.avisos)
      } catch (e) {
        avisos.push(`No se pudo generar la plantilla ${sp.plantilla}: ${e instanceof Error ? e.message : String(e)}`)
      }
      continue
    }
    if (sp.modo === 'reuse' && sp.url) {
      const m = banco.find(b => b.url === sp.url)
      resueltas.push({ url: sp.url, alt: sp.alt || m?.alt || m?.descripcion || '', id: m?.id || '' })
      estilos.push({ layout: sp.layout || 'foto_banco', fondo: sp.fondo || 'foto' })
      fotosDelBanco.add(sp.url)
      continue
    }
    // PLACA DE MARCA (satori): no cuesta como una foto IA → es lo más usado en carruseles.
    if (sp.modo === 'grafico' && (sp.html || '').trim()) {
      try {
        if (!campania) campania = await asignarCampania()
        const fotos = (sp.fotos || []).filter(ff => ff?.slot && ff?.prompt).map(ff => ({ slot: String(ff.slot), prompt: String(ff.prompt), aspect: ff.aspect, recortar: ff.recortar }))
        if (fotos.length && !puedeGenerar) avisos.push('Una placa pedía fotos pero la generación no está disponible; va sin ellas.')
        const g = await generarGraficoMarca({
          formato: aspectoAFormato(aspectoForzado || sp.aspect),
          html: String(sp.html),
          fotos,
          creadoPor,
          campania,
        })
        resueltas.push({ url: g.url, alt: sp.alt || '', id: '', grafico: true })
        estilos.push({ layout: sp.layout || 'placa_texto', fondo: sp.fondo || '?' })
        for (const b of banco) { if (!esLogo(b) && b.url && String(sp.html).includes(b.url)) fotosDelBanco.add(b.url) }
        avisos.push(...g.avisos)
      } catch (e) {
        avisos.push(`No se pudo generar una placa: ${e instanceof Error ? e.message : String(e)}`)
      }
      continue
    }
    if (sp.modo === 'nueva' && sp.prompt) {
      if (['instalaciones', 'marca'].includes((sp.grupo || '').toLowerCase())) {
        avisos.push('Se omitió una imagen de instalaciones/marca (esas solo se reutilizan del banco).')
        continue
      }
      if (!puedeGenerar) {
        avisos.push('El modelo pidió una imagen nueva pero la generación no está disponible (falta GEMINI_API_KEY).')
        continue
      }
      if (nuevasUsadas >= MAX_NUEVAS) {
        avisos.push(`Se omitieron imágenes nuevas por el tope de ${MAX_NUEVAS} por pieza.`)
        continue
      }
      nuevasUsadas++
      try {
        if (!campania) campania = await asignarCampania()
        const r = await generarYGuardarImagen({
          prompt: sp.prompt, alt: sp.alt,
          descripcion: sp.descripcion || sp.alt || '',
          tags: [sp.tags, sp.descripcion || sp.alt].filter(Boolean).join(', '), grupo: sp.grupo || 'otro',
          subgrupo: (item.titulo || item.idea || '').slice(0, 60),
          aspect: aspectoForzado || sp.aspect || '1:1',
          referencias: refImagen ? [refImagen] : undefined,
          creadoPor,
          campania,
        })
        resueltas.push({ url: r.imagen.url, alt: r.imagen.alt || '', id: r.imagen.id })
        estilos.push({ layout: sp.layout || 'foto_protagonista', fondo: sp.fondo || 'foto' })
        // La primera imagen (limpia) queda como referencia visual de las siguientes.
        if (!refImagen) refImagen = { data: r.buffer, mime: r.mime }
      } catch (e) {
        avisos.push(`No se pudo generar una imagen: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
  }
  if (resueltas.length === 0 && (item.canal === 'instagram' || item.canal === 'facebook')) {
    avisos.push(specs.length === 0
      ? 'La pieza quedó SIN imagen (el modelo no devolvió ninguna). Una pieza social necesita al menos una; probá regenerar.'
      : 'No se pudo resolver ninguna imagen del post.')
  }
  // Degradar a imagen simple si el carrusel quedó con menos de 2 imágenes.
  if (esCarrusel && resueltas.length < 2) {
    avisos.push('El post se planificó como carrusel pero quedó con menos de 2 imágenes; se publicará como imagen simple. Revisá el copy si invitaba a "deslizar".')
  }

  // LOGO DE MARCA (paso de cierre): toda pieza que se publica lleva el logo. En post
  // simple va en la imagen; en carrusel va SOLO en la ÚLTIMA (al final). Se estampa
  // sobre las FOTOS; las PLACAS ya vienen branded (con su logo), no se re-estampan.
  if (resueltas.length > 0) {
    const idx = resueltas.length === 1 ? 0 : resueltas.length - 1
    if (!resueltas[idx].grafico) {
      try {
        const conLogo = await estamparLogoEnUrl(resueltas[idx].url, banco)
        resueltas[idx] = { ...resueltas[idx], url: conLogo }
      } catch (e) {
        avisos.push('No se pudo agregar el logo a la imagen: ' + (e instanceof Error ? e.message : String(e)))
      }
    }
  }

  // QA con VISIÓN (Bloque C): revisa el render REAL, autocorrige lo OBJETIVO de placas
  // (re-edita su HTML y re-renderiza, misma campaña; cap 3) y escala el resto como aviso.
  // BEST-OF: tras corregir, VUELVE a mirar el render; si la corrección EMPEORÓ la slide
  // (el bug que shippeaba C-51.4, peor que un intermedio), revierte a la versión previa.
  // Higiene: la versión descartada de cada slide se des-registra del banco.
  if (resueltas.length > 0) {
    try {
      const pass1 = await qaPieza(resueltas, item)
      const original = resueltas.map(r => ({ ...r }))   // snapshot pre-corrección
      const corregidas = new Set<number>()
      let correcciones = 0
      for (const p of pass1) {
        const i = (p.slide >= 1 && p.slide <= resueltas.length) ? p.slide - 1 : -1
        const autocorr = i >= 0 && p.objetivo && p.severidad !== 'baja' && !!p.correccion?.trim()
          && resueltas[i].grafico && correcciones < 3 && !corregidas.has(i)
        if (autocorr) {
          const design = await cargarDisenoGrafico(resueltas[i].url)
          if (design) {
            try {
              let { html: nuevoHtml, fotos } = await editarPlacaHtml(design.html, p.correccion!.trim())
              // La corrección del QA TAMBIÉN pasa por el linter: el pase inicial ya
              // filtró tildes/términos, y una edición no puede volver a introducirlos
              // (nos pasó: el QA "arregló" una slide y metió "dias"/"rapida" sin tilde).
              let lintQA = lintCopy({ placas: [extraerTextoHtml(nuevoHtml)], telefono: contacto.telefono, web })
              if (lintQA.length) {
                ;({ html: nuevoHtml, fotos } = await editarPlacaHtml(nuevoHtml, `Corregí SOLO esto, sin tocar nada más del diseño: ${lintQA.map(h => h.problema).join(' ')}`))
                lintQA = lintCopy({ placas: [extraerTextoHtml(nuevoHtml)], telefono: contacto.telefono, web })
              }
              if (lintQA.length) throw new Error('la corrección del QA no pasó el linter de marca')
              const g = await generarGraficoMarca({ formato: design.formato, html: nuevoHtml, fotos, creadoPor, campania: campania || undefined })
              resueltas[i] = { ...resueltas[i], url: g.url, grafico: true }
              corregidas.add(i)
              correcciones++
              continue
            } catch { /* cae a aviso */ }
          }
        }
        if (p.severidad === 'alta' || (p.severidad === 'media' && !p.objetivo)) {
          avisos.push(`QA (slide ${p.slide}, ${p.tipo}): ${p.detalle}${p.objetivo ? '' : ' — revisá si te convence'}`)
        }
      }

      // BEST-OF: re-verificar SOLO si hubo correcciones. Se compara la severidad de la
      // slide antes/después; si empeoró, se vuelve a la original. La perdedora se limpia.
      const descartar: string[] = []
      if (corregidas.size > 0) {
        const pass2 = await qaPieza(resueltas, item)
        const sev = (probs: QAProblema[], slide0: number) => probs
          .filter(p => p.slide === slide0 + 1)
          .reduce((s, p) => s + (p.severidad === 'alta' ? 3 : p.severidad === 'media' ? 2 : 1) + (p.objetivo ? 1 : 0), 0)
        for (const i of corregidas) {
          const corregidaUrl = resueltas[i].url
          if (sev(pass2, i) > sev(pass1, i)) {
            // La corrección empeoró la slide → volver a la versión original.
            resueltas[i] = original[i]
            descartar.push(corregidaUrl)
            avisos.push(`QA: la corrección de la slide ${i + 1} no mejoró el render; mantuve la versión original.`)
          } else {
            descartar.push(original[i].url)   // la corrección quedó → limpiar la vieja
            avisos.push(`QA: corregí la slide ${i + 1}.`)
          }
        }
      }
      // Higiene: des-registrar del banco las versiones que NO quedaron en la pieza.
      const finales = new Set(resueltas.map(r => r.url))
      for (const u of descartar) if (u && !finales.has(u)) { try { await eliminarImagenPorUrl(u) } catch { /* best-effort */ } }
    } catch { /* QA best-effort: si falla, la pieza igual se entrega */ }
  }

  const imagenUrl = resueltas[0]?.url || ''
  const imagenId = resueltas[0]?.id || ''
  const imagenesJson = resueltas.length > 1 ? JSON.stringify(resueltas.map(r => ({ url: r.url, alt: r.alt }))) : ''
  // Estilo de la pieza (memoria de variedad para las próximas generaciones).
  const estiloJson = resueltas.length > 0 ? JSON.stringify({
    portada: `${estilos[0]?.layout || '?'}/${estilos[0]?.fondo || '?'}`,
    fondos: estilos.map(e => e.fondo),
    fotos: [...fotosDelBanco],
  }) : ''
  return { cuerpo, imagenUrl, imagenId, imagenesJson, estiloJson, avisos }
}

export interface PiezaGenerada {
  item: ItemCalendario
  avisos: string[]
}

/** Genera la pieza de un ítem del calendario y actualiza la fila a estado=generada. */
export async function generarPieza(id: string, creadoPor?: string): Promise<PiezaGenerada> {
  const item = await obtenerItem(id)
  if (!item) throw new Error(`ítem ${id} no encontrado`)

  if (item.canal === 'email') {
    const categoria = mapCategoriaEmail(item.objetivo)
    const instruccion = [item.idea, item.titulo && `Título/gancho sugerido: ${item.titulo}`, item.notas && `Notas: ${item.notas}`]
      .filter(Boolean).join('\n')
    const camp = await generarCampana({ instruccion, categoria, creadoPor })
    const avisos = [...camp.avisos]
    if (item.audiencia === 'tutores') {
      avisos.push('El email solo llega a la base de veterinarios (B2B). Este ítem está marcado para tutores: se generó el contenido, pero no hay base de email de tutores para enviarlo. Para llegar a tutores usá Instagram/Facebook.')
    }
    // Cerrar el flujo: dejar un borrador real en Mail para poder enviarlo.
    let campanaId = item.campana_id
    try {
      campanaId = await materializarBorradorEmail({
        asunto: camp.asunto, preview: camp.preview_text, html: camp.html, categoria,
        creadoPor, existingId: item.campana_id || undefined,
      })
    } catch (e) {
      avisos.push('No se pudo crear el borrador en Mail automáticamente: ' + (e instanceof Error ? e.message : String(e)))
    }
    const primera = camp.imagenes[0]
    const item2 = await actualizarItem(id, {
      titulo: camp.asunto,
      cuerpo: camp.html,
      imagen_url: primera?.url || '',
      imagen_id: primera?.id || '',
      campana_id: campanaId,
      estado: item.estado === 'propuesta' ? 'generada' : item.estado,
      generado_por: 'ia',
    })
    return { item: item2, avisos }
  }

  // social (instagram | facebook)
  const { cuerpo, imagenUrl, imagenId, imagenesJson, estiloJson, avisos } = await generarPiezaSocial(item, creadoPor)
  const item2 = await actualizarItem(id, {
    cuerpo,
    imagen_url: imagenUrl,
    imagen_id: imagenId,
    imagenes_json: imagenesJson,
    estilo: estiloJson,
    estado: item.estado === 'propuesta' ? 'generada' : item.estado,
    generado_por: 'ia',
  })
  return { item: item2, avisos }
}

/**
 * AJUSTE INCREMENTAL de un correo ya generado: conserva el HTML actual y aplica SOLO
 * el cambio pedido (ej. "meté la tabla de precios", "cambiá el CTA"), sin rehacerlo de
 * cero. Reusa la edición incremental que ya soporta generarCampana (actual + comentario).
 * Solo aplica a email. Para eso el generador ahora recibe las tarifas reales, así que
 * "meté la tabla de precios" funciona con las cifras vigentes.
 */
export async function ajustarPiezaEmail(id: string, comentario: string, creadoPor?: string): Promise<PiezaGenerada> {
  const item = await obtenerItem(id)
  if (!item) throw new Error(`ítem ${id} no encontrado`)
  if (item.canal !== 'email') throw new Error('Esto aplica solo a piezas de email.')
  if (!item.cuerpo?.trim()) throw new Error('El correo todavía no está generado. Generalo primero con "generar_pieza".')
  if (!comentario?.trim()) throw new Error('Falta indicar qué ajustar en el correo.')

  const categoria = mapCategoriaEmail(item.objetivo)
  // preview_text vive en la campaña materializada; si no está, va vacío (el generador lo rehace).
  let preview = ''
  if (item.campana_id) {
    try {
      const rows = await getSheetData('mailing_campanas')
      preview = rows.find(r => String(r.id) === String(item.campana_id))?.preview_text || ''
    } catch { /* best-effort */ }
  }

  const camp = await generarCampana({
    instruccion: item.idea || item.titulo || 'Ajuste del correo',
    categoria, creadoPor,
    actual: { asunto: item.titulo || '', preview_text: preview, html: item.cuerpo },
    comentario: comentario.trim(),
  })
  const avisos = [...camp.avisos]
  let campanaId = item.campana_id
  try {
    campanaId = await materializarBorradorEmail({
      asunto: camp.asunto, preview: camp.preview_text, html: camp.html, categoria,
      creadoPor, existingId: item.campana_id || undefined,
    })
  } catch (e) {
    avisos.push('No se pudo actualizar el borrador en Mail: ' + (e instanceof Error ? e.message : String(e)))
  }
  const primera = camp.imagenes[0]
  const item2 = await actualizarItem(id, {
    titulo: camp.asunto,
    cuerpo: camp.html,
    ...(primera ? { imagen_url: primera.url, imagen_id: primera.id } : {}),
    campana_id: campanaId,
    generado_por: 'ia',
  })
  return { item: item2, avisos }
}

/**
 * "Misma copy, imagen nueva": conserva el COPY tal cual y regenera SOLO la imagen
 * (desde cero, con plantilla, distinta a la actual). Para cuando el texto está bien
 * pero la imagen no convence. No toca el estado. Solo aplica a social (IG/FB).
 */
export async function regenerarImagenPieza(id: string, creadoPor?: string): Promise<PiezaGenerada> {
  const item = await obtenerItem(id)
  if (!item) throw new Error(`ítem ${id} no encontrado`)
  if (item.canal === 'email') throw new Error('Esto aplica a piezas de Instagram/Facebook, no a email.')
  if (!item.cuerpo?.trim()) throw new Error('La pieza todavía no tiene copy. Generala primero con "Generar".')
  const { imagenUrl, imagenId, imagenesJson, estiloJson, avisos } = await generarPiezaSocial(item, creadoPor, { soloImagen: true })
  const item2 = await actualizarItem(id, {
    imagen_url: imagenUrl,
    imagen_id: imagenId,
    imagenes_json: imagenesJson,
    estilo: estiloJson,
    // NO se toca ni el cuerpo (copy) ni el estado.
  })
  return { item: item2, avisos }
}

async function refDesdeUrl(url: string): Promise<{ data: Buffer; mime: string } | null> {
  try {
    const r = await fetch(url)
    if (!r.ok) return null
    return { data: Buffer.from(await r.arrayBuffer()), mime: r.headers.get('content-type') || 'image/jpeg' }
  } catch { return null }
}

/** Campaña (C-X) de una pieza, a partir del código de sus imágenes en el banco. */
function campaniaDePieza(urls: string[], banco: ImagenBanco[]): string | undefined {
  for (const u of urls) {
    const b = banco.find(x => x.url === u)
    const m = b && /^(C-\d+)\./.exec(b.codigo || '')
    if (m) return m[1]
  }
  return undefined
}

/** Aplica un cambio puntual al HTML de una placa (satori) vía el modelo; devuelve el HTML nuevo. */
const TOOL_EDIT_PLACA: Anthropic.Tool = {
  name: 'entregar_placa',
  description: 'Devuelve el HTML completo de la placa editada y, si el cambio pide agregar/cambiar una FOTO, las fotos a generar e incrustar.',
  input_schema: {
    type: 'object',
    properties: {
      html: { type: 'string', description: 'HTML COMPLETO de la placa, listo para rasterizar con satori. Mantené estructura, marca, fuentes y colores; cambiá SOLO lo pedido.' },
      fotos: {
        type: 'array',
        description: 'Fotos a GENERAR e incrustar. Incluila SOLO si el cambio pide agregar/cambiar una foto. Cada una se referencia en el HTML como <img src="FOTO:slot" .../>.',
        items: {
          type: 'object',
          properties: {
            slot: { type: 'string', description: 'Identificador corto (ej. "principal"); debe coincidir EXACTO con el src="FOTO:slot" del HTML.' },
            prompt: { type: 'string', description: 'Prompt fotorealista, on-brand, SIN texto incrustado (perro/gato y/o tutor; luz cálida y sobria).' },
            recortar: { type: 'boolean', description: 'true si va recortada sobre fondo transparente (mascota asomándose); false = foto rectangular/full-bleed.' },
          },
          required: ['slot', 'prompt'],
        },
      },
    },
    required: ['html'],
  },
}

async function editarPlacaHtml(html: string, instruccion: string): Promise<{ html: string; fotos: FotoGrafico[] }> {
  // Algunas placas (las generadas con el logo ya incrustado) traen imágenes como data
  // URI base64 ENORMES. El modelo NO debe reescribir ese base64: lo trunca/corrompe y
  // al rasterizar tira "Invalid character". Las enmascaramos con un marcador corto,
  // dejamos que edite el resto, y las restauramos byte a byte.
  const assets: string[] = []
  const htmlSeguro = html.replace(/data:[a-z0-9.+-]+\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+/gi, (m) => {
    const i = assets.length
    assets.push(m)
    return `__ASSET_${i}__`
  })
  const res = await getClient().messages.create({
    model: MODEL,
    max_tokens: 8000, // Edita el HTML de una placa y lo re-emite → margen para no truncar.
    tools: [TOOL_EDIT_PLACA],
    tool_choice: { type: 'tool', name: 'entregar_placa' },
    system: `${REGLAS_INVIOLABLES}\n\nSos diseñador de Crematorio Alma Animal. Te paso el HTML de una PLACA de marca que se rasteriza con satori. Aplicá EXACTAMENTE el cambio pedido manteniendo la estructura, la marca, las fuentes y los colores; cambiá únicamente lo pedido. Devolvés el resultado SOLO con la tool entregar_placa.\n\nREGLAS:\n- Si ves marcadores como __ASSET_0__ (imágenes ya incrustadas, p. ej. el logo), copialos TAL CUAL: no los borres, no los muevas de su <img>, no los reescribas.\n- Si el cambio pide AGREGAR o cambiar una FOTO: reestructurá el layout para que la foto sea protagonista (full-bleed, panel lateral o mascota asomándose, según el menú de layouts), poné un <img src="FOTO:slot" .../> dimensionado con CSS donde va, y devolvé esa foto en "fotos" con un prompt fotorealista on-brand. NO inventes <img> con URLs http: las fotos nuevas SIEMPRE van como FOTO:slot.\n- Conservá el copy/los datos salvo que el cambio pida lo contrario.\n\n${MARCA_GRAFICO}`,
    messages: [{ role: 'user', content: `HTML actual de la placa:\n\`\`\`html\n${htmlSeguro}\n\`\`\`\n\nCAMBIO PEDIDO (solo esto; el resto queda igual): ${instruccion}` }],
  })
  const call = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === 'entregar_placa')
  const input = (call?.input || {}) as { html?: string; fotos?: { slot?: string; prompt?: string; recortar?: boolean }[] }
  // Restaurar los assets enmascarados (intactos). Si el modelo borró algún marcador, el
  // logo se reaplica solo en generarGraficoMarca (no quedó base64 roto en el HTML).
  const editado = (input.html || '').trim()
  const htmlFinal = (editado ? editado.replace(/__ASSET_(\d+)__/g, (_, n) => assets[Number(n)] ?? '') : html)
  const fotos: FotoGrafico[] = Array.isArray(input.fotos)
    ? input.fotos.filter(f => f?.slot && f?.prompt).map(f => ({ slot: String(f.slot), prompt: String(f.prompt), recortar: !!f.recortar }))
    : []
  return { html: htmlFinal, fotos }
}

// ─── QA con VISIÓN (Bloque C) ────────────────────────────────────────────────
// Tras renderizar la pieza, un "director de arte" con visión mira el resultado REAL
// y reporta problemas que el linter de texto no ve (logo ilegible, composición vacía,
// texto cortado, foto ausente, inconsistencia de carrusel). Lo OBJETIVO de placas se
// autocorrige; lo subjetivo se escala al dueño como aviso. Best-effort.
interface QAProblema { slide: number; tipo: string; severidad: 'alta' | 'media' | 'baja'; objetivo: boolean; detalle: string; correccion?: string }

const TOOL_QA: Anthropic.Tool = {
  name: 'reportar_qa',
  description: 'Reporta los problemas de calidad de las imágenes de la pieza (lista vacía si está todo bien).',
  input_schema: {
    type: 'object',
    properties: {
      problemas: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            slide: { type: 'number', description: 'Número de imagen, 1 = primera.' },
            tipo: { type: 'string', description: 'logo | glifo | composicion | texto | foto | dato | consistencia | otro' },
            severidad: { type: 'string', enum: ['alta', 'media', 'baja'] },
            objetivo: { type: 'boolean', description: 'true = problema OBJETIVO y claro (logo ilegible, texto cortado, caja rota, placa vacía); false = criterio/subjetivo.' },
            detalle: { type: 'string', description: 'Qué está mal, concreto.' },
            correccion: { type: 'string', description: 'Si es una PLACA de texto con arreglo de texto/diseño, la instrucción EXACTA para corregirla (ej. "achicá el título para que no se corte"). Vacío si no aplica.' },
          },
          required: ['slide', 'tipo', 'severidad', 'objetivo', 'detalle'],
        },
      },
    },
    required: ['problemas'],
  },
}

async function qaPieza(resueltas: ImagenResuelta[], item: ItemCalendario): Promise<QAProblema[]> {
  const imgs: Anthropic.ImageBlockParam[] = []
  for (const r of resueltas) {
    const ref = await refDesdeUrl(r.url)
    if (ref) {
      const mini = await reducirParaVision(ref.data) // ~768px: menos tokens de visión
      imgs.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: mini.data.toString('base64') } })
    }
  }
  if (imgs.length === 0) return []
  const sys = `Sos director de arte + control de calidad de Crematorio Alma Animal (cremación de mascotas; marca navy/dorado/crema; voz sobria, cálida, profesional). Te paso las ${imgs.length} imágenes de una pieza para ${item.canal} (audiencia ${item.audiencia}), EN ORDEN. Revisalas CRÍTICAMENTE como si se publicaran en la página de un negocio premium. Reportá SOLO problemas REALES que VEAS (no inventes):
- LOGO ilegible/borroso/cortado/desproporcionado o ausente;
- CAJAS o glifos ROTOS (cuadritos, símbolos raros);
- TEXTO cortado, encimado, ilegible o que se sale del lienzo;
- COMPOSICIÓN vacía/desbalanceada — sobre todo una FRANJA de fondo VACÍA arriba o abajo (la placa llena solo parte del lienzo, ej. la mitad superior y el resto vacío): esto es OBJETIVO y GRAVE; o que se ve plana/aburrida;
- FOTO ausente cuando aportaría calidez (todo texto); o FOTO MAL ENCUADRADA (OBJETIVO y grave): la mascota con la CARA/CABEZA/OJOS cortados por el borde, o se ve solo un pedazo del animal (lomo, patas o cuerpo sin rostro), o recorte/calidad fea; o una PERSONA/animal CORTADO POR LA MITAD por el borde del VELO o BLOQUE de color que le cruza el cuerpo y lo deja "partido" entre la foto y el bloque (OBJETIVO y grave: el sujeto debe quedar de un lado y el texto del otro);
- en CARRUSEL: inconsistencia entre slides (badges/logo/fondos sin sistema);
- PALABRAS PEGADAS (dos palabras sin espacio entre medio, ej. "Escríbenosahora") o faltas de ortografía/tildes visibles en una placa — es OBJETIVO y la corrección es reescribir ese texto bien;
- MONOTONÍA de color: TODAS las slides con fondo navy/azul dominante, o una foto tapada por un velo oscuro que la vuelve un afiche azul liso (el dueño pide alternar crema/blanco/foto y que la foto se VEA) — reportalo tipo "composicion";
- errores visibles en el texto.
Marcá cada uno como OBJETIVO (claro y binario) o no. Si es una PLACA de texto con arreglo de texto/diseño, dá la "correccion" exacta. Si está todo bien, problemas: []. Reportá SIEMPRE con reportar_qa.

${GUIA_QA}`
  try {
    const res = await getClient().messages.create({
      model: MODEL, max_tokens: 1500, system: sys,
      tools: [TOOL_QA], tool_choice: { type: 'tool', name: 'reportar_qa' },
      messages: [{ role: 'user', content: [...imgs, { type: 'text', text: `Pieza: "${(item.titulo || item.idea || '').slice(0, 120)}". Revisá las ${imgs.length} imágenes en orden.` }] }],
    })
    const tu = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === 'reportar_qa')
    const out = (tu?.input as { problemas?: QAProblema[] })?.problemas
    return Array.isArray(out) ? out.filter(p => p && p.detalle) : []
  } catch (e) {
    console.warn('[marketing-pieza] QA visión falló:', e instanceof Error ? e.message : e)
    return []
  }
}

/**
 * Ajusta UNA imagen de una pieza social ya generada, preservando el resto.
 *  - Si la slide es una PLACA de marca → edita su HTML y la re-renderiza con satori
 *    (gratis y on-brand), manteniendo la campaña del carrusel.
 *  - Si es una FOTO → edición image-to-image (gemini) de esa sola imagen.
 * `indice` = posición 1-based; en carruseles (2+ imágenes) es OBLIGATORIO: NO edita todas.
 */
export async function editarImagenPieza(id: string, instruccion: string, indice?: number, creadoPor?: string): Promise<PiezaGenerada> {
  if (!instruccion?.trim()) throw new Error('Falta la instrucción de qué ajustar.')
  const item = await obtenerItem(id)
  if (!item) throw new Error(`ítem ${id} no encontrado`)
  if (item.canal === 'email') throw new Error('Esto aplica a piezas de imagen (Instagram/Facebook), no a email.')

  let imgs: { url: string; alt?: string }[] = []
  try { const a = item.imagenes_json ? JSON.parse(item.imagenes_json) : []; if (Array.isArray(a)) imgs = a.filter((x: { url?: string }) => x?.url) } catch { /* fallback abajo */ }
  if (imgs.length === 0 && item.imagen_url) imgs = [{ url: item.imagen_url }]
  if (imgs.length === 0) throw new Error('La pieza no tiene imágenes para editar. Generala primero.')

  // En un carrusel ajustamos SOLO la slide indicada (nunca todas de una).
  if (imgs.length > 1 && !(indice && indice >= 1 && indice <= imgs.length)) {
    throw new Error(`La pieza tiene ${imgs.length} imágenes. Indicá cuál ajustar con "indice" (1 a ${imgs.length}); no se editan todas a la vez.`)
  }
  const ti = (indice && indice >= 1 && indice <= imgs.length) ? indice - 1 : 0
  const urlPrevia = imgs[ti].url

  const avisos: string[] = []
  const banco = await listarImagenes().catch(() => [] as ImagenBanco[])
  // La imagen editada se queda en la MISMA campaña del carrusel (no inventa una nueva).
  const campania = campaniaDePieza(imgs.map(i => i.url), banco) || await asignarCampania()

  const design = await cargarDisenoGrafico(imgs[ti].url)
  if (design) {
    // PLACA → editar el HTML y re-renderizar con satori (gratis, on-brand, misma campaña).
    // Si el cambio pide agregar/cambiar una FOTO, editarPlacaHtml devuelve los FOTO:slot
    // y generarGraficoMarca las genera (gemini) e incrusta.
    try {
      let { html: nuevoHtml, fotos } = await editarPlacaHtml(design.html, instruccion.trim())
      // La placa editada también pasa por el linter (que la edición no meta
      // tildes faltantes/términos prohibidos que la pieza original ya no tenía).
      const contacto = await getContacto()
      const lintEd = lintCopy({ placas: [extraerTextoHtml(nuevoHtml)], telefono: contacto.telefono })
      if (lintEd.length) {
        ;({ html: nuevoHtml, fotos } = await editarPlacaHtml(nuevoHtml, `Corregí SOLO esto, sin tocar nada más del diseño: ${lintEd.map(h => h.problema).join(' ')}`))
      }
      const g = await generarGraficoMarca({ formato: design.formato, html: nuevoHtml, fotos, creadoPor, campania })
      imgs[ti] = { url: g.url, alt: imgs[ti].alt || '' }
      avisos.push(...g.avisos)
    } catch (e) { avisos.push(`No se pudo ajustar la placa ${ti + 1}: ${e instanceof Error ? e.message : 'error'}`) }
  } else {
    // FOTO → edición image-to-image (gemini) de esa sola imagen; re-estampar el logo.
    if (!isNanoBananaConfigurado()) throw new Error('Edición de fotos no disponible (falta GEMINI_API_KEY).')
    const baseRef = await refDesdeUrl(imgs[ti].url)
    if (!baseRef) { avisos.push(`No se pudo leer la imagen ${ti + 1} como referencia.`) }
    else {
      try {
        const r = await generarYGuardarImagen({
          prompt: instruccion.trim(),
          descripcion: (item.titulo || item.idea || 'Imagen de pieza').slice(0, 60),
          tags: 'edicion', grupo: 'otro', subgrupo: (item.titulo || item.idea || '').slice(0, 60),
          editar: true, referencias: [baseRef], creadoPor, campania,
        })
        let url = r.imagen.url
        try { url = await estamparLogoEnUrl(url, banco) } catch { /* best-effort */ }
        imgs[ti] = { url, alt: imgs[ti].alt || '' }
      } catch (e) { avisos.push(`No se pudo regenerar la imagen ${ti + 1}: ${e instanceof Error ? e.message : 'error'}`) }
    }
  }

  // QA de PARIDAD: mirar el render EDITADO; si introdujo un problema objetivo grave
  // (logo/texto cortado, foto mal encuadrada, caja rota), revertir a la versión previa
  // en vez de shippear una edición peor. La versión mala se des-registra del banco.
  if (imgs[ti].url && imgs[ti].url !== urlPrevia) {
    try {
      const probs = await qaPieza([{ url: imgs[ti].url, alt: imgs[ti].alt || '', id: '', grafico: !!design }], item)
      if (probs.some(p => p.objetivo && p.severidad === 'alta')) {
        const mala = imgs[ti].url
        imgs[ti] = { url: urlPrevia, alt: imgs[ti].alt || '' }
        try { await eliminarImagenPorUrl(mala) } catch { /* best-effort */ }
        avisos.push(`Esa edición dejó la imagen ${ti + 1} con un problema visible, así que mantuve la versión anterior. Probá reformular el cambio.`)
      }
    } catch { /* QA best-effort */ }
  }

  const imagenesJson = imgs.length > 1 ? JSON.stringify(imgs.map(x => ({ url: x.url, alt: x.alt || '' }))) : ''
  const item2 = await actualizarItem(id, { imagen_url: imgs[0]?.url || '', imagen_id: '', imagenes_json: imagenesJson })
  return { item: item2, avisos }
}

/** Resuelve códigos del banco a imágenes EN ORDEN. Un código de CAMPAÑA "C-X" trae
 *  TODAS sus C-X.Y ordenadas por Y; un código exacto (i-N, C-X.Y) trae esa imagen. */
function resolverCodigos(codigos: string[], banco: ImagenBanco[]): { url: string; alt: string }[] {
  const out: { url: string; alt: string }[] = []
  const vistos = new Set<string>()
  for (const raw of codigos) {
    const cod = (raw || '').trim()
    if (!cod) continue
    const mCamp = /^C-(\d+)$/i.exec(cod) // campaña entera (sin .Y)
    let matches: ImagenBanco[]
    if (mCamp) {
      const re = new RegExp(`^C-${mCamp[1]}\\.\\d+$`, 'i')
      matches = banco.filter(b => re.test(b.codigo || ''))
        .sort((a, b) => (parseInt(a.codigo.split('.')[1] || '0', 10)) - (parseInt(b.codigo.split('.')[1] || '0', 10)))
    } else {
      matches = banco.filter(b => (b.codigo || '').toLowerCase() === cod.toLowerCase())
    }
    for (const m of matches) {
      if (m.url && !vistos.has(m.url)) { vistos.add(m.url); out.push({ url: m.url, alt: m.alt || m.descripcion || '' }) }
    }
  }
  return out
}

/**
 * Pone en una pieza del calendario imágenes que YA EXISTEN en el banco (sin
 * regenerar nada), resolviendo sus códigos. Sirve para REUTILIZAR las placas/fotos
 * de una campaña en otra publicación o canal (ej. "subí a Facebook las 7 placas de
 * la C-4"): pasá "C-4" (toda la campaña, en orden) o códigos sueltos (i-N, C-X.Y).
 */
export async function setImagenesPieza(id: string, codigos: string[]): Promise<{ item: ItemCalendario; n: number; noEncontrados: string[] }> {
  const item = await obtenerItem(id)
  if (!item) throw new Error(`ítem ${id} no encontrado`)
  if (item.canal === 'email') throw new Error('Esto aplica a piezas de Instagram/Facebook, no a email.')
  const banco = await listarImagenes().catch(() => [] as ImagenBanco[])
  const resueltas = resolverCodigos(codigos, banco)
  const noEncontrados = codigos.map(c => (c || '').trim()).filter(c => c && resolverCodigos([c], banco).length === 0)
  if (resueltas.length === 0) throw new Error(`No encontré imágenes en el banco para esos códigos (${codigos.join(', ')}).`)
  const imagenesJson = resueltas.length > 1 ? JSON.stringify(resueltas) : ''
  // Si ya tiene copy y estaba en "propuesta", pasa a "generada" (lista para publicar).
  const estado = item.cuerpo?.trim() && item.estado === 'propuesta' ? 'generada' : item.estado
  const item2 = await actualizarItem(id, { imagen_url: resueltas[0].url, imagen_id: '', imagenes_json: imagenesJson, estado })
  return { item: item2, n: resueltas.length, noEncontrados }
}
