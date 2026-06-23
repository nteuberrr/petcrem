'use client'
import { useEffect, useRef, useState } from 'react'
import { fmtPrecio } from '@/lib/format'
import { formatDate } from '@/lib/dates'

interface Factura {
  id: string; tipo_doc: string; rut: string; razon_social: string; folio: string
  fecha_documento: string; fecha_recepcion: string
  monto_exento: string; monto_neto: string; monto_iva: string; monto_total: string; valor_otro_impuesto: string
  comentario: string; tipo_asignacion: string; partida_id: string; contabilizado: string; fecha_carga: string
}
interface Partida { id: string; tipo: string; nombre: string; activo: string }

const TIPO_LABEL: Record<string, string> = { costo: 'Costo', gasto: 'Gasto', impuesto: 'Impuesto' }

export default function FacturasSiiTab() {
  const [items, setItems] = useState<Factura[]>([])
  const [partidas, setPartidas] = useState<Partida[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [desde, setDesde] = useState('')
  const [hasta, setHasta] = useState('')
  const [estado, setEstado] = useState('')
  const [subiendo, setSubiendo] = useState(false)
  const [msg, setMsg] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const [asig, setAsig] = useState<Factura | null>(null)
  const [sortBy, setSortBy] = useState('')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [bulk, setBulk] = useState(false)
  const [tipoFiltro, setTipoFiltro] = useState('')
  const [partidaFiltro, setPartidaFiltro] = useState('')

  async function cargarPartidas() {
    const r = await fetch('/api/eerr/partidas'); const d = await r.json()
    if (Array.isArray(d)) setPartidas(d)
  }
  async function cargar() {
    try {
      const q = new URLSearchParams()
      if (desde) q.set('desde', desde)
      if (hasta) q.set('hasta', hasta)
      if (estado) q.set('estado', estado)
      const r = await fetch(`/api/eerr/gastos-sii?${q.toString()}`); const d = await r.json()
      if (Array.isArray(d)) { setItems(d); setError('') } else setError(d?.error || 'No se pudo cargar')
    } catch { setError('Error de red') } finally { setLoading(false) }
  }
  useEffect(() => { cargarPartidas() }, [])
  useEffect(() => { cargar() }, [desde, hasta, estado]) // eslint-disable-line react-hooks/exhaustive-deps

  async function subir(files: FileList) {
    setSubiendo(true); setMsg('')
    let nuevas = 0, dup = 0, comp = 0, err = ''
    try {
      for (const file of Array.from(files)) {
        const fd = new FormData(); fd.append('archivo', file)
        const r = await fetch('/api/eerr/gastos-sii', { method: 'POST', body: fd })
        const d = await r.json().catch(() => ({}))
        if (r.ok) { nuevas += d.nuevas || 0; dup += d.duplicadas || 0; comp += d.completadas || 0 }
        else { err = `${file.name}: ${d?.error || 'no se pudo'}`; break }
      }
      setMsg(err ? `⚠ ${err}` : `✓ ${nuevas} compras nuevas${comp ? `, ${comp} completadas` : ''} (${dup} ya estaban) · ${files.length} archivo(s).`)
      cargar()
    } catch { setMsg('Error de red') } finally { setSubiendo(false); if (fileRef.current) fileRef.current.value = '' }
  }

  const partidaNombre = (id: string) => partidas.find(p => p.id === id)?.nombre || ''
  const neto = (f: Factura) => (parseInt(f.monto_neto) || 0) + (parseInt(f.monto_exento) || 0)
  const ultimaCarga = items.reduce((m, f) => (f.fecha_carga > m ? f.fecha_carga : m), '')
  const sinFecha = items.filter(f => !f.fecha_documento).length

  // Ordenamiento por columna. Números y fechas arrancan de mayor a menor; texto A→Z.
  const DESC_DEFAULT = new Set(['folio', 'emision', 'recepcion', 'exento', 'neto', 'iva', 'total', 'otro'])
  function toggleSort(col: string) {
    if (sortBy === col) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortBy(col); setSortDir(DESC_DEFAULT.has(col) ? 'desc' : 'asc') }
  }
  const getVal = (f: Factura, key: string): string | number => {
    switch (key) {
      case 'rut': return f.rut
      case 'razon': return (f.razon_social || '').toLowerCase()
      case 'folio': return parseInt(f.folio) || 0
      case 'emision': return f.fecha_documento || ''
      case 'recepcion': return f.fecha_recepcion || ''
      case 'exento': return parseInt(f.monto_exento) || 0
      case 'neto': return parseInt(f.monto_neto) || 0
      case 'iva': return parseInt(f.monto_iva) || 0
      case 'total': return parseInt(f.monto_total) || 0
      case 'otro': return parseInt(f.valor_otro_impuesto) || 0
      case 'comentario': return (f.comentario || '').toLowerCase()
      case 'partida': return (partidaNombre(f.partida_id) || '').toLowerCase()
      default: return 0
    }
  }
  const filtradas = items.filter(f => {
    if (tipoFiltro && f.tipo_asignacion !== tipoFiltro) return false
    if (partidaFiltro && f.partida_id !== partidaFiltro) return false
    return true
  })
  const sorted = sortBy
    ? [...filtradas].sort((a, b) => {
        const va = getVal(a, sortBy), vb = getVal(b, sortBy)
        const cmp = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb))
        return sortDir === 'asc' ? cmp : -cmp
      })
    : filtradas

  // Selección múltiple (solo compras con fecha; las sin fecha no se pueden asignar).
  const seleccionables = sorted.filter(f => f.fecha_documento)
  const todasSel = seleccionables.length > 0 && seleccionables.every(f => sel.has(f.id))
  function toggleUno(id: string) {
    setSel(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  }
  function toggleTodas() {
    setSel(() => todasSel ? new Set() : new Set(seleccionables.map(f => f.id)))
  }
  const th = (col: string, label: string, align: 'left' | 'right' = 'left') => (
    <th key={col} onClick={() => toggleSort(col)}
      className={`px-2 py-2 font-medium cursor-pointer select-none hover:text-gray-700 whitespace-nowrap ${align === 'right' ? 'text-right' : 'text-left'}`}>
      {label}{sortBy === col ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}
    </th>
  )

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border border-gray-200 p-4 flex flex-wrap items-end gap-3">
        <div>
          <input ref={fileRef} type="file" accept=".csv,text/csv" multiple className="hidden"
            onChange={e => { const fs = e.target.files; if (fs && fs.length) subir(fs) }} />
          <button onClick={() => fileRef.current?.click()} disabled={subiendo}
            className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50">
            {subiendo ? 'Subiendo…' : '⬆ Subir compras (CSV)'}
          </button>
          <p className="text-xs text-gray-400 mt-1">Podés elegir varios archivos.{ultimaCarga ? ` Última carga: ${formatDate(ultimaCarga)}` : ''}</p>
        </div>
        <div className="h-9 w-px bg-gray-200 hidden sm:block" />
        <div>
          <label className="block text-xs text-gray-500 mb-1">Desde</label>
          <input type="date" value={desde} onChange={e => setDesde(e.target.value)} className="border border-gray-300 rounded px-2 py-1.5 text-sm" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Hasta</label>
          <input type="date" value={hasta} onChange={e => setHasta(e.target.value)} className="border border-gray-300 rounded px-2 py-1.5 text-sm" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Estado</label>
          <select value={estado} onChange={e => setEstado(e.target.value)} className="border border-gray-300 rounded px-2 py-1.5 text-sm">
            <option value="">Todos</option>
            <option value="contabilizado">Contabilizados</option>
            <option value="pendiente">Pendientes</option>
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Tipo</label>
          <select value={tipoFiltro} onChange={e => setTipoFiltro(e.target.value)} className="border border-gray-300 rounded px-2 py-1.5 text-sm">
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
            {partidas.filter(p => p.tipo !== 'ingreso' && p.activo === 'TRUE').map(p => (
              <option key={p.id} value={p.id}>{TIPO_LABEL[p.tipo] || ''} · {p.nombre}</option>
            ))}
          </select>
        </div>
        {(desde || hasta || estado || tipoFiltro || partidaFiltro) && (
          <button onClick={() => { setDesde(''); setHasta(''); setEstado(''); setTipoFiltro(''); setPartidaFiltro('') }} className="text-xs text-gray-400 hover:text-gray-700 mb-1.5">Limpiar</button>
        )}
      </div>

      {msg && <p className="text-sm text-gray-700 bg-amber-50 border border-amber-200 rounded-lg p-2.5">{msg}</p>}
      {error && <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-2.5">{error}</p>}
      {sinFecha > 0 && (
        <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-2.5">
          ⚠ {sinFecha} compra(s) <strong>sin fecha de emisión</strong> — no se pueden asignar (no caen en ningún mes del EERR). Volvé a subir el CSV para completar la fecha.
        </p>
      )}
      {sel.size > 0 && (
        <div className="flex flex-wrap items-center gap-3 bg-indigo-50 border border-indigo-200 rounded-lg px-4 py-2.5">
          <span className="text-sm text-indigo-800 font-medium">{sel.size} seleccionada(s)</span>
          <button onClick={() => setBulk(true)} className="bg-indigo-600 text-white px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-indigo-700">Asignar a una partida</button>
          <button onClick={() => setSel(new Set())} className="text-sm text-gray-500 hover:text-gray-700">Limpiar selección</button>
        </div>
      )}

      {loading ? (
        <div className="text-gray-500 text-sm">Cargando…</div>
      ) : items.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-400 text-sm">
          No hay compras {(desde || hasta || estado || tipoFiltro || partidaFiltro) ? 'con esos filtros' : 'cargadas todavía'}. Usá «Subir compras».
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 text-gray-500 uppercase">
              <tr>
                <th className="px-2 py-2 w-8 text-center">
                  <input type="checkbox" checked={todasSel} onChange={toggleTodas} title="Seleccionar todas (con fecha)" />
                </th>
                {th('rut', 'RUT')}
                {th('razon', 'Razón social')}
                {th('folio', 'Folio')}
                {th('emision', 'Emisión')}
                {th('recepcion', 'Recep.')}
                {th('exento', 'Exento', 'right')}
                {th('neto', 'Neto', 'right')}
                {th('iva', 'IVA', 'right')}
                {th('total', 'Total', 'right')}
                {th('otro', 'Otro', 'right')}
                {th('comentario', 'Comentario')}
                {th('partida', 'Partida')}
                <th className="px-2 py-2 sticky right-0 bg-gray-50 border-l border-gray-100"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {sorted.map(f => (
                <tr key={f.id} className={!f.fecha_documento ? 'bg-red-50' : f.contabilizado === 'TRUE' ? 'bg-white' : 'bg-amber-50'}>
                  <td className="px-2 py-1.5 text-center">
                    {f.fecha_documento
                      ? <input type="checkbox" checked={sel.has(f.id)} onChange={() => toggleUno(f.id)} />
                      : <span className="text-gray-300" title="Sin fecha: no se puede asignar">·</span>}
                  </td>
                  <td className="px-2 py-1.5 text-gray-600 whitespace-nowrap">{f.rut}</td>
                  <td className="px-2 py-1.5 text-gray-800 max-w-[120px] truncate" title={f.razon_social}>{f.razon_social}</td>
                  <td className="px-2 py-1.5 text-gray-500 whitespace-nowrap">{f.folio}</td>
                  <td className="px-2 py-1.5 whitespace-nowrap">{f.fecha_documento ? <span className="text-gray-600">{formatDate(f.fecha_documento)}</span> : <span className="text-red-600 font-medium" title="Falta la fecha de emisión">⚠ falta</span>}</td>
                  <td className="px-2 py-1.5 text-gray-500 whitespace-nowrap">{formatDate(f.fecha_recepcion)}</td>
                  <td className="px-2 py-1.5 text-right text-gray-500 tabular-nums whitespace-nowrap">{fmtPrecio(parseInt(f.monto_exento) || 0)}</td>
                  <td className="px-2 py-1.5 text-right text-gray-700 tabular-nums whitespace-nowrap">{fmtPrecio(parseInt(f.monto_neto) || 0)}</td>
                  <td className="px-2 py-1.5 text-right text-gray-500 tabular-nums whitespace-nowrap">{fmtPrecio(parseInt(f.monto_iva) || 0)}</td>
                  <td className="px-2 py-1.5 text-right text-gray-800 font-medium tabular-nums whitespace-nowrap">{fmtPrecio(parseInt(f.monto_total) || 0)}</td>
                  <td className="px-2 py-1.5 text-right text-gray-500 tabular-nums whitespace-nowrap">{fmtPrecio(parseInt(f.valor_otro_impuesto) || 0)}</td>
                  <td className="px-2 py-1.5">
                    <input
                      defaultValue={f.comentario}
                      onBlur={e => { if (e.target.value !== f.comentario) fetch('/api/eerr/gastos-sii', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: f.id, comentario: e.target.value }) }).then(cargar) }}
                      placeholder="—"
                      className="w-20 border border-transparent hover:border-gray-200 focus:border-indigo-400 rounded px-1 py-1 text-xs"
                    />
                  </td>
                  <td className="px-2 py-1.5 max-w-[130px] truncate" title={f.partida_id ? `${TIPO_LABEL[f.tipo_asignacion] || ''} · ${partidaNombre(f.partida_id)}` : 'Sin asignar'}>
                    {f.partida_id
                      ? <span><span className="text-gray-400">{TIPO_LABEL[f.tipo_asignacion] || ''}</span> · {partidaNombre(f.partida_id)}</span>
                      : <span className="text-amber-600 font-medium">Sin asignar</span>}
                  </td>
                  <td className={`px-2 py-1.5 text-right sticky right-0 border-l border-gray-100 ${!f.fecha_documento ? 'bg-red-50' : f.contabilizado === 'TRUE' ? 'bg-white' : 'bg-amber-50'}`}>
                    {!f.fecha_documento
                      ? <span className="text-red-600 font-medium whitespace-nowrap" title="Completá la fecha de emisión (volvé a subir el CSV) para poder asignarla.">⚠ Falta fecha</span>
                      : f.partida_id
                        ? <button onClick={() => setAsig(f)} className="border border-gray-200 text-gray-600 hover:bg-gray-50 px-2 py-1 rounded-lg font-medium whitespace-nowrap">Editar</button>
                        : <button onClick={() => setAsig(f)} className="bg-indigo-600 text-white hover:bg-indigo-700 px-2.5 py-1 rounded-lg font-medium whitespace-nowrap">Asignar</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {asig && (
        <AsignarModal
          factura={asig}
          partidas={partidas}
          netoLabel={fmtPrecio(neto(asig))}
          onClose={() => setAsig(null)}
          onSaved={() => { setAsig(null); cargar() }}
        />
      )}
      {bulk && (
        <BulkAsignarModal
          ids={Array.from(sel)}
          partidas={partidas}
          onClose={() => setBulk(false)}
          onSaved={() => { setBulk(false); setSel(new Set()); cargar() }}
        />
      )}
    </div>
  )
}

function AsignarModal({ factura, partidas, netoLabel, onClose, onSaved }: {
  factura: Factura; partidas: Partida[]; netoLabel: string; onClose: () => void; onSaved: () => void
}) {
  const [tipo, setTipo] = useState(factura.tipo_asignacion || '')
  const [partida, setPartida] = useState(factura.partida_id || '')
  const [aplicar, setAplicar] = useState(false)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const opciones = partidas.filter(p => p.tipo === tipo && p.activo === 'TRUE')

  async function guardar() {
    if (!tipo || !partida) { setErr('Elegí tipo y partida'); return }
    setSaving(true); setErr('')
    const r = await fetch('/api/eerr/gastos-sii', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: factura.id, tipo_asignacion: tipo, partida_id: partida, aplicar_proveedor: aplicar }) })
    setSaving(false)
    if (r.ok) onSaved()
    else { const d = await r.json().catch(() => ({})); setErr(d?.error || 'No se pudo guardar') }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-5" onClick={e => e.stopPropagation()}>
        <h3 className="font-semibold text-gray-900 mb-1">Asignar compra</h3>
        <p className="text-xs text-gray-500 mb-4">{factura.razon_social} · folio {factura.folio} · neto {netoLabel}</p>

        <label className="block text-xs text-gray-500 mb-1">¿Costo o gasto?</label>
        <div className="flex gap-2 mb-4">
          {(['costo', 'gasto', 'impuesto'] as const).map(t => (
            <button key={t} onClick={() => { setTipo(t); setPartida('') }}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium ${tipo === t ? 'bg-indigo-600 text-white' : 'bg-white border border-gray-200 text-gray-600'}`}>
              {TIPO_LABEL[t]}
            </button>
          ))}
        </div>

        <label className="block text-xs text-gray-500 mb-1">Partida</label>
        <select value={partida} onChange={e => setPartida(e.target.value)} disabled={!tipo}
          className="w-full border border-gray-300 rounded px-2 py-2 text-sm mb-4 disabled:opacity-40">
          <option value="">— Elegí una partida —</option>
          {opciones.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
        </select>

        <label className="flex items-start gap-2 mb-5 cursor-pointer">
          <input type="checkbox" checked={aplicar} onChange={e => setAplicar(e.target.checked)} className="mt-0.5" />
          <span className="text-xs text-gray-600">Aplicar este criterio a <strong>todas las compras de {factura.razon_social}</strong>: las pendientes ya cargadas y las futuras. Las que ya tienen partida no se tocan.</span>
        </label>

        {err && <p className="text-sm text-red-700 mb-3">{err}</p>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="text-sm text-gray-500 px-3 py-2">Cancelar</button>
          <button onClick={guardar} disabled={saving} className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50">{saving ? 'Guardando…' : 'Guardar'}</button>
        </div>
      </div>
    </div>
  )
}

function BulkAsignarModal({ ids, partidas, onClose, onSaved }: {
  ids: string[]; partidas: Partida[]; onClose: () => void; onSaved: () => void
}) {
  const [tipo, setTipo] = useState('')
  const [partida, setPartida] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const opciones = partidas.filter(p => p.tipo === tipo && p.activo === 'TRUE')

  async function guardar() {
    if (!tipo || !partida) { setErr('Elegí tipo y partida'); return }
    setSaving(true); setErr('')
    const r = await fetch('/api/eerr/gastos-sii', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ids, tipo_asignacion: tipo, partida_id: partida }) })
    setSaving(false)
    if (r.ok) onSaved()
    else { const d = await r.json().catch(() => ({})); setErr(d?.error || 'No se pudo guardar') }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-5" onClick={e => e.stopPropagation()}>
        <h3 className="font-semibold text-gray-900 mb-1">Asignar {ids.length} compra(s)</h3>
        <p className="text-xs text-gray-500 mb-4">Se asignan todas a la misma partida.</p>

        <label className="block text-xs text-gray-500 mb-1">¿Costo o gasto?</label>
        <div className="flex gap-2 mb-4">
          {(['costo', 'gasto', 'impuesto'] as const).map(t => (
            <button key={t} onClick={() => { setTipo(t); setPartida('') }}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium ${tipo === t ? 'bg-indigo-600 text-white' : 'bg-white border border-gray-200 text-gray-600'}`}>
              {TIPO_LABEL[t]}
            </button>
          ))}
        </div>

        <label className="block text-xs text-gray-500 mb-1">Partida</label>
        <select value={partida} onChange={e => setPartida(e.target.value)} disabled={!tipo}
          className="w-full border border-gray-300 rounded px-2 py-2 text-sm mb-5 disabled:opacity-40">
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
