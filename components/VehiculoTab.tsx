'use client'
import { useCallback, useEffect, useState } from 'react'
import { fmtLitros, fmtPrecio, fmtNumero } from '@/lib/format'
import { formatDate, todayISO } from '@/lib/dates'
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts'

type Carga = {
  id: string; fecha: string; litros: string; km_odometro: string
  monto: string; comentarios: string; fecha_creacion: string
}

type Resumen = { total_litros: number; total_km: number; total_monto: number; rendimiento_promedio: number }
type Mensual = { mes: string; km: number; litros: number; km_por_litro: number }

export default function VehiculoTab() {
  const [cargas, setCargas] = useState<Carga[]>([])
  const [resumen, setResumen] = useState<Resumen>({ total_litros: 0, total_km: 0, total_monto: 0, rendimiento_promedio: 0 })
  const [mensual, setMensual] = useState<Mensual[]>([])
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    fecha: todayISO(),
    litros: '', km_odometro: '', monto: '', comentarios: '',
  })

  const fetchAll = useCallback(async () => {
    const res = await fetch('/api/vehiculo')
    const data = await res.json()
    setCargas(Array.isArray(data.cargas) ? data.cargas : [])
    setResumen(data.resumen ?? { total_litros: 0, total_km: 0, total_monto: 0, rendimiento_promedio: 0 })
    setMensual(Array.isArray(data.mensual) ? data.mensual : [])
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll])

  async function guardar(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    const res = await fetch('/api/vehiculo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fecha: form.fecha,
        litros: parseFloat(form.litros),
        km_odometro: parseFloat(form.km_odometro),
        monto: parseFloat(form.monto) || 0,
        comentarios: form.comentarios,
      }),
    })
    if (res.ok) {
      setForm({ fecha: todayISO(), litros: '', km_odometro: '', monto: '', comentarios: '' })
      await fetchAll()
    } else {
      const err = await res.json().catch(() => ({}))
      alert(`Error: ${err.error ?? res.status}`)
    }
    setSaving(false)
  }

  async function eliminar(id: string) {
    if (!confirm('¿Eliminar esta carga?')) return
    await fetch(`/api/vehiculo?id=${id}`, { method: 'DELETE' })
    await fetchAll()
  }

  // Cargas en orden cronológico ascendente para calcular km/lt por fila
  const cronologicas = cargas.slice().reverse()

  return (
    <>
      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard label="Total litros" value={fmtLitros(resumen.total_litros)} />
        <KpiCard label="Total km" value={`${fmtNumero(resumen.total_km, 0)} km`} />
        <KpiCard label="Total monto" value={fmtPrecio(resumen.total_monto)} />
        <KpiCard label="Rendimiento promedio" value={`${fmtNumero(resumen.rendimiento_promedio, 2)} km/lt`} />
      </div>

      {/* Form */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        <h2 className="text-base font-semibold text-gray-900 mb-5">Registrar carga de combustible</h2>
        <form onSubmit={guardar} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <label className="text-xs font-medium text-gray-700">Fecha</label>
              <input type="date" required value={form.fecha} onChange={e => setForm(f => ({ ...f, fecha: e.target.value }))}
                className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-700">Litros</label>
              <input type="number" step="0.01" required value={form.litros} onChange={e => setForm(f => ({ ...f, litros: e.target.value }))}
                className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-700">Km odómetro</label>
              <input type="number" step="1" required value={form.km_odometro} onChange={e => setForm(f => ({ ...f, km_odometro: e.target.value }))}
                className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-700">Monto ($)</label>
              <input type="number" min="0" value={form.monto} onChange={e => setForm(f => ({ ...f, monto: e.target.value }))}
                className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-700">Comentarios</label>
            <input value={form.comentarios} onChange={e => setForm(f => ({ ...f, comentarios: e.target.value }))}
              className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
          <button type="submit" disabled={saving}
            className="bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50">
            {saving ? 'Guardando...' : 'Registrar carga'}
          </button>
        </form>
      </div>

      {/* Gráfico mensual */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
        <h3 className="text-sm font-semibold text-gray-700 mb-4">Rendimiento mensual (km/lt)</h3>
        {mensual.length < 1 ? (
          <div className="flex items-center justify-center h-[200px] text-sm text-gray-400">
            Se necesitan al menos 2 registros para calcular rendimiento
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={mensual}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="mes" fontSize={11} tick={{ fill: '#6b7280' }} />
              <YAxis fontSize={11} tick={{ fill: '#6b7280' }} />
              <Tooltip formatter={(v) => `${fmtNumero(v as number, 2)} km/lt`} />
              <Line type="monotone" dataKey="km_por_litro" stroke="#6366f1" strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Historial */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">Historial de cargas</h2>
        </div>
        {cargas.length === 0 ? (
          <div className="p-8 text-center text-gray-400 text-sm">Sin cargas registradas</div>
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[720px]">
            <thead className="bg-gray-50">
              <tr>
                {['Fecha', 'Km odómetro', 'Litros', 'Monto', 'Km/lt anterior', 'Comentarios', ''].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-gray-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {cargas.map(c => {
                // Encontrar carga previa en orden cronológico
                const idxCrono = cronologicas.findIndex(x => x.id === c.id)
                const previa = idxCrono > 0 ? cronologicas[idxCrono - 1] : null
                let kmPorLt: number | null = null
                if (previa) {
                  const deltaKm = (parseFloat(c.km_odometro) || 0) - (parseFloat(previa.km_odometro) || 0)
                  const litros = parseFloat(c.litros) || 0
                  if (litros > 0 && deltaKm > 0) kmPorLt = deltaKm / litros
                }
                return (
                  <tr key={c.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-gray-700">{formatDate(c.fecha)}</td>
                    <td className="px-4 py-3 text-gray-700">{fmtNumero(c.km_odometro, 0)} km</td>
                    <td className="px-4 py-3 text-gray-700">{fmtLitros(c.litros)}</td>
                    <td className="px-4 py-3 text-gray-700">{fmtPrecio(c.monto)}</td>
                    <td className="px-4 py-3 font-medium text-gray-900">
                      {kmPorLt !== null ? `${fmtNumero(kmPorLt, 2)} km/lt` : '—'}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500 max-w-xs truncate">{c.comentarios}</td>
                    <td className="px-4 py-3">
                      <button onClick={() => eliminar(c.id)}
                        className="bg-red-500 hover:bg-red-600 text-white px-3 py-1 rounded-md text-xs font-medium transition-colors">
                        Eliminar
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          </div>
        )}
      </div>
    </>
  )
}

function KpiCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</p>
      <p className="text-2xl font-bold text-gray-900 mt-1">{value}</p>
    </div>
  )
}
