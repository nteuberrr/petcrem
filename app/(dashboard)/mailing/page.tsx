'use client'
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { Modal } from '@/components/ui/Modal'
import { formatDate, formatDateTime } from '@/lib/dates'

type Vet = {
  id: string
  nombre: string
  email: string
  veterinaria: string
  comuna: string
  telefono: string
  categoria: string
  suscrito: string
  notas: string
  fecha_creacion: string
}

type Campana = {
  id: string
  asunto: string
  html_key: string
  html_url: string
  preview_text: string
  reply_to: string
  fecha_envio: string
  total_destinatarios: string
  enviados: string
  entregados: string
  aperturas: string
  clicks: string
  rebotes: string
  spam: string
  fallidos: string
  estado: string
  filtros_json: string
  creado_por: string
  fecha_creacion: string
}

type Prefilled = { asunto: string; html: string; preview_text: string; reply_to: string; categoria: string } | null

const TABS = ['Campañas', 'Base', 'Nueva campaña'] as const
type Tab = typeof TABS[number]

const CATEGORIAS = ['prospecto', 'cliente', 'inactivo'] as const

export default function MailingPage() {
  const [tab, setTab] = useState<Tab>('Campañas')
  const [prefilled, setPrefilled] = useState<Prefilled>(null)
  const [campanasRefreshKey, setCampanasRefreshKey] = useState(0)

  function abrirDuplicar(p: Exclude<Prefilled, null>) {
    setPrefilled(p)
    setTab('Nueva campaña')
  }

  function onCampanaCreada() {
    setPrefilled(null)
    setCampanasRefreshKey(k => k + 1)
    setTab('Campañas')
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Mailing</h1>
        <p className="text-sm text-gray-500">Campañas de email a la base de veterinarios.</p>
      </div>

      <div className="inline-flex gap-1 bg-gray-100 border border-gray-200 rounded-xl p-1.5 shadow-sm overflow-x-auto">
        {TABS.map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-5 py-2 rounded-lg text-sm font-semibold whitespace-nowrap transition-all ${
              tab === t
                ? 'bg-indigo-600 text-white shadow-md ring-1 ring-indigo-700/10'
                : 'text-gray-600 hover:bg-white hover:text-gray-900'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'Campañas' && <CampanasPanel refreshKey={campanasRefreshKey} onDuplicar={abrirDuplicar} />}
      {tab === 'Base' && <BasePanel />}
      {tab === 'Nueva campaña' && <NuevaCampanaPanel initial={prefilled} onCreada={onCampanaCreada} />}
    </div>
  )
}

const EMPTY_FORM = {
  nombre: '', email: '', veterinaria: '', comuna: '', telefono: '',
  categoria: 'prospecto', suscrito: 'TRUE', notas: '',
}

function BasePanel() {
  const [vets, setVets] = useState<Vet[]>([])
  const [loading, setLoading] = useState(true)
  const [busqueda, setBusqueda] = useState('')
  const [filtroCategoria, setFiltroCategoria] = useState<string>('todos')
  const [filtroSuscrito, setFiltroSuscrito] = useState<'todos' | 'TRUE' | 'FALSE'>('todos')
  const [modalOpen, setModalOpen] = useState(false)
  const [editando, setEditando] = useState<Vet | null>(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkAction, setBulkAction] = useState<'' | 'set_categoria' | 'set_suscrito' | 'delete'>('')
  const [bulkValue, setBulkValue] = useState('')
  const [bulkExecuting, setBulkExecuting] = useState(false)

  const fetchVets = useCallback(async () => {
    setLoading(true)
    const res = await fetch('/api/mailing/veterinarios', { cache: 'no-store' })
    const data = await res.json()
    setVets(Array.isArray(data) ? data : [])
    setLoading(false)
  }, [])

  function toggleSelectVet(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  function clearSelection() {
    setSelectedIds(new Set())
    setBulkAction('')
    setBulkValue('')
  }

  async function ejecutarBulk() {
    if (selectedIds.size === 0 || !bulkAction) return
    const accion = bulkAction === 'delete' ? `Eliminar ${selectedIds.size} veterinarios` :
                   bulkAction === 'set_categoria' ? `Cambiar categoría de ${selectedIds.size} veterinarios a "${bulkValue}"` :
                   `${bulkValue === 'FALSE' ? 'Desuscribir' : 'Suscribir'} ${selectedIds.size} veterinarios`
    if (!confirm(`${accion}. ¿Confirmás?`)) return
    setBulkExecuting(true)
    const res = await fetch('/api/mailing/veterinarios/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ids: Array.from(selectedIds),
        action: bulkAction,
        value: bulkValue,
      }),
    })
    const j = await res.json().catch(() => ({}))
    setBulkExecuting(false)
    if (res.ok) {
      alert(`${j.affected} registros afectados`)
      clearSelection()
      await fetchVets()
    } else {
      alert(`Error: ${j.error ?? res.status}`)
    }
  }

  useEffect(() => { fetchVets() }, [fetchVets])

  function abrirNuevo() {
    setEditando(null)
    setForm(EMPTY_FORM)
    setError('')
    setModalOpen(true)
  }

  function abrirEditar(v: Vet) {
    setEditando(v)
    setForm({
      nombre: v.nombre, email: v.email, veterinaria: v.veterinaria,
      comuna: v.comuna, telefono: v.telefono,
      categoria: v.categoria || 'prospecto',
      suscrito: v.suscrito || 'TRUE',
      notas: v.notas,
    })
    setError('')
    setModalOpen(true)
  }

  async function guardar(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setSaving(true)
    const method = editando ? 'PATCH' : 'POST'
    const url = editando ? `/api/mailing/veterinarios/${editando.id}` : '/api/mailing/veterinarios'
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    const j = await res.json().catch(() => ({}))
    if (res.ok) {
      setModalOpen(false)
      await fetchVets()
    } else {
      setError(j.error || `Error ${res.status}`)
    }
    setSaving(false)
  }

  async function eliminar(v: Vet) {
    if (!confirm(`¿Eliminar a ${v.nombre} (${v.email})?`)) return
    const res = await fetch(`/api/mailing/veterinarios/${v.id}`, { method: 'DELETE' })
    if (res.ok) await fetchVets()
    else alert('Error al eliminar')
  }

  const filtrados = vets.filter(v => {
    if (filtroCategoria !== 'todos' && v.categoria !== filtroCategoria) return false
    if (filtroSuscrito !== 'todos' && v.suscrito !== filtroSuscrito) return false
    if (!busqueda) return true
    const q = busqueda.toLowerCase()
    return v.nombre.toLowerCase().includes(q) ||
           v.email.toLowerCase().includes(q) ||
           v.veterinaria.toLowerCase().includes(q) ||
           v.comuna.toLowerCase().includes(q)
  })

  const stats = {
    total: vets.length,
    suscritos: vets.filter(v => v.suscrito === 'TRUE').length,
    prospectos: vets.filter(v => v.categoria === 'prospecto').length,
    clientes: vets.filter(v => v.categoria === 'cliente').length,
    inactivos: vets.filter(v => v.categoria === 'inactivo').length,
  }

  // Distribuciones (contar y agrupar)
  const distCategoria = useMemo(() => {
    const m = new Map<string, number>()
    vets.forEach(v => {
      const k = v.categoria || '(sin categoría)'
      m.set(k, (m.get(k) || 0) + 1)
    })
    return Array.from(m.entries())
      .sort((a, b) => b[1] - a[1])
  }, [vets])

  const distComuna = useMemo(() => {
    const m = new Map<string, number>()
    vets.forEach(v => {
      const k = (v.comuna || '').trim() || '(sin comuna)'
      m.set(k, (m.get(k) || 0) + 1)
    })
    return Array.from(m.entries())
      .sort((a, b) => b[1] - a[1])
  }, [vets])

  const distSuscrito = useMemo(() => {
    const suscritos = vets.filter(v => v.suscrito === 'TRUE').length
    const desuscritos = vets.length - suscritos
    return [
      ['Suscritos', suscritos] as [string, number],
      ['Desuscritos', desuscritos] as [string, number],
    ]
  }, [vets])

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <StatBox label="Total" value={stats.total} />
        <StatBox label="Suscritos" value={stats.suscritos} accent="green" />
        <StatBox label="Prospectos" value={stats.prospectos} accent="indigo" />
        <StatBox label="Clientes" value={stats.clientes} accent="emerald" />
        <StatBox label="Inactivos" value={stats.inactivos} accent="gray" />
      </div>

      {vets.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          <DistribucionPanel title="Distribución por categoría" data={distCategoria} total={vets.length} colorMap={{ prospecto: 'indigo', cliente: 'emerald', inactivo: 'gray' }} />
          <DistribucionPanel title="Distribución por suscripción" data={distSuscrito} total={vets.length} colorMap={{ 'Suscritos': 'green', 'Desuscritos': 'red' }} />
          <DistribucionPanel title="Distribución por comuna" data={distComuna} total={vets.length} colorMap={{}} maxRows={10} />
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-gray-100">
          <input
            type="text"
            value={busqueda}
            onChange={e => setBusqueda(e.target.value)}
            placeholder="Buscar por nombre, email, clínica…"
            className="flex-1 min-w-[200px] border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none"
          />
          <select
            value={filtroCategoria}
            onChange={e => setFiltroCategoria(e.target.value)}
            className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:border-indigo-500 focus:outline-none"
          >
            <option value="todos">Todas las categorías</option>
            {CATEGORIAS.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <select
            value={filtroSuscrito}
            onChange={e => setFiltroSuscrito(e.target.value as 'todos' | 'TRUE' | 'FALSE')}
            className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:border-indigo-500 focus:outline-none"
          >
            <option value="todos">Suscripción: todos</option>
            <option value="TRUE">Solo suscritos</option>
            <option value="FALSE">Solo desuscritos</option>
          </select>
          <button
            onClick={abrirNuevo}
            className="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-lg px-4 py-1.5 text-sm shadow-sm transition-colors"
          >
            + Agregar
          </button>
        </div>

        {selectedIds.size > 0 && (
          <div className="bg-indigo-50 border-b border-indigo-200 px-4 py-2.5 flex flex-wrap items-center gap-3">
            <span className="text-sm font-semibold text-indigo-900">
              {selectedIds.size} seleccionado{selectedIds.size === 1 ? '' : 's'}
            </span>
            <select
              value={bulkAction}
              onChange={e => { setBulkAction(e.target.value as typeof bulkAction); setBulkValue('') }}
              className="border border-indigo-300 rounded-lg px-2 py-1 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="">— Acción masiva —</option>
              <option value="set_categoria">Cambiar categoría</option>
              <option value="set_suscrito">Cambiar suscripción</option>
              <option value="delete">Eliminar</option>
            </select>
            {bulkAction === 'set_categoria' && (
              <select value={bulkValue} onChange={e => setBulkValue(e.target.value)}
                className="border border-indigo-300 rounded-lg px-2 py-1 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500">
                <option value="">— a qué categoría —</option>
                {CATEGORIAS.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            )}
            {bulkAction === 'set_suscrito' && (
              <select value={bulkValue} onChange={e => setBulkValue(e.target.value)}
                className="border border-indigo-300 rounded-lg px-2 py-1 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500">
                <option value="">— suscribir o desuscribir —</option>
                <option value="TRUE">Suscribir</option>
                <option value="FALSE">Desuscribir</option>
              </select>
            )}
            <button
              onClick={ejecutarBulk}
              disabled={bulkExecuting || !bulkAction || (bulkAction !== 'delete' && !bulkValue)}
              className="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-lg px-3 py-1 text-sm disabled:opacity-50"
            >
              {bulkExecuting ? 'Aplicando…' : 'Aplicar'}
            </button>
            <button
              onClick={clearSelection}
              className="text-xs text-indigo-700 hover:underline ml-auto"
            >
              Limpiar selección
            </button>
          </div>
        )}

        {loading ? (
          <div className="p-8 text-center text-sm text-gray-400">Cargando…</div>
        ) : filtrados.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-400">
            {vets.length === 0 ? 'Sin veterinarios en la base. Agregá el primero.' : 'Sin resultados con esos filtros.'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[800px]">
              <thead className="bg-gray-50 text-xs text-gray-600 uppercase tracking-wide">
                <tr>
                  <th className="px-2 py-2 w-8">
                    <input
                      type="checkbox"
                      checked={filtrados.length > 0 && filtrados.every(v => selectedIds.has(v.id))}
                      onChange={e => {
                        if (e.target.checked) setSelectedIds(prev => { const n = new Set(prev); filtrados.forEach(v => n.add(v.id)); return n })
                        else setSelectedIds(prev => { const n = new Set(prev); filtrados.forEach(v => n.delete(v.id)); return n })
                      }}
                      className="w-4 h-4 rounded text-indigo-600"
                      title="Seleccionar todos los visibles"
                    />
                  </th>
                  <th className="px-3 py-2 text-left font-semibold">Nombre</th>
                  <th className="px-3 py-2 text-left font-semibold">Email</th>
                  <th className="px-3 py-2 text-left font-semibold">Clínica</th>
                  <th className="px-3 py-2 text-left font-semibold">Comuna</th>
                  <th className="px-3 py-2 text-left font-semibold">Categoría</th>
                  <th className="px-3 py-2 text-left font-semibold">Susc.</th>
                  <th className="px-3 py-2 text-left font-semibold w-32">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtrados.map(v => {
                  const isSel = selectedIds.has(v.id)
                  return (
                    <tr key={v.id} className={isSel ? 'bg-indigo-50' : 'hover:bg-gray-50'}>
                      <td className="px-2 py-2">
                        <input type="checkbox" checked={isSel} onChange={() => toggleSelectVet(v.id)}
                          className="w-4 h-4 rounded text-indigo-600" />
                      </td>
                      <td className="px-3 py-2 text-gray-900 font-medium">{v.nombre}</td>
                      <td className="px-3 py-2 text-gray-700">{v.email}</td>
                      <td className="px-3 py-2 text-gray-600">{v.veterinaria || '—'}</td>
                      <td className="px-3 py-2 text-gray-600">{v.comuna || '—'}</td>
                      <td className="px-3 py-2">
                        <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] uppercase font-bold ${
                          v.categoria === 'cliente' ? 'bg-emerald-100 text-emerald-800' :
                          v.categoria === 'prospecto' ? 'bg-indigo-100 text-indigo-800' :
                          v.categoria === 'inactivo' ? 'bg-gray-200 text-gray-700' :
                          'bg-yellow-100 text-yellow-800'
                        }`}>{v.categoria || '—'}</span>
                      </td>
                      <td className="px-3 py-2">
                        <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold ${
                          v.suscrito === 'TRUE' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                        }`}>{v.suscrito === 'TRUE' ? 'SI' : 'NO'}</span>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex gap-1.5">
                          <button onClick={() => abrirEditar(v)} className="bg-emerald-500 hover:bg-emerald-600 text-white px-2 py-1 rounded text-xs font-medium">Editar</button>
                          <button onClick={() => eliminar(v)} className="bg-red-500 hover:bg-red-600 text-white px-2 py-1 rounded text-xs font-medium">Eliminar</button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editando ? `Editar veterinario` : 'Nuevo veterinario'}>
        <form onSubmit={guardar} className="space-y-3">
          <FieldRow>
            <Field label="Nombre *" value={form.nombre} onChange={v => setForm(f => ({ ...f, nombre: v }))} required />
            <Field label="Email *" value={form.email} onChange={v => setForm(f => ({ ...f, email: v }))} type="email" required />
          </FieldRow>
          <FieldRow>
            <Field label="Clínica / Veterinaria" value={form.veterinaria} onChange={v => setForm(f => ({ ...f, veterinaria: v }))} />
            <Field label="Comuna" value={form.comuna} onChange={v => setForm(f => ({ ...f, comuna: v }))} />
          </FieldRow>
          <FieldRow>
            <Field label="Teléfono" value={form.telefono} onChange={v => setForm(f => ({ ...f, telefono: v }))} />
            <div>
              <label className="text-xs font-semibold text-gray-700">Categoría</label>
              <select value={form.categoria}
                onChange={e => setForm(f => ({ ...f, categoria: e.target.value }))}
                className="mt-1 w-full border-2 border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                {CATEGORIAS.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </FieldRow>
          <div className="flex items-center gap-2">
            <input type="checkbox" id="suscrito" checked={form.suscrito === 'TRUE'}
              onChange={e => setForm(f => ({ ...f, suscrito: e.target.checked ? 'TRUE' : 'FALSE' }))}
              className="w-4 h-4 rounded border-gray-400 text-indigo-600" />
            <label htmlFor="suscrito" className="text-xs font-medium text-gray-700">Suscrito a campañas (si está desmarcado, no recibe mails)</label>
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-700">Notas</label>
            <textarea value={form.notas}
              onChange={e => setForm(f => ({ ...f, notas: e.target.value }))}
              rows={2}
              className="mt-1 w-full border-2 border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
          {error && <div className="bg-red-50 border border-red-200 text-red-800 rounded-lg px-3 py-2 text-sm">{error}</div>}
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={() => setModalOpen(false)} className="flex-1 border-2 border-gray-300 text-gray-700 rounded-lg py-2 text-sm font-semibold hover:bg-gray-50 transition-colors">
              Cancelar
            </button>
            <button type="submit" disabled={saving} className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg py-2 text-sm font-semibold shadow-md transition-colors disabled:opacity-50">
              {saving ? 'Guardando…' : (editando ? 'Guardar cambios' : 'Agregar')}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  )
}

function StatBox({ label, value, accent }: { label: string; value: number; accent?: 'green' | 'indigo' | 'emerald' | 'gray' }) {
  const color = accent === 'green' ? 'text-green-700' :
                accent === 'indigo' ? 'text-indigo-700' :
                accent === 'emerald' ? 'text-emerald-700' :
                accent === 'gray' ? 'text-gray-600' :
                'text-gray-900'
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 px-4 py-3">
      <div className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">{label}</div>
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
    </div>
  )
}

const BAR_COLORS: Record<string, { bar: string; text: string }> = {
  indigo:   { bar: 'bg-indigo-500',   text: 'text-indigo-700' },
  emerald:  { bar: 'bg-emerald-500',  text: 'text-emerald-700' },
  green:    { bar: 'bg-green-500',    text: 'text-green-700' },
  gray:     { bar: 'bg-gray-400',     text: 'text-gray-600' },
  red:      { bar: 'bg-red-500',      text: 'text-red-700' },
  amber:    { bar: 'bg-amber-500',    text: 'text-amber-700' },
  cyan:     { bar: 'bg-cyan-500',     text: 'text-cyan-700' },
  violet:   { bar: 'bg-violet-500',   text: 'text-violet-700' },
}

const DEFAULT_PALETTE = ['indigo', 'emerald', 'amber', 'cyan', 'violet', 'red', 'green', 'gray'] as const

function DistribucionPanel({ title, data, total, colorMap, maxRows }: {
  title: string
  data: [string, number][]
  total: number
  colorMap: Record<string, string>
  maxRows?: number
}) {
  const visibles = maxRows && data.length > maxRows ? data.slice(0, maxRows) : data
  const restantes = maxRows && data.length > maxRows ? data.slice(maxRows) : []
  const otrosCount = restantes.reduce((sum, [, n]) => sum + n, 0)

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
      <h3 className="text-xs font-bold text-gray-700 uppercase tracking-wider mb-3">{title}</h3>
      {data.length === 0 ? (
        <p className="text-xs text-gray-400">Sin datos</p>
      ) : (
        <ul className="space-y-2">
          {visibles.map(([label, count], i) => {
            const pct = total > 0 ? Math.round(100 * count / total) : 0
            const colorKey = colorMap[label] ?? DEFAULT_PALETTE[i % DEFAULT_PALETTE.length]
            const c = BAR_COLORS[colorKey] ?? BAR_COLORS.gray
            return (
              <li key={label}>
                <div className="flex justify-between items-baseline text-xs mb-1">
                  <span className="text-gray-700 truncate max-w-[60%]" title={label}>{label}</span>
                  <span className={`font-bold ${c.text}`}>
                    {count} <span className="text-gray-400 font-normal">({pct}%)</span>
                  </span>
                </div>
                <div className="w-full bg-gray-100 rounded-full h-1.5">
                  <div className={`${c.bar} h-1.5 rounded-full transition-all`} style={{ width: `${Math.max(2, pct)}%` }} />
                </div>
              </li>
            )
          })}
          {otrosCount > 0 && (
            <li className="text-[11px] text-gray-500 italic pt-1">
              + {restantes.length} comunas más con {otrosCount} {otrosCount === 1 ? 'registro' : 'registros'} total
            </li>
          )}
        </ul>
      )}
    </div>
  )
}

function FieldRow({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{children}</div>
}

function Field({ label, value, onChange, type = 'text', required }: {
  label: string; value: string; onChange: (v: string) => void; type?: string; required?: boolean
}) {
  return (
    <div>
      <label className="text-xs font-semibold text-gray-700">{label}</label>
      <input type={type} value={value} onChange={e => onChange(e.target.value)} required={required}
        className="mt-1 w-full border-2 border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
    </div>
  )
}

// ===================== CAMPAÑAS =====================

function CampanasPanel({ refreshKey, onDuplicar }: {
  refreshKey: number
  onDuplicar: (p: Exclude<Prefilled, null>) => void
}) {
  const [campanas, setCampanas] = useState<Campana[]>([])
  const [loading, setLoading] = useState(true)
  const [detalle, setDetalle] = useState<Campana | null>(null)
  const [detalleHtml, setDetalleHtml] = useState<string>('')
  const [detalleLogs, setDetalleLogs] = useState<Record<string, string>[]>([])
  const [loadingDetalle, setLoadingDetalle] = useState(false)

  const fetchCampanas = useCallback(async () => {
    setLoading(true)
    const res = await fetch('/api/mailing/campanas', { cache: 'no-store' })
    const data = await res.json()
    setCampanas(Array.isArray(data) ? data : [])
    setLoading(false)
  }, [])

  useEffect(() => { fetchCampanas() }, [fetchCampanas, refreshKey])

  async function abrirDetalle(c: Campana) {
    setDetalle(c)
    setLoadingDetalle(true)
    setDetalleHtml('')
    setDetalleLogs([])
    try {
      const [det, html] = await Promise.all([
        fetch(`/api/mailing/campanas/${c.id}`).then(r => r.json()),
        fetch(`/api/mailing/campanas/${c.id}/html`).then(r => r.json()),
      ])
      setDetalleLogs(Array.isArray(det?.logs) ? det.logs : [])
      setDetalleHtml(typeof html?.html === 'string' ? html.html : '')
    } catch {
      // ignore
    }
    setLoadingDetalle(false)
  }

  async function eliminar(c: Campana) {
    const enviados = parseInt(c.enviados || '0', 10)
    const warning = enviados > 0
      ? `¿Eliminar la campaña "${c.asunto}"?\n\n⚠ Esta campaña ya envió ${enviados} email${enviados === 1 ? '' : 's'}. Se borra el HTML y la fila de la campaña, pero los logs individuales (mailing_logs) quedan para auditoría.`
      : `¿Eliminar la campaña "${c.asunto}"?\nSe borra el HTML de R2 y la fila de la campaña.`
    if (!confirm(warning)) return
    const res = await fetch(`/api/mailing/campanas/${c.id}`, { method: 'DELETE' })
    if (res.ok) {
      setDetalle(null)
      await fetchCampanas()
    } else {
      const j = await res.json().catch(() => ({}))
      alert('Error: ' + (j.error ?? res.status))
    }
  }

  async function duplicar(c: Campana) {
    setLoadingDetalle(true)
    try {
      const j = await fetch(`/api/mailing/campanas/${c.id}/html`).then(r => r.json())
      const filtros = c.filtros_json ? JSON.parse(c.filtros_json) : {}
      onDuplicar({
        asunto: c.asunto,
        html: typeof j?.html === 'string' ? j.html : '',
        preview_text: c.preview_text,
        reply_to: c.reply_to,
        categoria: filtros.categoria || 'todos',
      })
    } catch {
      alert('No se pudo cargar el HTML para duplicar')
    }
    setLoadingDetalle(false)
  }

  // En tab Campañas solo mostramos las enviadas/fallidas/enviando — los borradores viven en Nueva campaña.
  const campanasEnviadas = campanas.filter(c => c.estado !== 'borrador')

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-sm text-gray-400">Cargando…</div>
        ) : campanasEnviadas.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-400">
            Sin campañas enviadas todavía. Crea y enviá una desde la tab &quot;Nueva campaña&quot;.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[920px]">
              <thead className="bg-gray-50 text-xs text-gray-600 uppercase tracking-wide">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold">Asunto</th>
                  <th className="px-3 py-2 text-left font-semibold">Estado</th>
                  <th className="px-3 py-2 text-right font-semibold">Dest.</th>
                  <th className="px-3 py-2 text-right font-semibold">Enviados</th>
                  <th className="px-3 py-2 text-right font-semibold">Aperturas</th>
                  <th className="px-3 py-2 text-right font-semibold">Clicks</th>
                  <th className="px-3 py-2 text-right font-semibold">Rebotes</th>
                  <th className="px-3 py-2 text-left font-semibold">Fecha envío</th>
                  <th className="px-3 py-2 text-left font-semibold w-32">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {campanasEnviadas.map(c => {
                  const total = parseInt(c.enviados || '0', 10)
                  const aperturas = parseInt(c.aperturas || '0', 10)
                  const clicks = parseInt(c.clicks || '0', 10)
                  const tasaApertura = total > 0 ? Math.round(100 * aperturas / total) : null
                  const tasaClick = total > 0 ? Math.round(100 * clicks / total) : null
                  return (
                    <tr key={c.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => abrirDetalle(c)}>
                      <td className="px-3 py-2 text-gray-900 font-medium truncate max-w-[280px]">{c.asunto}</td>
                      <td className="px-3 py-2"><EstadoBadge estado={c.estado} /></td>
                      <td className="px-3 py-2 text-right text-gray-700">{c.total_destinatarios || '0'}</td>
                      <td className="px-3 py-2 text-right text-gray-700">{c.enviados || '0'}</td>
                      <td className="px-3 py-2 text-right text-gray-700">
                        {c.aperturas || '0'}
                        {tasaApertura !== null && <span className="text-[10px] text-gray-400 ml-1">({tasaApertura}%)</span>}
                      </td>
                      <td className="px-3 py-2 text-right text-gray-700">
                        {c.clicks || '0'}
                        {tasaClick !== null && <span className="text-[10px] text-gray-400 ml-1">({tasaClick}%)</span>}
                      </td>
                      <td className="px-3 py-2 text-right text-gray-700">{c.rebotes || '0'}</td>
                      <td className="px-3 py-2 text-gray-600 text-xs whitespace-nowrap">{formatDate(c.fecha_envio) || '—'}</td>
                      <td className="px-3 py-2" onClick={e => e.stopPropagation()}>
                        <div className="flex gap-1.5">
                          {(c.estado === 'enviado' || c.estado === 'fallido') && (
                            <button onClick={() => duplicar(c)} className="bg-indigo-600 hover:bg-indigo-700 text-white px-2.5 py-1 rounded-md text-xs font-semibold shadow-sm">Duplicar</button>
                          )}
                          {c.estado !== 'enviando' && (
                            <button onClick={() => eliminar(c)} className="bg-red-600 hover:bg-red-700 text-white px-2.5 py-1 rounded-md text-xs font-semibold shadow-sm">Eliminar</button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Modal open={!!detalle} onClose={() => setDetalle(null)} title={detalle ? `Campaña: ${detalle.asunto}` : ''}>
        {detalle && (
          <div className="space-y-3">
            <MetricasCampana detalle={detalle} />

            <div className="border border-gray-200 rounded-lg overflow-hidden">
              <div className="bg-gray-50 px-3 py-2 text-xs font-semibold text-gray-700">Preview HTML</div>
              {loadingDetalle ? (
                <div className="p-8 text-center text-sm text-gray-400">Cargando…</div>
              ) : (
                <iframe srcDoc={detalleHtml} className="w-full h-96 bg-white" sandbox="" />
              )}
            </div>

            <div className="border border-gray-200 rounded-lg overflow-hidden">
              <div className="bg-gray-50 px-3 py-2 text-xs font-semibold text-gray-700">Destinatarios ({detalleLogs.length})</div>
              {loadingDetalle ? (
                <div className="p-4 text-center text-sm text-gray-400">Cargando…</div>
              ) : detalleLogs.length === 0 ? (
                <div className="p-4 text-center text-sm text-gray-400">Sin logs (campaña en borrador o sin enviar).</div>
              ) : (
                <div className="overflow-x-auto max-h-72 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-gray-50 sticky top-0 text-[10px] uppercase tracking-wide text-gray-500">
                      <tr>
                        <th className="px-2 py-1.5 text-left font-semibold">Email</th>
                        <th className="px-2 py-1.5 text-left font-semibold">Nombre</th>
                        <th className="px-2 py-1.5 text-left font-semibold">Estado</th>
                        <th className="px-2 py-1.5 text-left font-semibold">Envío</th>
                        <th className="px-2 py-1.5 text-left font-semibold">Apertura</th>
                        <th className="px-2 py-1.5 text-left font-semibold">Click</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {detalleLogs.map((l, i) => (
                        <tr key={i}>
                          <td className="px-2 py-1.5 text-gray-700">{l.vet_email}</td>
                          <td className="px-2 py-1.5 text-gray-600">{l.vet_nombre}</td>
                          <td className="px-2 py-1.5"><LogEstadoBadge estado={l.estado} /></td>
                          <td className="px-2 py-1.5 text-gray-500">{formatDateTime(l.fecha_envio) || '—'}</td>
                          <td className="px-2 py-1.5 text-gray-500">{formatDateTime(l.fecha_apertura) || '—'}</td>
                          <td className="px-2 py-1.5 text-gray-500">{formatDateTime(l.fecha_click) || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="flex gap-2">
              {(detalle.estado === 'enviado' || detalle.estado === 'fallido') && (
                <button type="button" onClick={() => duplicar(detalle)} className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg py-2 text-sm font-semibold">
                  Duplicar para nueva campaña
                </button>
              )}
              <button type="button" onClick={() => setDetalle(null)} className="flex-1 border-2 border-gray-300 text-gray-700 rounded-lg py-2 text-sm font-semibold hover:bg-gray-50">
                Cerrar
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}

function EstadoBadge({ estado }: { estado: string }) {
  const styles: Record<string, string> = {
    borrador: 'bg-gray-100 text-gray-700',
    enviando: 'bg-amber-100 text-amber-800',
    enviado: 'bg-green-100 text-green-800',
    fallido: 'bg-red-100 text-red-800',
  }
  const cls = styles[estado] || 'bg-gray-100 text-gray-700'
  return <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] uppercase font-bold ${cls}`}>{estado}</span>
}

function LogEstadoBadge({ estado }: { estado: string }) {
  const styles: Record<string, string> = {
    sent: 'bg-blue-100 text-blue-800',
    delivered: 'bg-cyan-100 text-cyan-800',
    opened: 'bg-emerald-100 text-emerald-800',
    clicked: 'bg-violet-100 text-violet-800',
    bounced: 'bg-red-100 text-red-800',
    complained: 'bg-orange-100 text-orange-800',
    failed: 'bg-red-100 text-red-800',
  }
  const cls = styles[estado] || 'bg-gray-100 text-gray-700'
  return <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] uppercase font-bold ${cls}`}>{estado}</span>
}

function MetricasCampana({ detalle }: { detalle: Campana }) {
  const total = parseInt(detalle.total_destinatarios || '0', 10)
  const enviados = parseInt(detalle.enviados || '0', 10)
  const entregados = parseInt(detalle.entregados || '0', 10)
  const aperturas = parseInt(detalle.aperturas || '0', 10)
  const clicks = parseInt(detalle.clicks || '0', 10)
  const rebotes = parseInt(detalle.rebotes || '0', 10)
  const spam = parseInt(detalle.spam || '0', 10)
  const fallidos = parseInt(detalle.fallidos || '0', 10)
  const noLeidos = Math.max(0, enviados - aperturas - rebotes)

  const pct = (n: number, d: number) => d > 0 ? Math.round(100 * n / d) : null
  const tasaApertura = pct(aperturas, enviados)
  const tasaClick = pct(clicks, enviados)
  const tasaEntrega = pct(entregados, enviados)
  const tasaRebote = pct(rebotes, enviados)

  return (
    <div className="space-y-3">
      {/* Resumen alcance */}
      <div className="grid grid-cols-3 gap-2 text-xs">
        <div className="bg-gray-50 rounded-lg px-3 py-2 border border-gray-200">
          <div className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">Alcance</div>
          <div className="text-2xl font-bold text-gray-900">{enviados}<span className="text-sm text-gray-400 font-normal"> / {total}</span></div>
          <div className="text-[10px] text-gray-500">enviados de {total} seleccionados</div>
        </div>
        <div className="bg-emerald-50 rounded-lg px-3 py-2 border border-emerald-200">
          <div className="text-[10px] uppercase tracking-wider text-emerald-700 font-semibold">Leídos</div>
          <div className="text-2xl font-bold text-emerald-900">{aperturas}<span className="text-sm text-emerald-600 font-normal"> · {tasaApertura ?? '—'}%</span></div>
          <div className="text-[10px] text-emerald-700">aperturas (al menos una)</div>
        </div>
        <div className="bg-gray-50 rounded-lg px-3 py-2 border border-gray-200">
          <div className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">No leídos</div>
          <div className="text-2xl font-bold text-gray-700">{noLeidos}</div>
          <div className="text-[10px] text-gray-500">entregados sin apertura</div>
        </div>
      </div>

      {/* Barras de tasas */}
      <div className="bg-white border border-gray-200 rounded-lg px-4 py-3 space-y-2">
        <MetricBar label="Entregados" count={entregados} total={enviados} pct={tasaEntrega} color="cyan" />
        <MetricBar label="Aperturas (leídos)" count={aperturas} total={enviados} pct={tasaApertura} color="emerald" />
        <MetricBar label="Clicks" count={clicks} total={enviados} pct={tasaClick} color="violet" />
        <MetricBar label="Rebotes" count={rebotes} total={enviados} pct={tasaRebote} color="red" />
      </div>

      {/* Counts secundarios */}
      <div className="grid grid-cols-3 gap-2 text-xs">
        <DetMetric label="Marcados como spam" value={String(spam)} />
        <DetMetric label="Fallaron al enviar" value={String(fallidos)} />
        <DetMetric label="Estado" value={detalle.estado} />
      </div>
    </div>
  )
}

function MetricBar({ label, count, total, pct, color }: {
  label: string; count: number; total: number; pct: number | null
  color: 'cyan' | 'emerald' | 'violet' | 'red'
}) {
  const bg: Record<string, string> = { cyan: 'bg-cyan-500', emerald: 'bg-emerald-500', violet: 'bg-violet-500', red: 'bg-red-500' }
  const text: Record<string, string> = { cyan: 'text-cyan-700', emerald: 'text-emerald-700', violet: 'text-violet-700', red: 'text-red-700' }
  const percentNum = pct ?? 0
  return (
    <div>
      <div className="flex justify-between items-baseline text-xs mb-1">
        <span className="font-medium text-gray-700">{label}</span>
        <span className={`font-bold ${text[color]}`}>
          {count} <span className="text-gray-400 font-normal">/ {total}</span>
          {pct !== null && <span className="ml-2 text-gray-500 font-normal">({pct}%)</span>}
        </span>
      </div>
      <div className="w-full bg-gray-100 rounded-full h-2">
        <div className={`${bg[color]} h-2 rounded-full transition-all`} style={{ width: `${Math.min(100, percentNum)}%` }} />
      </div>
    </div>
  )
}

function DetMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-gray-50 rounded-lg px-2 py-1.5 border border-gray-200">
      <div className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">{label}</div>
      <div className="text-base font-bold text-gray-900">{value}</div>
    </div>
  )
}

// ===================== NUEVA CAMPAÑA =====================

const VARIABLES = [
  { key: 'nombre', desc: 'Nombre completo' },
  { key: 'primer_nombre', desc: 'Primer nombre (María José → María)' },
  { key: 'email', desc: 'Email del destinatario' },
  { key: 'veterinaria', desc: 'Clínica veterinaria' },
  { key: 'comuna', desc: 'Comuna' },
  { key: 'telefono', desc: 'Teléfono' },
  { key: 'categoria', desc: 'Categoría' },
] as const

const NUEVA_EMPTY: Exclude<Prefilled, null> = {
  asunto: '', html: '', preview_text: '', reply_to: '', categoria: 'todos',
}

function NuevaCampanaPanel({ initial, onCreada }: {
  initial: Prefilled
  onCreada: () => void
}) {
  const [form, setForm] = useState(initial ?? NUEVA_EMPTY)
  const [previewHtml, setPreviewHtml] = useState('')
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [savingDraft, setSavingDraft] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [testOpen, setTestOpen] = useState(false)
  const [testEmail, setTestEmail] = useState('')
  const [testSending, setTestSending] = useState(false)
  const [draftId, setDraftId] = useState<string | null>(null)
  const [vets, setVets] = useState<Vet[]>([])
  const [borradores, setBorradores] = useState<Campana[]>([])
  const [loadingBorrador, setLoadingBorrador] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const fetchBorradores = useCallback(async () => {
    try {
      const r = await fetch('/api/mailing/campanas', { cache: 'no-store' })
      const d = await r.json()
      setBorradores(Array.isArray(d) ? d.filter((c: Campana) => c.estado === 'borrador') : [])
    } catch {}
  }, [])

  useEffect(() => {
    fetch('/api/mailing/veterinarios').then(r => r.json()).then(d => {
      setVets(Array.isArray(d) ? d : [])
    })
    fetchBorradores()
  }, [fetchBorradores])

  async function cargarBorrador(c: Campana) {
    setLoadingBorrador(c.id)
    setError(''); setInfo('')
    try {
      const j = await fetch(`/api/mailing/campanas/${c.id}/html`).then(r => r.json())
      const filtros = c.filtros_json ? JSON.parse(c.filtros_json) : {}
      setForm({
        asunto: c.asunto,
        html: typeof j?.html === 'string' ? j.html : '',
        preview_text: c.preview_text,
        reply_to: c.reply_to,
        categoria: filtros.categoria || 'todos',
      })
      setDraftId(c.id)
      setInfo(`Borrador #${c.id} cargado`)
    } catch {
      setError('No se pudo cargar el borrador')
    }
    setLoadingBorrador(null)
  }

  async function eliminarBorrador(c: Campana, e: React.MouseEvent) {
    e.stopPropagation()
    if (!confirm(`¿Eliminar el borrador "${c.asunto}"?`)) return
    const res = await fetch(`/api/mailing/campanas/${c.id}`, { method: 'DELETE' })
    if (res.ok) {
      if (draftId === c.id) {
        setForm(NUEVA_EMPTY)
        setDraftId(null)
      }
      await fetchBorradores()
    } else {
      alert('Error al eliminar')
    }
  }

  useEffect(() => {
    setForm(initial ?? NUEVA_EMPTY)
    setDraftId(null)
    setError('')
    setInfo('')
  }, [initial])

  // Preview con vet de muestra
  useEffect(() => {
    const sample = vets.find(v => v.suscrito === 'TRUE') || vets[0]
    const vars: Record<string, string> = sample ? {
      nombre: sample.nombre, email: sample.email,
      primer_nombre: (sample.nombre || '').split(/\s+/)[0] || '',
      veterinaria: sample.veterinaria, comuna: sample.comuna,
      telefono: sample.telefono, categoria: sample.categoria,
    } : {
      nombre: 'Dr. Ejemplo', primer_nombre: 'Dr.', email: 'demo@vet.cl',
      veterinaria: 'Clínica Demo', comuna: 'Santiago', telefono: '+56912345678', categoria: 'prospecto',
    }
    const rendered = form.html.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => vars[k] ?? `{{${k}}}`)
    setPreviewHtml(rendered)
  }, [form.html, vets])

  const destinatariosCount = useMemo(() => {
    return vets.filter(v => {
      if (v.suscrito !== 'TRUE') return false
      if (form.categoria !== 'todos' && v.categoria !== form.categoria) return false
      return true
    }).length
  }, [vets, form.categoria])

  async function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const text = await file.text()
    setForm(f => ({ ...f, html: text }))
    if (fileRef.current) fileRef.current.value = ''
  }

  async function guardarBorrador(): Promise<string | null> {
    setError(''); setInfo(''); setSavingDraft(true)
    try {
      if (draftId) {
        const res = await fetch(`/api/mailing/campanas/${draftId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            asunto: form.asunto, html: form.html, preview_text: form.preview_text,
            reply_to: form.reply_to, filtros: { categoria: form.categoria },
          }),
        })
        if (!res.ok) {
          const j = await res.json().catch(() => ({}))
          setError(j.error || `Error ${res.status}`)
          return null
        }
        setInfo('Borrador actualizado')
        await fetchBorradores()
        return draftId
      } else {
        const res = await fetch(`/api/mailing/campanas`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            asunto: form.asunto, html: form.html, preview_text: form.preview_text,
            reply_to: form.reply_to, filtros: { categoria: form.categoria },
          }),
        })
        const j = await res.json().catch(() => ({}))
        if (!res.ok) { setError(j.error || `Error ${res.status}`); return null }
        setDraftId(j.id)
        setInfo('Borrador guardado')
        await fetchBorradores()
        return j.id
      }
    } finally {
      setSavingDraft(false)
    }
  }

  function nuevaCampana() {
    setForm(NUEVA_EMPTY)
    setDraftId(null)
    setError('')
    setInfo('')
  }

  async function enviarTest() {
    setError('')
    const id = draftId || await guardarBorrador()
    if (!id) return
    setTestEmail('')
    setTestOpen(true)
  }

  async function confirmarTest() {
    if (!testEmail.trim()) { setError('Falta email de prueba'); return }
    setTestSending(true)
    setError('')
    const id = draftId
    if (!id) { setTestSending(false); return }
    const res = await fetch(`/api/mailing/campanas/${id}/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: testEmail }),
    })
    const j = await res.json().catch(() => ({}))
    setTestSending(false)
    if (res.ok) {
      setTestOpen(false)
      setInfo(`Test enviado a ${testEmail}`)
    } else {
      setError(j.error || `Error ${res.status}`)
    }
  }

  async function enviarCampana() {
    setError('')
    const filtroDesc = form.categoria === 'todos' ? 'TODAS las categorías' : `solo "${form.categoria}s"`
    const confirmacion = `Vas a enviar:\n\n` +
      `• Asunto: "${form.asunto}"\n` +
      `• Destinatarios: ${destinatariosCount} (${filtroDesc}, suscritos)\n\n` +
      `¿Confirmás el envío?`
    if (!confirm(confirmacion)) return
    // SIEMPRE actualizar el borrador con el form actual antes de enviar.
    // Si el usuario cambió el filtro o el HTML sin guardar, esto asegura que
    // el envío use lo que ve en pantalla, no el draft viejo.
    const id = await guardarBorrador()
    if (!id) return
    setEnviando(true)
    const res = await fetch(`/api/mailing/campanas/${id}/enviar`, { method: 'POST' })
    const j = await res.json().catch(() => ({}))
    setEnviando(false)
    if (res.ok) {
      alert(`Campaña enviada: ${j.enviados} OK, ${j.fallidos} fallidos`)
      onCreada()
    } else {
      setError(j.error || `Error ${res.status}`)
    }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <div className="lg:col-span-2 bg-white rounded-xl shadow-sm border border-gray-200 p-5 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-base font-bold text-gray-900">{draftId ? `Editando borrador N° ${draftId}` : 'Nueva campaña'}</h2>
          {draftId && (
            <button type="button" onClick={nuevaCampana}
              className="inline-flex items-center gap-1 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg px-3 py-1.5 shadow-sm transition-colors">
              <span>+</span> Empezar campaña nueva
            </button>
          )}
        </div>

        <Field label="Asunto *" value={form.asunto} onChange={v => setForm(f => ({ ...f, asunto: v }))} required />
        <Field label="Preview text (texto que aparece junto al asunto en el inbox)" value={form.preview_text} onChange={v => setForm(f => ({ ...f, preview_text: v }))} />
        <Field label="Reply-to (opcional)" value={form.reply_to} onChange={v => setForm(f => ({ ...f, reply_to: v }))} type="email" />

        <div>
          <label className="text-xs font-semibold text-gray-700">Destinatarios</label>
          <div className="mt-1 flex items-center gap-3">
            <select value={form.categoria} onChange={e => setForm(f => ({ ...f, categoria: e.target.value }))}
              className="border-2 border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
              <option value="todos">Todas las categorías</option>
              {CATEGORIAS.map(c => <option key={c} value={c}>Solo {c}s</option>)}
            </select>
            <span className="text-sm text-gray-600">
              <span className="font-semibold text-indigo-700">{destinatariosCount}</span> destinatario{destinatariosCount === 1 ? '' : 's'} suscrito{destinatariosCount === 1 ? '' : 's'} matchea{destinatariosCount === 1 ? '' : 'n'} este filtro.
            </span>
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-xs font-semibold text-gray-700">HTML del email *</label>
            <button type="button" onClick={() => fileRef.current?.click()}
              className="inline-flex items-center gap-1 border-2 border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 text-xs font-semibold rounded-lg px-2.5 py-1 transition-colors">
              📁 Cargar desde archivo (.html)
            </button>
            <input ref={fileRef} type="file" accept=".html,text/html" onChange={onFileChange} className="hidden" />
          </div>
          <textarea value={form.html} onChange={e => setForm(f => ({ ...f, html: e.target.value }))}
            rows={14}
            placeholder="<html><body>Hola {{primer_nombre}}, …</body></html>"
            className="w-full font-mono text-xs border-2 border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          <p className="text-[11px] text-gray-500 mt-1">
            Variables disponibles: {VARIABLES.map(v => <code key={v.key} className="text-[10px] bg-gray-100 px-1 py-0.5 rounded mr-1">{`{{${v.key}}}`}</code>)}
          </p>
        </div>

        {error && <div className="bg-red-50 border border-red-200 text-red-800 rounded-lg px-3 py-2 text-sm">{error}</div>}
        {info && <div className="bg-green-50 border border-green-200 text-green-800 rounded-lg px-3 py-2 text-sm">{info}</div>}

        <div className="flex gap-2 pt-2 flex-wrap">
          <button type="button" onClick={guardarBorrador} disabled={savingDraft || !form.asunto.trim() || !form.html.trim()}
            className="border-2 border-gray-300 text-gray-700 rounded-lg px-4 py-2 text-sm font-semibold hover:bg-gray-50 disabled:opacity-50">
            {savingDraft ? 'Guardando…' : (draftId ? 'Actualizar borrador' : 'Guardar borrador')}
          </button>
          <button type="button" onClick={enviarTest} disabled={savingDraft || !form.asunto.trim() || !form.html.trim()}
            className="bg-amber-500 hover:bg-amber-600 text-white rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50">
            Enviar test
          </button>
          <button type="button" onClick={enviarCampana} disabled={enviando || destinatariosCount === 0 || !form.asunto.trim() || !form.html.trim()}
            className="ml-auto bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50">
            {enviando ? `Enviando…` : `Enviar a ${destinatariosCount}`}
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-3">
        <div className="text-xs font-semibold text-gray-700 mb-2">Preview (con vet de muestra)</div>
        <div className="flex h-[760px] gap-0">
          <div className="w-14 shrink-0 flex flex-col items-center pt-3 pb-3 select-none">
            <span className="text-2xl text-amber-500 leading-none" aria-hidden="true">🐾</span>
            <span className="text-2xl text-amber-500 leading-none mt-0.5" aria-hidden="true">🐾</span>
            <div className="flex-1 w-0 border-l-2 border-dashed border-amber-300 mt-3 self-center"></div>
          </div>
          <iframe
            srcDoc={previewHtml || '<p style="font-family:sans-serif;color:#999;padding:1rem">Escribí HTML para ver el preview.</p>'}
            className="flex-1 h-full border border-gray-200 rounded bg-white"
            sandbox=""
          />
        </div>
      </div>

      {borradores.length > 0 && (
        <div className="lg:col-span-3 bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-900">Borradores guardados ({borradores.length})</h3>
            <span className="text-xs text-gray-500">Click en una fila para cargar y editar</span>
          </div>
          <ul className="divide-y divide-gray-100">
            {borradores.map(b => {
              const isActive = draftId === b.id
              return (
                <li key={b.id}
                  onClick={() => !isActive && cargarBorrador(b)}
                  className={`px-4 py-2.5 flex items-center gap-3 ${isActive ? 'bg-indigo-50' : 'hover:bg-gray-50 cursor-pointer'}`}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm text-gray-900 truncate">{b.asunto || '(sin asunto)'}</span>
                      <span className="text-[10px] uppercase font-bold bg-gray-100 text-gray-700 rounded px-1.5 py-0.5">N° {b.id}</span>
                      {isActive && <span className="text-[10px] uppercase font-bold bg-indigo-600 text-white rounded px-1.5 py-0.5">Editando</span>}
                    </div>
                    {b.preview_text && <div className="text-xs text-gray-500 truncate mt-0.5">{b.preview_text}</div>}
                    <div className="text-[10px] text-gray-400 mt-0.5">
                      Creado: {formatDate(b.fecha_creacion) || '—'}
                      {b.creado_por && ` · ${b.creado_por}`}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {!isActive && (
                      <button
                        type="button"
                        onClick={e => { e.stopPropagation(); cargarBorrador(b) }}
                        disabled={loadingBorrador === b.id}
                        className="bg-indigo-500 hover:bg-indigo-600 text-white px-2.5 py-1 rounded text-xs font-medium disabled:opacity-50"
                      >
                        {loadingBorrador === b.id ? 'Cargando…' : 'Cargar'}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={e => eliminarBorrador(b, e)}
                      className="bg-red-500 hover:bg-red-600 text-white px-2.5 py-1 rounded text-xs font-medium"
                    >
                      Eliminar
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      <Modal open={testOpen} onClose={() => setTestOpen(false)} title="Enviar email de prueba">
        <div className="space-y-3">
          <p className="text-sm text-gray-600">Se envía un mail con el asunto prefijado con [TEST], usando un veterinario de muestra para sustituir las variables.</p>
          <Field label="Enviar a" value={testEmail} onChange={setTestEmail} type="email" required />
          {error && <div className="bg-red-50 border border-red-200 text-red-800 rounded-lg px-3 py-2 text-sm">{error}</div>}
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={() => setTestOpen(false)} className="flex-1 border-2 border-gray-300 text-gray-700 rounded-lg py-2 text-sm font-semibold hover:bg-gray-50">Cancelar</button>
            <button type="button" onClick={confirmarTest} disabled={testSending}
              className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg py-2 text-sm font-semibold disabled:opacity-50">
              {testSending ? 'Enviando…' : 'Enviar test'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
