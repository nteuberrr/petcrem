'use client'
import { useEffect, useState } from 'react'

interface Partida { id: string; tipo: string; nombre: string; clave: string; orden: string; subgrupo_id: string; activo: string }
interface Subgrupo { id: string; tipo: string; nombre: string; orden: string }

const TIPOS: { key: string; label: string; nota?: string }[] = [
  { key: 'ingreso', label: 'Ingresos', nota: 'Calculadas desde las ventas. Crear una nueva acá no se llenará sola hasta codificar su fuente de datos.' },
  { key: 'costo', label: 'Costos' },
  { key: 'gasto', label: 'Gastos' },
  { key: 'impuesto', label: 'Impuestos' },
]

const J = { 'content-type': 'application/json' }

export default function ParametrosTab() {
  const [items, setItems] = useState<Partida[]>([])
  const [subgrupos, setSubgrupos] = useState<Subgrupo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editId, setEditId] = useState<string | null>(null)
  const [editNombre, setEditNombre] = useState('')
  const [nuevo, setNuevo] = useState<Record<string, string>>({})
  const [nuevoSg, setNuevoSg] = useState<Record<string, string>>({})

  async function cargar() {
    try {
      const [rp, rs] = await Promise.all([fetch('/api/eerr/partidas'), fetch('/api/eerr/subgrupos')])
      const dp = await rp.json(); const ds = await rs.json()
      if (Array.isArray(dp)) { setItems(dp); setError('') } else setError(dp?.error || 'No se pudo cargar')
      if (Array.isArray(ds)) setSubgrupos(ds)
    } catch { setError('Error de red') } finally { setLoading(false) }
  }
  useEffect(() => { cargar() }, [])

  const sgDe = (tipo: string) => subgrupos.filter(s => s.tipo === tipo).sort((a, b) => (parseInt(a.orden) || 0) - (parseInt(b.orden) || 0))
  const idsSg = new Set(subgrupos.map(s => s.id))
  const partidasDe = (tipo: string, sgId: string) =>
    items.filter(i => i.tipo === tipo && (i.subgrupo_id || '') === sgId).sort((a, b) => (parseInt(a.orden) || 0) - (parseInt(b.orden) || 0))
  const sueltasDe = (tipo: string) =>
    items.filter(i => i.tipo === tipo && !idsSg.has(i.subgrupo_id || '')).sort((a, b) => (parseInt(a.orden) || 0) - (parseInt(b.orden) || 0))

  // ── Partidas ──
  async function agregarPartida(tipo: string) {
    const nombre = (nuevo[tipo] || '').trim()
    if (!nombre) return
    const sgId = nuevoSg[tipo] || ''
    const orden = String(items.filter(i => i.tipo === tipo && (i.subgrupo_id || '') === sgId).length + 1)
    const r = await fetch('/api/eerr/partidas', { method: 'POST', headers: J, body: JSON.stringify({ tipo, nombre, subgrupo_id: sgId, orden }) })
    const d = await r.json().catch(() => ({}))
    if (r.ok) { setNuevo(n => ({ ...n, [tipo]: '' })); cargar() } else alert(d?.error || 'No se pudo agregar')
  }
  async function guardarEdicion(id: string) {
    const r = await fetch('/api/eerr/partidas', { method: 'PATCH', headers: J, body: JSON.stringify({ id, nombre: editNombre }) })
    const d = await r.json().catch(() => ({}))
    if (r.ok) { setEditId(null); cargar() } else alert(d?.error || 'No se pudo guardar')
  }
  async function toggleActivo(p: Partida) {
    await fetch('/api/eerr/partidas', { method: 'PATCH', headers: J, body: JSON.stringify({ id: p.id, activo: p.activo !== 'TRUE' }) })
    cargar()
  }
  async function eliminar(p: Partida) {
    if (!confirm(`¿Eliminar la partida "${p.nombre}"?`)) return
    await fetch(`/api/eerr/partidas?id=${encodeURIComponent(p.id)}`, { method: 'DELETE' })
    cargar()
  }
  async function mover(lista: Partida[], idx: number, dir: -1 | 1) {
    const j = idx + dir
    if (j < 0 || j >= lista.length) return
    const arr = [...lista]
    const tmp = arr[idx]; arr[idx] = arr[j]; arr[j] = tmp
    // Reasignar orden secuencial (1..N) a todo el grupo: robusto aunque el orden
    // estuviera empatado (intercambiar valores iguales no movía nada).
    await Promise.all(arr.map((p, i) =>
      fetch('/api/eerr/partidas', { method: 'PATCH', headers: J, body: JSON.stringify({ id: p.id, orden: String(i + 1) }) })
    ))
    cargar()
  }
  async function reasignar(p: Partida, sgId: string) {
    if ((p.subgrupo_id || '') === sgId) return
    const orden = String(items.filter(i => i.tipo === p.tipo && (i.subgrupo_id || '') === sgId).length + 1)
    await fetch('/api/eerr/partidas', { method: 'PATCH', headers: J, body: JSON.stringify({ id: p.id, subgrupo_id: sgId, orden }) })
    cargar()
  }

  // ── Subgrupos ──
  async function agregarSubgrupo(tipo: string) {
    const nombre = prompt('Nombre del subgrupo:')?.trim()
    if (!nombre) return
    const r = await fetch('/api/eerr/subgrupos', { method: 'POST', headers: J, body: JSON.stringify({ tipo, nombre }) })
    if (r.ok) cargar(); else { const d = await r.json().catch(() => ({})); alert(d?.error || 'No se pudo') }
  }
  async function renombrarSubgrupo(sg: Subgrupo) {
    const nombre = prompt('Nuevo nombre del subgrupo:', sg.nombre)?.trim()
    if (!nombre || nombre === sg.nombre) return
    const r = await fetch('/api/eerr/subgrupos', { method: 'PATCH', headers: J, body: JSON.stringify({ id: sg.id, nombre }) })
    if (r.ok) cargar(); else { const d = await r.json().catch(() => ({})); alert(d?.error || 'No se pudo') }
  }
  async function eliminarSubgrupo(sg: Subgrupo) {
    if (!confirm(`¿Eliminar el subgrupo "${sg.nombre}"? Sus partidas quedan sueltas (no se borran).`)) return
    await fetch(`/api/eerr/subgrupos?id=${encodeURIComponent(sg.id)}`, { method: 'DELETE' })
    cargar()
  }
  async function moverSubgrupo(lista: Subgrupo[], idx: number, dir: -1 | 1) {
    const j = idx + dir
    if (j < 0 || j >= lista.length) return
    const arr = [...lista]
    const tmp = arr[idx]; arr[idx] = arr[j]; arr[j] = tmp
    await Promise.all(arr.map((s, i) =>
      fetch('/api/eerr/subgrupos', { method: 'PATCH', headers: J, body: JSON.stringify({ id: s.id, orden: String(i + 1) }) })
    ))
    cargar()
  }

  const flechas = (canUp: boolean, canDown: boolean, up: () => void, down: () => void) => (
    <div className="flex flex-col leading-none -my-0.5 shrink-0">
      <button onClick={up} disabled={!canUp} title="Subir" className="text-gray-300 hover:text-brand disabled:opacity-20 disabled:hover:text-gray-300 text-[10px] leading-tight">▲</button>
      <button onClick={down} disabled={!canDown} title="Bajar" className="text-gray-300 hover:text-brand disabled:opacity-20 disabled:hover:text-gray-300 text-[10px] leading-tight">▼</button>
    </div>
  )

  const filaPartida = (p: Partida, idx: number, lista: Partida[], tipo: string, sgs: Subgrupo[]) => (
    <div key={p.id} className="px-4 py-2 flex items-center gap-2">
      {editId === p.id ? (
        <>
          <input value={editNombre} onChange={e => setEditNombre(e.target.value)} className="flex-1 border border-gray-300 rounded px-2 py-1 text-sm" />
          <button onClick={() => guardarEdicion(p.id)} className="text-xs text-brand font-medium">Guardar</button>
          <button onClick={() => setEditId(null)} className="text-xs text-gray-400">Cancelar</button>
        </>
      ) : (
        <>
          {flechas(idx > 0, idx < lista.length - 1, () => mover(lista, idx, -1), () => mover(lista, idx, 1))}
          <span className={`flex-1 text-sm ${p.activo === 'TRUE' ? 'text-gray-800' : 'text-gray-400 line-through'}`}>{p.nombre}</span>
          <select value={idsSg.has(p.subgrupo_id || '') ? p.subgrupo_id : ''} onChange={e => reasignar(p, e.target.value)}
            title="Subgrupo" className="text-xs border border-gray-300 rounded px-1 py-0.5 text-gray-500 max-w-[130px]">
            <option value="">Sin subgrupo</option>
            {sgs.map(sg => <option key={sg.id} value={sg.id}>{sg.nombre}</option>)}
          </select>
          <button onClick={() => toggleActivo(p)} className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${p.activo === 'TRUE' ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>{p.activo === 'TRUE' ? 'Activa' : 'Inactiva'}</button>
          <button onClick={() => { setEditId(p.id); setEditNombre(p.nombre) }} className="text-xs text-gray-400 hover:text-brand shrink-0">Editar</button>
          <button onClick={() => eliminar(p)} className="text-xs text-gray-300 hover:text-red-600 shrink-0">Eliminar</button>
        </>
      )}
    </div>
  )

  if (loading) return <div className="text-gray-500 text-sm">Cargando…</div>
  if (error) return <div className="text-red-700 text-sm bg-red-50 border border-red-200 rounded-lg p-3">{error}</div>

  return (
    <div className="space-y-5">
      <p className="text-sm text-gray-500">Partidas del estado de resultados. Podés agruparlas en subgrupos y reordenarlas con las flechas. Los gastos se asignan a estas partidas.</p>
      {TIPOS.map(t => {
        const sgs = sgDe(t.key)
        const sueltas = sueltasDe(t.key)
        const total = items.filter(i => i.tipo === t.key).length
        return (
          <div key={t.key} className="bg-white rounded-xl border border-gray-300 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-300 flex items-start justify-between gap-3">
              <div>
                <h3 className="font-semibold text-gray-800">{t.label} <span className="text-gray-400 text-sm font-normal">({total})</span></h3>
                {t.nota && <p className="text-xs text-gray-400 mt-0.5">{t.nota}</p>}
              </div>
              <button onClick={() => agregarSubgrupo(t.key)} className="text-xs text-brand font-medium whitespace-nowrap hover:text-brand">+ Subgrupo</button>
            </div>

            {sgs.map((sg, sgIdx) => {
              const ps = partidasDe(t.key, sg.id)
              return (
                <div key={sg.id} className="border-b border-gray-300">
                  <div className="px-4 py-1.5 bg-gray-50 flex items-center gap-2">
                    {flechas(sgIdx > 0, sgIdx < sgs.length - 1, () => moverSubgrupo(sgs, sgIdx, -1), () => moverSubgrupo(sgs, sgIdx, 1))}
                    <span className="flex-1 text-xs font-semibold text-gray-600 uppercase tracking-wide">▸ {sg.nombre}</span>
                    <button onClick={() => renombrarSubgrupo(sg)} className="text-xs text-gray-400 hover:text-brand">Renombrar</button>
                    <button onClick={() => eliminarSubgrupo(sg)} className="text-xs text-gray-300 hover:text-red-600">Eliminar</button>
                  </div>
                  <div className="divide-y divide-gray-50 pl-4">
                    {ps.map((p, idx) => filaPartida(p, idx, ps, t.key, sgs))}
                    {ps.length === 0 && <div className="px-4 py-2 text-xs text-gray-400">Sin partidas — asigná alguna con el selector «Subgrupo».</div>}
                  </div>
                </div>
              )
            })}

            {sueltas.length > 0 && (
              <div className="divide-y divide-gray-50">
                {sgs.length > 0 && <div className="px-4 pt-2 pb-0.5 text-[10px] text-gray-300 uppercase tracking-wide">Sin subgrupo</div>}
                {sueltas.map((p, idx) => filaPartida(p, idx, sueltas, t.key, sgs))}
              </div>
            )}

            <div className="px-4 py-2.5 bg-gray-50 flex flex-wrap items-center gap-2 border-t border-gray-300">
              <input
                value={nuevo[t.key] || ''}
                onChange={e => setNuevo(n => ({ ...n, [t.key]: e.target.value }))}
                onKeyDown={e => { if (e.key === 'Enter') agregarPartida(t.key) }}
                placeholder={`Nueva partida de ${t.label.toLowerCase()}…`}
                className="flex-1 min-w-[160px] border border-gray-300 rounded px-2 py-1 text-sm"
              />
              {sgs.length > 0 && (
                <select value={nuevoSg[t.key] || ''} onChange={e => setNuevoSg(n => ({ ...n, [t.key]: e.target.value }))} className="border border-gray-300 rounded px-2 py-1 text-sm text-gray-600">
                  <option value="">Sin subgrupo</option>
                  {sgs.map(sg => <option key={sg.id} value={sg.id}>{sg.nombre}</option>)}
                </select>
              )}
              <button onClick={() => agregarPartida(t.key)} className="text-sm bg-brand text-white px-3 py-1 rounded-lg hover:bg-brand-dark">Agregar</button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
