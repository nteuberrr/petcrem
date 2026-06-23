'use client'
import { useEffect, useState } from 'react'

interface Prov { id: string; rut: string; razon_social: string; auto_contabiliza: string; auto_tipo: string; auto_partida_id: string }
interface Partida { id: string; tipo: string; nombre: string; activo: string }

const TIPO_LABEL: Record<string, string> = { costo: 'Costo', gasto: 'Gasto', impuesto: 'Impuesto' }

export default function ProveedoresTab() {
  const [provs, setProvs] = useState<Prov[]>([])
  const [partidas, setPartidas] = useState<Partida[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Filtros / orden / selección
  const [buscar, setBuscar] = useState('')
  const [autoFiltro, setAutoFiltro] = useState('')   // '' | 'si' | 'no'
  const [tipoFiltro, setTipoFiltro] = useState('')
  const [partidaFiltro, setPartidaFiltro] = useState('')
  const [sortBy, setSortBy] = useState('')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [bulk, setBulk] = useState(false)
  const [edit, setEdit] = useState<Prov | null>(null)

  async function cargar() {
    try {
      const [rp, rpa] = await Promise.all([fetch('/api/eerr/proveedores'), fetch('/api/eerr/partidas')])
      const dp = await rp.json(); const dpa = await rpa.json()
      if (Array.isArray(dp)) { setProvs(dp); setError('') } else setError(dp?.error || 'No se pudo cargar')
      if (Array.isArray(dpa)) setPartidas(dpa)
    } catch { setError('Error de red') } finally { setLoading(false) }
  }
  useEffect(() => { cargar() }, [])

  // Partidas asignables: costo / gasto / impuesto, activas (las de ingreso se calculan).
  const asignables = partidas.filter(p => p.tipo !== 'ingreso' && p.activo === 'TRUE')
  const partidaNombre = (id: string) => partidas.find(p => p.id === id)?.nombre || ''

  const buscarLc = buscar.trim().toLowerCase()
  const filtrados = provs.filter(p => {
    const auto = p.auto_contabiliza === 'TRUE'
    if (autoFiltro === 'si' && !auto) return false
    if (autoFiltro === 'no' && auto) return false
    if (tipoFiltro && p.auto_tipo !== tipoFiltro) return false
    if (partidaFiltro && p.auto_partida_id !== partidaFiltro) return false
    if (buscarLc && !(p.razon_social || '').toLowerCase().includes(buscarLc) && !(p.rut || '').toLowerCase().includes(buscarLc)) return false
    return true
  })

  function toggleSort(col: string) {
    if (sortBy === col) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortBy(col); setSortDir('asc') }
  }
  const getVal = (p: Prov, key: string): string | number => {
    switch (key) {
      case 'rut': return p.rut
      case 'razon': return (p.razon_social || '').toLowerCase()
      case 'auto': return p.auto_contabiliza === 'TRUE' ? 1 : 0
      case 'tipo': return p.auto_tipo || ''
      case 'partida': return (partidaNombre(p.auto_partida_id) || '').toLowerCase()
      default: return 0
    }
  }
  const sorted = sortBy
    ? [...filtrados].sort((a, b) => {
        const va = getVal(a, sortBy), vb = getVal(b, sortBy)
        const cmp = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb))
        return sortDir === 'asc' ? cmp : -cmp
      })
    : filtrados

  const todasSel = sorted.length > 0 && sorted.every(p => sel.has(p.id))
  function toggleUno(id: string) { setSel(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n }) }
  function toggleTodas() { setSel(() => (todasSel ? new Set() : new Set(sorted.map(p => p.id)))) }

  const th = (col: string, label: string) => (
    <th key={col} onClick={() => toggleSort(col)} className="text-left px-4 py-2.5 font-medium cursor-pointer select-none hover:text-gray-700 whitespace-nowrap">
      {label}{sortBy === col ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}
    </th>
  )

  if (loading) return <div className="text-gray-500 text-sm">Cargando…</div>
  if (error) return <div className="text-red-700 text-sm bg-red-50 border border-red-200 rounded-lg p-3">{error}</div>

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500">
        Proveedores vistos en las facturas. Si activás la contabilización automática, sus compras <strong>pendientes</strong> y las <strong>futuras</strong> se asignan solas a la partida elegida. Las que ya tienen partida no se tocan.
      </p>

      {/* Filtros + buscar */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Buscar</label>
            <input value={buscar} onChange={e => setBuscar(e.target.value)} placeholder="Razón social o RUT" className="border border-gray-300 rounded px-2 py-1.5 text-sm w-52" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Auto</label>
            <select value={autoFiltro} onChange={e => setAutoFiltro(e.target.value)} className="border border-gray-300 rounded px-2 py-1.5 text-sm">
              <option value="">Todos</option>
              <option value="si">Con auto</option>
              <option value="no">Sin auto</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Tipo</label>
            <select value={tipoFiltro} onChange={e => { setTipoFiltro(e.target.value); setPartidaFiltro('') }} className="border border-gray-300 rounded px-2 py-1.5 text-sm">
              <option value="">Todos</option>
              <option value="costo">Costo</option>
              <option value="gasto">Gasto</option>
              <option value="impuesto">Impuesto</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Partida</label>
            <select value={partidaFiltro} onChange={e => setPartidaFiltro(e.target.value)} className="border border-gray-300 rounded px-2 py-1.5 text-sm max-w-[200px]">
              <option value="">Todas</option>
              {asignables.filter(p => !tipoFiltro || p.tipo === tipoFiltro).map(p => (
                <option key={p.id} value={p.id}>{tipoFiltro ? p.nombre : `${TIPO_LABEL[p.tipo] || ''} · ${p.nombre}`}</option>
              ))}
            </select>
          </div>
          {(buscar || autoFiltro || tipoFiltro || partidaFiltro) && (
            <button onClick={() => { setBuscar(''); setAutoFiltro(''); setTipoFiltro(''); setPartidaFiltro('') }} className="text-xs text-gray-400 hover:text-gray-700 mb-1.5">Limpiar</button>
          )}
        </div>
      </div>

      {sel.size > 0 && (
        <div className="flex flex-wrap items-center gap-3 bg-indigo-50 border border-indigo-200 rounded-lg px-4 py-2.5">
          <span className="text-sm text-indigo-800 font-medium">{sel.size} proveedor(es)</span>
          <button onClick={() => setBulk(true)} className="bg-indigo-600 text-white px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-indigo-700">Contabilizar a una partida</button>
          <button onClick={() => setSel(new Set())} className="text-sm text-gray-500 hover:text-gray-700">Limpiar selección</button>
        </div>
      )}

      {provs.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-400 text-sm">
          Aún no hay proveedores. Aparecerán cuando cargues facturas del SII.
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
          <table className="min-w-[760px] w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
              <tr>
                <th className="px-4 py-2.5 w-8 text-center"><input type="checkbox" checked={todasSel} onChange={toggleTodas} title="Seleccionar todos" /></th>
                {th('rut', 'RUT')}
                {th('razon', 'Razón social')}
                {th('auto', 'Auto')}
                {th('tipo', 'Tipo')}
                {th('partida', 'Partida')}
                <th className="px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {sorted.map(p => {
                const auto = p.auto_contabiliza === 'TRUE'
                return (
                  <tr key={p.id} className={sel.has(p.id) ? 'bg-indigo-50/40' : ''}>
                    <td className="px-4 py-2.5 text-center"><input type="checkbox" checked={sel.has(p.id)} onChange={() => toggleUno(p.id)} /></td>
                    <td className="px-4 py-2.5 text-gray-600 whitespace-nowrap">{p.rut}</td>
                    <td className="px-4 py-2.5 text-gray-800">{p.razon_social}</td>
                    <td className="px-4 py-2.5">
                      <span className={`text-xs px-2.5 py-0.5 rounded-full ${auto ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>{auto ? 'Sí' : 'No'}</span>
                    </td>
                    <td className="px-4 py-2.5 text-gray-600">{p.auto_tipo ? (TIPO_LABEL[p.auto_tipo] || p.auto_tipo) : <span className="text-gray-300">—</span>}</td>
                    <td className="px-4 py-2.5 text-gray-600">{p.auto_partida_id ? partidaNombre(p.auto_partida_id) : <span className="text-gray-300">—</span>}</td>
                    <td className="px-4 py-2.5 text-right">
                      <button onClick={() => setEdit(p)} className="border border-gray-200 text-gray-600 hover:bg-gray-50 px-2.5 py-1 rounded-lg text-xs font-medium">Editar</button>
                    </td>
                  </tr>
                )
              })}
              {sorted.length === 0 && <tr><td colSpan={7} className="px-4 py-6 text-sm text-gray-400 text-center">Nada con esos filtros.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {edit && <EditarProvModal prov={edit} asignables={asignables} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); cargar() }} />}
      {bulk && <BulkAutoModal ids={Array.from(sel)} asignables={asignables} onClose={() => setBulk(false)} onSaved={() => { setBulk(false); setSel(new Set()); cargar() }} />}
    </div>
  )
}

function EditarProvModal({ prov, asignables, onClose, onSaved }: { prov: Prov; asignables: Partida[]; onClose: () => void; onSaved: () => void }) {
  const [auto, setAuto] = useState(prov.auto_contabiliza === 'TRUE')
  const [tipo, setTipo] = useState(prov.auto_tipo || '')
  const [partida, setPartida] = useState(prov.auto_partida_id || '')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const opciones = asignables.filter(p => p.tipo === tipo)

  async function guardar() {
    if (auto && (!tipo || !partida)) { setErr('Elegí tipo y partida, o desactivá el automático.'); return }
    setSaving(true); setErr('')
    const body = auto
      ? { id: prov.id, auto_contabiliza: true, auto_tipo: tipo, auto_partida_id: partida }
      : { id: prov.id, auto_contabiliza: false }
    const r = await fetch('/api/eerr/proveedores', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    setSaving(false)
    if (r.ok) onSaved()
    else { const d = await r.json().catch(() => ({})); setErr(d?.error || 'No se pudo guardar') }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-5" onClick={e => e.stopPropagation()}>
        <h3 className="font-semibold text-gray-900 mb-1">Editar proveedor</h3>
        <p className="text-xs text-gray-500 mb-4">{prov.razon_social} · {prov.rut}</p>

        <label className="flex items-center gap-2 mb-4 cursor-pointer">
          <input type="checkbox" checked={auto} onChange={e => { setAuto(e.target.checked); if (!e.target.checked) { setTipo(''); setPartida('') } }} />
          <span className="text-sm text-gray-700">Contabilizar automáticamente sus compras</span>
        </label>

        <label className="block text-xs text-gray-500 mb-1">¿Costo, gasto o impuesto?</label>
        <div className="flex gap-2 mb-4">
          {(['costo', 'gasto', 'impuesto'] as const).map(t => (
            <button key={t} disabled={!auto} onClick={() => { setTipo(t); setPartida('') }}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium disabled:opacity-40 ${tipo === t ? 'bg-indigo-600 text-white' : 'bg-white border border-gray-200 text-gray-600'}`}>{TIPO_LABEL[t]}</button>
          ))}
        </div>

        <label className="block text-xs text-gray-500 mb-1">Partida</label>
        <select value={partida} onChange={e => setPartida(e.target.value)} disabled={!auto || !tipo}
          className="w-full border border-gray-300 rounded px-2 py-2 text-sm mb-2 disabled:opacity-40">
          <option value="">— Elegí una partida —</option>
          {opciones.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
        </select>
        <p className="text-xs text-gray-400 mb-5">Al guardar, se asigna esta partida a sus compras <strong>pendientes</strong> (las ya asignadas no se tocan) y a las futuras.</p>

        {err && <p className="text-sm text-red-700 mb-3">{err}</p>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="text-sm text-gray-500 px-3 py-2">Cancelar</button>
          <button onClick={guardar} disabled={saving} className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50">{saving ? 'Guardando…' : 'Guardar'}</button>
        </div>
      </div>
    </div>
  )
}

function BulkAutoModal({ ids, asignables, onClose, onSaved }: { ids: string[]; asignables: Partida[]; onClose: () => void; onSaved: () => void }) {
  const [tipo, setTipo] = useState('')
  const [partida, setPartida] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const opciones = asignables.filter(p => p.tipo === tipo)

  async function guardar() {
    if (!tipo || !partida) { setErr('Elegí tipo y partida'); return }
    setSaving(true); setErr('')
    const r = await fetch('/api/eerr/proveedores', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ids, auto_tipo: tipo, auto_partida_id: partida }) })
    setSaving(false)
    if (r.ok) onSaved()
    else { const d = await r.json().catch(() => ({})); setErr(d?.error || 'No se pudo guardar') }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-5" onClick={e => e.stopPropagation()}>
        <h3 className="font-semibold text-gray-900 mb-1">Contabilizar {ids.length} proveedor(es)</h3>
        <p className="text-xs text-gray-500 mb-4">Se activa la contabilización automática y se asigna esta partida a todos. También se aplica a sus compras pendientes (las ya asignadas no se tocan).</p>

        <label className="block text-xs text-gray-500 mb-1">¿Costo, gasto o impuesto?</label>
        <div className="flex gap-2 mb-4">
          {(['costo', 'gasto', 'impuesto'] as const).map(t => (
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
          <button onClick={guardar} disabled={saving} className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50">{saving ? 'Guardando…' : 'Aplicar'}</button>
        </div>
      </div>
    </div>
  )
}
