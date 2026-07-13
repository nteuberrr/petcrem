/**
 * Sitio público — precios VIVOS para las páginas de servicios.
 * Fuente única: `precios_generales` (cremación CI/CP/SD) y `precios_eutanasia`
 * + cargo fijo (eutanasia a domicilio, precio cliente = precio vet + fijo).
 * El listado /servicios muestra "Desde $X" y cada detalle su tabla por tramo,
 * generados al vuelo en cada render: cambiar los precios en Configuración los
 * actualiza también en la web (pedido del dueño 2026-07-12 — antes eran
 * imágenes/texto horneados del export de Webflow y quedaban desactualizados).
 */

type Tramo = Record<string, string>

export type ColPrecio = 'precio_ci' | 'precio_cp' | 'precio_sd'

/** slug del detalle (/servicios/<slug>) → columna de precios_generales. */
export const COL_POR_SLUG: Record<string, ColPrecio> = {
  'cremacion-individual': 'precio_ci',
  'cremacion-premium': 'precio_cp',
  'cremacion-sin-devolucion-de-cenizas': 'precio_sd',
}

export const SLUG_EUTANASIA = 'eutanasia'

const num = (s: unknown) => parseFloat(String(s ?? '')) || 0
export const fmtCLP = (n: number) => '$' + Math.round(n).toLocaleString('es-CL')

function ordenar(tramos: Tramo[]): Tramo[] {
  return [...tramos]
    .filter(t => num(t.peso_max) > 0)
    .sort((a, b) => num(a.peso_min) - num(b.peso_min))
}

/** Etiqueta del tramo (intervalos (min, max], el borde exacto va al tramo menor). */
function etiqueta(t: Tramo, esPrimero: boolean): string {
  const min = num(t.peso_min), max = num(t.peso_max)
  if (esPrimero) return `Hasta ${max} kg`
  return `${min} a ${max} kg`
}

/** Precios cliente por tramo para un servicio de cremación. */
export function filasCremacion(tramosGen: Tramo[], col: ColPrecio): { peso: string; precio: number }[] {
  const orden = ordenar(tramosGen)
  return orden.map((t, i) => ({ peso: etiqueta(t, i === 0), precio: num(t[col]) })).filter(f => f.precio > 0)
}

/** Precios cliente por tramo para eutanasia a domicilio (precio vet + fijo). */
export function filasEutanasia(tramosEut: Tramo[], fijo: number): { peso: string; precio: number }[] {
  const orden = ordenar(tramosEut)
  return orden.map((t, i) => ({ peso: etiqueta(t, i === 0), precio: num(t.precio) + fijo })).filter(f => f.precio > 0)
}

export function desdeDe(filas: { precio: number }[]): number {
  return filas.length ? Math.min(...filas.map(f => f.precio)) : 0
}

function rangoDe(filas: { precio: number }[]): string {
  if (!filas.length) return ''
  const min = Math.min(...filas.map(f => f.precio))
  const max = Math.max(...filas.map(f => f.precio))
  return `${fmtCLP(min)} – ${fmtCLP(max)}`
}

/** Tabla de precios por tramo (card de marca, autocontenida, responsive). */
function renderTabla(filas: { peso: string; precio: number }[]): string {
  if (!filas.length) return ''
  const css = '<style>'
    + '.aa-precios{max-width:620px;margin:30px auto 10px;padding:0 4px}'
    + '.aa-precios-card{background:#fff;border:1px solid #e3ddd2;border-radius:18px;box-shadow:0 4px 18px rgba(20,60,100,.08);overflow:hidden}'
    + '.aa-precios-head{display:flex;justify-content:space-between;gap:12px;background:#143C64;color:#fff;padding:14px 24px;font-weight:700;font-size:15px}'
    + '.aa-precios-fila{display:flex;justify-content:space-between;gap:12px;padding:11px 24px;font-size:15px;border-top:1px solid #f0ece3}'
    + '.aa-precios-fila:nth-child(odd){background:#FBF8F3}'
    + '.aa-precios-peso{color:#3d4d5c;font-weight:600}'
    + '.aa-precios-valor{color:#143C64;font-weight:700;font-variant-numeric:tabular-nums}'
    + '.aa-precios-nota{text-align:center;color:#98a3ad;font-size:12.5px;margin-top:10px}'
    + '</style>'
  const filasHtml = filas.map(f =>
    `<div class="aa-precios-fila"><span class="aa-precios-peso">${f.peso}</span><span class="aa-precios-valor">${fmtCLP(f.precio)}</span></div>`
  ).join('')
  return css
    + '<div class="aa-precios"><div class="aa-precios-card">'
    + '<div class="aa-precios-head"><span>Peso de tu mascota</span><span>Precio</span></div>'
    + filasHtml
    + '</div><p class="aa-precios-nota">El tramo se determina con el peso de tu mascota al ingreso.</p></div>'
}

export interface DatosPrecios {
  tramosGen: Tramo[]
  tramosEut: Tramo[]
  fijoEut: number
}

function filasDe(slug: string, d: DatosPrecios): { peso: string; precio: number }[] {
  const col = COL_POR_SLUG[slug]
  if (col) return filasCremacion(d.tramosGen, col)
  if (slug === SLUG_EUTANASIA) return filasEutanasia(d.tramosEut, d.fijoEut)
  return []
}

/** Mapa slug → "desde" (para las tarjetas del listado /servicios). */
export function desdePorSlug(d: DatosPrecios): Record<string, number> {
  const out: Record<string, number> = {}
  for (const slug of Object.keys(COL_POR_SLUG)) out[slug] = desdeDe(filasDe(slug, d))
  out[SLUG_EUTANASIA] = desdeDe(filasEutanasia(d.tramosEut, d.fijoEut))
  return out
}

/**
 * Rellena los marcadores de precios de un detalle de servicio:
 *   <!--INJECT:rango-precio-->  rango min–max del servicio de la página
 *   <!--INJECT:tabla-precios--> tabla por tramo del servicio de la página
 *   <!--INJECT:desde-ci|cp|sd--> "desde" de las cards comparativas (van en las 4 páginas)
 */
export function renderPreciosServicio(html: string, slug: string, d: DatosPrecios): string {
  const filas = filasDe(slug, d)
  return html
    .replace('<!--INJECT:rango-precio-->', rangoDe(filas) || 'Cotiza con nosotros')
    .replace('<!--INJECT:tabla-precios-->', renderTabla(filas))
    .replace('<!--INJECT:desde-ci-->', fmtCLP(desdeDe(filasCremacion(d.tramosGen, 'precio_ci'))))
    .replace('<!--INJECT:desde-cp-->', fmtCLP(desdeDe(filasCremacion(d.tramosGen, 'precio_cp'))))
    // El 3er bloque comparativo del export no trae margen entre "Desde" y el
    // monto (los otros dos sí) — el &nbsp; evita que se lean pegados.
    .replace('<!--INJECT:desde-sd-->', '&nbsp;' + fmtCLP(desdeDe(filasCremacion(d.tramosGen, 'precio_sd'))))
}
