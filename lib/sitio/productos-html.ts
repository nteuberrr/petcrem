import { fmtPrecio } from '@/lib/format'

/**
 * Sitio público — render de la página /anforas, agrupada por categoría:
 *   1) Ánforas (greda incluida + premium)   2) Relicarios y Otros
 *   3) Otros productos/servicios (recargos de retiro + Servicio Express)
 * Fuente = Bodega (`productos`, espejo en vivo) + `otros_servicios` (recargos).
 *  - producto visible si mostrar_web != 'FALSE' y activo != 'FALSE'
 *  - sin stock → "Agotado"; precio = precio de lista de Bodega; greda → "Incluida"
 * Todo autocontenido (estilos propios) para no depender de la grilla de Webflow.
 */

type Prod = Record<string, string>

const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const escUrl = (s: unknown) => String(s ?? '').replace(/['"\\<>]/g, '')
const num = (s: unknown) => parseInt(String(s ?? '').replace(/\D/g, ''), 10) || 0

export function productoVisibleWeb(p: Prod): boolean {
  return p.mostrar_web !== 'FALSE' && p.activo !== 'FALSE'
}

/** Orden de las categorías: ánforas → relicarios → resto. */
function ordenCategoria(cat: string): number {
  const c = (cat || '').toLowerCase()
  if (c.includes('greda')) return 1
  if (c.includes('ánfora') || c.includes('anfora') || c.includes('premium')) return 2
  if (c.includes('relicario')) return 3
  return 4
}

function tarjetaProducto(p: Prod): string {
  const esGreda = /greda/i.test(p.categoria || '')
  const agotado = !(parseInt(p.stock || '0', 10) > 0)
  const precioNum = num(p.precio)
  const precio = esGreda && precioNum <= 0 ? 'Incluida'
    : agotado ? 'Agotado'
    : precioNum > 0 ? fmtPrecio(precioNum) : 'Consultar'
  const foto = p.foto_url
    ? `<div class="aa-cat-img" style="background-image:url('${escUrl(p.foto_url)}')"></div>`
    : '<div class="aa-cat-img aa-cat-img-empty"></div>'
  return '<div class="aa-cat-card">'
    + foto
    + `<div class="aa-cat-body"><div class="aa-cat-name">${esc(p.nombre)}</div>`
    + `<div class="aa-cat-price">${esc(precio)}</div></div>`
    + '</div>'
}

/** Tarjeta de un servicio adicional / recargo (de otros_servicios). */
function tarjetaServicio(s: Prod): string {
  const precio = num(s.precio)
  let detalle = ''
  if (s.auto_regla === 'fuera_horario') {
    detalle = 'Retiros después de las 19:00 hrs (lun a vie) y durante los fines de semana.'
  } else if (s.auto_regla === 'distancia') {
    let comunas: string[] = []
    try { const x = JSON.parse(s.comunas || '[]'); if (Array.isArray(x)) comunas = x.map(String) } catch { /* sin lista */ }
    detalle = comunas.length ? `Aplica en: ${comunas.join(', ')}.` : 'Aplica en comunas más alejadas de la Región Metropolitana.'
  }
  return '<div class="aa-serv-card">'
    + `<div class="aa-serv-top"><span class="aa-serv-name">${esc(s.nombre)}</span><span class="aa-serv-price">+${fmtPrecio(precio)}</span></div>`
    + (detalle ? `<p class="aa-serv-det">${esc(detalle)}</p>` : '')
    + '</div>'
}

const ESTILOS = '<style>'
  + '.aa-cat{width:100%;max-width:1100px;margin:0 auto;padding:0 16px 10px}'
  + '.aa-cat-grupo{margin:0 0 34px}'
  + '.aa-cat-h{display:flex;align-items:baseline;gap:10px;margin:0 0 4px;color:#143C64;font-size:22px;font-weight:700}'
  + '.aa-cat-h::before{content:"";display:inline-block;width:4px;height:20px;background:#F2B84B;border-radius:2px}'
  + '.aa-cat-sub{margin:0 0 18px;color:#7c8894;font-size:14px}'
  + '.aa-cat-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:18px}'
  + '.aa-cat-card{background:#fff;border:1px solid #e6e0d5;border-radius:16px;overflow:hidden;box-shadow:0 3px 14px rgba(20,60,100,.06)}'
  + '.aa-cat-img{height:170px;background-size:cover;background-position:center;background-color:#FBF8F3}'
  + '.aa-cat-img-empty{background:#FBF8F3}'
  + '.aa-cat-body{padding:13px 15px}'
  + '.aa-cat-name{color:#2b3a47;font-weight:600;font-size:15px;line-height:1.3}'
  + '.aa-cat-price{margin-top:6px;color:#143C64;font-weight:700;font-size:15px}'
  + '.aa-serv-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:16px}'
  + '.aa-serv-card{background:#FBF8F3;border:1px solid #e6e0d5;border-radius:14px;padding:16px 18px}'
  + '.aa-serv-top{display:flex;justify-content:space-between;gap:12px;align-items:baseline}'
  + '.aa-serv-name{color:#2b3a47;font-weight:700;font-size:15px}'
  + '.aa-serv-price{color:#143C64;font-weight:700;white-space:nowrap}'
  + '.aa-serv-det{margin:6px 0 0;color:#7c8894;font-size:13px;line-height:1.5}'
  + '</style>'

/**
 * Arma la página /anforas: grupos de productos por categoría + una sección final
 * "Otros productos / servicios" con los recargos y servicios de `otros_servicios`.
 */
export function renderProductosWeb(productos: Prod[], otrosServicios: Prod[] = []): string {
  const visibles = productos.filter(productoVisibleWeb).filter(p => (p.nombre || '').trim())

  // Agrupar por categoría, en el orden ánforas → relicarios → resto.
  const grupos = new Map<string, Prod[]>()
  for (const p of visibles) {
    const cat = (p.categoria || 'Otros').trim() || 'Otros'
    if (!grupos.has(cat)) grupos.set(cat, [])
    grupos.get(cat)!.push(p)
  }
  const catsOrdenadas = [...grupos.keys()].sort((a, b) => ordenCategoria(a) - ordenCategoria(b) || a.localeCompare(b))

  const bloquesProd = catsOrdenadas.map(cat => {
    const cards = grupos.get(cat)!.map(tarjetaProducto).join('')
    const sub = /greda/i.test(cat) ? '<p class="aa-cat-sub">Vienen incluidas en el servicio, sin costo adicional.</p>' : ''
    return `<div class="aa-cat-grupo"><h2 class="aa-cat-h">${esc(cat)}</h2>${sub}<div class="aa-cat-grid">${cards}</div></div>`
  }).join('')

  // Otros productos / servicios (recargos + express), desde otros_servicios activos.
  const serviciosActivos = otrosServicios.filter(s => String(s.activo || '').toUpperCase() === 'TRUE' && (s.nombre || '').trim())
  let bloqueServicios = ''
  if (serviciosActivos.length) {
    const cards = serviciosActivos.map(tarjetaServicio).join('')
    bloqueServicios = '<div class="aa-cat-grupo"><h2 class="aa-cat-h">Otros productos / servicios</h2>'
      + '<p class="aa-cat-sub">Servicios adicionales que pueden sumarse a tu cremación. Los recargos de retiro se avisan siempre antes de coordinar.</p>'
      + `<div class="aa-serv-grid">${cards}</div></div>`
  }

  if (!bloquesProd && !bloqueServicios) {
    return '<div style="width:100%;text-align:center;color:#7c8894;padding:20px">Pronto agregaremos productos.</div>'
  }
  return ESTILOS + '<div class="aa-cat">' + bloquesProd + bloqueServicios + '</div>'
}
