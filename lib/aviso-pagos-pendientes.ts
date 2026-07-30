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
//
// Tabla mínima para leer en el TELÉFONO, metida dentro de una TARJETA por bloque
// (pedido del dueño: sin caja se ven "en el aire"). Cuatro columnas —fecha, quién
// debe, qué debe y la nota—, total grande al pie de cada tarjeta y un tono suelto:
// es un correo interno para el equipo, no una carta al cliente.

const TH = `padding:8px;font-size:11px;font-weight:700;color:#8a8a8a;text-align:left;text-transform:uppercase;letter-spacing:.03em`
const TD = `padding:10px 8px;font-size:13px;color:#333;vertical-align:top;border-top:1px solid #eee;line-height:1.4`

/** Acorta un nombre de servicio para el móvil: "Retiro fuera de horario (después
 *  de las 18:00 y fines de semana)" → "Retiro fuera de horario". */
function nombreCorto(n: string): string {
  return n.split(' (')[0].trim() || n
}

/** "28-07" si es de este año; "16-12-2025" si es de otro (para no confundir). */
function fechaCorta(iso: string): string {
  const completa = formatDate(iso)
  if (!completa) return ''
  return completa.endsWith(String(new Date().getFullYear())) ? completa.slice(0, 5) : completa
}

function renderFila(f: FichaPendiente): string {
  const quien = f.vetNombre || f.tutor || '(sin nombre)'

  // Servicio: la modalidad y sus adicionales en una sola línea legible.
  const servicios = f.lineas.filter(l => l.monto >= 0).map(l => nombreCorto(l.nombre))
  if (f.eutanasia > 0) servicios.push('Eutanasia a domicilio')
  const descuento = f.lineas.find(l => l.monto < 0)

  const saldo = f.estadoPago === 'parcial' ? 'le falta este saldo' : 'debe todo'
  const cobros = f.cobros.map(c => (
    `<div style="color:#B45309;font-size:12px;margin-top:3px">+ ${escapeHtml(c.detalle)} ${fmtPrecio(c.monto)}</div>`
  )).join('')

  return `
    <tr>
      <td style="${TD};white-space:nowrap;color:#777">${escapeHtml(fechaCorta(f.fecha))}</td>
      <td style="${TD}">
        <strong>${escapeHtml(quien)}</strong>
        <div style="font-size:11px;color:#aaa">${escapeHtml(f.codigo)}${f.mascota ? ` · ${escapeHtml(f.mascota)}` : ''}</div>
      </td>
      <td style="${TD}">
        ${escapeHtml(servicios.join(' + '))}
        ${descuento ? `<div style="font-size:11px;color:#999">${escapeHtml(nombreCorto(descuento.nombre))} ${fmtPrecio(descuento.monto)}</div>` : ''}
        <div style="margin-top:3px"><strong style="color:${BRAND.navy};font-size:15px">${fmtPrecio(f.porCobrar)}</strong> <span style="font-size:11px;color:#aaa">${saldo}</span></div>
        ${cobros}
      </td>
      <td style="${TD};font-size:12px;color:#6b5a30">${f.nota ? escapeHtml(f.nota) : '<span style="color:#ccc">sin nota</span>'}</td>
    </tr>`
}

/** Una tarjeta por bloque: encabezado, tabla y el total grande al pie. */
function renderBloque(titulo: string, emoji: string, fichas: FichaPendiente[], total: number): string {
  if (fichas.length === 0) return ''
  const cuantas = `${fichas.length} ${fichas.length === 1 ? 'ficha' : 'fichas'}`
  return `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:separate;border-spacing:0;margin:0 0 18px;background:#fff;border:1px solid #e6e6e6;border-radius:14px;overflow:hidden">
    <tr>
      <td style="padding:14px 14px 8px">
        <span style="font-size:15px;font-weight:700;color:${BRAND.navy}">${emoji} ${escapeHtml(titulo)}</span>
        <span style="font-size:12px;color:#aaa"> · ${cuantas}</span>
      </td>
    </tr>
    <tr>
      <td style="padding:0 6px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse">
          <tr>
            <th style="${TH}">Fecha</th>
            <th style="${TH}">${escapeHtml(titulo === 'Convenio' ? 'Veterinaria' : 'Tutor')}</th>
            <th style="${TH}">Servicio</th>
            <th style="${TH}">¿Por qué debe?</th>
          </tr>
          ${fichas.map(renderFila).join('')}
        </table>
      </td>
    </tr>
    <tr>
      <td style="padding:12px 16px;background:#f6f8fa;border-top:1px solid #ececec">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td style="font-size:12px;color:#999;text-transform:uppercase;letter-spacing:.04em">Total ${escapeHtml(titulo.toLowerCase())}</td>
            <td style="text-align:right;font-size:22px;font-weight:800;color:${BRAND.navy};white-space:nowrap">${fmtPrecio(total)}</td>
          </tr>
        </table>
      </td>
    </tr>
  </table>`
}

/** El número grande de arriba: lo primero que se ve al abrir el correo. */
function renderHero(n: number, total: number, masAntigua: number | null): string {
  const detalle = [
    `${n} ${n === 1 ? 'ficha' : 'fichas'}`,
    masAntigua && masAntigua > 1 ? `la más antigua lleva ${masAntigua} días` : '',
  ].filter(Boolean).join(' · ')
  return `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:separate;border-spacing:0;margin:0 0 18px;background:${BRAND.cream};border-left:4px solid ${BRAND.amber};border-radius:12px">
    <tr>
      <td style="padding:16px 18px">
        <div style="font-size:12px;color:#9a8a63;text-transform:uppercase;letter-spacing:.05em;font-weight:700">Por cobrar</div>
        <div style="font-size:34px;font-weight:800;color:${BRAND.navy};line-height:1.15;margin:2px 0">${fmtPrecio(total)}</div>
        <div style="font-size:13px;color:#9a8a63">${escapeHtml(detalle)}</div>
      </td>
    </tr>
  </table>`
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
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:separate;border-spacing:0;background:${BRAND.cream};border-left:4px solid ${BRAND.amber};border-radius:12px">
        <tr><td style="padding:20px">
          <div style="font-size:22px;font-weight:800;color:${BRAND.navy};margin-bottom:4px">Todo cobrado 🎉</div>
          <div style="font-size:14px;color:#9a8a63">Al ${escapeHtml(fechaLegible)} no queda ni un peso pendiente. Buen trabajo.</div>
        </td></tr>
      </table>`
    return {
      subject: `Pagos pendientes: ninguno — todo cobrado (${fechaLegible})`,
      html: renderEmailLayout({ titulo: 'Pagos pendientes', bodyHtml, contacto, contexto: 'Cobranza del día' }),
      vacio: true,
      resumen: 'Sin pagos pendientes.',
    }
  }

  // Antigüedad de la más vieja: le pone urgencia al número grande.
  const masAntigua = [...informe.tutores, ...informe.convenio]
    .map(f => f.dias ?? 0)
    .reduce((max, d) => Math.max(max, d), 0)

  const bodyHtml = `
    <p style="margin:0 0 14px;font-size:15px;color:#444">Esto es lo que quedó por cobrar 🐾</p>
    ${renderHero(n, total, masAntigua)}
    ${renderBloque('Tutores', '🏠', informe.tutores, informe.totalTutores)}
    ${renderBloque('Convenio', '🏥', informe.convenio, informe.totalConvenio)}
    <p style="margin:4px 0 0;font-size:13px;color:#999">
      Apenas cobres una, márcala como pagada en su ficha y desaparece sola de esta lista.
    </p>`

  const partes = [
    informe.tutores.length ? `${informe.tutores.length} de tutores` : '',
    informe.convenio.length ? `${informe.convenio.length} de convenio` : '',
  ].filter(Boolean).join(' y ')

  return {
    subject: `${fmtPrecio(total)} por cobrar — ${n} ${n === 1 ? 'ficha' : 'fichas'} (${fechaLegible})`,
    html: renderEmailLayout({ titulo: 'Pagos pendientes', bodyHtml, contacto, contexto: 'Cobranza del día' }),
    vacio: false,
    resumen: `${n} ${n === 1 ? 'ficha' : 'fichas'} (${partes}) por ${fmtPrecio(total)}.`,
  }
}

/** Datos + render en una pasada (lo que usan el cron, la vista previa y la prueba). */
export async function construirAvisoPagosPendientes(): Promise<AvisoRenderizado> {
  return renderAvisoPagosPendientes(await construirInformePagosPendientes())
}
