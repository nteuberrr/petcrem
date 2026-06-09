'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import { useSession } from 'next-auth/react'
import { Toggle } from '@/components/ui/Toggle'
import { Modal } from '@/components/ui/Modal'
import { Badge } from '@/components/ui/Badge'
import AddressAutocomplete from '@/components/ui/AddressAutocomplete'
import AgentesConfig from '@/components/AgentesConfig'
import CorreosConfig from '@/components/CorreosConfig'
import { fmtPrecio, fmtNumero } from '@/lib/format'
import { formatDate, formatHora } from '@/lib/dates'
import { esAdmin, esAdminTotal, ROLES, ROL_LABEL, MATRIZ_ACCESOS } from '@/lib/roles'

const TABS = ['Precios', 'Artículos', 'Descuentos', 'Usuarios', 'Jornada', 'Configuración Avanzada'] as const
type Tab = typeof TABS[number]
type PrecioSubTab = 'general' | 'convenio' | 'especial'
type ArticuloTab = 'servicios' | 'bodega' | 'otros'
type ServiciosTab = 'tipos' | 'especies'
type AvanzadaTab = 'datos' | 'agentes' | 'correos'

type Producto = { id: string; nombre: string; precio: string; foto_url: string; stock: string; categoria?: string; activo: string }
type CategoriaProducto = { id: string; nombre: string; activo: string; fecha_creacion: string }
type Tramo = { id: string; peso_min: string; peso_max: string; precio_ci: string; precio_cp: string; precio_sd: string; veterinaria_id?: string }
type Especie = { id: string; nombre: string; letra: string; activo: string }
type TipoServicio = { id: string; nombre: string; codigo: string; plazo_entrega_dias: string; activo: string }
type OtroServicio = { id: string; nombre: string; precio: string; activo: string }
type Descuento = { id: string; nombre: string; tipo: string; valor: string; activo: string }
type Vet = { id: string; nombre: string; activo: string; tipo_precios: string }
type Usuario = { id: string; nombre: string; email: string; rol: string; activo: string }

export default function ConfiguracionPage() {
  const { data: session, status } = useSession()
  const rolActual = session?.user?.role
  const isAdmin = status === 'authenticated' && (esAdmin(rolActual) || rolActual === undefined)
  const isAdminTotal = status === 'authenticated' && (esAdminTotal(rolActual) || rolActual === undefined)

  const [tab, setTab] = useState<Tab>('Precios')
  const [precioTab, setPrecioTab] = useState<PrecioSubTab>('general')
  const [articuloTab, setArticuloTab] = useState<ArticuloTab>('servicios')
  const [serviciosTab, setServiciosTab] = useState<ServiciosTab>('tipos')
  const [avanzadaTab, setAvanzadaTab] = useState<AvanzadaTab>('datos')

  // Jornada (config + histórico)
  type JornadaCfg = { id: string; vigente_desde: string; hora_entrada: string; hora_salida: string; precio_hora_extra: number; tolerancia_minutos: number; precio_retiro_adicional: number }
  const [jornadaConfigs, setJornadaConfigs] = useState<JornadaCfg[]>([])
  const [jornadaVigente, setJornadaVigente] = useState<JornadaCfg | null>(null)
  const [jornadaForm, setJornadaForm] = useState({ vigente_desde: '', hora_entrada: '09:00', hora_salida: '18:00', precio_hora_extra: '', tolerancia_minutos: '0', precio_retiro_adicional: '' })
  const [savingJornada, setSavingJornada] = useState(false)
  const [jornadaError, setJornadaError] = useState('')
  const [editingJornada, setEditingJornada] = useState<JornadaCfg | null>(null)
  const [editJornadaForm, setEditJornadaForm] = useState({ vigente_desde: '', hora_entrada: '', hora_salida: '', precio_hora_extra: '', tolerancia_minutos: '0', precio_retiro_adicional: '' })
  const [savingEditJornada, setSavingEditJornada] = useState(false)
  const [editJornadaError, setEditJornadaError] = useState('')

  const fetchJornada = useCallback(async () => {
    const res = await fetch('/api/jornada-config')
    const data = await res.json()
    if (Array.isArray(data?.configs)) setJornadaConfigs(data.configs)
    setJornadaVigente(data?.vigente ?? null)
  }, [])

  async function guardarJornada(e: React.FormEvent) {
    e.preventDefault()
    setJornadaError('')
    if (!jornadaForm.vigente_desde) return setJornadaError('Indica desde cuándo aplica esta jornada')
    setSavingJornada(true)
    const res = await fetch('/api/jornada-config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        vigente_desde: jornadaForm.vigente_desde,
        hora_entrada: jornadaForm.hora_entrada,
        hora_salida: jornadaForm.hora_salida,
        precio_hora_extra: parseFloat(jornadaForm.precio_hora_extra) || 0,
        tolerancia_minutos: parseInt(jornadaForm.tolerancia_minutos, 10) || 0,
        precio_retiro_adicional: parseFloat(jornadaForm.precio_retiro_adicional) || 0,
      }),
    })
    if (res.ok) {
      setJornadaForm({ vigente_desde: '', hora_entrada: '09:00', hora_salida: '18:00', precio_hora_extra: '', tolerancia_minutos: '0', precio_retiro_adicional: '' })
      await fetchJornada()
    } else {
      const err = await res.json().catch(() => ({}))
      setJornadaError(err?.error ?? 'Error al guardar')
    }
    setSavingJornada(false)
  }

  function abrirEditarJornada(c: JornadaCfg) {
    setEditingJornada(c)
    setEditJornadaError('')
    setEditJornadaForm({
      vigente_desde: c.vigente_desde,
      hora_entrada: c.hora_entrada,
      hora_salida: c.hora_salida,
      precio_hora_extra: String(c.precio_hora_extra ?? 0),
      tolerancia_minutos: String(c.tolerancia_minutos ?? 0),
      precio_retiro_adicional: String(c.precio_retiro_adicional ?? 0),
    })
  }

  async function guardarEdicionJornada(e: React.FormEvent) {
    e.preventDefault()
    if (!editingJornada) return
    setEditJornadaError('')
    if (!editJornadaForm.vigente_desde) return setEditJornadaError('La fecha es obligatoria')
    setSavingEditJornada(true)
    const res = await fetch('/api/jornada-config', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: editingJornada.id,
        vigente_desde: editJornadaForm.vigente_desde,
        hora_entrada: editJornadaForm.hora_entrada,
        hora_salida: editJornadaForm.hora_salida,
        precio_hora_extra: parseFloat(editJornadaForm.precio_hora_extra) || 0,
        tolerancia_minutos: parseInt(editJornadaForm.tolerancia_minutos, 10) || 0,
        precio_retiro_adicional: parseFloat(editJornadaForm.precio_retiro_adicional) || 0,
      }),
    })
    if (res.ok) {
      setEditingJornada(null)
      await fetchJornada()
    } else {
      const err = await res.json().catch(() => ({}))
      setEditJornadaError(err?.error ?? 'Error al actualizar')
    }
    setSavingEditJornada(false)
  }

  async function eliminarJornada(id: string) {
    if (!confirm('¿Eliminar esta configuración de jornada? Si era la vigente, los próximos fichajes no van a poder calcular hasta crear otra.')) return
    const res = await fetch(`/api/jornada-config?id=${id}`, { method: 'DELETE' })
    if (res.ok) await fetchJornada()
    else alert('Error al eliminar')
  }

  // Seguimiento en vivo de correos (BCC de transaccionales a un correo personal)
  const [segActivo, setSegActivo] = useState(false)
  const [segEmail, setSegEmail] = useState('')
  const [segSaving, setSegSaving] = useState(false)
  const [segMsg, setSegMsg] = useState<{ ok: boolean; texto: string } | null>(null)

  async function guardarSeguimiento() {
    if (segActivo && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(segEmail.trim())) {
      setSegMsg({ ok: false, texto: 'Ingresa un correo válido para activar el seguimiento.' })
      return
    }
    setSegSaving(true); setSegMsg(null)
    try {
      const res = await fetch('/api/empresa-config', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email_seguimiento_activo: segActivo ? 'TRUE' : 'FALSE', email_seguimiento: segEmail.trim() }),
      })
      const d = await res.json()
      if (res.ok) setSegMsg({ ok: true, texto: 'Guardado.' })
      else setSegMsg({ ok: false, texto: d?.error || 'Error al guardar' })
    } catch (e) {
      setSegMsg({ ok: false, texto: String(e) })
    } finally { setSegSaving(false) }
  }

  const [productos, setProductos] = useState<Producto[]>([])
  const [categoriasProd, setCategoriasProd] = useState<CategoriaProducto[]>([])
  const [showCatModal, setShowCatModal] = useState(false)
  const [editingCat, setEditingCat] = useState<CategoriaProducto | null>(null)
  const [catForm, setCatForm] = useState({ nombre: '' })
  const [catError, setCatError] = useState('')
  const [preciosG, setPreciosG] = useState<Tramo[]>([])
  const [preciosC, setPreciosC] = useState<Tramo[]>([])
  const [preciosE, setPreciosE] = useState<Tramo[]>([])
  const [especies, setEspecies] = useState<Especie[]>([])
  const [tiposServicio, setTiposServicio] = useState<TipoServicio[]>([])
  const [otros, setOtros] = useState<OtroServicio[]>([])
  const [descuentos, setDescuentos] = useState<Descuento[]>([])
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
  const [tipoServicioForm, setTipoServicioForm] = useState({ nombre: '', codigo: '', plazo_entrega_dias: '3' })
  const [showOtroModal, setShowOtroModal] = useState(false)
  const [editingOtro, setEditingOtro] = useState<OtroServicio | null>(null)
  const [showDescuentoModal, setShowDescuentoModal] = useState(false)
  const [editingDescuento, setEditingDescuento] = useState<Descuento | null>(null)
  const [descuentoForm, setDescuentoForm] = useState({ nombre: '', tipo: 'variable' as 'fijo' | 'variable', valor: '' })
  const [showTramoModal, setShowTramoModal] = useState<{ tipo: PrecioSubTab } | null>(null)
  const [showEspecialModal, setShowEspecialModal] = useState(false)
  const [editingEspecial, setEditingEspecial] = useState<Tramo | null>(null)
  const [showUsuarioModal, setShowUsuarioModal] = useState(false)
  const [editingUsuario, setEditingUsuario] = useState<Usuario | null>(null)
  const [mostrarPassword, setMostrarPassword] = useState(false)

  const [prodForm, setProdForm] = useState({ nombre: '', precio: '', foto_url: '', categoria: '' })
  const [stockDelta, setStockDelta] = useState('')
  const [especieForm, setEspecieForm] = useState({ nombre: '', letra: '' })
  const [otroForm, setOtroForm] = useState({ nombre: '', precio: '' })
  const [tramoForm, setTramoForm] = useState({ peso_min: '', peso_max: '', precio_ci: '', precio_cp: '', precio_sd: '' })
  const [especialForm, setEspecialForm] = useState({ veterinaria_id: '', peso_min: '', peso_max: '', precio_ci: '', precio_cp: '', precio_sd: '' })
  const [especialVetFiltro, setEspecialVetFiltro] = useState('')
  const [usuarioForm, setUsuarioForm] = useState({ nombre: '', email: '', password: '', rol: 'operador' })
  const [uploadingFoto, setUploadingFoto] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Fetchers individuales — para refrescar solo lo que cambió y evitar quota exceeded.
  type RefreshKey = 'productos' | 'precios' | 'especies' | 'servicios' | 'descuentos' | 'veterinarios' | 'usuarios' | 'all'

  const refresh = useCallback(async (key: RefreshKey = 'all') => {
    if (key === 'productos' || key === 'all') {
      const [p, c] = await Promise.all([
        fetch('/api/productos').then(r => r.json()),
        fetch('/api/categorias-productos').then(r => r.json()).catch(() => []),
      ])
      setProductos(Array.isArray(p) ? p : [])
      setCategoriasProd(Array.isArray(c) ? c : [])
    }
    if (key === 'precios' || key === 'all') {
      const [pg, pc, pe] = await Promise.all([
        fetch('/api/precios?tipo=general').then(r => r.json()),
        fetch('/api/precios?tipo=convenio').then(r => r.json()),
        fetch('/api/precios/especiales').then(r => r.json()),
      ])
      setPreciosG(Array.isArray(pg) ? pg : [])
      setPreciosC(Array.isArray(pc) ? pc : [])
      setPreciosE(Array.isArray(pe) ? pe : [])
    }
    if (key === 'especies' || key === 'all') {
      const e = await fetch('/api/especies').then(r => r.json())
      setEspecies(Array.isArray(e) ? e : [])
    }
    if (key === 'servicios' || key === 'all') {
      const [ts, os] = await Promise.all([
        fetch('/api/servicios').then(r => r.json()),
        fetch('/api/servicios?tipo=otros').then(r => r.json()),
      ])
      setTiposServicio(Array.isArray(ts) ? ts : [])
      setOtros(Array.isArray(os) ? os : [])
    }
    if (key === 'descuentos' || key === 'all') {
      const d = await fetch('/api/descuentos').then(r => r.json())
      setDescuentos(Array.isArray(d) ? d : [])
    }
    if (key === 'veterinarios' || key === 'all') {
      const v = await fetch('/api/veterinarios').then(r => r.json())
      setVets(Array.isArray(v) ? v : [])
    }
    if (key === 'usuarios' || key === 'all') {
      const u = await fetch('/api/usuarios').then(r => r.json())
      setUsuarios(Array.isArray(u) ? u : [])
    }
  }, [])

  const fetchAll = useCallback(() => refresh('all'), [refresh])

  useEffect(() => { fetchAll() }, [fetchAll])
  useEffect(() => { fetchJornada() }, [fetchJornada])
  useEffect(() => {
    fetch('/api/empresa-config').then(r => r.json()).then(d => {
      setSegActivo(String(d?.email_seguimiento_activo || '').toUpperCase() === 'TRUE')
      setSegEmail(d?.email_seguimiento || '')
    }).catch(() => {})
  }, [])

  // Detecta a partir de la URL qué hoja refrescar después de mutar (evita refetchear todo)
  function refreshKeyForUrl(url: string): RefreshKey {
    if (url.includes('/api/productos') || url.includes('/api/categorias-productos')) return 'productos'
    if (url.includes('/api/precios')) return 'precios'
    if (url.includes('/api/especies')) return 'especies'
    if (url.includes('/api/servicios')) return 'servicios'
    if (url.includes('/api/descuentos')) return 'descuentos'
    if (url.includes('/api/veterinarios')) return 'veterinarios'
    if (url.includes('/api/usuarios')) return 'usuarios'
    return 'all'
  }

  const patch = async (url: string, body: object) => {
    const res = await fetch(url, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    if (!res.ok) { const err = await res.json().catch(() => ({})); alert(`Error al actualizar: ${err.error ?? res.status}`); return }
    await refresh(refreshKeyForUrl(url))
  }
  const post = async (url: string, body: object) => {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    if (!res.ok) { const err = await res.json().catch(() => ({})); alert(`Error al guardar: ${err.error ?? res.status}`); return }
    await refresh(refreshKeyForUrl(url))
  }
  const del = async (url: string) => {
    const res = await fetch(url, { method: 'DELETE' })
    if (!res.ok) { const err = await res.json().catch(() => ({})); alert(`Error al eliminar: ${err.error ?? res.status}`); return }
    await refresh(refreshKeyForUrl(url))
  }
  const reorder = async (tipo: PrecioSubTab, id: string, direction: 'up' | 'down') => {
    await fetch(`/api/precios/reorder?tipo=${tipo}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, direction }),
    })
    await refresh('precios')
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
        {TABS.filter(t => t !== 'Configuración Avanzada' || isAdminTotal).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${tab === t ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>
            {t}
          </button>
        ))}
      </div>

      {/* Sub-pestañas de Artículos */}
      {tab === 'Artículos' && (
        <div className="flex gap-2 flex-wrap mb-4">
          {([['servicios', 'Servicios Generales'], ['bodega', 'Bodega'], ['otros', 'Otros Productos']] as const).map(([k, label]) => (
            <button key={k} onClick={() => setArticuloTab(k)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${articuloTab === k ? 'bg-indigo-600 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
              {label}
            </button>
          ))}
        </div>
      )}
      {/* Sub-sub-pestañas de Servicios Generales */}
      {tab === 'Artículos' && articuloTab === 'servicios' && (
        <div className="flex gap-2 flex-wrap mb-4">
          {([['tipos', 'Tipos de servicio'], ['especies', 'Especies']] as const).map(([k, label]) => (
            <button key={k} onClick={() => setServiciosTab(k)}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${serviciosTab === k ? 'bg-slate-700 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
              {label}
            </button>
          ))}
        </div>
      )}
      {/* Sub-pestañas de Configuración Avanzada */}
      {tab === 'Configuración Avanzada' && isAdminTotal && (
        <div className="flex gap-2 flex-wrap mb-4">
          {([['datos', 'Datos Personales'], ['agentes', 'Agentes'], ['correos', 'Correos']] as const).map(([k, label]) => (
            <button key={k} onClick={() => setAvanzadaTab(k)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${avanzadaTab === k ? 'bg-indigo-600 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
              {label}
            </button>
          ))}
        </div>
      )}

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
      {tab === 'Artículos' && articuloTab === 'bodega' && (
        <div className="space-y-4">

        {/* Categorías */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
            <div>
              <h2 className="font-semibold text-gray-900">Categorías de productos</h2>
              <p className="text-xs text-gray-500 mt-0.5">Agrupá productos por tipo (ej: Ánforas, Relicarios). Editar el nombre actualiza también los productos asociados.</p>
            </div>
            <button onClick={() => { setEditingCat(null); setCatForm({ nombre: '' }); setCatError(''); setShowCatModal(true) }}
              className="bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded-lg text-xs font-medium transition-colors">+ Nueva categoría</button>
          </div>
          {categoriasProd.length === 0 ? (
            <div className="px-6 py-6 text-center text-sm text-gray-400">
              Aún no creaste categorías. También se cargan automáticamente las que ya hayan sido tipeadas en productos.
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {categoriasProd.map(c => {
                const cantidad = productos.filter(p => (p.categoria ?? '').trim().toLowerCase() === c.nombre.toLowerCase()).length
                return (
                  <div key={c.id} className="flex items-center justify-between px-6 py-3 gap-3 flex-wrap">
                    <div className="flex items-center gap-3">
                      <span className="font-medium text-gray-900">{c.nombre}</span>
                      <span className="text-[11px] text-indigo-700 font-semibold bg-indigo-50 border border-indigo-200 px-2 py-0.5 rounded-full">
                        {cantidad} producto{cantidad !== 1 ? 's' : ''}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button onClick={() => { setEditingCat(c); setCatForm({ nombre: c.nombre }); setCatError(''); setShowCatModal(true) }}
                        className="bg-emerald-500 hover:bg-emerald-600 text-white px-3 py-1 rounded-md text-xs font-medium transition-colors">Editar</button>
                      {isAdmin && (
                        <button onClick={async () => {
                          if (cantidad > 0) {
                            const otras = categoriasProd.filter(x => x.id !== c.id).map(x => x.nombre)
                            const opcionesTxt = otras.length > 0 ? `\nOpciones disponibles: ${otras.join(', ')}` : ''
                            const reasignar = prompt(`La categoría "${c.nombre}" tiene ${cantidad} producto(s).\n\nEscribí el nombre de la categoría a la que querés moverlos, o dejá vacío para que queden sin categoría.${opcionesTxt}`)
                            if (reasignar === null) return  // canceló
                            const r = await fetch(`/api/categorias-productos?id=${c.id}&reasignar_a=${encodeURIComponent(reasignar.trim())}`, { method: 'DELETE' })
                            if (!r.ok) { const err = await r.json().catch(() => ({})); alert(err?.error ?? 'Error al eliminar'); return }
                            await refresh('productos')
                          } else {
                            if (!confirm(`¿Eliminar la categoría "${c.nombre}"?`)) return
                            const r = await fetch(`/api/categorias-productos?id=${c.id}`, { method: 'DELETE' })
                            if (!r.ok) { const err = await r.json().catch(() => ({})); alert(err?.error ?? 'Error al eliminar'); return }
                            await refresh('productos')
                          }
                        }}
                          className="bg-red-500 hover:bg-red-600 text-white px-3 py-1 rounded-md text-xs font-medium transition-colors">Eliminar</button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
            <h2 className="font-semibold text-gray-900">Bodega</h2>
            <button onClick={() => { setEditingProducto(null); setProdForm({ nombre: '', precio: '', foto_url: '', categoria: '' }); setShowProdModal(true) }}
              className="bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded-lg text-xs font-medium transition-colors">+ Agregar</button>
          </div>
          {productos.length === 0 ? (
            <div className="px-6 py-8 text-center text-sm text-gray-400">Sin productos registrados</div>
          ) : (
            (() => {
              const grupos = new Map<string, Producto[]>()
              for (const p of productos) {
                const cat = (p.categoria ?? '').trim() || 'Sin categoría'
                const arr = grupos.get(cat) ?? []
                arr.push(p)
                grupos.set(cat, arr)
              }
              const orden = Array.from(grupos.keys()).sort((a, b) => {
                if (a === 'Sin categoría') return 1
                if (b === 'Sin categoría') return -1
                return a.localeCompare(b)
              })
              return (
                <div className="divide-y-2 divide-gray-200">
                  {orden.map(cat => (
                    <div key={cat}>
                      <div className="bg-indigo-50 px-6 py-2 border-b border-indigo-100 flex items-center justify-between">
                        <h3 className="text-xs font-bold text-indigo-900 uppercase tracking-wide">{cat}</h3>
                        <span className="text-[10px] text-indigo-700 font-semibold bg-indigo-100 px-2 py-0.5 rounded-full">
                          {grupos.get(cat)!.length} producto{grupos.get(cat)!.length !== 1 ? 's' : ''}
                        </span>
                      </div>
                      <div className="divide-y divide-gray-100">
                        {grupos.get(cat)!.map(p => {
                          const stockNum = parseInt(p.stock || '0')
                          return (
                            <div key={p.id} className="flex items-center gap-4 px-6 py-4 flex-wrap">
                              {p.foto_url
                                ? <img src={p.foto_url} alt={p.nombre} className="w-12 h-12 object-cover rounded-lg border border-gray-100" />
                                : <div className="w-12 h-12 bg-gray-50 rounded-lg border border-gray-100 flex items-center justify-center text-gray-300 text-xl">📦</div>
                              }
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-gray-900 truncate">{p.nombre}</p>
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
                                  onClick={() => { setEditingProducto(p); setProdForm({ nombre: p.nombre, precio: p.precio, foto_url: p.foto_url, categoria: p.categoria ?? '' }); setShowProdModal(true) }}
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
                      </div>
                    </div>
                  ))}
                </div>
              )
            })()
          )}
        </div>
        </div>
      )}

      {/* ─── ESPECIES ─── */}
      {tab === 'Artículos' && articuloTab === 'servicios' && serviciosTab === 'especies' && (
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
      {tab === 'Artículos' && articuloTab === 'servicios' && serviciosTab === 'tipos' && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
            <h2 className="font-semibold text-gray-900">Tipos de servicio</h2>
            <button onClick={() => { setEditingTipoServicio(null); setTipoServicioForm({ nombre: '', codigo: '', plazo_entrega_dias: '3' }); setShowTipoServicioModal(true) }}
              className="bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded-lg text-xs font-medium transition-colors">+ Agregar</button>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-gray-50"><tr>{['Nombre', 'Código', 'Plazo entrega', 'Estado', ''].map(h => <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-gray-500">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-gray-100">
              {tiposServicio.map(t => (
                <tr key={t.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">{t.nombre}</td>
                  <td className="px-4 py-3"><span className="font-mono font-semibold text-gray-700">{t.codigo}</span></td>
                  <td className="px-4 py-3 text-gray-700">{t.plazo_entrega_dias ? `${t.plazo_entrega_dias} días hábiles` : '—'}</td>
                  <td className="px-4 py-3"><Toggle checked={t.activo === 'TRUE'} onChange={val => patch('/api/servicios', { id: t.id, activo: val ? 'TRUE' : 'FALSE' })} /></td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => { setEditingTipoServicio(t); setTipoServicioForm({ nombre: t.nombre, codigo: t.codigo, plazo_entrega_dias: t.plazo_entrega_dias || '3' }); setShowTipoServicioModal(true) }}
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
                <tr><td colSpan={5} className="px-4 py-8 text-center text-sm text-gray-400">Sin tipos de servicio</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* ─── OTROS SERVICIOS ─── */}
      {tab === 'Artículos' && articuloTab === 'otros' && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
            <h2 className="font-semibold text-gray-900">Otros Productos</h2>
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

      {/* ─── DESCUENTOS ─── */}
      {tab === 'Descuentos' && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
            <div>
              <h2 className="font-semibold text-gray-900">Descuentos</h2>
              <p className="text-xs text-gray-400 mt-0.5">Variable (%) o Fijo (monto en CLP) · Aplica sobre el total del servicio (cremación + adicionales)</p>
            </div>
            <button onClick={() => { setEditingDescuento(null); setDescuentoForm({ nombre: '', tipo: 'variable', valor: '' }); setShowDescuentoModal(true) }}
              className="bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded-lg text-xs font-medium transition-colors">+ Agregar</button>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-gray-50"><tr>{['Nombre', 'Tipo', 'Valor', 'Estado', ''].map(h => <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-gray-500">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-gray-100">
              {descuentos.map(d => {
                const valorNum = parseFloat(d.valor) || 0
                return (
                  <tr key={d.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">{d.nombre}</td>
                    <td className="px-4 py-3">
                      <Badge variant={d.tipo === 'fijo' ? 'blue' : 'purple'}>{d.tipo === 'fijo' ? 'Fijo' : 'Variable'}</Badge>
                    </td>
                    <td className="px-4 py-3 text-gray-700">{d.tipo === 'fijo' ? fmtPrecio(valorNum) : `${valorNum}%`}</td>
                    <td className="px-4 py-3"><Toggle checked={d.activo === 'TRUE'} onChange={val => patch('/api/descuentos', { id: d.id, activo: val ? 'TRUE' : 'FALSE' })} /></td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => { setEditingDescuento(d); setDescuentoForm({ nombre: d.nombre, tipo: d.tipo === 'fijo' ? 'fijo' : 'variable', valor: d.valor }); setShowDescuentoModal(true) }}
                          className="bg-emerald-500 hover:bg-emerald-600 text-white px-3 py-1 rounded-md text-xs font-medium transition-colors">Editar</button>
                        {isAdmin && (
                          <button
                            onClick={() => { if (confirm(`¿Eliminar "${d.nombre}"?`)) del(`/api/descuentos?id=${d.id}`) }}
                            className="bg-red-500 hover:bg-red-600 text-white px-3 py-1 rounded-md text-xs font-medium transition-colors">Eliminar</button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
              {descuentos.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-sm text-gray-400">Sin descuentos registrados</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* ─── USUARIOS ─── */}
      {tab === 'Usuarios' && (
        <div className="space-y-6">
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
                    <Badge variant={u.rol === 'operador' ? 'blue' : 'purple'}>{ROL_LABEL[u.rol] || u.rol}</Badge>
                  </td>
                  <td className="px-4 py-3">
                    {(isAdminTotal || u.rol === 'operador')
                      ? <Toggle checked={u.activo === 'TRUE'} onChange={val => patch('/api/usuarios', { id: u.id, activo: val ? 'TRUE' : 'FALSE' })} />
                      : <span className={`text-xs font-medium ${u.activo === 'TRUE' ? 'text-emerald-700' : 'text-gray-400'}`}>{u.activo === 'TRUE' ? 'activo' : 'inactivo'}</span>}
                  </td>
                  <td className="px-4 py-3">
                    {(isAdminTotal || u.rol === 'operador') ? (
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
                    ) : <span className="text-xs text-gray-400">—</span>}
                  </td>
                </tr>
              ))}
              {usuarios.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400 text-sm">Sin usuarios registrados. Solo el admin puede iniciar sesión.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Informe de accesos — solo Admin (1) */}
        {isAdminTotal && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <div>
                <h2 className="font-semibold text-gray-900">Informe de accesos</h2>
                <p className="text-xs text-gray-400 mt-0.5">Qué puede ver/usar cada rol. Se actualiza a medida que sumamos módulos.</p>
              </div>
              <button onClick={() => window.print()}
                className="bg-slate-700 hover:bg-slate-800 text-white px-3 py-1.5 rounded-lg text-xs font-medium transition-colors shrink-0">
                🖨 Imprimir
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[560px]">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500">Módulo</th>
                    {['Admin', 'Admin 2', 'Operador'].map(h => (
                      <th key={h} className="text-center px-4 py-3 text-xs font-semibold text-gray-500">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {MATRIZ_ACCESOS.map(m => (
                    <tr key={m.modulo} className="hover:bg-gray-50">
                      <td className="px-4 py-2.5 text-gray-800">
                        {m.modulo}
                        {m.nota && <span className="block text-[10px] text-amber-600">{m.nota}</span>}
                      </td>
                      {(['admin', 'admin2', 'operador'] as const).map(r => (
                        <td key={r} className="px-4 py-2.5 text-center">
                          {m.roles.includes(r)
                            ? <span className="text-emerald-600 font-bold">✓</span>
                            : <span className="text-gray-300">✗</span>}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="px-6 py-3 border-t border-gray-100 text-xs text-gray-500">
              Usuarios creados: {usuarios.length} · {usuarios.filter(u => u.rol === 'admin').length} Admin · {usuarios.filter(u => u.rol === 'admin2').length} Admin 2 · {usuarios.filter(u => u.rol === 'operador').length} Operador
            </div>
          </div>
        )}
        </div>
      )}

      {/* ─── AGENTES ─── */}
      {tab === 'Configuración Avanzada' && isAdminTotal && avanzadaTab === 'agentes' && <AgentesConfig />}
      {tab === 'Configuración Avanzada' && isAdminTotal && avanzadaTab === 'correos' && (
        <div className="space-y-6">
          <CorreosConfig />

          {/* Seguimiento en vivo de correos enviados (BCC a un correo personal) */}
          <div className="bg-white rounded-xl shadow-md border-2 border-gray-200 p-6 max-w-3xl">
            <h2 className="text-base font-bold text-gray-900 mb-1">Seguimiento en vivo de correos electrónicos enviados</h2>
            <p className="text-sm text-gray-600 mb-4">
              Si está activo, te llega una <b>copia oculta (BCC)</b> a tu correo de <b>cada email transaccional</b> que envíe el sistema (registro, inicio de cremación, despachos, eutanasias, informes de veterinaria…). <b>No incluye</b> el mailing masivo.
            </p>
            <div className="flex items-center gap-3 mb-4">
              <Toggle checked={segActivo} onChange={setSegActivo} />
              <span className="text-sm font-medium text-gray-700">{segActivo ? 'Activado' : 'Desactivado'}</span>
            </div>
            <label className="text-xs font-semibold text-gray-700">Reenviar copia a este correo</label>
            <input type="email" value={segEmail} onChange={e => setSegEmail(e.target.value)}
              placeholder="tucorreo@ejemplo.com"
              className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            <div className="flex items-center gap-3 mt-4">
              <button onClick={guardarSeguimiento} disabled={segSaving}
                className="bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2.5 rounded-lg text-sm font-semibold shadow-md transition-colors disabled:opacity-50">
                {segSaving ? 'Guardando…' : 'Guardar'}
              </button>
              {segMsg && <span className={`text-sm ${segMsg.ok ? 'text-emerald-700' : 'text-red-600'}`}>{segMsg.texto}</span>}
            </div>
            <p className="text-[11px] text-gray-400 mt-2">El cambio puede tardar hasta ~1 minuto en aplicarse a los envíos.</p>
          </div>
        </div>
      )}

      {tab === 'Jornada' && (
        <div className="space-y-6 max-w-3xl">
          {/* Vigente */}
          <div className="bg-white rounded-xl shadow-md border-2 border-gray-200 p-6">
            <h2 className="text-base font-bold text-gray-900 mb-3">Jornada vigente</h2>
            {jornadaVigente ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 text-sm">
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase">Desde</p>
                  <p className="text-gray-900 font-medium mt-0.5">{jornadaVigente.vigente_desde}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase">Entrada</p>
                  <p className="text-gray-900 font-medium mt-0.5">{formatHora(jornadaVigente.hora_entrada)}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase">Salida</p>
                  <p className="text-gray-900 font-medium mt-0.5">{formatHora(jornadaVigente.hora_salida)}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase">Hora extra</p>
                  <p className="text-gray-900 font-medium mt-0.5">{fmtPrecio(jornadaVigente.precio_hora_extra)}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase">Tolerancia</p>
                  <p className="text-gray-900 font-medium mt-0.5">{jornadaVigente.tolerancia_minutos || 0} min</p>
                </div>
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase">Retiro adicional</p>
                  <p className="text-gray-900 font-medium mt-0.5">{fmtPrecio(jornadaVigente.precio_retiro_adicional || 0)}</p>
                </div>
              </div>
            ) : (
              <p className="text-sm text-amber-700 bg-amber-50 border-2 border-amber-200 rounded-lg p-3">
                ⚠ No hay jornada configurada. Los operadores no van a poder fichar hasta que crees una.
              </p>
            )}
          </div>

          {/* Crear nueva */}
          <div className="bg-white rounded-xl shadow-md border-2 border-gray-200 p-6">
            <h2 className="text-base font-bold text-gray-900 mb-1">Nueva configuración</h2>
            <p className="text-xs text-gray-500 mb-4">Aplica desde la fecha indicada en adelante. Los registros previos mantienen su jornada original.</p>
            <form onSubmit={guardarJornada} className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
                <div>
                  <label className="text-xs font-semibold text-gray-700">Vigente desde</label>
                  <input type="date" required value={jornadaForm.vigente_desde} onChange={e => setJornadaForm(f => ({ ...f, vigente_desde: e.target.value }))}
                    className="mt-1 w-full border-2 border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-700">Hora entrada</label>
                  <input type="time" required value={jornadaForm.hora_entrada} onChange={e => setJornadaForm(f => ({ ...f, hora_entrada: e.target.value }))}
                    className="mt-1 w-full border-2 border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-700">Hora salida</label>
                  <input type="time" required value={jornadaForm.hora_salida} onChange={e => setJornadaForm(f => ({ ...f, hora_salida: e.target.value }))}
                    className="mt-1 w-full border-2 border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-700">$ hora extra</label>
                  <input type="number" min="0" required value={jornadaForm.precio_hora_extra} onChange={e => setJornadaForm(f => ({ ...f, precio_hora_extra: e.target.value }))}
                    className="mt-1 w-full border-2 border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-700">Tolerancia</label>
                  <select value={jornadaForm.tolerancia_minutos} onChange={e => setJornadaForm(f => ({ ...f, tolerancia_minutos: e.target.value }))}
                    className="mt-1 w-full border-2 border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                    <option value="0">Sin tolerancia</option>
                    <option value="30">30 min</option>
                    <option value="45">45 min</option>
                    <option value="60">1 hora</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-700">$ retiro adicional</label>
                  <input type="number" min="0" value={jornadaForm.precio_retiro_adicional} onChange={e => setJornadaForm(f => ({ ...f, precio_retiro_adicional: e.target.value }))}
                    placeholder="0"
                    className="mt-1 w-full border-2 border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                </div>
              </div>
              <p className="text-xs text-gray-500">
                <b>Tolerancia:</b> los primeros N minutos de horas extras no se cuentan. Si alguien hace 2h extra y la tolerancia es 30 min, solo se aprueban 1h 30min como horas extra.<br />
                <b>$ retiro adicional:</b> monto fijo que se paga al chofer por cada retiro fuera de horario que registre.
              </p>
              {jornadaError && <p className="text-xs text-red-700 bg-red-50 border-2 border-red-200 rounded-lg p-2">{jornadaError}</p>}
              <button type="submit" disabled={savingJornada}
                className="bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2 rounded-lg text-sm font-semibold shadow-md transition-colors disabled:opacity-50">
                {savingJornada ? 'Guardando...' : 'Guardar configuración'}
              </button>
            </form>
          </div>

          {/* Histórico */}
          {jornadaConfigs.length > 0 && (
            <div className="bg-white rounded-xl shadow-md border-2 border-gray-200 overflow-hidden">
              <div className="px-6 py-4 border-b-2 border-gray-200">
                <h2 className="text-base font-bold text-gray-900">Histórico de configuraciones</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[800px]">
                  <thead className="bg-gray-50">
                    <tr>
                      {['Vigente desde', 'Entrada', 'Salida', '$ hora extra', 'Tolerancia', '$ retiro adicional', 'Acciones'].map(h => (
                        <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-gray-500">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {jornadaConfigs.map(c => (
                      <tr key={c.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 text-gray-900 font-medium">{c.vigente_desde}</td>
                        <td className="px-4 py-3 text-gray-700">{formatHora(c.hora_entrada)}</td>
                        <td className="px-4 py-3 text-gray-700">{formatHora(c.hora_salida)}</td>
                        <td className="px-4 py-3 text-gray-700">{fmtPrecio(c.precio_hora_extra)}</td>
                        <td className="px-4 py-3 text-gray-700">{c.tolerancia_minutos || 0} min</td>
                        <td className="px-4 py-3 text-gray-700">{fmtPrecio(c.precio_retiro_adicional || 0)}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <button onClick={() => abrirEditarJornada(c)}
                              className="bg-blue-500 hover:bg-blue-600 text-white px-2.5 py-1 rounded-md text-xs font-medium">
                              Editar
                            </button>
                            <button onClick={() => eliminarJornada(c.id)}
                              className="bg-red-500 hover:bg-red-600 text-white px-2.5 py-1 rounded-md text-xs font-medium">
                              Eliminar
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'Configuración Avanzada' && isAdminTotal && avanzadaTab === 'datos' && <DatosPersonalesPanel />}

      {/* ─── MODALES ─── */}
      <Modal open={!!editingJornada} onClose={() => setEditingJornada(null)} title="Editar configuración de jornada">
        {editingJornada && (
          <form onSubmit={guardarEdicionJornada} className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-gray-700">Vigente desde</label>
                <input type="date" required value={editJornadaForm.vigente_desde}
                  onChange={e => setEditJornadaForm(f => ({ ...f, vigente_desde: e.target.value }))}
                  className="mt-1 w-full border-2 border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-700">Tolerancia</label>
                <select value={editJornadaForm.tolerancia_minutos}
                  onChange={e => setEditJornadaForm(f => ({ ...f, tolerancia_minutos: e.target.value }))}
                  className="mt-1 w-full border-2 border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                  <option value="0">Sin tolerancia</option>
                  <option value="30">30 min</option>
                  <option value="45">45 min</option>
                  <option value="60">1 hora</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-700">Hora entrada</label>
                <input type="time" required value={editJornadaForm.hora_entrada}
                  onChange={e => setEditJornadaForm(f => ({ ...f, hora_entrada: e.target.value }))}
                  className="mt-1 w-full border-2 border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-700">Hora salida</label>
                <input type="time" required value={editJornadaForm.hora_salida}
                  onChange={e => setEditJornadaForm(f => ({ ...f, hora_salida: e.target.value }))}
                  className="mt-1 w-full border-2 border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-700">$ hora extra</label>
                <input type="number" min="0" required value={editJornadaForm.precio_hora_extra}
                  onChange={e => setEditJornadaForm(f => ({ ...f, precio_hora_extra: e.target.value }))}
                  className="mt-1 w-full border-2 border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-700">$ retiro adicional</label>
                <input type="number" min="0" value={editJornadaForm.precio_retiro_adicional}
                  onChange={e => setEditJornadaForm(f => ({ ...f, precio_retiro_adicional: e.target.value }))}
                  className="mt-1 w-full border-2 border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
            </div>
            {editJornadaError && <p className="text-xs text-red-700 bg-red-50 border-2 border-red-200 rounded-lg p-2">{editJornadaError}</p>}
            <div className="flex gap-3 pt-2">
              <button type="button" onClick={() => setEditingJornada(null)}
                className="flex-1 border-2 border-gray-300 text-gray-700 rounded-lg py-2 text-sm font-semibold hover:bg-gray-50">
                Cancelar
              </button>
              <button type="submit" disabled={savingEditJornada}
                className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg py-2 text-sm font-semibold shadow-md disabled:opacity-50">
                {savingEditJornada ? 'Guardando...' : 'Guardar cambios'}
              </button>
            </div>
          </form>
        )}
      </Modal>

      <Modal open={showProdModal} onClose={() => { setShowProdModal(false); setEditingProducto(null); setProdForm({ nombre: '', precio: '', foto_url: '', categoria: '' }) }}
        title={editingProducto ? 'Editar producto' : 'Agregar producto'}>
        <form onSubmit={async e => {
          e.preventDefault()
          const categoria = prodForm.categoria.trim()
          if (!categoria) {
            alert('La categoría es obligatoria. Escribí una existente o creá una nueva (ej: Ánforas, Relicarios).')
            return
          }
          if (editingProducto) {
            await patch('/api/productos', { id: editingProducto.id, nombre: prodForm.nombre, categoria, precio: String(parseInt(prodForm.precio) || 0), foto_url: prodForm.foto_url })
          } else {
            await post('/api/productos', { nombre: prodForm.nombre, categoria, precio: parseInt(prodForm.precio), foto_url: prodForm.foto_url })
          }
          setShowProdModal(false)
          setEditingProducto(null)
          setProdForm({ nombre: '', precio: '', foto_url: '', categoria: '' })
        }} className="space-y-4">
          <div>
            <label className="text-xs font-medium text-gray-700">Nombre</label>
            <input required value={prodForm.nombre} onChange={e => setProdForm(f => ({ ...f, nombre: e.target.value }))} className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-700">Categoría <span className="text-red-500">*</span></label>
            <input
              required
              list="categorias-productos"
              value={prodForm.categoria}
              onChange={e => setProdForm(f => ({ ...f, categoria: e.target.value }))}
              placeholder="Elegí una existente o escribí una nueva (Ánforas, Relicarios, etc.)"
              className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <datalist id="categorias-productos">
              {(() => {
                const set = new Set<string>()
                categoriasProd.forEach(c => { if (c.activo === 'TRUE') set.add(c.nombre) })
                productos.forEach(p => { const v = (p.categoria ?? '').trim(); if (v) set.add(v) })
                return Array.from(set).sort().map(cat => <option key={cat} value={cat} />)
              })()}
            </datalist>
            <p className="text-[10px] text-gray-500 mt-0.5">Elegí una existente o escribí una nueva. Las categorías se gestionan arriba.</p>
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

      {/* Modal Categoría: agregar/editar */}
      <Modal open={showCatModal} onClose={() => { setShowCatModal(false); setEditingCat(null); setCatForm({ nombre: '' }); setCatError('') }}
        title={editingCat ? 'Editar categoría' : 'Nueva categoría'}>
        <form onSubmit={async e => {
          e.preventDefault()
          setCatError('')
          const nombre = catForm.nombre.trim()
          if (!nombre) { setCatError('Nombre requerido'); return }
          if (editingCat) {
            const r = await fetch('/api/categorias-productos', {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ id: editingCat.id, nombre }),
            })
            if (!r.ok) { const err = await r.json().catch(() => ({})); setCatError(err?.error ?? 'Error al actualizar'); return }
          } else {
            const r = await fetch('/api/categorias-productos', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ nombre }),
            })
            if (!r.ok) { const err = await r.json().catch(() => ({})); setCatError(err?.error ?? 'Error al crear'); return }
          }
          setShowCatModal(false)
          setEditingCat(null)
          setCatForm({ nombre: '' })
          await refresh('productos')
        }} className="space-y-4">
          <div>
            <label className="text-xs font-medium text-gray-700">Nombre de la categoría</label>
            <input required autoFocus value={catForm.nombre}
              onChange={e => setCatForm({ nombre: e.target.value })}
              placeholder="Ej: Ánforas, Relicarios, Urnas…"
              className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
          {editingCat && (
            <p className="text-[11px] text-gray-500">
              Cambiar el nombre actualiza también todos los productos que actualmente están en esta categoría.
            </p>
          )}
          {catError && <p className="text-xs text-red-700 bg-red-50 border-2 border-red-200 rounded-lg p-2">{catError}</p>}
          <button type="submit" className="w-full bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg py-2 text-sm font-medium transition-colors">
            {editingCat ? 'Guardar cambios' : 'Crear categoría'}
          </button>
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
          setTipoServicioForm({ nombre: '', codigo: '', plazo_entrega_dias: '3' })
        }} className="space-y-4">
          <div>
            <label className="text-xs font-medium text-gray-700">Nombre</label>
            <input required value={tipoServicioForm.nombre} onChange={e => setTipoServicioForm(f => ({ ...f, nombre: e.target.value }))} className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-700">Código (ej: CI, CP, SD)</label>
            <input required value={tipoServicioForm.codigo} onChange={e => setTipoServicioForm(f => ({ ...f, codigo: e.target.value.toUpperCase() }))} className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-700">Plazo máximo de entrega (días hábiles)</label>
            <input type="number" min="0" required value={tipoServicioForm.plazo_entrega_dias}
              onChange={e => setTipoServicioForm(f => ({ ...f, plazo_entrega_dias: e.target.value }))}
              className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            <p className="text-[10px] text-gray-500 mt-1">Cantidad de días hábiles desde la fecha de retiro hasta la entrega objetivo. Usado para el calendario de entregas en Despachos.</p>
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

      <Modal open={showDescuentoModal} onClose={() => { setShowDescuentoModal(false); setEditingDescuento(null) }}
        title={editingDescuento ? 'Editar descuento' : 'Agregar descuento'}>
        <form onSubmit={async e => {
          e.preventDefault()
          const valorNum = parseFloat(descuentoForm.valor) || 0
          const payload = { nombre: descuentoForm.nombre.trim(), tipo: descuentoForm.tipo, valor: valorNum }
          if (editingDescuento) {
            await patch('/api/descuentos', { id: editingDescuento.id, ...payload })
          } else {
            await post('/api/descuentos', payload)
          }
          setShowDescuentoModal(false)
          setEditingDescuento(null)
          setDescuentoForm({ nombre: '', tipo: 'variable', valor: '' })
        }} className="space-y-4">
          <div>
            <label className="text-xs font-medium text-gray-700">Nombre</label>
            <input required value={descuentoForm.nombre}
              onChange={e => setDescuentoForm(f => ({ ...f, nombre: e.target.value }))}
              placeholder="Ej: Descuento Municipalidad de Recoleta"
              className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-700">Tipo</label>
            <select value={descuentoForm.tipo}
              onChange={e => setDescuentoForm(f => ({ ...f, tipo: e.target.value as 'fijo' | 'variable' }))}
              className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
              <option value="variable">Variable (% del total)</option>
              <option value="fijo">Fijo (monto en CLP)</option>
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-700">
              {descuentoForm.tipo === 'fijo' ? 'Monto (CLP)' : 'Porcentaje (%)'}
            </label>
            <input required type="number" min="0" max={descuentoForm.tipo === 'variable' ? 100 : undefined}
              step={descuentoForm.tipo === 'variable' ? '0.1' : '1'}
              value={descuentoForm.valor}
              onChange={e => setDescuentoForm(f => ({ ...f, valor: e.target.value }))}
              className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            <p className="mt-1 text-xs text-gray-400">
              {descuentoForm.tipo === 'variable'
                ? 'Se aplica como porcentaje sobre el total (servicio + adicionales).'
                : 'Se descuenta este monto del total. Si el total es menor, se descuenta el total completo.'}
            </p>
          </div>
          <button type="submit" className="w-full bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg py-2 text-sm font-medium transition-colors">{editingDescuento ? 'Guardar cambios' : 'Guardar'}</button>
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
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
              {ROLES.filter(r => isAdminTotal || r.value === 'operador').map(r => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
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

type EmpresaCfg = {
  nombre: string; rut: string; giro: string
  direccion: string; comuna: string
  telefono: string; correo: string
  web: string; instagram: string; facebook: string
  google_review_url: string
  fecha_actualizacion?: string
}

const EMPRESA_EMPTY: EmpresaCfg = {
  nombre: '', rut: '', giro: '',
  direccion: '', comuna: '',
  telefono: '', correo: '',
  web: '', instagram: '', facebook: '',
  google_review_url: '',
}

function DatosPersonalesPanel() {
  const [form, setForm] = useState<EmpresaCfg>(EMPRESA_EMPTY)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [savedMsg, setSavedMsg] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    fetch('/api/empresa-config').then(r => r.json()).then(d => {
      if (cancelled) return
      if (d && typeof d === 'object' && !d.error) {
        setForm({
          nombre: d.nombre || '', rut: d.rut || '', giro: d.giro || '',
          direccion: d.direccion || '', comuna: d.comuna || '',
          telefono: d.telefono || '', correo: d.correo || '',
          web: d.web || '', instagram: d.instagram || '', facebook: d.facebook || '',
          google_review_url: d.google_review_url || '',
          fecha_actualizacion: d.fecha_actualizacion || '',
        })
      }
      setLoading(false)
    }).catch(() => setLoading(false))
    return () => { cancelled = true }
  }, [])

  async function guardar(e: React.FormEvent) {
    e.preventDefault()
    setError(''); setSavedMsg(''); setSaving(true)
    const res = await fetch('/api/empresa-config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    if (res.ok) {
      const j = await res.json()
      setForm(f => ({ ...f, fecha_actualizacion: j.data?.fecha_actualizacion || '' }))
      setSavedMsg('Guardado')
      setTimeout(() => setSavedMsg(''), 2500)
    } else {
      const e = await res.json().catch(() => ({}))
      setError(e.error || 'Error al guardar')
    }
    setSaving(false)
  }

  if (loading) {
    return <div className="text-sm text-gray-500">Cargando…</div>
  }

  return (
    <form onSubmit={guardar} className="bg-white rounded-xl shadow-md border-2 border-gray-200 p-6 max-w-3xl space-y-4">
      <div>
        <h2 className="text-base font-bold text-gray-900">Datos de la empresa</h2>
        <p className="text-xs text-gray-500">Estos datos están disponibles para mostrarlos en certificados, facturas y reportes.</p>
      </div>

      <Section title="Identidad">
        <Row>
          <Field label="Nombre / Razón social" value={form.nombre} onChange={v => setForm(f => ({ ...f, nombre: v }))} />
          <Field label="RUT" value={form.rut} onChange={v => setForm(f => ({ ...f, rut: v }))} placeholder="76.xxx.xxx-x" />
        </Row>
        <Field label="Giro" value={form.giro} onChange={v => setForm(f => ({ ...f, giro: v }))} />
      </Section>

      <Section title="Ubicación">
        <div>
          <label className="text-xs font-semibold text-gray-700">Dirección</label>
          <div className="mt-1">
            <AddressAutocomplete
              value={form.direccion}
              onChange={v => setForm(f => ({ ...f, direccion: v }))}
              placeholder="Empieza a escribir la dirección…"
              className="w-full border-2 border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
        </div>
        <Field label="Comuna" value={form.comuna} onChange={v => setForm(f => ({ ...f, comuna: v }))} />
      </Section>

      <Section title="Contacto">
        <Row>
          <Field label="Teléfono" value={form.telefono} onChange={v => setForm(f => ({ ...f, telefono: v }))} placeholder="+56 9 xxxx xxxx" />
          <Field label="Correo" value={form.correo} onChange={v => setForm(f => ({ ...f, correo: v }))} type="email" placeholder="contacto@almaanimal.cl" />
        </Row>
        <Field label="Página web" value={form.web} onChange={v => setForm(f => ({ ...f, web: v }))} placeholder="https://almaanimal.cl" />
      </Section>

      <Section title="Redes sociales">
        <Row>
          <Field label="Instagram" value={form.instagram} onChange={v => setForm(f => ({ ...f, instagram: v }))} placeholder="@almaanimal" />
          <Field label="Facebook" value={form.facebook} onChange={v => setForm(f => ({ ...f, facebook: v }))} placeholder="facebook.com/almaanimal" />
        </Row>
      </Section>

      <Section title="Reseñas">
        <Field
          label="Link de reseña de Google"
          value={form.google_review_url}
          onChange={v => setForm(f => ({ ...f, google_review_url: v }))}
          placeholder="https://g.page/r/…/review"
        />
        <p className="text-[11px] text-gray-500">Se usa en el botón “Evalúanos aquí” del correo de entrega. Pégalo desde tu Perfil de Empresa de Google → Pedir reseñas.</p>
      </Section>

      {error && <div className="bg-red-50 border border-red-200 text-red-800 rounded-lg px-3 py-2 text-sm">{error}</div>}

      <div className="flex items-center gap-3 pt-2">
        <button type="submit" disabled={saving}
          className="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-lg px-5 py-2 text-sm shadow-md disabled:opacity-50 transition-colors">
          {saving ? 'Guardando…' : 'Guardar'}
        </button>
        {savedMsg && <span className="text-sm text-green-600 font-medium">✓ {savedMsg}</span>}
        {form.fecha_actualizacion && (
          <span className="text-xs text-gray-500 ml-auto">
            Última actualización: {formatDate(form.fecha_actualizacion)}
          </span>
        )}
      </div>
    </form>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-gray-100 pt-3 space-y-2">
      <div className="text-[11px] uppercase tracking-wider font-semibold text-gray-500">{title}</div>
      {children}
    </div>
  )
}

function Row({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{children}</div>
}

function Field({ label, value, onChange, type = 'text', placeholder }: {
  label: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string
}) {
  return (
    <div>
      <label className="text-xs font-semibold text-gray-700">{label}</label>
      <input type={type} value={value} placeholder={placeholder}
        onChange={e => onChange(e.target.value)}
        className="mt-1 w-full border-2 border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
    </div>
  )
}
