'use client'
import { useEffect, useState } from 'react'

interface Prov { id: string; rut: string; razon_social: string; auto_contabiliza: string; auto_tipo: string; auto_partida_id: string }
interface Partida { id: string; tipo: string; nombre: string; activo: string }

export default function ProveedoresTab() {
  const [provs, setProvs] = useState<Prov[]>([])
  const [partidas, setPartidas] = useState<Partida[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  async function cargar() {
    try {
      const [rp, rpa] = await Promise.all([fetch('/api/eerr/proveedores'), fetch('/api/eerr/partidas')])
      const dp = await rp.json(); const dpa = await rpa.json()
      if (Array.isArray(dp)) { setProvs(dp); setError('') } else setError(dp?.error || 'No se pudo cargar')
      if (Array.isArray(dpa)) setPartidas(dpa)
    } catch { setError('Error de red') } finally { setLoading(false) }
  }
  useEffect(() => { cargar() }, [])

  async function patch(id: string, updates: Record<string, unknown>) {
    const r = await fetch('/api/eerr/proveedores', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id, ...updates }) })
    if (!r.ok) { const d = await r.json().catch(() => ({})); alert(d?.error || 'No se pudo guardar'); return }
    cargar()
  }

  // Partidas asignables: costo / gasto / impuesto, activas (las de ingreso se calculan).
  const asignables = partidas.filter(p => p.tipo !== 'ingreso' && p.activo === 'TRUE')

  if (loading) return <div className="text-gray-500 text-sm">Cargando…</div>
  if (error) return <div className="text-red-700 text-sm bg-red-50 border border-red-200 rounded-lg p-3">{error}</div>

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500">
        Proveedores vistos en las facturas. Si activás la contabilización automática, sus compras <strong>pendientes</strong> y las <strong>futuras</strong> se asignan solas a la partida elegida. Las que ya tienen partida no se tocan.
      </p>
      {provs.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-400 text-sm">
          Aún no hay proveedores. Aparecerán cuando cargues facturas del SII.
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
          <table className="min-w-[720px] w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
              <tr>
                <th className="text-left px-4 py-2.5 font-medium">RUT</th>
                <th className="text-left px-4 py-2.5 font-medium">Razón social</th>
                <th className="text-left px-4 py-2.5 font-medium">Auto</th>
                <th className="text-left px-4 py-2.5 font-medium">Tipo</th>
                <th className="text-left px-4 py-2.5 font-medium">Partida</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {provs.map(p => {
                const auto = p.auto_contabiliza === 'TRUE'
                const partidasTipo = asignables.filter(x => x.tipo === p.auto_tipo)
                return (
                  <tr key={p.id}>
                    <td className="px-4 py-2.5 text-gray-600 whitespace-nowrap">{p.rut}</td>
                    <td className="px-4 py-2.5 text-gray-800">{p.razon_social}</td>
                    <td className="px-4 py-2.5">
                      <button
                        onClick={() => patch(p.id, { auto_contabiliza: !auto })}
                        className={`text-xs px-2.5 py-0.5 rounded-full ${auto ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}
                      >
                        {auto ? 'Sí' : 'No'}
                      </button>
                    </td>
                    <td className="px-4 py-2.5">
                      <select
                        disabled={!auto}
                        value={p.auto_tipo || ''}
                        onChange={e => patch(p.id, { auto_tipo: e.target.value, auto_partida_id: '' })}
                        className="border border-gray-300 rounded px-2 py-1 text-sm disabled:opacity-40"
                      >
                        <option value="">—</option>
                        <option value="costo">Costo</option>
                        <option value="gasto">Gasto</option>
                        <option value="impuesto">Impuesto</option>
                      </select>
                    </td>
                    <td className="px-4 py-2.5">
                      <select
                        disabled={!auto || !p.auto_tipo}
                        value={p.auto_partida_id || ''}
                        onChange={e => patch(p.id, { auto_partida_id: e.target.value })}
                        className="border border-gray-300 rounded px-2 py-1 text-sm disabled:opacity-40"
                      >
                        <option value="">—</option>
                        {partidasTipo.map(x => <option key={x.id} value={x.id}>{x.nombre}</option>)}
                      </select>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
