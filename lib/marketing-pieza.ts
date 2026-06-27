import Anthropic from '@anthropic-ai/sdk'
import { BRAND, getContacto } from './email-layout'
import { MARCA_VISUAL, MARCA_GRAFICO } from './marca-visual'
import { DIFERENCIADORES } from './diferenciadores'
import { listarImagenes, generarYGuardarImagen, estamparLogoEnUrl, asignarCampania, type ImagenBanco } from './mailing-images'
import { generarGraficoMarca } from './marketing-grafico'
import { esLogo } from './marca-logo'
import { isNanoBananaConfigurado } from './nano-banana'
import { generarCampana } from './mailing-generator'
import { obtenerItem, actualizarItem, type ItemCalendario } from './marketing-calendario'
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
 *              imágenes priorizando PLACAS DE MARCA (texto sobre el diseño, vía satori,
 *              sin costo) y la reutilización del banco; genera una FOTO nueva solo como
 *              excepción (momento cálido). NUNCA instalaciones ni stock corporativo.
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

const MODEL = process.env.ANTHROPIC_MAILING_MODEL || 'claude-opus-4-8'
const BANCO_VISIBLE = 40

const VOZ_AUDIENCIA: Record<string, string> = {
  tutores: `AUDIENCIA: TUTORES (B2C), adultos en duelo por su mascota. Voz: tuteo cálido pero sobrio, cercana y humana, profesional. Inspira confianza, NO lástima. Sin clichés del rubro ("puente del arcoíris", "angelito", "ya no sufre"), sin humor, sin religión. A la mascota por su nombre cuando aplique; genérico "tu mascota".`,
  veterinarios: `AUDIENCIA: VETERINARIOS / CLÍNICAS (B2B). Voz: profesional, técnica, eficiente, de socio confiable (datos, plazos, procesos). Cercana pero sobria. Comunica diferenciadores: instalaciones propias, trazabilidad, retiro desde la clínica, entrega en 3 días hábiles, red de eutanasia a domicilio.`,
  ambos: `AUDIENCIA: MIXTA (tutores y veterinarios). Voz cercana y profesional, español neutro de Chile. Sin clichés del rubro, sin humor, sin religión.`,
}

const CANAL_HINT: Record<string, string> = {
  instagram: 'Instagram (feed): copy breve y con gancho, 1-3 frases potentes, salto de línea entre ideas, y 5-12 hashtags relevantes al final (mezcla marca + nicho mascotas/Chile). Emojis con MUCHA moderación (a lo sumo una huellita 🐾). Instagram admite CARRUSEL (varias imágenes que el usuario desliza).',
  facebook: 'Facebook (Página): copy un poco más extenso que IG, 2-4 frases, puede incluir un llamado a la acción y el sitio web. Pocos o ningún hashtag. Sin emojis tristes. (Se publica con una sola imagen.)',
}

/** Tope de imágenes por pieza y de imágenes NUEVAS a generar (control de costo). */
const MAX_IMGS = 10
const MAX_NUEVAS = 10

interface EspecieImagen {
  modo?: 'reuse' | 'nueva' | 'grafico'
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
  fotos?: { slot?: string; prompt?: string; aspect?: string }[]
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

function bancoBloque(banco: ImagenBanco[]): string {
  if (banco.length === 0) return 'BANCO DE IMÁGENES: (vacío — no hay imágenes para reutilizar).'
  const lineas = banco.slice(0, BANCO_VISIBLE).map(b => {
    const desc = b.descripcion || b.alt || b.prompt || '(sin descripción)'
    const grupo = b.grupo ? ` | grupo: ${b.grupo}` : ''
    const tags = b.tags ? ` | tags: ${b.tags}` : ''
    return `- URL: ${b.url}\n  ${desc}${grupo}${tags}`
  }).join('\n')
  return `BANCO DE IMÁGENES PARA REUTILIZAR (revísalo SIEMPRE primero; reutiliza si alguna calza):\n${lineas}`
}

const TOOL_POST: Anthropic.Tool = {
  name: 'entregar_post',
  description: 'Entrega el copy del post y sus imágenes EN ORDEN (1 imagen = post simple; 2 a 8 = carrusel para Instagram). Cada imagen se reutiliza del banco o se genera nueva.',
  input_schema: {
    type: 'object',
    properties: {
      caption: { type: 'string', description: 'Texto del post listo para publicar (incluye hashtags si corresponde al canal). Si es carrusel, el copy puede invitar a deslizar.' },
      imagenes: {
        type: 'array',
        description: 'Imágenes del post EN ORDEN. 1 imagen = post simple. Para Instagram puedes hacer un CARRUSEL con 2 a 8 imágenes coherentes entre sí. Para Facebook usa solo 1. Vacío si no hay imagen. Lo más usado es "grafico" (placa de marca); las fotos nuevas son la excepción.',
        items: {
          type: 'object',
          properties: {
            modo: { type: 'string', enum: ['grafico', 'reuse', 'nueva'], description: 'grafico = PLACA DE MARCA con texto (lo más usado, no cuesta); reuse = usar una foto del banco; nueva = generar una foto fotorrealista NUEVA (excepcional).' },
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
            aspect: { type: 'string', description: 'Relación de aspecto, ej. "1:1", "4:5". En un carrusel usa el MISMO aspecto en TODAS (Instagram recorta según la primera).' },
          },
          required: ['modo'],
        },
      },
    },
    required: ['caption'],
  },
}

async function generarPiezaSocial(item: ItemCalendario, creadoPor?: string): Promise<{ cuerpo: string; imagenUrl: string; imagenId: string; imagenesJson: string; avisos: string[] }> {
  const puedeGenerar = isNanoBananaConfigurado()
  const [contacto, banco] = await Promise.all([getContacto(), listarImagenes().catch(() => [] as ImagenBanco[])])
  const web = contacto.web?.startsWith('http') ? contacto.web : `https://${contacto.web || 'crematorioalmaanimal.cl'}`
  const voz = VOZ_AUDIENCIA[item.audiencia] || VOZ_AUDIENCIA.ambos
  const canalHint = CANAL_HINT[item.canal] || ''

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
- Una pieza social SIEMPRE lleva imagen(es). Instagram NO se puede publicar sin imagen → para Instagram NUNCA devuelvas "imagenes" vacío. Post simple = 1 imagen; CARRUSEL (recomendado en Instagram) = 2 a ${MAX_IMGS}; Facebook = 1.
- La forma de tener VARIAS imágenes sin gastar es la PLACA DE MARCA (modo "grafico"): se renderiza GRATIS (no es una foto IA), así que un carrusel se arma con VARIAS placas (ej. 3 a 6). "Eficiente" = usar PLACAS y reutilizar del banco; NO significa poner menos imágenes ni generar una foto nueva por slide.
- Modos por imagen:
  · "grafico" = PLACA DE MARCA (lo MÁS usado): pieza con TEXTO sobre el diseño de Alma Animal (navy/dorado/crema + logo + tipografía de marca). VOS escribís el HTML (ver "DISEÑO DE GRÁFICOS CON TEXTO"). ES NUESTRA PLANTILLA. Usala para TODO lo informativo/comercial: portada del carrusel con el gancho, listas de virtudes/diferenciadores, datos, horario, pasos del proceso, "por qué elegirnos", comparativas, citas, y la placa de cierre con CTA + contacto.
  · "reuse" = reutilizar una FOTO del banco (URL exacta) para un momento cálido cuando alguna calza.
  · "nueva" = generar una FOTO fotorrealista nueva. SOLO excepcional: una imagen cálida y emocional (una mascota viva tranquila o feliz, o un tutor con su mascota) cuando NO hay nada en el banco. NUNCA fotos ejecutivas/corporativas/de oficina/de negocios/financieras; NUNCA instalaciones.
- B2B (clínicas/veterinarios) y todo lo de virtudes/datos/proceso → PLACAS (grafico), NO fotos. Una clínica quiere ver el profesionalismo de NUESTRA marca (cálida y confiable), no stock de oficina.
- Carrusel típico: placa-portada (gancho) → una placa por idea/virtud → placa de cierre (CTA + contacto). Instagram cuadrado (1:1) o vertical (4:5); MISMO aspecto en TODAS las del carrusel.
${puedeGenerar ? '' : '- (Generación de FOTOS nuevas no disponible ahora: armá la pieza SOLO con placas (grafico) y reutilización del banco — igual DEBE llevar imágenes.)\n'}
Devuelve SIEMPRE con la herramienta "entregar_post", con el copy Y las imágenes.`

  const instruccion = [
    `OBJETIVO: ${item.objetivo || '(general)'}`,
    `FECHA PLANIFICADA: ${item.fecha}`,
    item.titulo && `GANCHO/TÍTULO SUGERIDO: ${item.titulo}`,
    `IDEA A COMUNICAR:\n${item.idea}`,
    item.notas && `NOTAS: ${item.notas}`,
  ].filter(Boolean).join('\n\n')

  const res = await getClient().messages.create({
    model: MODEL,
    // Alto: una pieza social puede traer el copy + el HTML de VARIAS placas (verboso).
    max_tokens: 8000,
    system: [
      { type: 'text', text: system },
      { type: 'text', text: DIFERENCIADORES },
      { type: 'text', text: bancoBloque(banco) },
      ...(bloqueLogosPieza(banco) ? [{ type: 'text' as const, text: bloqueLogosPieza(banco) }] : []),
    ],
    tools: [TOOL_POST],
    tool_choice: { type: 'tool', name: 'entregar_post' },
    messages: [{ role: 'user', content: instruccion }],
  })

  const tu = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === 'entregar_post')
  if (!tu) throw new Error('El modelo no devolvió el post')
  const out = tu.input as SalidaPost
  const cuerpo = (out.caption || '').trim()
  if (!cuerpo) throw new Error('El modelo no devolvió el texto del post')

  const avisos: string[] = []
  // Facebook = 1 imagen; Instagram = hasta MAX_IMGS (carrusel).
  const tope = item.canal === 'facebook' ? 1 : MAX_IMGS
  const specs = (out.imagenes || []).slice(0, tope)
  const esCarrusel = specs.length > 1
  // COHERENCIA DEL CARRUSEL: todas las imágenes comparten el MISMO aspecto (IG
  // recorta el carrusel según la primera), y las imágenes nuevas usan la primera
  // imagen generada como REFERENCIA para mantener sujeto/estilo/paleta entre slides.
  const aspectoForzado = esCarrusel ? (specs[0]?.aspect || '1:1') : undefined
  let nuevasUsadas = 0
  // Toda la pieza comparte UN código de campaña (C-X); cada imagen nueva queda C-X.Y.
  // Se reserva perezosamente (solo si se genera al menos una imagen nueva).
  let campania = ''
  let refImagen: { data: Buffer; mime: string } | null = null
  // Secuencial (no Promise.all): para poder encadenar la imagen de referencia.
  const resueltas: ImagenResuelta[] = []
  for (const sp of specs) {
    if (sp.modo === 'reuse' && sp.url) {
      const m = banco.find(b => b.url === sp.url)
      resueltas.push({ url: sp.url, alt: sp.alt || m?.alt || m?.descripcion || '', id: m?.id || '' })
      continue
    }
    // PLACA DE MARCA (satori): no cuesta como una foto IA → es lo más usado en carruseles.
    if (sp.modo === 'grafico' && (sp.html || '').trim()) {
      try {
        if (!campania) campania = await asignarCampania()
        const fotos = (sp.fotos || []).filter(ff => ff?.slot && ff?.prompt).map(ff => ({ slot: String(ff.slot), prompt: String(ff.prompt), aspect: ff.aspect }))
        if (fotos.length && !puedeGenerar) avisos.push('Una placa pedía fotos pero la generación no está disponible; va sin ellas.')
        const g = await generarGraficoMarca({
          formato: aspectoAFormato(aspectoForzado || sp.aspect),
          html: String(sp.html),
          fotos,
          creadoPor,
          campania,
        })
        resueltas.push({ url: g.url, alt: sp.alt || '', id: '', grafico: true })
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

  const imagenUrl = resueltas[0]?.url || ''
  const imagenId = resueltas[0]?.id || ''
  const imagenesJson = resueltas.length > 1 ? JSON.stringify(resueltas.map(r => ({ url: r.url, alt: r.alt }))) : ''
  return { cuerpo, imagenUrl, imagenId, imagenesJson, avisos }
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
  const { cuerpo, imagenUrl, imagenId, imagenesJson, avisos } = await generarPiezaSocial(item, creadoPor)
  const item2 = await actualizarItem(id, {
    cuerpo,
    imagen_url: imagenUrl,
    imagen_id: imagenId,
    imagenes_json: imagenesJson,
    estado: item.estado === 'propuesta' ? 'generada' : item.estado,
    generado_por: 'ia',
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

/**
 * Edita/regenera una imagen (o todas) de una pieza social YA generada, usando la
 * imagen actual como base (image-to-image). El logo NO lo dibuja la IA: se reaplica
 * nítido al final sobre la pieza. `indice` = posición 1-based; si se omite, aplica a TODAS.
 */
export async function editarImagenPieza(id: string, instruccion: string, indice?: number, creadoPor?: string): Promise<PiezaGenerada> {
  if (!instruccion?.trim()) throw new Error('Falta la instrucción de qué ajustar.')
  if (!isNanoBananaConfigurado()) throw new Error('Generación de imágenes no disponible (falta GEMINI_API_KEY).')
  const item = await obtenerItem(id)
  if (!item) throw new Error(`ítem ${id} no encontrado`)
  if (item.canal === 'email') throw new Error('Esto aplica a piezas de imagen (Instagram/Facebook), no a email.')

  let imgs: { url: string; alt?: string }[] = []
  try { const a = item.imagenes_json ? JSON.parse(item.imagenes_json) : []; if (Array.isArray(a)) imgs = a.filter((x: { url?: string }) => x?.url) } catch { /* fallback abajo */ }
  if (imgs.length === 0 && item.imagen_url) imgs = [{ url: item.imagen_url }]
  if (imgs.length === 0) throw new Error('La pieza no tiene imágenes para editar. Generala primero.')

  const avisos: string[] = []
  const banco = await listarImagenes().catch(() => [] as ImagenBanco[])
  const targets = (indice && indice >= 1 && indice <= imgs.length) ? [indice - 1] : imgs.map((_, i) => i)

  for (const ti of targets) {
    const baseRef = await refDesdeUrl(imgs[ti].url)
    const referencias = [baseRef].filter(Boolean) as { data: Buffer; mime: string }[]
    if (referencias.length === 0) { avisos.push(`No se pudo leer la imagen ${ti + 1} como referencia.`); continue }
    try {
      const r = await generarYGuardarImagen({
        prompt: instruccion.trim(),
        descripcion: (item.titulo || item.idea || 'Imagen de pieza').slice(0, 60),
        tags: 'edicion',
        grupo: 'otro',
        subgrupo: (item.titulo || item.idea || '').slice(0, 60),
        // Edición: preserva la imagen base y cambia solo lo pedido; sin forzar el
        // aspecto (la salida sigue el de la imagen original, no se reencuadra a 1:1).
        editar: true,
        referencias,
        creadoPor,
        kind: 'publicacion',
      })
      imgs[ti] = { url: r.imagen.url, alt: imgs[ti].alt || '' }
    } catch (e) { avisos.push(`No se pudo regenerar la imagen ${ti + 1}: ${e instanceof Error ? e.message : 'error'}`) }
  }

  // Reaplicar el logo tras editar (simple: la imagen; carrusel: la última).
  if (imgs.length > 0) {
    const idx = imgs.length === 1 ? 0 : imgs.length - 1
    try { imgs[idx] = { ...imgs[idx], url: await estamparLogoEnUrl(imgs[idx].url, banco) } } catch { /* best-effort */ }
  }

  const imagenesJson = imgs.length > 1 ? JSON.stringify(imgs.map(x => ({ url: x.url, alt: x.alt || '' }))) : ''
  const item2 = await actualizarItem(id, { imagen_url: imgs[0]?.url || '', imagen_id: '', imagenes_json: imagenesJson })
  return { item: item2, avisos }
}
