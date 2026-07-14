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

/**
 * Nota de recargos que pueden sumarse al retiro (fuera de horario + distancia),
 * de la tabla `otros_servicios`. Va DEBAJO de la tabla de precios de cada
 * servicio (incl. eutanasia) para que el cliente los conozca antes de cotizar
 * — mismo criterio que el bot de WhatsApp (pedido del dueño 2026-07-14, tras el
 * caso de una clienta que se enteró del recargo recién al pagar).
 */
function renderRecargos(recargos: Tramo[]): string {
  const activo = (r: Tramo) => String(r.activo || '').toUpperCase() === 'TRUE'
  const fh = recargos.find(r => activo(r) && r.auto_regla === 'fuera_horario')
  const dist = recargos.find(r => activo(r) && r.auto_regla === 'distancia')
  const items: string[] = []
  if (fh) {
    items.push(`<li class="aa-rec-item"><span class="aa-rec-top"><span class="aa-rec-n">Retiro fuera de horario</span><span class="aa-rec-v">+${fmtCLP(num(fh.precio))}</span></span><span class="aa-rec-d">Retiros después de las 19:00 hrs (lunes a viernes), y durante todo el día los fines de semana y feriados.</span></li>`)
  }
  if (dist) {
    let comunas: string[] = []
    try { const x = JSON.parse(dist.comunas || '[]'); if (Array.isArray(x)) comunas = x.map(String) } catch { /* comunas mal formadas → sin lista */ }
    const nota = comunas.length ? `Aplica en: ${comunas.join(', ')}.` : 'Aplica en comunas más alejadas de la Región Metropolitana.'
    items.push(`<li class="aa-rec-item"><span class="aa-rec-top"><span class="aa-rec-n">Adicional por distancia</span><span class="aa-rec-v">+${fmtCLP(num(dist.precio))}</span></span><span class="aa-rec-d">${nota}</span></li>`)
  }
  if (!items.length) return ''
  const css = '<style>'
    + '.aa-recargos{max-width:620px;margin:0 auto 30px;padding:0 4px}'
    + '.aa-recargos-card{background:#FBF8F3;border:1px solid #e3ddd2;border-radius:16px;padding:18px 22px}'
    + '.aa-recargos-tit{margin:0 0 4px;color:#143C64;font-weight:700;font-size:14px}'
    + '.aa-recargos-sub{margin:0 0 12px;color:#7c8894;font-size:12.5px}'
    + '.aa-rec-list{list-style:none;margin:0;padding:0}'
    + '.aa-rec-item{padding:10px 0;border-top:1px solid #ece6da}'
    + '.aa-rec-item:first-child{border-top:none}'
    + '.aa-rec-top{display:flex;justify-content:space-between;gap:12px;align-items:baseline}'
    + '.aa-rec-n{color:#3d4d5c;font-weight:600;font-size:14.5px}'
    + '.aa-rec-v{color:#143C64;font-weight:700;font-variant-numeric:tabular-nums;white-space:nowrap}'
    + '.aa-rec-d{display:block;color:#7c8894;font-size:12.5px;margin-top:2px}'
    + '</style>'
  return css
    + '<div class="aa-recargos"><div class="aa-recargos-card">'
    + '<p class="aa-recargos-tit">Recargos que pueden sumarse al retiro</p>'
    + '<p class="aa-recargos-sub">Se avisan siempre antes de coordinar; no son parte del valor base.</p>'
    + `<ul class="aa-rec-list">${items.join('')}</ul>`
    + '</div></div>'
}

export interface DatosPrecios {
  tramosGen: Tramo[]
  tramosEut: Tramo[]
  fijoEut: number
  /** Filas de `otros_servicios` (para la nota de recargos bajo la tabla). */
  recargos: Tramo[]
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
    .replace('<!--INJECT:tabla-precios-->', renderTabla(filas) + renderRecargos(d.recargos || []))
    .replace('<!--INJECT:desde-ci-->', fmtCLP(desdeDe(filasCremacion(d.tramosGen, 'precio_ci'))))
    .replace('<!--INJECT:desde-cp-->', fmtCLP(desdeDe(filasCremacion(d.tramosGen, 'precio_cp'))))
    // El 3er bloque comparativo del export no trae margen entre "Desde" y el
    // monto (los otros dos sí) — el &nbsp; evita que se lean pegados.
    .replace('<!--INJECT:desde-sd-->', '&nbsp;' + fmtCLP(desdeDe(filasCremacion(d.tramosGen, 'precio_sd'))))
}
