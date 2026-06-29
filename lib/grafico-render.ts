import satori from 'satori'
import { Resvg } from '@resvg/resvg-js'
import { parse, type HTMLElement, type Node, NodeType } from 'node-html-parser'
import { BRAND } from './email-layout'
import { sanitizarGlifos } from './marketing-lint'

/**
 * Renderiza un GRÁFICO de marca (portada, placa, anuncio) a PNG a partir de HTML.
 * El agente diseña libre en HTML; la marca sale EXACTA porque rasterizamos con las
 * fuentes REALES (More Sugar + Inter) y colores hex exactos. Pipeline:
 * HTML → satori (SVG con las fuentes) → resvg (PNG). Las fuentes viven en R2.
 */

const R2_BASE = (process.env.R2_PUBLIC_URL || 'https://pub-9ca489d9f825495b83375f6e526f354e.r2.dev').replace(/\/$/, '')

type SatoriFont = { name: string; data: Buffer; weight: 400 | 600 | 700; style: 'normal' }
let fontsCache: SatoriFont[] | null = null

async function bajar(file: string): Promise<Buffer> {
  const r = await fetch(`${R2_BASE}/brand/fonts/${file}`)
  if (!r.ok) throw new Error(`No se pudo cargar la fuente ${file} (HTTP ${r.status})`)
  return Buffer.from(await r.arrayBuffer())
}

async function getFonts(): Promise<SatoriFont[]> {
  if (fontsCache) return fontsCache
  const [ms, ir, isb, ib] = await Promise.all([
    bajar('MoreSugar-Regular.otf'),
    bajar('Inter-Regular.woff'),
    bajar('Inter-SemiBold.woff'),
    bajar('Inter-Bold.woff'),
  ])
  fontsCache = [
    { name: 'More Sugar', data: ms, weight: 400, style: 'normal' },
    { name: 'Inter', data: ir, weight: 400, style: 'normal' },
    { name: 'Inter', data: isb, weight: 600, style: 'normal' },
    { name: 'Inter', data: ib, weight: 700, style: 'normal' },
  ]
  return fontsCache
}

// ─── HTML → VDOM de satori (propio; satori-html arrastra ultrahtml y rompe ESM) ──

// Tags VOID de HTML (se auto-cierran de verdad). Cualquier OTRO tag auto-cerrado
// (`<div .../>`, `<span .../>` que el modelo escribe para elementos decorativos)
// node-html-parser lo parsea de forma inconsistente (a veces anida los hermanos
// siguientes dentro) → árbol corrupto → satori tira "Expected <div> to have explicit
// display: flex...". Los expandimos a `<tag ...></tag>` ANTES de parsear: determinista.
const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'])
function expandirAutocierre(html: string): string {
  // attrs: tolera comillas con `>` adentro. Solo convierte tags NO-void.
  return html.replace(/<([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)\/>/g, (m, tag: string, attrs: string) =>
    VOID_TAGS.has(tag.toLowerCase()) ? m : `<${tag}${attrs}></${tag}>`)
}

function aCamel(k: string): string { return k.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase()) }

function parseStyle(s?: string): Record<string, string> {
  const o: Record<string, string> = {}
  if (!s) return o
  for (const decl of s.split(';')) {
    const i = decl.indexOf(':')
    if (i < 0) continue
    const k = decl.slice(0, i).trim()
    const v = decl.slice(i + 1).trim()
    if (k) o[aCamel(k)] = v
  }
  return o
}

type VNode = { type: string; props: Record<string, unknown> } | string

function nodoAVNode(node: Node): VNode | null {
  if (node.nodeType === NodeType.TEXT_NODE) {
    const t = (node as unknown as { rawText: string }).rawText ?? node.textContent ?? ''
    const limpio = t.replace(/\s+/g, ' ')
    return limpio.trim() === '' ? null : limpio
  }
  if (node.nodeType !== NodeType.ELEMENT_NODE) return null
  const el = node as HTMLElement
  const tag = (el.rawTagName || 'div').toLowerCase()
  const attrs = el.attributes || {}
  const style = parseStyle(attrs.style)
  if (attrs.width && !style.width) style.width = /[%px]$/.test(attrs.width) ? attrs.width : `${attrs.width}px`
  if (attrs.height && !style.height) style.height = /[%px]$/.test(attrs.height) ? attrs.height : `${attrs.height}px`
  const props: Record<string, unknown> = { style }
  if (attrs.src) props.src = attrs.src
  if (tag === 'img') return { type: 'img', props }
  const hijos = el.childNodes.map(nodoAVNode).filter((c): c is VNode => c !== null)
  // satori EXIGE display explícito (flex/contents/none) en todo elemento que tenga
  // >1 hijo O un hijo que sea ELEMENTO (un solo hijo de TEXTO sí está permitido sin
  // display — por eso los <span> de texto funcionan). Si no, tira "Expected <div> to
  // have explicit display: flex...". Algunos modelos (Sonnet) omiten el display o ponen
  // display:block. Normalizamos: si falta o no es válido, forzamos flex + column (≈ el
  // apilado en bloque que se espera). Si el modelo YA puso display:flex, se respeta.
  const necesitaDisplay = hijos.length > 1 || hijos.some(h => typeof h !== 'string')
  if (necesitaDisplay) {
    const d = String((style.display as string) || '')
    if (d !== 'flex' && d !== 'contents' && d !== 'none') {
      style.display = 'flex'
      if (!style.flexDirection) style.flexDirection = 'column'
    }
  }
  // children: un solo hijo va suelto; varios, como array; CERO → no seteamos `children`.
  // (Un array vacío hace que satori cuente "varios hijos" y exija display flex → reventaba
  // con los <div .../> auto-cerrados que genera el modelo para elementos decorativos.)
  if (hijos.length === 1) props.children = hijos[0]
  else if (hijos.length > 1) props.children = hijos
  return { type: tag, props }
}

function htmlAVNode(html: string): VNode {
  const root = parse(html, { lowerCaseTagName: true })
  const els = root.childNodes.filter(n => n.nodeType === NodeType.ELEMENT_NODE)
  const top = els.length === 1 ? els[0] : root
  const v = nodoAVNode(top as Node)
  if (!v || typeof v === 'string') throw new Error('El HTML del gráfico no tiene un elemento raíz válido')
  return v
}

/** Incrusta las imágenes remotas (<img src="http...">) como data URI. */
async function incrustarImagenes(html: string): Promise<string> {
  const urls = [...html.matchAll(/<img\b[^>]*\bsrc=["'](https?:\/\/[^"']+)["']/gi)].map(m => m[1])
  const uniq = [...new Set(urls)]
  if (uniq.length === 0) return html
  const reemplazos = new Map<string, string>()
  await Promise.all(uniq.map(async u => {
    try {
      const r = await fetch(u)
      if (!r.ok) return
      const ct = r.headers.get('content-type') || 'image/jpeg'
      const b = Buffer.from(await r.arrayBuffer())
      reemplazos.set(u, `data:${ct};base64,${b.toString('base64')}`)
    } catch { /* deja la URL; satori la ignora si no puede */ }
  }))
  let out = html
  for (const [u, d] of reemplazos) out = out.split(u).join(d)
  return out
}

export interface RenderGraficoOpts {
  html: string
  width: number
  height: number
}

/** Renderiza el HTML del gráfico a PNG (Buffer) con las fuentes de marca. */
export async function renderGraficoHTML(opts: RenderGraficoOpts): Promise<{ buffer: Buffer; mime: 'image/png' }> {
  if (!opts.html?.trim()) throw new Error('Falta el HTML del gráfico')
  const fonts = await getFonts()
  // Defensa en profundidad: saca glifos que satori no dibuja (flechas/emojis → cajas rotas).
  const inlined = await incrustarImagenes(sanitizarGlifos(expandirAutocierre(opts.html)))
  const vnode = htmlAVNode(inlined)
  const svg = await satori(vnode as Parameters<typeof satori>[0], {
    width: opts.width,
    height: opts.height,
    fonts: fonts.map(f => ({ name: f.name, data: f.data, weight: f.weight, style: f.style })),
  })
  const png = new Resvg(svg, {
    background: BRAND.cream,
    fitTo: { mode: 'width', value: opts.width },
  }).render().asPng()
  // En Linux/Vercel, resvg devuelve un Buffer respaldado por un SharedArrayBuffer; el
  // AWS SDK que firma la subida a R2 (y sharp) lo rechazan con «input ... ArrayBuffer».
  // Copiamos a un Buffer normal (ArrayBuffer no compartido).
  return { buffer: Buffer.from(new Uint8Array(png)), mime: 'image/png' }
}

export function isGraficoRenderConfigurado(): boolean {
  return !!process.env.R2_PUBLIC_URL
}
