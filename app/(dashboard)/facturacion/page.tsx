'use client'
import { useState, useEffect, useCallback, useMemo } from 'react'
import { PageHeader, Card, Button, Tabs } from '@/components/ui/kit'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { fmtPrecio, fmtFecha, fmtKg } from '@/lib/format'
import ManualModal from '@/components/facturacion/ManualModal'
import FacturarVetsModal from '@/components/facturacion/FacturarVetsModal'

export type TipoTab = '39' | '33' | '61'

export interface DocResumen {
  id: string
  folio: string
  estado: string
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
  fecha: string
  monto: number
  estado_pago: string
  boleta: DocResumen | null
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
}

const TABS: { key: TipoTab; label: string }[] = [
  { key: '39', label: '🧾 Boletas' },
  { key: '33', label: '📄 Facturas' },
  { key: '61', label: '↩️ Notas de Crédito' },
]

export default function FacturacionPage() {
  const [tab, setTab] = useState<TipoTab>('39')
  const [showManual, setShowManual] = useState(false)
  const [showVets, setShowVets] = useState(false)

  return (
    <div className="space-y-5">
      <PageHeader
        icon={<span className="text-2xl">🧾</span>}
        title="Facturación"
        subtitle="Ventas del negocio y sus documentos tributarios (OpenFactura / SII)"
        actions={
          <>
            <Button variant="secondary" onClick={() => setShowVets(true)}>🏥 Facturar Veterinarios (lote)</Button>
            <Button variant="primary" onClick={() => setShowManual(true)}>+ Documento manual</Button>
          </>
        }
      />

      <Tabs tabs={TABS} value={tab} onChange={k => setTab(k as TipoTab)} />

      {tab === '39' && <BoletasTab />}
      {tab === '33' && <FacturasTab onAbrirLote={() => setShowVets(true)} />}
      {tab === '61' && <NotasCreditoTab />}

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
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1">Desde</label>
          <input type="date" value={desde} onChange={e => setDesde(e.target.value)} className="border-2 border-gray-300 rounded-lg px-2 py-1.5 text-sm" />
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1">Hasta</label>
          <input type="date" value={hasta} onChange={e => setHasta(e.target.value)} className="border-2 border-gray-300 rounded-lg px-2 py-1.5 text-sm" />
        </div>
        <div className="flex-1 min-w-[180px]">
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

  const tot = useMemo(() => {
    const total = ventas.reduce((s, v) => s + v.monto, 0)
    const emitidas = ventas.filter(v => v.boleta).length
    const pagadasSinBoleta = ventas.filter(v => v.estado_pago === 'pagado' && !v.boleta).length
    return { total, emitidas, pagadasSinBoleta }
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
        {loading ? <p className="p-8 text-center text-sm text-gray-400">Cargando…</p>
        : err ? <p className="p-4 text-sm text-red-700 bg-red-50">{err}</p>
        : ventas.length === 0 ? <p className="p-8 text-center text-sm text-gray-400">Sin ventas de tutor en este período.</p>
        : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[880px] text-sm">
                <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
                  <tr>
                    <th className="text-left px-4 py-2.5">Código</th>
                    <th className="text-left px-4 py-2.5">Mascota / Tutor</th>
                    <th className="text-left px-4 py-2.5">Fecha</th>
                    <th className="text-right px-4 py-2.5">Monto</th>
                    <th className="text-left px-4 py-2.5">Pago</th>
                    <th className="text-left px-4 py-2.5">Boleta</th>
                    <th className="text-right px-4 py-2.5">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {ventas.map(v => (
                    <tr key={v.id} className="hover:bg-gray-50">
                      <td className="px-4 py-2.5 font-mono text-xs font-bold text-brand">{v.codigo || `#${v.id}`}</td>
                      <td className="px-4 py-2.5">
                        <div className="text-gray-900 font-medium">{v.nombre_mascota || '—'}</div>
                        <div className="text-xs text-gray-400">{v.nombre_tutor}</div>
                      </td>
                      <td className="px-4 py-2.5 text-gray-700">{v.fecha ? fmtFecha(v.fecha) : '—'}</td>
                      <td className="px-4 py-2.5 text-right font-semibold text-gray-900">{fmtPrecio(v.monto)}</td>
                      <td className="px-4 py-2.5"><BadgePago estado={v.estado_pago} /></td>
                      <td className="px-4 py-2.5">
                        {v.boleta
                          ? (v.boleta.estado === 'anulado'
                              ? <Badge variant="red">Anulada</Badge>
                              : <span className="text-xs"><span className="font-mono font-bold text-brand">{v.boleta.folio || '—'}</span></span>)
                          : <span className="text-xs text-gray-400">Sin emitir</span>}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex flex-col items-end gap-1">
                          <div className="flex items-center justify-end gap-2">
                            {v.boleta && <LinkDoc doc={v.boleta} />}
                            {v.boleta && v.boleta.estado !== 'anulado' && (
                              <button onClick={() => setAnular({
                                id: v.boleta!.id, tipo_dte: '39', folio: v.boleta!.folio, estado: v.boleta!.estado,
                                ambiente: v.boleta!.ambiente, fecha_emision: v.boleta!.fecha_emision,
                                receptor_razon_social: v.nombre_tutor, receptor_rut: '', monto_total: String(v.monto),
                                resumen: '', mes_facturado: '', pdf_url: v.boleta!.pdf_url, openfactura_url: v.boleta!.openfactura_url,
                                documento_anulado_id: '', nc_id: '',
                              })} className="text-xs font-semibold text-red-600 border border-red-200 rounded-lg px-2 py-1 hover:bg-red-50">Anular</button>
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
                          {errFila[v.id] && <span className="text-xs text-red-600 max-w-[220px] text-right">{errFila[v.id]}</span>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="px-4 py-3 border-t border-gray-200 bg-gray-50 text-sm text-gray-600 flex flex-wrap justify-between gap-2">
              <span>{ventas.length} venta{ventas.length === 1 ? '' : 's'} · {tot.emitidas} con boleta · {tot.pagadasSinBoleta} pagada{tot.pagadasSinBoleta === 1 ? '' : 's'} sin boleta</span>
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

  const visibles = useMemo(() => soloPendientes ? ventas.filter(v => !v.factura) : ventas, [ventas, soloPendientes])
  const tot = useMemo(() => {
    const total = visibles.reduce((s, v) => s + v.monto, 0)
    const facturadas = visibles.filter(v => v.factura).length
    const sinFacturar = visibles.filter(v => !v.factura).length
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
            Solo sin facturar
          </label>
          {(mes || q) && <button onClick={() => { setMes(''); setQ('') }} className="text-xs text-brand-soft hover:underline pb-2">Limpiar</button>}
          <div className="flex-1" />
          <Button variant="secondary" onClick={onAbrirLote}>🏥 Facturar el mes por veterinaria (lote)</Button>
        </div>
      </Card>

      <Card className="p-0 overflow-hidden">
        {loading ? <p className="p-8 text-center text-sm text-gray-400">Cargando…</p>
        : err ? <p className="p-4 text-sm text-red-700 bg-red-50">{err}</p>
        : visibles.length === 0 ? <p className="p-8 text-center text-sm text-gray-400">Sin ventas de convenio para este filtro.</p>
        : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[960px] text-sm">
                <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
                  <tr>
                    <th className="text-left px-4 py-2.5">Código</th>
                    <th className="text-left px-4 py-2.5">Mascota</th>
                    <th className="text-left px-4 py-2.5">Veterinaria</th>
                    <th className="text-left px-4 py-2.5">Retiro</th>
                    <th className="text-left px-4 py-2.5">Serv.</th>
                    <th className="text-right px-4 py-2.5">Monto</th>
                    <th className="text-left px-4 py-2.5">Factura</th>
                    <th className="text-right px-4 py-2.5">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {visibles.map(v => (
                    <tr key={v.id} className="hover:bg-gray-50">
                      <td className="px-4 py-2.5 font-mono text-xs font-bold text-brand">{v.codigo || `#${v.id}`}</td>
                      <td className="px-4 py-2.5">
                        <div className="text-gray-900 font-medium">{v.nombre_mascota || '—'}</div>
                        <div className="text-xs text-gray-400">{v.especie} · {fmtKg(v.peso)}</div>
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="text-gray-800">{v.vet_nombre}</div>
                        {!v.vet_rut && <span className="text-[10px] font-semibold text-red-700 bg-red-100 px-1.5 py-0.5 rounded">sin RUT</span>}
                      </td>
                      <td className="px-4 py-2.5 text-gray-700">{v.fecha_retiro ? fmtFecha(v.fecha_retiro) : '—'}</td>
                      <td className="px-4 py-2.5 text-gray-600">{v.codigo_servicio}</td>
                      <td className="px-4 py-2.5 text-right font-semibold text-gray-900">{fmtPrecio(v.monto)}</td>
                      <td className="px-4 py-2.5">
                        {v.factura
                          ? (v.factura.estado === 'anulado'
                              ? <Badge variant="red">Anulada</Badge>
                              : <span className="text-xs"><span className="font-mono font-bold text-brand">{v.factura.folio || 'emitida'}</span></span>)
                          : <span className="text-xs text-gray-400">Sin facturar</span>}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex flex-col items-end gap-1">
                          <div className="flex items-center justify-end gap-2">
                            {v.factura && <LinkDoc doc={v.factura} />}
                            {v.factura && v.factura.estado !== 'anulado' && (
                              <button onClick={() => setAnular({
                                id: v.factura!.id, tipo_dte: '33', folio: v.factura!.folio, estado: v.factura!.estado,
                                ambiente: v.factura!.ambiente, fecha_emision: v.factura!.fecha_emision,
                                receptor_razon_social: v.vet_nombre, receptor_rut: v.vet_rut, monto_total: String(v.monto),
                                resumen: '', mes_facturado: v.mes, pdf_url: v.factura!.pdf_url, openfactura_url: v.factura!.openfactura_url,
                                documento_anulado_id: '', nc_id: '',
                              })} className="text-xs font-semibold text-red-600 border border-red-200 rounded-lg px-2 py-1 hover:bg-red-50">Anular</button>
                            )}
                            {!v.factura && (
                              <button onClick={() => facturar(v)} disabled={emitiendo === v.id}
                                className="text-xs font-semibold text-white bg-brand rounded-lg px-3 py-1.5 hover:bg-brand-dark disabled:opacity-50">
                                {emitiendo === v.id ? 'Facturando…' : 'Facturar'}
                              </button>
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
              <span>{visibles.length} venta{visibles.length === 1 ? '' : 's'} · {tot.facturadas} facturada{tot.facturadas === 1 ? '' : 's'} · {tot.sinFacturar} sin facturar</span>
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
        {loading ? <p className="p-8 text-center text-sm text-gray-400">Cargando…</p>
        : err ? <p className="p-4 text-sm text-red-700 bg-red-50">{err}</p>
        : docs.length === 0 ? <p className="p-8 text-center text-sm text-gray-400">Sin notas de crédito.</p>
        : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
                <tr>
                  <th className="text-left px-4 py-2.5">Folio</th>
                  <th className="text-left px-4 py-2.5">Fecha</th>
                  <th className="text-left px-4 py-2.5">Receptor</th>
                  <th className="text-left px-4 py-2.5">Detalle</th>
                  <th className="text-right px-4 py-2.5">Monto</th>
                  <th className="text-right px-4 py-2.5">Doc.</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {docs.map(d => (
                  <tr key={d.id} className="hover:bg-gray-50">
                    <td className="px-4 py-2.5 font-mono text-xs font-bold text-brand">{d.folio || '—'}</td>
                    <td className="px-4 py-2.5 text-gray-700">{fmtFecha(d.fecha_emision)}</td>
                    <td className="px-4 py-2.5">
                      <div className="text-gray-900 font-medium">{d.receptor_razon_social || '—'}</div>
                      {d.receptor_rut && <div className="text-xs text-gray-400">{d.receptor_rut}</div>}
                    </td>
                    <td className="px-4 py-2.5 text-gray-600 max-w-[260px] truncate" title={d.resumen}>
                      {d.resumen}{d.documento_anulado_id && <span className="text-gray-400"> · anula #{d.documento_anulado_id}</span>}
                    </td>
                    <td className="px-4 py-2.5 text-right font-semibold text-gray-900">{fmtPrecio(parseFloat(d.monto_total) || 0)}</td>
                    <td className="px-4 py-2.5 text-right">
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

// AnularModal se conserva para anular documentos desde donde se necesite (hoy la
// anulación se hace desde la ficha del cliente / el flujo de NC ya existente).
export function AnularModal({ documento, onClose, onAnulado }: { documento: Documento; onClose: () => void; onAnulado: () => void }) {
  const [motivo, setMotivo] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [err, setErr] = useState('')
  const [ok, setOk] = useState<{ folio?: string } | null>(null)

  async function confirmar() {
    setEnviando(true); setErr('')
    try {
      const r = await fetch(`/api/facturacion/${documento.id}/anular`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ motivo }),
      })
      const d = await r.json()
      if (!r.ok) setErr(d.error || 'No se pudo anular.')
      else setOk({ folio: d.notaCredito?.folio })
    } catch { setErr('Error de red') }
    setEnviando(false)
  }

  const tipoLabel = documento.tipo_dte === '39' ? 'boleta' : 'factura'

  return (
    <Modal open onClose={onClose} title={`Anular ${tipoLabel} folio ${documento.folio}`}>
      {ok ? (
        <div className="text-center py-2">
          <div className="text-4xl mb-2">✅</div>
          <p className="text-gray-800">Se generó la Nota de Crédito {ok.folio ? `folio ${ok.folio}` : ''} que anula este documento.</p>
          <Button className="mt-4" onClick={onAnulado}>Listo</Button>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Esto va a emitir una <strong>Nota de Crédito</strong> que anula el {tipoLabel} <strong>#{documento.folio}</strong> por
            {' '}{fmtPrecio(parseFloat(documento.monto_total) || 0)}, a nombre de <strong>{documento.receptor_razon_social}</strong>.
            Esta acción no se puede deshacer.
          </p>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Motivo (opcional)</label>
            <input value={motivo} onChange={e => setMotivo(e.target.value)} placeholder="Ej: error en el monto"
              className="w-full border-2 border-gray-300 rounded-lg px-3 py-2 text-sm" />
          </div>
          {err && <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{err}</p>}
          <div className="flex gap-2 justify-end pt-2 border-t border-gray-200">
            <Button variant="secondary" onClick={onClose} disabled={enviando}>Cancelar</Button>
            <Button variant="danger" onClick={confirmar} disabled={enviando}>{enviando ? 'Anulando…' : 'Sí, anular y generar NC'}</Button>
          </div>
        </div>
      )}
    </Modal>
  )
}
