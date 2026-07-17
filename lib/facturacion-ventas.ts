import { getSheetData } from './datastore'
import { formatDateForSheet } from './dates'
import { parsePeso } from './numbers'
import { calcularPrecioFicha, type Tramo } from './ficha-precio'

/**
 * Vistas de VENTAS de la sección Facturación (distinto de los DOCUMENTOS emitidos):
 *  - Boletas  → todas las ventas a TUTOR (B2C), con o sin boleta emitida.
 *  - Facturas → todas las ventas a VETERINARIA (B2B), con o sin factura emitida.
 *
 * El monto se calcula SIEMPRE con `calcularPrecioFicha` (la misma función del
 * informe de veterinaria y de la propuesta de facturación): si la ficha tiene
 * snapshot congelado lo usa, y si es legacy (sin snapshot → precio_total vacío)
 * lo recalcula en vivo por peso + servicio. Así ninguna venta aparece en $0.
 *
 * El estado del documento (boleta/factura) se resuelve cruzando
 * `clientes.boleta_id` / `clientes.factura_vet_id` contra `documentos_tributarios`.
 */

export interface DocResumen {
  id: string
  folio: string
  estado: string        // emitido | anulado
  ambiente: string
  pdf_url: string
  openfactura_url: string
  fecha_emision: string
}

export interface VentaBoleta {
  id: string
  codigo: string
  nombre_mascota: string
  nombre_tutor: string
  email: string
  fecha: string          // fecha_retiro (ISO) o fecha_creacion
  monto: number
  estado_pago: string    // pagado | parcial | pendiente
  boleta: DocResumen | null
}

export interface VentaFactura {
  id: string
  codigo: string
  nombre_mascota: string
  especie: string
  peso: number
  codigo_servicio: string
  fecha_retiro: string   // ISO
  mes: string            // YYYY-MM (de fecha_retiro)
  veterinaria_id: string
  vet_nombre: string
  vet_rut: string
  vet_correo: string
  monto: number
  factura: DocResumen | null
}

function normalizarEstadoPago(v: string): string {
  const s = (v || '').toLowerCase().trim()
  if (s === 'pagado') return 'pagado'
  if (s === 'parcial') return 'parcial'
  return 'pendiente'
}

async function cargarTablas(): Promise<{ g: Tramo[]; c: Tramo[]; e: Tramo[] }> {
  const [preciosG, preciosC, preciosE] = await Promise.all([
    getSheetData('precios_generales'),
    getSheetData('precios_convenio'),
    getSheetData('precios_especiales').catch(() => [] as Record<string, string>[]),
  ])
  return {
    g: preciosG as unknown as Tramo[],
    c: preciosC as unknown as Tramo[],
    e: preciosE as unknown as Tramo[],
  }
}

/** Mapa id-de-documento → resumen, para cruzar boleta_id / factura_vet_id. */
async function mapaDocumentos(): Promise<Map<string, DocResumen>> {
  const docs = await getSheetData('documentos_tributarios')
  const m = new Map<string, DocResumen>()
  for (const d of docs) {
    m.set(String(d.id), {
      id: String(d.id),
      folio: d.folio || '',
      estado: d.estado || '',
      ambiente: d.ambiente || '',
      pdf_url: d.pdf_url || '',
      openfactura_url: d.openfactura_url || '',
      fecha_emision: d.fecha_emision || '',
    })
  }
  return m
}

function esFichaRegistrada(c: Record<string, string>): boolean {
  return String(c.estado || '') !== 'borrador' && !!String(c.codigo || '').trim()
}

export interface FiltrosBoleta { desde?: string; hasta?: string; q?: string }

/** Todas las ventas a tutor (B2C) con su monto y el estado de su boleta. */
export async function listarVentasBoleta(f: FiltrosBoleta = {}): Promise<VentaBoleta[]> {
  const [clientes, tablas, docs] = await Promise.all([
    getSheetData('clientes'),
    cargarTablas(),
    mapaDocumentos(),
  ])
  const q = (f.q || '').trim().toLowerCase()

  const out: VentaBoleta[] = []
  for (const c of clientes) {
    if (String(c.veterinaria_id || '').trim()) continue   // vets → factura, no boleta
    if (!esFichaRegistrada(c)) continue
    const fISO = formatDateForSheet(c.fecha_retiro) || formatDateForSheet(c.fecha_creacion) || ''
    if (f.desde && (!fISO || fISO < f.desde)) continue
    if (f.hasta && (!fISO || fISO > f.hasta)) continue

    const precio = calcularPrecioFicha(c, undefined, { generales: tablas.g, convenio: tablas.c, especialesDeVet: [] })
    const boletaId = String(c.boleta_id || '').trim()

    const venta: VentaBoleta = {
      id: String(c.id),
      codigo: c.codigo || '',
      nombre_mascota: c.nombre_mascota || '',
      nombre_tutor: c.nombre_tutor || '',
      email: c.email || '',
      fecha: fISO,
      monto: precio.total,
      estado_pago: normalizarEstadoPago(c.estado_pago),
      boleta: boletaId ? (docs.get(boletaId) ?? null) : null,
    }
    if (q) {
      const hay = `${venta.codigo} ${venta.nombre_mascota} ${venta.nombre_tutor} ${venta.email} ${venta.boleta?.folio || ''}`.toLowerCase()
      if (!hay.includes(q)) continue
    }
    out.push(venta)
  }
  // Más recientes primero (por fecha, desempate por id).
  out.sort((a, b) => (b.fecha || '').localeCompare(a.fecha || '') || (parseInt(b.id, 10) || 0) - (parseInt(a.id, 10) || 0))
  return out
}

export interface FiltrosFactura { mes?: string; q?: string }

/** Todas las ventas a veterinaria (B2B) con su monto y el estado de su factura. */
export async function listarVentasFactura(f: FiltrosFactura = {}): Promise<VentaFactura[]> {
  const [clientes, vets, tablas, docs] = await Promise.all([
    getSheetData('clientes'),
    getSheetData('veterinarios'),
    cargarTablas(),
    mapaDocumentos(),
  ])
  const vetById = new Map(vets.map(v => [String(v.id), v]))
  const q = (f.q || '').trim().toLowerCase()

  const out: VentaFactura[] = []
  for (const c of clientes) {
    const vetId = String(c.veterinaria_id || '').trim()
    if (!vetId) continue                     // solo ventas de convenio
    if (!esFichaRegistrada(c)) continue
    const fISO = formatDateForSheet(c.fecha_retiro) || ''
    const mes = fISO ? fISO.slice(0, 7) : ''
    if (f.mes && mes !== f.mes) continue

    const vet = vetById.get(vetId)
    const especialesDeVet = tablas.e.filter(t => t.veterinaria_id === vetId)
    const precio = calcularPrecioFicha(c, vet?.tipo_precios, { generales: tablas.g, convenio: tablas.c, especialesDeVet })
    const facturaId = String(c.factura_vet_id || '').trim()

    const venta: VentaFactura = {
      id: String(c.id),
      codigo: c.codigo || '',
      nombre_mascota: c.nombre_mascota || '',
      especie: c.especie || '',
      peso: parsePeso(c.peso_ingreso) || parsePeso(c.peso_declarado),
      codigo_servicio: (c.codigo_servicio || 'CI').toUpperCase(),
      fecha_retiro: fISO,
      mes,
      veterinaria_id: vetId,
      vet_nombre: vet?.nombre || '(veterinaria eliminada)',
      vet_rut: vet?.rut || '',
      vet_correo: vet?.correo || '',
      monto: precio.total,
      factura: facturaId ? (docs.get(facturaId) ?? null) : null,
    }
    if (q) {
      const hay = `${venta.codigo} ${venta.nombre_mascota} ${venta.vet_nombre} ${venta.vet_rut} ${venta.factura?.folio || ''}`.toLowerCase()
      if (!hay.includes(q)) continue
    }
    out.push(venta)
  }
  out.sort((a, b) => (b.fecha_retiro || '').localeCompare(a.fecha_retiro || '') || (parseInt(b.id, 10) || 0) - (parseInt(a.id, 10) || 0))
  return out
}
