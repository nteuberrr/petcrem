'use client'
import { useState, useMemo } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/kit'
import { fmtPrecio, fmtKg, fmtFecha } from '@/lib/format'

interface FichaProp {
  id: string
  codigo: string
  fecha_retiro: string
  nombre_mascota: string
  especie: string
  peso: number
  codigo_servicio: string
  monto: number
}
interface VetProp {
  veterinaria_id: string
  nombre: string
  rut: string
  razon_social: string
  fichas: FichaProp[]
  total: number
}
interface Propuesta { mes: string; vets: VetProp[] }

interface ResultadoVet {
  veterinaria_id: string
  nombre: string
  ok: boolean
  folio?: string
  fichasFacturadas?: number
  monto?: number
  error?: string
}

function mesAnterior(): string {
  const d = new Date()
  d.setMonth(d.getMonth() - 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

interface Props {
  onClose: () => void
  onEmitido: () => void
}

export default function FacturarVetsModal({ onClose, onEmitido }: Props) {
  const [mes, setMes] = useState(mesAnterior())
  const [propuesta, setPropuesta] = useState<Propuesta | null>(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  // veterinaria_id -> Set de ficha ids seleccionadas
  const [seleccion, setSeleccion] = useState<Map<string, Set<string>>>(new Map())
  const [expandido, setExpandido] = useState<Set<string>>(new Set())
  const [enviando, setEnviando] = useState(false)
  const [resultados, setResultados] = useState<ResultadoVet[] | null>(null)

  async function buscar() {
    setLoading(true); setErr(''); setPropuesta(null); setResultados(null)
    try {
      const r = await fetch(`/api/facturacion/propuesta-vets?mes=${mes}`, { cache: 'no-store' })
      const d = await r.json()
      if (!r.ok) { setErr(d.error || 'Error'); setLoading(false); return }
      setPropuesta(d)
      // Por defecto: todo seleccionado (todas las vets, todas las fichas).
      const sel = new Map<string, Set<string>>()
      for (const v of (d.vets as VetProp[])) sel.set(v.veterinaria_id, new Set(v.fichas.map(f => f.id)))
      setSeleccion(sel)
      setExpandido(new Set())
    } catch { setErr('Error de red') }
    setLoading(false)
  }

  function toggleVet(v: VetProp) {
    setSeleccion(prev => {
      const next = new Map(prev)
      const actual = next.get(v.veterinaria_id)
      const todasSeleccionadas = actual && actual.size === v.fichas.length
      next.set(v.veterinaria_id, todasSeleccionadas ? new Set() : new Set(v.fichas.map(f => f.id)))
      return next
    })
  }
  function toggleFicha(vetId: string, fichaId: string) {
    setSeleccion(prev => {
      const next = new Map(prev)
      const actual = new Set(next.get(vetId) ?? [])
      if (actual.has(fichaId)) actual.delete(fichaId); else actual.add(fichaId)
      next.set(vetId, actual)
      return next
    })
  }
  function toggleExpandido(vetId: string) {
    setExpandido(prev => {
      const next = new Set(prev)
      if (next.has(vetId)) next.delete(vetId); else next.add(vetId)
      return next
    })
  }

  const resumen = useMemo(() => {
    if (!propuesta) return { vets: 0, fichas: 0, total: 0 }
    let vets = 0, fichas = 0, total = 0
    for (const v of propuesta.vets) {
      const sel = seleccion.get(v.veterinaria_id)
      if (!sel || sel.size === 0) continue
      vets++
      for (const f of v.fichas) if (sel.has(f.id)) { fichas++; total += f.monto }
    }
    return { vets, fichas, total }
  }, [propuesta, seleccion])

  async function emitir() {
    if (!propuesta) return
    const vetsPayload = propuesta.vets
      .map(v => ({ veterinaria_id: v.veterinaria_id, fichaIds: Array.from(seleccion.get(v.veterinaria_id) ?? []) }))
      .filter(v => v.fichaIds.length > 0)
    if (vetsPayload.length === 0) { setErr('Selecciona al menos una ficha.'); return }

    setEnviando(true); setErr('')
    try {
      const r = await fetch('/api/facturacion/facturar-vets', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mes: propuesta.mes, vets: vetsPayload }),
      })
      const d = await r.json()
      if (!r.ok) setErr(d.error || 'No se pudo facturar.')
      else setResultados(d.resultados || [])
    } catch { setErr('Error de red') }
    setEnviando(false)
  }

  return (
    <Modal open onClose={onClose} title="Facturar Veterinarios" size="3xl">
      {resultados ? (
        <div className="space-y-3">
          <p className="text-sm text-gray-600">Resultado de la facturación:</p>
          <div className="space-y-2">
            {resultados.map(r => (
              <div key={r.veterinaria_id} className={`rounded-lg border px-3 py-2 text-sm flex items-center justify-between ${r.ok ? 'border-emerald-200 bg-emerald-50' : 'border-red-200 bg-red-50'}`}>
                <div>
                  <span className="font-semibold text-gray-900">{r.nombre}</span>
                  {r.ok
                    ? <span className="text-gray-600"> — folio {r.folio} · {r.fichasFacturadas} ficha{r.fichasFacturadas === 1 ? '' : 's'} · {fmtPrecio(r.monto || 0)}</span>
                    : <span className="text-red-700"> — {r.error}</span>}
                </div>
                <span>{r.ok ? '✅' : '❌'}</span>
              </div>
            ))}
          </div>
          <div className="flex justify-end pt-2 border-t border-gray-200">
            <Button onClick={onEmitido}>Listo</Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-end gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Mes a facturar</label>
              <input type="month" value={mes} onChange={e => setMes(e.target.value)} className="border-2 border-gray-300 rounded-lg px-3 py-2 text-sm" />
            </div>
            <Button variant="secondary" onClick={buscar} disabled={loading}>{loading ? 'Buscando…' : 'Ver propuesta'}</Button>
          </div>

          {err && <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{err}</p>}

          {propuesta && propuesta.vets.length === 0 && (
            <p className="text-sm text-gray-400 py-4 text-center">No hay fichas de convenio pendientes de facturar en este mes.</p>
          )}

          {propuesta && propuesta.vets.length > 0 && (
            <div className="space-y-2 max-h-[50vh] overflow-y-auto pr-1">
              {propuesta.vets.map(v => {
                const sel = seleccion.get(v.veterinaria_id) ?? new Set<string>()
                const todasSel = sel.size === v.fichas.length && v.fichas.length > 0
                const abierto = expandido.has(v.veterinaria_id)
                return (
                  <div key={v.veterinaria_id} className="border border-gray-200 rounded-xl overflow-hidden">
                    <div className="flex items-center gap-3 px-3 py-2.5 bg-gray-50">
                      <input type="checkbox" checked={todasSel} onChange={() => toggleVet(v)} className="w-4 h-4" />
                      <button onClick={() => toggleExpandido(v.veterinaria_id)} className="flex-1 text-left flex items-center gap-2">
                        <span className="font-semibold text-gray-900 text-sm">{v.nombre}</span>
                        {!v.rut && <span className="text-[10px] font-semibold text-red-700 bg-red-100 px-1.5 py-0.5 rounded">sin RUT</span>}
                        <span className="text-xs text-gray-500">{sel.size}/{v.fichas.length} ficha{v.fichas.length === 1 ? '' : 's'}</span>
                      </button>
                      <span className="text-sm font-semibold text-gray-900">{fmtPrecio(v.fichas.filter(f => sel.has(f.id)).reduce((s, f) => s + f.monto, 0))}</span>
                      <button onClick={() => toggleExpandido(v.veterinaria_id)} className="text-gray-400 text-xs">{abierto ? '▲' : '▼'}</button>
                    </div>
                    {abierto && (
                      <div className="divide-y divide-gray-100">
                        {v.fichas.map(f => (
                          <label key={f.id} className="flex items-center gap-3 px-4 py-2 text-sm hover:bg-gray-50 cursor-pointer">
                            <input type="checkbox" checked={sel.has(f.id)} onChange={() => toggleFicha(v.veterinaria_id, f.id)} className="w-4 h-4" />
                            <span className="font-mono text-xs text-gray-500 w-20">{f.codigo || f.id}</span>
                            <span className="text-gray-500 w-24">{fmtFecha(f.fecha_retiro)}</span>
                            <span className="flex-1 text-gray-800">{f.nombre_mascota} <span className="text-gray-400">· {f.especie} · {fmtKg(f.peso)} · {f.codigo_servicio}</span></span>
                            <span className="font-semibold text-gray-900">{fmtPrecio(f.monto)}</span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {propuesta && propuesta.vets.length > 0 && (
            <>
              <div className="rounded-xl bg-gray-50 border border-gray-200 p-3 flex justify-between items-center text-sm">
                <span className="text-gray-600">{resumen.vets} veterinaria{resumen.vets === 1 ? '' : 's'} · {resumen.fichas} ficha{resumen.fichas === 1 ? '' : 's'} seleccionadas</span>
                <span className="text-lg font-bold text-gray-900">{fmtPrecio(resumen.total)}</span>
              </div>
              <div className="flex gap-2 justify-end pt-2 border-t border-gray-200">
                <Button variant="secondary" onClick={onClose} disabled={enviando}>Cancelar</Button>
                <Button variant="primary" onClick={emitir} disabled={enviando || resumen.vets === 0}>
                  {enviando ? 'Facturando…' : `Emitir ${resumen.vets} factura${resumen.vets === 1 ? '' : 's'}`}
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </Modal>
  )
}
