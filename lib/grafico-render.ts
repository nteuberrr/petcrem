import satori from 'satori'
import { parse, type HTMLElement, type Node, NodeType } from 'node-html-parser'
import { Resvg } from '@resvg/resvg-js'
import { BRAND } from './email-layout'

/**
 * HTML → VDOM de satori. Propio (no satori-html, que arrastra ultrahtml y rompe la
 * resolución ESM). satori espera nodos { type, props:{ style, children } } y el
 * style como objeto camelCase.
 */
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
  props.children = hijos.length === 1 ? hijos[0] : hijos
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

/**
 * Renderiza un GRÁFICO de marca (portada, placa, anuncio) a PNG a partir de HTML.
 *
 * El agente diseña libremente en HTML (layout, jerarquía, info, acentos), pero la
 * marca sale EXACTA porque acá rasterizamos con las fuentes REALES de Alma Animal
 * (More Sugar para el wordmark, Inter para el resto) y colores hex exactos — la IA
 * no "dibuja" texto ni colores. Pipeline: HTML → satori (SVG con las fuentes) →
 * resvg (PNG).
 *
 * Las fuentes viven en R2 (subidas con scripts/upload-fonts.ts) y se cachean en
 * memoria por proceso. Las imágenes (<img src="http...">) se incrustan como data
 * URI antes de rasterizar (satori no hace fetch en serverless de forma fiable).
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
  const inlined = await incrustarImagenes(opts.html)
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
  return { buffer: png, mime: 'image/png' }
}

export function isGraficoRenderConfigurado(): boolean {
  return !!process.env.R2_PUBLIC_URL
}
