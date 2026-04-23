'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import { useSession } from 'next-auth/react'
import { Toggle } from '@/components/ui/Toggle'
import { Modal } from '@/components/ui/Modal'
import { Badge } from '@/components/ui/Badge'
import { fmtPrecio, fmtNumero } from '@/lib/format'

const TABS = ['Precios', 'Productos', 'Especies', 'Tipos servicio', 'Otros servicios', 'Usuarios'] as const
type Tab = typeof TABS[number]
type PrecioSubTab = 'general' | 'convenio' | 'especial'

type Producto = { id: string; nombre: string; precio: string; foto_url: string; stock: string; activo: string }
type Tramo = { id: string; peso_min: string; peso_max: string; precio_ci: string; precio_cp: string; precio_sd: string; veterinaria_id?: string }
type Especie = { id: string; nombre: string; letra: string; activo: string }
type TipoServicio = { id: string; nombre: string; codigo: string; activo: string }
type OtroServicio = { id: string; nombre: string; precio: string; activo: string }
type Vet = { id: string; nombre: string; activo: string; tipo_precios: string }
type Usuario = { id: string; nombre: string; email: string; rol: string; activo: string }

export default function ConfiguracionPage() {
  const { data: session, status } = useSession()
  const isAdmin = status === 'authenticated' && (session?.user?.role === 'admin' || session?.user?.role === undefined)

  const [tab, setTab] = useState<Tab>('Precios')
  const [precioTab, setPrecioTab] = useState<PrecioSubTab>('general')

  const [productos, setProductos] = useState<Producto[]>([])
  const [preciosG, setPreciosG] = useState<Tramo[]>([])
  const [preciosC, setPreciosC] = useState<Tramo[]>([])
  const [preciosE, setPreciosE] = useState<Tramo[]>([])
  const [especies, setEspecies] = useState<Especie[]>([])
  const [tiposServicio, setTiposServicio] = useState<TipoServicio[]>([])
  const [otros, setOtros] = useState<OtroServicio[]>([])
  const [vets, setVets] = useState<Vet[]>([])
  const [usuarios, setUsuarios] = useState<Usuario[]>([])

  // Modals
  const [showProdModal, setShowProdModal] = useState(false)
  const [editingProducto, setEditingProducto] = useState<Producto | null>(null)
  const [showStockModal, setShowStockModal] = useState<Producto | null>(null)
  const [showEspecieModal, setShowEspecieModal] = useState(false)
  const [editingEspecie, setEditingEspecie] = useState<Especie | null>(null)
  const [showTipoServicioModal, setShowTipoServicioModal] = useState(false)
  const [editingTipoServicio, setEditingTipoServicio] = useState<TipoServicio | null>(null)
  const [tipoServicioForm, setTipoServicioForm] = useState({ nombre: '', codigo: '' })
  const [showOtroModal, setShowOtroModal] = useState(false)
  const [editingOtro, setEditingOtro] = useState<OtroServicio | null>(null)
  const [showTramoModal, setShowTramoModal] = useState<{ tipo: PrecioSubTab } | null>(null)
  const [showEspecialModal, setShowEspecialModal] = useState(false)
  const [editingEspecial, setEditingEspecial] = useState<Tramo | null>(null)
  const [showUsuarioModal, setShowUsuarioModal] = useState(false)
  const [editingUsuario, setEditingUsuario] = useState<Usuario | null>(null)
  const [mostrarPassword, setMostrarPassword] = useState(false)

  const [prodForm, setProdForm] = useState({ nombre: '', precio: '', foto_url: '' })
  const [stockDelta, setStockDelta] = useState('')
  const [especieForm, setEspecieForm] = useState({ nombre: '', letra: '' })
  const [otroForm, setOtroForm] = useState({ nombre: '', precio: '' })
  const [tramoForm, setTramoForm] = useState({ peso_min: '', peso_max: '', precio_ci: '', precio_cp: '', precio_sd: '' })
  const [especialForm, setEspecialForm] = useState({ veterinaria_id: '', peso_min: '', peso_max: '', precio_ci: '', precio_cp: '', precio_sd: '' })
  const [especialVetFiltro, setEspecialVetFiltro] = useState('')
  const [usuarioForm, setUsuarioForm] = useState({ nombre: '', email: '', password: '', rol: 'operador' })
  const [uploadingFoto, setUploadingFoto] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const fetchAll = useCallback(async () => {
    const [p, pg, pc, pe, e, ts, os, v, u] = await Promise.all([
      fetch('/api/productos').then(r => r.json()),
      fetch('/api/precios?tipo=general').then(r => r.json()),
      fetch('/api/precios?tipo=convenio').then(r => r.json()),
      fetch('/api/precios/especiales').then(r => r.json()),
      fetch('/api/especies').then(r => r.json()),
      fetch('/api/servicios').then(r => r.json()),
      fetch('/api/servicios?tipo=otros').then(r => r.json()),
      fetch('/api/veterinarios').then(r => r.json()),
      fetch('/api/usuarios').then(r => r.json()),
    ])
    setProductos(Array.isArray(p) ? p : [])
    setPreciosG(Array.isArray(pg) ? pg : [])
    setPreciosC(Array.isArray(pc) ? pc : [])
    setPreciosE(Array.isArray(pe) ? pe : [])
    setEspecies(Array.isArray(e) ? e : [])
    setTiposServicio(Array.isArray(ts) ? ts : [])
    setOtros(Array.isArray(os) ? os : [])
    setVets(Array.isArray(v) ? v : [])
    setUsuarios(Array.isArray(u) ? u : [])
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll])

  const patch = async (url: string, body: object) => {
    const res = await fetch(url, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    if (!res.ok) { const err = await res.json().catch(() => ({})); alert(`Error al actualizar: ${err.error ?? res.status}`); return }
    await fetchAll()
  }
  const post = async (url: string, body: object) => {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    if (!res.ok) { const err = await res.json().catch(() => ({})); alert(`Error al guardar: ${err.error ?? res.status}`); return }
    await fetchAll()
  }
  const del = async (url: string) => {
    const res = await fetch(url, { method: 'DELETE' })
    if (!res.ok) { const err = await res.json().catch(() => ({})); alert(`Error al eliminar: ${err.error ?? res.status}`); return }
    await fetchAll()
  }
  const reorder = async (tipo: PrecioSubTab, id: string, direction: 'up' | 'down') => {
    await fetch(`/api/precios/reorder?tipo=${tipo}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, direction }),
    })
    await fetchAll()
  }
  const normalizarIds = async () => {
    if (!confirm('¿Renumerar IDs de todos los tramos (general, convenio y especiales)? Los IDs quedarán secuenciales 1, 2, 3...')) return
    const res = await fetch('/api/precios/normalizar-ids', { method: 'POST' })
    const data = await res.json()
    if (data.ok) {
      alert('IDs normalizados correctamente.')
      await fetchAll()
    } else {
      alert('Error: ' + (data.error ?? 'desconocido'))
    }
  }

  async function uploadFoto(file: File): Promise<string> {
    const fd = new FormData()
    fd.append('file', file)
    const res = await fetch('/api/upload', { method: 'POST', body: fd })
    const data = await res.json()
    return data.url ?? ''
  }

  if (status === 'loading') return <div className="p-8 text-gray-400 text-sm">Cargando...</div>
  if (!isAdmin) return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <p className="text-4xl mb-4">🔒</p>
      <h2 className="text-xl font-bold text-gray-900 mb-2">Acceso restringido</h2>
      <p className="text-gray-500 text-sm">Solo administradores.</p>
    </div>
  )

  const tramosActivos = precioTab === 'general' ? preciosG : precioTab === 'convenio' ? preciosC : []
  const maxPesoMinActivos = tramosActivos.length ? Math.max(...tramosActivos.map(t => parseFloat(t.peso_min) || 0)) : 0
  const filteredEspeciales = especialVetFiltro ? preciosE.filter(pe => pe.veterinaria_id === especialVetFiltro) : preciosE

  return (
    <div className="max-w-5xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Configuración</h1>
        <p className="text-gray-500 text-sm mt-0.5">Precios, productos y catálogos</p>
      </div>

      {/* Tabs principales */}
      <div className="flex gap-1 mb-6 bg-gray-100 p-1 rounded-xl overflow-x-auto">
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${tab === t ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>
            {t}
          </button>
        ))}
      </div>

      {/* ─── PRECIOS ─── */}
      {tab === 'Precios' && (
        <div className="space-y-4">
          {/* Sub-tabs */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex gap-2">
              {(['general', 'convenio', 'especial'] as PrecioSubTab[]).map(st => (
                <button key={st} onClick={() => setPrecioTab(st)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors capitalize ${precioTab === st ? 'bg-indigo-600 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
                  {st === 'general' ? 'Precio general' : st === 'convenio' ? 'Precio convenio' : 'Convenios especiales'}
                </button>
              ))}
            </div>
            <button onClick={normalizarIds} title="Renumera IDs duplicados en las hojas de precios"
              className="text-xs text-gray-500 hover:text-indigo-600 underline">
              Normalizar IDs
            </button>
          </div>

          {/* General y Convenio */}
          {(precioTab === 'general' || precioTab === 'convenio') && (
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
              <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
                <div>
                  <h2 className="font-semibold text-gray-900">{precioTab === 'general' ? 'Precios generales' : 'Precios convenio'}</h2>
                  <p className="text-xs text-gray-400 mt-0.5">Clic en celda para editar · Último tramo = "X kg o más"</p>
                </div>
                <button onClick={() => { setTramoForm({ peso_min: '', peso_max: '', precio_ci: '', precio_cp: '', precio_sd: '' }); setShowTramoModal({ tipo: precioTab }) }}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded-lg text-xs font-medium transition-colors">
                  + Agregar tramo
                </button>
              </div>
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500">Rango de peso</th>
                    {['CI', 'CP', 'SD'].map(h => <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-gray-500">{h}</th>)}
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {tramosActivos.map((t, idx) => (
                    <TramoRow key={`${t.id}-${idx}`} tramo={t}
                      isLast={(parseFloat(t.peso_min) || 0) === maxPesoMinActivos}
                      tipo={precioTab}
                      canMoveUp={idx > 0} canMoveDown={idx < tramosActivos.length - 1}
                      onMoveUp={() => reorder(precioTab, t.id, 'up')}
                      onMoveDown={() => reorder(precioTab, t.id, 'down')}
                      onDelete={() => { if (confirm('¿Eliminar este tramo?')) del(`/api/precios?tipo=${precioTab}&id=${t.id}`) }}
                      onUpdate={fetchAll} isAdmin={isAdmin} />
                  ))}
                  {tramosActivos.length === 0 && (
                    <tr><td colSpan={5} className="px-4 py-6 text-center text-xs text-gray-400">Sin tramos configurados</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* Especiales */}
          {precioTab === 'especial' && (
            <div className="space-y-4">
              <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h2 className="font-semibold text-gray-900">Convenios especiales por veterinaria</h2>
                    <p className="text-xs text-gray-400 mt-0.5">Tarifas personalizadas asignadas a una veterinaria</p>
                  </div>
                  <button onClick={() => { setEditingEspecial(null); setEspecialForm({ veterinaria_id: '', peso_min: '', peso_max: '', precio_ci: '', precio_cp: '', precio_sd: '' }); setShowEspecialModal(true) }}
                    className="bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded-lg text-xs font-medium transition-colors">
                    + Nuevo convenio
                  </button>
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-700">Filtrar por veterinaria</label>
                  <select value={especialVetFiltro} onChange={e => setEspecialVetFiltro(e.target.value)}
                    className="mt-1 block border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                    <option value="">Todas</option>
                    {vets.filter(v => v.activo === 'TRUE').map(v => (
                      <option key={v.id} value={v.id}>{v.nombre}</option>
                    ))}
                  </select>
                </div>
              </div>

              {Object.entries(
                filteredEspeciales.reduce<Record<string, Tramo[]>>((acc, pe) => {
                  const vid = pe.veterinaria_id ?? ''
                  if (!acc[vid]) acc[vid] = []
                  acc[vid].push(pe)
                  return acc
                }, {})
              ).map(([vetId, tramos]) => {
                const vet = vets.find(v => v.id === vetId)
                const maxPesoMin = tramos.length ? Math.max(...tramos.map(t => parseFloat(t.peso_min) || 0)) : 0
                return (
                  <div key={vetId} className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                    <div className="px-6 py-3 border-b border-gray-100 bg-gray-50 flex items-center justify-between">
                      <p className="font-semibold text-gray-900 text-sm">{vet?.nombre ?? `Veterinaria #${vetId}`}</p>
                      <button onClick={() => { setEditingEspecial(null); setEspecialForm({ veterinaria_id: vetId, peso_min: '', peso_max: '', precio_ci: '', precio_cp: '', precio_sd: '' }); setShowEspecialModal(true) }}
                        className="text-indigo-600 hover:text-indigo-800 text-xs font-medium">+ Tramo</button>
                    </div>
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500">Rango</th>
                          {['CI', 'CP', 'SD'].map(h => <th key={h} className="text-left px-4 py-2 text-xs font-semibold text-gray-500">{h}</th>)}
                          <th className="px-4 py-2"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {tramos.map((t, idx) => (
                          <TramoRow key={`${t.id}-${idx}`} tramo={t}
                            isLast={(parseFloat(t.peso_min) || 0) === maxPesoMin}
                            tipo="especial"
                            canMoveUp={idx > 0} canMoveDown={idx < tramos.length - 1}
                            onMoveUp={() => reorder('especial', t.id, 'up')}
                            onMoveDown={() => reorder('especial', t.id, 'down')}
                            onEdit={() => { setEditingEspecial(t); setEspecialForm({ veterinaria_id: t.veterinaria_id ?? '', peso_min: t.peso_min, peso_max: t.peso_max, precio_ci: t.precio_ci, precio_cp: t.precio_cp, precio_sd: t.precio_sd }); setShowEspecialModal(true) }}
                            onDelete={() => { if (confirm('¿Eliminar este tramo?')) del(`/api/precios/especiales?id=${t.id}`) }}
                            onUpdate={fetchAll} isAdmin={isAdmin} />
                        ))}
                      </tbody>
                    </table>
                  </div>
                )
              })}
              {filteredEspeciales.length === 0 && (
                <div className="bg-white rounded-xl border border-gray-100 p-8 text-center text-gray-400 text-sm">Sin convenios especiales</div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ─── PRODUCTOS ─── */}
      {tab === 'Productos' && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
            <h2 className="font-semibold text-gray-900">Productos adicionales</h2>
            <button onClick={() => { setEditingProducto(null); setProdForm({ nombre: '', precio: '', foto_url: '' }); setShowProdModal(true) }}
              className="bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded-lg text-xs font-medium transition-colors">+ Agregar</button>
          </div>
          <div className="divide-y divide-gray-100">
            {productos.map(p => {
              const stockNum = parseInt(p.stock || '0')
              return (
                <div key={p.id} className="flex items-center gap-4 px-6 py-4">
                  {p.foto_url
                    ? <img src={p.foto_url} alt={p.nombre} className="w-12 h-12 object-cover rounded-lg border border-gray-100" />
                    : <div className="w-12 h-12 bg-gray-50 rounded-lg border border-gray-100 flex items-center justify-center text-gray-300 text-xl">📦</div>
                  }
                  <div className="flex-1">
                    <p className="text-sm font-medium text-gray-900">{p.nombre}</p>
                    <p className="text-xs text-gray-500">{fmtPrecio(p.precio)}</p>
                  </div>
                  <div className="text-right mr-4">
                    <p className={`text-sm font-bold ${stockNum < 50 ? 'text-red-600' : 'text-gray-700'}`}>{fmtNumero(stockNum)}</p>
                    <p className="text-xs text-gray-400">en stock{stockNum < 50 && <span className="text-red-500 ml-1">⚠</span>}</p>
                  </div>
                  <button onClick={() => setShowStockModal(p)} className="bg-indigo-500 hover:bg-indigo-600 text-white px-3 py-1 rounded-md text-xs font-medium transition-colors mr-2">+ Unidades</button>
                  <Toggle checked={p.activo === 'TRUE'} onChange={val => patch('/api/productos', { id: p.id, activo: val ? 'TRUE' : 'FALSE' })} />
                  <div className="flex items-center gap-2 ml-3">
                    <button
                      onClick={() => { setEditingProducto(p); setProdForm({ nombre: p.nombre, precio: p.precio, foto_url: p.foto_url }); setShowProdModal(true) }}
                      className="bg-emerald-500 hover:bg-emerald-600 text-white px-3 py-1 rounded-md text-xs font-medium transition-colors">Editar</button>
                    {isAdmin && (
                      <button
                        onClick={() => { if (confirm(`¿Eliminar "${p.nombre}"?`)) del(`/api/productos?id=${p.id}`) }}
                        className="bg-red-500 hover:bg-red-600 text-white px-3 py-1 rounded-md text-xs font-medium transition-colors">Eliminar</button>
                    )}
                  </div>
                </div>
              )
            })}
            {productos.length === 0 && (
              <div className="px-6 py-8 text-center text-sm text-gray-400">Sin productos registrados</div>
            )}
          </div>
        </div>
      )}

      {/* ─── ESPECIES ─── */}
      {tab === 'Especies' && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
            <h2 className="font-semibold text-gray-900">Especies</h2>
            <button onClick={() => { setEditingEspecie(null); setEspecieForm({ nombre: '', letra: '' }); setShowEspecieModal(true) }}
              className="bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded-lg text-xs font-medium transition-colors">+ Agregar</button>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-gray-50"><tr>{['Nombre', 'Letra', 'Estado', ''].map(h => <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-gray-500">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-gray-100">
              {especies.map(e => (
                <tr key={e.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">{e.nombre}</td>
                  <td className="px-4 py-3"><span className="font-mono font-bold text-indigo-700">{e.letra}</span></td>
                  <td className="px-4 py-3"><Toggle checked={e.activo === 'TRUE'} onChange={val => patch('/api/especies', { id: e.id, activo: val ? 'TRUE' : 'FALSE' })} /></td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => { setEditingEspecie(e); setEspecieForm({ nombre: e.nombre, letra: e.letra }); setShowEspecieModal(true) }}
                        className="bg-emerald-500 hover:bg-emerald-600 text-white px-3 py-1 rounded-md text-xs font-medium transition-colors">Editar</button>
                      {isAdmin && (
                        <button
                          onClick={() => { if (confirm(`¿Eliminar "${e.nombre}"?`)) del(`/api/especies?id=${e.id}`) }}
                          className="bg-red-500 hover:bg-red-600 text-white px-3 py-1 rounded-md text-xs font-medium transition-colors">Eliminar</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {especies.length === 0 && (
                <tr><td colSpan={4} className="px-4 py-8 text-center text-sm text-gray-400">Sin especies registradas</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* ─── TIPOS SERVICIO ─── */}
      {tab === 'Tipos servicio' && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
            <h2 className="font-semibold text-gray-900">Tipos de servicio</h2>
            <button onClick={() => { setEditingTipoServicio(null); setTipoServicioForm({ nombre: '', codigo: '' }); setShowTipoServicioModal(true) }}
              className="bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded-lg text-xs font-medium transition-colors">+ Agregar</button>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-gray-50"><tr>{['Nombre', 'Código', 'Estado', ''].map(h => <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-gray-500">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-gray-100">
              {tiposServicio.map(t => (
                <tr key={t.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">{t.nombre}</td>
                  <td className="px-4 py-3"><span className="font-mono font-semibold text-gray-700">{t.codigo}</span></td>
                  <td className="px-4 py-3"><Toggle checked={t.activo === 'TRUE'} onChange={val => patch('/api/servicios', { id: t.id, activo: val ? 'TRUE' : 'FALSE' })} /></td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => { setEditingTipoServicio(t); setTipoServicioForm({ nombre: t.nombre, codigo: t.codigo }); setShowTipoServicioModal(true) }}
                        className="bg-emerald-500 hover:bg-emerald-600 text-white px-3 py-1 rounded-md text-xs font-medium transition-colors">Editar</button>
                      {isAdmin && (
                        <button
                          onClick={() => { if (confirm(`¿Eliminar "${t.nombre}"?`)) del(`/api/servicios?id=${t.id}`) }}
                          className="bg-red-500 hover:bg-red-600 text-white px-3 py-1 rounded-md text-xs font-medium transition-colors">Eliminar</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {tiposServicio.length === 0 && (
                <tr><td colSpan={4} className="px-4 py-8 text-center text-sm text-gray-400">Sin tipos de servicio</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* ─── OTROS SERVICIOS ─── */}
      {tab === 'Otros servicios' && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
            <h2 className="font-semibold text-gray-900">Otros servicios</h2>
            <button onClick={() => { setEditingOtro(null); setOtroForm({ nombre: '', precio: '' }); setShowOtroModal(true) }}
              className="bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded-lg text-xs font-medium transition-colors">+ Agregar</button>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-gray-50"><tr>{['Nombre', 'Precio', 'Estado', ''].map(h => <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-gray-500">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-gray-100">
              {otros.map(o => (
                <tr key={o.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">{o.nombre}</td>
                  <td className="px-4 py-3 text-gray-600">{fmtPrecio(o.precio)}</td>
                  <td className="px-4 py-3"><Toggle checked={o.activo === 'TRUE'} onChange={val => patch('/api/servicios?tipo=otros', { id: o.id, activo: val ? 'TRUE' : 'FALSE' })} /></td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => { setEditingOtro(o); setOtroForm({ nombre: o.nombre, precio: o.precio }); setShowOtroModal(true) }}
                        className="bg-emerald-500 hover:bg-emerald-600 text-white px-3 py-1 rounded-md text-xs font-medium transition-colors">Editar</button>
                      {isAdmin && (
                        <button
                          onClick={() => { if (confirm(`¿Eliminar "${o.nombre}"?`)) del(`/api/servicios?tipo=otros&id=${o.id}`) }}
                          className="bg-red-500 hover:bg-red-600 text-white px-3 py-1 rounded-md text-xs font-medium transition-colors">Eliminar</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {otros.length === 0 && (
                <tr><td colSpan={4} className="px-4 py-8 text-center text-sm text-gray-400">Sin servicios adicionales</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* ─── USUARIOS ─── */}
      {tab === 'Usuarios' && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
            <h2 className="font-semibold text-gray-900">Usuarios del sistema</h2>
            <button onClick={() => { setEditingUsuario(null); setUsuarioForm({ nombre: '', email: '', password: '', rol: 'operador' }); setShowUsuarioModal(true) }}
              className="bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded-lg text-xs font-medium transition-colors">
              + Agregar usuario
            </button>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>{['Nombre', 'Email', 'Rol', 'Estado', ''].map(h => (
                <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-gray-500">{h}</th>
              ))}</tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {(() => {
                const adminEmail = process.env.NEXT_PUBLIC_ADMIN_EMAIL ?? ''
                const adminEnRow = usuarios.find(u => u.email === adminEmail && u.rol === 'admin')
                // Si no hay admin en la hoja aún, mostrar fila informativa con opción de "inscribirlo"
                if (!adminEnRow) {
                  return (
                    <tr className="bg-indigo-50/40">
                      <td className="px-4 py-3 font-medium text-gray-900">Administrador</td>
                      <td className="px-4 py-3 text-gray-600 text-xs">{adminEmail || '(env)'}</td>
                      <td className="px-4 py-3"><Badge variant="purple">admin</Badge></td>
                      <td className="px-4 py-3"><Badge variant="green">activo</Badge></td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => { setEditingUsuario(null); setUsuarioForm({ nombre: 'Administrador', email: adminEmail, password: '', rol: 'admin' }); setShowUsuarioModal(true) }}
                          className="bg-emerald-500 hover:bg-emerald-600 text-white px-3 py-1 rounded-md text-xs font-medium transition-colors">
                          Editar
                        </button>
                      </td>
                    </tr>
                  )
                }
                return null
              })()}
              {usuarios.map(u => (
                <tr key={u.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">{u.nombre}</td>
                  <td className="px-4 py-3 text-gray-600 text-xs">{u.email}</td>
                  <td className="px-4 py-3">
                    <Badge variant={u.rol === 'admin' ? 'purple' : 'blue'}>{u.rol}</Badge>
                  </td>
                  <td className="px-4 py-3">
                    <Toggle checked={u.activo === 'TRUE'} onChange={val => patch('/api/usuarios', { id: u.id, activo: val ? 'TRUE' : 'FALSE' })} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => { setEditingUsuario(u); setUsuarioForm({ nombre: u.nombre, email: u.email, password: '', rol: u.rol }); setShowUsuarioModal(true) }}
                        className="bg-emerald-500 hover:bg-emerald-600 text-white px-3 py-1 rounded-md text-xs font-medium transition-colors">
                        Editar
                      </button>
                      <button
                        onClick={() => { if (confirm(`¿Eliminar al usuario "${u.nombre}"?`)) del(`/api/usuarios?id=${u.id}`) }}
                        className="bg-red-500 hover:bg-red-600 text-white px-3 py-1 rounded-md text-xs font-medium transition-colors">
                        Eliminar
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {usuarios.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400 text-sm">Sin usuarios registrados. Solo el admin puede iniciar sesión.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* ─── MODALES ─── */}
      <Modal open={showProdModal} onClose={() => { setShowProdModal(false); setEditingProducto(null); setProdForm({ nombre: '', precio: '', foto_url: '' }) }}
        title={editingProducto ? 'Editar producto' : 'Agregar producto'}>
        <form onSubmit={async e => {
          e.preventDefault()
          if (editingProducto) {
            await patch('/api/productos', { id: editingProducto.id, nombre: prodForm.nombre, precio: String(parseInt(prodForm.precio) || 0), foto_url: prodForm.foto_url })
          } else {
            await post('/api/productos', { nombre: prodForm.nombre, precio: parseInt(prodForm.precio), foto_url: prodForm.foto_url })
          }
          setShowProdModal(false)
          setEditingProducto(null)
          setProdForm({ nombre: '', precio: '', foto_url: '' })
        }} className="space-y-4">
          <div>
            <label className="text-xs font-medium text-gray-700">Nombre</label>
            <input required value={prodForm.nombre} onChange={e => setProdForm(f => ({ ...f, nombre: e.target.value }))} className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-700">Precio (CLP)</label>
            <input required type="number" min="0" value={prodForm.precio} onChange={e => setProdForm(f => ({ ...f, precio: e.target.value }))} className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-700">Foto</label>
            <input type="file" accept="image/*" ref={fileInputRef} className="hidden" onChange={async e => {
              const file = e.target.files?.[0]
              if (!file) return
              setUploadingFoto(true)
              const url = await uploadFoto(file)
              setProdForm(f => ({ ...f, foto_url: url }))
              setUploadingFoto(false)
            }} />
            <button type="button" onClick={() => fileInputRef.current?.click()}
              className="mt-1 flex items-center gap-2 border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-600 hover:bg-gray-50 w-full transition-colors">
              <span>📷</span>
              {uploadingFoto ? <span className="text-indigo-500">Subiendo...</span> : <span>{prodForm.foto_url ? 'Cambiar foto' : 'Seleccionar foto'}</span>}
            </button>
            {prodForm.foto_url && <img src={prodForm.foto_url} alt="preview" className="mt-2 w-20 h-20 object-cover rounded-lg" />}
          </div>
          <button type="submit" className="w-full bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg py-2 text-sm font-medium transition-colors">{editingProducto ? 'Guardar cambios' : 'Guardar'}</button>
        </form>
      </Modal>

      <Modal open={!!showStockModal} onClose={() => { setShowStockModal(null); setStockDelta('') }} title={`Ingreso de unidades — ${showStockModal?.nombre}`}>
        <form onSubmit={async e => {
          e.preventDefault()
          if (!showStockModal) return
          await patch('/api/productos', { id: showStockModal.id, delta_stock: parseInt(stockDelta) || 0 })
          setShowStockModal(null)
          setStockDelta('')
        }} className="space-y-4">
          <p className="text-sm text-gray-600">Stock actual: <span className="font-bold">{fmtNumero(showStockModal?.stock || '0')}</span></p>
          <div>
            <label className="text-xs font-medium text-gray-700">Unidades a ingresar</label>
            <input required type="number" min="1" value={stockDelta} onChange={e => setStockDelta(e.target.value)} className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" placeholder="Ej: 50" />
          </div>
          <button type="submit" className="w-full bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg py-2 text-sm font-medium transition-colors">Registrar ingreso</button>
        </form>
      </Modal>

      <Modal open={showEspecieModal} onClose={() => { setShowEspecieModal(false); setEditingEspecie(null) }}
        title={editingEspecie ? 'Editar especie' : 'Agregar especie'}>
        <form onSubmit={async e => {
          e.preventDefault()
          if (editingEspecie) {
            await patch('/api/especies', { id: editingEspecie.id, ...especieForm, letra: especieForm.letra.toUpperCase() })
          } else {
            await post('/api/especies', especieForm)
          }
          setShowEspecieModal(false)
          setEditingEspecie(null)
          setEspecieForm({ nombre: '', letra: '' })
        }} className="space-y-4">
          <div>
            <label className="text-xs font-medium text-gray-700">Nombre</label>
            <input required value={especieForm.nombre} onChange={e => setEspecieForm(f => ({ ...f, nombre: e.target.value }))} className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-700">Letra (1 char mayúscula)</label>
            <input required maxLength={1} value={especieForm.letra} onChange={e => setEspecieForm(f => ({ ...f, letra: e.target.value.toUpperCase() }))} className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
          <button type="submit" className="w-full bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg py-2 text-sm font-medium transition-colors">{editingEspecie ? 'Guardar cambios' : 'Guardar'}</button>
        </form>
      </Modal>

      <Modal open={showTipoServicioModal} onClose={() => { setShowTipoServicioModal(false); setEditingTipoServicio(null) }}
        title={editingTipoServicio ? 'Editar tipo de servicio' : 'Agregar tipo de servicio'}>
        <form onSubmit={async e => {
          e.preventDefault()
          if (editingTipoServicio) {
            await patch('/api/servicios', { id: editingTipoServicio.id, ...tipoServicioForm })
          } else {
            await post('/api/servicios', tipoServicioForm)
          }
          setShowTipoServicioModal(false)
          setEditingTipoServicio(null)
          setTipoServicioForm({ nombre: '', codigo: '' })
        }} className="space-y-4">
          <div>
            <label className="text-xs font-medium text-gray-700">Nombre</label>
            <input required value={tipoServicioForm.nombre} onChange={e => setTipoServicioForm(f => ({ ...f, nombre: e.target.value }))} className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-700">Código (ej: CI, CP, SD)</label>
            <input required value={tipoServicioForm.codigo} onChange={e => setTipoServicioForm(f => ({ ...f, codigo: e.target.value.toUpperCase() }))} className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
          <button type="submit" className="w-full bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg py-2 text-sm font-medium transition-colors">{editingTipoServicio ? 'Guardar cambios' : 'Guardar'}</button>
        </form>
      </Modal>

      <Modal open={showOtroModal} onClose={() => { setShowOtroModal(false); setEditingOtro(null) }}
        title={editingOtro ? 'Editar servicio adicional' : 'Agregar servicio adicional'}>
        <form onSubmit={async e => {
          e.preventDefault()
          if (editingOtro) {
            await patch('/api/servicios?tipo=otros', { id: editingOtro.id, nombre: otroForm.nombre, precio: String(parseInt(otroForm.precio) || 0) })
          } else {
            await post('/api/servicios?tipo=otros', { nombre: otroForm.nombre, precio: parseInt(otroForm.precio) })
          }
          setShowOtroModal(false)
          setEditingOtro(null)
          setOtroForm({ nombre: '', precio: '' })
        }} className="space-y-4">
          <div>
            <label className="text-xs font-medium text-gray-700">Nombre</label>
            <input required value={otroForm.nombre} onChange={e => setOtroForm(f => ({ ...f, nombre: e.target.value }))} className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-700">Precio (CLP)</label>
            <input required type="number" min="0" value={otroForm.precio} onChange={e => setOtroForm(f => ({ ...f, precio: e.target.value }))} className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
          <button type="submit" className="w-full bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg py-2 text-sm font-medium transition-colors">{editingOtro ? 'Guardar cambios' : 'Guardar'}</button>
        </form>
      </Modal>

      {/* Modal agregar tramo general/convenio */}
      <Modal open={!!showTramoModal} onClose={() => setShowTramoModal(null)} title={`Nuevo tramo — ${showTramoModal?.tipo === 'general' ? 'Precio general' : 'Precio convenio'}`}>
        <form onSubmit={async e => {
          e.preventDefault()
          if (!showTramoModal) return
          await post(`/api/precios?tipo=${showTramoModal.tipo}`, {
            peso_min: parseFloat(tramoForm.peso_min),
            peso_max: parseFloat(tramoForm.peso_max),
            precio_ci: parseInt(tramoForm.precio_ci),
            precio_cp: parseInt(tramoForm.precio_cp),
            precio_sd: parseInt(tramoForm.precio_sd),
          })
          setShowTramoModal(null)
        }} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            {[['Peso mín (kg)', 'peso_min'], ['Peso máx (kg)', 'peso_max'], ['Precio CI', 'precio_ci'], ['Precio CP', 'precio_cp'], ['Precio SD', 'precio_sd']].map(([label, key]) => (
              <div key={key}>
                <label className="text-xs font-medium text-gray-700">{label}</label>
                <input required type="number" min="0" value={(tramoForm as Record<string, string>)[key]}
                  onChange={e => setTramoForm(f => ({ ...f, [key]: e.target.value }))}
                  className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
            ))}
          </div>
          <p className="text-xs text-gray-400">El último tramo se mostrará como "X kg o más".</p>
          <button type="submit" className="w-full bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg py-2 text-sm font-medium transition-colors">Guardar tramo</button>
        </form>
      </Modal>

      {/* Modal convenio especial */}
      <Modal open={showEspecialModal} onClose={() => { setShowEspecialModal(false); setEditingEspecial(null) }} title={editingEspecial ? 'Editar tramo especial' : 'Nuevo convenio especial'}>
        <form onSubmit={async e => {
          e.preventDefault()
          if (editingEspecial) {
            await patch('/api/precios/especiales', { id: editingEspecial.id, ...especialForm })
          } else {
            await post('/api/precios/especiales', especialForm)
          }
          setShowEspecialModal(false)
          setEditingEspecial(null)
        }} className="space-y-4">
          {!editingEspecial && (
            <div>
              <label className="text-xs font-medium text-gray-700">Veterinaria</label>
              <select required value={especialForm.veterinaria_id} onChange={e => setEspecialForm(f => ({ ...f, veterinaria_id: e.target.value }))}
                className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                <option value="">Seleccionar...</option>
                {vets.filter(v => v.activo === 'TRUE').map(v => (
                  <option key={v.id} value={v.id}>{v.nombre}</option>
                ))}
              </select>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            {[['Peso mín (kg)', 'peso_min'], ['Peso máx (kg)', 'peso_max'], ['Precio CI', 'precio_ci'], ['Precio CP', 'precio_cp'], ['Precio SD', 'precio_sd']].map(([label, key]) => (
              <div key={key}>
                <label className="text-xs font-medium text-gray-700">{label}</label>
                <input required type="number" min="0" value={(especialForm as Record<string, string>)[key]}
                  onChange={e => setEspecialForm(f => ({ ...f, [key]: e.target.value }))}
                  className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
            ))}
          </div>
          <button type="submit" className="w-full bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg py-2 text-sm font-medium transition-colors">
            {editingEspecial ? 'Guardar cambios' : 'Crear tramo'}
          </button>
        </form>
      </Modal>

      {/* Modal usuario (crear / editar) */}
      <Modal open={showUsuarioModal} onClose={() => { setShowUsuarioModal(false); setEditingUsuario(null); setMostrarPassword(false) }}
        title={editingUsuario ? 'Editar usuario' : 'Agregar usuario'}>
        <form onSubmit={async e => {
          e.preventDefault()
          if (editingUsuario) {
            const updates: Record<string, string> = { id: editingUsuario.id, nombre: usuarioForm.nombre, email: usuarioForm.email, rol: usuarioForm.rol }
            if (usuarioForm.password) updates.password = usuarioForm.password
            await patch('/api/usuarios', updates)
          } else {
            await post('/api/usuarios', usuarioForm)
          }
          setShowUsuarioModal(false)
          setEditingUsuario(null)
          setUsuarioForm({ nombre: '', email: '', password: '', rol: 'operador' })
        }} className="space-y-4">
          <div>
            <label className="text-xs font-medium text-gray-700">Nombre</label>
            <input required value={usuarioForm.nombre} onChange={e => setUsuarioForm(f => ({ ...f, nombre: e.target.value }))}
              className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-700">Email</label>
            <input required type="email" value={usuarioForm.email} onChange={e => setUsuarioForm(f => ({ ...f, email: e.target.value }))}
              className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-700">
              Contraseña {editingUsuario && <span className="text-gray-400 font-normal">(dejar en blanco para no cambiar)</span>}
            </label>
            <div className="mt-1 relative">
              <input required={!editingUsuario} type={mostrarPassword ? 'text' : 'password'}
                value={usuarioForm.password} onChange={e => setUsuarioForm(f => ({ ...f, password: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              <button type="button" onClick={() => setMostrarPassword(v => !v)}
                className="absolute inset-y-0 right-0 px-3 text-gray-400 hover:text-gray-700 text-sm"
                title={mostrarPassword ? 'Ocultar' : 'Mostrar'}>
                {mostrarPassword ? '🙈' : '👁'}
              </button>
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-700">Rol</label>
            <select value={usuarioForm.rol} onChange={e => setUsuarioForm(f => ({ ...f, rol: e.target.value }))}
              className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
              <option value="operador">Operador</option>
              <option value="admin">Administrador</option>
            </select>
          </div>
          <button type="submit" className="w-full bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg py-2 text-sm font-medium transition-colors">
            {editingUsuario ? 'Guardar cambios' : 'Crear usuario'}
          </button>
        </form>
      </Modal>
    </div>
  )
}

function TramoRow({ tramo, isLast, tipo, onDelete, onEdit, onUpdate, isAdmin, canMoveUp, canMoveDown, onMoveUp, onMoveDown }: {
  tramo: Tramo; isLast: boolean; tipo: string
  onDelete: () => void; onEdit?: () => void; onUpdate: () => void; isAdmin: boolean
  canMoveUp?: boolean; canMoveDown?: boolean
  onMoveUp?: () => void; onMoveDown?: () => void
}) {
  const [editCell, setEditCell] = useState<{ campo: string; valor: string } | null>(null)

  async function saveCell() {
    if (!editCell) return
    const url = tipo === 'especial' ? '/api/precios/especiales' : `/api/precios?tipo=${tipo}`
    await fetch(url, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: tramo.id, [editCell.campo]: editCell.valor }) })
    setEditCell(null)
    onUpdate()
  }

  const campos = [
    { key: 'peso', label: isLast ? `${tramo.peso_min} kg o más` : `${tramo.peso_min} – ${tramo.peso_max} kg`, editable: false },
    { key: 'precio_ci', label: fmtPrecio(tramo.precio_ci), editable: true },
    { key: 'precio_cp', label: fmtPrecio(tramo.precio_cp), editable: true },
    { key: 'precio_sd', label: fmtPrecio(tramo.precio_sd), editable: true },
  ]

  return (
    <tr className="hover:bg-gray-50">
      {campos.map(c => {
        if (!c.editable) return <td key={c.key} className="px-4 py-3 text-sm text-gray-700 font-medium">{c.label}</td>
        const isEditing = editCell?.campo === c.key
        return (
          <td key={c.key} className="px-4 py-3">
            {isEditing ? (
              <input autoFocus type="number" value={editCell.valor}
                onChange={e => setEditCell(ec => ec ? { ...ec, valor: e.target.value } : null)}
                onBlur={saveCell} onKeyDown={e => e.key === 'Enter' && saveCell()}
                className="w-full border border-indigo-400 rounded px-2 py-1 text-sm focus:outline-none" />
            ) : (
              <span onClick={() => setEditCell({ campo: c.key, valor: (tramo as Record<string, string>)[c.key] })}
                className="cursor-pointer text-sm text-gray-700 hover:text-indigo-600 hover:underline">{c.label}</span>
            )}
          </td>
        )
      })}
      <td className="px-4 py-3">
        <div className="flex items-center gap-1.5">
          <div className="flex flex-col">
            <button onClick={onMoveUp} disabled={!canMoveUp} title="Mover arriba"
              className="text-gray-400 hover:text-indigo-600 disabled:opacity-30 disabled:hover:text-gray-400 text-[10px] leading-none px-1">▲</button>
            <button onClick={onMoveDown} disabled={!canMoveDown} title="Mover abajo"
              className="text-gray-400 hover:text-indigo-600 disabled:opacity-30 disabled:hover:text-gray-400 text-[10px] leading-none px-1">▼</button>
          </div>
          {onEdit && (
            <button onClick={onEdit} className="bg-emerald-500 hover:bg-emerald-600 text-white px-2 py-1 rounded text-xs font-medium transition-colors">Editar</button>
          )}
          {isAdmin && (
            <button onClick={onDelete} className="bg-red-500 hover:bg-red-600 text-white px-2 py-1 rounded text-xs font-medium transition-colors">Eliminar</button>
          )}
        </div>
      </td>
    </tr>
  )
}
