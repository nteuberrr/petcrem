'use client'
import { useEffect, useState } from 'react'
import { fmtPrecio } from '@/lib/format'
import { formatDate, todayISO } from '@/lib/dates'

interface Manual { id: string; tipo_asignacion: string; partida_id: string; detalle: string; monto: string; fecha: string }
interface Partida { id: string; tipo: string; nombre: string; activo: string }
interface Rend { id: string; usuario: string; descripcion: string; fecha: string; monto: string; tipo_documento: string; partida_id: string }

const TIPO_LABEL: Record<string, string> = { costo: 'Costo', gasto: 'Gasto', impuesto: 'Impuesto' }

export default function GastosManualesTab() {
  const [items, setItems] = useState<Manual[]>([])
  const [partidas, setPartidas] = useState<Partida[]>([])
  const [rends, setRends] = useState<Rend[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [form, setForm] = useState({ tipo_asignacion: 'gasto', partida_id: '', detalle: '', monto: '', fecha: todayISO() })

  async function cargar() {
    try {
      const [rm, rp, rr] = await Promise.all([
        fetch('/api/eerr/gastos-manuales'),
        fetch('/api/eerr/partidas'),
        fetch('/api/rendiciones'),
      ])
      const dm = await rm.json(); const dp = await rp.json(); const dr = await rr.json()
      if (Array.isArray(dm)) { setItems(dm); setError('') } else setError(dm?.error || 'No se pudo cargar')
      if (Array.isArray(dp)) setPartidas(dp)
      if (Array.isArray(dr)) setRends(dr.filter((r: Rend) => r.tipo_documento === 'boleta'))
    } catch { setError('Error de red') } finally { setLoading(false) }
  }
  useEffect(() => { cargar() }, [])

  const nombre = (id: string) => partidas.find(p => p.id === id)?.nombre || ''
  const opciones = partidas.filter(p => p.tipo === form.tipo_asignacion && p.activo === 'TRUE')

  async function agregar() {
    if (!form.partida_id || !form.detalle.trim() || !form.monto) { alert('Completá partida, detalle y monto.'); return }
    const r = await fetch('/api/eerr/gastos-manuales', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(form) })
    const d = await r.json().catch(() => ({}))
    if (r.ok) { setForm({ tipo_asignacion: 'gasto', partida_id: '', detalle: '', monto: '', fecha: todayISO() }); cargar() }
    else alert(d?.error || 'No se pudo agregar')
  }
  async function eliminar(id: string) {
    if (!confirm('¿Eliminar este gasto manual?')) return
    await fetch(`/api/eerr/gastos-manuales?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
    cargar()
  }

  if (loading) return <div className="text-gray-500 text-sm">Cargando…</div>

  return (
    <div className="space-y-6">
      {/* Alta manual */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <h3 className="font-semibold text-gray-800 mb-3 text-sm">Nuevo gasto manual <span className="text-gray-400 font-normal">(monto neto)</span></h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <select value={form.tipo_asignacion} onChange={e => setForm(f => ({ ...f, tipo_asignacion: e.target.value, partida_id: '' }))} className="border border-gray-300 rounded px-2 py-2 text-sm">
            <option value="costo">Costo</option>
            <option value="gasto">Gasto</option>
            <option value="impuesto">Impuesto</option>
          </select>
          <select value={form.partida_id} onChange={e => setForm(f => ({ ...f, partida_id: e.target.value }))} className="border border-gray-300 rounded px-2 py-2 text-sm">
            <option value="">— Partida —</option>
            {opciones.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
          </select>
          <input value={form.detalle} onChange={e => setForm(f => ({ ...f, detalle: e.target.value }))} placeholder="Detalle" className="border border-gray-300 rounded px-2 py-2 text-sm sm:col-span-2 lg:col-span-1" />
          <input value={form.monto} onChange={e => setForm(f => ({ ...f, monto: e.target.value.replace(/[^\d]/g, '') }))} inputMode="numeric" placeholder="Monto neto" className="border border-gray-300 rounded px-2 py-2 text-sm" />
          <div className="flex gap-2">
            <input type="date" value={form.fecha} onChange={e => setForm(f => ({ ...f, fecha: e.target.value }))} className="border border-gray-300 rounded px-2 py-2 text-sm flex-1" />
            <button onClick={agregar} className="bg-indigo-600 text-white px-3 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 shrink-0">Agregar</button>
          </div>
        </div>
      </div>

      {error && <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-2.5">{error}</p>}

      {/* Lista de manuales */}
      <div>
        <h3 className="font-semibold text-gray-800 mb-2 text-sm">Gastos manuales</h3>
        <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
          <table className="min-w-[640px] w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
              <tr>
                <th className="text-left px-4 py-2.5 font-medium">Fecha</th>
                <th className="text-left px-4 py-2.5 font-medium">Detalle</th>
                <th className="text-left px-4 py-2.5 font-medium">Partida</th>
                <th className="text-right px-4 py-2.5 font-medium">Monto</th>
                <th className="px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {items.map(g => (
                <tr key={g.id}>
                  <td className="px-4 py-2 text-gray-600 whitespace-nowrap">{formatDate(g.fecha)}</td>
                  <td className="px-4 py-2 text-gray-800">{g.detalle}</td>
                  <td className="px-4 py-2 text-gray-500 text-xs"><span className="text-gray-400">{TIPO_LABEL[g.tipo_asignacion] || ''}</span> · {nombre(g.partida_id)}</td>
                  <td className="px-4 py-2 text-right text-gray-800 tabular-nums">{fmtPrecio(parseInt(g.monto) || 0)}</td>
                  <td className="px-4 py-2 text-right"><button onClick={() => eliminar(g.id)} className="text-xs text-gray-300 hover:text-red-600">Eliminar</button></td>
                </tr>
              ))}
              {items.length === 0 && <tr><td colSpan={5} className="px-4 py-4 text-sm text-gray-400 text-center">Sin gastos manuales.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {/* Rendiciones con boleta (se gestionan en Rendiciones) */}
      <div>
        <h3 className="font-semibold text-gray-800 mb-2 text-sm">Desde rendiciones (boleta) <span className="text-gray-400 font-normal">· se editan en Rendiciones</span></h3>
        <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
          <table className="min-w-[640px] w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
              <tr>
                <th className="text-left px-4 py-2.5 font-medium">Fecha</th>
                <th className="text-left px-4 py-2.5 font-medium">Detalle</th>
                <th className="text-left px-4 py-2.5 font-medium">Usuario</th>
                <th className="text-left px-4 py-2.5 font-medium">Partida</th>
                <th className="text-right px-4 py-2.5 font-medium">Monto</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {rends.map(r => (
                <tr key={r.id}>
                  <td className="px-4 py-2 text-gray-600 whitespace-nowrap">{formatDate(r.fecha)}</td>
                  <td className="px-4 py-2 text-gray-800">{r.descripcion}</td>
                  <td className="px-4 py-2 text-gray-500">{r.usuario}</td>
                  <td className="px-4 py-2 text-xs">{r.partida_id ? nombre(r.partida_id) : <span className="text-amber-600 font-medium">Sin asignar (!)</span>}</td>
                  <td className="px-4 py-2 text-right text-gray-800 tabular-nums">{fmtPrecio(parseInt(r.monto) || 0)}</td>
                </tr>
              ))}
              {rends.length === 0 && <tr><td colSpan={5} className="px-4 py-4 text-sm text-gray-400 text-center">Sin rendiciones con boleta.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
