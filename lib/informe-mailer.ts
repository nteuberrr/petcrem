import { renderEmailLayout, escapeHtml, type Contacto } from './email-layout'

// ─────────────────────────────────────────────────────────────────────────────
// Correo del informe de facturación a la veterinaria (adjunta el xlsx/pdf). El
// render vive acá para que lo compartan la ruta que lo envía
// (app/api/veterinarios/[id]/informe/enviar) y el catálogo de correos.
// ─────────────────────────────────────────────────────────────────────────────

export interface InformeFacturacionArgs {
  nombreVet: string
  nombreContacto: string
  /** Período de cierre ya formateado (DD/MM/YYYY). */
  periodoHasta: string
  contacto: Contacto
}

export function renderInformeFacturacionEmail({ nombreVet, nombreContacto, periodoHasta, contacto }: InformeFacturacionArgs): string {
  const saludo = nombreContacto ? `Estimado(a) <strong>${escapeHtml(nombreContacto)}</strong>` : 'Estimados'
  const cuerpo = `
      <p style="margin:0 0 14px;font-size:15px">${saludo},</p>
      <p style="margin:0 0 14px;font-size:14px;line-height:1.6">
        Adjuntamos el informe de facturación correspondiente a <strong>${escapeHtml(nombreVet)}</strong>, con el detalle
        de los servicios prestados hasta el cierre de <strong>${escapeHtml(periodoHasta)}</strong>.
      </p>
      <p style="margin:0 0 14px;font-size:14px;line-height:1.6">
        En el archivo adjunto encontrarán el detalle por mes con su desglose semanal y el
        total a facturar correspondiente a cada uno, junto con un resumen histórico por especie,
        tramo de peso y tipo de servicio.
      </p>
      <p style="margin:0;font-size:14px;line-height:1.6">
        Para cualquier consulta sobre este informe pueden responder directamente a este correo
        o escribirnos por los medios de abajo.
      </p>`
  return renderEmailLayout({ titulo: 'Informe de facturación', bodyHtml: cuerpo, contacto })
}
