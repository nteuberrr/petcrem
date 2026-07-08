import { fmtPrecio } from '@/lib/format'

/**
 * Sitio público — render de las tarjetas de producto para /anforas, reusando las
 * MISMAS clases de Webflow (cv-anf-card / div-block-7 / cv-anf-name / cv-anf-price)
 * para que se vean idénticas. Fuente = Bodega (`productos`), espejo en vivo:
 *  - visible si mostrar_web != 'FALSE' y activo != 'FALSE' (nuevos aparecen solos)
 *  - sin stock → "Agotado"; precio = precio de lista (general) de Bodega
 */

type Prod = Record<string, string>

const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const escUrl = (s: unknown) => String(s ?? '').replace(/['"\\<>]/g, '')

export function productoVisibleWeb(p: Prod): boolean {
  return p.mostrar_web !== 'FALSE' && p.activo !== 'FALSE'
}

function tarjeta(p: Prod): string {
  const agotado = !(parseInt(p.stock || '0', 10) > 0)
  const precioNum = parseInt(String(p.precio || '').replace(/\D/g, ''), 10) || 0
  const precio = agotado ? 'Agotado' : (precioNum > 0 ? fmtPrecio(precioNum) : 'Consultar')
  const bg = p.foto_url ? ` style="background-image:url('${escUrl(p.foto_url)}')"` : ''
  return '<div role="listitem" class="cv-anf-card w-dyn-item w-col w-col-4">'
    + `<div${bg} class="div-block-7"></div>`
    + `<div class="cv-anf-name">${esc(p.nombre)}</div>`
    + `<p class="cv-anf-desc">${esc(p.categoria || '')}</p>`
    + `<div class="cv-anf-price-wrap"><div class="cv-anf-price">${esc(precio)}</div></div>`
    + '</div>'
}

export function renderProductosWeb(productos: Prod[]): string {
  const visibles = productos.filter(productoVisibleWeb)
  if (visibles.length === 0) {
    return '<div class="cv-anf-card w-dyn-item w-col w-col-4"><div class="cv-anf-name">Pronto agregaremos productos.</div></div>'
  }
  return visibles.map(tarjeta).join('')
}
