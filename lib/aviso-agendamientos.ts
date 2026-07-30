import { getSheetData } from './datastore'
import { renderEmailLayout, getContacto, escapeHtml, BRAND } from './email-layout'
import { formatDate, formatDateForSheet, formatHora, fechaChileISO, daysSince } from './dates'
import type { AvisoRenderizado } from './aviso-pagos-pendientes'

/**
 * AVISO "Agendamientos sin resolver": lo que quedó a medio camino en la agenda.
 *
 * Cubre el punto ciego de la auditoría de julio 2026: nada vigilaba las puntas
 * sueltas del agendamiento. Una solicitud que nadie confirma ni rechaza BLOQUEA
 * el horario para siempre y deja al cliente esperando una confirmación que no
 * llega; una eutanasia que ningún veterinario toma se queda muda (al tutor ya se
 * le dijo "te avisamos cuando un vet confirme"). Todo dependía de que alguien se
 * acordara de mirar.
 *
 * Reporta tres bloques:
 *  1. Solicitudes de retiro PENDIENTES de confirmar (con su antigüedad).
 *  2. Eutanasias sin veterinario asignado ('creada' / 'enviada').
 *  3. Retiros de HOY y MAÑANA ya confirmados, como control del día.
 */

interface Pendiente {
  id: string
  quien: string
  mascota: string
  fecha: string
  hora: string
  dias: number | null
  detalle: string
  /** true si la fecha del servicio ya pasó. */
  vencido: boolean
}

export interface InformeAgendamientos {
  fecha: string
  porConfirmar: Pendiente[]
  sinVet: Pendiente[]
  proximos: Pendiente[]
}

export async function construirInformeAgendamientos(): Promise<InformeAgendamientos> {
  const hoy = fechaChileISO()
  const manana = (() => {
    const [y, m, d] = hoy.split('-').map(Number)
    const dt = new Date(Date.UTC(y, m - 1, d + 1, 12))
    const p = (n: number) => String(n).padStart(2, '0')
    return `${dt.getUTCFullYear()}-${p(dt.getUTCMonth() + 1)}-${p(dt.getUTCDate())}`
  })()

  const [sols, cotis] = await Promise.all([
    getSheetData('solicitudes_retiro').catch(() => [] as Record<string, string>[]),
    getSheetData('cotizaciones_eutanasia').catch(() => [] as Record<string, string>[]),
  ])

  const deSolicitud = (s: Record<string, string>): Pendiente => {
    const fecha = formatDateForSheet(s.fecha_retiro) || String(s.fecha_retiro || '')
    const esVet = s.origen === 'bot_vet' || !!s.vet_nombre
    return {
      id: s.id || '',
      quien: (esVet ? s.vet_nombre : s.cliente_nombre) || 'Sin nombre',
      mascota: s.nombre_mascota || 'Sin nombre',
      fecha,
      hora: formatHora(s.hora_retiro) || '',
      dias: s.fecha_creacion ? daysSince(s.fecha_creacion) : null,
      detalle: `${s.comuna || ''}${esVet ? ' · veterinario' : ''}`.trim(),
      vencido: !!fecha && fecha < hoy,
    }
  }

  const porConfirmar = sols
    .filter(s => (s.estado || '') === 'pendiente')
    .map(deSolicitud)
    .sort((a, b) => a.fecha.localeCompare(b.fecha))

  const sinVet = cotis
    .filter(c => ['creada', 'enviada'].includes((c.estado || '').toLowerCase()))
    .map(c => {
      const fecha = formatDateForSheet(c.fecha_servicio) || String(c.fecha_servicio || '')
      return {
        id: c.id || '',
        quien: c.cliente_nombre || 'Sin nombre',
        mascota: c.mascota_nombre || 'Sin nombre',
        fecha,
        hora: formatHora(c.hora_servicio) || '',
        dias: c.fecha_creacion ? daysSince(c.fecha_creacion) : null,
        detalle: `${c.comuna || ''} · ${(c.estado || '') === 'creada' ? 'todavía no sale a la red' : 'enviada, sin respuesta'}`,
        vencido: !!fecha && fecha < hoy,
      }
    })
    .sort((a, b) => a.fecha.localeCompare(b.fecha))

  // El control del día incluye las eutanasias ya tomadas por un vet: para el
  // chofer son un retiro más y comparten la misma agenda.
  const eutanasiasProximas: Pendiente[] = cotis
    .filter(c => (c.estado || '').toLowerCase() === 'aceptada')
    .map(c => {
      const fecha = formatDateForSheet(c.fecha_servicio) || String(c.fecha_servicio || '')
      const horaRetiro = formatHora(c.hora_retiro_crematorio) || ''
      return {
        id: c.id || '',
        quien: c.cliente_nombre || 'Sin nombre',
        mascota: `${c.mascota_nombre || 'Sin nombre'} (eutanasia)`,
        fecha,
        hora: horaRetiro || formatHora(c.hora_servicio) || '',
        dias: null,
        detalle: `${c.comuna || ''} · ${c.vet_nombre_asignado || 'sin vet'}${horaRetiro ? '' : ' · falta la hora del vet'}`,
        vencido: false,
      }
    })

  const proximos = [
    ...sols.filter(s => (s.estado || '') === 'confirmada').map(deSolicitud),
    ...eutanasiasProximas,
  ]
    .filter(p => p.fecha === hoy || p.fecha === manana)
    .sort((a, b) => a.fecha.localeCompare(b.fecha) || a.hora.localeCompare(b.hora))

  return { fecha: hoy, porConfirmar, sinVet, proximos }
}

function tabla(titulo: string, items: Pendiente[], colorBorde: string): string {
  if (items.length === 0) return ''
  const filas = items.map(p => `
    <tr>
      <td style="padding:8px 10px;border-top:1px solid #eee;font-size:13px">
        <strong>${escapeHtml(p.mascota)}</strong><br>
        <span style="color:#666">${escapeHtml(p.quien)}${p.detalle ? ` · ${escapeHtml(p.detalle)}` : ''}</span>
      </td>
      <td style="padding:8px 10px;border-top:1px solid #eee;font-size:13px;white-space:nowrap">
        ${p.fecha ? escapeHtml(formatDate(p.fecha)) : '—'}${p.hora ? ` ${escapeHtml(p.hora)}` : ''}
        ${p.vencido ? '<br><span style="color:#b00;font-weight:700">ya pasó</span>' : ''}
      </td>
      <td style="padding:8px 10px;border-top:1px solid #eee;font-size:13px;white-space:nowrap;color:#666">
        ${p.dias == null ? '—' : p.dias === 0 ? 'hoy' : `hace ${p.dias} día${p.dias === 1 ? '' : 's'}`}
      </td>
    </tr>`).join('')
  return `
    <div style="margin:0 0 22px">
      <div style="font-size:15px;font-weight:800;color:${BRAND.navy};border-left:4px solid ${colorBorde};padding-left:10px;margin-bottom:8px">
        ${escapeHtml(titulo)} (${items.length})
      </div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse">
        <tr>
          <th align="left" style="padding:6px 10px;font-size:11px;text-transform:uppercase;letter-spacing:.6px;color:#888">Servicio</th>
          <th align="left" style="padding:6px 10px;font-size:11px;text-transform:uppercase;letter-spacing:.6px;color:#888">Agendado</th>
          <th align="left" style="padding:6px 10px;font-size:11px;text-transform:uppercase;letter-spacing:.6px;color:#888">Pedido</th>
        </tr>
        ${filas}
      </table>
    </div>`
}

export async function renderAvisoAgendamientos(info: InformeAgendamientos): Promise<AvisoRenderizado> {
  const contacto = await getContacto()
  const pendientes = info.porConfirmar.length + info.sinVet.length
  const fechaLegible = formatDate(info.fecha)

  const bodyHtml = pendientes === 0 && info.proximos.length === 0
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:separate;background:${BRAND.cream};border-left:4px solid ${BRAND.amber};border-radius:12px">
         <tr><td style="padding:20px">
           <div style="font-size:22px;font-weight:800;color:${BRAND.navy};margin-bottom:4px">Agenda al día 🎉</div>
           <div style="font-size:14px;color:#9a8a63">Al ${escapeHtml(fechaLegible)} no hay nada esperando respuesta.</div>
         </td></tr>
       </table>`
    : [
        pendientes > 0
          ? `<p style="margin:0 0 18px;font-size:14px;line-height:1.6">Hay <strong>${pendientes}</strong> agendamiento${pendientes === 1 ? '' : 's'} esperando una decisión nuestra. Mientras siguen ahí, el horario queda tomado y la persona espera.</p>`
          : `<p style="margin:0 0 18px;font-size:14px;line-height:1.6">No queda nada esperando respuesta. Abajo, lo agendado para hoy y mañana.</p>`,
        tabla('Retiros por confirmar', info.porConfirmar, '#e0a800'),
        tabla('Eutanasias sin veterinario', info.sinVet, '#b00'),
        tabla('Confirmados para hoy y mañana', info.proximos, BRAND.navy),
      ].join('')

  return {
    subject: pendientes > 0
      ? `⏳ ${pendientes} agendamiento${pendientes === 1 ? '' : 's'} sin resolver — ${fechaLegible}`
      : `Agenda al día — ${fechaLegible}`,
    html: renderEmailLayout({ titulo: 'Agendamientos sin resolver', bodyHtml, contacto, contexto: 'Operaciones' }),
    vacio: pendientes === 0,
    resumen: pendientes === 0
      ? `Sin pendientes · ${info.proximos.length} confirmados para hoy/mañana`
      : `${info.porConfirmar.length} por confirmar · ${info.sinVet.length} eutanasias sin vet`,
  }
}

export async function construirAvisoAgendamientos(): Promise<AvisoRenderizado> {
  return renderAvisoAgendamientos(await construirInformeAgendamientos())
}
