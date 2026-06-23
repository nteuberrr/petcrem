'use client'
import { useEffect, useState } from 'react'
import { fmtPrecio } from '@/lib/format'
import { formatDate, todayISO } from '@/lib/dates'

interface Manual { id: string; tipo_asignacion: string; partida_id: string; detalle: string; monto: string; fecha: string }
interface Rend { id: string; usuario: string; descripcion: string; fecha: string; monto: string; tipo_documento: string; partida_id: string }
interface Partida { id: string; tipo: string; nombre: string; activo: string }

type Origen = 'manual' | 'rendicion'
interface URow {
  key: string; origen: Origen; id: string
  fecha: string; detalle: string; usuario: string
  partida_id: string; tipo: string; monto: number
}

const TIPO_LABEL: Record<string, string> = { costo: 'Costo', gasto: 'Gasto', impuesto: 'Impuesto' }
const ORIGEN_LABEL: Record<Origen, string> = { manual: 'Manual', rendicion: 'Rendición' }

export default function GastosManualesTab() {
  const [manuales, setManuales] = useState<Manual[]>([])
  const [rends, setRends] = useState<Rend[]>([])
  const [partidas, setPartidas] = useState<Partida[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [form, setForm] = useState({ tipo_asignacion: 'gasto', partida_id: '', detalle: '', monto: '', fecha: todayISO() })

  // Filtros / orden / selección
  const [buscar, setBuscar] = useState('')
  const [desde, setDesde] = useState('')
  const [hasta, setHasta] = useState('')
  const [tipoFiltro, setTipoFiltro] = useState('')
  const [partidaFiltro, setPartidaFiltro] = useState('')
  const [origenFiltro, setOrigenFiltro] = useState('')
  const [sortBy, setSortBy] = useState('')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [bulk, setBulk] = useState(false)
  const [edit, setEdit] = useState<URow | null>(null)

  async function cargar() {
    try {
      const [rm, rp, rr] = await Promise.all([
        fetch('/api/eerr/gastos-manuales'),
        fetch('/api/eerr/partidas'),
        fetch('/api/eerr/rendiciones'),
      ])
      const dm = await rm.json(); const dp = await rp.json(); const dr = await rr.json()
      if (Array.isArray(dm)) { setManuales(dm); setError('') } else setError(dm?.error || 'No se pudo cargar')
      if (Array.isArray(dp)) setPartidas(dp)
      if (Array.isArray(dr)) setRends(dr)
    } catch { setError('Error de red') } finally { setLoading(false) }
  }
  useEffect(() => { cargar() }, [])

  const partidaNombre = (id: string) => partidas.find(p => p.id === id)?.nombre || ''
  const partidaTipo = (id: string) => partidas.find(p => p.id === id)?.tipo || ''
  const opcionesForm = partidas.filter(p => p.tipo === form.tipo_asignacion && p.activo === 'TRUE')

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
    setSel(s => { const n = new Set(s); n.delete(`manual:${id}`); return n })
    cargar()
  }

  // Filas unificadas (manuales + rendiciones-boleta). El tipo (costo/gasto) sale de
  // la partida asignada; las rendiciones no guardan tipo propio.
  const rows: URow[] = [
    ...manuales.map<URow>(m => ({
      key: `manual:${m.id}`, origen: 'manual', id: m.id, fecha: m.fecha, detalle: m.detalle, usuario: '',
      partida_id: m.partida_id, tipo: partidaTipo(m.partida_id) || m.tipo_asignacion, monto: parseInt(m.monto) || 0,
    })),
    ...rends.map<URow>(r => ({
      key: `rendicion:${r.id}`, origen: 'rendicion', id: r.id, fecha: r.fecha, detalle: r.descripcion, usuario: r.usuario,
      partida_id: r.partida_id, tipo: partidaTipo(r.partida_id), monto: parseInt(r.monto) || 0,
    })),
  ]

  const buscarLc = buscar.trim().toLowerCase()
  const filtradas = rows.filter(r => {
    if (desde && (r.fecha || '') < desde) return false
    if (hasta && (r.fecha || '') > hasta) return false
    if (tipoFiltro && r.tipo !== tipoFiltro) return false
    if (partidaFiltro && r.partida_id !== partidaFiltro) return false
    if (origenFiltro && r.origen !== origenFiltro) return false
    if (buscarLc && !`${r.detalle} ${r.usuario} ${partidaNombre(r.partida_id)}`.toLowerCase().includes(buscarLc)) return false
    return true
  })

  const DESC_DEFAULT = new Set(['fecha', 'monto'])
  function toggleSort(col: string) {
    if (sortBy === col) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortBy(col); setSortDir(DESC_DEFAULT.has(col) ? 'desc' : 'asc') }
  }
  const getVal = (r: URow, key: string): string | number => {
    switch (key) {
      case 'fecha': return r.fecha || ''
      case 'origen': return ORIGEN_LABEL[r.origen]
      case 'detalle': return (r.detalle || '').toLowerCase()
      case 'usuario': return (r.usuario || '').toLowerCase()
      case 'partida': return (partidaNombre(r.partida_id) || '').toLowerCase()
      case 'monto': return r.monto
      default: return 0
    }
  }
  const sorted = sortBy
    ? [...filtradas].sort((a, b) => {
        const va = getVal(a, sortBy), vb = getVal(b, sortBy)
        const cmp = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb))
        return sortDir === 'asc' ? cmp : -cmp
      })
    : filtradas

  const todasSel = sorted.length > 0 && sorted.every(r => sel.has(r.key))
  function toggleUno(key: string) { setSel(s => { const n = new Set(s); n.has(key) ? n.delete(key) : n.add(key); return n }) }
  function toggleTodas() { setSel(() => (todasSel ? new Set() : new Set(sorted.map(r => r.key)))) }

  const totalFiltrado = sorted.reduce((s, r) => s + r.monto, 0)

  const th = (col: string, label: string, align: 'left' | 'right' = 'left') => (
    <th key={col} onClick={() => toggleSort(col)} className={`px-3 py-2.5 font-medium cursor-pointer select-none hover:text-gray-700 whitespace-nowrap ${align === 'right' ? 'text-right' : 'text-left'}`}>
      {label}{sortBy === col ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}
    </th>
  )

  if (loading) return <div className="text-gray-500 text-sm">Cargando…</div>

  return (
    <div className="space-y-4">
      {/* Alta manual */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <h3 className="font-semibold text-gray-800 mb-3 text-sm">Nuevo gasto manual <span className="text-gray-400 font-normal">(monto neto, sin IVA)</span></h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <select value={form.tipo_asignacion} onChange={e => setForm(f => ({ ...f, tipo_asignacion: e.target.value, partida_id: '' }))} className="border border-gray-300 rounded px-2 py-2 text-sm">
            <option value="costo">Costo</option>
            <option value="gasto">Gasto</option>
          </select>
          <select value={form.partida_id} onChange={e => setForm(f => ({ ...f, partida_id: e.target.value }))} className="border border-gray-300 rounded px-2 py-2 text-sm">
            <option value="">— Partida —</option>
            {opcionesForm.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
          </select>
          <input value={form.detalle} onChange={e => setForm(f => ({ ...f, detalle: e.target.value }))} placeholder="Detalle" className="border border-gray-300 rounded px-2 py-2 text-sm sm:col-span-2 lg:col-span-1" />
          <input value={form.monto} onChange={e => setForm(f => ({ ...f, monto: e.target.value.replace(/[^\d]/g, '') }))} inputMode="numeric" placeholder="Monto neto" className="border border-gray-300 rounded px-2 py-2 text-sm" />
          <div className="flex gap-2">
            <input type="date" value={form.fecha} onChange={e => setForm(f => ({ ...f, fecha: e.target.value }))} className="border border-gray-300 rounded px-2 py-2 text-sm flex-1" />
            <button onClick={agregar} className="bg-indigo-600 text-white px-3 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 shrink-0">Agregar</button>
          </div>
        </div>
      </div>

      {/* Filtros + buscar */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Buscar</label>
            <input value={buscar} onChange={e => setBuscar(e.target.value)} placeholder="Detalle, usuario o partida" className="border border-gray-300 rounded px-2 py-1.5 text-sm w-52" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Desde</label>
            <input type="date" value={desde} onChange={e => setDesde(e.target.value)} className="border border-gray-300 rounded px-2 py-1.5 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Hasta</label>
            <input type="date" value={hasta} onChange={e => setHasta(e.target.value)} className="border border-gray-300 rounded px-2 py-1.5 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Origen</label>
            <select value={origenFiltro} onChange={e => setOrigenFiltro(e.target.value)} className="border border-gray-300 rounded px-2 py-1.5 text-sm">
              <option value="">Todos</option>
              <option value="manual">Manual</option>
              <option value="rendicion">Rendición</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Tipo</label>
            <select value={tipoFiltro} onChange={e => { setTipoFiltro(e.target.value); setPartidaFiltro('') }} className="border border-gray-300 rounded px-2 py-1.5 text-sm">
              <option value="">Todos</option>
              <option value="costo">Costo</option>
              <option value="gasto">Gasto</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Partida</label>
            <select value={partidaFiltro} onChange={e => setPartidaFiltro(e.target.value)} className="border border-gray-300 rounded px-2 py-1.5 text-sm max-w-[200px]">
              <option value="">Todas</option>
              {partidas.filter(p => (p.tipo === 'costo' || p.tipo === 'gasto') && p.activo === 'TRUE' && (!tipoFiltro || p.tipo === tipoFiltro)).map(p => (
                <option key={p.id} value={p.id}>{tipoFiltro ? p.nombre : `${TIPO_LABEL[p.tipo] || ''} · ${p.nombre}`}</option>
              ))}
            </select>
          </div>
          {(buscar || desde || hasta || tipoFiltro || partidaFiltro || origenFiltro) && (
            <button onClick={() => { setBuscar(''); setDesde(''); setHasta(''); setTipoFiltro(''); setPartidaFiltro(''); setOrigenFiltro('') }} className="text-xs text-gray-400 hover:text-gray-700 mb-1.5">Limpiar</button>
          )}
        </div>
      </div>

      {error && <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-2.5">{error}</p>}

      {sel.size > 0 && (
        <div className="flex flex-wrap items-center gap-3 bg-indigo-50 border border-indigo-200 rounded-lg px-4 py-2.5">
          <span className="text-sm text-indigo-800 font-medium">{sel.size} seleccionado(s)</span>
          <button onClick={() => setBulk(true)} className="bg-indigo-600 text-white px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-indigo-700">Asignar a una partida</button>
          <button onClick={() => setSel(new Set())} className="text-sm text-gray-500 hover:text-gray-700">Limpiar selección</button>
        </div>
      )}

      {/* Tabla unificada */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        <table className="w-full text-sm min-w-[760px]">
          <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
            <tr>
              <th className="px-3 py-2.5 w-8 text-center"><input type="checkbox" checked={todasSel} onChange={toggleTodas} title="Seleccionar todos" /></th>
              {th('fecha', 'Fecha')}
              {th('origen', 'Origen')}
              {th('detalle', 'Detalle')}
              {th('usuario', 'Usuario')}
              {th('partida', 'Partida')}
              {th('monto', 'Monto', 'right')}
              <th className="px-3 py-2.5"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {sorted.map(r => (
              <tr key={r.key} className={!r.partida_id ? 'bg-amber-50' : ''}>
                <td className="px-3 py-2 text-center"><input type="checkbox" checked={sel.has(r.key)} onChange={() => toggleUno(r.key)} /></td>
                <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{formatDate(r.fecha)}</td>
                <td className="px-3 py-2">
                  <span className={`text-xs px-1.5 py-0.5 rounded ${r.origen === 'manual' ? 'bg-gray-100 text-gray-600' : 'bg-sky-100 text-sky-700'}`}>{ORIGEN_LABEL[r.origen]}</span>
                </td>
                <td className="px-3 py-2 text-gray-800 max-w-[220px] truncate" title={r.detalle}>{r.detalle}</td>
                <td className="px-3 py-2 text-gray-500 whitespace-nowrap">{r.usuario || '—'}</td>
                <td className="px-3 py-2 max-w-[180px] truncate" title={r.partida_id ? `${TIPO_LABEL[r.tipo] || ''} · ${partidaNombre(r.partida_id)}` : 'Sin asignar'}>
                  {r.partida_id
                    ? <span><span className="text-gray-400">{TIPO_LABEL[r.tipo] || ''}</span> · {partidaNombre(r.partida_id)}</span>
                    : <span className="text-amber-600 font-medium">Sin asignar</span>}
                </td>
                <td className="px-3 py-2 text-right text-gray-800 tabular-nums whitespace-nowrap">{fmtPrecio(r.monto)}</td>
                <td className="px-3 py-2 text-right whitespace-nowrap">
                  <button onClick={() => setEdit(r)} className="border border-gray-200 text-gray-600 hover:bg-gray-50 px-2 py-1 rounded-lg text-xs font-medium">{r.partida_id ? 'Editar' : 'Asignar'}</button>
                  {r.origen === 'manual' && <button onClick={() => eliminar(r.id)} className="ml-1 text-xs text-gray-300 hover:text-red-600 px-1">Eliminar</button>}
                </td>
              </tr>
            ))}
            {sorted.length === 0 && <tr><td colSpan={8} className="px-4 py-6 text-sm text-gray-400 text-center">{rows.length === 0 ? 'Sin gastos manuales ni rendiciones con boleta.' : 'Nada con esos filtros.'}</td></tr>}
          </tbody>
          {sorted.length > 0 && (
            <tfoot>
              <tr className="border-t border-gray-200 bg-gray-50 font-medium text-gray-700">
                <td colSpan={6} className="px-3 py-2 text-right text-xs uppercase text-gray-500">Total ({sorted.length})</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtPrecio(totalFiltrado)}</td>
                <td></td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      <p className="text-xs text-gray-400">Las <strong>rendiciones</strong> vienen del módulo Rendiciones: acá solo se les asigna la partida (no se eliminan). Los <strong>gastos manuales</strong> sí se pueden eliminar.</p>

      {edit && <EditarModal row={edit} partidas={partidas} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); cargar() }} />}
      {bulk && <BulkModal rows={sorted.filter(r => sel.has(r.key))} partidas={partidas} onClose={() => setBulk(false)} onSaved={() => { setBulk(false); setSel(new Set()); cargar() }} />}
    </div>
  )
}

function EditarModal({ row, partidas, onClose, onSaved }: { row: URow; partidas: Partida[]; onClose: () => void; onSaved: () => void }) {
  const [tipo, setTipo] = useState(row.tipo || '')
  const [partida, setPartida] = useState(row.partida_id || '')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const opciones = partidas.filter(p => p.tipo === tipo && p.activo === 'TRUE')

  async function guardar() {
    if (!tipo || !partida) { setErr('Elegí tipo y partida'); return }
    setSaving(true); setErr('')
    const url = row.origen === 'manual' ? '/api/eerr/gastos-manuales' : '/api/eerr/rendiciones'
    const body = row.origen === 'manual'
      ? { id: row.id, tipo_asignacion: tipo, partida_id: partida }
      : { id: row.id, partida_id: partida }
    const r = await fetch(url, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    setSaving(false)
    if (r.ok) onSaved()
    else { const d = await r.json().catch(() => ({})); setErr(d?.error || 'No se pudo guardar') }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-5" onClick={e => e.stopPropagation()}>
        <h3 className="font-semibold text-gray-900 mb-1">Asignar {row.origen === 'manual' ? 'gasto manual' : 'rendición'}</h3>
        <p className="text-xs text-gray-500 mb-4">{row.detalle}{row.usuario ? ` · ${row.usuario}` : ''} · {fmtPrecio(row.monto)}</p>

        <label className="block text-xs text-gray-500 mb-1">¿Costo o gasto?</label>
        <div className="flex gap-2 mb-4">
          {(['costo', 'gasto'] as const).map(t => (
            <button key={t} onClick={() => { setTipo(t); setPartida('') }} className={`px-3 py-1.5 rounded-lg text-sm font-medium ${tipo === t ? 'bg-indigo-600 text-white' : 'bg-white border border-gray-200 text-gray-600'}`}>{TIPO_LABEL[t]}</button>
          ))}
        </div>

        <label className="block text-xs text-gray-500 mb-1">Partida</label>
        <select value={partida} onChange={e => setPartida(e.target.value)} disabled={!tipo} className="w-full border border-gray-300 rounded px-2 py-2 text-sm mb-5 disabled:opacity-40">
          <option value="">— Elegí una partida —</option>
          {opciones.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
        </select>

        {err && <p className="text-sm text-red-700 mb-3">{err}</p>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="text-sm text-gray-500 px-3 py-2">Cancelar</button>
          <button onClick={guardar} disabled={saving} className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50">{saving ? 'Guardando…' : 'Guardar'}</button>
        </div>
      </div>
    </div>
  )
}

function BulkModal({ rows, partidas, onClose, onSaved }: { rows: URow[]; partidas: Partida[]; onClose: () => void; onSaved: () => void }) {
  const [tipo, setTipo] = useState('')
  const [partida, setPartida] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const opciones = partidas.filter(p => p.tipo === tipo && p.activo === 'TRUE')
  const manualIds = rows.filter(r => r.origen === 'manual').map(r => r.id)
  const rendIds = rows.filter(r => r.origen === 'rendicion').map(r => r.id)

  async function guardar() {
    if (!tipo || !partida) { setErr('Elegí tipo y partida'); return }
    setSaving(true); setErr('')
    try {
      if (manualIds.length) {
        const r = await fetch('/api/eerr/gastos-manuales', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ids: manualIds, tipo_asignacion: tipo, partida_id: partida }) })
        if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error || 'No se pudieron asignar los manuales')
      }
      if (rendIds.length) {
        const r = await fetch('/api/eerr/rendiciones', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ids: rendIds, partida_id: partida }) })
        if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error || 'No se pudieron asignar las rendiciones')
      }
      onSaved()
    } catch (e) { setErr(e instanceof Error ? e.message : 'Error'); setSaving(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-5" onClick={e => e.stopPropagation()}>
        <h3 className="font-semibold text-gray-900 mb-1">Asignar {rows.length} movimiento(s)</h3>
        <p className="text-xs text-gray-500 mb-4">{manualIds.length} manual(es) · {rendIds.length} rendición(es). Se asignan todos a la misma partida.</p>

        <label className="block text-xs text-gray-500 mb-1">¿Costo o gasto?</label>
        <div className="flex gap-2 mb-4">
          {(['costo', 'gasto'] as const).map(t => (
            <button key={t} onClick={() => { setTipo(t); setPartida('') }} className={`px-3 py-1.5 rounded-lg text-sm font-medium ${tipo === t ? 'bg-indigo-600 text-white' : 'bg-white border border-gray-200 text-gray-600'}`}>{TIPO_LABEL[t]}</button>
          ))}
        </div>

        <label className="block text-xs text-gray-500 mb-1">Partida</label>
        <select value={partida} onChange={e => setPartida(e.target.value)} disabled={!tipo} className="w-full border border-gray-300 rounded px-2 py-2 text-sm mb-5 disabled:opacity-40">
          <option value="">— Elegí una partida —</option>
          {opciones.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
        </select>

        {err && <p className="text-sm text-red-700 mb-3">{err}</p>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="text-sm text-gray-500 px-3 py-2">Cancelar</button>
          <button onClick={guardar} disabled={saving} className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50">{saving ? 'Guardando…' : 'Asignar'}</button>
        </div>
      </div>
    </div>
  )
}
