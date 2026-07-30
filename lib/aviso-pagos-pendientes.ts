import { getSheetData } from './datastore'
import { crearEstimadorFichas } from './precio-estimado'
import { getConfigCobroEutanasia, cobroClienteCon } from './eutanasia-precios'
import { renderEmailLayout, getContacto, escapeHtml, BRAND } from './email-layout'
import { formatDate, formatDateForSheet, daysSince, fechaChileISO } from './dates'
import { parseDecimalOr0 } from './numbers'
import { fmtPrecio } from './format'

/**
 * AVISO "Pagos pendientes": el informe diario de lo que está por cobrar.
 *
 * Entra una ficha REGISTRADA cuando (a) su `estado_pago` no es 'pagado', o
 * (b) tiene cobros no pagados en la tabla `cobros` (un adicional o una
 * diferencia de peso que quedó abierta aunque la ficha figure pagada).
 *
 * Sale en DOS bloques separados (decisión del dueño): TUTORES (B2C, se cobra al
 * momento) y CONVENIO (fichas de veterinaria, que se facturan mensualmente).
 *
 * El "por cobrar" se calcula sin duplicar plata:
 *   - ficha 'parcial'  → la suma de sus cobros pendientes (ahí vive el saldo)
 *   - ficha no pagada  → el total de la ficha
 *   - ficha pagada con cobros abiertos → la suma de esos cobros
 * El valor de una eutanasia asociada se muestra como línea informativa: se cobra
 * fuera de la boleta y no sabemos si el tutor ya la pagó (ver lib/eutanasia-precios).
 *
 * La NOTA que se muestra es `clientes.notas` — ahí el equipo escribe por qué debe.
 */

export interface LineaDetalle { nombre: string; monto: number }

export interface FichaPendiente {
  id: string
  codigo: string
  mascota: string
  fecha: string          // ISO del retiro (o creación si no hay retiro)
  dias: number | null    // días transcurridos desde esa fecha
  tutor: string
  telefono: string
  email: string
  comuna: string
  vetNombre: string      // solo fichas de convenio
  estadoPago: string     // pendiente | parcial
  formaPago: string
  lineas: LineaDetalle[]
  totalServicio: number
  eutanasia: number      // 0 si no viene de una eutanasia a domicilio
  cobros: Array<{ detalle: string; monto: number; estado: string }>
  porCobrar: number
  nota: string
}

export interface InformePagosPendientes {
  fecha: string          // YYYY-MM-DD (Chile)
  tutores: FichaPendiente[]
  convenio: FichaPendiente[]
  totalTutores: number
  totalConvenio: number
}

function normalizarEstadoPago(v: unknown): string {
  const s = String(v ?? '').toLowerCase().trim()
  if (s === 'pagado') return 'pagado'
  if (s === 'parcial') return 'parcial'
  return 'pendiente'
}

function esFichaRegistrada(c: Record<string, string>): boolean {
  return String(c.estado || '') !== 'borrador' && !!String(c.codigo || '').trim()
}

/** Junta los datos del informe. Sin efectos: la usan el cron, la vista previa y la prueba. */
export async function construirInformePagosPendientes(): Promise<InformePagosPendientes> {
  const [clientes, cobrosRows, vets, cotis, cfgEut, estimar] = await Promise.all([
    getSheetData('clientes'),
    getSheetData('cobros').catch(() => [] as Record<string, string>[]),
    getSheetData('veterinarios').catch(() => [] as Record<string, string>[]),
    getSheetData('cotizaciones_eutanasia').catch(() => [] as Record<string, string>[]),
    getConfigCobroEutanasia().catch(() => null),
    crearEstimadorFichas(),
  ])

  const vetPorId = new Map(vets.map(v => [String(v.id), String(v.nombre || '')]))
  const cobrosPorCliente = new Map<string, Record<string, string>[]>()
  for (const r of cobrosRows) {
    if (String(r.estado || '') === 'pagado') continue
    const cid = String(r.cliente_id || '')
    if (!cid) continue
    const arr = cobrosPorCliente.get(cid) ?? []
    arr.push(r)
    cobrosPorCliente.set(cid, arr)
  }
  const eutPorCliente = new Map<string, number>()
  if (cfgEut) {
    for (const c of cotis) {
      const cid = String(c.cliente_id || '')
      if (!cid) continue
      const cobro = cobroClienteCon(c, cfgEut)
      if (cobro.total > 0) eutPorCliente.set(cid, cobro.total)
    }
  }

  const tutores: FichaPendiente[] = []
  const convenio: FichaPendiente[] = []

  for (const c of clientes) {
    if (!esFichaRegistrada(c)) continue
    const id = String(c.id)
    const estadoPago = normalizarEstadoPago(c.estado_pago)
    const cobros = cobrosPorCliente.get(id) ?? []
    if (estadoPago === 'pagado' && cobros.length === 0) continue

    // Detalle: la COMPOSICIÓN sale del estimador (sabe qué ánfora premium va
    // incluida en el CP); los MONTOS mandan desde el snapshot congelado, que es
    // lo que se le cobra al cliente.
    const est = estimar(c)
    const snapServicio = parseDecimalOr0(c.precio_servicio)
    const snapTotal = parseDecimalOr0(c.precio_total)
    const lineas: LineaDetalle[] = est.lineas.map((l, i) => (
      i === 0 && snapServicio > 0 ? { nombre: l.nombre, monto: snapServicio } : { nombre: l.nombre, monto: l.monto }
    ))
    const totalServicio = snapTotal > 0 ? snapTotal : est.total

    const totalCobros = cobros.reduce((s, r) => s + (parseDecimalOr0(r.monto) || 0), 0)
    const porCobrar = estadoPago === 'pendiente' && cobros.length === 0
      ? totalServicio
      : estadoPago === 'pendiente'
        ? totalServicio + cobros.filter(r => String(r.tipo) !== 'saldo').reduce((s, r) => s + parseDecimalOr0(r.monto), 0)
        : totalCobros

    const fecha = formatDateForSheet(c.fecha_retiro) || formatDateForSheet(c.fecha_creacion) || ''
    const ficha: FichaPendiente = {
      id,
      codigo: String(c.codigo || ''),
      mascota: String(c.nombre_mascota || ''),
      fecha,
      dias: fecha ? daysSince(fecha) : null,
      tutor: String(c.nombre_tutor || ''),
      telefono: String(c.telefono || ''),
      email: String(c.email || ''),
      comuna: String(c.comuna || ''),
      vetNombre: vetPorId.get(String(c.veterinaria_id || '')) || '',
      estadoPago,
      formaPago: String(c.tipo_pago || ''),
      lineas,
      totalServicio,
      eutanasia: eutPorCliente.get(id) ?? 0,
      cobros: cobros.map(r => ({
        detalle: String(r.detalle || r.tipo || 'Cobro'),
        monto: parseDecimalOr0(r.monto),
        estado: String(r.estado || 'pendiente'),
      })),
      porCobrar,
      nota: String(c.notas || '').trim(),
    }

    if (String(c.veterinaria_id || '').trim()) convenio.push(ficha)
    else tutores.push(ficha)
  }

  // Más antiguas primero: son las que llevan más tiempo sin pagarse.
  const porFecha = (a: FichaPendiente, b: FichaPendiente) => (a.fecha || '').localeCompare(b.fecha || '')
  tutores.sort(porFecha)
  convenio.sort(porFecha)

  return {
    fecha: fechaChileISO(),
    tutores,
    convenio,
    totalTutores: tutores.reduce((s, f) => s + f.porCobrar, 0),
    totalConvenio: convenio.reduce((s, f) => s + f.porCobrar, 0),
  }
}

// ─── Render ──────────────────────────────────────────────────────────────────

const ETIQUETA_ESTADO: Record<string, string> = { pendiente: 'Pendiente', parcial: 'Pago parcial' }

function dato(label: string, valor: string): string {
  if (!valor) return ''
  return `<span style="white-space:nowrap"><span style="color:#8a8a8a">${escapeHtml(label)}</span> ${escapeHtml(valor)}</span>`
}

function renderFicha(f: FichaPendiente): string {
  const antiguedad = f.dias === null ? '' : f.dias <= 0 ? 'hoy' : f.dias === 1 ? 'hace 1 día' : `hace ${f.dias} días`
  const contacto = [
    dato('Tel.', f.telefono),
    dato('', f.email),
    dato('', f.comuna),
    f.formaPago ? dato('Pago:', f.formaPago) : '',
    f.vetNombre ? dato('Vet:', f.vetNombre) : '',
  ].filter(Boolean).join('<span style="color:#ccc"> · </span>')

  const filasDetalle = f.lineas.map(l => `
    <tr>
      <td style="padding:2px 0;font-size:13px;color:#555">${escapeHtml(l.nombre)}</td>
      <td style="padding:2px 0;font-size:13px;color:#333;text-align:right;white-space:nowrap">${fmtPrecio(l.monto)}</td>
    </tr>`).join('')

  const filaEutanasia = f.eutanasia > 0 ? `
    <tr>
      <td style="padding:2px 0;font-size:13px;color:#555">Eutanasia a domicilio <span style="color:#999">(fuera de boleta)</span></td>
      <td style="padding:2px 0;font-size:13px;color:#333;text-align:right;white-space:nowrap">${fmtPrecio(f.eutanasia)}</td>
    </tr>` : ''

  const filasCobros = f.cobros.map(c => `
    <tr>
      <td style="padding:2px 0;font-size:13px;color:#B45309">Por cobrar: ${escapeHtml(c.detalle)}${c.estado === 'cliente_confirmo' ? ' <span style="color:#999">(el tutor dice que ya transfirió)</span>' : ''}</td>
      <td style="padding:2px 0;font-size:13px;color:#B45309;text-align:right;white-space:nowrap">${fmtPrecio(c.monto)}</td>
    </tr>`).join('')

  const nota = f.nota
    ? `<div style="margin:10px 0 0;padding:8px 10px;background:#FFF8E7;border-left:3px solid ${BRAND.amber};font-size:13px;color:#5a4a25;white-space:pre-wrap">${escapeHtml(f.nota)}</div>`
    : `<div style="margin:10px 0 0;font-size:12px;color:#aaa;font-style:italic">Sin nota — anota en la ficha por qué está pendiente.</div>`

  return `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 14px;border:1px solid #e3e3e3;border-radius:10px">
    <tr><td style="padding:14px 16px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td style="font-size:15px;font-weight:700;color:${BRAND.navy}">${escapeHtml(f.codigo)}${f.mascota ? ` · ${escapeHtml(f.mascota)}` : ''}</td>
          <td style="text-align:right;font-size:15px;font-weight:700;color:${BRAND.navy};white-space:nowrap">${fmtPrecio(f.porCobrar)}</td>
        </tr>
        <tr>
          <td style="font-size:13px;color:#777;padding-top:2px">${escapeHtml(formatDate(f.fecha))}${antiguedad ? ` · ${escapeHtml(antiguedad)}` : ''}</td>
          <td style="text-align:right;font-size:12px;color:#B45309;padding-top:2px;white-space:nowrap">${escapeHtml(ETIQUETA_ESTADO[f.estadoPago] || f.estadoPago)}</td>
        </tr>
      </table>
      <div style="margin:8px 0 0;font-size:14px;font-weight:600;color:#333">${escapeHtml(f.tutor || '(sin nombre)')}</div>
      ${contacto ? `<div style="margin:2px 0 0;font-size:13px;color:#666">${contacto}</div>` : ''}
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:10px 0 0;border-top:1px solid #eee;padding-top:6px">
        ${filasDetalle}${filaEutanasia}${filasCobros}
        <tr>
          <td style="padding:6px 0 0;font-size:13px;font-weight:700;color:#333;border-top:1px solid #eee">Total del servicio</td>
          <td style="padding:6px 0 0;font-size:13px;font-weight:700;color:#333;text-align:right;white-space:nowrap;border-top:1px solid #eee">${fmtPrecio(f.totalServicio)}</td>
        </tr>
      </table>
      ${nota}
    </td></tr>
  </table>`
}

function renderBloque(titulo: string, subtitulo: string, fichas: FichaPendiente[], total: number): string {
  if (fichas.length === 0) return ''
  return `
  <div style="margin:0 0 8px">
    <div style="font-size:16px;font-weight:700;color:${BRAND.navy}">${escapeHtml(titulo)} <span style="color:#999;font-weight:400">(${fichas.length})</span></div>
    <div style="font-size:12px;color:#999;margin:2px 0 12px">${escapeHtml(subtitulo)} · Total por cobrar ${fmtPrecio(total)}</div>
  </div>
  ${fichas.map(renderFicha).join('')}`
}

export interface AvisoRenderizado {
  subject: string
  html: string
  /** true si no hay nada que reportar (sirve para el "no enviar si está vacío"). */
  vacio: boolean
  /** Resumen de una línea para la UI y los logs. */
  resumen: string
}

/** Arma el correo del aviso a partir de los datos ya reunidos. */
export async function renderAvisoPagosPendientes(informe: InformePagosPendientes): Promise<AvisoRenderizado> {
  const contacto = await getContacto()
  const n = informe.tutores.length + informe.convenio.length
  const total = informe.totalTutores + informe.totalConvenio
  const fechaLegible = formatDate(informe.fecha)

  if (n === 0) {
    const bodyHtml = `
      <p style="margin:0 0 8px;font-size:15px;color:#222">Al ${escapeHtml(fechaLegible)} no hay pagos pendientes.</p>
      <p style="margin:0;font-size:14px;color:#666">Todas las fichas registradas figuran pagadas y no hay cobros abiertos.</p>`
    return {
      subject: `Pagos pendientes — todo al día (${fechaLegible})`,
      html: renderEmailLayout({ titulo: 'Pagos pendientes', bodyHtml, contacto, contexto: 'Informe diario' }),
      vacio: true,
      resumen: 'Sin pagos pendientes.',
    }
  }

  const bodyHtml = `
    <p style="margin:0 0 4px;font-size:15px;color:#222">
      Al ${escapeHtml(fechaLegible)} hay <strong>${n} ${n === 1 ? 'ficha' : 'fichas'}</strong> con pago pendiente por un total de <strong>${fmtPrecio(total)}</strong>.
    </p>
    <p style="margin:0 0 20px;font-size:13px;color:#888">Ordenadas de la más antigua a la más reciente.</p>
    ${renderBloque('Tutores', 'Cobro directo al tutor', informe.tutores, informe.totalTutores)}
    ${informe.tutores.length && informe.convenio.length ? '<div style="height:14px"></div>' : ''}
    ${renderBloque('Convenio', 'Fichas de veterinaria — se facturan a la clínica', informe.convenio, informe.totalConvenio)}`

  const partes = [
    informe.tutores.length ? `${informe.tutores.length} de tutores` : '',
    informe.convenio.length ? `${informe.convenio.length} de convenio` : '',
  ].filter(Boolean).join(' y ')

  return {
    subject: `Pagos pendientes — ${n} ${n === 1 ? 'ficha' : 'fichas'} · ${fmtPrecio(total)} (${fechaLegible})`,
    html: renderEmailLayout({ titulo: 'Pagos pendientes', bodyHtml, contacto, contexto: 'Informe diario' }),
    vacio: false,
    resumen: `${n} ${n === 1 ? 'ficha' : 'fichas'} (${partes}) por ${fmtPrecio(total)}.`,
  }
}

/** Datos + render en una pasada (lo que usan el cron, la vista previa y la prueba). */
export async function construirAvisoPagosPendientes(): Promise<AvisoRenderizado> {
  return renderAvisoPagosPendientes(await construirInformePagosPendientes())
}
