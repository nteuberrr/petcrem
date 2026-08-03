import { renderEmailLayout, escapeHtml, type Contacto } from '../email-layout'
import { fmtPrecio } from '../format'

// ─────────────────────────────────────────────────────────────────────────────
// Correo de la liquidación de sueldo al trabajador (adjunta el PDF). El render
// vive acá para que lo compartan la ruta que lo envía
// (app/api/remuneraciones/liquidaciones/[id]/enviar) y el catálogo de correos.
//
// Voz: interna y directa, sin la carga emocional de los correos a tutores. Los
// montos van en el cuerpo para que se lean desde el teléfono sin abrir el PDF.
// ─────────────────────────────────────────────────────────────────────────────

export interface LiquidacionEmailArgs {
  nombre: string
  /** Período legible, ej. "julio 2026". */
  periodoTexto: string
  liquido: number
  /** 7% de salud que se devuelve aparte (0 si cotiza normalmente). */
  reembolsoSalud: number
  totalTransferir: number
  cremaciones: number
  contacto: Contacto
}

export function renderLiquidacionEmail(a: LiquidacionEmailArgs): string {
  const primerNombre = (a.nombre || '').trim().split(/\s+/)[0] || ''
  const fila = (rotulo: string, valor: string, fuerte = false) => `
        <tr>
          <td style="padding:7px 0;font-size:14px;color:#5b6674">${escapeHtml(rotulo)}</td>
          <td style="padding:7px 0;font-size:${fuerte ? '16px' : '14px'};color:#143C64;text-align:right;font-weight:${fuerte ? 700 : 600}">${escapeHtml(valor)}</td>
        </tr>`

  const cuerpo = `
      <p style="margin:0 0 14px;font-size:15px">Hola ${escapeHtml(primerNombre) || 'equipo'},</p>
      <p style="margin:0 0 16px;font-size:14px;line-height:1.6">
        Adjuntamos tu liquidación de sueldo de <strong>${escapeHtml(a.periodoTexto)}</strong> en PDF,
        con el detalle de haberes y descuentos.
      </p>
      <table style="width:100%;border-collapse:collapse;border-top:1px solid #e4dfd6;border-bottom:1px solid #e4dfd6;margin:0 0 16px">
        ${a.cremaciones > 0 ? fila('Cremaciones del mes', String(a.cremaciones)) : ''}
        ${fila('Líquido a pagar', fmtPrecio(a.liquido))}
        ${a.reembolsoSalud > 0 ? fila('Reembolso de salud (7%)', fmtPrecio(a.reembolsoSalud)) : ''}
        ${fila('Total a transferir', fmtPrecio(a.totalTransferir), true)}
      </table>
      <p style="margin:0;font-size:14px;line-height:1.6">
        Si ves algo que no calza, respóndenos este correo y lo revisamos.
      </p>`
  return renderEmailLayout({ titulo: `Liquidación de sueldo — ${a.periodoTexto}`, bodyHtml: cuerpo, contacto: a.contacto })
}

/** Asunto del correo (compartido por la ruta y el catálogo). */
export function asuntoLiquidacion(periodoTexto: string): string {
  return `Tu liquidación de sueldo — ${periodoTexto}`
}
