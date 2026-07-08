import { getSheetData } from './datastore'
import { fmtPrecio } from './format'
import { BRAND } from './email-layout'

/**
 * Contexto de TARIFAS de cremación para los generadores de contenido (agente de
 * marketing + generador de campañas de email). Entrega, tanto para los precios
 * GENERALES (tutores) como para los de CONVENIO (veterinarios/clínicas):
 *  - `texto`/`textoConvenio`: las tarifas como texto (para el prompt).
 *  - `tablaHtml`/`tablaHtmlConvenio`: una <table> email-safe (estilos inline, paleta
 *    de marca) LISTA para pegar en el HTML cuando la campaña pide mostrar precios —
 *    así el modelo no maquetea a mano ni se equivoca con las cifras.
 *
 * Fuente única: `precios_generales` / `precios_convenio` + `tipos_servicio`.
 * Nunca inventa números. Para campañas a veterinarios se usan los de CONVENIO.
 */
export interface TarifasContexto {
  texto: string
  tablaHtml: string
  hayTarifas: boolean
  /** Precios preferentes de convenio (para campañas a veterinarios/clínicas). */
  textoConvenio: string
  tablaHtmlConvenio: string
  hayConvenio: boolean
}

type Tramo = Record<string, string>

const rango = (r: Tramo) => (r.peso_max && r.peso_max.trim()) ? `${r.peso_min}–${r.peso_max} kg` : `${r.peso_min}+ kg`
const ordenar = (t: Tramo[]) => [...t].sort((a, b) => (parseFloat(a.peso_min) || 0) - (parseFloat(b.peso_min) || 0))

function textoDe(tramos: Tramo[]): string {
  return tramos.map(r =>
    `- ${rango(r)}: Individual ${fmtPrecio(parseInt(r.precio_ci, 10) || 0)} · Premium ${fmtPrecio(parseInt(r.precio_cp, 10) || 0)} · Sin Devolución ${fmtPrecio(parseInt(r.precio_sd, 10) || 0)}`
  ).join('\n')
}

function tablaDe(tramos: Tramo[]): string {
  const th = `padding:10px 12px;font-size:13px;font-weight:700;color:#ffffff;text-align:left`
  const thr = `${th};text-align:right`
  const td = `padding:9px 12px;font-size:14px;color:${BRAND.ink};border-bottom:1px solid ${BRAND.hairline}`
  const tdr = `${td};text-align:right;font-variant-numeric:tabular-nums`
  const filas = tramos.map((r, i) => {
    const bg = i % 2 === 0 ? '#ffffff' : BRAND.cream
    return `<tr style="background:${bg}">
        <td style="${td}">${rango(r)}</td>
        <td style="${tdr}">${fmtPrecio(parseInt(r.precio_ci, 10) || 0)}</td>
        <td style="${tdr}">${fmtPrecio(parseInt(r.precio_cp, 10) || 0)}</td>
        <td style="${tdr}">${fmtPrecio(parseInt(r.precio_sd, 10) || 0)}</td>
      </tr>`
  }).join('')
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;border:1px solid ${BRAND.hairline};border-radius:12px;overflow:hidden">
      <thead>
        <tr style="background:${BRAND.navy}">
          <th style="${th}">Peso de la mascota</th>
          <th style="${thr}">Individual</th>
          <th style="${thr}">Premium</th>
          <th style="${thr}">Sin Devolución</th>
        </tr>
      </thead>
      <tbody>${filas}</tbody>
    </table>`
}

export async function getTarifasContexto(): Promise<TarifasContexto> {
  const vacio: TarifasContexto = { texto: '', tablaHtml: '', hayTarifas: false, textoConvenio: '', tablaHtmlConvenio: '', hayConvenio: false }
  try {
    const [pg, ts, pc] = await Promise.all([
      getSheetData('precios_generales'),
      getSheetData('tipos_servicio'),
      getSheetData('precios_convenio').catch(() => [] as Tramo[]),
    ])
    const gen = ordenar(pg)
    const conv = ordenar(pc)
    if (gen.length === 0) return vacio
    const nombres = ts.map(t => `${t.codigo}=${t.nombre}`).join(', ')

    return {
      texto: `TARIFAS GENERALES de cremación (para TUTORES; CLP, por peso):\n${textoDe(gen)}\nTipos de servicio: ${nombres}. Entrega en hasta 3 días hábiles.`,
      tablaHtml: tablaDe(gen),
      hayTarifas: true,
      textoConvenio: conv.length ? `TARIFAS DE CONVENIO (preferentes, para VETERINARIOS/clínicas; CLP, por peso):\n${textoDe(conv)}` : '',
      tablaHtmlConvenio: conv.length ? tablaDe(conv) : '',
      hayConvenio: conv.length > 0,
    }
  } catch {
    return vacio
  }
}
