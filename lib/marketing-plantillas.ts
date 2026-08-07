import { BRAND } from './email-layout'
import type { FotoGrafico } from './marketing-grafico'

/**
 * PLANTILLAS MAESTRAS de marca (Capa 2). En vez de que el modelo escriba HTML de
 * layout a mano (frágil: encimados, velos que cortan al sujeto, sobrecarga), elige
 * UNA plantilla y llena SLOTS estructurados. El layout sale de código PROBADO y
 * satori-safe: flex-column, zona segura, tipografía auto-ajustada al texto, y un
 * PRESUPUESTO de contenido fijo por plantilla (no se puede sobrecargar).
 *
 * Cada plantilla devuelve { html, fotos }: el HTML listo para generarGraficoMarca
 * (que lo rasteriza con las fuentes reales) y las fotos a generar (FOTO:slot).
 * Esto reusa TODO el pipeline existente (foto IA, logo, render con el fix de
 * flex-shrink, QA, banco). La marca (color/tipografía/logo) queda EXACTA.
 */

const NAVY = BRAND.navy
const GOLD = BRAND.amber
const CREAM = BRAND.cream
const WHITE = '#ffffff'
const INK = '#22303f'
const SOFT = '#e8eef5' // texto claro sobre navy/foto

const DIMS: Record<string, { w: number; h: number }> = {
  post_vertical: { w: 1080, h: 1350 },
  post: { w: 1080, h: 1080 },
  story: { w: 1080, h: 1920 },
  horizontal: { w: 1200, h: 675 },
}

const PAD = 72 // zona segura lateral

function esc(s: unknown): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
function clampText(s: string, max: number): string {
  const t = (s || '').trim()
  if (t.length <= max) return t
  // Corta en el último espacio dentro del límite para no partir una palabra
  // al medio (ej. "exposición d…"); si no hay espacio razonable, corta seco.
  const cut = t.slice(0, max - 1)
  const lastSpace = cut.lastIndexOf(' ')
  const safe = lastSpace > max * 0.5 ? cut.slice(0, lastSpace) : cut
  return safe.trimEnd() + '…'
}
/** Tamaño de fuente que hace CABER `text` en `maxW` (Inter bold ≈ 0.60×fs por glifo).
 *  Nunca deja que la palabra más larga se desborde a lo ancho. */
function fitFont(text: string, maxW: number, fsMax: number, fsMin: number, factor = 0.60): number {
  const t = (text || '').trim()
  if (!t) return fsMax
  const longest = t.split(/\s+/).reduce((m, w) => Math.max(m, w.length), 1)
  const fsWhole = maxW / (t.length * factor)   // todo en una línea
  const fsWord = maxW / (longest * factor)      // que la palabra más larga no desborde
  const fs = Math.min(fsMax, Math.max(fsWhole, fsMin), fsWord)
  return Math.round(Math.max(fsMin, Math.min(fsMax, fs)))
}

export interface SlotsPlantilla {
  eyebrow?: string
  titulo?: string
  /** 2ª línea del titular, en dorado (va en su propia línea). */
  titulo_destacado?: string
  bajada?: string
  bullets?: string[]
  /** Plantilla 'dato': el número/palabra protagonista. */
  dato?: string
  dato_label?: string
  /** CTA (teléfono o acción corta) + secundario (web). */
  cta?: string
  cta_secundario?: string
  fondo?: 'navy' | 'crema' | 'blanco'
  foto?: { prompt?: string; url?: string }

  // ── Slots de las plantillas nuevas (2026-08) ────────────────────────────────
  /** Encabezado del SEGUNDO lado/columna ('comparativa'). */
  titulo_b?: string
  /** Items del SEGUNDO lado/columna ('comparativa'). */
  bullets_b?: string[]
  /** Pares clave→valor ('horario', 'comparativa' en modo tabla). */
  filas?: { izq: string; der: string }[]
  /** Varias cifras ('mosaico_datos'): 2 a 4 celdas. */
  datos?: { valor: string; label: string }[]
  /** Varias fotos ('collage'): 1 grande + 2 chicas. */
  fotos?: { prompt?: string; url?: string }[]
  /** Nota al pie / aclaración chica ('precio', 'horario', 'mosaico_datos'). */
  pie?: string
  /** Años de la mascota en las plantillas 'memorial_*' (ej. "2014 — 2026"). */
  fechas?: string
}

export interface OpcionesPlantilla {
  formato?: string
  logoBlanco?: string  // logo variante blanca (para fondos oscuros/foto)
  logoNavy?: string    // logo variante navy (para fondos claros)
}

export interface ResultadoPlantilla { html: string; fotos: FotoGrafico[] }

export const PLANTILLAS = [
  // base
  'portada', 'contenido', 'dato', 'foto', 'cierre', 'cita', 'split', 'numeros', 'marco',
  // 2026-08: estructuras nuevas para romper la monotonía del feed
  'revista', 'diptico', 'comparativa', 'timeline', 'collage', 'faq', 'precio',
  'arco', 'bicolor', 'checklist', 'mosaico_datos', 'testimonio', 'horario',
  'overlay', 'tipografico',
  // MEMORIAL: homenaje a UNA mascota por su nombre. CINCO estructuras, una por
  // lógica visual — foto a sangre · partición · objeto · círculo · texto. Llegaron
  // a ser 15 y el dueño las bajó a 5 (2026-08-06): con menos opciones el agente
  // acierta más y las piezas salen consistentes. Sumar una solo se justifica si
  // aporta una lógica que ninguna de estas cinco cubre.
  'memorial_medallon', 'memorial_polaroid', 'memorial_susurro', 'memorial_silueta', 'memorial_diptico',
] as const
export type NombrePlantilla = (typeof PLANTILLAS)[number]

/**
 * FAMILIA = a qué se PARECE una plantilla. Es la unidad que se controla para la
 * ROTACIÓN: dos piezas de la misma familia se ven parecidas aunque la plantilla
 * sea distinta (dos listas siguen siendo dos listas). Es un eje distinto del
 * `grupo` (para qué sirve), que es el que usa el agente para ELEGIR — ver el
 * CATÁLOGO al final del archivo.
 */
export type FamiliaPlantilla = 'apiladas' | 'foto' | 'listas' | 'cifras' | 'texto' | 'memorial'

export const SLOTS_TOOL_PROPS: Record<string, unknown> = {
  eyebrow: { type: 'string', description: 'Etiqueta corta arriba (ej. "PARA VETERINARIOS"). En "precio" es el nombre del plan; en "tipografico" la línea chica de arriba.' },
  titulo: { type: 'string', description: 'Titular (2-4 palabras). En "foto"/"cita"/"testimonio" es la frase; en "faq" la pregunta; en "tipografico" la palabra grande.' },
  titulo_destacado: { type: 'string', description: '2ª línea del titular; sale en DORADO, en su propia línea. En "bicolor" es la línea que cae en el bloque claro.' },
  bajada: { type: 'string', description: 'Frase de apoyo corta. En "faq" es la RESPUESTA (hasta ~260 car); en "cita"/"testimonio" el autor.' },
  bullets: { type: 'array', items: { type: 'string' }, description: 'Items cortos: "contenido" (2-4) · "numeros" (pasos) · "timeline" (hitos) · "checklist" (2-5) · "comparativa" (lo nuestro) · "precio" (qué incluye) · "split"/"bicolor" (2-3).' },
  bullets_b: { type: 'array', items: { type: 'string' }, description: 'Solo "comparativa": items de la columna de enfrente ("lo habitual").' },
  titulo_b: { type: 'string', description: 'Solo "comparativa": encabezado de NUESTRA columna (ej. "Alma Animal").' },
  filas: {
    type: 'array',
    description: 'Solo "horario": 2-5 pares clave→valor (ej. izq "Lunes a domingo", der "09:00–22:00").',
    items: { type: 'object', properties: { izq: { type: 'string' }, der: { type: 'string' } } },
  },
  datos: {
    type: 'array',
    description: 'Solo "mosaico_datos": 2-4 cifras (valor = el número, label = qué es).',
    items: { type: 'object', properties: { valor: { type: 'string' }, label: { type: 'string' } } },
  },
  dato: { type: 'string', description: '"dato": el número/palabra grande (ej. "4 días"). "precio": la cifra (ej. "$120.000").' },
  dato_label: { type: 'string', description: 'Qué es esa cifra (acompaña a "dato").' },
  pie: { type: 'string', description: 'Letra chica al pie ("precio", "horario", "mosaico_datos").' },
  fechas: { type: 'string', description: 'Solo "memorial_*": los años de la mascota (ej. "2014 — 2026").' },
  cta: { type: 'string', description: 'CTA corto o teléfono.' },
  cta_secundario: { type: 'string', description: 'Web o dato secundario del CTA.' },
  fondo: { type: 'string', enum: ['navy', 'crema', 'blanco'], description: 'Fondo dominante (alterná entre piezas). En "overlay" es el color de la tarjeta.' },
  foto: {
    type: 'object',
    description: 'Foto de la plantilla. prompt para generar una nueva, o url para reutilizar una del banco.',
    properties: { prompt: { type: 'string', description: 'Descripción fotográfica cálida y CONCRETA (especie, escena, hora, ángulo). Mascota viva; NUNCA instalaciones.' }, url: { type: 'string', description: 'URL exacta del banco para reutilizar.' } },
  },
  fotos: {
    type: 'array',
    description: 'Solo "collage": 3 fotos (la 1ª va grande arriba). Cada una con prompt o url.',
    items: { type: 'object', properties: { prompt: { type: 'string' }, url: { type: 'string' } } },
  },
}

/** Guía de slots por plantilla, para el prompt/tool del modelo. */
// ─── helpers de bloque ────────────────────────────────────────────────────────
function eyebrowChip(text: string, abs?: { top: number; left: number }): string {
  const pos = abs ? `position:absolute;top:${abs.top}px;left:${abs.left}px;` : 'align-self:flex-start;margin-bottom:24px;'
  return `<div style="display:flex;${pos}background:${GOLD};border-radius:8px;padding:9px 22px"><span style="font-family:Inter;font-weight:700;font-size:24px;color:${NAVY};letter-spacing:1px">${esc((text || '').toUpperCase())}</span></div>`
}
function tituloBloque(s: SlotsPlantilla, colorPrincipal: string, maxW: number, fsMax: number): string {
  const largo = [s.titulo, s.titulo_destacado].filter((x): x is string => !!x).reduce((m, l) => (l.length > m.length ? l : m), '')
  const fs = fitFont(largo, maxW, fsMax, 40)
  const l1 = s.titulo ? `<span style="font-family:Inter;font-weight:700;font-size:${fs}px;color:${colorPrincipal};line-height:1.06">${esc(s.titulo)}</span>` : ''
  const l2 = s.titulo_destacado ? `<span style="font-family:Inter;font-weight:700;font-size:${fs}px;color:${GOLD};line-height:1.06">${esc(s.titulo_destacado)}</span>` : ''
  return `<div style="display:flex;flex-direction:column">${l1}${l2}</div>`
}
function ruleGold(): string {
  return `<div style="width:64px;height:5px;background:${GOLD};border-radius:3px;margin-top:28px"></div>`
}
function ctaRow(s: SlotsPlantilla, oscuro: boolean): string {
  if (!s.cta && !s.cta_secundario) return ''
  const chip = s.cta ? `<div style="display:flex;background:${GOLD};border-radius:10px;padding:16px 32px"><span style="font-family:Inter;font-weight:700;font-size:28px;color:${NAVY}">${esc(clampText(s.cta, 24))}</span></div>` : ''
  const sec = s.cta_secundario ? `<span style="font-family:Inter;font-weight:400;font-size:26px;color:${oscuro ? SOFT : INK}">${esc(clampText(s.cta_secundario, 32))}</span>` : ''
  return `<div style="display:flex;flex-direction:row;align-items:center;gap:20px;margin-top:36px">${chip}${sec}</div>`
}
function logoImg(url: string | undefined, abs: string, w = 168): string {
  return url ? `<img src="${esc(url)}" width="${w}" style="position:absolute;${abs}" />` : ''
}
/** Logo EN FLUJO (no absoluto): para apilarlo debajo del texto sin encimarse. */
function logoFlow(url: string | undefined, w = 168): string {
  return url ? `<div style="display:flex"><img src="${esc(url)}" width="${w}" /></div>` : ''
}
/**
 * Alto reservado abajo para el logo. El lockup (huella + "ALMA ANIMAL" + bajada)
 * es casi cuadrado: a 150-168px de ancho mide ~150px de alto, y con su margen
 * inferior ocupa hasta ~200px. Con los 120px que había antes, un cuerpo largo se
 * le metía encima. Es padding, así que solo agrega aire.
 */
const ZONA_LOGO = 200
function bgColor(fondo?: string): string {
  return fondo === 'crema' ? CREAM : fondo === 'blanco' ? WHITE : NAVY
}

// ─── capas gráficas (lo que separa una placa de un documento de Word) ─────────
// Las plantillas de SOLO TEXTO se veían planas: tipografía centrada sobre un
// color liso. Estos helpers agregan profundidad sin romper nada — todo es flex
// + position:absolute + opacity, que es lo único que satori entiende bien.

/**
 * Tipografía GIGANTE y tenue de fondo (un número, una palabra, una comilla).
 * Es el recurso editorial clásico para que una placa de texto tenga capas: se
 * ve la trama, no se lee, y el contenido real queda encima.
 */
function ghost(texto: string, o: {
  size: number; color: string; opacidad?: number
  top?: number; left?: number; right?: number; bottom?: number
}): string {
  if (!texto) return ''
  const pos = [
    o.top !== undefined ? `top:${o.top}px` : '', o.bottom !== undefined ? `bottom:${o.bottom}px` : '',
    o.left !== undefined ? `left:${o.left}px` : '', o.right !== undefined ? `right:${o.right}px` : '',
  ].filter(Boolean).join(';')
  return `<div style="display:flex;position:absolute;${pos};opacity:${o.opacidad ?? 0.09}"><span style="font-family:Inter;font-weight:700;font-size:${o.size}px;color:${o.color};line-height:0.78">${esc(texto)}</span></div>`
}

/** Filete dorado vertical: ancla el bloque de texto al margen izquierdo. */
function rielGold(alto: number | 'auto' = 'auto'): string {
  return `<div style="display:flex;width:6px;${alto === 'auto' ? 'align-self:stretch' : `height:${alto}px`};background:${GOLD};border-radius:3px;flex-shrink:0"></div>`
}

/** Banda de color a sangre (arriba o abajo) para cerrar la composición. */
function bandaBorde(C: { w: number; h: number }, alto: number, color: string, abajo = true): string {
  return `<div style="display:flex;position:absolute;${abajo ? 'bottom' : 'top'}:0;left:0;width:${C.w}px;height:${alto}px;background:${color}"></div>`
}

// ─── plantillas ───────────────────────────────────────────────────────────────
function portada(s: SlotsPlantilla, C: { w: number; h: number }, o: OpcionesPlantilla): ResultadoPlantilla {
  const fotos: FotoGrafico[] = []
  const conFoto = !!(s.foto && (s.foto.url || s.foto.prompt))
  const bandaH = conFoto ? Math.round(C.h * 0.44) : 0
  // El fondo del bloque de texto ya NO es siempre navy: honra el slot `fondo`
  // (navy/crema/blanco) para que las portadas —lo que se ve en el grid— varíen.
  const bg = bgColor(s.fondo)
  const oscuro = bg === NAVY // texto claro sobre navy; navy sobre crema/blanco
  let banda = ''
  if (conFoto) {
    const src = s.foto!.url ? esc(s.foto!.url) : 'FOTO:principal'
    if (!s.foto!.url) fotos.push({ slot: 'principal', prompt: `${s.foto!.prompt || 'una mascota viva y feliz junto a su tutor, luz cálida natural'}. ${ZONA_LIBRE.arriba}`, aspect: '3:2' })
    const eb = s.eyebrow ? eyebrowChip(s.eyebrow, { top: 44, left: PAD - 16 }) : ''
    const lg = logoImg(o.logoBlanco, `top:40px;right:${PAD - 16}px`, 150)
    banda = `<div style="display:flex;position:relative;width:${C.w}px;height:${bandaH}px;overflow:hidden;flex-shrink:0"><img src="${src}" width="${C.w}" height="${bandaH}" style="object-fit:cover;object-position:center 35%;display:block" />${eb}${lg}</div>`
  }
  const eyebrowText = !conFoto && s.eyebrow ? eyebrowChip(s.eyebrow) : ''
  const tit = tituloBloque(s, oscuro ? WHITE : NAVY, C.w - PAD * 2, 86)
  const bajada = s.bajada ? `<span style="font-family:Inter;font-weight:400;font-size:32px;color:${oscuro ? SOFT : INK};line-height:1.4;margin-top:26px">${esc(clampText(s.bajada, 130))}</span>` : ''
  const cta = ctaRow(s, oscuro)
  const lgBottom = logoImg(oscuro ? o.logoBlanco : o.logoNavy, `bottom:52px;right:${PAD - 16}px`, 168)
  const textBlock = `<div style="display:flex;flex-direction:column;flex:1;justify-content:center;padding:64px ${PAD}px ${ZONA_LOGO}px ${PAD}px">${eyebrowText}${tit}${bajada}${ruleGold()}${cta}</div>`
  const html = `<div style="display:flex;flex-direction:column;position:relative;width:${C.w}px;height:${C.h}px;background:${bg}">${banda}${textBlock}${lgBottom}</div>`
  return { html, fotos }
}

function contenido(s: SlotsPlantilla, C: { w: number; h: number }, o: OpcionesPlantilla): ResultadoPlantilla {
  const fotos: FotoGrafico[] = []
  const conFoto = !!(s.foto && (s.foto.url || s.foto.prompt))
  const bandaH = conFoto ? Math.round(C.h * 0.34) : 0
  const bg = bgColor(s.fondo)
  const oscuro = bg === NAVY
  const col = oscuro ? WHITE : NAVY
  let banda = ''
  if (conFoto) {
    const src = s.foto!.url ? esc(s.foto!.url) : 'FOTO:principal'
    if (!s.foto!.url) fotos.push({ slot: 'principal', prompt: s.foto!.prompt || 'una mascota viva y tranquila, luz cálida natural', aspect: '16:9' })
    banda = `<div style="display:flex;width:${C.w}px;height:${bandaH}px;overflow:hidden;flex-shrink:0"><img src="${src}" width="${C.w}" height="${bandaH}" style="object-fit:cover;object-position:center 40%;display:block" /></div>`
  }
  const eb = s.eyebrow ? eyebrowChip(s.eyebrow) : ''
  // tituloBloque (no un <span> suelto): si el modelo manda titulo_destacado
  // (2ª línea en dorado) acá se perdía en silencio, dejando títulos cortados
  // a la mitad (ej. "Elige la" sin "modalidad que te acomode").
  const tit = (s.titulo || s.titulo_destacado) ? tituloBloque(s, col, C.w - PAD * 2, 62) : ''
  const bajada = s.bajada ? `<span style="font-family:Inter;font-weight:400;font-size:30px;color:${oscuro ? SOFT : INK};line-height:1.4;margin-top:20px">${esc(clampText(s.bajada, 120))}</span>` : ''
  // Los bullets van dentro de un PANEL con filete dorado, no sueltos sobre el
  // fondo: le da peso y estructura a la lámina más usada de todas (era la más
  // plana del set — puro texto flotando en el medio del color).
  const panelBg = oscuro ? '#1c4c7c' : (bg === CREAM ? WHITE : '#f4f6f9')
  const items = (s.bullets || []).slice(0, 4).map(b =>
    `<div style="display:flex;flex-direction:row;align-items:flex-start;gap:16px"><div style="display:flex;width:11px;height:11px;border-radius:6px;background:${GOLD};margin-top:12px;flex-shrink:0"></div><span style="font-family:Inter;font-weight:600;font-size:30px;color:${col};line-height:1.3">${esc(clampText(b, 90))}</span></div>`).join('')
  const bullets = items
    ? `<div style="display:flex;flex-direction:row;gap:26px;margin-top:34px;background:${panelBg};border-radius:16px;padding:30px 30px">${rielGold()}<div style="display:flex;flex-direction:column;gap:20px;flex:1">${items}</div></div>`
    : ''
  // Marca de agua con la 1ª palabra del titular: trama de fondo, no se lee.
  const primera = (s.titulo || s.titulo_destacado || '').split(/\s+/)[0] || ''
  const marca = conFoto ? '' : ghost(primera, { size: Math.round(C.h * 0.30), color: oscuro ? WHITE : NAVY, opacidad: 0.055, bottom: Math.round(C.h * 0.04), right: -Math.round(C.w * 0.08) })
  const lg = logoImg(oscuro ? o.logoBlanco : o.logoNavy, `bottom:52px;right:${PAD - 16}px`, 150)
  const body = `<div style="display:flex;flex-direction:column;flex:1;justify-content:center;padding:56px ${PAD}px ${ZONA_LOGO}px ${PAD}px">${eb}${tit}${bajada}${bullets}</div>`
  const html = `<div style="display:flex;flex-direction:column;position:relative;width:${C.w}px;height:${C.h}px;background:${bg}">${banda}${marca}${body}${lg}</div>`
  return { html, fotos }
}

function dato(s: SlotsPlantilla, C: { w: number; h: number }, o: OpcionesPlantilla): ResultadoPlantilla {
  // Póster de cifra: la cifra grande apoyada sobre una COPIA fantasma enorme que
  // sangra por el borde, y una banda inferior que cierra la composición. Antes
  // era un número solo en el medio de un rectángulo liso.
  const bg = bgColor(s.fondo || 'navy')
  const oscuro = bg === NAVY
  const col = oscuro ? WHITE : NAVY
  const bandaBg = oscuro ? '#0f3054' : (bg === CREAM ? '#f2ece1' : '#f4f6f9')
  const bandaH = Math.round(C.h * 0.26)
  const fondo = ghost(s.dato || '', {
    size: Math.round(C.h * 0.36), color: GOLD, opacidad: oscuro ? 0.11 : 0.14,
    top: Math.round(C.h * 0.10), left: -Math.round(C.w * 0.05),
  })
  const eb = s.eyebrow ? eyebrowChip(s.eyebrow) : ''
  const big = s.dato ? `<span style="font-family:Inter;font-weight:700;font-size:${fitFont(s.dato, C.w - PAD * 2, 210, 90, 0.55)}px;color:${GOLD};line-height:0.94">${esc(s.dato)}</span>` : ''
  const label = s.dato_label ? `<span style="font-family:Inter;font-weight:700;font-size:${fitFont(s.dato_label, C.w - PAD * 2, 56, 34)}px;color:${col};line-height:1.15;margin-top:18px">${esc(clampText(s.dato_label, 40))}</span>` : ''
  const arriba = `<div style="display:flex;flex-direction:column;flex:1;justify-content:center;align-items:flex-start;padding:64px ${PAD}px 40px ${PAD}px">${eb}${big}${label}</div>`
  const bajada = s.bajada ? `<span style="font-family:Inter;font-weight:400;font-size:30px;color:${oscuro ? SOFT : INK};line-height:1.4">${esc(clampText(s.bajada, 120))}</span>` : ''
  const banda = `<div style="display:flex;flex-direction:row;align-items:center;gap:26px;width:${C.w}px;height:${bandaH}px;background:${bandaBg};padding:0 ${PAD}px;flex-shrink:0">${rielGold(72)}${bajada}</div>`
  const lg = logoImg(oscuro ? o.logoBlanco : o.logoNavy, `top:${PAD - 16}px;right:${PAD - 16}px`, 140)
  const html = `<div style="display:flex;flex-direction:column;position:relative;width:${C.w}px;height:${C.h}px;background:${bg}">${fondo}${arriba}${banda}${lg}</div>`
  return { html, fotos: [] }
}

function foto(s: SlotsPlantilla, C: { w: number; h: number }, o: OpcionesPlantilla): ResultadoPlantilla {
  const fotos: FotoGrafico[] = []
  const src = s.foto?.url ? esc(s.foto.url) : 'FOTO:principal'
  if (!s.foto?.url) fotos.push({ slot: 'principal', prompt: `${s.foto?.prompt || 'una mascota viva, feliz y serena, retrato cálido con luz dorada'}. ${ZONA_LIBRE.abajo}`, aspect: '4:5' })
  const frase = s.titulo ? `<span style="font-family:Inter;font-weight:700;font-size:${fitFont(s.titulo, C.w - PAD * 2, 58, 34)}px;color:${WHITE};line-height:1.15">${esc(clampText(s.titulo, 70))}</span>` : ''
  // velo SOLO en la franja inferior (degradé que se desvanece) — no tapa la foto.
  const velo = `<div style="display:flex;position:absolute;bottom:0;left:0;width:${C.w}px;height:${Math.round(C.h * 0.42)}px;background:linear-gradient(to bottom, rgba(20,60,100,0) 0%, rgba(20,60,100,0.82) 78%)"></div>`
  // Frase y logo APILADOS en una sola columna anclada abajo. Antes iban los dos
  // como absolutos abajo-izquierda (texto en bottom:150 y logo en bottom:52) y,
  // como el logo mide ~150px de alto, el titular le caía justo encima: el "logo
  // montado" que reportó el dueño (2026-07-28). Apilados no pueden pisarse,
  // cualquiera sea el alto del logo o el largo de la frase.
  const bloqueTexto = frase ? `<div style="display:flex;flex-direction:column;margin-bottom:36px">${frase}</div>` : ''
  const pie = `<div style="display:flex;flex-direction:column;align-items:flex-start;position:absolute;left:${PAD}px;bottom:52px;width:${C.w - PAD * 2}px">${bloqueTexto}${logoFlow(o.logoBlanco, 168)}</div>`
  const html = `<div style="display:flex;position:relative;width:${C.w}px;height:${C.h}px;background:${NAVY}"><img src="${src}" width="${C.w}" height="${C.h}" style="object-fit:cover;display:block" />${velo}${pie}</div>`
  return { html, fotos }
}

function cierre(s: SlotsPlantilla, C: { w: number; h: number }, o: OpcionesPlantilla): ResultadoPlantilla {
  const fotos: FotoGrafico[] = []
  const conFoto = !!(s.foto && (s.foto.url || s.foto.prompt))
  const bandaH = conFoto ? Math.round(C.h * 0.42) : 0
  const bg = bgColor(s.fondo) // honra navy/crema/blanco (antes era navy fijo)
  const oscuro = bg === NAVY
  let banda = ''
  if (conFoto) {
    const src = s.foto!.url ? esc(s.foto!.url) : 'FOTO:principal'
    if (!s.foto!.url) fotos.push({ slot: 'principal', prompt: s.foto!.prompt || 'una mascota viva y feliz con su tutor, luz cálida', aspect: '3:2' })
    banda = `<div style="display:flex;width:${C.w}px;height:${bandaH}px;overflow:hidden;flex-shrink:0"><img src="${src}" width="${C.w}" height="${bandaH}" style="object-fit:cover;object-position:center 35%;display:block" /></div>`
  }
  const tit = tituloBloque(s, oscuro ? WHITE : NAVY, C.w - PAD * 2, 76)
  const bajada = s.bajada ? `<span style="font-family:Inter;font-weight:400;font-size:30px;color:${oscuro ? SOFT : INK};line-height:1.4;margin-top:22px">${esc(clampText(s.bajada, 120))}</span>` : ''
  const lg = logoImg(oscuro ? o.logoBlanco : o.logoNavy, `top:${PAD - 16}px;right:${PAD - 16}px`, 150)
  const body = `<div style="display:flex;flex-direction:column;flex:1;justify-content:flex-end;padding:${conFoto ? 60 : 120}px ${PAD}px 56px ${PAD}px">${tit}${bajada}</div>`
  // El CTA es una BANDA DORADA a sangre abajo, no un chip perdido en el medio:
  // en un cierre el teléfono tiene que ser lo primero que se ve.
  const tel = s.cta ? `<span style="font-family:Inter;font-weight:700;font-size:${fitFont(s.cta, C.w - PAD * 2, 62, 34)}px;color:${NAVY};line-height:1.05">${esc(clampText(s.cta, 26))}</span>` : ''
  const web = s.cta_secundario ? `<span style="font-family:Inter;font-weight:600;font-size:27px;color:${NAVY};opacity:0.78;margin-top:10px">${esc(clampText(s.cta_secundario, 40))}</span>` : ''
  const bandaCta = (tel || web)
    ? `<div style="display:flex;flex-direction:column;justify-content:center;width:${C.w}px;height:${Math.round(C.h * 0.20)}px;background:${GOLD};padding:0 ${PAD}px;flex-shrink:0">${tel}${web}</div>`
    : ''
  const html = `<div style="display:flex;flex-direction:column;position:relative;width:${C.w}px;height:${C.h}px;background:${bg}">${banda}${body}${bandaCta}${lg}</div>`
  return { html, fotos }
}

function cita(s: SlotsPlantilla, C: { w: number; h: number }, o: OpcionesPlantilla): ResultadoPlantilla {
  // Testimonio / frase destacada. Por defecto en CLARO (crema) para romper el navy.
  const bg = bgColor(s.fondo || 'crema')
  const oscuro = bg === NAVY
  const col = oscuro ? WHITE : NAVY
  // La comilla ya no es un caracterito arriba: es una MARCA DE AGUA enorme que
  // sangra por el borde y sobre la que se apoya la frase. Da capas a una placa
  // que si no es tipografía suelta sobre un color liso.
  const marca = ghost('“', { size: Math.round(C.h * 0.62), color: GOLD, opacidad: oscuro ? 0.16 : 0.20, top: -Math.round(C.h * 0.06), left: PAD - 30 })
  const eb = s.eyebrow ? eyebrowChip(s.eyebrow) : ''
  const frase = s.titulo ? `<span style="font-family:Inter;font-weight:700;font-size:${fitFont(s.titulo, C.w - PAD * 2, 70, 40, 0.53)}px;color:${col};line-height:1.24">${esc(clampText(s.titulo, 200))}</span>` : ''
  const autor = s.bajada ? `<div style="display:flex;flex-direction:row;align-items:center;gap:20px;margin-top:36px">${rielGold(46)}<span style="font-family:Inter;font-weight:600;font-size:30px;color:${oscuro ? SOFT : INK}">${esc(clampText(s.bajada, 60))}</span></div>` : ''
  const lg = logoImg(oscuro ? o.logoBlanco : o.logoNavy, `bottom:52px;right:${PAD - 16}px`, 150)
  const body = `<div style="display:flex;flex-direction:column;flex:1;justify-content:center;padding:${Math.round(C.h * 0.30)}px ${PAD}px ${Math.round(C.h * 0.12)}px ${PAD}px">${eb}${frase}${autor}</div>`
  const html = `<div style="display:flex;flex-direction:column;position:relative;width:${C.w}px;height:${C.h}px;background:${bg}">${marca}${body}${lg}</div>`
  return { html, fotos: [] }
}

function split(s: SlotsPlantilla, C: { w: number; h: number }, o: OpcionesPlantilla): ResultadoPlantilla {
  // Editorial lado-a-lado: foto a la izquierda, panel de texto a la derecha.
  // Estructura DISTINTA a las apiladas → variedad real de layout.
  const fotos: FotoGrafico[] = []
  const src = s.foto?.url ? esc(s.foto.url) : 'FOTO:principal'
  if (!s.foto?.url) fotos.push({ slot: 'principal', prompt: s.foto?.prompt || 'una mascota viva y serena junto a su tutor, luz cálida natural', aspect: '3:4' })
  const bg = bgColor(s.fondo || 'crema')
  const oscuro = bg === NAVY
  const col = oscuro ? WHITE : NAVY
  const fotoW = Math.round(C.w * 0.46)
  const eb = s.eyebrow ? eyebrowChip(s.eyebrow) : ''
  const tit = (s.titulo || s.titulo_destacado) ? tituloBloque(s, col, C.w - fotoW - 112, 54) : ''
  const bajada = s.bajada ? `<span style="font-family:Inter;font-weight:400;font-size:28px;color:${oscuro ? SOFT : INK};line-height:1.4;margin-top:18px">${esc(clampText(s.bajada, 140))}</span>` : ''
  const items = (s.bullets || []).slice(0, 3).map(b =>
    `<div style="display:flex;flex-direction:row;align-items:flex-start;gap:14px"><div style="display:flex;width:10px;height:10px;border-radius:6px;background:${GOLD};margin-top:11px;flex-shrink:0"></div><span style="font-family:Inter;font-weight:600;font-size:27px;color:${col};line-height:1.3">${esc(clampText(b, 80))}</span></div>`).join('')
  const bullets = items ? `<div style="display:flex;flex-direction:column;gap:14px;margin-top:26px">${items}</div>` : ''
  const cta = ctaRow(s, oscuro)
  const lg = logoImg(oscuro ? o.logoBlanco : o.logoNavy, `bottom:44px;right:44px`, 120)
  const fotoCol = `<div style="display:flex;width:${fotoW}px;height:${C.h}px;overflow:hidden;flex-shrink:0"><img src="${src}" width="${fotoW}" height="${C.h}" style="object-fit:cover;display:block" /></div>`
  // 170 abajo: el logo del panel (120px de ancho ≈ 107 de alto + 44 de margen)
  // llega hasta ~150px desde el borde; con 100 se le encimaban los bullets/CTA.
  const textCol = `<div style="display:flex;flex-direction:column;flex:1;justify-content:center;padding:64px 56px 170px 56px">${eb}${tit}${bajada}${bullets}${cta}</div>`
  const html = `<div style="display:flex;flex-direction:row;position:relative;width:${C.w}px;height:${C.h}px;background:${bg}">${fotoCol}${textCol}${lg}</div>`
  return { html, fotos }
}

function numeros(s: SlotsPlantilla, C: { w: number; h: number }, o: OpcionesPlantilla): ResultadoPlantilla {
  // Lista NUMERADA (pasos / razones): números dorados grandes → ritmo visual
  // distinto a los bullets de "contenido". Sin foto. Default en claro.
  const bg = bgColor(s.fondo || 'crema')
  const oscuro = bg === NAVY
  const col = oscuro ? WHITE : NAVY
  const eb = s.eyebrow ? eyebrowChip(s.eyebrow) : ''
  const tit = (s.titulo || s.titulo_destacado) ? tituloBloque(s, col, C.w - PAD * 2, 60) : ''
  const bajada = s.bajada ? `<span style="font-family:Inter;font-weight:400;font-size:30px;color:${oscuro ? SOFT : INK};line-height:1.4;margin-top:18px">${esc(clampText(s.bajada, 120))}</span>` : ''
  // Numerales EDITORIALES: cifra dorada enorme al margen + hairline que separa
  // cada paso. El circulito de 66px con el número adentro era el recurso más
  // genérico del set.
  const linea = oscuro ? '#2a5c8d' : '#e2dace'
  const rows = (s.bullets || []).slice(0, 4).map((b, i) =>
    `<div style="display:flex;flex-direction:row;align-items:center;gap:28px;padding:26px 0;border-top:${i === 0 ? '0px' : '2px'} solid ${linea}"><span style="font-family:Inter;font-weight:700;font-size:86px;color:${GOLD};line-height:0.9;width:110px;flex-shrink:0">${i + 1}</span><span style="font-family:Inter;font-weight:600;font-size:32px;color:${col};line-height:1.25">${esc(clampText(b, 76))}</span></div>`).join('')
  const lista = rows ? `<div style="display:flex;flex-direction:column;margin-top:34px">${rows}</div>` : ''
  const lg = logoImg(oscuro ? o.logoBlanco : o.logoNavy, `bottom:52px;right:${PAD - 16}px`, 150)
  const body = `<div style="display:flex;flex-direction:column;flex:1;justify-content:center;padding:60px ${PAD}px ${ZONA_LOGO}px ${PAD}px">${eb}${tit}${bajada}${lista}</div>`
  const html = `<div style="display:flex;flex-direction:column;position:relative;width:${C.w}px;height:${C.h}px;background:${bg}">${body}${lg}</div>`
  return { html, fotos: [] }
}

function marco(s: SlotsPlantilla, C: { w: number; h: number }, o: OpcionesPlantilla): ResultadoPlantilla {
  // Foto ENMARCADA (estilo galería/editorial) centrada + pie de foto. Distinta de
  // "foto" (full-bleed) y "split" (lado a lado): la foto respira sobre el fondo de
  // marca, con aire. Cálida para homenajes/humanización.
  const fotos: FotoGrafico[] = []
  const src = s.foto?.url ? esc(s.foto.url) : 'FOTO:principal'
  if (!s.foto?.url) fotos.push({ slot: 'principal', prompt: s.foto?.prompt || 'una mascota viva y feliz, retrato cálido con luz natural', aspect: '1:1' })
  const bg = bgColor(s.fondo || 'crema')
  const oscuro = bg === NAVY
  const col = oscuro ? WHITE : NAVY
  const marcoW = C.w - PAD * 2
  const fotoH = Math.round(C.h * 0.50)
  const cuadro = `<div style="display:flex;background:${WHITE};padding:20px;border-radius:8px"><img src="${src}" width="${marcoW - 40}" height="${fotoH}" style="object-fit:cover;display:block;border-radius:2px" /></div>`
  const tit = s.titulo ? `<span style="font-family:Inter;font-weight:700;font-size:${fitFont(s.titulo, marcoW, 50, 34)}px;color:${col};line-height:1.22;margin-top:40px">${esc(clampText(s.titulo, 90))}</span>` : ''
  const bajada = s.bajada ? `<span style="font-family:Inter;font-weight:400;font-size:28px;color:${oscuro ? SOFT : INK};line-height:1.4;margin-top:14px">${esc(clampText(s.bajada, 120))}</span>` : ''
  const lg = logoImg(oscuro ? o.logoBlanco : o.logoNavy, `bottom:46px;right:${PAD - 16}px`, 130)
  const body = `<div style="display:flex;flex-direction:column;flex:1;justify-content:center;padding:72px ${PAD}px ${ZONA_LOGO}px ${PAD}px">${cuadro}${tit}${bajada}</div>`
  const html = `<div style="display:flex;flex-direction:column;position:relative;width:${C.w}px;height:${C.h}px;background:${bg}">${body}${lg}</div>`
  return { html, fotos }
}

// ─── plantillas nuevas (2026-08) ──────────────────────────────────────────────
// Objetivo del dueño: que el feed deje de verse "siempre igual". Cada una rompe
// el molde apilado (eyebrow → título → bajada → bullets) con una ESTRUCTURA
// distinta: bandas sólidas, dos columnas, rieles, grillas, tarjetas flotantes,
// círculos y póster tipográfico. Todas satori-safe (solo flex, sin transform).

/**
 * Exigencia de encuadre para las plantillas que APOYAN TEXTO SOBRE LA FOTO.
 *
 * Bug real (2026-08, reportado por el dueño): en un memorial con la placa
 * encima de la foto, la placa le tapaba el hocico al gato. La plantilla no sabe dónde está el animal, así que
 * la única solución robusta es PEDIR la foto ya compuesta con la zona del texto
 * despejada. Se le suma al prompt venga de donde venga (del modelo o del
 * fallback), porque el modelo se olvida de decirlo.
 */
const ZONA_LIBRE: Record<'abajo' | 'arriba', string> = {
  abajo: 'Composición OBLIGATORIA: la mascota en la MITAD SUPERIOR del encuadre, con su cara y ojos completos y bien visibles, y la MITAD INFERIOR despejada (piso, manta, pasto o fondo liso) porque ahí va a ir un bloque de texto que no puede taparle la cara.',
  arriba: 'Composición OBLIGATORIA: la mascota en la MITAD INFERIOR del encuadre, con su cara y ojos completos y bien visibles, y el TERCIO SUPERIOR despejado (pared, cielo o fondo liso) porque ahí va a ir texto que no puede taparle la cara.',
}

/** Pide una foto para un slot y devuelve el `src` a usar en el <img>. */
function pedirFoto(
  fotos: FotoGrafico[],
  f: { prompt?: string; url?: string } | undefined,
  slot: string,
  fallback: string,
  aspect: string,
  zonaLibre?: 'abajo' | 'arriba',
): string {
  if (f?.url) return esc(f.url)
  const base = f?.prompt || fallback
  fotos.push({ slot, prompt: zonaLibre ? `${base}. ${ZONA_LIBRE[zonaLibre]}` : base, aspect })
  return `FOTO:${slot}`
}

/** 1. Portada de REVISTA: foto a sangre + banda sólida abajo con el titular. */
function revista(s: SlotsPlantilla, C: { w: number; h: number }, o: OpcionesPlantilla): ResultadoPlantilla {
  const fotos: FotoGrafico[] = []
  const src = pedirFoto(fotos, s.foto, 'principal', 'un perro tranquilo mirando a cámara junto a la ventana de su casa, luz cálida de mañana', '4:5', 'arriba')
  const bg = bgColor(s.fondo || 'crema')
  const oscuro = bg === NAVY
  const col = oscuro ? WHITE : NAVY
  const bandaH = Math.round(C.h * 0.34)
  const fotoH = C.h - bandaH
  const eb = s.eyebrow ? eyebrowChip(s.eyebrow, { top: 48, left: PAD - 16 }) : ''
  const lgFoto = logoImg(o.logoBlanco, `top:44px;right:${PAD - 16}px`, 150)
  const zona = `<div style="display:flex;position:relative;width:${C.w}px;height:${fotoH}px;overflow:hidden;flex-shrink:0"><img src="${src}" width="${C.w}" height="${fotoH}" style="object-fit:cover;object-position:center 45%;display:block" />${eb}${lgFoto}</div>`
  const tit = tituloBloque(s, col, C.w - PAD * 2, 70)
  const bajada = s.bajada ? `<span style="font-family:Inter;font-weight:400;font-size:29px;color:${oscuro ? SOFT : INK};line-height:1.35;margin-top:18px">${esc(clampText(s.bajada, 130))}</span>` : ''
  const cta = ctaRow(s, oscuro)
  const banda = `<div style="display:flex;flex-direction:column;flex:1;justify-content:center;padding:0 ${PAD}px">${tit}${bajada}${cta}</div>`
  const html = `<div style="display:flex;flex-direction:column;position:relative;width:${C.w}px;height:${C.h}px;background:${bg}">${zona}${banda}</div>`
  return { html, fotos }
}

/** 2. DÍPTICO: mitad foto / mitad color, con el titular CENTRADO. */
function diptico(s: SlotsPlantilla, C: { w: number; h: number }, o: OpcionesPlantilla): ResultadoPlantilla {
  const fotos: FotoGrafico[] = []
  const src = pedirFoto(fotos, s.foto, 'principal', 'un gato descansando sobre una manta de lana en un sillón, luz suave de tarde', '1:1')
  const bg = bgColor(s.fondo || 'navy')
  const oscuro = bg === NAVY
  const col = oscuro ? WHITE : NAVY
  const mitad = Math.round(C.h / 2)
  const arriba = `<div style="display:flex;width:${C.w}px;height:${mitad}px;overflow:hidden;flex-shrink:0"><img src="${src}" width="${C.w}" height="${mitad}" style="object-fit:cover;object-position:center 40%;display:block" /></div>`
  const largo = [s.titulo, s.titulo_destacado].filter((x): x is string => !!x).reduce((m, l) => (l.length > m.length ? l : m), '')
  const fs = fitFont(largo, C.w - PAD * 2, 78, 40)
  const l1 = s.titulo ? `<span style="font-family:Inter;font-weight:700;font-size:${fs}px;color:${col};line-height:1.08;text-align:center">${esc(s.titulo)}</span>` : ''
  const l2 = s.titulo_destacado ? `<span style="font-family:Inter;font-weight:700;font-size:${fs}px;color:${GOLD};line-height:1.08;text-align:center">${esc(s.titulo_destacado)}</span>` : ''
  const regla = `<div style="display:flex;width:70px;height:5px;background:${GOLD};border-radius:3px;margin-top:26px"></div>`
  const bajada = s.bajada ? `<span style="font-family:Inter;font-weight:400;font-size:29px;color:${oscuro ? SOFT : INK};line-height:1.4;margin-top:24px;text-align:center">${esc(clampText(s.bajada, 130))}</span>` : ''
  const lg = logoImg(oscuro ? o.logoBlanco : o.logoNavy, `bottom:44px;left:${Math.round(C.w / 2) - 75}px`, 150)
  const abajo = `<div style="display:flex;flex-direction:column;flex:1;align-items:center;justify-content:center;padding:44px ${PAD}px ${ZONA_LOGO}px ${PAD}px">${l1}${l2}${regla}${bajada}</div>`
  const html = `<div style="display:flex;flex-direction:column;position:relative;width:${C.w}px;height:${C.h}px;background:${bg}">${arriba}${abajo}${lg}</div>`
  return { html, fotos }
}

/** 3. COMPARATIVA: dos columnas enfrentadas (nosotros / lo habitual). */
function comparativa(s: SlotsPlantilla, C: { w: number; h: number }, o: OpcionesPlantilla): ResultadoPlantilla {
  const bg = bgColor(s.fondo || 'crema')
  const oscuro = bg === NAVY
  const col = oscuro ? WHITE : NAVY
  const tit = (s.titulo || s.titulo_destacado) ? tituloBloque(s, col, C.w - PAD * 2, 54) : ''
  const colW = Math.round((C.w - PAD * 2 - 24) / 2)
  const columna = (encabezado: string, items: string[], destacada: boolean) => {
    const head = `<div style="display:flex;align-items:center;justify-content:center;height:${destacada ? 92 : 78}px;background:${destacada ? GOLD : (oscuro ? '#1d4f7f' : '#dfe6ee')};border-radius:14px 14px 0 0"><span style="font-family:Inter;font-weight:700;font-size:${destacada ? 28 : 24}px;color:${destacada ? NAVY : (oscuro ? SOFT : INK)};letter-spacing:0.5px">${esc(clampText((encabezado || '').toUpperCase(), 22))}</span></div>`
    const rows = items.slice(0, 4).map(b =>
      `<div style="display:flex;flex-direction:row;align-items:flex-start;gap:12px"><div style="display:flex;width:9px;height:9px;border-radius:5px;background:${destacada ? GOLD : (oscuro ? SOFT : '#9aa8b6')};margin-top:10px;flex-shrink:0"></div><span style="font-family:Inter;font-weight:600;font-size:25px;color:${destacada ? col : (oscuro ? SOFT : '#5c6b7a')};line-height:1.3">${esc(clampText(b, 64))}</span></div>`).join('')
    const body = `<div style="display:flex;flex-direction:column;gap:20px;padding:30px 24px;background:${destacada ? (oscuro ? '#1a4a78' : WHITE) : 'transparent'};border-radius:0 0 14px 14px">${rows}</div>`
    return `<div style="display:flex;flex-direction:column;width:${colW}px">${head}${body}</div>`
  }
  // `align-items:stretch` (sin flex:1): las dos columnas quedan del MISMO alto y
  // ese alto lo manda el contenido. Con flex:1 la columna blanca se estiraba
  // hasta abajo y dejaba medio lienzo en blanco vacío.
  // Insignia "VS" pisando el medio: convierte dos listas paralelas en una
  // comparación de verdad. Va absoluta para que no empuje el layout.
  const vs = `<div style="display:flex;align-items:center;justify-content:center;position:absolute;top:${Math.round(C.h * 0.455)}px;left:${Math.round(C.w / 2) - 42}px;width:84px;height:84px;border-radius:44px;background:${bg};border:5px solid ${GOLD}"><span style="font-family:Inter;font-weight:700;font-size:30px;color:${oscuro ? WHITE : NAVY}">VS</span></div>`
  const cols = `<div style="display:flex;flex-direction:row;align-items:stretch;gap:24px;margin-top:38px">${columna(s.titulo_b || 'Alma Animal', s.bullets || [], true)}${columna('Lo habitual', s.bullets_b || [], false)}</div>`
  const lg = logoImg(oscuro ? o.logoBlanco : o.logoNavy, `bottom:50px;right:${PAD - 16}px`, 140)
  const body = `<div style="display:flex;flex-direction:column;flex:1;justify-content:center;padding:60px ${PAD}px ${ZONA_LOGO}px ${PAD}px">${tit}${cols}</div>`
  const html = `<div style="display:flex;flex-direction:column;position:relative;width:${C.w}px;height:${C.h}px;background:${bg}">${body}${vs}${lg}</div>`
  return { html, fotos: [] }
}

/** 4. TIMELINE: hitos enlazados por un riel vertical dorado. */
function timeline(s: SlotsPlantilla, C: { w: number; h: number }, o: OpcionesPlantilla): ResultadoPlantilla {
  const bg = bgColor(s.fondo || 'navy')
  const oscuro = bg === NAVY
  const col = oscuro ? WHITE : NAVY
  const eb = s.eyebrow ? eyebrowChip(s.eyebrow) : ''
  const tit = (s.titulo || s.titulo_destacado) ? tituloBloque(s, col, C.w - PAD * 2, 56) : ''
  const items = (s.bullets || []).slice(0, 4)
  const rows = items.map((b, i) => {
    const ultimo = i === items.length - 1
    const riel = ultimo ? '' : `<div style="display:flex;width:4px;flex:1;background:${GOLD};border-radius:2px;margin-top:6px"></div>`
    const punto = `<div style="display:flex;align-items:center;justify-content:center;width:34px;height:34px;border-radius:18px;background:${GOLD};flex-shrink:0"></div>`
    const carril = `<div style="display:flex;flex-direction:column;align-items:center;width:34px;flex-shrink:0">${punto}${riel}</div>`
    const texto = `<div style="display:flex;flex-direction:column;flex:1;padding-bottom:${ultimo ? 0 : 30}px"><span style="font-family:Inter;font-weight:600;font-size:31px;color:${col};line-height:1.28">${esc(clampText(b, 90))}</span></div>`
    // flex:1 por fila → los hitos se REPARTEN a lo alto y el riel dorado recorre
    // el lienzo. Sin esto quedaban apretados arriba con medio afiche vacío.
    return `<div style="display:flex;flex-direction:row;gap:22px;align-items:stretch;flex:1">${carril}${texto}</div>`
  }).join('')
  const lista = rows ? `<div style="display:flex;flex-direction:column;flex:1;margin-top:40px">${rows}</div>` : ''
  const lg = logoImg(oscuro ? o.logoBlanco : o.logoNavy, `bottom:52px;right:${PAD - 16}px`, 150)
  const body = `<div style="display:flex;flex-direction:column;flex:1;justify-content:center;padding:60px ${PAD}px ${ZONA_LOGO}px ${PAD}px">${eb}${tit}${lista}</div>`
  const html = `<div style="display:flex;flex-direction:column;position:relative;width:${C.w}px;height:${C.h}px;background:${bg}">${body}${lg}</div>`
  return { html, fotos: [] }
}

/** 5. COLLAGE: una foto grande + dos chicas + titular. */
function collage(s: SlotsPlantilla, C: { w: number; h: number }, o: OpcionesPlantilla): ResultadoPlantilla {
  const fotos: FotoGrafico[] = []
  const list = s.fotos && s.fotos.length ? s.fotos : [s.foto || {}, {}, {}]
  const bg = bgColor(s.fondo || 'crema')
  const oscuro = bg === NAVY
  const col = oscuro ? WHITE : NAVY
  const anchoUtil = C.w - PAD * 2
  const grandeH = Math.round(C.h * 0.34)
  const chicaW = Math.round((anchoUtil - 18) / 2)
  const chicaH = Math.round(C.h * 0.20)
  const s1 = pedirFoto(fotos, list[0], 'foto1', 'un perro jugando en el pasto de un parque a media tarde', '3:2')
  const s2 = pedirFoto(fotos, list[1], 'foto2', 'primer plano de la cara de un gato atigrado descansando, luz de ventana', '1:1')
  const s3 = pedirFoto(fotos, list[2], 'foto3', 'las manos de una persona acariciando a su perro sentado en el sillón', '1:1')
  const grande = `<div style="display:flex;width:${anchoUtil}px;height:${grandeH}px;overflow:hidden;border-radius:12px"><img src="${s1}" width="${anchoUtil}" height="${grandeH}" style="object-fit:cover;display:block" /></div>`
  const fila = `<div style="display:flex;flex-direction:row;gap:18px;margin-top:18px"><div style="display:flex;width:${chicaW}px;height:${chicaH}px;overflow:hidden;border-radius:12px"><img src="${s2}" width="${chicaW}" height="${chicaH}" style="object-fit:cover;display:block" /></div><div style="display:flex;width:${chicaW}px;height:${chicaH}px;overflow:hidden;border-radius:12px"><img src="${s3}" width="${chicaW}" height="${chicaH}" style="object-fit:cover;display:block" /></div></div>`
  const tit = (s.titulo || s.titulo_destacado) ? tituloBloque(s, col, anchoUtil, 56) : ''
  const bajada = s.bajada ? `<span style="font-family:Inter;font-weight:400;font-size:28px;color:${oscuro ? SOFT : INK};line-height:1.4;margin-top:16px">${esc(clampText(s.bajada, 120))}</span>` : ''
  const texto = `<div style="display:flex;flex-direction:column;margin-top:36px">${tit}${bajada}</div>`
  const lg = logoImg(oscuro ? o.logoBlanco : o.logoNavy, `bottom:50px;right:${PAD - 16}px`, 140)
  const body = `<div style="display:flex;flex-direction:column;flex:1;justify-content:center;padding:60px ${PAD}px ${ZONA_LOGO}px ${PAD}px">${grande}${fila}${texto}</div>`
  const html = `<div style="display:flex;flex-direction:column;position:relative;width:${C.w}px;height:${C.h}px;background:${bg}">${body}${lg}</div>`
  return { html, fotos }
}

/** 6. FAQ: pregunta grande + respuesta, con signo dorado de fondo. */
function faq(s: SlotsPlantilla, C: { w: number; h: number }, o: OpcionesPlantilla): ResultadoPlantilla {
  const bg = bgColor(s.fondo || 'blanco')
  const oscuro = bg === NAVY
  const col = oscuro ? WHITE : NAVY
  // El "?" es una marca de agua gigante que sangra por la derecha; la pregunta
  // se apoya encima y la respuesta va sobre un panel. Antes el signo era un
  // caracter suelto más y la placa quedaba en tres bloques de texto apilados.
  const marca = ghost('?', { size: Math.round(C.h * 0.72), color: GOLD, opacidad: oscuro ? 0.16 : 0.20, top: -Math.round(C.h * 0.05), right: -Math.round(C.w * 0.04) })
  const panelBg = oscuro ? '#1c4c7c' : (bg === CREAM ? WHITE : '#f4f6f9')
  const eb = eyebrowChip(s.eyebrow || 'Preguntas frecuentes')
  const preg = s.titulo ? `<span style="font-family:Inter;font-weight:700;font-size:${fitFont(s.titulo, C.w - PAD * 2, 64, 38)}px;color:${col};line-height:1.18;margin-top:26px">${esc(clampText(s.titulo, 120))}</span>` : ''
  const resp = s.bajada
    ? `<div style="display:flex;flex-direction:row;gap:26px;margin-top:34px;background:${panelBg};border-radius:16px;padding:30px">${rielGold()}<span style="font-family:Inter;font-weight:400;font-size:30px;color:${oscuro ? SOFT : INK};line-height:1.42;flex:1">${esc(clampText(s.bajada, 260))}</span></div>`
    : ''
  const cta = ctaRow(s, oscuro)
  const lg = logoImg(oscuro ? o.logoBlanco : o.logoNavy, `bottom:52px;right:${PAD - 16}px`, 150)
  const body = `<div style="display:flex;flex-direction:column;flex:1;justify-content:center;padding:60px ${PAD}px ${ZONA_LOGO}px ${PAD}px">${eb}${preg}${resp}${cta}</div>`
  const html = `<div style="display:flex;flex-direction:column;position:relative;width:${C.w}px;height:${C.h}px;background:${bg}">${marca}${body}${lg}</div>`
  return { html, fotos: [] }
}

/** 7. PRECIO: tarjeta de plan (nombre + cifra + incluye + CTA). */
function precio(s: SlotsPlantilla, C: { w: number; h: number }, o: OpcionesPlantilla): ResultadoPlantilla {
  const bg = bgColor(s.fondo || 'navy')
  const oscuro = bg === NAVY
  const cardBg = oscuro ? WHITE : NAVY
  const cardCol = oscuro ? NAVY : WHITE
  const cardSub = oscuro ? INK : SOFT
  const cardW = C.w - PAD * 2
  const plan = s.eyebrow ? `<div style="display:flex;align-self:flex-start;background:${GOLD};border-radius:8px;padding:8px 20px"><span style="font-family:Inter;font-weight:700;font-size:23px;color:${NAVY};letter-spacing:1px">${esc((s.eyebrow || '').toUpperCase())}</span></div>` : ''
  const nombre = s.titulo ? `<span style="font-family:Inter;font-weight:700;font-size:${fitFont(s.titulo, cardW - 96, 46, 30)}px;color:${cardCol};line-height:1.15;margin-top:20px">${esc(clampText(s.titulo, 60))}</span>` : ''
  const cifra = s.dato ? `<span style="font-family:Inter;font-weight:700;font-size:${fitFont(s.dato, cardW - 96, 112, 56)}px;color:${GOLD};line-height:1.0;margin-top:16px">${esc(s.dato)}</span>` : ''
  const label = s.dato_label ? `<span style="font-family:Inter;font-weight:600;font-size:26px;color:${cardSub};margin-top:8px">${esc(clampText(s.dato_label, 46))}</span>` : ''
  const items = (s.bullets || []).slice(0, 4).map(b =>
    `<div style="display:flex;flex-direction:row;align-items:flex-start;gap:14px"><div style="display:flex;width:18px;height:4px;border-radius:2px;background:${GOLD};margin-top:14px;flex-shrink:0"></div><span style="font-family:Inter;font-weight:600;font-size:27px;color:${cardCol};line-height:1.3">${esc(clampText(b, 70))}</span></div>`).join('')
  const lista = items ? `<div style="display:flex;flex-direction:column;gap:14px;margin-top:28px">${items}</div>` : ''
  const ctaChip = s.cta ? `<div style="display:flex;align-items:center;justify-content:center;height:74px;background:${GOLD};border-radius:12px;margin-top:32px"><span style="font-family:Inter;font-weight:700;font-size:29px;color:${NAVY}">${esc(clampText(s.cta, 28))}</span></div>` : ''
  // La tarjeta OCUPA la zona segura (flex:1 + contenido centrado): una card de
  // plan que llena el lienzo se lee como diseño; flotando arriba parecía cortada.
  const card = `<div style="display:flex;flex-direction:column;justify-content:center;flex:1;width:${cardW}px;background:${cardBg};border-radius:22px;padding:48px 48px">${plan}${nombre}${cifra}${label}${lista}${ctaChip}</div>`
  const pie = s.pie ? `<span style="font-family:Inter;font-weight:400;font-size:22px;color:${oscuro ? SOFT : INK};margin-top:20px">${esc(clampText(s.pie, 90))}</span>` : ''
  const lg = logoImg(oscuro ? o.logoBlanco : o.logoNavy, `bottom:46px;right:${PAD - 16}px`, 132)
  const body = `<div style="display:flex;flex-direction:column;flex:1;padding:56px ${PAD}px ${ZONA_LOGO}px ${PAD}px">${card}${pie}</div>`
  const html = `<div style="display:flex;flex-direction:column;position:relative;width:${C.w}px;height:${C.h}px;background:${bg}">${body}${lg}</div>`
  return { html, fotos: [] }
}

/**
 * 8. ARCO: la foto dentro de un arco (rectángulo con la parte de arriba
 * redondeada) que llega hasta el borde superior, y el texto abajo.
 *
 * Antes esto era un CÍRCULO con anillo dorado y el dueño lo bajó (2026-08): una
 * foto redonda tipo foto de perfil se lee como HOMENAJE y competía con
 * `memorial_medallon`. El círculo con anillo queda RESERVADO para los
 * memoriales; para las piezas comerciales el arco da la misma calidez sin
 * ninguna connotación fúnebre.
 */
function arco(s: SlotsPlantilla, C: { w: number; h: number }, o: OpcionesPlantilla): ResultadoPlantilla {
  const fotos: FotoGrafico[] = []
  const src = pedirFoto(fotos, s.foto, 'principal', 'un perro mestizo sentado en el pasillo de su casa mirando a cámara con calma, luz de mañana', '3:4')
  const bg = bgColor(s.fondo || 'crema')
  const oscuro = bg === NAVY
  const col = oscuro ? WHITE : NAVY
  const arcoW = C.w - PAD * 2
  const arcoH = Math.round(C.h * 0.52)
  const radio = Math.round(arcoW / 2)
  const marco = `<div style="display:flex;width:${arcoW}px;height:${arcoH}px;overflow:hidden;border-radius:${radio}px ${radio}px 20px 20px;flex-shrink:0"><img src="${src}" width="${arcoW}" height="${arcoH}" style="object-fit:cover;object-position:center 30%;display:block" /></div>`
  const eb = s.eyebrow ? `<div style="display:flex;background:${GOLD};border-radius:8px;padding:8px 20px;margin-bottom:26px"><span style="font-family:Inter;font-weight:700;font-size:23px;color:${NAVY};letter-spacing:1px">${esc((s.eyebrow || '').toUpperCase())}</span></div>` : ''
  const tit = s.titulo ? `<span style="font-family:Inter;font-weight:700;font-size:${fitFont(s.titulo, arcoW, 58, 36)}px;color:${col};line-height:1.16;margin-top:38px">${esc(clampText(s.titulo, 90))}</span>` : ''
  const bajada = s.bajada ? `<span style="font-family:Inter;font-weight:400;font-size:28px;color:${oscuro ? SOFT : INK};line-height:1.4;margin-top:16px">${esc(clampText(s.bajada, 130))}</span>` : ''
  const cta = ctaRow(s, oscuro)
  const lg = logoImg(oscuro ? o.logoBlanco : o.logoNavy, `bottom:46px;right:${PAD - 16}px`, 132)
  const body = `<div style="display:flex;flex-direction:column;flex:1;padding:${PAD}px ${PAD}px ${ZONA_LOGO}px ${PAD}px">${eb}${marco}${tit}${bajada}${cta}</div>`
  const html = `<div style="display:flex;flex-direction:column;position:relative;width:${C.w}px;height:${C.h}px;background:${bg}">${body}${lg}</div>`
  return { html, fotos }
}

/** 9. BICOLOR: el lienzo partido en dos bloques de color, titular a caballo. */
function bicolor(s: SlotsPlantilla, C: { w: number; h: number }, o: OpcionesPlantilla): ResultadoPlantilla {
  const claro = bgColor(s.fondo === 'blanco' ? 'blanco' : 'crema')
  const altoTop = Math.round(C.h * 0.46)
  const fs = fitFont([s.titulo, s.titulo_destacado].filter((x): x is string => !!x).reduce((m, l) => (l.length > m.length ? l : m), ''), C.w - PAD * 2, 78, 40)
  const l1 = s.titulo ? `<span style="font-family:Inter;font-weight:700;font-size:${fs}px;color:${WHITE};line-height:1.08">${esc(s.titulo)}</span>` : ''
  const eb = s.eyebrow ? eyebrowChip(s.eyebrow) : ''
  const top = `<div style="display:flex;flex-direction:column;justify-content:flex-end;width:${C.w}px;height:${altoTop}px;background:${NAVY};padding:0 ${PAD}px 52px ${PAD}px;flex-shrink:0">${eb}${l1}</div>`
  const l2 = s.titulo_destacado ? `<span style="font-family:Inter;font-weight:700;font-size:${fs}px;color:${NAVY};line-height:1.08">${esc(s.titulo_destacado)}</span>` : ''
  const bajada = s.bajada ? `<span style="font-family:Inter;font-weight:400;font-size:29px;color:${INK};line-height:1.4;margin-top:22px">${esc(clampText(s.bajada, 150))}</span>` : ''
  const items = (s.bullets || []).slice(0, 3).map(b =>
    `<div style="display:flex;flex-direction:row;align-items:flex-start;gap:14px"><div style="display:flex;width:10px;height:10px;border-radius:5px;background:${GOLD};margin-top:11px;flex-shrink:0"></div><span style="font-family:Inter;font-weight:600;font-size:27px;color:${NAVY};line-height:1.3">${esc(clampText(b, 72))}</span></div>`).join('')
  const bullets = items ? `<div style="display:flex;flex-direction:column;gap:14px;margin-top:24px">${items}</div>` : ''
  const cta = ctaRow(s, false)
  const bottom = `<div style="display:flex;flex-direction:column;flex:1;justify-content:flex-start;padding:52px ${PAD}px ${ZONA_LOGO}px ${PAD}px">${l2}${bajada}${bullets}${cta}</div>`
  const lg = logoImg(o.logoNavy, `bottom:50px;right:${PAD - 16}px`, 150)
  const html = `<div style="display:flex;flex-direction:column;position:relative;width:${C.w}px;height:${C.h}px;background:${claro}">${top}${bottom}${lg}</div>`
  return { html, fotos: [] }
}

/** 10. CHECKLIST: cada item en su propia barra con filete dorado. */
function checklist(s: SlotsPlantilla, C: { w: number; h: number }, o: OpcionesPlantilla): ResultadoPlantilla {
  const bg = bgColor(s.fondo || 'navy')
  const oscuro = bg === NAVY
  const col = oscuro ? WHITE : NAVY
  const filaBg = oscuro ? '#1c4c7c' : WHITE
  const eb = s.eyebrow ? eyebrowChip(s.eyebrow) : ''
  const tit = (s.titulo || s.titulo_destacado) ? tituloBloque(s, col, C.w - PAD * 2, 56) : ''
  const rows = (s.bullets || []).slice(0, 5).map(b =>
    `<div style="display:flex;flex-direction:row;align-items:stretch;background:${filaBg};border-radius:12px;overflow:hidden"><div style="display:flex;width:10px;background:${GOLD};flex-shrink:0"></div><div style="display:flex;flex:1;padding:26px"><span style="font-family:Inter;font-weight:600;font-size:28px;color:${col};line-height:1.28">${esc(clampText(b, 78))}</span></div></div>`).join('')
  const lista = rows ? `<div style="display:flex;flex-direction:column;gap:16px;margin-top:36px">${rows}</div>` : ''
  const lg = logoImg(oscuro ? o.logoBlanco : o.logoNavy, `bottom:50px;right:${PAD - 16}px`, 140)
  const body = `<div style="display:flex;flex-direction:column;flex:1;justify-content:center;padding:60px ${PAD}px ${ZONA_LOGO}px ${PAD}px">${eb}${tit}${lista}</div>`
  const html = `<div style="display:flex;flex-direction:column;position:relative;width:${C.w}px;height:${C.h}px;background:${bg}">${body}${lg}</div>`
  return { html, fotos: [] }
}

/** 11. MOSAICO DE DATOS: grilla de 2×2 con cifras. */
function mosaico_datos(s: SlotsPlantilla, C: { w: number; h: number }, o: OpcionesPlantilla): ResultadoPlantilla {
  const bg = bgColor(s.fondo || 'crema')
  const oscuro = bg === NAVY
  const col = oscuro ? WHITE : NAVY
  const celdaBg = oscuro ? '#1c4c7c' : WHITE
  const tit = (s.titulo || s.titulo_destacado) ? tituloBloque(s, col, C.w - PAD * 2, 52) : ''
  const ds = (s.datos || []).slice(0, 4)
  const celdaW = Math.round((C.w - PAD * 2 - 18) / 2)
  // Tablero en DAMERO: una de cada dos celdas va en dorado con el texto en navy.
  // Cuatro cajitas idénticas se leían como una tabla; el damero le da ritmo.
  const celda = (d: { valor: string; label: string }, i: number) => {
    const inv = i % 3 === 0
    const fondoC = inv ? GOLD : celdaBg
    const valorC = inv ? NAVY : GOLD
    const labelC = inv ? NAVY : col
    return `<div style="display:flex;flex-direction:column;justify-content:center;width:${celdaW}px;flex:1;background:${fondoC};border-radius:16px;padding:0 28px"><span style="font-family:Inter;font-weight:700;font-size:${fitFont(d.valor, celdaW - 56, 78, 40)}px;color:${valorC};line-height:1.0">${esc(d.valor)}</span><span style="font-family:Inter;font-weight:600;font-size:24px;color:${labelC};line-height:1.25;margin-top:12px;opacity:${inv ? 0.82 : 1}">${esc(clampText(d.label, 46))}</span></div>`
  }
  const filas: string[] = []
  for (let i = 0; i < ds.length; i += 2) {
    filas.push(`<div style="display:flex;flex-direction:row;gap:18px;flex:1">${ds.slice(i, i + 2).map((d, j) => celda(d, i + j)).join('')}</div>`)
  }
  const grilla = filas.length ? `<div style="display:flex;flex-direction:column;gap:18px;flex:1;margin-top:38px">${filas.join('')}</div>` : ''
  const pie = s.pie ? `<span style="font-family:Inter;font-weight:400;font-size:23px;color:${oscuro ? SOFT : INK};margin-top:24px">${esc(clampText(s.pie, 90))}</span>` : ''
  const lg = logoImg(oscuro ? o.logoBlanco : o.logoNavy, `bottom:50px;right:${PAD - 16}px`, 140)
  const body = `<div style="display:flex;flex-direction:column;flex:1;padding:70px ${PAD}px ${ZONA_LOGO}px ${PAD}px">${tit}${grilla}${pie}</div>`
  const html = `<div style="display:flex;flex-direction:column;position:relative;width:${C.w}px;height:${C.h}px;background:${bg}">${body}${lg}</div>`
  return { html, fotos: [] }
}

/** 12. TESTIMONIO: avatar redondo + cita. Prueba social CON cara. */
function testimonio(s: SlotsPlantilla, C: { w: number; h: number }, o: OpcionesPlantilla): ResultadoPlantilla {
  const fotos: FotoGrafico[] = []
  const src = pedirFoto(fotos, s.foto, 'principal', 'retrato cálido de una mujer sonriendo suave abrazando a su perro en el living de su casa', '1:1')
  const bg = bgColor(s.fondo || 'blanco')
  const oscuro = bg === NAVY
  const col = oscuro ? WHITE : NAVY
  // Foto en cuadrado redondeado, NO en círculo con anillo: la foto redonda tipo
  // foto de perfil se lee como homenaje (pedido del dueño). El círculo queda
  // solo para `memorial_medallon`.
  const d = 300
  const avatar = `<div style="display:flex;width:${d}px;height:${d}px;overflow:hidden;border-radius:28px;flex-shrink:0"><img src="${src}" width="${d}" height="${d}" style="object-fit:cover;display:block" /></div>`
  const comilla = `<div style="display:flex;font-family:Inter;font-weight:700;font-size:180px;color:${GOLD};line-height:0.75">“</div>`
  const cabecera = `<div style="display:flex;flex-direction:row;align-items:center;gap:30px">${avatar}${comilla}</div>`
  // Cita en grande: es EL contenido de la pieza. Con 52px máx quedaba un bloque
  // chico flotando y medio lienzo vacío.
  const frase = s.titulo ? `<span style="font-family:Inter;font-weight:700;font-size:${fitFont(s.titulo, C.w - PAD * 2, 70, 38, 0.50)}px;color:${col};line-height:1.26;margin-top:44px">${esc(clampText(s.titulo, 220))}</span>` : ''
  const autor = s.bajada ? `<span style="font-family:Inter;font-weight:600;font-size:29px;color:${oscuro ? SOFT : INK};margin-top:32px">— ${esc(clampText(s.bajada, 60))}</span>` : ''
  const lg = logoImg(oscuro ? o.logoBlanco : o.logoNavy, `bottom:50px;right:${PAD - 16}px`, 140)
  const body = `<div style="display:flex;flex-direction:column;flex:1;justify-content:center;padding:58px ${PAD}px ${ZONA_LOGO}px ${PAD}px">${cabecera}${frase}${autor}</div>`
  const html = `<div style="display:flex;flex-direction:column;position:relative;width:${C.w}px;height:${C.h}px;background:${bg}">${body}${lg}</div>`
  return { html, fotos }
}

/** 13. HORARIO: filas clave→valor (días, cobertura, plazos). */
function horario(s: SlotsPlantilla, C: { w: number; h: number }, o: OpcionesPlantilla): ResultadoPlantilla {
  const bg = bgColor(s.fondo || 'navy')
  const oscuro = bg === NAVY
  const col = oscuro ? WHITE : NAVY
  const linea = oscuro ? '#2a5c8d' : '#dfe6ee'
  const eb = s.eyebrow ? eyebrowChip(s.eyebrow) : ''
  const tit = (s.titulo || s.titulo_destacado) ? tituloBloque(s, col, C.w - PAD * 2, 56) : ''
  // Filas con flex:1 → la tabla se REPARTE a lo alto y llena el lienzo (con las
  // filas apretadas quedaba media pieza vacía abajo).
  // Cada valor en un CHIP dorado y las filas en franjas alternadas: se lee como
  // un tablero de horarios, no como una lista de texto con guiones.
  const franja = oscuro ? '#1a4675' : (bg === CREAM ? '#f3ede2' : '#f4f6f9')
  const rows = (s.filas || []).slice(0, 5).map((f, i) =>
    `<div style="display:flex;flex-direction:row;align-items:center;justify-content:space-between;gap:20px;flex:1;padding:0 22px;background:${i % 2 === 0 ? franja : 'transparent'};border-radius:12px"><span style="font-family:Inter;font-weight:600;font-size:29px;color:${col}">${esc(clampText(f.izq, 34))}</span><div style="display:flex;background:${GOLD};border-radius:8px;padding:9px 18px"><span style="font-family:Inter;font-weight:700;font-size:27px;color:${NAVY}">${esc(clampText(f.der, 26))}</span></div></div>`).join('')
  const tabla = rows ? `<div style="display:flex;flex-direction:column;flex:1;margin-top:34px">${rows}</div>` : ''
  const pie = s.pie ? `<span style="font-family:Inter;font-weight:400;font-size:24px;color:${oscuro ? SOFT : INK};line-height:1.4;margin-top:26px">${esc(clampText(s.pie, 110))}</span>` : ''
  const cta = ctaRow(s, oscuro)
  const lg = logoImg(oscuro ? o.logoBlanco : o.logoNavy, `bottom:50px;right:${PAD - 16}px`, 140)
  const body = `<div style="display:flex;flex-direction:column;flex:1;padding:70px ${PAD}px ${ZONA_LOGO}px ${PAD}px">${eb}${tit}${tabla}${pie}${cta}</div>`
  const html = `<div style="display:flex;flex-direction:column;position:relative;width:${C.w}px;height:${C.h}px;background:${bg}">${body}${lg}</div>`
  return { html, fotos: [] }
}

/** 14. OVERLAY: foto a sangre + tarjeta clara flotando encima. */
function overlay(s: SlotsPlantilla, C: { w: number; h: number }, o: OpcionesPlantilla): ResultadoPlantilla {
  const fotos: FotoGrafico[] = []
  const src = pedirFoto(fotos, s.foto, 'principal', 'un perro golden retriever echado en la terraza de una casa al atardecer, luz cálida', '4:5', 'abajo')
  const cardBg = s.fondo === 'navy' ? NAVY : s.fondo === 'blanco' ? WHITE : CREAM
  const oscuro = cardBg === NAVY
  const col = oscuro ? WHITE : NAVY
  const cardW = C.w - PAD * 2
  const eb = s.eyebrow ? `<div style="display:flex;align-self:flex-start;background:${GOLD};border-radius:8px;padding:8px 20px;margin-bottom:22px"><span style="font-family:Inter;font-weight:700;font-size:23px;color:${NAVY};letter-spacing:1px">${esc((s.eyebrow || '').toUpperCase())}</span></div>` : ''
  const tit = (s.titulo || s.titulo_destacado) ? tituloBloque(s, col, cardW - 88, 52) : ''
  const bajada = s.bajada ? `<span style="font-family:Inter;font-weight:400;font-size:27px;color:${oscuro ? SOFT : INK};line-height:1.4;margin-top:16px">${esc(clampText(s.bajada, 140))}</span>` : ''
  const cta = ctaRow(s, oscuro)
  // El logo va EN EL FLUJO de la tarjeta, no absoluto: antes había que reservarle
  // 150px de padding muerto abajo y eso estiraba la tarjeta hasta media foto —
  // le tapaba la cara al animal (lo reportó el dueño con un gato).
  const lg = (oscuro ? o.logoBlanco : o.logoNavy)
    ? `<div style="display:flex;justify-content:flex-end;margin-top:26px"><img src="${esc((oscuro ? o.logoBlanco : o.logoNavy) as string)}" width="120" /></div>`
    : ''
  const card = `<div style="display:flex;flex-direction:column;position:absolute;left:${PAD}px;bottom:${PAD}px;width:${cardW}px;background:${cardBg};border-radius:22px;padding:40px 44px 34px 44px">${eb}${tit}${bajada}${cta}${lg}</div>`
  const html = `<div style="display:flex;position:relative;width:${C.w}px;height:${C.h}px;background:${NAVY}"><img src="${src}" width="${C.w}" height="${C.h}" style="object-fit:cover;object-position:center 16%;display:block" />${card}</div>`
  return { html, fotos }
}

/** 15. TIPOGRÁFICO: póster de una sola idea, la palabra manda. */
function tipografico(s: SlotsPlantilla, C: { w: number; h: number }, o: OpcionesPlantilla): ResultadoPlantilla {
  const bg = bgColor(s.fondo || 'navy')
  const oscuro = bg === NAVY
  const col = oscuro ? WHITE : NAVY
  const arriba = s.eyebrow ? `<span style="font-family:Inter;font-weight:700;font-size:26px;color:${GOLD};letter-spacing:3px">${esc((s.eyebrow || '').toUpperCase())}</span>` : ''
  const palabra = s.titulo ? `<span style="font-family:Inter;font-weight:700;font-size:${fitFont(s.titulo, C.w - PAD * 2, 190, 64, 0.56)}px;color:${col};line-height:0.98">${esc(s.titulo)}</span>` : ''
  const segunda = s.titulo_destacado ? `<span style="font-family:Inter;font-weight:700;font-size:${fitFont(s.titulo_destacado, C.w - PAD * 2, 190, 64, 0.56)}px;color:${GOLD};line-height:0.98">${esc(s.titulo_destacado)}</span>` : ''
  const regla = `<div style="display:flex;width:110px;height:7px;background:${GOLD};border-radius:4px;margin-top:34px"></div>`
  const abajo = s.bajada ? `<span style="font-family:Inter;font-weight:400;font-size:30px;color:${oscuro ? SOFT : INK};line-height:1.4;margin-top:30px">${esc(clampText(s.bajada, 130))}</span>` : ''
  const lg = logoImg(oscuro ? o.logoBlanco : o.logoNavy, `bottom:52px;right:${PAD - 16}px`, 150)
  const body = `<div style="display:flex;flex-direction:column;flex:1;justify-content:center;padding:64px ${PAD}px ${ZONA_LOGO}px ${PAD}px">${arriba}${palabra}${segunda}${regla}${abajo}</div>`
  const html = `<div style="display:flex;flex-direction:column;position:relative;width:${C.w}px;height:${C.h}px;background:${bg}">${body}${lg}</div>`
  return { html, fotos: [] }
}

// ─── MEMORIAL: homenaje a UNA mascota por su nombre ───────────────────────────
// Cinco estructuras distintas para lo mismo, porque es lo que más se publica y
// era siempre la misma pieza. Reglas de marca que aplican acá sí o sí: la
// mascota se ve VIVA y en calma (nunca enferma ni "ausente"), nada de urnas,
// lápidas, velas, arcoíris ni símbolos religiosos. `titulo` = el nombre de la
// mascota, `fechas` = sus años, `bajada` = la dedicatoria.

/** Nombre + años, el bloque tipográfico que comparten las cinco. */
/**
 * Logo de los MEMORIALES: SIEMPRE arriba a la derecha (decisión del dueño
 * 2026-08-06). Antes cada plantilla lo ponía donde le convenía —abajo al centro,
 * abajo a la derecha, arriba a la izquierda— y eso hacía dos cosas malas: el
 * homenaje se veía distinto en cada pieza, y el logo de abajo obligaba a
 * reservarle 200 px (ZONA_LOGO) que le robaban altura a la foto.
 *
 * CONTRASTE: sobre una foto no se puede saber qué hay detrás (la mitad de las
 * fotos son claras y el logo blanco desaparecía). Cuando va sobre foto se dibuja
 * un velo suave en la esquina, así el blanco se lee sobre cualquier imagen.
 * Sobre un fondo plano se usa la variante que contrasta con ese color.
 */
function logoMemorial(o: OpcionesPlantilla, C: { w: number; h: number }, opts: { sobreFoto?: boolean; claro?: boolean } = {}): string {
  const url = opts.sobreFoto || !opts.claro ? o.logoBlanco : o.logoNavy
  if (!url) return ''
  const velo = opts.sobreFoto
    ? `<div style="display:flex;position:absolute;top:0;right:0;width:${Math.round(C.w * 0.42)}px;height:${Math.round(C.h * 0.16)}px;background:linear-gradient(to bottom left, rgba(20,60,100,0.55) 0%, rgba(20,60,100,0) 72%)"></div>`
    : ''
  return `${velo}<img src="${esc(url)}" width="138" style="position:absolute;top:${PAD - 12}px;right:${PAD - 12}px" />`
}

function bloqueNombre(s: SlotsPlantilla, maxW: number, col: string, sub: string, fsMax: number, centrado = false): string {
  const alinear = centrado ? 'align-items:center;text-align:center' : 'align-items:flex-start'
  const nombre = s.titulo ? `<span style="font-family:Inter;font-weight:700;font-size:${fitFont(s.titulo, maxW, fsMax, 40, 0.55)}px;color:${col};line-height:1.02">${esc(clampText(s.titulo, 26))}</span>` : ''
  const fechas = s.fechas ? `<span style="font-family:Inter;font-weight:600;font-size:27px;letter-spacing:3px;color:${GOLD};margin-top:16px">${esc(clampText(s.fechas, 26))}</span>` : ''
  const dedic = s.bajada ? `<span style="font-family:Inter;font-weight:400;font-size:28px;color:${sub};line-height:1.45;margin-top:${s.fechas ? 20 : 16}px">${esc(clampText(s.bajada, 150))}</span>` : ''
  return `<div style="display:flex;flex-direction:column;${alinear}">${nombre}${fechas}${dedic}</div>`
}

/** M3. MEDALLÓN: foto circular con anillo dorado sobre un fondo con su nombre de fondo. */
function memorial_medallon(s: SlotsPlantilla, C: { w: number; h: number }, o: OpcionesPlantilla): ResultadoPlantilla {
  const fotos: FotoGrafico[] = []
  const src = pedirFoto(fotos, s.foto, 'principal', 'primer plano de la cara de un perro viejo de mirada tranquila, fondo de hogar desenfocado, luz cálida', '1:1')
  const bg = bgColor(s.fondo || 'navy')
  const oscuro = bg === NAVY
  const d = Math.min(C.w - PAD * 2, Math.round(C.h * 0.50))
  const marca = ghost(s.titulo || '', { size: Math.round(C.h * 0.34), color: oscuro ? WHITE : NAVY, opacidad: 0.07, top: Math.round(C.h * 0.10), left: -Math.round(C.w * 0.05) })
  const medallon = `<div style="display:flex;align-items:center;justify-content:center;width:${d + 26}px;height:${d + 26}px;border-radius:${Math.round((d + 26) / 2)}px;background:${GOLD}"><img src="${src}" width="${d}" height="${d}" style="object-fit:cover;border-radius:${Math.round(d / 2)}px;display:block" /></div>`
  const eb = s.eyebrow ? `<div style="display:flex;margin-bottom:30px"><span style="font-family:Inter;font-weight:700;font-size:20px;letter-spacing:4px;color:${GOLD}">${esc((s.eyebrow || '').toUpperCase())}</span></div>` : ''
  const nombre = `<div style="display:flex;margin-top:44px">${bloqueNombre(s, C.w - PAD * 2, oscuro ? WHITE : NAVY, oscuro ? SOFT : INK, 66, true)}</div>`
  const lg = logoMemorial(o, C, { claro: !oscuro })
  const body = `<div style="display:flex;flex-direction:column;flex:1;align-items:center;justify-content:center;padding:${ZONA_LOGO}px ${PAD}px 64px ${PAD}px">${eb}${medallon}${nombre}</div>`
  const html = `<div style="display:flex;flex-direction:column;position:relative;width:${C.w}px;height:${C.h}px;background:${bg}">${marca}${body}${lg}</div>`
  return { html, fotos }
}

/** M7. POLAROID: la foto como una instantánea de papel, con el nombre escrito en el borde blanco de abajo. */
function memorial_polaroid(s: SlotsPlantilla, C: { w: number; h: number }, o: OpcionesPlantilla): ResultadoPlantilla {
  const fotos: FotoGrafico[] = []
  const src = pedirFoto(fotos, s.foto, 'principal', 'una mascota jugando en el pasto del patio de su casa, instante espontáneo, luz de mediodía suave', '1:1')
  const cardW = Math.round(Math.min(C.w * 0.74, C.h * 0.52))
  const fotoLado = cardW - 64
  const marca = ghost(s.titulo || '', { size: Math.round(C.h * 0.30), color: WHITE, opacidad: 0.06, top: Math.round(C.h * 0.06), left: -Math.round(C.w * 0.04) })
  const pie = `<div style="display:flex;flex-direction:column;align-items:center;width:${fotoLado}px;margin-top:26px">${s.titulo ? `<span style="font-family:Inter;font-weight:700;font-size:${fitFont(s.titulo, fotoLado, 52, 32, 0.55)}px;color:${NAVY};line-height:1.05">${esc(clampText(s.titulo, 20))}</span>` : ''}${s.fechas ? `<span style="font-family:Inter;font-weight:600;font-size:22px;letter-spacing:3px;color:${GOLD};margin-top:10px">${esc(clampText(s.fechas, 26))}</span>` : ''}</div>`
  const card = `<div style="display:flex;flex-direction:column;align-items:center;width:${cardW}px;background:${WHITE};padding:32px 32px 44px 32px;border-radius:4px"><img src="${src}" width="${fotoLado}" height="${fotoLado}" style="object-fit:cover;display:block" />${pie}</div>`
  const dedic = s.bajada ? `<div style="display:flex;width:${Math.round(C.w * 0.78)}px;margin-top:44px"><span style="font-family:Inter;font-weight:400;font-size:27px;color:${SOFT};line-height:1.45;text-align:center">${esc(clampText(s.bajada, 130))}</span></div>` : ''
  const lg = logoMemorial(o, C)
  const body = `<div style="display:flex;flex-direction:column;flex:1;align-items:center;justify-content:center;padding:${ZONA_LOGO}px ${PAD}px 64px ${PAD}px">${card}${dedic}</div>`
  const html = `<div style="display:flex;flex-direction:column;position:relative;width:${C.w}px;height:${C.h}px;background:${NAVY}">${marca}${body}${lg}</div>`
  return { html, fotos }
}

/** M9. SUSURRO: casi sin foto — la dedicatoria en grande y un medallón pequeño arriba. */
function memorial_susurro(s: SlotsPlantilla, C: { w: number; h: number }, o: OpcionesPlantilla): ResultadoPlantilla {
  const fotos: FotoGrafico[] = []
  const src = pedirFoto(fotos, s.foto, 'principal', 'primer plano de la cara de una mascota, mirada dulce, fondo claro desenfocado', '1:1')
  const bg = bgColor(s.fondo || 'crema')
  const oscuro = bg === NAVY
  const d = Math.round(Math.min(C.w * 0.52, C.h * 0.34))
  const medallon = `<div style="display:flex;align-items:center;justify-content:center;width:${d + 16}px;height:${d + 16}px;border-radius:${Math.round((d + 16) / 2)}px;background:${GOLD}"><img src="${src}" width="${d}" height="${d}" style="object-fit:cover;border-radius:${Math.round(d / 2)}px;display:block" /></div>`
  const frase = s.bajada
    ? `<span style="font-family:Inter;font-weight:400;font-size:${fitFont(s.bajada, C.w - PAD * 2, 54, 30, 0.42)}px;color:${oscuro ? WHITE : NAVY};line-height:1.34;text-align:center">${esc(clampText(s.bajada, 160))}</span>`
    : ''
  const filete = `<div style="display:flex;width:80px;height:3px;background:${GOLD};border-radius:2px;margin:36px 0"></div>`
  const nombre = s.titulo ? `<span style="font-family:Inter;font-weight:700;font-size:${fitFont(s.titulo, C.w - PAD * 2, 54, 32, 0.55)}px;color:${oscuro ? WHITE : NAVY};line-height:1.05;text-align:center">${esc(clampText(s.titulo, 24))}</span>` : ''
  const fechas = s.fechas ? `<span style="font-family:Inter;font-weight:600;font-size:24px;letter-spacing:3px;color:${GOLD};margin-top:12px">${esc(clampText(s.fechas, 26))}</span>` : ''
  const lg = logoMemorial(o, C, { claro: !oscuro })
  const body = `<div style="display:flex;flex-direction:column;flex:1;align-items:center;justify-content:center;padding:${ZONA_LOGO}px ${PAD}px 64px ${PAD}px">${medallon}<div style="display:flex;margin-top:40px">${frase}</div>${filete}${nombre}${fechas}</div>`
  const html = `<div style="display:flex;flex-direction:column;position:relative;width:${C.w}px;height:${C.h}px;background:${bg}">${body}${lg}</div>`
  return { html, fotos }
}

/**
 * M13. SILUETA: foto a sangre bajo un velo navy y el nombre GIGANTE abajo a la
 * izquierda. Antes iba centrado en la mitad de la pieza, justo encima de la cara
 * de la mascota (el dueño lo rebotó con el caso "Maya"): bajarlo a la esquina
 * despeja el retrato y deja el nombre más grande todavía, anclado en una
 * diagonal de lectura natural (logo arriba a la derecha → nombre abajo a la
 * izquierda).
 */
function memorial_silueta(s: SlotsPlantilla, C: { w: number; h: number }, o: OpcionesPlantilla): ResultadoPlantilla {
  const fotos: FotoGrafico[] = []
  const src = pedirFoto(fotos, s.foto, 'principal', 'una mascota recortada contra la luz de una ventana, atmósfera serena y cálida, plano medio', '4:5', 'abajo')
  // El velo carga abajo: sostiene el texto sin apagar la foto en la parte alta.
  const velo = `<div style="display:flex;position:absolute;top:0;left:0;width:${C.w}px;height:${C.h}px;background:linear-gradient(to bottom, rgba(20,60,100,0.28) 0%, rgba(20,60,100,0.42) 45%, rgba(20,60,100,0.86) 100%)"></div>`
  const eb = s.eyebrow ? `<span style="font-family:Inter;font-weight:700;font-size:20px;letter-spacing:5px;color:${GOLD};margin-bottom:18px">${esc((s.eyebrow || '').toUpperCase())}</span>` : ''
  const anchoTexto = C.w - PAD * 2
  const nombre = s.titulo ? `<span style="font-family:Inter;font-weight:700;font-size:${fitFont(s.titulo, anchoTexto, 132, 56, 0.55)}px;color:${WHITE};line-height:0.98">${esc(clampText(s.titulo, 18))}</span>` : ''
  const fechas = s.fechas ? `<span style="font-family:Inter;font-weight:600;font-size:29px;letter-spacing:4px;color:${GOLD};margin-top:20px">${esc(clampText(s.fechas, 26))}</span>` : ''
  const dedic = s.bajada ? `<span style="font-family:Inter;font-weight:400;font-size:29px;color:${SOFT};line-height:1.42;margin-top:20px">${esc(clampText(s.bajada, 120))}</span>` : ''
  const filete = `<div style="display:flex;width:96px;height:4px;background:${GOLD};border-radius:2px;margin-bottom:30px"></div>`
  const pie = `<div style="display:flex;flex-direction:column;align-items:flex-start;justify-content:flex-end;position:absolute;top:0;left:0;width:${C.w}px;height:${C.h}px;padding:${PAD}px ${PAD}px 76px ${PAD}px">${filete}${eb}${nombre}${fechas}${dedic}</div>`
  const lg = logoMemorial(o, C, { sobreFoto: true })
  const html = `<div style="display:flex;position:relative;width:${C.w}px;height:${C.h}px;background:${NAVY}"><img src="${src}" width="${C.w}" height="${C.h}" style="object-fit:cover;object-position:center 25%;display:block" />${velo}${pie}${lg}</div>`
  return { html, fotos }
}

/** M14. DÍPTICO: mitad foto y mitad bloque crema con la dedicatoria; el nombre cruza abajo en una banda. */
function memorial_diptico(s: SlotsPlantilla, C: { w: number; h: number }, o: OpcionesPlantilla): ResultadoPlantilla {
  const fotos: FotoGrafico[] = []
  const src = pedirFoto(fotos, s.foto, 'principal', 'una mascota acurrucada en el sillón de la casa, luz cálida de tarde, plano cercano', '1:1')
  const bandaH = Math.round(C.h * 0.22)
  const arribaH = C.h - bandaH
  const mitad = Math.round(C.w / 2)
  const foto = `<div style="display:flex;width:${mitad}px;height:${arribaH}px;overflow:hidden;flex-shrink:0"><img src="${src}" width="${mitad}" height="${arribaH}" style="object-fit:cover;display:block" /></div>`
  const texto = `<div style="display:flex;flex-direction:column;justify-content:center;width:${C.w - mitad}px;height:${arribaH}px;background:${CREAM};padding:0 52px;flex-shrink:0">${s.eyebrow ? `<span style="font-family:Inter;font-weight:700;font-size:18px;letter-spacing:4px;color:${GOLD};margin-bottom:20px">${esc((s.eyebrow || '').toUpperCase())}</span>` : ''}${s.bajada ? `<span style="font-family:Inter;font-weight:400;font-size:30px;color:${INK};line-height:1.45">${esc(clampText(s.bajada, 160))}</span>` : ''}</div>`
  const arriba = `<div style="display:flex;flex-direction:row;width:${C.w}px;height:${arribaH}px;flex-shrink:0">${foto}${texto}</div>`
  const nombre = s.titulo ? `<span style="font-family:Inter;font-weight:700;font-size:${fitFont(s.titulo, C.w - PAD * 2 - 170, 68, 38, 0.55)}px;color:${GOLD};line-height:1.02">${esc(clampText(s.titulo, 22))}</span>` : ''
  const fechas = s.fechas ? `<span style="font-family:Inter;font-weight:600;font-size:24px;letter-spacing:3px;color:${SOFT};margin-top:12px">${esc(clampText(s.fechas, 26))}</span>` : ''
  const banda = `<div style="display:flex;flex-direction:column;justify-content:center;width:${C.w}px;height:${bandaH}px;background:${NAVY};padding:0 ${PAD}px;flex-shrink:0">${nombre}${fechas}</div>`
  // La esquina superior derecha SIEMPRE es el bloque crema (la foto va a la
  // izquierda), así que el logo va navy y sin velo: acá el contraste está
  // garantizado y el velo solo ensuciaba un fondo plano.
  const lg = logoMemorial(o, C, { claro: true })
  const html = `<div style="display:flex;flex-direction:column;position:relative;width:${C.w}px;height:${C.h}px;background:${CREAM}">${arriba}${banda}${lg}</div>`
  return { html, fotos }
}


// ═══════════════════════════════════════════════════════════════════════════
// CATÁLOGO — la ÚNICA fuente de verdad de qué es cada plantilla
// ═══════════════════════════════════════════════════════════════════════════
//
// Antes, lo que se sabía de UNA plantilla vivía repartido en nueve lugares:
// la lista de nombres, tres listas por categoría (memorial / con foto / familia),
// dos textos en prosa para el modelo, el mapa de builders y las muestras del
// script de preview. Nada los conectaba: agregar o sacar una plantilla obligaba a
// tocar los nueve y nada avisaba si te olvidabas de uno. Pasó dos veces el mismo
// día (2026-08-06): al sumar 10 memoriales quedaron dos listas sin actualizar, y
// al sacarlos aparecieron TRES archivos más con los nombres viejos escritos a
// mano. Ninguno rompía el build; el agente simplemente pedía plantillas que ya no
// existían.
//
// Ahora cada plantilla es UNA entrada acá y todo lo demás se DERIVA. Como el
// catálogo está tipado `Record<NombrePlantilla, …>`, TypeScript exige una entrada
// por plantilla: olvidarse deja de ser posible.
//
// DOS EJES, a propósito:
//   · `grupo`   = PARA QUÉ SIRVE  → es el eje por el que el agente ELIGE
//   · `familia` = A QUÉ SE PARECE → es el eje por el que el agente ROTA
// No se pueden colapsar en uno: dos plantillas del mismo grupo pueden verse
// completamente distintas, y dos de familias distintas pueden servir para lo
// mismo. Un solo árbol perdería la rotación visual, que es lo que evita que el
// feed se vea repetido.
//
// `cuando` es el campo que de verdad mueve la aguja: el modelo elegía mal porque
// las descripciones decían QUÉ ES cada plantilla ("foto a sangre + placa crema")
// y no CUÁNDO usarla. Escribilo pensando en el caso, no en el layout.

export type GrupoPlantilla = 'apertura' | 'explicar' | 'diferenciar' | 'vender' | 'confianza' | 'homenaje'

/** Para qué sirve cada grupo (lo lee el agente y lo usan los kits). */
export const GRUPOS: Record<GrupoPlantilla, string> = {
  apertura: 'Abrir una campaña o parar el scroll: la imagen manda y el texto es mínimo.',
  explicar: 'Contar cómo funciona el servicio, el proceso o resolver una duda concreta.',
  diferenciar: 'Mostrar por qué nosotros: cifras, comparaciones, argumentos duros.',
  vender: 'Precio, disponibilidad y llamado a la acción.',
  confianza: 'Prueba social y calidez: testimonios, caras, mascotas reales.',
  homenaje: 'Despedida de UNA mascota por su nombre. Nunca se mezcla con lo comercial.',
}

type Builder = (s: SlotsPlantilla, C: { w: number; h: number }, o: OpcionesPlantilla) => ResultadoPlantilla

export interface MetaPlantilla {
  grupo: GrupoPlantilla
  familia: FamiliaPlantilla
  /** Qué es, en una línea (catálogo visual y UI). */
  que: string
  /** CUÁNDO usarla. Es lo que el agente lee para decidir: hablá del CASO. */
  cuando: string
  /** Slot → qué va ahí EN ESTA plantilla. Antes esto estaba transpuesto (por
   *  slot, con "en 'faq' es la respuesta, en 'cita' el autor…") y para saber qué
   *  era `bajada` acá había que leer todos los slots y cazar la mención. */
  slots: Partial<Record<keyof SlotsPlantilla, string>>
  /** Sin estos la pieza no se sostiene. */
  requiere?: (keyof SlotsPlantilla)[]
  /** Cuántas fotos pide (0 = sin foto). */
  fotos: number
  builder: Builder
}

const FONDO = 'navy | crema | blanco'

export const CATALOGO: Record<NombrePlantilla, MetaPlantilla> = {
  // ── APERTURA ──────────────────────────────────────────────────────────────
  portada: {
    grupo: 'apertura', familia: 'apiladas', fotos: 1, builder: portada,
    que: 'Gancho de apertura: eyebrow + titular a dos líneas, foto opcional en banda arriba.',
    cuando: 'Abrís una campaña o una serie y necesitás una primera lámina que enmarque el tema.',
    slots: { eyebrow: 'Etiqueta corta (ej. "PARA VETERINARIOS")', titulo: '2-4 palabras', titulo_destacado: '2ª línea, sale en dorado', bajada: 'Una frase, máx ~120 car', foto: 'Opcional, va en banda arriba', fondo: FONDO, cta: 'Teléfono o acción', cta_secundario: 'Web' },
    requiere: ['titulo'],
  },
  revista: {
    grupo: 'apertura', familia: 'foto', fotos: 1, builder: revista,
    que: 'Portada editorial: foto a sangre en 2/3 del alto y banda sólida abajo con el titular.',
    cuando: 'Tenés una foto potente y querés abrir con impacto. La más linda para arrancar una campaña.',
    slots: { foto: 'Obligatoria, a sangre', eyebrow: 'Etiqueta corta', titulo: 'Titular', titulo_destacado: '2ª línea dorada', bajada: 'Frase de apoyo', cta: 'Acción', fondo: `Color de la banda (${FONDO})` },
    requiere: ['foto', 'titulo'],
  },
  foto: {
    grupo: 'apertura', familia: 'foto', fotos: 1, builder: foto,
    que: 'Foto protagonista a sangre con una sola frase encima.',
    cuando: 'La pieza es emocional o estética y el texto sobra. Si tenés algo que explicar, no es esta.',
    slots: { foto: 'Obligatoria; dejá despejada la zona del texto', titulo: 'UNA frase corta encima', fondo: FONDO },
    requiere: ['foto', 'titulo'],
  },
  overlay: {
    grupo: 'apertura', familia: 'foto', fotos: 1, builder: overlay,
    que: 'Foto a sangre con una tarjeta clara flotando abajo (no un velo).',
    cuando: 'Querés que se vea la foto ENTERA y aun así decir algo concreto. Se ve moderna.',
    slots: { foto: 'Obligatoria', eyebrow: 'Etiqueta', titulo: 'Titular', titulo_destacado: '2ª línea dorada', bajada: 'Apoyo', cta: 'Acción', fondo: 'Color de la tarjeta' },
    requiere: ['foto', 'titulo'],
  },
  arco: {
    grupo: 'apertura', familia: 'foto', fotos: 1, builder: arco,
    que: 'La foto dentro de un arco (rectángulo con el techo redondeado) y el texto abajo.',
    cuando: 'Presentás un retrato o un servicio con calidez editorial. Usala en vez del círculo: la foto REDONDA quedó reservada para los homenajes y en una pieza comercial se lee como memorial.',
    slots: { foto: 'Obligatoria', eyebrow: 'Etiqueta', titulo: 'Titular', bajada: 'Apoyo', cta: 'Acción', fondo: FONDO },
    requiere: ['foto', 'titulo'],
  },
  diptico: {
    grupo: 'apertura', familia: 'foto', fotos: 1, builder: diptico,
    que: 'Mitad foto / mitad color, con el titular CENTRADO.',
    cuando: 'Necesitás romper el ritmo: el resto de las plantillas alinea a la izquierda y esta centra.',
    slots: { foto: 'Obligatoria', titulo: 'Titular', titulo_destacado: '2ª línea dorada', bajada: 'Apoyo', fondo: FONDO },
    requiere: ['foto', 'titulo'],
  },
  tipografico: {
    grupo: 'apertura', familia: 'texto', fotos: 0, builder: tipografico,
    que: 'Póster de UNA idea: la tipografía gigante manda.',
    cuando: 'Tenés una frase de marca con peso propio y no querés competencia visual. Sin foto.',
    slots: { eyebrow: 'Línea chica arriba', titulo: 'La palabra o frase grande', titulo_destacado: '2ª línea en dorado', bajada: 'Cierre opcional' },
    requiere: ['titulo'],
  },

  // ── EXPLICAR ──────────────────────────────────────────────────────────────
  contenido: {
    grupo: 'explicar', familia: 'apiladas', fotos: 1, builder: contenido,
    que: 'Una idea con 2-4 apoyos cortos.',
    cuando: 'Lámina de carrusel educativa: una idea que necesita tres puntas para entenderse.',
    slots: { eyebrow: 'Etiqueta', titulo: 'La idea', bullets: '2-4, MUY cortos', bajada: 'Apoyo opcional', foto: 'Opcional', fondo: FONDO },
    requiere: ['titulo', 'bullets'],
  },
  numeros: {
    grupo: 'explicar', familia: 'listas', fotos: 0, builder: numeros,
    que: 'Lista NUMERADA con números dorados grandes.',
    cuando: 'Los items tienen ORDEN: pasos de un proceso, "3 razones para…". Si no hay orden, usá checklist.',
    slots: { eyebrow: 'Etiqueta', titulo: 'Titular', bajada: 'Apoyo', bullets: '2-4 pasos, muy cortos', fondo: FONDO },
    requiere: ['titulo', 'bullets'],
  },
  timeline: {
    grupo: 'explicar', familia: 'listas', fotos: 0, builder: timeline,
    que: 'Hitos enlazados por un riel dorado vertical.',
    cuando: 'Los items pasan EN EL TIEMPO: "qué pasa después de llamarnos". Es numeros pero con continuidad.',
    slots: { eyebrow: 'Etiqueta', titulo: 'Titular', bullets: '2-4 hitos', fondo: FONDO },
    requiere: ['titulo', 'bullets'],
  },
  checklist: {
    grupo: 'explicar', familia: 'listas', fotos: 0, builder: checklist,
    que: 'Cada item en su propia barra con filete dorado.',
    cuando: 'Enumerás cosas SIN orden y querés contundencia: "qué incluye", "lo que sí hacemos".',
    slots: { eyebrow: 'Etiqueta', titulo: 'Titular', bullets: '2-5 items', fondo: FONDO },
    requiere: ['titulo', 'bullets'],
  },
  faq: {
    grupo: 'explicar', familia: 'texto', fotos: 0, builder: faq,
    que: 'Una pregunta grande con signo dorado y su respuesta.',
    cuando: 'Respondés UNA duda real que la gente pregunta de verdad. Es el formato que más se lee.',
    slots: { eyebrow: 'Default "Preguntas frecuentes"', titulo: 'La PREGUNTA', bajada: 'La RESPUESTA, hasta ~260 car', cta: 'Acción', fondo: FONDO },
    requiere: ['titulo', 'bajada'],
  },
  split: {
    grupo: 'explicar', familia: 'foto', fotos: 1, builder: split,
    que: 'Editorial lado a lado: foto a la izquierda, texto a la derecha.',
    cuando: 'Una idea que necesita foto Y bullets a la vez, con aire de revista.',
    slots: { foto: 'Obligatoria', titulo: 'Titular', titulo_destacado: '2ª línea dorada', bajada: 'Apoyo', bullets: '2-3 opcionales', cta: 'Acción', fondo: 'Color del panel de texto' },
    requiere: ['foto', 'titulo'],
  },

  // ── DIFERENCIAR ───────────────────────────────────────────────────────────
  dato: {
    grupo: 'diferenciar', familia: 'cifras', fotos: 0, builder: dato,
    que: 'Una cifra o palabra enorme con su bajada.',
    cuando: 'Tenés UN número que habla solo ("4 días"). Si son varios, usá mosaico_datos.',
    slots: { dato: 'El número o palabra grande', dato_label: 'Qué es', bajada: 'Una línea de apoyo', fondo: FONDO },
    requiere: ['dato'],
  },
  mosaico_datos: {
    grupo: 'diferenciar', familia: 'cifras', fotos: 0, builder: mosaico_datos,
    que: 'Grilla 2×2 de cifras.',
    cuando: 'Tenés VARIOS números que se potencian juntos. Uno solo va en "dato".',
    slots: { titulo: 'Titular', titulo_destacado: '2ª línea dorada', datos: '2-4 celdas {valor, label}', pie: 'Letra chica', fondo: FONDO },
    requiere: ['datos'],
  },
  comparativa: {
    grupo: 'diferenciar', familia: 'listas', fotos: 0, builder: comparativa,
    que: 'Dos columnas enfrentadas: la nuestra destacada en dorado, "lo habitual" al lado.',
    cuando: 'Querés que la diferencia se vea de un vistazo. No la uses para hablar mal de nadie por su nombre.',
    slots: { titulo: 'Titular', titulo_b: 'Encabezado de NUESTRA columna', bullets: '2-4, lo nuestro', bullets_b: '2-4, lo otro', fondo: FONDO },
    requiere: ['titulo', 'bullets', 'bullets_b'],
  },
  bicolor: {
    grupo: 'diferenciar', familia: 'texto', fotos: 0, builder: bicolor,
    que: 'Lienzo partido navy/claro con el titular a caballo entre los dos bloques.',
    cuando: 'Un mensaje con dos mitades ("no es X, es Y") y querés que el diseño lo diga solo.',
    slots: { eyebrow: 'Etiqueta', titulo: 'Cae en el bloque navy', titulo_destacado: 'Cae en el bloque claro', bajada: 'Apoyo', bullets: '2-3', cta: 'Acción' },
    requiere: ['titulo', 'titulo_destacado'],
  },

  // ── VENDER ────────────────────────────────────────────────────────────────
  precio: {
    grupo: 'vender', familia: 'cifras', fotos: 0, builder: precio,
    que: 'Tarjeta de plan: cifra grande + qué incluye + CTA.',
    cuando: 'Publicás una tarifa concreta. Siempre con el pie que aclara que el valor depende del peso.',
    slots: { eyebrow: 'Nombre del plan', titulo: 'Tramo o servicio', dato: 'La cifra', dato_label: 'Qué cubre', bullets: '2-4, qué incluye', cta: 'Acción', pie: 'Letra chica obligatoria', fondo: FONDO },
    requiere: ['dato'],
  },
  cierre: {
    grupo: 'vender', familia: 'apiladas', fotos: 1, builder: cierre,
    que: 'Lámina final con el llamado a la acción.',
    cuando: 'Cerrás un carrusel o una campaña y necesitás dejar el teléfono y la web.',
    slots: { titulo: 'Titular', titulo_destacado: '2ª línea dorada', cta: 'Teléfono', cta_secundario: 'Web', bajada: 'Apoyo', foto: 'Opcional, banda arriba', fondo: FONDO },
    requiere: ['titulo', 'cta'],
  },
  horario: {
    grupo: 'vender', familia: 'texto', fotos: 0, builder: horario,
    que: 'Filas clave → valor con líneas.',
    cuando: 'Datos operativos tabulados: horarios, cobertura por comuna, plazos.',
    slots: { eyebrow: 'Etiqueta', titulo: 'Titular', filas: '2-5 pares {izq, der}', pie: 'Letra chica', cta: 'Acción', fondo: FONDO },
    requiere: ['filas'],
  },

  // ── CONFIANZA ─────────────────────────────────────────────────────────────
  cita: {
    grupo: 'confianza', familia: 'texto', fotos: 0, builder: cita,
    que: 'Frase destacada con una gran comilla dorada.',
    cuando: 'Tenés un testimonio o una frase de marca y NO tenés (o no querés) foto del tutor.',
    slots: { titulo: 'La frase, 1-2 líneas', bajada: 'Autor ("María, tutora de Rocky")', eyebrow: 'Etiqueta', fondo: FONDO },
    requiere: ['titulo'],
  },
  testimonio: {
    grupo: 'confianza', familia: 'texto', fotos: 1, builder: testimonio,
    que: 'Foto del tutor en cuadrado redondeado + comilla + la cita.',
    cuando: 'Mismo caso que "cita" pero CON cara: la prueba social pesa más con una persona real.',
    slots: { foto: 'Obligatoria: retrato cálido de un tutor con su mascota', titulo: 'El testimonio', bajada: 'Autor', fondo: FONDO },
    requiere: ['foto', 'titulo'],
  },
  marco: {
    grupo: 'confianza', familia: 'foto', fotos: 1, builder: marco,
    que: 'Foto enmarcada estilo galería, centrada y con aire, más un pie.',
    cuando: 'Querés que la foto respire sobre el color de marca. A diferencia de "foto" (a sangre), acá se ve como un objeto cuidado.',
    slots: { foto: 'Obligatoria', titulo: 'Frase o pie centrado', bajada: 'Autor o contexto', fondo: FONDO },
    requiere: ['foto'],
  },
  collage: {
    grupo: 'confianza', familia: 'foto', fotos: 3, builder: collage,
    que: 'Mosaico de 3 fotos (1 grande + 2 chicas) con el titular abajo.',
    cuando: 'Querés mostrar VARIEDAD: distintas mascotas, un día de trabajo. Necesita tres fotos que convivan.',
    slots: { fotos: '3 fotos {prompt}', titulo: 'Titular', titulo_destacado: '2ª línea dorada', bajada: 'Apoyo', fondo: FONDO },
    requiere: ['fotos'],
  },

  // ── HOMENAJE ──────────────────────────────────────────────────────────────
  // En las cinco: titulo = el NOMBRE de la mascota · fechas = sus años
  // ("2014 — 2026") · bajada = la dedicatoria (concreta y cotidiana, no un lugar
  // común) · eyebrow = "En memoria" / "Hasta siempre" · foto = retrato CÁLIDO de
  // la mascota VIVA y en calma. Jamás enferma ni "ausente"; nada de urnas,
  // lápidas, velas, arcoíris ni símbolos religiosos.
  memorial_silueta: {
    grupo: 'homenaje', familia: 'memorial', fotos: 1, builder: memorial_silueta,
    que: 'Foto a sangre bajo un velo navy y el nombre GIGANTE abajo a la izquierda.',
    cuando: 'La foto es buena y tiene que mandar. El velo la sostiene aunque la foto sea clara. La más impactante.',
    slots: { foto: 'Obligatoria', titulo: 'El nombre', fechas: 'Sus años', bajada: 'La dedicatoria', eyebrow: '"En memoria" / "Hasta siempre"' },
    requiere: ['foto', 'titulo'],
  },
  memorial_diptico: {
    grupo: 'homenaje', familia: 'memorial', fotos: 1, builder: memorial_diptico,
    que: 'Mitad foto y mitad bloque crema con la dedicatoria; el nombre cruza abajo en una banda navy.',
    cuando: 'La foto es DUDOSA (mal encuadrada, con gente, poca luz). Es la única donde el texto nunca se apoya sobre la foto: la más segura.',
    slots: { foto: 'Obligatoria', titulo: 'El nombre', fechas: 'Sus años', bajada: 'La dedicatoria', eyebrow: 'Etiqueta' },
    requiere: ['foto', 'titulo'],
  },
  memorial_polaroid: {
    grupo: 'homenaje', familia: 'memorial', fotos: 1, builder: memorial_polaroid,
    que: 'La foto como una instantánea de papel blanco, con el nombre en el borde de abajo.',
    cuando: 'Buscás calidez de álbum familiar. Funciona muy bien con fotos caseras de celular.',
    slots: { foto: 'Obligatoria', titulo: 'El nombre', fechas: 'Sus años', bajada: 'La dedicatoria' },
    requiere: ['foto', 'titulo'],
  },
  memorial_medallon: {
    grupo: 'homenaje', familia: 'memorial', fotos: 1, builder: memorial_medallon,
    que: 'Foto en un medallón circular con anillo dorado y el nombre gigante de fondo.',
    cuando: 'Querés el tono más solemne — y SOLO si la cara de la mascota está centrada: el círculo recorta las esquinas.',
    slots: { foto: 'Obligatoria, cara centrada', titulo: 'El nombre', fechas: 'Sus años', bajada: 'La dedicatoria', eyebrow: 'Etiqueta', fondo: FONDO },
    requiere: ['foto', 'titulo'],
  },
  memorial_susurro: {
    grupo: 'homenaje', familia: 'memorial', fotos: 1, builder: memorial_susurro,
    que: 'La dedicatoria en grande y la foto en un medallón chico arriba.',
    cuando: 'El tutor escribió algo lindo y el TEXTO vale más que la imagen. Sin dedicatoria, no la uses.',
    slots: { foto: 'Obligatoria', bajada: 'La dedicatoria (es la protagonista)', titulo: 'El nombre', fechas: 'Sus años', fondo: FONDO },
    requiere: ['foto', 'bajada'],
  },
}

// ─── Derivados: NADA de esto se escribe a mano ───────────────────────────────

const ENTRADAS = Object.entries(CATALOGO) as [NombrePlantilla, MetaPlantilla][]

export const FAMILIA = Object.fromEntries(
  ENTRADAS.map(([n, m]) => [n, m.familia]),
) as Record<NombrePlantilla, FamiliaPlantilla>

export const PLANTILLAS_CON_FOTO: NombrePlantilla[] = ENTRADAS.filter(([, m]) => m.fotos > 0).map(([n]) => n)
export const PLANTILLAS_MEMORIAL: NombrePlantilla[] = ENTRADAS.filter(([, m]) => m.grupo === 'homenaje').map(([n]) => n)
export const PLANTILLAS_POR_GRUPO = ENTRADAS.reduce((acc, [n, m]) => {
  (acc[m.grupo] ||= []).push(n)
  return acc
}, {} as Record<GrupoPlantilla, NombrePlantilla[]>)

const BUILDERS = Object.fromEntries(ENTRADAS.map(([n, m]) => [n, m.builder])) as Record<NombrePlantilla, Builder>

export const familiaDe = (p?: string): FamiliaPlantilla | null =>
  (p && FAMILIA[p as NombrePlantilla]) || null

/** ¿Esta plantilla muestra una foto? (para exigir fotos en una tanda). */
export const llevaFoto = (p?: string): boolean =>
  !!p && PLANTILLAS_CON_FOTO.includes(p as NombrePlantilla)

/** Una línea por plantilla: "nombre — cuándo usarla". */
function fichaCorta(n: NombrePlantilla): string {
  return `${n} (${CATALOGO[n].cuando})`
}

/** Ficha completa: qué es, cuándo usarla y qué va en cada slot. */
function fichaLarga(n: NombrePlantilla): string {
  const m = CATALOGO[n]
  const slots = Object.entries(m.slots).map(([k, v]) => `${k}: ${v}`).join(' · ')
  const req = m.requiere?.length ? ` OBLIGATORIOS: ${m.requiere.join(', ')}.` : ''
  return `- "${n}": ${m.que}\n  USALA CUANDO ${m.cuando}\n  slots → ${slots}.${req}`
}

/**
 * Descripción del enum `plantilla` para las TOOLS del modelo. Se genera del
 * catálogo, así que sumar una plantilla ya no deja esto desactualizado.
 */
export const PLANTILLA_TOOL_DESC =
  'Qué plantilla usar. Elegí por el CASO (qué tenés y qué querés lograr), no por gusto. ' +
  (Object.keys(GRUPOS) as GrupoPlantilla[])
    .map(g => `${g.toUpperCase()} — ${GRUPOS[g]} ${(PLANTILLAS_POR_GRUPO[g] || []).map(fichaCorta).join(' · ')}`)
    .join(' ') +
  ' ROTÁ: no repitas plantilla ni familia dentro de una misma tanda; al menos 1 de cada 3 piezas con FOTO.'

export const PLANTILLAS_INFO = `PLANTILLAS DISPONIBLES (elegí UNA y llená sus slots; el layout ya es on-brand y no se rompe).
Están agrupadas por PARA QUÉ SIRVEN. Elegí primero el grupo según lo que necesitás lograr y después la plantilla según el CASO que describe su "USALA CUANDO" — no por cuál te gusta más.

${(Object.keys(GRUPOS) as GrupoPlantilla[]).map(g =>
  `${g.toUpperCase()} — ${GRUPOS[g]}\n${(PLANTILLAS_POR_GRUPO[g] || []).map(fichaLarga).join('\n')}`,
).join('\n\n')}

ENCUADRE DE LAS FOTOS (regla dura — el dueño rebotó una pieza donde una placa le tapaba el hocico al gato): en las plantillas que apoyan TEXTO ENCIMA de la foto ("foto", "overlay", "memorial_silueta", y las bandas de "portada" y "revista"), el prompt de la foto DEBE dejar despejada la zona donde va el texto: mascota en la mitad de arriba y la mitad de abajo libre (piso, manta, pasto, fondo liso). El sistema ya le agrega esa exigencia al prompt, pero escribilo vos también en la descripción de la escena. Y en TODAS: la cara y los ojos de la mascota se ven COMPLETOS, nunca cortados por el borde ni tapados por un bloque de texto, un velo o el logo.

Reglas: textos CORTOS (si no caben, se recortan). El fondo alterna navy/crema/blanco entre piezas — la PORTADA también (ya NO es siempre navy): máximo ~1 de cada 3 piezas de una misma tanda con fondo navy dominante. La foto: mascota viva y feliz o tutor con su mascota, cálida; NUNCA instalaciones. El logo se coloca solo.
ROTACIÓN (regla dura, feedback del dueño "los posts son siempre parecidos"): hay ${ENTRADAS.length} plantillas. En una misma tanda/carrusel NO repitas plantilla, y NO uses dos veces seguidas la misma FAMILIA (${[...new Set(ENTRADAS.map(([, m]) => m.familia))].map(f => `${f}: ${ENTRADAS.filter(([, m]) => m.familia === f).map(([n]) => n).join('/')}`).join(' · ')}). Al menos 1 de cada 3 piezas tiene que llevar FOTO. En los HOMENAJES: nunca dos memoriales seguidos con la misma plantilla. Si te pasan las "ÚLTIMAS PIEZAS GENERADAS", elegí plantillas de familias que NO aparezcan ahí.`

/**
 * Candidatas para un encargo concreto. La idea es NO volcarle las ${'${n}'} plantillas al
 * modelo: con 29 opciones delante elige peor (y se pagan los tokens de todas).
 * Filtrando en código antes de la llamada, ve solo las que sirven.
 *
 * `evitarFamilias` sale de las últimas piezas publicadas: así la rotación deja de
 * depender de que el modelo se acuerde.
 */
export function candidatas(opts: {
  grupo?: GrupoPlantilla | GrupoPlantilla[]
  conFoto?: boolean
  evitarFamilias?: FamiliaPlantilla[]
  max?: number
} = {}): NombrePlantilla[] {
  const grupos = opts.grupo ? (Array.isArray(opts.grupo) ? opts.grupo : [opts.grupo]) : null
  const evitar = new Set(opts.evitarFamilias || [])
  let out = ENTRADAS
    // El homenaje NUNCA se mezcla: o lo pediste explícitamente, o no aparece.
    .filter(([, m]) => (grupos ? grupos.includes(m.grupo) : m.grupo !== 'homenaje'))
    .filter(([, m]) => (opts.conFoto === undefined ? true : opts.conFoto ? m.fotos > 0 : m.fotos === 0))
  const sinEvitadas = out.filter(([, m]) => !evitar.has(m.familia))
  // Si evitar familias deja la lista vacía, vale más ofrecer algo que nada.
  if (sinEvitadas.length > 0) out = sinEvitadas

  // RONDA POR FAMILIA, no los primeros N. El catálogo está ordenado por grupo y
  // dentro de un grupo las familias se agrupan (apertura arranca con tres "foto"
  // seguidas), así que cortar los primeros N devolvía una lista monótona — y una
  // lista monótona da un carrusel monótono. Tomando de a una por familia, la
  // preselección SIEMPRE es variada y el modelo no puede elegir mal aunque quiera.
  const porFamilia = new Map<FamiliaPlantilla, NombrePlantilla[]>()
  for (const [n, m] of out) porFamilia.set(m.familia, [...(porFamilia.get(m.familia) || []), n])
  const colas = [...porFamilia.values()]
  const orden: NombrePlantilla[] = []
  for (let i = 0; orden.length < out.length; i++) {
    for (const cola of colas) if (cola[i]) orden.push(cola[i])
  }
  return orden.slice(0, opts.max ?? 8)
}

/**
 * Sugerencia de plantillas para UNA tanda (carrusel o lote de piezas).
 *
 * Devuelve `n` plantillas de familias DISTINTAS entre sí, y distintas también de
 * las de la pieza anterior. Es la versión proactiva de la regla de rotación: el
 * lint la controla después, pero llegar con una preselección ya variada evita el
 * rechazo y, sobre todo, evita el carrusel de cinco láminas que se ven iguales
 * (queja del dueño: "los posts son siempre parecidos").
 *
 * No es una imposición: el modelo puede apartarse si el contenido lo pide. Es el
 * punto de partida, que es donde se juega la variedad.
 */
export function sugerenciasParaTanda(n: number, opts: {
  grupo?: GrupoPlantilla | GrupoPlantilla[]
  evitarFamilias?: FamiliaPlantilla[]
} = {}): NombrePlantilla[] {
  const pool = candidatas({ ...opts, max: 999 })
  const out: NombrePlantilla[] = []
  const usadas = new Set<FamiliaPlantilla>()
  // 1ª pasada: una por familia (el orden ya viene rotado por candidatas).
  for (const p of pool) {
    if (out.length >= n) break
    const f = CATALOGO[p].familia
    if (usadas.has(f)) continue
    usadas.add(f); out.push(p)
  }
  // 2ª pasada: si piden más piezas que familias hay, se completa sin repetir
  // plantilla (dos de la misma familia, pero nunca la misma plantilla dos veces).
  for (const p of pool) {
    if (out.length >= n) break
    if (!out.includes(p)) out.push(p)
  }
  return out
}

/** Ficha de las candidatas, lista para inyectar en el prompt. */
export function infoDe(nombres: NombrePlantilla[]): string {
  return nombres.map(fichaLarga).join('\n')
}

// ─── KITS: estilos de tanda ──────────────────────────────────────────────────
//
// Un kit es, simplemente, QUÉ GRUPOS entran en juego. Con el catálogo esto es
// una lista; sin él habría que cablear cada kit contra las nueve listas viejas.
// Sirven para que una campaña entera tenga un carácter (una de lanzamiento no se
// parece a una de captación de veterinarios) sin repetir siempre las mismas
// plantillas dentro de ella: la variedad la sigue dando `sugerenciasParaTanda`,
// que rota por familia PUERTAS ADENTRO del kit.

export interface KitPlantillas {
  nombre: string
  /** Para qué sirve, en una línea (lo lee el agente y se muestra en la UI). */
  para: string
  grupos: GrupoPlantilla[]
}

export const KITS: Record<string, KitPlantillas> = {
  lanzamiento: {
    nombre: 'Lanzamiento',
    para: 'Presentar un servicio o abrir una campaña: engancha, explica y cierra pidiendo la acción.',
    grupos: ['apertura', 'explicar', 'vender'],
  },
  educativo: {
    nombre: 'Educativo',
    para: 'Enseñar cómo funciona el proceso y responder las dudas reales, sin vender de frente.',
    grupos: ['explicar', 'confianza'],
  },
  confianza: {
    nombre: 'Confianza',
    para: 'Prueba social y calidez: testimonios, caras y mascotas reales para quien nos está evaluando.',
    grupos: ['confianza', 'apertura'],
  },
  veterinarias: {
    nombre: 'Veterinarias (B2B)',
    para: 'Hablarle a las clínicas: argumentos duros, plazos y condiciones. Menos emoción, más datos.',
    grupos: ['diferenciar', 'explicar', 'vender'],
  },
  despedidas: {
    nombre: 'Despedidas',
    para: 'Homenajes a mascotas por su nombre. Va solo: nunca se mezcla con piezas comerciales.',
    grupos: ['homenaje'],
  },
}

/** Grupos de un kit; si el nombre no existe, no se acota nada (todos menos homenaje). */
export function gruposDeKit(kit?: string): GrupoPlantilla[] | undefined {
  const k = KITS[(kit || '').trim().toLowerCase()]
  return k?.grupos
}

/** Catálogo de kits para el prompt / la UI. */
export const KITS_INFO = Object.entries(KITS)
  .map(([id, k]) => `- "${id}" (${k.nombre}): ${k.para} Usa: ${k.grupos.join(', ')}.`)
  .join('\n')

/** Construye el HTML on-brand de una plantilla + las fotos a generar. */
export function construirPlantilla(nombre: string, slots: SlotsPlantilla, opts: OpcionesPlantilla = {}): ResultadoPlantilla {
  const n = (nombre || '').trim()
  // Un nombre desconocido cae a `portada`… salvo que sea un MEMORIAL: una pieza
  // guardada con una de las 10 plantillas de homenaje que se retiraron saldría
  // como una portada comercial, con el nombre de la mascota de titular. Se cae a
  // un homenaje, que es lo que la pieza quería ser.
  const builder = BUILDERS[n as NombrePlantilla]
    || (n.startsWith('memorial') ? BUILDERS[PLANTILLAS_MEMORIAL[0]] : portada)
  const C = DIMS[opts.formato || 'post_vertical'] || DIMS.post_vertical
  return builder(slots || {}, C, opts)
}
