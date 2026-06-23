'use client'
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { Modal } from '@/components/ui/Modal'
import { formatDate, formatDateTime, formatHoraDia } from '@/lib/dates'
import CalendarioContent from '@/components/marketing/CalendarioContent'

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

type AttachmentMeta = {
  filename: string
  key: string
  url: string
  size: number
  content_type: string
}

type Campana = {
  id: string
  asunto: string
  html_key: string
  html_url: string
  preview_text: string
  reply_to: string
  fecha_envio: string
  hora_envio: string
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
  attachments_json: string
  creado_por: string
  fecha_creacion: string
}

type Diagnostics = {
  resend_ok: boolean
  supabase_ok: boolean
  tracking_ok: boolean
  base_url: string | null
  is_dev: boolean
  base_missing: boolean
  base_localhost: boolean
  from_email: string
  sandbox_from: boolean
  webhook_secret: boolean
}

type Prefilled = { asunto: string; html: string; preview_text: string; reply_to: string; categoria: string } | null

type DebugData = {
  env?: {
    own_tracking_disabled: boolean
    webhook_permissive?: boolean
    public_app_url: string | null
    webhook_secret_set: boolean
    webhook_secret_prefix?: string | null
    from_email: string
    resend_key_set: boolean
    supabase_configured: boolean
    supabase_alive?: boolean | null
    supabase_error?: string | null
  }
  campana_id?: string | null
  contadores_planilla?: Record<string, unknown> | null
  contadores_reales?: Record<string, unknown> | null
  distribucion_logs?: Record<string, number>
  logs?: Array<{
    id: string
    campana_id: string
    vet_email: string
    resend_message_id: string | null
    estado: string | null
    fecha_envio: string | null
    fecha_entrega: string | null
    fecha_apertura: string | null
    fecha_click: string | null
    fecha_rebote: string | null
    error_msg: string | null
  }>
  interpretacion?: string[]
  error?: string
}

type ImagenBanco = {
  id: string
  url: string
  key: string
  descripcion: string
  prompt: string
  tags: string
  alt: string
  grupo: string
  whatsapp: boolean
  aspect: string
  origen: string
  modelo: string
  creado_por: string
  fecha_creacion: string
}

const TABS = ['Campañas', 'Base', 'Nueva campaña', 'Imágenes'] as const
type Tab = typeof TABS[number]
const TAB_ICONS: Record<Tab, string> = {
  'Campañas': '📊', 'Base': '👥', 'Nueva campaña': '✏️', 'Imágenes': '🖼️',
}

/**
 * Reescribe las imágenes de R2 del HTML para que el PREVIEW las cargue por el
 * proxy propio (/api/mailing/img-proxy): mismo origen → el navegador no las
 * bloquea (sandbox del iframe, adblockers que filtran *.r2.dev, etc.).
 * Solo afecta a la vista previa; el correo enviado usa las URLs directas.
 */
function proxyImgs(html: string): string {
  return html.replace(
    /src="(https:\/\/[^"]*\.r2\.dev\/[^"]+)"/gi,
    (_m, u) => `src="/api/mailing/img-proxy?u=${encodeURIComponent(u)}"`,
  )
}

const CATEGORIAS = ['prospecto', 'cliente', 'inactivo'] as const

// ===================== SELECTOR DE REDES =====================
// La sección "Campañas" arranca pidiendo qué red revisar. Hoy solo "Mail" está
// desarrollada (todo el módulo histórico); Instagram / Facebook / TikTok quedan
// como botones "Próximamente" para construir más adelante (en ese orden).

type Red = 'mail' | 'instagram' | 'facebook' | 'tiktok'

const REDES: { key: Red; label: string; icon: string; desc: string; activa: boolean; cardClass: string; iconClass: string }[] = [
  {
    key: 'mail', label: 'Mail', icon: '✉️', desc: 'Campañas de correo a la base de veterinarios.', activa: true,
    cardClass: 'border-indigo-200 hover:border-indigo-400 hover:shadow-md', iconClass: 'bg-indigo-100',
  },
  {
    key: 'instagram', label: 'Instagram', icon: '📸', desc: 'Planifica y publica posts orgánicos.', activa: true,
    cardClass: 'border-pink-200 hover:border-pink-400 hover:shadow-md', iconClass: 'bg-gradient-to-br from-amber-200 via-pink-200 to-fuchsia-300',
  },
  {
    key: 'facebook', label: 'Facebook', icon: '👍', desc: 'Planifica y publica posts orgánicos.', activa: true,
    cardClass: 'border-blue-200 hover:border-blue-400 hover:shadow-md', iconClass: 'bg-blue-100',
  },
  {
    key: 'tiktok', label: 'TikTok', icon: '🎵', desc: 'Videos cortos.', activa: false,
    cardClass: 'border-gray-300 hover:border-gray-500 hover:shadow-md', iconClass: 'bg-gray-900 text-white',
  },
]

type Vista = Red | 'calendario'

export default function CampanasPage() {
  const [vista, setVista] = useState<Vista | null>(null)
  if (vista === 'mail') return <MailContent onBack={() => setVista(null)} />
  if (vista === 'calendario') return <CalendarioContent onBack={() => setVista(null)} />
  // Instagram y Facebook se gestionan desde el calendario, filtrados por ese canal.
  if (vista === 'instagram' || vista === 'facebook') return <CalendarioContent canalInicial={vista} onBack={() => setVista(null)} />
  if (vista === 'tiktok') {
    const r = REDES.find(x => x.key === 'tiktok')!
    return <ProximamentePlaceholder red={r} onBack={() => setVista(null)} />
  }
  return <SelectorRedes onSelect={setVista} />
}

function SelectorRedes({ onSelect }: { onSelect: (r: Vista) => void }) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Campañas</h1>
        <p className="text-sm text-gray-500">Planifica con el agente de marketing o entra a una red para gestionar sus campañas.</p>
      </div>

      {/* Entrada destacada: Calendario + Agente (cerebro multicanal) */}
      <button
        onClick={() => onSelect('calendario')}
        className="w-full text-left bg-gradient-to-br from-indigo-600 to-violet-600 text-white rounded-2xl p-5 transition-all hover:shadow-lg hover:from-indigo-700 hover:to-violet-700"
      >
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl grid place-items-center text-2xl bg-white/15">🧠</div>
          <div className="flex-1">
            <h2 className="text-lg font-bold">Calendario y Agente de Marketing</h2>
            <p className="text-sm text-white/80 mt-0.5">Pedile un plan, aprobá las campañas, generá las piezas y publicá en email, Instagram y Facebook desde un solo lugar.</p>
          </div>
          <span className="text-2xl">→</span>
        </div>
      </button>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {REDES.map(r => (
          <button
            key={r.key}
            onClick={() => onSelect(r.key)}
            className={`text-left bg-white rounded-2xl border-2 p-5 transition-all ${r.cardClass}`}
          >
            <div className={`w-12 h-12 rounded-xl grid place-items-center text-2xl ${r.iconClass}`}>{r.icon}</div>
            <div className="mt-3 flex items-center gap-2 flex-wrap">
              <h2 className="text-lg font-bold text-gray-900">{r.label}</h2>
              {r.activa
                ? <span className="text-[10px] font-bold uppercase tracking-wide bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-full">Activo</span>
                : <span className="text-[10px] font-bold uppercase tracking-wide bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full">Próximamente</span>}
            </div>
            <p className="text-sm text-gray-500 mt-1">{r.desc}</p>
          </button>
        ))}
      </div>
    </div>
  )
}

function ProximamentePlaceholder({ red, onBack }: { red: { label: string; icon: string; iconClass: string }; onBack: () => void }) {
  return (
    <div className="space-y-4">
      <button onClick={onBack} className="text-sm text-indigo-600 hover:text-indigo-800 font-semibold">← Campañas</button>
      <div className="bg-white rounded-2xl border-2 border-dashed border-gray-200 p-10 text-center">
        <div className={`w-16 h-16 rounded-2xl grid place-items-center text-3xl mx-auto ${red.iconClass}`}>{red.icon}</div>
        <h1 className="text-2xl font-bold text-gray-900 mt-4">{red.label}</h1>
        <p className="text-sm text-gray-500 mt-2 max-w-md mx-auto">
          Las campañas de {red.label} todavía están en construcción. Pronto vas a poder crearlas y revisarlas desde acá.
        </p>
        <span className="inline-block mt-4 text-xs font-bold uppercase tracking-wide bg-gray-100 text-gray-500 px-3 py-1 rounded-full">Próximamente</span>
      </div>
    </div>
  )
}

// ===================== MAIL (módulo histórico completo) =====================

function MailContent({ onBack }: { onBack: () => void }) {
  const [tab, setTab] = useState<Tab>('Campañas')
  const [prefilled, setPrefilled] = useState<Prefilled>(null)
  const [campanasRefreshKey, setCampanasRefreshKey] = useState(0)
  const [diag, setDiag] = useState<Diagnostics | null>(null)

  function abrirDuplicar(p: Exclude<Prefilled, null>) {
    setPrefilled(p)
    setTab('Nueva campaña')
  }

  function onCampanaCreada() {
    setPrefilled(null)
    setCampanasRefreshKey(k => k + 1)
    setTab('Campañas')
  }

  useEffect(() => {
    fetch('/api/mailing/diagnostics').then(r => r.ok ? r.json() : null).then(d => {
      if (d && typeof d === 'object') setDiag(d as Diagnostics)
    }).catch(() => {})
  }, [])

  return (
    <div className="space-y-4">
      <div>
        <button onClick={onBack} className="text-sm text-indigo-600 hover:text-indigo-800 font-semibold mb-1">← Campañas</button>
        <div className="flex items-center gap-2">
          <span className="w-9 h-9 rounded-lg bg-indigo-100 grid place-items-center text-xl">✉️</span>
          <h1 className="text-2xl font-bold text-gray-900">Mail</h1>
        </div>
        <p className="text-sm text-gray-500 mt-0.5">Campañas de email a la base de veterinarios.</p>
      </div>

      {diag && <DiagBanner d={diag} />}

      <div className="inline-flex gap-1 bg-gray-100 border border-gray-200 rounded-2xl p-1.5 shadow-sm overflow-x-auto">
        {TABS.map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 rounded-xl text-sm font-semibold whitespace-nowrap transition-all flex items-center gap-1.5 ${
              tab === t
                ? 'bg-indigo-600 text-white shadow-md ring-1 ring-indigo-700/10'
                : 'text-gray-600 hover:bg-white hover:text-gray-900'
            }`}
          >
            <span aria-hidden>{TAB_ICONS[t]}</span>
            {t}
          </button>
        ))}
      </div>

      {tab === 'Campañas' && <CampanasPanel refreshKey={campanasRefreshKey} onDuplicar={abrirDuplicar} />}
      {tab === 'Base' && <BasePanel />}
      {tab === 'Nueva campaña' && <NuevaCampanaPanel initial={prefilled} onCreada={onCampanaCreada} />}
      {tab === 'Imágenes' && <ImagenesPanel />}
    </div>
  )
}

function DiagBanner({ d }: { d: Diagnostics }) {
  // Solo dev local con localhost: banner informativo amarillo claro, no rojo de error
  if (d.is_dev && d.base_localhost && d.resend_ok && d.supabase_ok && !d.sandbox_from) {
    return (
      <div className="bg-sky-50 border border-sky-200 rounded-lg px-4 py-2.5 text-sm text-sky-900 flex items-start gap-2">
        <span className="inline-flex w-2 h-2 rounded-full bg-sky-500 mt-1.5 shrink-0"></span>
        <div>
          <b>Modo desarrollo local</b> — el tracking de aperturas y clicks no funcionará desde acá porque Gmail no puede llegar a <code className="bg-sky-100 rounded px-1 text-[12px]">{d.base_url}</code>. En producción funciona automáticamente si configurás <code className="bg-sky-100 rounded px-1 text-[12px]">PUBLIC_APP_URL</code> en Vercel.
        </div>
      </div>
    )
  }

  const problemas: string[] = []
  if (!d.resend_ok) problemas.push('RESEND_API_KEY no configurada')
  if (!d.supabase_ok) problemas.push('Supabase no configurada (no se guardan logs de envío)')
  if (!d.tracking_ok && !d.is_dev) problemas.push(`URL pública inválida (${d.base_url || 'vacía'}). El tracking de aperturas y clicks NO va a funcionar — configurá PUBLIC_APP_URL en Vercel.`)
  if (d.sandbox_from) problemas.push(`Remitente está usando el sandbox de Resend (${d.from_email}). Configurá MAILING_FROM_EMAIL con tu dominio verificado.`)

  if (problemas.length === 0) {
    return (
      <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-2.5 text-sm text-emerald-800 flex items-center gap-2">
        <span className="inline-flex w-2 h-2 rounded-full bg-emerald-500"></span>
        <span><b>Mailing OK</b> — Resend conectado · tracking activo · logs persistidos en Supabase.</span>
      </div>
    )
  }

  const critico = !d.resend_ok || (!d.tracking_ok && !d.is_dev)
  const cls = critico
    ? 'bg-red-50 border-red-200 text-red-800'
    : 'bg-amber-50 border-amber-200 text-amber-900'
  const dot = critico ? 'bg-red-500' : 'bg-amber-500'

  return (
    <div className={`border rounded-lg px-4 py-2.5 text-sm ${cls}`}>
      <div className="flex items-center gap-2 font-semibold">
        <span className={`inline-flex w-2 h-2 rounded-full ${dot}`}></span>
        Mailing con problemas de configuración
      </div>
      <ul className="mt-1 ml-5 list-disc text-[13px] space-y-0.5">
        {problemas.map((p, i) => <li key={i}>{p}</li>)}
      </ul>
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
        <StatBox label="Total" value={stats.total} icon="📋" />
        <StatBox label="Suscritos" value={stats.suscritos} accent="green" icon="✅" />
        <StatBox label="Prospectos" value={stats.prospectos} accent="indigo" icon="🎯" />
        <StatBox label="Clientes" value={stats.clientes} accent="emerald" icon="💚" />
        <StatBox label="Inactivos" value={stats.inactivos} accent="gray" icon="💤" />
      </div>

      {vets.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          <DistribucionPanel title="Distribución por categoría" data={distCategoria} total={vets.length} colorMap={{ prospecto: 'indigo', cliente: 'emerald', inactivo: 'gray' }} />
          <DistribucionPanel title="Distribución por suscripción" data={distSuscrito} total={vets.length} colorMap={{ 'Suscritos': 'green', 'Desuscritos': 'red' }} />
          <DistribucionPanel title="Distribución por comuna" data={distComuna} total={vets.length} colorMap={{}} maxRows={10} />
        </div>
      )}

      <div className="bg-white rounded-2xl shadow-sm border-2 border-gray-200 overflow-hidden">
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

function StatBox({ label, value, accent, icon }: { label: string; value: number; accent?: 'green' | 'indigo' | 'emerald' | 'gray'; icon?: string }) {
  const color = accent === 'green' ? 'text-green-700' :
                accent === 'indigo' ? 'text-indigo-700' :
                accent === 'emerald' ? 'text-emerald-700' :
                accent === 'gray' ? 'text-gray-600' :
                'text-gray-900'
  const tint = accent === 'green' ? 'bg-green-100' :
               accent === 'indigo' ? 'bg-indigo-100' :
               accent === 'emerald' ? 'bg-emerald-100' :
               'bg-gray-100'
  return (
    <div className="bg-white rounded-2xl shadow-sm border-2 border-gray-200 px-4 py-3 flex items-center gap-3">
      {icon && <div className={`w-10 h-10 rounded-xl grid place-items-center text-xl shrink-0 ${tint}`}>{icon}</div>}
      <div className="min-w-0">
        <div className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">{label}</div>
        <div className={`text-2xl font-bold ${color}`}>{value}</div>
      </div>
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
    <div className="bg-white rounded-2xl shadow-sm border-2 border-gray-200 p-4">
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
  const [debugData, setDebugData] = useState<DebugData | null>(null)
  const [debugLoading, setDebugLoading] = useState(false)

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

  async function reanudar(c: Campana) {
    const totalDest = parseInt(c.total_destinatarios || '0', 10) || 0
    const enviadosAct = parseInt(c.enviados || '0', 10) || 0
    const faltantesAprox = Math.max(0, totalDest - enviadosAct)
    if (!confirm(
      `Reanudar envío de "${c.asunto}"?\n\n` +
      `Total destinatarios:    ${totalDest}\n` +
      `Ya enviados:            ${enviadosAct}\n` +
      `Faltan (aprox):         ${faltantesAprox}\n\n` +
      `Voy a consultar mailing_logs y mandar SOLO a los que no recibieron todavía. ` +
      `Es seguro re-correrlo: no se duplican envíos.`
    )) return
    const res = await fetch(`/api/mailing/campanas/${c.id}/reanudar`, { method: 'POST' })
    const j = await res.json().catch(() => ({}))
    if (!res.ok) {
      alert('Error: ' + (j.error ?? res.status))
      return
    }
    if (j.nada_para_reanudar) {
      alert(`No hay nada para reanudar. Los ${j.total_destinatarios} destinatarios ya tienen log.\n\nLa campaña queda como "enviado".`)
    } else {
      alert(
        `Reanudación OK:\n` +
        `- Faltaban: ${j.faltantes}\n` +
        `- Enviados ahora: ${j.enviados_ahora}\n` +
        `- Fallidos ahora: ${j.fallidos_ahora}`
      )
    }
    await fetchCampanas()
  }

  async function abrirDebug(c: Campana) {
    setDebugLoading(true)
    setDebugData(null)
    try {
      const res = await fetch(`/api/mailing/debug?campana_id=${encodeURIComponent(c.id)}&limit=50`)
      const j = await res.json()
      setDebugData(j as DebugData)
    } catch (e) {
      setDebugData({ error: e instanceof Error ? e.message : String(e) } as DebugData)
    } finally {
      setDebugLoading(false)
    }
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

  async function cancelar(c: Campana) {
    if (!confirm(`¿Cancelar el envío de "${c.asunto}"?\n\nLos emails que ya despachó Resend no se pueden recuperar. Solo se aborta lo que falta.`)) return
    const res = await fetch(`/api/mailing/campanas/${c.id}/cancelar`, { method: 'POST' })
    if (res.ok) {
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
      <div className="bg-white rounded-2xl shadow-sm border-2 border-gray-200 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-sm text-gray-400">Cargando…</div>
        ) : campanasEnviadas.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-400">
            Sin campañas enviadas todavía. Crea y enviá una desde la tab &quot;Nueva campaña&quot;.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[820px] table-fixed">
              <colgroup>
                <col className="w-[24%]" />{/* Asunto */}
                <col className="w-[72px]" />{/* Estado */}
                <col className="w-[56px]" />{/* Dest. */}
                <col className="w-[72px]" />{/* Enviados */}
                <col className="w-[92px]" />{/* Aperturas */}
                <col className="w-[84px]" />{/* Clicks */}
                <col className="w-[84px]" />{/* Rebotes */}
                <col className="w-[92px]" />{/* Fecha */}
                <col className="w-[52px]" />{/* Hora */}
                <col className="w-[120px]" />{/* Acciones */}
              </colgroup>
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr className="text-[11px] text-gray-500 uppercase tracking-wider">
                  <th className="px-4 py-3 text-left font-semibold">Asunto</th>
                  <th className="px-2 py-3 text-center font-semibold">Estado</th>
                  <th className="px-2 py-3 text-right font-semibold">Dest.</th>
                  <th className="px-2 py-3 text-right font-semibold">Env.</th>
                  <th className="px-2 py-3 text-right font-semibold">Aper.</th>
                  <th className="px-2 py-3 text-right font-semibold">Clicks</th>
                  <th className="px-2 py-3 text-right font-semibold">Reb.</th>
                  <th className="px-3 py-3 text-left font-semibold">Fecha</th>
                  <th className="px-2 py-3 text-left font-semibold">Hora</th>
                  <th className="px-3 py-3 text-center font-semibold">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {campanasEnviadas.map(c => {
                  const total = parseInt(c.enviados || '0', 10)
                  const aperturas = parseInt(c.aperturas || '0', 10)
                  const clicks = parseInt(c.clicks || '0', 10)
                  const rebotes = parseInt(c.rebotes || '0', 10)
                  const tasaApertura = total > 0 ? Math.round(100 * aperturas / total) : 0
                  const tasaClick = total > 0 ? Math.round(100 * clicks / total) : 0
                  const tasaRebote = total > 0 ? Math.round(100 * rebotes / total) : 0
                  return (
                    <tr key={c.id} className="hover:bg-indigo-50/40 cursor-pointer transition-colors" onClick={() => abrirDetalle(c)}>
                      <td className="px-4 py-2.5 text-gray-900 font-medium truncate">{c.asunto}</td>
                      <td className="px-2 py-2.5 text-center"><EstadoBadge estado={c.estado} /></td>
                      <td className="px-2 py-2.5 text-right text-gray-700 tabular-nums">{c.total_destinatarios || '0'}</td>
                      <td className="px-2 py-2.5 text-right text-gray-700 tabular-nums">{c.enviados || '0'}</td>
                      <td className="px-2 py-2.5 text-right text-gray-800 tabular-nums">
                        <span className="font-medium">{c.aperturas || '0'}</span>
                        <span className={`text-[11px] ml-1 font-semibold ${tasaApertura > 0 ? 'text-emerald-600' : 'text-gray-400'}`}>{tasaApertura}%</span>
                      </td>
                      <td className="px-2 py-2.5 text-right text-gray-800 tabular-nums">
                        <span className="font-medium">{c.clicks || '0'}</span>
                        <span className={`text-[11px] ml-1 font-semibold ${tasaClick > 0 ? 'text-violet-600' : 'text-gray-400'}`}>{tasaClick}%</span>
                      </td>
                      <td className="px-2 py-2.5 text-right text-gray-800 tabular-nums">
                        <span className="font-medium">{c.rebotes || '0'}</span>
                        <span className={`text-[11px] ml-1 font-semibold ${tasaRebote > 0 ? 'text-red-600' : 'text-gray-400'}`}>{tasaRebote}%</span>
                      </td>
                      <td className="px-3 py-2.5 text-gray-600 text-xs whitespace-nowrap">{formatDate(c.fecha_envio) || '—'}</td>
                      <td className="px-2 py-2.5 text-gray-600 text-xs whitespace-nowrap tabular-nums">{formatHoraDia(c.hora_envio)}</td>
                      <td className="px-3 py-2.5" onClick={e => e.stopPropagation()}>
                        <div className="flex gap-1 justify-center">
                          {c.estado === 'enviando' && (
                            <>
                              <button onClick={() => reanudar(c)} className="bg-emerald-600 hover:bg-emerald-700 text-white w-7 h-7 grid place-items-center rounded-md text-sm shadow-sm" title="Reanudar envío a los que faltan">↻</button>
                              <button onClick={() => cancelar(c)} className="bg-amber-600 hover:bg-amber-700 text-white w-7 h-7 grid place-items-center rounded-md text-sm shadow-sm" title="Cancelar envío">✕</button>
                            </>
                          )}
                          {(c.estado === 'enviado' || c.estado === 'fallido' || c.estado === 'cancelado') && (
                            <button onClick={() => reanudar(c)} className="bg-emerald-600 hover:bg-emerald-700 text-white w-7 h-7 grid place-items-center rounded-md text-sm shadow-sm" title="Reanudar / reintentar fallidos">↻</button>
                          )}
                          {(c.estado === 'enviado' || c.estado === 'fallido' || c.estado === 'cancelado') && (
                            <button onClick={() => duplicar(c)} className="bg-indigo-600 hover:bg-indigo-700 text-white w-7 h-7 grid place-items-center rounded-md text-sm shadow-sm" title="Duplicar campaña">⧉</button>
                          )}
                          {(c.estado === 'enviado' || c.estado === 'fallido') && (
                            <button onClick={() => abrirDebug(c)} className="bg-gray-700 hover:bg-gray-800 text-white w-7 h-7 grid place-items-center rounded-md text-sm shadow-sm" title="Ver diagnóstico de tracking">🔍</button>
                          )}
                          {c.estado !== 'enviando' && (
                            <button onClick={() => eliminar(c)} className="bg-red-600 hover:bg-red-700 text-white w-7 h-7 grid place-items-center rounded-md text-sm shadow-sm" title="Eliminar campaña">🗑</button>
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

      {/* Modal de diagnóstico de tracking */}
      <Modal open={!!debugData || debugLoading} onClose={() => { setDebugData(null) }} title="Diagnóstico de tracking">
        {debugLoading && <p className="text-sm text-gray-500">Cargando…</p>}
        {debugData && !debugLoading && (
          <div className="space-y-4 text-xs">
            {debugData.error && (
              <div className="bg-red-50 border-2 border-red-200 text-red-800 rounded-lg px-3 py-2">
                {debugData.error}
              </div>
            )}
            {debugData.env && (
              <section>
                <h3 className="text-sm font-bold text-gray-900 mb-2">Variables de entorno</h3>
                <ul className="bg-gray-50 border border-gray-200 rounded-lg p-3 space-y-1 font-mono">
                  <li>MAILING_DISABLE_OWN_TRACKING: <b className={debugData.env.own_tracking_disabled ? 'text-emerald-700' : 'text-amber-700'}>{String(debugData.env.own_tracking_disabled)}</b></li>
                  <li>MAILING_WEBHOOK_PERMISSIVE: <b className={debugData.env.webhook_permissive ? 'text-emerald-700' : 'text-amber-700'}>{String(debugData.env.webhook_permissive ?? false)}</b></li>
                  <li>PUBLIC_APP_URL: {debugData.env.public_app_url ?? '(vacío)'}</li>
                  <li>RESEND_WEBHOOK_SECRET: {debugData.env.webhook_secret_set ? `✓ set (${debugData.env.webhook_secret_prefix})` : '✗ ausente'}</li>
                  <li>RESEND_API_KEY: {debugData.env.resend_key_set ? '✓ set' : '✗ ausente'}</li>
                  <li>Supabase: {
                    !debugData.env.supabase_configured
                      ? <b className="text-red-700">✗ no configurado</b>
                      : debugData.env.supabase_alive === false
                        ? <b className="text-red-700">✗ NO responde — {debugData.env.supabase_error}</b>
                        : debugData.env.supabase_alive === true
                          ? <b className="text-emerald-700">✓ conectado y respondiendo</b>
                          : <b className="text-amber-700">env vars OK pero sin verificar</b>
                  }</li>
                  <li>From: {debugData.env.from_email}</li>
                </ul>
              </section>
            )}
            {debugData.contadores_reales && (
              <section>
                <h3 className="text-sm font-bold text-emerald-700 mb-2">Contadores reales (calculados desde Supabase ahora)</h3>
                <pre className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 overflow-x-auto">
                  {JSON.stringify(debugData.contadores_reales, null, 2)}
                </pre>
              </section>
            )}
            {debugData.contadores_planilla && (
              <section>
                <h3 className="text-sm font-bold text-gray-600 mb-2">Contadores en planilla (cacheados)</h3>
                <pre className="bg-gray-50 border border-gray-200 rounded-lg p-3 overflow-x-auto text-gray-600">
                  {JSON.stringify(debugData.contadores_planilla, null, 2)}
                </pre>
                <p className="text-[11px] text-gray-500 mt-1 italic">Los reales (verde) son la fuente de verdad. Estos pueden estar atrasados.</p>
              </section>
            )}
            {debugData.distribucion_logs && Object.keys(debugData.distribucion_logs).length > 0 && (
              <section>
                <h3 className="text-sm font-bold text-gray-900 mb-2">Distribución de estados en logs</h3>
                <pre className="bg-gray-50 border border-gray-200 rounded-lg p-3 overflow-x-auto">
                  {JSON.stringify(debugData.distribucion_logs, null, 2)}
                </pre>
              </section>
            )}
            {debugData.interpretacion && debugData.interpretacion.length > 0 && (
              <section>
                <h3 className="text-sm font-bold text-gray-900 mb-2">Interpretación</h3>
                <ul className="bg-indigo-50 border border-indigo-200 rounded-lg p-3 space-y-1">
                  {debugData.interpretacion.map((l, i) => (
                    <li key={i} className={l.startsWith('⚠') ? 'text-amber-800 font-semibold' : 'text-gray-700'}>{l}</li>
                  ))}
                </ul>
              </section>
            )}
            {debugData.logs && debugData.logs.length > 0 && (
              <section>
                {(() => {
                  // Agrupamos los error_msg de los failed para ver qué dijo Resend
                  const fails = debugData.logs!.filter(l => l.estado === 'failed' && l.error_msg)
                  const grupos = new Map<string, number>()
                  for (const f of fails) {
                    const k = (f.error_msg ?? '').slice(0, 200)
                    grupos.set(k, (grupos.get(k) || 0) + 1)
                  }
                  if (grupos.size === 0) return null
                  return (
                    <section className="mb-3">
                      <h3 className="text-sm font-bold text-red-700 mb-2">Errores de envío agrupados ({fails.length})</h3>
                      <div className="bg-red-50 border border-red-200 rounded-lg p-3 space-y-1.5">
                        {Array.from(grupos.entries()).sort((a, b) => b[1] - a[1]).map(([msg, cnt]) => (
                          <div key={msg} className="flex gap-2 items-start text-xs">
                            <span className="bg-red-200 text-red-900 font-bold px-2 py-0.5 rounded shrink-0">×{cnt}</span>
                            <span className="text-red-900 break-all">{msg || '(sin mensaje)'}</span>
                          </div>
                        ))}
                      </div>
                    </section>
                  )
                })()}
                <h3 className="text-sm font-bold text-gray-900 mb-2">Logs ({debugData.logs.length})</h3>
                <div className="border border-gray-200 rounded-lg overflow-hidden max-h-96 overflow-y-auto">
                  <table className="w-full text-[11px]">
                    <thead className="bg-gray-100 sticky top-0">
                      <tr>
                        {['Email', 'Estado', 'Sent', 'Delivered', 'Opened', 'Clicked', 'Bounced', 'Error'].map(h => (
                          <th key={h} className="px-2 py-1 text-left text-gray-600">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {debugData.logs.map(l => (
                        <tr key={l.id}>
                          <td className="px-2 py-1 text-gray-900 truncate max-w-[180px]" title={l.vet_email}>{l.vet_email}</td>
                          <td className="px-2 py-1 text-gray-700">{l.estado}</td>
                          <td className="px-2 py-1 text-gray-500">{l.fecha_envio ? '✓' : '—'}</td>
                          <td className="px-2 py-1 text-gray-500">{l.fecha_entrega ? '✓' : '—'}</td>
                          <td className="px-2 py-1 text-emerald-700">{l.fecha_apertura ? '✓' : '—'}</td>
                          <td className="px-2 py-1 text-violet-700">{l.fecha_click ? '✓' : '—'}</td>
                          <td className="px-2 py-1 text-red-700">{l.fecha_rebote ? '✓' : '—'}</td>
                          <td className="px-2 py-1 text-red-700 truncate max-w-[200px]" title={l.error_msg ?? ''}>{l.error_msg ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}
          </div>
        )}
      </Modal>

      <Modal open={!!detalle} onClose={() => setDetalle(null)} title={detalle ? `Campaña: ${detalle.asunto}` : ''}>
        {detalle && (
          <div className="space-y-3">
            <MetricasCampana detalle={detalle} />

            <div className="border border-gray-200 rounded-lg overflow-hidden">
              <div className="bg-gray-50 px-3 py-2 text-xs font-semibold text-gray-700">Preview HTML</div>
              {loadingDetalle ? (
                <div className="p-8 text-center text-sm text-gray-400">Cargando…</div>
              ) : (
                <iframe srcDoc={proxyImgs(detalleHtml)} className="w-full h-96 bg-white" sandbox="allow-same-origin" referrerPolicy="no-referrer" />
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
    cancelando: 'bg-orange-100 text-orange-800',
    cancelado: 'bg-zinc-200 text-zinc-700',
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
  const [generarOpen, setGenerarOpen] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [iaComentario, setIaComentario] = useState('')
  const [iaEditando, setIaEditando] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const htmlRef = useRef<HTMLTextAreaElement>(null)

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
    if (fileRef.current) fileRef.current.value = ''
    // Procesar imágenes embebidas como data:base64 — Gmail/Outlook las bloquean por
    // tamaño. Las subimos a R2 y reescribimos el src en el HTML.
    const { html: nuevoHtml, subidas, fallidas, locales } = await procesarImagenesInline(text)
    setForm(f => ({ ...f, html: nuevoHtml }))
    setError('')
    const partes: string[] = []
    if (subidas > 0) partes.push(`${subidas} imagen${subidas === 1 ? '' : 'es'} embebida${subidas === 1 ? '' : 's'} subida${subidas === 1 ? '' : 's'} a R2`)
    if (fallidas > 0) partes.push(`${fallidas} fallaron al subir`)
    if (locales.length > 0) partes.push(`⚠ ${locales.length} con ruta local/relativa que no se ven en el inbox: ${locales.slice(0, 3).join(', ')}${locales.length > 3 ? '…' : ''}`)
    if (partes.length > 0) setInfo(partes.join(' · '))
    else setInfo('HTML cargado')
  }

  /**
   * Detecta <img src="data:image/...;base64,..."> y los sube a R2.
   * También detecta src locales (file://, C:\, rutas relativas) y los reporta sin tocar.
   */
  async function procesarImagenesInline(html: string): Promise<{
    html: string
    subidas: number
    fallidas: number
    locales: string[]
  }> {
    let subidas = 0
    let fallidas = 0
    const locales: string[] = []
    const dataUrlRe = /src=(["'])(data:image\/[^"';]+;base64,[^"']+)\1/gi
    const matches: Array<{ full: string; quote: string; dataUrl: string }> = []
    let m: RegExpExecArray | null
    while ((m = dataUrlRe.exec(html)) !== null) {
      matches.push({ full: m[0], quote: m[1], dataUrl: m[2] })
    }
    let resultado = html
    for (const it of matches) {
      try {
        const r = await fetch('/api/mailing/upload-image', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ data_url: it.dataUrl }),
        })
        const j = await r.json()
        if (r.ok && j.url) {
          resultado = resultado.replace(it.full, `src=${it.quote}${j.url}${it.quote}`)
          subidas++
        } else {
          fallidas++
        }
      } catch {
        fallidas++
      }
    }
    // Detectar rutas locales que Gmail no puede resolver
    const localRe = /src=(["'])((?:file:\/\/|[A-Za-z]:\\|\.{1,2}\/|\/[^/])[^"']*)\1/gi
    let lm: RegExpExecArray | null
    while ((lm = localRe.exec(resultado)) !== null) {
      // Excluir CIDs y URLs que empiecen con "/" pero que sean del propio sitio (raro pero por las dudas)
      if (lm[2].startsWith('cid:')) continue
      locales.push(lm[2].slice(0, 60))
    }
    return { html: resultado, subidas, fallidas, locales }
  }

  // Edición con IA directo sobre el preview: manda la campaña actual + el
  // comentario al mismo agente de "Generar con IA", que la devuelve ajustada.
  async function editarConIA() {
    if (!iaComentario.trim() || !form.html.trim()) return
    setIaEditando(true); setError(''); setInfo('')
    try {
      const res = await fetch('/api/mailing/generar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instruccion: 'Edita esta campaña existente aplicando el comentario del usuario. Mantén todo lo que no se pida cambiar (copy, imágenes, estructura).',
          categoria: form.categoria,
          comentario: iaComentario,
          actual: { asunto: form.asunto, preview_text: form.preview_text, html: form.html },
        }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { setError(j.error || `Error ${res.status}`); return }
      setForm(f => ({
        ...f,
        asunto: j.asunto || f.asunto,
        preview_text: j.preview_text || f.preview_text,
        html: j.html || f.html,
      }))
      setIaComentario('')
      const avisos = Array.isArray(j.avisos) && j.avisos.length > 0 ? ` · ⚠ ${j.avisos.join(' · ')}` : ''
      setInfo(`Campaña ajustada con IA. Revisa el preview${avisos}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error de red')
    } finally {
      setIaEditando(false)
    }
  }

  function insertarImagen(img: ImagenBanco) {
    const tag = `\n<img src="${img.url}" alt="${(img.alt || img.descripcion || '').replace(/"/g, '&quot;')}" style="width:100%;max-width:560px;height:auto;display:block;border:0;border-radius:8px;margin:12px auto" />\n`
    const el = htmlRef.current
    if (el && typeof el.selectionStart === 'number') {
      const start = el.selectionStart
      const end = el.selectionEnd
      const next = form.html.slice(0, start) + tag + form.html.slice(end)
      setForm(f => ({ ...f, html: next }))
    } else {
      setForm(f => ({ ...f, html: f.html + tag }))
    }
    setPickerOpen(false)
    setInfo('Imagen insertada en el HTML')
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
    // SIEMPRE guardar borrador antes (no solo si es nuevo). Si el usuario edita
    // el HTML después de la primera vez —p.ej. cargando un nuevo .html con
    // imágenes que se acaban de subir a R2—, hay que subir el HTML actualizado
    // a R2 antes de mandar el test. El endpoint /test lee de R2, no del form.
    const id = await guardarBorrador()
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
    <div className="grid grid-cols-1 lg:grid-cols-9 gap-4">
      <div className="lg:col-span-5 bg-white rounded-2xl shadow-sm border-2 border-gray-200 p-5 space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h2 className="text-base font-bold text-gray-900">{draftId ? `Editando borrador N° ${draftId}` : 'Nueva campaña'}</h2>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setGenerarOpen(true)}
              className="inline-flex items-center gap-1.5 bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white text-xs font-semibold rounded-lg px-3 py-1.5 shadow-sm transition-colors">
              <span>✨</span> Generar con IA
            </button>
            {draftId && (
              <button type="button" onClick={nuevaCampana}
                className="inline-flex items-center gap-1 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg px-3 py-1.5 shadow-sm transition-colors">
                <span>+</span> Empezar campaña nueva
              </button>
            )}
          </div>
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
          <div className="flex items-center justify-between gap-2 mb-1.5 flex-wrap">
            <label className="text-xs font-semibold text-gray-700">HTML del email *</label>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => setPickerOpen(true)}
                className="inline-flex items-center gap-1 border-2 border-violet-200 bg-violet-50 text-violet-700 hover:bg-violet-100 text-xs font-semibold rounded-lg px-2.5 py-1 transition-colors">
                🖼 Insertar imagen del banco
              </button>
              <button type="button" onClick={() => fileRef.current?.click()}
                className="inline-flex items-center gap-1 border-2 border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 text-xs font-semibold rounded-lg px-2.5 py-1 transition-colors">
                📁 Cargar desde archivo (.html)
              </button>
            </div>
            <input ref={fileRef} type="file" accept=".html,text/html" onChange={onFileChange} className="hidden" />
          </div>
          <textarea ref={htmlRef} value={form.html} onChange={e => setForm(f => ({ ...f, html: e.target.value }))}
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

      <div className="lg:col-span-4 bg-white rounded-2xl shadow-sm border-2 border-gray-200 p-3 flex flex-col">
        <div className="text-xs font-semibold text-gray-700 mb-2 flex items-center justify-between">
          <span>Preview (con vet de muestra)</span>
          <span className="text-[10px] font-normal text-gray-400">así lo va a ver el destinatario</span>
        </div>
        <iframe
          srcDoc={previewHtml ? proxyImgs(previewHtml) : '<p style="font-family:sans-serif;color:#999;padding:1rem">Escribe HTML para ver el preview.</p>'}
          className="w-full h-[660px] border border-gray-200 rounded bg-white"
          sandbox="allow-same-origin"
          referrerPolicy="no-referrer"
        />
        {/* Editar con IA directo sobre el preview */}
        <div className="mt-3 border border-violet-200 bg-violet-50/60 rounded-lg p-2.5 space-y-1.5">
          <label className="text-[11px] font-bold text-violet-800">✨ Editar con IA</label>
          <textarea
            value={iaComentario}
            onChange={e => setIaComentario(e.target.value)}
            rows={2}
            placeholder="Ej: cambia el título, hazlo más corto, usa una foto de un gato del banco, tono más formal…"
            className="w-full border-2 border-violet-200 bg-white rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-violet-500"
          />
          <button
            type="button"
            onClick={editarConIA}
            disabled={iaEditando || !iaComentario.trim() || !form.html.trim()}
            className="w-full bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white rounded-lg py-1.5 text-xs font-semibold shadow-sm disabled:opacity-50"
          >
            {iaEditando ? 'Aplicando cambios… (puede tardar)' : 'Aplicar cambios al correo'}
          </button>
        </div>
      </div>

      {borradores.length > 0 && (
        <div className="lg:col-span-9 bg-white rounded-2xl shadow-sm border-2 border-gray-200 overflow-hidden">
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

      <GenerarCampanaModal
        open={generarOpen}
        onClose={() => setGenerarOpen(false)}
        categoriaInicial={form.categoria}
        onUsar={(r, categoria) => {
          setForm(f => ({ ...f, asunto: r.asunto, preview_text: r.preview_text, html: r.html, categoria }))
          setError('')
          setInfo('Campaña generada con IA. Revisa el preview y envía un test antes del envío real.')
          setGenerarOpen(false)
        }}
      />

      <ImagenPickerModal open={pickerOpen} onClose={() => setPickerOpen(false)} onPick={insertarImagen} />

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

// ===================== GENERAR CAMPAÑA CON IA =====================

type GenImagen = { url: string; alt: string; origen: 'ai' | 'reuse'; id?: string }
type GenResult = { asunto: string; preview_text: string; html: string; imagenes?: GenImagen[]; avisos?: string[] }

const TONOS = [
  'Profesional e institucional',
  'Cercano y humano',
  'Directo y comercial',
  'Informativo / educativo',
] as const

const FORMATOS = [
  { value: 'auto', label: 'Automático (que elija la IA)' },
  { value: 'newsletter', label: 'Newsletter (varias secciones)' },
  { value: 'correo', label: 'Correo simple (mensaje directo)' },
  { value: 'folleto', label: 'Folleto / promocional (visual)' },
  { value: 'anuncio', label: 'Anuncio / novedad (una noticia)' },
] as const

/** Rellena las variables {{...}} con un vet de muestra, solo para el preview. */
function sampleFill(html: string): string {
  const vars: Record<string, string> = {
    nombre: 'Dra. María José Soto', primer_nombre: 'María José',
    veterinaria: 'Clínica Vida Animal', comuna: 'Providencia',
    telefono: '+56 9 1234 5678', email: 'contacto@vidaanimal.cl', categoria: 'prospecto',
  }
  return html.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => vars[k] ?? '')
}

function GenerarCampanaModal({ open, onClose, categoriaInicial, onUsar }: {
  open: boolean
  onClose: () => void
  categoriaInicial: string
  onUsar: (r: GenResult, categoria: string) => void
}) {
  const [instruccion, setInstruccion] = useState('')
  const [categoria, setCategoria] = useState(categoriaInicial || 'todos')
  const [tono, setTono] = useState<string>(TONOS[0])
  const [formato, setFormato] = useState<string>('auto')
  const [comentario, setComentario] = useState('')
  const [result, setResult] = useState<GenResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [accion, setAccion] = useState<'generar' | 'variar' | 'ajustar' | null>(null)
  const [error, setError] = useState('')

  async function generar(body: Record<string, unknown>, modo: 'generar' | 'variar' | 'ajustar') {
    setLoading(true); setAccion(modo); setError('')
    try {
      const res = await fetch('/api/mailing/generar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { setError(j.error || `Error ${res.status}`); return }
      setResult(j as GenResult)
      setComentario('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error de red')
    } finally {
      setLoading(false); setAccion(null)
    }
  }

  function stripActual(r: GenResult) {
    return { asunto: r.asunto, preview_text: r.preview_text, html: r.html }
  }

  function generarNueva() {
    if (!instruccion.trim()) { setError('Describe de qué se trata la campaña.'); return }
    generar({ instruccion, categoria, tono, formato }, 'generar')
  }
  function variar() {
    if (!result) return
    generar({ instruccion, categoria, tono, formato, variar: true, actual: stripActual(result) }, 'variar')
  }
  function ajustar() {
    if (!result || !comentario.trim()) return
    generar({ instruccion, categoria, tono, formato, comentario, actual: stripActual(result) }, 'ajustar')
  }
  function reiniciar() {
    setResult(null); setComentario(''); setError('')
  }

  const previewHtml = result ? sampleFill(result.html) : ''
  const generadas = result?.imagenes?.filter(i => i.origen === 'ai').length ?? 0
  const reusadas = result?.imagenes?.filter(i => i.origen === 'reuse').length ?? 0

  return (
    <Modal open={open} onClose={onClose} title="Generar campaña con IA" size="2xl">
      <div className="space-y-4">
        <p className="text-sm text-gray-600">
          Describe la campaña y la IA arma el asunto, el preview y un email completo, generando o
          reciclando imágenes fotorrealistas del banco. Después puedes pedir otra versión o ajustarla con un comentario.
        </p>

        <div>
          <label className="text-xs font-semibold text-gray-700">¿De qué se trata la campaña? *</label>
          <textarea value={instruccion} onChange={e => setInstruccion(e.target.value)} rows={4}
            placeholder="Ej: invitar a las clínicas de la zona oriente a sumarse al convenio, destacando la entrega en 4 días hábiles, el retiro desde la clínica y la trazabilidad total. Cerrar con un botón para coordinar una reunión."
            className="mt-1 w-full border-2 border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="text-xs font-semibold text-gray-700">Grupo destinatario</label>
            <select value={categoria} onChange={e => setCategoria(e.target.value)}
              className="mt-1 w-full border-2 border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
              <option value="todos">Todas las categorías</option>
              {CATEGORIAS.map(c => <option key={c} value={c}>Solo {c}s</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-700">Formato</label>
            <select value={formato} onChange={e => setFormato(e.target.value)}
              className="mt-1 w-full border-2 border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
              {FORMATOS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-700">Tono</label>
            <select value={tono} onChange={e => setTono(e.target.value)}
              className="mt-1 w-full border-2 border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
              {TONOS.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        </div>

        {error && <div className="bg-red-50 border border-red-200 text-red-800 rounded-lg px-3 py-2 text-sm">{error}</div>}

        {!result && (
          <button type="button" onClick={generarNueva} disabled={loading || !instruccion.trim()}
            className="w-full bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white rounded-lg py-2.5 text-sm font-semibold shadow-sm disabled:opacity-50">
            {loading ? 'Generando… (las imágenes pueden tardar hasta ~1 min)' : '✨ Generar campaña'}
          </button>
        )}

        {result && (
          <div className="space-y-3 border-t border-gray-200 pt-3">
            <div className="text-sm space-y-0.5">
              <div className="text-gray-900"><span className="font-semibold">Asunto:</span> {result.asunto}</div>
              <div className="text-gray-600"><span className="font-semibold">Preview:</span> {result.preview_text}</div>
              {(generadas > 0 || reusadas > 0) && (
                <div className="text-[12px] text-gray-500">
                  Imágenes: {generadas > 0 && <span>{generadas} generada{generadas === 1 ? '' : 's'}</span>}
                  {generadas > 0 && reusadas > 0 && ' · '}
                  {reusadas > 0 && <span>{reusadas} reciclada{reusadas === 1 ? '' : 's'} del banco</span>}
                </div>
              )}
            </div>

            {result.avisos && result.avisos.length > 0 && (
              <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-lg px-3 py-2 text-xs space-y-0.5">
                {result.avisos.map((a, i) => <div key={i}>⚠ {a}</div>)}
              </div>
            )}

            <div className="border border-gray-200 rounded-lg overflow-hidden">
              <div className="bg-gray-50 px-3 py-2 text-xs font-semibold text-gray-700 flex items-center justify-between">
                <span>Vista previa (con vet de muestra)</span>
                {loading && <span className="text-[11px] font-normal text-indigo-600">{accion === 'ajustar' ? 'Ajustando…' : 'Generando otra versión…'}</span>}
              </div>
              <iframe srcDoc={proxyImgs(previewHtml)} className="w-full h-[420px] bg-white" sandbox="allow-same-origin" referrerPolicy="no-referrer" />
            </div>

            <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 space-y-2">
              <label className="text-xs font-semibold text-gray-700">¿Quieres ajustar algo? Escribe un comentario</label>
              <textarea value={comentario} onChange={e => setComentario(e.target.value)} rows={2}
                placeholder="Ej: hazlo más corto, agrega un botón para agendar reunión, tono más formal, cambia la foto principal por una de un gato…"
                className="w-full border-2 border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              <div className="flex gap-2 flex-wrap">
                <button type="button" onClick={ajustar} disabled={loading || !comentario.trim()}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg px-3 py-1.5 text-sm font-semibold disabled:opacity-50">
                  {loading && accion === 'ajustar' ? 'Ajustando…' : 'Ajustar con comentario'}
                </button>
                <button type="button" onClick={variar} disabled={loading}
                  className="border-2 border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 rounded-lg px-3 py-1.5 text-sm font-semibold disabled:opacity-50">
                  {loading && accion === 'variar' ? 'Generando…' : '↻ Generar otra versión'}
                </button>
                <button type="button" onClick={reiniciar} disabled={loading}
                  className="ml-auto text-xs text-gray-500 hover:underline">
                  Empezar de cero
                </button>
              </div>
            </div>

            <div className="flex gap-2 pt-1">
              <button type="button" onClick={onClose} className="flex-1 border-2 border-gray-300 text-gray-700 rounded-lg py-2 text-sm font-semibold hover:bg-gray-50">
                Cancelar
              </button>
              <button type="button" onClick={() => onUsar(result, categoria)} disabled={loading}
                className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg py-2 text-sm font-semibold shadow-md disabled:opacity-50">
                Usar esta campaña
              </button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}

// ===================== BANCO DE IMÁGENES =====================

const ASPECTOS = ['16:9', '4:3', '1:1', '4:5', '3:2', '9:16'] as const

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader()
    fr.onload = () => resolve(String(fr.result))
    fr.onerror = () => reject(new Error('No se pudo leer el archivo'))
    fr.readAsDataURL(file)
  })
}

/** Modal para insertar una imagen del banco en el editor de HTML. */
function ImagenPickerModal({ open, onClose, onPick }: {
  open: boolean
  onClose: () => void
  onPick: (img: ImagenBanco) => void
}) {
  const [imgs, setImgs] = useState<ImagenBanco[]>([])
  const [loading, setLoading] = useState(false)
  const [q, setQ] = useState('')

  const cargar = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/mailing/imagenes', { cache: 'no-store' })
      const d = await r.json()
      setImgs(Array.isArray(d) ? d : [])
    } catch { setImgs([]) }
    setLoading(false)
  }, [])

  useEffect(() => {
    if (!open) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    cargar()
  }, [open, cargar])

  const filtrados = q.trim()
    ? imgs.filter(i => `${i.descripcion} ${i.tags} ${i.alt}`.toLowerCase().includes(q.toLowerCase()))
    : imgs

  return (
    <Modal open={open} onClose={onClose} title="Insertar imagen del banco" size="2xl">
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar por descripción o tag…"
            className="flex-1 border-2 border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          <button type="button" onClick={cargar} className="text-xs text-indigo-600 hover:underline">Actualizar</button>
        </div>
        {loading ? (
          <p className="text-sm text-gray-400 text-center py-6">Cargando…</p>
        ) : filtrados.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-6">
            {imgs.length === 0 ? 'El banco está vacío. Genera imágenes en la pestaña «Imágenes» o desde «Generar con IA».' : 'Sin resultados.'}
          </p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 max-h-[60vh] overflow-y-auto">
            {filtrados.map(img => (
              <button key={img.id} type="button" onClick={() => onPick(img)}
                className="group text-left border border-gray-200 rounded-lg overflow-hidden hover:ring-2 hover:ring-indigo-500 transition">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={img.url} alt={img.alt} className="w-full h-28 object-cover bg-gray-100" />
                <div className="px-2 py-1.5">
                  <div className="text-[11px] text-gray-700 line-clamp-2">{img.descripcion || img.alt || '(sin descripción)'}</div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </Modal>
  )
}

const GRUPOS = ['mascotas', 'personas', 'productos', 'instalaciones', 'otro'] as const
// La IA NUNCA genera instalaciones → al generar solo se ofrecen estos grupos.
const GRUPOS_GEN = ['mascotas', 'personas', 'productos', 'otro'] as const
const GRUPO_LABEL: Record<string, string> = {
  mascotas: 'Mascotas', personas: 'Personas', productos: 'Productos',
  instalaciones: 'Instalaciones', otro: 'Otro',
}

/** Tarjeta de una imagen del banco con nombre editable, grupo, WhatsApp, copiar y eliminar. */
function ImagenCard({ img, onGrupo, onWhatsapp, onRename, onCopy, onDelete }: {
  img: ImagenBanco
  onGrupo: (img: ImagenBanco, grupo: string) => void
  onWhatsapp: (img: ImagenBanco, on: boolean) => void
  onRename: (img: ImagenBanco, descripcion: string) => void
  onCopy: (url: string) => void
  onDelete: (img: ImagenBanco) => void
}) {
  const [editando, setEditando] = useState(false)
  const [texto, setTexto] = useState(img.descripcion || img.alt || '')

  function guardar() {
    setEditando(false)
    const t = texto.trim()
    if (t !== (img.descripcion || '')) onRename(img, t)
  }

  const esGenerada = img.origen !== 'upload'
  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden flex flex-col bg-white">
      {/* Foto completa (sin recortar) sobre fondo neutro + badge de origen. */}
      <div className="relative h-28 bg-gray-50 flex items-center justify-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={img.url} alt={img.alt} className="max-h-28 max-w-full object-contain" />
        <span className={`absolute top-1 left-1 text-[9px] font-semibold px-1.5 py-0.5 rounded-full ${esGenerada ? 'bg-violet-100 text-violet-700' : 'bg-sky-100 text-sky-700'}`}>
          {esGenerada ? 'Generada' : 'Subida'}
        </span>
      </div>
      <div className="p-2 flex-1 flex flex-col gap-1.5">
        <div className="flex-1">
          {editando ? (
            <input autoFocus value={texto} onChange={e => setTexto(e.target.value)} onBlur={guardar}
              onKeyDown={e => {
                if (e.key === 'Enter') { e.preventDefault(); guardar() }
                else if (e.key === 'Escape') { setTexto(img.descripcion || img.alt || ''); setEditando(false) }
              }}
              placeholder="Ej: Ánfora estándar"
              className="w-full text-[11px] border border-indigo-300 rounded px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
          ) : (
            <button type="button" title="Clic para editar el nombre"
              onClick={() => { setTexto(img.descripcion || img.alt || ''); setEditando(true) }}
              className="text-left text-[11px] text-gray-700 line-clamp-2 hover:text-indigo-600 w-full flex items-start gap-1">
              <span className="line-clamp-2">{img.descripcion || img.alt || '(sin nombre — clic para editar)'}</span>
              <span className="text-gray-300 shrink-0">✏️</span>
            </button>
          )}
        </div>
        <div className="flex items-center flex-wrap gap-1.5 gap-y-1">
          <select value={(GRUPOS as readonly string[]).includes(img.grupo) ? img.grupo : ''}
            onChange={e => onGrupo(img, e.target.value)} title="Grupo (etiqueta)"
            className="text-[10px] border border-gray-300 rounded px-1 py-0.5 bg-white focus:outline-none focus:ring-1 focus:ring-indigo-500">
            <option value="">sin grupo</option>
            {GRUPOS.map(g => <option key={g} value={g}>{g}</option>)}
          </select>
          {/* Checkbox WhatsApp: si está marcado, el agente puede enviar esta foto al cliente. */}
          <label
            title="El agente de WhatsApp puede enviar esta imagen al cliente cuando la pida"
            className={`flex items-center gap-1 text-[10px] rounded px-1 py-0.5 cursor-pointer border ${img.whatsapp ? 'bg-green-50 border-green-300 text-green-700' : 'border-gray-300 text-gray-500'}`}>
            <input type="checkbox" checked={img.whatsapp} onChange={e => onWhatsapp(img, e.target.checked)}
              className="accent-green-600 w-3 h-3" />
            WhatsApp
          </label>
          <div className="ml-auto flex items-center gap-1">
            <button type="button" onClick={() => onCopy(img.url)} title="Copiar URL" className="text-gray-500 hover:text-indigo-600 text-xs">⧉</button>
            <button type="button" onClick={() => onDelete(img)} title="Eliminar" className="text-gray-500 hover:text-red-600 text-xs">🗑</button>
          </div>
        </div>
      </div>
    </div>
  )
}

/** Pestaña «Imágenes»: banco de imágenes reciclables (generar / subir / agrupar / eliminar). */
function ImagenesPanel() {
  const [imgs, setImgs] = useState<ImagenBanco[]>([])
  const [loading, setLoading] = useState(true)
  const [prompt, setPrompt] = useState('')
  const [aspect, setAspect] = useState<string>('16:9')
  const [genGrupo, setGenGrupo] = useState<string>('mascotas')
  const [upGrupo, setUpGrupo] = useState<string>('instalaciones')
  const [generando, setGenerando] = useState(false)
  const [subiendo, setSubiendo] = useState(false)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const cargar = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/mailing/imagenes', { cache: 'no-store' })
      const d = await r.json()
      setImgs(Array.isArray(d) ? d : [])
    } catch { setImgs([]) }
    setLoading(false)
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    cargar()
  }, [cargar])

  async function generar() {
    if (!prompt.trim()) { setError('Describe la imagen que quieres generar.'); return }
    setGenerando(true); setError(''); setInfo('')
    try {
      const r = await fetch('/api/mailing/imagenes', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ generar: { prompt, aspect, descripcion: prompt, tags: '', grupo: genGrupo } }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { setError(j.error || `Error ${r.status}`); return }
      setPrompt(''); setInfo('Imagen generada y guardada en el banco.')
      await cargar()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error de red')
    } finally {
      setGenerando(false)
    }
  }

  async function subir(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || [])
    if (files.length === 0) return
    if (fileRef.current) fileRef.current.value = ''
    setSubiendo(true); setError(''); setInfo('')
    let ok = 0
    const fallidas: string[] = []
    try {
      // Una por una (la API sube de a una): así el banco se va llenando aunque
      // alguna falle, y no topamos con el límite de tamaño del request.
      for (const file of files) {
        try {
          const dataUrl = await fileToDataUrl(file)
          const r = await fetch('/api/mailing/imagenes', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ data_url: dataUrl, descripcion: file.name.replace(/\.[^.]+$/, ''), grupo: upGrupo }),
          })
          if (r.ok) ok++
          else { const j = await r.json().catch(() => ({})); fallidas.push(`${file.name}: ${j.error || `Error ${r.status}`}`) }
        } catch (err) {
          fallidas.push(`${file.name}: ${err instanceof Error ? err.message : 'error'}`)
        }
        await cargar()
      }
      if (ok > 0) setInfo(`${ok} imagen${ok === 1 ? '' : 'es'} subida${ok === 1 ? '' : 's'} al banco (grupo: ${upGrupo}).`)
      if (fallidas.length) setError(`No se pudieron subir ${fallidas.length}: ${fallidas.slice(0, 3).join(' · ')}${fallidas.length > 3 ? '…' : ''}`)
    } finally {
      setSubiendo(false)
    }
  }

  async function cambiarGrupo(img: ImagenBanco, grupo: string) {
    setImgs(prev => prev.map(i => i.id === img.id ? { ...i, grupo } : i)) // optimista
    const r = await fetch(`/api/mailing/imagenes?id=${encodeURIComponent(img.id)}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grupo }),
    })
    if (!r.ok) { setError('No se pudo cambiar el grupo'); await cargar() }
  }

  async function cambiarWhatsapp(img: ImagenBanco, on: boolean) {
    setImgs(prev => prev.map(i => i.id === img.id ? { ...i, whatsapp: on } : i)) // optimista
    const r = await fetch(`/api/mailing/imagenes?id=${encodeURIComponent(img.id)}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ whatsapp: on }),
    })
    if (!r.ok) { setError('No se pudo cambiar la opción de WhatsApp'); await cargar() }
  }

  async function renombrar(img: ImagenBanco, descripcion: string) {
    setImgs(prev => prev.map(i => i.id === img.id ? { ...i, descripcion } : i)) // optimista
    const r = await fetch(`/api/mailing/imagenes?id=${encodeURIComponent(img.id)}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ descripcion }),
    })
    if (!r.ok) { setError('No se pudo renombrar la imagen'); await cargar() }
  }

  async function eliminar(img: ImagenBanco) {
    if (!confirm('¿Eliminar esta imagen del banco? Si está usada en alguna campaña ya enviada, esa copia no se ve afectada.')) return
    const r = await fetch(`/api/mailing/imagenes?id=${encodeURIComponent(img.id)}`, { method: 'DELETE' })
    if (r.ok) await cargar()
    else alert('Error al eliminar')
  }

  async function copiarUrl(url: string) {
    try { await navigator.clipboard.writeText(url); setInfo('URL copiada al portapapeles.') } catch { /* ignore */ }
  }

  // Agrupadas por etiqueta (grupo), en orden canónico + "sin etiqueta" al final.
  const grupos = useMemo(() => {
    const norm = (g: string) => ((GRUPOS as readonly string[]).includes(g) ? g : '')
    return [...GRUPOS, ''].map(key => ({
      key: key || 'sin',
      label: key ? GRUPO_LABEL[key] : 'Sin etiqueta',
      imgs: imgs.filter(i => norm(i.grupo) === key),
    })).filter(g => g.imgs.length > 0)
  }, [imgs])

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl shadow-sm border-2 border-gray-200 p-5 space-y-4">
        <div>
          <h2 className="text-base font-bold text-gray-900">Banco de imágenes</h2>
          <p className="text-sm text-gray-500">Imágenes fotorrealistas reutilizables. El generador de campañas las recicla automáticamente cuando calzan con el contexto. Asigna un grupo a cada una para organizarlas.</p>
        </div>

        {/* Generar con IA */}
        <div>
          <label className="text-xs font-semibold text-gray-700">Generar una imagen nueva (Nano Banana Pro)</label>
          <textarea value={prompt} onChange={e => setPrompt(e.target.value)} rows={2}
            placeholder="Ej: una mujer acariciando a su perro mayor en un living luminoso, luz natural, momento cálido y sereno."
            className="mt-1 w-full border-2 border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          <div className="mt-2 flex items-center gap-2 flex-wrap">
            <select value={aspect} onChange={e => setAspect(e.target.value)} title="Relación de aspecto"
              className="border-2 border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
              {ASPECTOS.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
            <select value={genGrupo} onChange={e => setGenGrupo(e.target.value)} title="Grupo"
              className="border-2 border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
              {GRUPOS_GEN.map(g => <option key={g} value={g}>{g}</option>)}
            </select>
            <button type="button" onClick={generar} disabled={generando || !prompt.trim()}
              className="bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white rounded-lg px-4 py-1.5 text-sm font-semibold shadow-sm disabled:opacity-50">
              {generando ? 'Generando… (puede tardar)' : '✨ Generar imagen'}
            </button>
          </div>
          <p className="text-[11px] text-gray-400 mt-1">La IA no genera fotos de instalaciones — esas se suben.</p>
        </div>

        {/* Subir propia */}
        <div className="border-t border-gray-100 pt-3">
          <label className="text-xs font-semibold text-gray-700">Subir una imagen propia (ej. fotos reales de las instalaciones)</label>
          <div className="mt-2 flex items-center gap-2 flex-wrap">
            <span className="text-xs text-gray-500">Grupo:</span>
            <select value={upGrupo} onChange={e => setUpGrupo(e.target.value)} title="Grupo de la imagen a subir"
              className="border-2 border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
              {GRUPOS.map(g => <option key={g} value={g}>{g}</option>)}
            </select>
            <button type="button" onClick={() => fileRef.current?.click()} disabled={subiendo}
              className="border-2 border-gray-300 text-gray-700 rounded-lg px-3 py-1.5 text-sm font-semibold hover:bg-gray-50 disabled:opacity-50">
              {subiendo ? 'Subiendo…' : '📤 Subir imágenes'}
            </button>
            <input ref={fileRef} type="file" multiple accept="image/png,image/jpeg,image/webp,image/gif" onChange={subir} className="hidden" />
            <span className="text-[11px] text-gray-400">Puedes elegir varias a la vez.</span>
          </div>
        </div>

        {error && <div className="bg-red-50 border border-red-200 text-red-800 rounded-lg px-3 py-2 text-sm">{error}</div>}
        {info && <div className="bg-green-50 border border-green-200 text-green-800 rounded-lg px-3 py-2 text-sm">{info}</div>}
      </div>

      {loading ? (
        <div className="bg-white rounded-2xl shadow-sm border-2 border-gray-200 p-8 text-center text-sm text-gray-400">Cargando…</div>
      ) : imgs.length === 0 ? (
        <div className="bg-white rounded-2xl shadow-sm border-2 border-gray-200 p-8 text-center text-sm text-gray-400">Sin imágenes todavía. Genera la primera arriba o sube una propia.</div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between px-1">
            <p className="text-xs text-gray-400">{imgs.length} imagen{imgs.length === 1 ? '' : 'es'} · agrupadas por etiqueta</p>
            <button type="button" onClick={cargar} className="text-xs text-indigo-600 hover:underline">Actualizar</button>
          </div>
          {grupos.map(g => (
            <details key={g.key} open className="bg-white rounded-2xl shadow-sm border-2 border-gray-200 group">
              <summary className="cursor-pointer select-none px-4 py-3 flex items-center gap-2 list-none [&::-webkit-details-marker]:hidden">
                <span className="text-gray-400 text-xs transition-transform group-open:rotate-90">▶</span>
                <span className="text-sm font-semibold text-gray-900">{g.label}</span>
                <span className="text-xs text-gray-400">({g.imgs.length})</span>
              </summary>
              <div className="px-4 pb-4">
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
                  {g.imgs.map(img => (
                    <ImagenCard key={img.id} img={img} onGrupo={cambiarGrupo} onWhatsapp={cambiarWhatsapp} onRename={renombrar} onCopy={copiarUrl} onDelete={eliminar} />
                  ))}
                </div>
              </div>
            </details>
          ))}
        </div>
      )}
    </div>
  )
}

