import { getSheetData } from './datastore'
import { fmtPrecio } from './format'
import { BRAND } from './email-layout'

/**
 * Contexto de TARIFAS de cremación para los generadores de contenido (agente de
 * marketing + generador de campañas de email). Devuelve dos formatos:
 *  - `texto`: las tarifas como texto (para el prompt / cuando alcanza).
 *  - `tablaHtml`: una <table> email-safe (estilos inline, paleta de marca) LISTA
 *    para pegar en el HTML de un correo cuando la campaña pide mostrar precios —
 *    así el modelo no tiene que maquetarla a mano ni equivocarse con las cifras.
 *
 * Fuente única: `precios_generales` + `tipos_servicio`. Nunca inventa números.
 */
export interface TarifasContexto {
  texto: string
  tablaHtml: string
  hayTarifas: boolean
}

export async function getTarifasContexto(): Promise<TarifasContexto> {
  try {
    const [pg, ts] = await Promise.all([getSheetData('precios_generales'), getSheetData('tipos_servicio')])
    const tramos = [...pg].sort((a, b) => (parseFloat(a.peso_min) || 0) - (parseFloat(b.peso_min) || 0))
    if (tramos.length === 0) return { texto: '', tablaHtml: '', hayTarifas: false }

    const rango = (r: Record<string, string>) =>
      (r.peso_max && r.peso_max.trim()) ? `${r.peso_min}–${r.peso_max} kg` : `${r.peso_min}+ kg`

    const texto = tramos.map(r =>
      `- ${rango(r)}: Individual ${fmtPrecio(parseInt(r.precio_ci, 10) || 0)} · Premium ${fmtPrecio(parseInt(r.precio_cp, 10) || 0)} · Sin Devolución ${fmtPrecio(parseInt(r.precio_sd, 10) || 0)}`
    ).join('\n')
    const nombres = ts.map(t => `${t.codigo}=${t.nombre}`).join(', ')

    // Tabla email-safe: <table> con estilos inline, cabecera navy, filas alternadas.
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
    const tablaHtml = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;border:1px solid ${BRAND.hairline};border-radius:12px;overflow:hidden">
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

    return {
      texto: `TARIFAS VIGENTES de cremación (CLP, por peso):\n${texto}\nTipos de servicio: ${nombres}. Entrega en hasta 3 días hábiles.`,
      tablaHtml,
      hayTarifas: true,
    }
  } catch {
    return { texto: '', tablaHtml: '', hayTarifas: false }
  }
}
