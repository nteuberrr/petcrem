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
}

export interface OpcionesPlantilla {
  formato?: string
  logoBlanco?: string  // logo variante blanca (para fondos oscuros/foto)
  logoNavy?: string    // logo variante navy (para fondos claros)
}

export interface ResultadoPlantilla { html: string; fotos: FotoGrafico[] }

export const PLANTILLAS = ['portada', 'contenido', 'dato', 'foto', 'cierre', 'cita', 'split'] as const
export type NombrePlantilla = (typeof PLANTILLAS)[number]

/** Guía de slots por plantilla, para el prompt/tool del modelo. */
export const PLANTILLAS_INFO = `PLANTILLAS DISPONIBLES (elegí UNA y llená sus slots; el layout ya es on-brand y no se rompe):
- "portada": gancho/apertura. slots: eyebrow (corto, ej. "PARA VETERINARIOS"), titulo (2-4 palabras), titulo_destacado (2ª línea, sale en dorado), bajada (1 frase corta, máx ~120 car), foto {prompt} (opcional; va en banda arriba), fondo (navy/crema/blanco), cta + cta_secundario (opcional). NO lleva bullets.
- "contenido": una idea con apoyos. slots: eyebrow (opcional), titulo, bullets (2-4, MUY cortos), bajada (opcional), foto {prompt} (opcional), fondo. Para láminas de carrusel educativas.
- "dato": una cifra/palabra fuerte. slots: dato (el número/palabra grande, ej. "4 días"), dato_label (qué es), bajada (1 línea de apoyo), fondo.
- "foto": foto protagonista, casi sin texto. slots: foto {prompt} (obligatoria), titulo (UNA frase corta encima), fondo. Para piezas emocionales/estéticas.
- "cierre": llamado a la acción final. slots: titulo, cta (ej. teléfono), cta_secundario (web), bajada (opcional), fondo, foto {prompt} (opcional, banda arriba).
- "cita": testimonio o frase destacada (gran comilla dorada). slots: titulo (la frase/testimonio, ~1-2 líneas), bajada (autor: "María, tutora de Rocky" o "Clínica X"), eyebrow (opcional), fondo (default crema/claro). SIN foto. Ideal para PRUEBA SOCIAL y frases de marca.
- "split": editorial lado-a-lado — foto a la izquierda, texto a la derecha (layout DISTINTO a los apilados). slots: foto {prompt} (obligatoria), titulo, titulo_destacado (opcional, dorado), bajada (opcional), bullets (2-3, opcional), cta (opcional), fondo (del panel de texto; default crema). Para una idea con una foto potente, con aire de revista.
Reglas: textos CORTOS (si no caben, se recortan). El fondo alterna navy/crema/blanco entre piezas — la PORTADA también (ya NO es siempre navy): NO dejes todas las portadas en navy, variá a crema o blanco (o con la foto mandando) para que el feed no se vea "todo azul". Regla práctica: máximo ~1 de cada 3 piezas de una misma tanda con fondo navy dominante. La foto: mascota viva y feliz o tutor con su mascota, cálida; NUNCA instalaciones. El logo se coloca solo.`

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
function bgColor(fondo?: string): string {
  return fondo === 'crema' ? CREAM : fondo === 'blanco' ? WHITE : NAVY
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
    if (!s.foto!.url) fotos.push({ slot: 'principal', prompt: s.foto!.prompt || 'una mascota viva y feliz junto a su tutor, luz cálida natural', aspect: '3:2' })
    const eb = s.eyebrow ? eyebrowChip(s.eyebrow, { top: 44, left: PAD - 16 }) : ''
    const lg = logoImg(o.logoBlanco, `top:40px;right:${PAD - 16}px`, 150)
    banda = `<div style="display:flex;position:relative;width:${C.w}px;height:${bandaH}px;overflow:hidden;flex-shrink:0"><img src="${src}" width="${C.w}" height="${bandaH}" style="object-fit:cover;object-position:center 35%;display:block" />${eb}${lg}</div>`
  }
  const eyebrowText = !conFoto && s.eyebrow ? eyebrowChip(s.eyebrow) : ''
  const tit = tituloBloque(s, oscuro ? WHITE : NAVY, C.w - PAD * 2, 86)
  const bajada = s.bajada ? `<span style="font-family:Inter;font-weight:400;font-size:32px;color:${oscuro ? SOFT : INK};line-height:1.4;margin-top:26px">${esc(clampText(s.bajada, 130))}</span>` : ''
  const cta = ctaRow(s, oscuro)
  const lgBottom = logoImg(oscuro ? o.logoBlanco : o.logoNavy, `bottom:52px;right:${PAD - 16}px`, 168)
  const textBlock = `<div style="display:flex;flex-direction:column;flex:1;justify-content:center;padding:64px ${PAD}px 120px ${PAD}px">${eyebrowText}${tit}${bajada}${ruleGold()}${cta}</div>`
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
  // 90 (no 42): el bullet puede pasar a 2 líneas igual que la bajada — el límite
  // corto cortaba bullets normales a mitad de palabra ("exposición d…").
  const items = (s.bullets || []).slice(0, 4).map(b =>
    `<div style="display:flex;flex-direction:row;align-items:flex-start;gap:16px"><div style="display:flex;width:11px;height:11px;border-radius:6px;background:${GOLD};margin-top:12px;flex-shrink:0"></div><span style="font-family:Inter;font-weight:600;font-size:30px;color:${col};line-height:1.3">${esc(clampText(b, 90))}</span></div>`).join('')
  const bullets = items ? `<div style="display:flex;flex-direction:column;gap:18px;margin-top:34px">${items}</div>` : ''
  const lg = logoImg(oscuro ? o.logoBlanco : o.logoNavy, `bottom:52px;right:${PAD - 16}px`, 150)
  const body = `<div style="display:flex;flex-direction:column;flex:1;justify-content:center;padding:56px ${PAD}px 120px ${PAD}px">${eb}${tit}${bajada}${bullets}</div>`
  const html = `<div style="display:flex;flex-direction:column;position:relative;width:${C.w}px;height:${C.h}px;background:${bg}">${banda}${body}${lg}</div>`
  return { html, fotos }
}

function dato(s: SlotsPlantilla, C: { w: number; h: number }, o: OpcionesPlantilla): ResultadoPlantilla {
  const bg = bgColor(s.fondo || 'navy')
  const oscuro = bg === NAVY
  const col = oscuro ? WHITE : NAVY
  const eb = s.eyebrow ? eyebrowChip(s.eyebrow) : ''
  const big = s.dato ? `<span style="font-family:Inter;font-weight:700;font-size:${fitFont(s.dato, C.w - PAD * 2, 200, 90)}px;color:${GOLD};line-height:1.0">${esc(s.dato)}</span>` : ''
  const label = s.dato_label ? `<span style="font-family:Inter;font-weight:700;font-size:${fitFont(s.dato_label, C.w - PAD * 2, 56, 34)}px;color:${col};line-height:1.15;margin-top:12px">${esc(clampText(s.dato_label, 40))}</span>` : ''
  const bajada = s.bajada ? `<span style="font-family:Inter;font-weight:400;font-size:30px;color:${oscuro ? SOFT : INK};line-height:1.4;margin-top:24px">${esc(clampText(s.bajada, 120))}</span>` : ''
  const lg = logoImg(oscuro ? o.logoBlanco : o.logoNavy, `bottom:52px;right:${PAD - 16}px`, 150)
  const body = `<div style="display:flex;flex-direction:column;flex:1;justify-content:center;align-items:flex-start;padding:64px ${PAD}px 120px ${PAD}px">${eb}${big}${label}${ruleGold()}${bajada}</div>`
  const html = `<div style="display:flex;flex-direction:column;position:relative;width:${C.w}px;height:${C.h}px;background:${bg}">${body}${lg}</div>`
  return { html, fotos: [] }
}

function foto(s: SlotsPlantilla, C: { w: number; h: number }, o: OpcionesPlantilla): ResultadoPlantilla {
  const fotos: FotoGrafico[] = []
  const src = s.foto?.url ? esc(s.foto.url) : 'FOTO:principal'
  if (!s.foto?.url) fotos.push({ slot: 'principal', prompt: s.foto?.prompt || 'una mascota viva, feliz y serena, retrato cálido con luz dorada', aspect: '4:5' })
  const frase = s.titulo ? `<span style="font-family:Inter;font-weight:700;font-size:${fitFont(s.titulo, C.w - PAD * 2, 58, 34)}px;color:${WHITE};line-height:1.15">${esc(clampText(s.titulo, 70))}</span>` : ''
  // velo SOLO en la franja inferior (degradé que se desvanece) — no tapa la foto.
  const velo = `<div style="display:flex;position:absolute;bottom:0;left:0;width:${C.w}px;height:${Math.round(C.h * 0.42)}px;background:linear-gradient(to bottom, rgba(20,60,100,0) 0%, rgba(20,60,100,0.82) 78%)"></div>`
  const texto = frase ? `<div style="display:flex;flex-direction:column;position:absolute;bottom:150px;left:${PAD}px;width:${C.w - PAD * 2}px">${frase}</div>` : ''
  const lg = logoImg(o.logoBlanco, `bottom:52px;left:${PAD}px`, 168)
  const html = `<div style="display:flex;position:relative;width:${C.w}px;height:${C.h}px;background:${NAVY}"><img src="${src}" width="${C.w}" height="${C.h}" style="object-fit:cover;display:block" />${velo}${texto}${lg}</div>`
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
  const cta = ctaRow(s, oscuro)
  const lg = logoImg(oscuro ? o.logoBlanco : o.logoNavy, `bottom:52px;right:${PAD - 16}px`, 168)
  const body = `<div style="display:flex;flex-direction:column;flex:1;justify-content:center;padding:60px ${PAD}px 120px ${PAD}px">${tit}${bajada}${cta}</div>`
  const html = `<div style="display:flex;flex-direction:column;position:relative;width:${C.w}px;height:${C.h}px;background:${bg}">${banda}${body}${lg}</div>`
  return { html, fotos }
}

function cita(s: SlotsPlantilla, C: { w: number; h: number }, o: OpcionesPlantilla): ResultadoPlantilla {
  // Testimonio / frase destacada. Por defecto en CLARO (crema) para romper el navy.
  const bg = bgColor(s.fondo || 'crema')
  const oscuro = bg === NAVY
  const col = oscuro ? WHITE : NAVY
  const eb = s.eyebrow ? eyebrowChip(s.eyebrow) : ''
  const comilla = `<div style="display:flex;font-family:Inter;font-weight:700;font-size:170px;color:${GOLD};line-height:0.8;margin-bottom:8px">“</div>`
  const frase = s.titulo ? `<span style="font-family:Inter;font-weight:700;font-size:${fitFont(s.titulo, C.w - PAD * 2, 68, 40)}px;color:${col};line-height:1.24">${esc(clampText(s.titulo, 200))}</span>` : ''
  const autor = s.bajada ? `<span style="font-family:Inter;font-weight:600;font-size:30px;color:${oscuro ? SOFT : INK};margin-top:30px">— ${esc(clampText(s.bajada, 60))}</span>` : ''
  const lg = logoImg(oscuro ? o.logoBlanco : o.logoNavy, `bottom:52px;right:${PAD - 16}px`, 150)
  const body = `<div style="display:flex;flex-direction:column;flex:1;justify-content:center;padding:64px ${PAD}px 120px ${PAD}px">${eb}${comilla}${frase}${autor}</div>`
  const html = `<div style="display:flex;flex-direction:column;position:relative;width:${C.w}px;height:${C.h}px;background:${bg}">${body}${lg}</div>`
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
  const textCol = `<div style="display:flex;flex-direction:column;flex:1;justify-content:center;padding:64px 56px 100px 56px">${eb}${tit}${bajada}${bullets}${cta}</div>`
  const html = `<div style="display:flex;flex-direction:row;position:relative;width:${C.w}px;height:${C.h}px;background:${bg}">${fotoCol}${textCol}${lg}</div>`
  return { html, fotos }
}

const BUILDERS: Record<NombrePlantilla, (s: SlotsPlantilla, C: { w: number; h: number }, o: OpcionesPlantilla) => ResultadoPlantilla> = {
  portada, contenido, dato, foto, cierre, cita, split,
}

/** Construye el HTML on-brand de una plantilla + las fotos a generar. */
export function construirPlantilla(nombre: string, slots: SlotsPlantilla, opts: OpcionesPlantilla = {}): ResultadoPlantilla {
  const builder = BUILDERS[(nombre || '').trim() as NombrePlantilla] || portada
  const C = DIMS[opts.formato || 'post_vertical'] || DIMS.post_vertical
  return builder(slots || {}, C, opts)
}
