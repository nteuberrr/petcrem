'use client'
import { useState, useEffect, useCallback, useMemo } from 'react'
import { PageHeader, Card, Button, Tabs } from '@/components/ui/kit'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { fmtPrecio, fmtFecha } from '@/lib/format'
import ManualModal from '@/components/facturacion/ManualModal'
import FacturarVetsModal from '@/components/facturacion/FacturarVetsModal'

export type TipoTab = '39' | '33' | '61'

export interface Documento {
  id: string
  tipo_dte: string
  folio: string
  estado: string
  ambiente: string
  fecha_emision: string
  receptor_tipo: string
  receptor_razon_social: string
  receptor_rut: string
  monto_neto: string
  monto_iva: string
  monto_total: string
  resumen: string
  mes_facturado: string
  pdf_url: string
  openfactura_url: string
  documento_anulado_id: string
  nc_id: string
  motivo_anulacion: string
}

const TABS: { key: TipoTab; label: string }[] = [
  { key: '39', label: '🧾 Boletas' },
  { key: '33', label: '📄 Facturas' },
  { key: '61', label: '↩️ Notas de Crédito' },
]

const ORDENES = [
  { key: 'fecha', label: 'Fecha' },
  { key: 'monto', label: 'Monto' },
  { key: 'folio', label: 'Folio' },
]

export default function FacturacionPage() {
  const [tab, setTab] = useState<TipoTab>('39')
  const [documentos, setDocumentos] = useState<Documento[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [desde, setDesde] = useState('')
  const [hasta, setHasta] = useState('')
  const [q, setQ] = useState('')
  const [orden, setOrden] = useState<'fecha' | 'monto' | 'folio'>('fecha')
  const [dir, setDir] = useState<'asc' | 'desc'>('desc')

  const [showManual, setShowManual] = useState(false)
  const [showVets, setShowVets] = useState(false)
  const [anularTarget, setAnularTarget] = useState<Documento | null>(null)

  const cargar = useCallback(async () => {
    setLoading(true); setErr('')
    try {
      const params = new URLSearchParams({ tipo: tab, orden, dir })
      if (desde) params.set('desde', desde)
      if (hasta) params.set('hasta', hasta)
      if (q.trim()) params.set('q', q.trim())
      const r = await fetch(`/api/facturacion/documentos?${params}`, { cache: 'no-store' })
      const d = await r.json()
      if (!r.ok) { setErr(d.error || 'Error'); setDocumentos([]) } else setDocumentos(d.documentos || [])
    } catch { setErr('Error de red'); setDocumentos([]) }
    setLoading(false)
  }, [tab, desde, hasta, q, orden, dir])

  useEffect(() => { cargar() }, [cargar])

  const totalPeriodo = useMemo(() => documentos.reduce((s, d) => s + (parseFloat(d.monto_total) || 0), 0), [documentos])

  return (
    <div className="space-y-5">
      <PageHeader
        icon={<span className="text-2xl">🧾</span>}
        title="Facturación"
        subtitle="Boletas, facturas y notas de crédito emitidas vía OpenFactura (Haulmer)"
        actions={
          <>
            <Button variant="secondary" onClick={() => setShowVets(true)}>🏥 Facturar Veterinarios</Button>
            <Button variant="primary" onClick={() => setShowManual(true)}>+ Facturar manualmente</Button>
          </>
        }
      />

      <Tabs tabs={TABS} value={tab} onChange={k => setTab(k as TipoTab)} />

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
            <input type="text" value={q} onChange={e => setQ(e.target.value)} placeholder="Folio, receptor, RUT, mes…"
              className="w-full border-2 border-gray-300 rounded-lg px-2 py-1.5 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Ordenar</label>
            <div className="flex gap-1">
              <select value={orden} onChange={e => setOrden(e.target.value as typeof orden)} className="border-2 border-gray-300 rounded-lg px-2 py-1.5 text-sm">
                {ORDENES.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
              </select>
              <button onClick={() => setDir(d => d === 'asc' ? 'desc' : 'asc')} className="border-2 border-gray-300 rounded-lg px-2.5 py-1.5 text-sm hover:bg-gray-50" title="Cambiar dirección">
                {dir === 'asc' ? '↑' : '↓'}
              </button>
            </div>
          </div>
          {(desde || hasta || q) && (
            <button onClick={() => { setDesde(''); setHasta(''); setQ('') }} className="text-xs text-brand-soft hover:underline pb-2">Limpiar filtros</button>
          )}
        </div>
      </Card>

      <Card className="p-0 overflow-hidden">
        {loading ? (
          <p className="p-8 text-center text-sm text-gray-400">Cargando…</p>
        ) : err ? (
          <p className="p-4 text-sm text-red-700 bg-red-50">{err}</p>
        ) : documentos.length === 0 ? (
          <p className="p-8 text-center text-sm text-gray-400">Sin documentos en este período/filtro.</p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-sm">
                <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
                  <tr>
                    <th className="text-left px-4 py-2.5">Folio</th>
                    <th className="text-left px-4 py-2.5">Fecha</th>
                    <th className="text-left px-4 py-2.5">Receptor</th>
                    <th className="text-left px-4 py-2.5">Detalle</th>
                    <th className="text-right px-4 py-2.5">Monto</th>
                    <th className="text-left px-4 py-2.5">Estado</th>
                    <th className="text-right px-4 py-2.5">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {documentos.map(d => (
                    <tr key={d.id} className="hover:bg-gray-50">
                      <td className="px-4 py-2.5 font-mono text-xs font-bold text-brand">{d.folio || '—'}</td>
                      <td className="px-4 py-2.5 text-gray-700">{fmtFecha(d.fecha_emision)}</td>
                      <td className="px-4 py-2.5">
                        <div className="text-gray-900 font-medium">{d.receptor_razon_social || '—'}</div>
                        {d.receptor_rut && <div className="text-xs text-gray-400">{d.receptor_rut}</div>}
                      </td>
                      <td className="px-4 py-2.5 text-gray-600 max-w-[260px] truncate" title={d.resumen}>
                        {d.resumen}
                        {d.mes_facturado && <span className="text-gray-400"> · {d.mes_facturado}</span>}
                      </td>
                      <td className="px-4 py-2.5 text-right font-semibold text-gray-900">{fmtPrecio(parseFloat(d.monto_total) || 0)}</td>
                      <td className="px-4 py-2.5">
                        {d.estado === 'anulado'
                          ? <Badge variant="red">Anulado</Badge>
                          : d.ambiente === 'pruebas'
                            ? <Badge variant="yellow">Emitido (prueba)</Badge>
                            : <Badge variant="green">Emitido</Badge>}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center justify-end gap-2">
                          {d.pdf_url ? (
                            <a href={d.pdf_url} target="_blank" rel="noopener noreferrer" className="text-xs font-semibold text-brand-soft hover:underline">Descargar</a>
                          ) : d.openfactura_url ? (
                            // Facturas/NC en modo self-service: OpenFactura no siempre
                            // devuelve el PDF de forma sincrónica (queda en validación
                            // SII) — el link al documento hospedado por Haulmer sirve
                            // de respaldo (ahí se ve el folio real y se puede descargar).
                            <a href={d.openfactura_url} target="_blank" rel="noopener noreferrer" className="text-xs font-semibold text-brand-soft hover:underline">Ver documento</a>
                          ) : null}
                          {d.tipo_dte !== '61' && d.estado !== 'anulado' && (
                            <button onClick={() => setAnularTarget(d)} className="text-xs font-semibold text-red-600 border border-red-200 rounded-lg px-2 py-1 hover:bg-red-50">Anular</button>
                          )}
                          {d.tipo_dte !== '61' && d.estado === 'anulado' && d.nc_id && (
                            <span className="text-xs text-gray-400">NC #{d.nc_id}</span>
                          )}
                          {d.tipo_dte === '61' && d.documento_anulado_id && (
                            <span className="text-xs text-gray-400">Anula #{d.documento_anulado_id}</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="px-4 py-3 border-t border-gray-200 bg-gray-50 text-sm text-gray-600 flex justify-between">
              <span>{documentos.length} documento{documentos.length === 1 ? '' : 's'}</span>
              <span className="font-semibold text-gray-900">Total: {fmtPrecio(totalPeriodo)}</span>
            </div>
          </>
        )}
      </Card>

      {showManual && (
        <ManualModal onClose={() => setShowManual(false)} onEmitido={() => { setShowManual(false); cargar() }} />
      )}
      {showVets && (
        <FacturarVetsModal onClose={() => setShowVets(false)} onEmitido={() => { setShowVets(false); cargar() }} />
      )}
      {anularTarget && (
        <AnularModal documento={anularTarget} onClose={() => setAnularTarget(null)} onAnulado={() => { setAnularTarget(null); cargar() }} />
      )}
    </div>
  )
}

function AnularModal({ documento, onClose, onAnulado }: { documento: Documento; onClose: () => void; onAnulado: () => void }) {
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
