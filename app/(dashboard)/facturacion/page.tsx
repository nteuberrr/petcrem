'use client'
import { useState, useEffect, useCallback, useMemo, type ReactNode } from 'react'
import { PageHeader, Card, Button, Tabs } from '@/components/ui/kit'
import { CreditCard, FileText, Hospital, Receipt, Scale, Undo2 } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { TableSkeleton } from '@/components/ui/Skeleton'
import { fmtPrecio, fmtFecha, fmtKg } from '@/lib/format'
import ManualModal from '@/components/facturacion/ManualModal'
import FacturarVetsModal from '@/components/facturacion/FacturarVetsModal'
import VentasPosTab from '@/components/facturacion/VentasPosTab'
import ConciliacionTab from '@/components/facturacion/ConciliacionTab'

export type TipoTab = '39' | '33' | '61' | 'pos' | 'conciliacion'

export interface DocResumen {
  id: string
  folio: string
  estado: string
  ambiente: string
  pdf_url: string
  openfactura_url: string
  fecha_emision: string
  /** Monto ya acreditado por notas de crédito PARCIALES (0 si no tiene). */
  abonado: number
  monto_total: number
}

export interface VentaBoleta {
  id: string
  codigo: string
  nombre_mascota: string
  nombre_tutor: string
  email: string
  fecha: string
  monto: number
  estado_pago: string
  boleta: DocResumen | null
  /** Boletas de cobros posteriores (adicional / diferencia de peso) de esta ficha. */
  boletas_cobro: DocResumen[]
}

export interface VentaFactura {
  id: string
  codigo: string
  nombre_mascota: string
  especie: string
  peso: number
  codigo_servicio: string
  fecha_retiro: string
  mes: string
  veterinaria_id: string
  vet_nombre: string
  vet_rut: string
  vet_correo: string
  monto: number
  factura: DocResumen | null
  /** Boleta al TUTOR de una venta de convenio (vets con comisión). Excluyente con `factura`. */
  boleta: DocResumen | null
}

export interface Documento {
  id: string
  tipo_dte: string
  folio: string
  estado: string
  ambiente: string
  fecha_emision: string
  receptor_razon_social: string
  receptor_rut: string
  monto_total: string
  resumen: string
  mes_facturado: string
  pdf_url: string
  openfactura_url: string
  documento_anulado_id: string
  nc_id: string
  /** Ya acreditado por NC parciales — el modal lo usa para ofrecer el saldo. */
  abonado?: number
}

const TABS: { key: TipoTab; label: ReactNode }[] = [
  { key: '39', label: <><Receipt className="w-4 h-4" aria-hidden="true" /> Boletas</> },
  { key: '33', label: <><FileText className="w-4 h-4" aria-hidden="true" /> Facturas</> },
  { key: '61', label: <><Undo2 className="w-4 h-4" aria-hidden="true" /> Notas de Crédito</> },
  { key: 'pos', label: <><CreditCard className="w-4 h-4" aria-hidden="true" /> Ventas POS</> },
  { key: 'conciliacion', label: <><Scale className="w-4 h-4" aria-hidden="true" /> Conciliación</> },
]

export default function FacturacionPage() {
  const [tab, setTab] = useState<TipoTab>('39')
  const [showManual, setShowManual] = useState(false)
  const [showVets, setShowVets] = useState(false)

  return (
    <div className="space-y-5">
      <PageHeader
        icon={<Receipt className="w-7 h-7 text-brand" aria-hidden="true" />}
        title="Facturación"
        subtitle="Ventas del negocio y sus documentos tributarios (OpenFactura / SII)"
        actions={
          <>
            <Button variant="secondary" onClick={() => setShowVets(true)}><Hospital className="w-4 h-4" aria-hidden="true" /> Facturar Veterinarios (lote)</Button>
            <Button variant="primary" onClick={() => setShowManual(true)}>+ Documento manual</Button>
          </>
        }
      />

      <Tabs tabs={TABS} value={tab} onChange={k => setTab(k as TipoTab)} />

      {tab === '39' && <BoletasTab />}
      {tab === '33' && <FacturasTab onAbrirLote={() => setShowVets(true)} />}
      {tab === '61' && <NotasCreditoTab />}
      {tab === 'pos' && <VentasPosTab />}
      {tab === 'conciliacion' && <ConciliacionTab />}

      {showManual && <ManualModal onClose={() => setShowManual(false)} onEmitido={() => setShowManual(false)} />}
      {showVets && <FacturarVetsModal onClose={() => setShowVets(false)} onEmitido={() => setShowVets(false)} />}
    </div>
  )
}

// ─── Filtros reutilizables ────────────────────────────────────────────────────
function FiltrosFecha({ desde, hasta, q, setDesde, setHasta, setQ }: {
  desde: string; hasta: string; q: string
  setDesde: (v: string) => void; setHasta: (v: string) => void; setQ: (v: string) => void
}) {
  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[140px]">
          <label className="block text-xs font-semibold text-gray-600 mb-1">Desde</label>
          <input type="date" value={desde} onChange={e => setDesde(e.target.value)} className="w-full border-2 border-gray-300 rounded-lg px-2 py-1.5 text-sm" />
        </div>
        <div className="flex-1 min-w-[140px]">
          <label className="block text-xs font-semibold text-gray-600 mb-1">Hasta</label>
          <input type="date" value={hasta} onChange={e => setHasta(e.target.value)} className="w-full border-2 border-gray-300 rounded-lg px-2 py-1.5 text-sm" />
        </div>
        <div className="flex-1 min-w-full sm:min-w-[180px]">
          <label className="block text-xs font-semibold text-gray-600 mb-1">Buscar</label>
          <input type="text" value={q} onChange={e => setQ(e.target.value)} placeholder="Código, mascota, tutor, folio…"
            className="w-full border-2 border-gray-300 rounded-lg px-2 py-1.5 text-sm" />
        </div>
        {(desde || hasta || q) && (
          <button onClick={() => { setDesde(''); setHasta(''); setQ('') }} className="text-xs text-brand-soft hover:underline pb-2">Limpiar filtros</button>
        )}
      </div>
    </Card>
  )
}

function BadgePago({ estado }: { estado: string }) {
  if (estado === 'pagado') return <Badge variant="green">Pagado</Badge>
  if (estado === 'parcial') return <Badge variant="yellow">Pago parcial</Badge>
  return <Badge variant="red">Pendiente</Badge>
}

function LinkDoc({ doc }: { doc: DocResumen }) {
  const href = doc.pdf_url || doc.openfactura_url
  if (!href) return <span className="text-xs text-gray-400">sin PDF</span>
  return <a href={href} target="_blank" rel="noopener noreferrer" className="text-xs font-semibold text-brand-soft hover:underline">{doc.pdf_url ? 'Descargar' : 'Ver documento'}</a>
}

/**
 * Documento de una venta de convenio: factura al vet (lo normal) o boleta al tutor
 * (vets con comisión). Nunca las dos.
 */
function DocVenta({ factura, boleta }: { factura: DocResumen | null; boleta: DocResumen | null }) {
  const doc = factura ?? boleta
  if (!doc) return <span className="text-xs text-gray-400">Sin documento</span>
  if (doc.estado === 'anulado') return <Badge variant="red">{factura ? 'Factura anulada' : 'Boleta anulada'}</Badge>
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <Badge variant={factura ? 'blue' : 'green'}>{factura ? 'Factura' : 'Boleta'}</Badge>
      <span className="text-xs font-mono font-bold text-brand">{doc.folio || 'emitida'}</span>
      {doc.abonado > 0 && <Badge variant="yellow">NC parcial {fmtPrecio(doc.abonado)}</Badge>}
    </span>
  )
}

/** Estado de la boleta de una venta a tutor, con el aviso de NC parcial si la tiene. */
function DocBoleta({ boleta }: { boleta: DocResumen | null }) {
  if (!boleta) return <span className="text-xs text-gray-400">Sin emitir</span>
  if (boleta.estado === 'anulado') return <Badge variant="red">Anulada</Badge>
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span className="text-xs font-mono font-bold text-brand">{boleta.folio || '—'}</span>
      {boleta.abonado > 0 && <Badge variant="yellow">NC parcial {fmtPrecio(boleta.abonado)}</Badge>}
    </span>
  )
}

/**
 * Boletas de COBROS POSTERIORES de la ficha (adicional pedido después, diferencia
 * de peso). No son parte del monto de la venta: son plata cobrada aparte. Antes no
 * se veían en ninguna vista del módulo porque cuelgan de `cobros`, no de la ficha.
 */
function BoletasCobro({ boletas }: { boletas: DocResumen[] }) {
  if (boletas.length === 0) return null
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {boletas.map(b => (
        <span key={b.id} className="inline-flex items-center gap-1 rounded-lg border border-gray-300 bg-gray-50 px-1.5 py-0.5">
          <span className="text-[10px] uppercase tracking-wide text-gray-500">Cobro</span>
          <span className={`text-xs font-mono font-bold ${b.estado === 'anulado' ? 'text-gray-400 line-through' : 'text-brand'}`}>{b.folio || '—'}</span>
          <span className="text-xs text-gray-600">{fmtPrecio(b.monto_total)}</span>
        </span>
      ))}
    </span>
  )
}

/** Adapta un DocResumen (boleta) al shape que espera el modal de nota de crédito. */
function docParaAnular(doc: DocResumen, razonSocial: string): Documento {
  return {
    id: doc.id, tipo_dte: '39', folio: doc.folio, estado: doc.estado,
    ambiente: doc.ambiente, fecha_emision: doc.fecha_emision,
    receptor_razon_social: razonSocial, receptor_rut: '',
    monto_total: String(doc.monto_total), resumen: '', mes_facturado: '',
    pdf_url: doc.pdf_url, openfactura_url: doc.openfactura_url,
    documento_anulado_id: '', nc_id: '', abonado: doc.abonado,
  }
}

// ─── Boletas: ventas B2C ──────────────────────────────────────────────────────
function BoletasTab() {
  const [ventas, setVentas] = useState<VentaBoleta[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [desde, setDesde] = useState('')
  const [hasta, setHasta] = useState('')
  const [q, setQ] = useState('')
  const [emitiendo, setEmitiendo] = useState<string | null>(null)
  const [errFila, setErrFila] = useState<Record<string, string>>({})
  const [anular, setAnular] = useState<Documento | null>(null)

  const cargar = useCallback(async () => {
    setLoading(true); setErr('')
    try {
      const params = new URLSearchParams()
      if (desde) params.set('desde', desde)
      if (hasta) params.set('hasta', hasta)
      if (q.trim()) params.set('q', q.trim())
      const r = await fetch(`/api/facturacion/ventas-boleta?${params}`, { cache: 'no-store' })
      const d = await r.json()
      if (!r.ok) { setErr(d.error || 'Error'); setVentas([]) } else setVentas(d.ventas || [])
    } catch { setErr('Error de red'); setVentas([]) }
    setLoading(false)
  }, [desde, hasta, q])

  useEffect(() => { cargar() }, [cargar])

  // Paginación: la tabla renderizaba las ~250 ventas de una (16.000px de alto).
  const POR_PAGINA = 25
  const [pagina, setPagina] = useState(1)
  useEffect(() => { setPagina(1) }, [desde, hasta, q])
  const totalPaginas = Math.max(1, Math.ceil(ventas.length / POR_PAGINA))
  const paginaActual = Math.min(pagina, totalPaginas)
  const visibles = useMemo(
    () => ventas.slice((paginaActual - 1) * POR_PAGINA, paginaActual * POR_PAGINA),
    [ventas, paginaActual],
  )

  const tot = useMemo(() => {
    const total = ventas.reduce((s, v) => s + v.monto, 0)
    const emitidas = ventas.filter(v => v.boleta).length
    const pagadasSinBoleta = ventas.filter(v => v.estado_pago === 'pagado' && !v.boleta).length
    // Cobros posteriores boleteados aparte: no suman al total de ventas (esa plata
    // se cobró después de congelado el monto de la ficha), pero sí hay que verlos.
    const cobros = ventas.reduce((s, v) => s + v.boletas_cobro.filter(b => b.estado !== 'anulado').length, 0)
    return { total, emitidas, pagadasSinBoleta, cobros }
  }, [ventas])

  async function emitir(v: VentaBoleta) {
    if (!confirm(`Se emitirá una BOLETA electrónica real al SII por ${fmtPrecio(v.monto)} para ${v.nombre_mascota || 'la mascota'} (${v.codigo}). ¿Continuar?`)) return
    setEmitiendo(v.id)
    setErrFila(prev => { const n = { ...prev }; delete n[v.id]; return n })
    try {
      const r = await fetch(`/api/facturacion/pendientes/${v.id}/reintentar`, { method: 'POST' })
      const d = await r.json()
      if (!r.ok) setErrFila(prev => ({ ...prev, [v.id]: d.error || 'No se pudo emitir.' }))
      else await cargar()
    } catch { setErrFila(prev => ({ ...prev, [v.id]: 'Error de red' })) }
    setEmitiendo(null)
  }

  return (
    <div className="space-y-5">
      <FiltrosFecha desde={desde} hasta={hasta} q={q} setDesde={setDesde} setHasta={setHasta} setQ={setQ} />
      <Card className="p-0 overflow-hidden">
        {loading ? <TableSkeleton rows={8} />
        : err ? <p className="p-4 text-sm text-red-700 bg-red-50">{err}</p>
        : ventas.length === 0 ? <p className="p-8 text-center text-sm text-gray-400">Sin ventas de tutor en este período.</p>
        : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full md:min-w-[880px] text-sm">
                <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
                  <tr>
                    <th className="text-left px-2 md:px-4 py-2.5">Código</th>
                    <th className="text-left px-2 md:px-4 py-2.5">Mascota / Tutor</th>
                    <th className="text-left px-4 py-2.5 hidden md:table-cell">Fecha</th>
                    <th className="text-right px-2 md:px-4 py-2.5">Monto</th>
                    <th className="text-left px-4 py-2.5 hidden md:table-cell">Pago</th>
                    <th className="text-left px-4 py-2.5 hidden md:table-cell">Boleta</th>
                    <th className="text-right px-2 md:px-4 py-2.5">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {visibles.map(v => (
                    <tr key={v.id} className="hover:bg-gray-50">
                      <td className="px-2 md:px-4 py-2.5 font-mono text-xs font-bold text-brand">{v.codigo || `#${v.id}`}</td>
                      <td className="px-2 md:px-4 py-2.5">
                        <div className="text-gray-900 font-medium">{v.nombre_mascota || '—'}</div>
                        <div className="text-xs text-gray-400">{v.nombre_tutor}</div>
                        {/* Móvil: la info de las columnas ocultas, plegada acá. */}
                        <div className="md:hidden mt-1 flex flex-wrap items-center gap-2">
                          <span className="text-xs text-gray-500">{v.fecha ? fmtFecha(v.fecha) : '—'}</span>
                          <BadgePago estado={v.estado_pago} />
                          <DocBoleta boleta={v.boleta} />
                          <BoletasCobro boletas={v.boletas_cobro} />
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-gray-700 hidden md:table-cell">{v.fecha ? fmtFecha(v.fecha) : '—'}</td>
                      <td className="px-2 md:px-4 py-2.5 text-right font-semibold text-gray-900 whitespace-nowrap">{fmtPrecio(v.monto)}</td>
                      <td className="px-4 py-2.5 hidden md:table-cell"><BadgePago estado={v.estado_pago} /></td>
                      <td className="px-4 py-2.5 hidden md:table-cell">
                        <div className="flex flex-col gap-1 items-start">
                          <DocBoleta boleta={v.boleta} />
                          <BoletasCobro boletas={v.boletas_cobro} />
                        </div>
                      </td>
                      <td className="px-2 md:px-4 py-2.5">
                        <div className="flex flex-col items-end gap-1">
                          <div className="flex items-center justify-end gap-2">
                            {v.boleta && <LinkDoc doc={v.boleta} />}
                            {v.boleta && v.boleta.estado !== 'anulado' && (
                              <button onClick={() => setAnular(docParaAnular(
                                { ...v.boleta!, monto_total: v.boleta!.monto_total || v.monto }, v.nombre_tutor,
                              ))} className="text-xs font-semibold text-red-600 border border-red-200 rounded-lg px-2 py-1 hover:bg-red-50">Nota de crédito</button>
                            )}
                            {!v.boleta && v.estado_pago === 'pagado' && (
                              <button onClick={() => emitir(v)} disabled={emitiendo === v.id}
                                className="text-xs font-semibold text-white bg-brand rounded-lg px-3 py-1.5 hover:bg-brand-dark disabled:opacity-50">
                                {emitiendo === v.id ? 'Emitiendo…' : 'Emitir boleta'}
                              </button>
                            )}
                            {!v.boleta && v.estado_pago !== 'pagado' && (
                              <span className="text-xs text-gray-400">Pendiente de pago</span>
                            )}
                          </div>
                          {/* Boletas de cobros posteriores: link al PDF + su propia NC. */}
                          {v.boletas_cobro.filter(b => b.estado !== 'anulado').map(b => (
                            <div key={b.id} className="flex items-center justify-end gap-2">
                              <span className="text-[10px] uppercase tracking-wide text-gray-400">Cobro {b.folio}</span>
                              <LinkDoc doc={b} />
                              <button onClick={() => setAnular(docParaAnular(b, v.nombre_tutor))}
                                className="text-xs font-semibold text-red-600 border border-red-200 rounded-lg px-2 py-1 hover:bg-red-50">Nota de crédito</button>
                            </div>
                          ))}
                          {errFila[v.id] && <span className="text-xs text-red-600 max-w-[220px] text-right">{errFila[v.id]}</span>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {totalPaginas > 1 && (
              <div className="flex items-center justify-between gap-3 flex-wrap border-t border-gray-200 px-4 py-3">
                <p className="text-xs text-gray-600">
                  Mostrando {(paginaActual - 1) * POR_PAGINA + 1}–{Math.min(paginaActual * POR_PAGINA, ventas.length)} de {ventas.length}
                </p>
                <div className="flex items-center gap-2">
                  <button onClick={() => setPagina(p => Math.max(1, p - 1))} disabled={paginaActual <= 1}
                    className="border border-gray-300 text-gray-700 bg-white hover:bg-gray-50 px-3 py-1.5 min-h-9 rounded-xl text-xs font-medium disabled:opacity-40 disabled:cursor-not-allowed">
                    Anterior
                  </button>
                  <span className="text-xs text-gray-600 tabular-nums">{paginaActual} / {totalPaginas}</span>
                  <button onClick={() => setPagina(p => Math.min(totalPaginas, p + 1))} disabled={paginaActual >= totalPaginas}
                    className="border border-gray-300 text-gray-700 bg-white hover:bg-gray-50 px-3 py-1.5 min-h-9 rounded-xl text-xs font-medium disabled:opacity-40 disabled:cursor-not-allowed">
                    Siguiente
                  </button>
                </div>
              </div>
            )}
            <div className="px-4 py-3 border-t border-gray-200 bg-gray-50 text-sm text-gray-600 flex flex-wrap justify-between gap-2">
              <span>
                {ventas.length} venta{ventas.length === 1 ? '' : 's'} · {tot.emitidas} con boleta · {tot.pagadasSinBoleta} pagada{tot.pagadasSinBoleta === 1 ? '' : 's'} sin boleta
                {tot.cobros > 0 && ` · ${tot.cobros} boleta${tot.cobros === 1 ? '' : 's'} de cobros posteriores`}
              </span>
              <span className="font-semibold text-gray-900">Total: {fmtPrecio(tot.total)}</span>
            </div>
          </>
        )}
      </Card>
      {anular && <AnularModal documento={anular} onClose={() => setAnular(null)} onAnulado={() => { setAnular(null); cargar() }} />}
    </div>
  )
}

// ─── Facturas: ventas B2B (veterinarias) ──────────────────────────────────────
function FacturasTab({ onAbrirLote }: { onAbrirLote: () => void }) {
  const [ventas, setVentas] = useState<VentaFactura[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [mes, setMes] = useState('')
  const [q, setQ] = useState('')
  const [soloPendientes, setSoloPendientes] = useState(false)
  const [emitiendo, setEmitiendo] = useState<string | null>(null)
  const [errFila, setErrFila] = useState<Record<string, string>>({})
  const [anular, setAnular] = useState<Documento | null>(null)

  const cargar = useCallback(async () => {
    setLoading(true); setErr('')
    try {
      const params = new URLSearchParams()
      if (mes) params.set('mes', mes)
      if (q.trim()) params.set('q', q.trim())
      const r = await fetch(`/api/facturacion/ventas-factura?${params}`, { cache: 'no-store' })
      const d = await r.json()
      if (!r.ok) { setErr(d.error || 'Error'); setVentas([]) } else setVentas(d.ventas || [])
    } catch { setErr('Error de red'); setVentas([]) }
    setLoading(false)
  }, [mes, q])

  useEffect(() => { cargar() }, [cargar])

  // "Documentada" = tiene factura al vet O boleta al tutor (vets con comisión).
  const visibles = useMemo(
    () => soloPendientes ? ventas.filter(v => !v.factura && !v.boleta) : ventas,
    [ventas, soloPendientes],
  )
  const tot = useMemo(() => {
    const total = visibles.reduce((s, v) => s + v.monto, 0)
    const facturadas = visibles.filter(v => v.factura || v.boleta).length
    const sinFacturar = visibles.filter(v => !v.factura && !v.boleta).length
    return { total, facturadas, sinFacturar }
  }, [visibles])

  async function facturar(v: VentaFactura) {
    if (!v.vet_rut) { setErrFila(prev => ({ ...prev, [v.id]: 'La veterinaria no tiene RUT (complétalo en Veterinarios).' })); return }
    if (!confirm(`Se emitirá una FACTURA electrónica real al SII a ${v.vet_nombre} por ${fmtPrecio(v.monto)} (${v.codigo} · ${v.nombre_mascota}). ¿Continuar?`)) return
    setEmitiendo(v.id)
    setErrFila(prev => { const n = { ...prev }; delete n[v.id]; return n })
    try {
      const r = await fetch('/api/facturacion/facturar-ficha', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fichaId: v.id }),
      })
      const d = await r.json()
      if (!r.ok) setErrFila(prev => ({ ...prev, [v.id]: d.error || 'No se pudo facturar.' }))
      else await cargar()
    } catch { setErrFila(prev => ({ ...prev, [v.id]: 'Error de red' })) }
    setEmitiendo(null)
  }

  /**
   * Boleta al TUTOR de una venta de convenio (vets con comisión): en vez de
   * facturarle el servicio al veterinario, se le cobra el precio completo al tutor
   * y la boleta le llega a SU correo. Si el vet tiene regla en Descuentos Convenios,
   * acá mismo se le devenga la comisión.
   */
  async function boletear(v: VentaFactura) {
    if (!confirm(`Se emitirá una BOLETA electrónica real al SII por ${fmtPrecio(v.monto)} a nombre del tutor de ${v.nombre_mascota || 'la mascota'} (${v.codigo}) y se le enviará a su correo.\n\nEsta ficha ya NO se le facturará a ${v.vet_nombre}. ¿Continuar?`)) return
    setEmitiendo(v.id)
    setErrFila(prev => { const n = { ...prev }; delete n[v.id]; return n })
    try {
      const r = await fetch('/api/facturacion/boletear-ficha', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fichaId: v.id }),
      })
      const d = await r.json()
      if (!r.ok) setErrFila(prev => ({ ...prev, [v.id]: d.error || 'No se pudo emitir la boleta.' }))
      else await cargar()
    } catch { setErrFila(prev => ({ ...prev, [v.id]: 'Error de red' })) }
    setEmitiendo(null)
  }

  return (
    <div className="space-y-5">
      <Card className="p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Mes (retiro)</label>
            <input type="month" value={mes} onChange={e => setMes(e.target.value)} className="border-2 border-gray-300 rounded-lg px-2 py-1.5 text-sm" />
          </div>
          <div className="flex-1 min-w-[180px]">
            <label className="block text-xs font-semibold text-gray-600 mb-1">Buscar</label>
            <input type="text" value={q} onChange={e => setQ(e.target.value)} placeholder="Código, mascota, veterinaria, RUT, folio…"
              className="w-full border-2 border-gray-300 rounded-lg px-2 py-1.5 text-sm" />
          </div>
          <label className="flex items-center gap-2 text-xs font-semibold text-gray-600 pb-2 cursor-pointer">
            <input type="checkbox" checked={soloPendientes} onChange={e => setSoloPendientes(e.target.checked)} className="w-4 h-4" />
            Solo sin documento
          </label>
          {(mes || q) && <button onClick={() => { setMes(''); setQ('') }} className="text-xs text-brand-soft hover:underline pb-2">Limpiar</button>}
          <div className="flex-1" />
          <Button variant="secondary" onClick={onAbrirLote}><Hospital className="w-4 h-4" aria-hidden="true" /> Facturar el mes por veterinaria (lote)</Button>
        </div>
      </Card>

      <Card className="p-0 overflow-hidden">
        {loading ? <TableSkeleton rows={8} />
        : err ? <p className="p-4 text-sm text-red-700 bg-red-50">{err}</p>
        : visibles.length === 0 ? <p className="p-8 text-center text-sm text-gray-400">Sin ventas de convenio para este filtro.</p>
        : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full md:min-w-[960px] text-sm">
                <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
                  <tr>
                    <th className="text-left px-2 md:px-4 py-2.5">Código</th>
                    <th className="text-left px-2 md:px-4 py-2.5">Mascota</th>
                    <th className="text-left px-4 py-2.5 hidden md:table-cell">Veterinaria</th>
                    <th className="text-left px-4 py-2.5 hidden md:table-cell">Retiro</th>
                    <th className="text-left px-4 py-2.5 hidden md:table-cell">Serv.</th>
                    <th className="text-right px-2 md:px-4 py-2.5">Monto</th>
                    <th className="text-left px-4 py-2.5 hidden md:table-cell">Documento</th>
                    <th className="text-right px-2 md:px-4 py-2.5">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {visibles.map(v => (
                    <tr key={v.id} className="hover:bg-gray-50">
                      <td className="px-2 md:px-4 py-2.5 font-mono text-xs font-bold text-brand">{v.codigo || `#${v.id}`}</td>
                      <td className="px-2 md:px-4 py-2.5">
                        <div className="text-gray-900 font-medium">{v.nombre_mascota || '—'}</div>
                        <div className="text-xs text-gray-400">{v.especie} · {fmtKg(v.peso)}</div>
                        {/* Móvil: la info de las columnas ocultas, plegada acá. */}
                        <div className="md:hidden mt-1 flex flex-wrap items-center gap-2">
                          <span className="text-xs text-gray-600">{v.vet_nombre}</span>
                          {!v.vet_rut && <span className="text-[10px] font-semibold text-red-700 bg-red-100 px-1.5 py-0.5 rounded">sin RUT</span>}
                          <span className="text-xs text-gray-500">{v.fecha_retiro ? fmtFecha(v.fecha_retiro) : '—'} · {v.codigo_servicio}</span>
                          <DocVenta factura={v.factura} boleta={v.boleta} />
                        </div>
                      </td>
                      <td className="px-4 py-2.5 hidden md:table-cell">
                        <div className="text-gray-800">{v.vet_nombre}</div>
                        {!v.vet_rut && <span className="text-[10px] font-semibold text-red-700 bg-red-100 px-1.5 py-0.5 rounded">sin RUT</span>}
                      </td>
                      <td className="px-4 py-2.5 text-gray-700 hidden md:table-cell">{v.fecha_retiro ? fmtFecha(v.fecha_retiro) : '—'}</td>
                      <td className="px-4 py-2.5 text-gray-600 hidden md:table-cell">{v.codigo_servicio}</td>
                      <td className="px-2 md:px-4 py-2.5 text-right font-semibold text-gray-900 whitespace-nowrap">{fmtPrecio(v.monto)}</td>
                      <td className="px-4 py-2.5 hidden md:table-cell">
                        <DocVenta factura={v.factura} boleta={v.boleta} />
                      </td>
                      <td className="px-2 md:px-4 py-2.5">
                        <div className="flex flex-col items-end gap-1">
                          <div className="flex items-center justify-end gap-2">
                            {(v.factura || v.boleta) && <LinkDoc doc={(v.factura ?? v.boleta)!} />}
                            {(() => {
                              const doc = v.factura ?? v.boleta
                              if (!doc || doc.estado === 'anulado') return null
                              const esFactura = !!v.factura
                              return (
                                <button onClick={() => setAnular({
                                  id: doc.id, tipo_dte: esFactura ? '33' : '39', folio: doc.folio, estado: doc.estado,
                                  ambiente: doc.ambiente, fecha_emision: doc.fecha_emision,
                                  receptor_razon_social: esFactura ? v.vet_nombre : (v.nombre_mascota || v.codigo),
                                  receptor_rut: esFactura ? v.vet_rut : '',
                                  monto_total: String(doc.monto_total || v.monto),
                                  resumen: '', mes_facturado: v.mes, pdf_url: doc.pdf_url, openfactura_url: doc.openfactura_url,
                                  documento_anulado_id: '', nc_id: '', abonado: doc.abonado,
                                })} className="text-xs font-semibold text-red-600 border border-red-200 rounded-lg px-2 py-1 hover:bg-red-50">Nota de crédito</button>
                              )
                            })()}
                            {!v.factura && !v.boleta && (
                              <>
                                {/* Boleta al TUTOR: para los vets con comisión, a los que no se
                                    les factura el servicio (Configuración → Descuentos Convenios). */}
                                <button onClick={() => boletear(v)} disabled={emitiendo === v.id}
                                  className="text-xs font-semibold text-brand border border-brand/40 rounded-lg px-3 py-1.5 hover:bg-brand/5 disabled:opacity-50">
                                  {emitiendo === v.id ? 'Emitiendo…' : 'Boleta al tutor'}
                                </button>
                                <button onClick={() => facturar(v)} disabled={emitiendo === v.id}
                                  className="text-xs font-semibold text-white bg-brand rounded-lg px-3 py-1.5 hover:bg-brand-dark disabled:opacity-50">
                                  {emitiendo === v.id ? 'Facturando…' : 'Facturar'}
                                </button>
                              </>
                            )}
                          </div>
                          {errFila[v.id] && <span className="text-xs text-red-600 max-w-[220px] text-right">{errFila[v.id]}</span>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="px-4 py-3 border-t border-gray-200 bg-gray-50 text-sm text-gray-600 flex flex-wrap justify-between gap-2">
              <span>{visibles.length} venta{visibles.length === 1 ? '' : 's'} · {tot.facturadas} documentada{tot.facturadas === 1 ? '' : 's'} · {tot.sinFacturar} sin documento</span>
              <span className="font-semibold text-gray-900">Total: {fmtPrecio(tot.total)}</span>
            </div>
          </>
        )}
      </Card>
      {anular && <AnularModal documento={anular} onClose={() => setAnular(null)} onAnulado={() => { setAnular(null); cargar() }} />}
    </div>
  )
}

// ─── Notas de crédito: documentos emitidos tipo 61 ────────────────────────────
function NotasCreditoTab() {
  const [docs, setDocs] = useState<Documento[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [desde, setDesde] = useState('')
  const [hasta, setHasta] = useState('')
  const [q, setQ] = useState('')

  const cargar = useCallback(async () => {
    setLoading(true); setErr('')
    try {
      const params = new URLSearchParams({ tipo: '61', orden: 'fecha', dir: 'desc' })
      if (desde) params.set('desde', desde)
      if (hasta) params.set('hasta', hasta)
      if (q.trim()) params.set('q', q.trim())
      const r = await fetch(`/api/facturacion/documentos?${params}`, { cache: 'no-store' })
      const d = await r.json()
      if (!r.ok) { setErr(d.error || 'Error'); setDocs([]) } else setDocs(d.documentos || [])
    } catch { setErr('Error de red'); setDocs([]) }
    setLoading(false)
  }, [desde, hasta, q])

  useEffect(() => { cargar() }, [cargar])

  return (
    <div className="space-y-5">
      <FiltrosFecha desde={desde} hasta={hasta} q={q} setDesde={setDesde} setHasta={setHasta} setQ={setQ} />
      <Card className="p-0 overflow-hidden">
        {loading ? <TableSkeleton rows={8} />
        : err ? <p className="p-4 text-sm text-red-700 bg-red-50">{err}</p>
        : docs.length === 0 ? <p className="p-8 text-center text-sm text-gray-400">Sin notas de crédito.</p>
        : (
          <div className="overflow-x-auto">
            <table className="w-full md:min-w-[760px] text-sm">
              <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
                <tr>
                  <th className="text-left px-2 md:px-4 py-2.5">Folio</th>
                  <th className="text-left px-4 py-2.5 hidden md:table-cell">Fecha</th>
                  <th className="text-left px-2 md:px-4 py-2.5">Receptor</th>
                  <th className="text-left px-4 py-2.5 hidden md:table-cell">Detalle</th>
                  <th className="text-right px-2 md:px-4 py-2.5">Monto</th>
                  <th className="text-right px-2 md:px-4 py-2.5">Doc.</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {docs.map(d => (
                  <tr key={d.id} className="hover:bg-gray-50">
                    <td className="px-2 md:px-4 py-2.5 font-mono text-xs font-bold text-brand">{d.folio || '—'}</td>
                    <td className="px-4 py-2.5 text-gray-700 hidden md:table-cell">{fmtFecha(d.fecha_emision)}</td>
                    <td className="px-2 md:px-4 py-2.5">
                      <div className="text-gray-900 font-medium">{d.receptor_razon_social || '—'}</div>
                      {d.receptor_rut && <div className="text-xs text-gray-400">{d.receptor_rut}</div>}
                      {/* Móvil: fecha y detalle (columnas ocultas) plegados acá. */}
                      <div className="md:hidden mt-1 text-xs text-gray-500">
                        {fmtFecha(d.fecha_emision)}
                        {d.resumen && <span className="text-gray-400"> · {d.resumen}</span>}
                        {d.documento_anulado_id && <span className="text-gray-400"> · anula #{d.documento_anulado_id}</span>}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-gray-600 max-w-[260px] truncate hidden md:table-cell" title={d.resumen}>
                      {d.resumen}{d.documento_anulado_id && <span className="text-gray-400"> · anula #{d.documento_anulado_id}</span>}
                    </td>
                    <td className="px-2 md:px-4 py-2.5 text-right font-semibold text-gray-900 whitespace-nowrap">{fmtPrecio(parseFloat(d.monto_total) || 0)}</td>
                    <td className="px-2 md:px-4 py-2.5 text-right">
                      {(d.pdf_url || d.openfactura_url)
                        ? <a href={d.pdf_url || d.openfactura_url} target="_blank" rel="noopener noreferrer" className="text-xs font-semibold text-brand-soft hover:underline">{d.pdf_url ? 'Descargar' : 'Ver'}</a>
                        : <span className="text-xs text-gray-400">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}

/**
 * Nota de crédito sobre un documento emitido, en dos modos:
 *  - TOTAL: lo anula por completo y libera la ficha (vuelve a quedar sin documento).
 *  - PARCIAL: acredita solo una parte; el documento sigue vigente por el saldo. Sirve
 *    para devoluciones o correcciones de monto sin tirar abajo el documento entero.
 * Aplica igual a boletas (incluidas las de fichas de convenio) y a facturas.
 */
export function AnularModal({ documento, onClose, onAnulado }: { documento: Documento; onClose: () => void; onAnulado: () => void }) {
  const [modo, setModo] = useState<'total' | 'parcial'>((documento.abonado ?? 0) > 0 ? 'parcial' : 'total')
  const [monto, setMonto] = useState('')
  const [motivo, setMotivo] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [err, setErr] = useState('')
  const [ok, setOk] = useState<{ folio?: string; parcial?: boolean } | null>(null)

  const montoDoc = parseFloat(documento.monto_total) || 0
  const abonado = documento.abonado ?? 0
  const saldo = Math.max(0, montoDoc - abonado)

  async function confirmar() {
    setEnviando(true); setErr('')
    try {
      const monto_num = modo === 'parcial' ? parseInt(monto, 10) : undefined
      if (modo === 'parcial' && (!monto_num || monto_num <= 0)) {
        setErr('Ingresá el monto a acreditar.'); setEnviando(false); return
      }
      if (modo === 'parcial' && monto_num! > saldo) {
        setErr(`El monto no puede superar el saldo del documento (${fmtPrecio(saldo)}).`); setEnviando(false); return
      }
      const r = await fetch(`/api/facturacion/${documento.id}/anular`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ motivo, ...(monto_num !== undefined ? { monto: monto_num } : {}) }),
      })
      const d = await r.json()
      if (!r.ok) setErr(d.error || 'No se pudo emitir la nota de crédito.')
      else setOk({ folio: d.notaCredito?.folio, parcial: !!d.parcial })
    } catch { setErr('Error de red') }
    setEnviando(false)
  }

  const tipoLabel = documento.tipo_dte === '39' ? 'boleta' : 'factura'

  return (
    <Modal open onClose={onClose} title={`Nota de crédito — ${tipoLabel} folio ${documento.folio}`}>
      {ok ? (
        <div className="text-center py-2">
          <div className="text-4xl mb-2">✅</div>
          <p className="text-gray-800">
            Se generó la Nota de Crédito {ok.folio ? `folio ${ok.folio}` : ''}
            {ok.parcial ? ` que abona parcialmente esta ${tipoLabel}.` : ' que anula este documento.'}
          </p>
          <Button className="mt-4" onClick={onAnulado}>Listo</Button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm space-y-1">
            <div className="flex justify-between">
              <span className="text-gray-600">Total de la {tipoLabel}</span>
              <span className="font-semibold text-gray-900">{fmtPrecio(montoDoc)}</span>
            </div>
            {abonado > 0 && (
              <>
                <div className="flex justify-between">
                  <span className="text-gray-600">Ya acreditado con NC</span>
                  <span className="font-semibold text-amber-700">− {fmtPrecio(abonado)}</span>
                </div>
                <div className="flex justify-between border-t border-gray-200 pt-1">
                  <span className="text-gray-600">Saldo</span>
                  <span className="font-bold text-gray-900">{fmtPrecio(saldo)}</span>
                </div>
              </>
            )}
            <div className="text-xs text-gray-500 pt-1">A nombre de {documento.receptor_razon_social}</div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {([['total', 'Anulación total', `Anula la ${tipoLabel} completa y la deja sin efecto`],
               ['parcial', 'Abono parcial', 'Acredita solo una parte; el documento sigue vigente']] as const).map(([k, titulo, desc]) => (
              <button key={k} type="button" disabled={k === 'total' && abonado > 0}
                onClick={() => { setModo(k); setErr('') }}
                title={k === 'total' && abonado > 0 ? 'No disponible: el documento ya tiene notas de crédito parciales.' : undefined}
                className={`text-left border-2 rounded-xl px-3 py-2 transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${modo === k ? 'border-brand bg-brand/5' : 'border-gray-200 hover:border-gray-300'}`}>
                <div className="text-sm font-semibold text-gray-900">{titulo}</div>
                <div className="text-xs text-gray-500 mt-0.5">
                  {k === 'total' && abonado > 0 ? 'No disponible: ya tiene NC parciales' : desc}
                </div>
              </button>
            ))}
          </div>

          {modo === 'parcial' ? (
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Monto a acreditar (máx. {fmtPrecio(saldo)})</label>
              <input type="number" min={1} max={saldo} value={monto} onChange={e => setMonto(e.target.value)}
                className="w-full border-2 border-gray-300 rounded-lg px-3 py-2 text-sm" />
              <p className="text-xs text-gray-500 mt-1">
                La {tipoLabel} sigue vigente por el saldo y la ficha queda documentada igual.
                {documento.tipo_dte === '39' && ' La comisión del veterinario, si la hay, no se modifica.'}
              </p>
            </div>
          ) : (
            <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              La {tipoLabel} queda anulada y la ficha vuelve a quedar <strong>sin documento</strong> (se le puede emitir
              otro, y si era de convenio vuelve a la propuesta mensual). Esta acción no se puede deshacer.
            </p>
          )}

          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Motivo (opcional)</label>
            <input value={motivo} onChange={e => setMotivo(e.target.value)} placeholder="Ej: error en el monto"
              className="w-full border-2 border-gray-300 rounded-lg px-3 py-2 text-sm" />
          </div>
          {err && <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{err}</p>}
          <div className="flex gap-2 justify-end pt-2 border-t border-gray-200">
            <Button variant="secondary" onClick={onClose} disabled={enviando}>Cancelar</Button>
            <Button variant="danger" onClick={confirmar} disabled={enviando}>
              {enviando ? 'Emitiendo…' : modo === 'parcial' ? 'Emitir NC parcial' : 'Sí, anular y generar NC'}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  )
}
