'use client'
import { useState, useEffect, useCallback, useMemo, useRef, Fragment } from 'react'
import { Modal } from '@/components/ui/Modal'
import { formatDate, formatDateTime, formatHoraDia } from '@/lib/dates'
import CalendarioContent from '@/components/marketing/CalendarioContent'
import BancoView, { BancoMiniPanel } from '@/components/marketing/BancoView'
import { GmailIcon, FacebookIcon, InstagramIcon, AgenteIcon } from '@/components/marketing/BrandIcons'

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
  codigo: string
  descripcion: string
  prompt: string
  tags: string
  alt: string
  grupo: string
  subgrupo: string
  whatsapp: boolean
  favorita: boolean
  aspect: string
  origen: string
  modelo: string
  creado_por: string
  fecha_creacion: string
}

const TABS = ['Campañas', 'Base', 'Nueva campaña'] as const
type Tab = typeof TABS[number]
const TAB_ICONS: Record<Tab, string> = {
  'Campañas': '📊', 'Base': '👥', 'Nueva campaña': '✏️',
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

type Red = 'mail' | 'instagram' | 'facebook' | 'tiktok'
type Vista = Red | 'calendario' | 'imagenes' | 'metricas'

// Barra de accesos fija arriba: el Agente (calendario + IA, con sus propios botones
// de canal FB/IG dentro), el Mailing, el Banco de imágenes y las Métricas.
const NAV: { key: Vista; label: string }[] = [
  { key: 'calendario', label: 'Agente' },
  { key: 'mail', label: 'Mailing' },
  { key: 'imagenes', label: 'Banco' },
  { key: 'metricas', label: 'Métricas' },
]

function NavIcon({ k, className = 'w-6 h-6' }: { k: Vista; className?: string }) {
  if (k === 'calendario') return <AgenteIcon className={className} />
  if (k === 'mail') return <GmailIcon className={className} />
  if (k === 'instagram') return <InstagramIcon className={className} />
  if (k === 'facebook') return <FacebookIcon className={className} />
  if (k === 'tiktok') return <span className="text-xl leading-none">🎵</span>
  if (k === 'metricas') return <span className="text-xl leading-none">📊</span>
  return <span className="text-xl leading-none">🖼️</span>
}

export default function CampanasPage() {
  const [vista, setVista] = useState<Vista>('calendario')
  // Panel lateral del Banco "en paralelo": para ver los códigos de las imágenes sin
  // salir del chat del agente.
  const [bancoParalelo, setBancoParalelo] = useState(false)
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-extrabold text-[#143C64] tracking-tight">Campañas</h1>
        <p className="text-sm text-gray-500">Planificá con el agente, gestioná el mailing y el banco de imágenes desde un solo lugar.</p>
        <div className="flex gap-1.5 bg-white border border-gray-300 rounded-2xl p-2 shadow-md overflow-x-auto mt-3">
          {NAV.map(n => {
            const active = vista === n.key
            return (
              <Fragment key={n.key}>
                <button
                  onClick={() => setVista(n.key)}
                  className={`px-4 py-2.5 rounded-xl text-sm font-semibold whitespace-nowrap transition-all flex items-center gap-2 ${
                    active ? 'bg-[#143C64] text-white shadow-md' : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                  }`}
                >
                  <NavIcon k={n.key} className="w-6 h-6" />
                  {n.label}
                </button>
                {n.key === 'imagenes' && (
                  <button
                    onClick={() => setBancoParalelo(v => !v)}
                    title="Abrir el Banco en paralelo (ver los códigos de las imágenes sin salir del chat)"
                    className={`shrink-0 w-9 px-0 rounded-xl text-base transition-all flex items-center justify-center border ${
                      bancoParalelo ? 'bg-[#143C64] text-white border-[#143C64]' : 'text-gray-500 border-gray-300 hover:bg-gray-50 hover:text-[#143C64]'
                    }`}
                  >⧉</button>
                )}
              </Fragment>
            )
          })}
        </div>
      </div>

      {vista === 'calendario' && <CalendarioContent />}
      {vista === 'mail' && <MailContent />}
      {vista === 'imagenes' && <BancoView />}
      {vista === 'metricas' && <MetricasPanel />}

      {/* Panel lateral "abrir en paralelo": el Banco compacto, sin bloquear el chat. */}
      {bancoParalelo && (
        <div className="fixed top-0 right-0 h-full w-full sm:w-[380px] z-40 bg-white border-l border-gray-300 shadow-2xl flex flex-col">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-[#143C64] text-white shrink-0">
            <span className="font-semibold text-sm">🖼️ Banco en paralelo</span>
            <button onClick={() => setBancoParalelo(false)} title="Cerrar" className="w-7 h-7 grid place-items-center rounded-lg hover:bg-white/15">✕</button>
          </div>
          <div className="flex-1 overflow-hidden">
            <BancoMiniPanel />
          </div>
        </div>
      )}
    </div>
  )
}

// ── Pestaña «Métricas»: Ads pagados + posts orgánicos (en vivo desde Meta) ──
type MetCampana = { nombre: string; spend: number; impresiones: number; alcance: number; clicks: number; ctr: number; cpc: number; acciones: { tipo: string; valor: number }[] }
type MetResumenAds = { moneda: string; periodo: string; cuenta: Omit<MetCampana, 'nombre'>; campanas: MetCampana[] }
type MetPost = { fecha: string; mensaje: string; impresiones: number; reacciones: number; comentarios: number; compartidos: number; url: string }
type MetResumenOrg = { seguidores: number; posts: MetPost[] }
type MetResp = { ads?: MetResumenAds; ads_error?: string; organico?: MetResumenOrg; organico_error?: string }

const PERIODOS: { key: string; label: string }[] = [
  { key: 'last_7d', label: 'Últimos 7 días' },
  { key: 'last_14d', label: 'Últimos 14 días' },
  { key: 'last_30d', label: 'Últimos 30 días' },
  { key: 'last_90d', label: 'Últimos 90 días' },
  { key: 'this_month', label: 'Este mes' },
  { key: 'last_month', label: 'Mes pasado' },
]

// ── Gestión de campañas de Meta Ads (Fase 1): pausar/activar + ajustar presupuesto ──
type CampAds = { id: string; nombre: string; status: string; effective_status: string; objective: string; tipo_presupuesto: 'diario' | 'total' | 'adset' | 'ninguno'; presupuesto_clp: number; moneda: string }

const ESTADO_ADS: Record<string, { label: string; cls: string }> = {
  ACTIVE: { label: 'Activa', cls: 'bg-emerald-100 text-emerald-800 border-emerald-200' },
  PAUSED: { label: 'Pausada', cls: 'bg-gray-100 text-gray-600 border-gray-200' },
  CAMPAIGN_PAUSED: { label: 'Pausada', cls: 'bg-gray-100 text-gray-600 border-gray-200' },
  ADSET_PAUSED: { label: 'Pausada (ad set)', cls: 'bg-gray-100 text-gray-600 border-gray-200' },
  IN_PROCESS: { label: 'Procesando', cls: 'bg-amber-100 text-amber-800 border-amber-200' },
  PENDING_REVIEW: { label: 'En revisión', cls: 'bg-amber-100 text-amber-800 border-amber-200' },
  PENDING_BILLING_INFO: { label: 'Falta pago', cls: 'bg-red-100 text-red-800 border-red-200' },
  WITH_ISSUES: { label: 'Con problemas', cls: 'bg-red-100 text-red-800 border-red-200' },
  DISAPPROVED: { label: 'Rechazada', cls: 'bg-red-100 text-red-800 border-red-200' },
  ARCHIVED: { label: 'Archivada', cls: 'bg-gray-100 text-gray-500 border-gray-200' },
}

function GestionCampanas() {
  const [camps, setCamps] = useState<CampAds[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [busyId, setBusyId] = useState('')
  const [editId, setEditId] = useState('')
  const [editVal, setEditVal] = useState('')

  const cargar = useCallback(async () => {
    setLoading(true); setErr('')
    try {
      const r = await fetch('/api/mailing/ads', { cache: 'no-store' })
      const d = await r.json()
      if (!r.ok) { setErr(d.error || 'Error'); setCamps(null) } else setCamps(d.campanas || [])
    } catch { setErr('Error de red'); setCamps(null) }
    setLoading(false)
  }, [])
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    cargar()
  }, [cargar])

  const fmt = (n: number) => Math.round(n || 0).toLocaleString('es-CL')

  async function cambiarEstado(c: CampAds, accion: 'pausar' | 'activar') {
    const msg = accion === 'pausar'
      ? `¿Pausar "${c.nombre}"? Dejará de gastar hasta que la reactives.`
      : `¿Activar "${c.nombre}"? Volverá a gastar presupuesto.`
    if (!window.confirm(msg)) return
    setBusyId(c.id)
    try {
      const r = await fetch('/api/mailing/ads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accion, campana_id: c.id }) })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) alert(d.error || 'No se pudo aplicar el cambio.')
      await cargar()
    } catch { alert('Error de red') }
    setBusyId('')
  }

  async function guardarPresupuesto(c: CampAds) {
    const monto = parseInt(editVal.replace(/\D/g, ''), 10)
    if (!monto || monto <= 0) { alert('Ingresá un monto válido en pesos.'); return }
    const etiqueta = c.tipo_presupuesto === 'diario' ? 'diario' : 'total'
    if (!window.confirm(`¿Poner el presupuesto ${etiqueta} de "${c.nombre}" en $${monto.toLocaleString('es-CL')} CLP?`)) return
    setBusyId(c.id)
    try {
      const r = await fetch('/api/mailing/ads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accion: 'presupuesto', campana_id: c.id, monto_clp: monto }) })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) alert(d.error || 'No se pudo ajustar el presupuesto.')
      else { setEditId(''); setEditVal('') }
      await cargar()
    } catch { alert('Error de red') }
    setBusyId('')
  }

  const badge = (c: CampAds) => ESTADO_ADS[c.effective_status] || { label: c.effective_status || c.status || '—', cls: 'bg-gray-100 text-gray-600 border-gray-200' }

  return (
    <div className="bg-white rounded-2xl shadow-md border-2 border-gray-300 p-5 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-sm font-bold text-[#143C64] uppercase tracking-wide">Gestión de campañas (Meta Ads)</h3>
          <p className="text-xs text-gray-500 mt-0.5">Pausá o reactivá campañas y ajustá su presupuesto. Los cambios se aplican en Meta al instante.</p>
        </div>
        <button onClick={cargar} className="text-sm border-2 border-gray-300 rounded-lg px-3 py-1.5 font-semibold hover:bg-gray-50">Actualizar</button>
      </div>

      {loading ? (
        <p className="text-sm text-gray-400">Cargando campañas…</p>
      ) : err ? (
        <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{err}</p>
      ) : !camps || camps.length === 0 ? (
        <p className="text-sm text-gray-400">No hay campañas en la cuenta.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
              <tr>
                <th className="text-left px-3 py-2">Campaña</th>
                <th className="text-left px-3 py-2">Estado</th>
                <th className="text-left px-3 py-2">Presupuesto</th>
                <th className="text-right px-3 py-2">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {camps.map(c => {
                const b = badge(c)
                const activa = c.status === 'ACTIVE'
                const editando = editId === c.id
                const editable = c.tipo_presupuesto === 'diario' || c.tipo_presupuesto === 'total'
                const busy = busyId === c.id
                return (
                  <tr key={c.id} className="hover:bg-gray-50 align-middle">
                    <td className="px-3 py-2 text-gray-800 max-w-[280px] truncate" title={c.nombre}>{c.nombre}</td>
                    <td className="px-3 py-2">
                      <span className={`inline-block text-[11px] font-semibold px-2 py-0.5 rounded border ${b.cls}`}>{b.label}</span>
                    </td>
                    <td className="px-3 py-2">
                      {editando ? (
                        <div className="flex items-center gap-1.5">
                          <span className="text-gray-400">$</span>
                          <input value={editVal} onChange={e => setEditVal(e.target.value.replace(/\D/g, ''))}
                            className="w-24 border-2 border-gray-300 rounded-lg px-2 py-1 text-sm" autoFocus />
                          <button disabled={busy} onClick={() => guardarPresupuesto(c)} className="text-xs font-semibold text-white bg-[#143C64] rounded-lg px-2.5 py-1 disabled:opacity-50">Guardar</button>
                          <button onClick={() => { setEditId(''); setEditVal('') }} className="text-xs text-gray-500 hover:underline">Cancelar</button>
                        </div>
                      ) : editable ? (
                        <span className="text-gray-800">
                          ${fmt(c.presupuesto_clp)} <span className="text-gray-400 text-xs">CLP {c.tipo_presupuesto === 'diario' ? '/ día' : 'total'}</span>
                        </span>
                      ) : (
                        <span className="text-gray-400 text-xs">a nivel ad set</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-end gap-2">
                        {editable && !editando && (
                          <button disabled={busy} onClick={() => { setEditId(c.id); setEditVal(String(c.presupuesto_clp || '')) }} className="text-xs font-semibold text-[#143C64] border border-gray-300 rounded-lg px-2.5 py-1 hover:bg-gray-50 disabled:opacity-50">Presupuesto</button>
                        )}
                        {activa ? (
                          <button disabled={busy} onClick={() => cambiarEstado(c, 'pausar')} className="text-xs font-semibold text-amber-800 border border-amber-300 bg-amber-50 rounded-lg px-2.5 py-1 hover:bg-amber-100 disabled:opacity-50">Pausar</button>
                        ) : c.status === 'PAUSED' ? (
                          <button disabled={busy} onClick={() => cambiarEstado(c, 'activar')} className="text-xs font-semibold text-emerald-800 border border-emerald-300 bg-emerald-50 rounded-lg px-2.5 py-1 hover:bg-emerald-100 disabled:opacity-50">Activar</button>
                        ) : null}
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
  )
}

// ── Google Ads (solo lectura): campañas + keywords + términos de búsqueda ──
type CampGoogle = { id: string; nombre: string; status: string; gasto: number; impresiones: number; clicks: number; ctr: number; cpc: number; conversiones: number }
type KeywordGoogle = { resourceName: string; status: string; texto: string; matchType: string; campana: string; campanaEstado: string; grupoAnuncioEstado: string; enVivo: boolean; gasto: number; impresiones: number; clicks: number; ctr: number; cpc: number }
type TerminoGoogle = { termino: string; campana: string; campanaId: string; gasto: number; impresiones: number; clicks: number; conversiones: number }
type CampanaGestionGoogle = { id: string; nombre: string; status: string; presupuestoResourceName: string; presupuestoClp: number; compartido: boolean }
type ListaNegativasGoogle = { resourceName: string; nombre: string; cantidadTerminos: number; campanas: string[] }
type GoogleAdsResp = {
  ads?: { moneda: string; cuenta: Omit<CampGoogle, 'id' | 'nombre' | 'status'>; campanas: CampGoogle[] }
  keywords?: KeywordGoogle[]
  terminos?: TerminoGoogle[]
  gestion?: CampanaGestionGoogle[]
  listasNegativas?: ListaNegativasGoogle[]
  error?: string
}

const ESTADO_GOOGLE: Record<string, { label: string; cls: string }> = {
  ENABLED: { label: 'Activa', cls: 'bg-emerald-100 text-emerald-800 border-emerald-200' },
  PAUSED: { label: 'Pausada', cls: 'bg-gray-100 text-gray-600 border-gray-200' },
  REMOVED: { label: 'Eliminada', cls: 'bg-gray-100 text-gray-500 border-gray-200' },
}

// ── Auditoría de cuenta (Fase B) ──────────────────────────────────────────────
type Hallazgo = { id: string; severidad: 'alta' | 'media' | 'baja'; area: string; titulo: string; detalle: string; accionSugerida: string; dolaresEstimados?: number }

const SEMAFORO: Record<Hallazgo['severidad'], { icono: string; cls: string }> = {
  alta: { icono: '🔴', cls: 'border-red-200 bg-red-50' },
  media: { icono: '🟠', cls: 'border-amber-200 bg-amber-50' },
  baja: { icono: '🟢', cls: 'border-emerald-200 bg-emerald-50' },
}

function AuditoriaGoogleAds() {
  const [hallazgos, setHallazgos] = useState<Hallazgo[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')

  async function auditar() {
    setLoading(true); setErr('')
    try {
      const r = await fetch('/api/mailing/google-ads/audit', { cache: 'no-store' })
      const d = await r.json()
      if (!r.ok) { setErr(d.error || 'Error'); setHallazgos(null) } else setHallazgos(d.hallazgos || [])
    } catch { setErr('Error de red'); setHallazgos(null) }
    setLoading(false)
  }

  return (
    <div className="rounded-xl border-2 border-gray-300 bg-gray-50 p-4 space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Auditoría de cuenta</p>
          <p className="text-[11px] text-gray-400">Revisa bidding, valores de conversión, anuncios, recursos, keywords e Impression Share contra las buenas prácticas.</p>
        </div>
        <button disabled={loading} onClick={auditar} className="text-xs font-semibold text-white bg-[#143C64] rounded-lg px-3 py-1.5 hover:bg-[#0f2e4d] disabled:opacity-50 shrink-0">
          {loading ? 'Auditando…' : 'Auditar ahora'}
        </button>
      </div>
      {err && <p className="text-sm text-gray-500">No se pudo auditar: {err}</p>}
      {hallazgos && (
        hallazgos.length === 0 ? (
          <p className="text-sm text-emerald-700">Sin hallazgos relevantes por ahora.</p>
        ) : (
          <div className="space-y-2">
            {hallazgos.map(h => {
              const s = SEMAFORO[h.severidad]
              return (
                <div key={h.id} className={`rounded-lg border p-3 ${s.cls}`}>
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <p className="text-sm font-semibold text-gray-800">{s.icono} {h.titulo} <span className="font-normal text-gray-400">({h.area})</span></p>
                    {h.dolaresEstimados != null && <span className="text-xs font-bold text-gray-700 shrink-0">~${Math.round(h.dolaresEstimados).toLocaleString('es-CL')}</span>}
                  </div>
                  <p className="text-xs text-gray-600 mt-1">{h.detalle}</p>
                  <p className="text-xs text-gray-700 mt-1">→ {h.accionSugerida}</p>
                </div>
              )
            })}
          </div>
        )
      )}
    </div>
  )
}

function GoogleAdsPanel({ periodo }: { periodo: string }) {
  const [data, setData] = useState<GoogleAdsResp | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [busyId, setBusyId] = useState('')
  const [editId, setEditId] = useState('')
  const [editVal, setEditVal] = useState('')

  const cargar = useCallback(async () => {
    setLoading(true); setErr('')
    try {
      const r = await fetch(`/api/mailing/google-ads?periodo=${periodo}`, { cache: 'no-store' })
      const d = await r.json()
      if (!r.ok) { setErr(d.error || 'Error'); setData(null) } else setData(d)
    } catch { setErr('Error de red'); setData(null) }
    setLoading(false)
  }, [periodo])
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    cargar()
  }, [cargar])

  const fmt = (n: number) => Math.round(n || 0).toLocaleString('es-CL')
  const ads = data?.ads
  const money = (n: number) => `$${fmt(n)}${ads && ads.moneda !== 'CLP' ? ' ' + ads.moneda : ''}`

  const KPIS = ads ? [
    { l: 'Gasto', v: money(ads.cuenta.gasto) },
    { l: 'Impresiones', v: fmt(ads.cuenta.impresiones) },
    { l: 'Clics', v: fmt(ads.cuenta.clicks) },
    { l: 'CTR', v: `${ads.cuenta.ctr.toFixed(2)}%` },
    { l: 'CPC', v: money(ads.cuenta.cpc) },
    { l: 'Conversiones', v: ads.cuenta.conversiones.toLocaleString('es-CL') },
  ] : []

  async function accionCampana(id: string, nombre: string, accion: 'pausar_campana' | 'activar_campana') {
    const msg = accion === 'pausar_campana' ? `¿Pausar "${nombre}"? Deja de gastar hasta que la reactives.` : `¿Activar "${nombre}"? Vuelve a gastar presupuesto.`
    if (!window.confirm(msg)) return
    setBusyId(id)
    try {
      const r = await fetch('/api/mailing/google-ads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accion, campaignId: id }) })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) alert(d.error || 'No se pudo aplicar el cambio.')
      await cargar()
    } catch { alert('Error de red') }
    setBusyId('')
  }

  async function guardarPresupuesto(id: string, nombre: string) {
    const monto = parseInt(editVal.replace(/\D/g, ''), 10)
    if (!monto || monto <= 0) { alert('Ingresá un monto válido en pesos.'); return }
    if (!window.confirm(`¿Poner el presupuesto diario de "${nombre}" en $${monto.toLocaleString('es-CL')}?`)) return
    setBusyId(id)
    try {
      const r = await fetch('/api/mailing/google-ads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accion: 'presupuesto_campana', campaignId: id, montoClp: monto }) })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) alert(d.error || 'No se pudo ajustar el presupuesto.')
      else { setEditId(''); setEditVal('') }
      await cargar()
    } catch { alert('Error de red') }
    setBusyId('')
  }

  async function toggleKeyword(k: KeywordGoogle) {
    const activa = k.status === 'ENABLED'
    const msg = activa ? `¿Pausar la palabra clave "${k.texto}"?` : `¿Reactivar la palabra clave "${k.texto}"?`
    if (!window.confirm(msg)) return
    setBusyId(k.resourceName)
    try {
      const r = await fetch('/api/mailing/google-ads', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accion: activa ? 'pausar_keyword' : 'activar_keyword', resourceName: k.resourceName }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) alert(d.error || 'No se pudo aplicar el cambio.')
      await cargar()
    } catch { alert('Error de red') }
    setBusyId('')
  }

  async function agregarNegativa(t: TerminoGoogle) {
    if (!t.campanaId) { alert('No se pudo identificar la campaña de este término.'); return }
    if (!window.confirm(`¿Bloquear "${t.termino}" como palabra clave negativa en "${t.campana}"? Ya no vas a gastar en búsquedas que coincidan con este término.`)) return
    const key = `neg-${t.termino}`
    setBusyId(key)
    try {
      const r = await fetch('/api/mailing/google-ads', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accion: 'negativa', campaignId: t.campanaId, texto: t.termino, matchType: 'PHRASE' }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) alert(d.error || 'No se pudo agregar la negativa.')
      else alert('Listo — agregada como palabra clave negativa.')
    } catch { alert('Error de red') }
    setBusyId('')
  }

  async function crearListaUniversal() {
    if (!window.confirm('¿Crear la lista de negativas universal ES-CL (empleo, educación, DIY, gratis, segunda mano) y adjuntarla a TODAS las campañas de la cuenta? Los términos que ya existan como negativa se saltan automáticamente.')) return
    setBusyId('crear-lista-negativas')
    try {
      const r = await fetch('/api/mailing/google-ads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accion: 'crear_lista_negativas_universal' }) })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) alert(d.error || 'No se pudo crear la lista.')
      else if (d.creada === false) alert(d.mensaje || 'Todos los términos ya existían — no se creó la lista.')
      else alert(`Lista creada: ${d.agregados} términos (${d.duplicados} ya existían) · adjuntada a ${d.adjuntadas} campaña(s).`)
      await cargar()
    } catch { alert('Error de red') }
    setBusyId('')
  }

  async function eliminarLista(l: ListaNegativasGoogle) {
    if (!window.confirm(`¿Eliminar la lista "${l.nombre}" (${l.cantidadTerminos} términos)? Se desadjunta de las ${l.campanas.length} campaña(s) que la usan.`)) return
    setBusyId(l.resourceName)
    try {
      const r = await fetch('/api/mailing/google-ads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accion: 'eliminar_lista_negativas', resourceName: l.resourceName }) })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) alert(d.error || 'No se pudo eliminar la lista.')
      await cargar()
    } catch { alert('Error de red') }
    setBusyId('')
  }

  const gestionPorId = new Map((data?.gestion || []).map(g => [g.id, g]))

  return (
    <div className="bg-white rounded-2xl shadow-md border-2 border-gray-300 p-5 space-y-4">
      <h3 className="text-sm font-bold text-[#143C64] uppercase tracking-wide">Anuncios pagados (Google Ads)</h3>
      <AuditoriaGoogleAds />
      {loading ? (
        <p className="text-sm text-gray-400">Cargando…</p>
      ) : err ? (
        <p className="text-sm text-gray-500">No se pudieron leer los Ads: {err}</p>
      ) : ads ? (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {KPIS.map(k => (
              <div key={k.l} className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2">
                <div className="text-[11px] text-gray-500">{k.l}</div>
                <div className="text-lg font-bold text-gray-900">{k.v}</div>
              </div>
            ))}
          </div>

          {ads.campanas.length > 0 ? (
            <div className="overflow-x-auto rounded-xl border border-gray-200">
              <table className="w-full min-w-[820px] text-sm">
                <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
                  <tr>
                    <th className="text-left px-3 py-2">Campaña</th>
                    <th className="text-left px-3 py-2">Estado</th>
                    <th className="text-right px-3 py-2">Gasto</th>
                    <th className="text-right px-3 py-2">Clics</th>
                    <th className="text-right px-3 py-2">CTR</th>
                    <th className="text-right px-3 py-2">CPC</th>
                    <th className="text-left px-3 py-2">Presupuesto/día</th>
                    <th className="text-right px-3 py-2">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {ads.campanas.map(c => {
                    const b = ESTADO_GOOGLE[c.status] || { label: c.status || '—', cls: 'bg-gray-100 text-gray-600 border-gray-200' }
                    const g = gestionPorId.get(c.id)
                    const editando = editId === c.id
                    const busy = busyId === c.id
                    const activa = c.status === 'ENABLED'
                    return (
                      <tr key={c.id} className="hover:bg-gray-50 align-middle">
                        <td className="px-3 py-2 text-gray-800 max-w-[220px] truncate">{c.nombre}</td>
                        <td className="px-3 py-2"><span className={`inline-block text-[11px] font-semibold px-2 py-0.5 rounded border ${b.cls}`}>{b.label}</span></td>
                        <td className="px-3 py-2 text-right">{money(c.gasto)}</td>
                        <td className="px-3 py-2 text-right">{fmt(c.clicks)}</td>
                        <td className="px-3 py-2 text-right">{c.ctr.toFixed(2)}%</td>
                        <td className="px-3 py-2 text-right">{money(c.cpc)}</td>
                        <td className="px-3 py-2">
                          {!g ? <span className="text-gray-400 text-xs">—</span> : editando ? (
                            <div className="flex items-center gap-1.5">
                              <span className="text-gray-400">$</span>
                              <input value={editVal} onChange={e => setEditVal(e.target.value.replace(/\D/g, ''))} className="w-24 border-2 border-gray-300 rounded-lg px-2 py-1 text-sm" autoFocus />
                              <button disabled={busy} onClick={() => guardarPresupuesto(c.id, c.nombre)} className="text-xs font-semibold text-white bg-[#143C64] rounded-lg px-2.5 py-1 disabled:opacity-50">Guardar</button>
                              <button onClick={() => { setEditId(''); setEditVal('') }} className="text-xs text-gray-500 hover:underline">Cancelar</button>
                            </div>
                          ) : g.compartido ? (
                            <span className="text-gray-400 text-xs" title="Presupuesto compartido con otra campaña — editalo desde Google Ads">${fmt(g.presupuestoClp)} (compartido)</span>
                          ) : (
                            <button disabled={busy} onClick={() => { setEditId(c.id); setEditVal(String(g.presupuestoClp || '')) }} className="text-gray-800 hover:underline disabled:opacity-50">
                              ${fmt(g.presupuestoClp)}
                            </button>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex items-center justify-end gap-2">
                            {activa ? (
                              <button disabled={busy} onClick={() => accionCampana(c.id, c.nombre, 'pausar_campana')} className="text-xs font-semibold text-amber-800 border border-amber-300 bg-amber-50 rounded-lg px-2.5 py-1 hover:bg-amber-100 disabled:opacity-50">Pausar</button>
                            ) : c.status === 'PAUSED' ? (
                              <button disabled={busy} onClick={() => accionCampana(c.id, c.nombre, 'activar_campana')} className="text-xs font-semibold text-emerald-800 border border-emerald-300 bg-emerald-50 rounded-lg px-2.5 py-1 hover:bg-emerald-100 disabled:opacity-50">Activar</button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ) : <p className="text-sm text-gray-400">Sin campañas con datos en este período.</p>}

          {data?.keywords && data.keywords.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Palabras clave (top {data.keywords.length} por gasto)</p>
              <div className="overflow-x-auto rounded-xl border border-gray-200">
                <table className="w-full min-w-[720px] text-sm">
                  <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
                    <tr>
                      <th className="text-left px-3 py-2">Palabra clave</th>
                      <th className="text-left px-3 py-2">Campaña</th>
                      <th className="text-right px-3 py-2">Gasto</th>
                      <th className="text-right px-3 py-2">Clics</th>
                      <th className="text-right px-3 py-2">CTR</th>
                      <th className="text-right px-3 py-2">CPC</th>
                      <th className="text-right px-3 py-2">Acciones</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {data.keywords.map((k, i) => {
                      const activa = k.status === 'ENABLED'
                      // El status propio de la keyword puede ser ENABLED aunque su campaña o
                      // grupo de anuncios estén pausados — en ese caso NO está gastando de
                      // verdad. `enVivo` es la única señal confiable de "realmente activa".
                      const campanaApagada = activa && !k.enVivo
                      const busy = busyId === k.resourceName
                      return (
                        <tr key={i} className="hover:bg-gray-50">
                          <td className="px-3 py-2 text-gray-800">
                            {k.texto} <span className="text-gray-400 text-xs">({k.matchType?.toLowerCase()})</span>
                            {!activa && <span className="ml-1.5 text-[10px] font-semibold text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">pausada</span>}
                            {campanaApagada && <span className="ml-1.5 text-[10px] font-semibold text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded" title="La keyword figura habilitada, pero su campaña o grupo de anuncios está pausado: no está gastando.">no gasta (campaña pausada)</span>}
                          </td>
                          <td className="px-3 py-2 text-gray-500 max-w-[200px] truncate">{k.campana}{k.campanaEstado && k.campanaEstado !== 'ENABLED' && <span className="text-amber-600"> (pausada)</span>}</td>
                          <td className="px-3 py-2 text-right">{money(k.gasto)}</td>
                          <td className="px-3 py-2 text-right">{fmt(k.clicks)}</td>
                          <td className="px-3 py-2 text-right">{k.ctr.toFixed(2)}%</td>
                          <td className="px-3 py-2 text-right">{money(k.cpc)}</td>
                          <td className="px-3 py-2 text-right">
                            {activa ? (
                              <button disabled={busy} onClick={() => toggleKeyword(k)} className="text-xs font-semibold text-amber-800 border border-amber-300 bg-amber-50 rounded-lg px-2.5 py-1 hover:bg-amber-100 disabled:opacity-50">Pausar</button>
                            ) : (
                              <button disabled={busy} onClick={() => toggleKeyword(k)} className="text-xs font-semibold text-emerald-800 border border-emerald-300 bg-emerald-50 rounded-lg px-2.5 py-1 hover:bg-emerald-100 disabled:opacity-50">Activar</button>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {data?.terminos && data.terminos.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                Términos de búsqueda reales (top {data.terminos.length} por gasto)
                <span className="normal-case font-normal text-gray-400"> — lo que la gente escribió en Google; bloqueá los que no sirvan como negativa</span>
              </p>
              <div className="overflow-x-auto rounded-xl border border-gray-200">
                <table className="w-full min-w-[720px] text-sm">
                  <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
                    <tr>
                      <th className="text-left px-3 py-2">Término buscado</th>
                      <th className="text-left px-3 py-2">Campaña</th>
                      <th className="text-right px-3 py-2">Gasto</th>
                      <th className="text-right px-3 py-2">Clics</th>
                      <th className="text-right px-3 py-2">Conversiones</th>
                      <th className="text-right px-3 py-2">Acciones</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {data.terminos.map((t, i) => (
                      <tr key={i} className="hover:bg-gray-50">
                        <td className="px-3 py-2 text-gray-800">{t.termino}</td>
                        <td className="px-3 py-2 text-gray-500 max-w-[200px] truncate">{t.campana}</td>
                        <td className="px-3 py-2 text-right">{money(t.gasto)}</td>
                        <td className="px-3 py-2 text-right">{fmt(t.clicks)}</td>
                        <td className="px-3 py-2 text-right">{t.conversiones.toLocaleString('es-CL')}</td>
                        <td className="px-3 py-2 text-right">
                          <button disabled={busyId === `neg-${t.termino}`} onClick={() => agregarNegativa(t)} className="text-xs font-semibold text-red-700 border border-red-200 bg-red-50 rounded-lg px-2.5 py-1 hover:bg-red-100 disabled:opacity-50">🚫 Negativa</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div>
            <div className="flex items-center justify-between gap-3 flex-wrap mb-2">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                Listas de negativas compartidas
                <span className="normal-case font-normal text-gray-400"> — aplican a TODAS las campañas de una vez</span>
              </p>
              <button disabled={busyId === 'crear-lista-negativas'} onClick={crearListaUniversal} className="text-xs font-semibold text-white bg-[#143C64] rounded-lg px-3 py-1.5 hover:bg-[#0f2e4d] disabled:opacity-50 shrink-0">
                + Crear lista universal ES-CL
              </button>
            </div>
            {data?.listasNegativas && data.listasNegativas.length > 0 ? (
              <div className="space-y-2">
                {data.listasNegativas.map(l => (
                  <div key={l.resourceName} className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 flex items-center justify-between gap-3 flex-wrap">
                    <div>
                      <p className="text-sm font-semibold text-gray-800">{l.nombre} <span className="font-normal text-gray-400">— {l.cantidadTerminos} términos</span></p>
                      <p className="text-xs text-gray-500">Campañas: {l.campanas.join(', ') || '(sin adjuntar a ninguna)'}</p>
                    </div>
                    <button disabled={busyId === l.resourceName} onClick={() => eliminarLista(l)} className="text-xs font-semibold text-red-700 border border-red-200 bg-red-50 rounded-lg px-2.5 py-1 hover:bg-red-100 disabled:opacity-50 shrink-0">Eliminar</button>
                  </div>
                ))}
              </div>
            ) : <p className="text-sm text-gray-400">Sin listas compartidas todavía — hoy todas las negativas están cargadas campaña por campaña.</p>}
          </div>
        </>
      ) : <p className="text-sm text-gray-400">Sin datos de Ads.</p>}
    </div>
  )
}

function MetricasPanel() {
  const [periodo, setPeriodo] = useState('last_30d')
  const [data, setData] = useState<MetResp | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')

  const cargar = useCallback(async () => {
    setLoading(true); setErr('')
    try {
      const r = await fetch(`/api/mailing/metricas?que=ambos&periodo=${periodo}`, { cache: 'no-store' })
      const d = await r.json()
      if (!r.ok) { setErr(d.error || 'Error'); setData(null) } else setData(d)
    } catch { setErr('Error de red'); setData(null) }
    setLoading(false)
  }, [periodo])
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    cargar()
  }, [cargar])

  const fmt = (n: number) => Math.round(n || 0).toLocaleString('es-CL')
  const ads = data?.ads
  const org = data?.organico
  const money = (n: number) => `$${fmt(n)}${ads && ads.moneda !== 'CLP' ? ' ' + ads.moneda : ''}`

  const KPIS = ads ? [
    { l: 'Gasto', v: money(ads.cuenta.spend) },
    { l: 'Alcance', v: fmt(ads.cuenta.alcance) },
    { l: 'Impresiones', v: fmt(ads.cuenta.impresiones) },
    { l: 'Clics', v: fmt(ads.cuenta.clicks) },
    { l: 'CTR', v: `${ads.cuenta.ctr.toFixed(2)}%` },
    { l: 'CPC', v: money(ads.cuenta.cpc) },
  ] : []

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl shadow-md border-2 border-gray-300 p-5">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-base font-bold text-gray-900">📊 Métricas</h2>
            <p className="text-sm text-gray-500">Datos en vivo de Meta: anuncios pagados y posts orgánicos. El período aplica a los Ads.</p>
          </div>
          <div className="flex items-center gap-2">
            <select value={periodo} onChange={e => setPeriodo(e.target.value)} className="border-2 border-gray-300 rounded-lg px-2 py-1.5 text-sm">
              {PERIODOS.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
            </select>
            <button onClick={cargar} className="text-sm border-2 border-gray-300 rounded-lg px-3 py-1.5 font-semibold hover:bg-gray-50">Actualizar</button>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="bg-white rounded-2xl shadow-md border-2 border-gray-300 p-8 text-center text-sm text-gray-400">Cargando…</div>
      ) : err ? (
        <div className="bg-red-50 border-2 border-red-200 text-red-800 rounded-2xl px-4 py-3 text-sm">{err}</div>
      ) : (
        <>
          <div className="bg-white rounded-2xl shadow-md border-2 border-gray-300 p-5 space-y-4">
            <h3 className="text-sm font-bold text-[#143C64] uppercase tracking-wide">Anuncios pagados (Meta Ads)</h3>
            {data?.ads_error ? (
              <p className="text-sm text-gray-500">No se pudieron leer los Ads: {data.ads_error}</p>
            ) : ads ? (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                  {KPIS.map(k => (
                    <div key={k.l} className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2">
                      <div className="text-[11px] text-gray-500">{k.l}</div>
                      <div className="text-lg font-bold text-gray-900">{k.v}</div>
                    </div>
                  ))}
                </div>
                {ads.cuenta.acciones.length > 0 && (
                  <p className="text-xs text-gray-500">Resultados: {ads.cuenta.acciones.map(a => `${a.tipo} (${fmt(a.valor)})`).join(' · ')}</p>
                )}
                {ads.campanas.length > 0 ? (
                  <div className="overflow-x-auto rounded-xl border border-gray-200">
                    <table className="w-full min-w-[640px] text-sm">
                      <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
                        <tr><th className="text-left px-3 py-2">Campaña</th><th className="text-right px-3 py-2">Gasto</th><th className="text-right px-3 py-2">Alcance</th><th className="text-right px-3 py-2">Clics</th><th className="text-right px-3 py-2">CTR</th><th className="text-right px-3 py-2">CPC</th></tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {ads.campanas.map((c, i) => (
                          <tr key={i} className="hover:bg-gray-50">
                            <td className="px-3 py-2 text-gray-800 max-w-[260px] truncate">{c.nombre}</td>
                            <td className="px-3 py-2 text-right">{money(c.spend)}</td>
                            <td className="px-3 py-2 text-right">{fmt(c.alcance)}</td>
                            <td className="px-3 py-2 text-right">{fmt(c.clicks)}</td>
                            <td className="px-3 py-2 text-right">{c.ctr.toFixed(2)}%</td>
                            <td className="px-3 py-2 text-right">{money(c.cpc)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : <p className="text-sm text-gray-400">Sin campañas con datos en este período.</p>}
              </>
            ) : <p className="text-sm text-gray-400">Sin datos de Ads.</p>}
          </div>

          <GestionCampanas />

          <GoogleAdsPanel periodo={periodo} />

          <div className="bg-white rounded-2xl shadow-md border-2 border-gray-300 p-5 space-y-3">
            <h3 className="text-sm font-bold text-[#143C64] uppercase tracking-wide">Orgánico (Facebook)</h3>
            {data?.organico_error ? (
              <p className="text-sm text-gray-500">No se pudo leer lo orgánico: {data.organico_error}</p>
            ) : org ? (
              <>
                <p className="text-sm text-gray-700"><b>{fmt(org.seguidores)}</b> seguidores</p>
                {org.posts.length > 0 ? (
                  <div className="overflow-x-auto rounded-xl border border-gray-200">
                    <table className="w-full min-w-[640px] text-sm">
                      <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
                        <tr><th className="text-left px-3 py-2">Fecha</th><th className="text-left px-3 py-2">Post</th><th className="text-right px-3 py-2">Impresiones</th><th className="text-right px-3 py-2">Interacciones</th><th className="px-3 py-2"></th></tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {org.posts.map((p, i) => (
                          <tr key={i} className="hover:bg-gray-50">
                            <td className="px-3 py-2 whitespace-nowrap text-gray-600">{(p.fecha || '').slice(0, 10)}</td>
                            <td className="px-3 py-2 text-gray-800 max-w-[280px] truncate">{p.mensaje || '(sin texto)'}</td>
                            <td className="px-3 py-2 text-right">{fmt(p.impresiones)}</td>
                            <td className="px-3 py-2 text-right">{fmt(p.reacciones + p.comentarios + p.compartidos)}</td>
                            <td className="px-3 py-2 text-right">{p.url && <a href={p.url} target="_blank" rel="noreferrer" className="text-brand hover:underline text-xs">ver ↗</a>}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : <p className="text-sm text-gray-400">Sin posts recientes con datos.</p>}
              </>
            ) : <p className="text-sm text-gray-400">Sin datos orgánicos.</p>}
          </div>
        </>
      )}
    </div>
  )
}


// ===================== MAIL (módulo histórico completo) =====================

function MailContent({ onBack }: { onBack?: () => void }) {
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
        {onBack && <button onClick={onBack} className="text-sm text-brand hover:text-brand font-semibold mb-1">← Campañas</button>}
        <div className="flex items-center gap-2">
          <span className="w-9 h-9 rounded-lg bg-brand/10 grid place-items-center text-xl">✉️</span>
          <h2 className="text-xl font-bold text-gray-900">Mailing</h2>
        </div>
        <p className="text-sm text-gray-500 mt-0.5">Campañas de email a la base de veterinarios.</p>
      </div>

      {diag && <DiagBanner d={diag} />}

      <div className="inline-flex gap-1 bg-gray-100 border border-gray-300 rounded-2xl p-1.5 shadow-md overflow-x-auto">
        {TABS.map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 rounded-xl text-sm font-semibold whitespace-nowrap transition-all flex items-center gap-1.5 ${
              tab === t
                ? 'bg-brand text-white shadow-md ring-1 ring-brand/10'
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

      <div className="bg-white rounded-2xl shadow-md border-2 border-gray-300 overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-gray-300">
          <input
            type="text"
            value={busqueda}
            onChange={e => setBusqueda(e.target.value)}
            placeholder="Buscar por nombre, email, clínica…"
            className="flex-1 min-w-[200px] border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:border-brand focus:outline-none"
          />
          <select
            value={filtroCategoria}
            onChange={e => setFiltroCategoria(e.target.value)}
            className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:border-brand focus:outline-none"
          >
            <option value="todos">Todas las categorías</option>
            {CATEGORIAS.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <select
            value={filtroSuscrito}
            onChange={e => setFiltroSuscrito(e.target.value as 'todos' | 'TRUE' | 'FALSE')}
            className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:border-brand focus:outline-none"
          >
            <option value="todos">Suscripción: todos</option>
            <option value="TRUE">Solo suscritos</option>
            <option value="FALSE">Solo desuscritos</option>
          </select>
          <button
            onClick={abrirNuevo}
            className="bg-brand hover:bg-brand-dark text-white font-semibold rounded-lg px-4 py-1.5 text-sm shadow-md transition-colors"
          >
            + Agregar
          </button>
        </div>

        {selectedIds.size > 0 && (
          <div className="bg-brand/10 border-b border-brand/30 px-4 py-2.5 flex flex-wrap items-center gap-3">
            <span className="text-sm font-semibold text-brand">
              {selectedIds.size} seleccionado{selectedIds.size === 1 ? '' : 's'}
            </span>
            <select
              value={bulkAction}
              onChange={e => { setBulkAction(e.target.value as typeof bulkAction); setBulkValue('') }}
              className="border border-brand/40 rounded-lg px-2 py-1 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand"
            >
              <option value="">— Acción masiva —</option>
              <option value="set_categoria">Cambiar categoría</option>
              <option value="set_suscrito">Cambiar suscripción</option>
              <option value="delete">Eliminar</option>
            </select>
            {bulkAction === 'set_categoria' && (
              <select value={bulkValue} onChange={e => setBulkValue(e.target.value)}
                className="border border-brand/40 rounded-lg px-2 py-1 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand">
                <option value="">— a qué categoría —</option>
                {CATEGORIAS.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            )}
            {bulkAction === 'set_suscrito' && (
              <select value={bulkValue} onChange={e => setBulkValue(e.target.value)}
                className="border border-brand/40 rounded-lg px-2 py-1 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand">
                <option value="">— suscribir o desuscribir —</option>
                <option value="TRUE">Suscribir</option>
                <option value="FALSE">Desuscribir</option>
              </select>
            )}
            <button
              onClick={ejecutarBulk}
              disabled={bulkExecuting || !bulkAction || (bulkAction !== 'delete' && !bulkValue)}
              className="bg-brand hover:bg-brand-dark text-white font-semibold rounded-lg px-3 py-1 text-sm disabled:opacity-50"
            >
              {bulkExecuting ? 'Aplicando…' : 'Aplicar'}
            </button>
            <button
              onClick={clearSelection}
              className="text-xs text-brand hover:underline ml-auto"
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
                      className="w-4 h-4 rounded text-brand"
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
                    <tr key={v.id} className={isSel ? 'bg-brand/10' : 'hover:bg-gray-50'}>
                      <td className="px-2 py-2">
                        <input type="checkbox" checked={isSel} onChange={() => toggleSelectVet(v.id)}
                          className="w-4 h-4 rounded text-brand" />
                      </td>
                      <td className="px-3 py-2 text-gray-900 font-medium">{v.nombre}</td>
                      <td className="px-3 py-2 text-gray-700">{v.email}</td>
                      <td className="px-3 py-2 text-gray-600">{v.veterinaria || '—'}</td>
                      <td className="px-3 py-2 text-gray-600">{v.comuna || '—'}</td>
                      <td className="px-3 py-2">
                        <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] uppercase font-bold ${
                          v.categoria === 'cliente' ? 'bg-emerald-100 text-emerald-800' :
                          v.categoria === 'prospecto' ? 'bg-brand/10 text-brand' :
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
                className="mt-1 w-full border-2 border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand">
                {CATEGORIAS.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </FieldRow>
          <div className="flex items-center gap-2">
            <input type="checkbox" id="suscrito" checked={form.suscrito === 'TRUE'}
              onChange={e => setForm(f => ({ ...f, suscrito: e.target.checked ? 'TRUE' : 'FALSE' }))}
              className="w-4 h-4 rounded border-gray-400 text-brand" />
            <label htmlFor="suscrito" className="text-xs font-medium text-gray-700">Suscrito a campañas (si está desmarcado, no recibe mails)</label>
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-700">Notas</label>
            <textarea value={form.notas}
              onChange={e => setForm(f => ({ ...f, notas: e.target.value }))}
              rows={2}
              className="mt-1 w-full border-2 border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand" />
          </div>
          {error && <div className="bg-red-50 border border-red-200 text-red-800 rounded-lg px-3 py-2 text-sm">{error}</div>}
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={() => setModalOpen(false)} className="flex-1 border-2 border-gray-300 text-gray-700 rounded-lg py-2 text-sm font-semibold hover:bg-gray-50 transition-colors">
              Cancelar
            </button>
            <button type="submit" disabled={saving} className="flex-1 bg-brand hover:bg-brand-dark text-white rounded-lg py-2 text-sm font-semibold shadow-md transition-colors disabled:opacity-50">
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
                accent === 'indigo' ? 'text-brand' :
                accent === 'emerald' ? 'text-emerald-700' :
                accent === 'gray' ? 'text-gray-600' :
                'text-gray-900'
  const tint = accent === 'green' ? 'bg-green-100' :
               accent === 'indigo' ? 'bg-brand/10' :
               accent === 'emerald' ? 'bg-emerald-100' :
               'bg-gray-100'
  return (
    <div className="bg-white rounded-2xl shadow-md border-2 border-gray-300 px-4 py-3 flex items-center gap-3">
      {icon && <div className={`w-10 h-10 rounded-xl grid place-items-center text-xl shrink-0 ${tint}`}>{icon}</div>}
      <div className="min-w-0">
        <div className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">{label}</div>
        <div className={`text-2xl font-bold ${color}`}>{value}</div>
      </div>
    </div>
  )
}

const BAR_COLORS: Record<string, { bar: string; text: string }> = {
  indigo:   { bar: 'bg-brand',   text: 'text-brand' },
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
    <div className="bg-white rounded-2xl shadow-md border-2 border-gray-300 p-4">
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
        className="mt-1 w-full border-2 border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand" />
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
      <div className="bg-white rounded-2xl shadow-md border-2 border-gray-300 overflow-hidden">
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
              <thead className="bg-gray-50 border-b border-gray-300">
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
                    <tr key={c.id} className="hover:bg-brand/10/40 cursor-pointer transition-colors" onClick={() => abrirDetalle(c)}>
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
                              <button onClick={() => reanudar(c)} className="bg-emerald-600 hover:bg-emerald-700 text-white w-7 h-7 grid place-items-center rounded-md text-sm shadow-md" title="Reanudar envío a los que faltan">↻</button>
                              <button onClick={() => cancelar(c)} className="bg-amber-600 hover:bg-amber-700 text-white w-7 h-7 grid place-items-center rounded-md text-sm shadow-md" title="Cancelar envío">✕</button>
                            </>
                          )}
                          {(c.estado === 'enviado' || c.estado === 'fallido' || c.estado === 'cancelado') && (
                            <button onClick={() => reanudar(c)} className="bg-emerald-600 hover:bg-emerald-700 text-white w-7 h-7 grid place-items-center rounded-md text-sm shadow-md" title="Reanudar / reintentar fallidos">↻</button>
                          )}
                          {(c.estado === 'enviado' || c.estado === 'fallido' || c.estado === 'cancelado') && (
                            <button onClick={() => duplicar(c)} className="bg-brand hover:bg-brand-dark text-white w-7 h-7 grid place-items-center rounded-md text-sm shadow-md" title="Duplicar campaña">⧉</button>
                          )}
                          {(c.estado === 'enviado' || c.estado === 'fallido') && (
                            <button onClick={() => abrirDebug(c)} className="bg-gray-700 hover:bg-gray-800 text-white w-7 h-7 grid place-items-center rounded-md text-sm shadow-md" title="Ver diagnóstico de tracking">🔍</button>
                          )}
                          {c.estado !== 'enviando' && (
                            <button onClick={() => eliminar(c)} className="bg-red-600 hover:bg-red-700 text-white w-7 h-7 grid place-items-center rounded-md text-sm shadow-md" title="Eliminar campaña">🗑</button>
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
                <ul className="bg-gray-50 border border-gray-300 rounded-lg p-3 space-y-1 font-mono">
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
                <pre className="bg-gray-50 border border-gray-300 rounded-lg p-3 overflow-x-auto text-gray-600">
                  {JSON.stringify(debugData.contadores_planilla, null, 2)}
                </pre>
                <p className="text-[11px] text-gray-500 mt-1 italic">Los reales (verde) son la fuente de verdad. Estos pueden estar atrasados.</p>
              </section>
            )}
            {debugData.distribucion_logs && Object.keys(debugData.distribucion_logs).length > 0 && (
              <section>
                <h3 className="text-sm font-bold text-gray-900 mb-2">Distribución de estados en logs</h3>
                <pre className="bg-gray-50 border border-gray-300 rounded-lg p-3 overflow-x-auto">
                  {JSON.stringify(debugData.distribucion_logs, null, 2)}
                </pre>
              </section>
            )}
            {debugData.interpretacion && debugData.interpretacion.length > 0 && (
              <section>
                <h3 className="text-sm font-bold text-gray-900 mb-2">Interpretación</h3>
                <ul className="bg-brand/10 border border-brand/30 rounded-lg p-3 space-y-1">
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
                <div className="border border-gray-300 rounded-lg overflow-hidden max-h-96 overflow-y-auto">
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

            <div className="border border-gray-300 rounded-lg overflow-hidden">
              <div className="bg-gray-50 px-3 py-2 text-xs font-semibold text-gray-700">Preview HTML</div>
              {loadingDetalle ? (
                <div className="p-8 text-center text-sm text-gray-400">Cargando…</div>
              ) : (
                <iframe srcDoc={proxyImgs(detalleHtml)} className="w-full h-96 bg-white" sandbox="allow-same-origin" referrerPolicy="no-referrer" />
              )}
            </div>

            <div className="border border-gray-300 rounded-lg overflow-hidden">
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
                <button type="button" onClick={() => duplicar(detalle)} className="flex-1 bg-brand hover:bg-brand-dark text-white rounded-lg py-2 text-sm font-semibold">
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
        <div className="bg-gray-50 rounded-lg px-3 py-2 border border-gray-300">
          <div className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">Alcance</div>
          <div className="text-2xl font-bold text-gray-900">{enviados}<span className="text-sm text-gray-400 font-normal"> / {total}</span></div>
          <div className="text-[10px] text-gray-500">enviados de {total} seleccionados</div>
        </div>
        <div className="bg-emerald-50 rounded-lg px-3 py-2 border border-emerald-200">
          <div className="text-[10px] uppercase tracking-wider text-emerald-700 font-semibold">Leídos</div>
          <div className="text-2xl font-bold text-emerald-900">{aperturas}<span className="text-sm text-emerald-600 font-normal"> · {tasaApertura ?? '—'}%</span></div>
          <div className="text-[10px] text-emerald-700">aperturas (al menos una)</div>
        </div>
        <div className="bg-gray-50 rounded-lg px-3 py-2 border border-gray-300">
          <div className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">No leídos</div>
          <div className="text-2xl font-bold text-gray-700">{noLeidos}</div>
          <div className="text-[10px] text-gray-500">entregados sin apertura</div>
        </div>
      </div>

      {/* Barras de tasas */}
      <div className="bg-white border border-gray-300 rounded-lg px-4 py-3 space-y-2">
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
    <div className="bg-gray-50 rounded-lg px-2 py-1.5 border border-gray-300">
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
      <div className="lg:col-span-5 bg-white rounded-2xl shadow-md border-2 border-gray-300 p-5 space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h2 className="text-base font-bold text-gray-900">{draftId ? `Editando borrador N° ${draftId}` : 'Nueva campaña'}</h2>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setGenerarOpen(true)}
              className="inline-flex items-center gap-1.5 bg-gradient-to-r from-violet-600 to-brand-dark hover:from-violet-700 hover:to-brand-dark text-white text-xs font-semibold rounded-lg px-3 py-1.5 shadow-md transition-colors">
              <span>✨</span> Generar con IA
            </button>
            {draftId && (
              <button type="button" onClick={nuevaCampana}
                className="inline-flex items-center gap-1 bg-brand hover:bg-brand-dark text-white text-xs font-semibold rounded-lg px-3 py-1.5 shadow-md transition-colors">
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
              className="border-2 border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand">
              <option value="todos">Todas las categorías</option>
              {CATEGORIAS.map(c => <option key={c} value={c}>Solo {c}s</option>)}
            </select>
            <span className="text-sm text-gray-600">
              <span className="font-semibold text-brand">{destinatariosCount}</span> destinatario{destinatariosCount === 1 ? '' : 's'} suscrito{destinatariosCount === 1 ? '' : 's'} matchea{destinatariosCount === 1 ? '' : 'n'} este filtro.
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
                className="inline-flex items-center gap-1 border-2 border-brand/30 bg-brand/10 text-brand hover:bg-brand/10 text-xs font-semibold rounded-lg px-2.5 py-1 transition-colors">
                📁 Cargar desde archivo (.html)
              </button>
            </div>
            <input ref={fileRef} type="file" accept=".html,text/html" onChange={onFileChange} className="hidden" />
          </div>
          <textarea ref={htmlRef} value={form.html} onChange={e => setForm(f => ({ ...f, html: e.target.value }))}
            rows={14}
            placeholder="<html><body>Hola {{primer_nombre}}, …</body></html>"
            className="w-full font-mono text-xs border-2 border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand" />
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
            className="ml-auto bg-brand hover:bg-brand-dark text-white rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50">
            {enviando ? `Enviando…` : `Enviar a ${destinatariosCount}`}
          </button>
        </div>
      </div>

      <div className="lg:col-span-4 bg-white rounded-2xl shadow-md border-2 border-gray-300 p-3 flex flex-col">
        <div className="text-xs font-semibold text-gray-700 mb-2 flex items-center justify-between">
          <span>Preview (con vet de muestra)</span>
          <span className="text-[10px] font-normal text-gray-400">así lo va a ver el destinatario</span>
        </div>
        <iframe
          srcDoc={previewHtml ? proxyImgs(previewHtml) : '<p style="font-family:sans-serif;color:#999;padding:1rem">Escribe HTML para ver el preview.</p>'}
          className="w-full h-[660px] border border-gray-300 rounded bg-white"
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
            className="w-full bg-gradient-to-r from-violet-600 to-brand-dark hover:from-violet-700 hover:to-brand-dark text-white rounded-lg py-1.5 text-xs font-semibold shadow-md disabled:opacity-50"
          >
            {iaEditando ? 'Aplicando cambios… (puede tardar)' : 'Aplicar cambios al correo'}
          </button>
        </div>
      </div>

      {borradores.length > 0 && (
        <div className="lg:col-span-9 bg-white rounded-2xl shadow-md border-2 border-gray-300 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-300 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-900">Borradores guardados ({borradores.length})</h3>
            <span className="text-xs text-gray-500">Click en una fila para cargar y editar</span>
          </div>
          <ul className="divide-y divide-gray-100">
            {borradores.map(b => {
              const isActive = draftId === b.id
              return (
                <li key={b.id}
                  onClick={() => !isActive && cargarBorrador(b)}
                  className={`px-4 py-2.5 flex items-center gap-3 ${isActive ? 'bg-brand/10' : 'hover:bg-gray-50 cursor-pointer'}`}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm text-gray-900 truncate">{b.asunto || '(sin asunto)'}</span>
                      <span className="text-[10px] uppercase font-bold bg-gray-100 text-gray-700 rounded px-1.5 py-0.5">N° {b.id}</span>
                      {isActive && <span className="text-[10px] uppercase font-bold bg-brand text-white rounded px-1.5 py-0.5">Editando</span>}
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
                        className="bg-brand hover:bg-brand-dark text-white px-2.5 py-1 rounded text-xs font-medium disabled:opacity-50"
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
              className="flex-1 bg-brand hover:bg-brand-dark text-white rounded-lg py-2 text-sm font-semibold disabled:opacity-50">
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
            placeholder="Ej: invitar a las clínicas de la zona oriente a sumarse al convenio, destacando la entrega en 3 días hábiles, el retiro desde la clínica y la trazabilidad total. Cerrar con un botón para coordinar una reunión."
            className="mt-1 w-full border-2 border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand" />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="text-xs font-semibold text-gray-700">Grupo destinatario</label>
            <select value={categoria} onChange={e => setCategoria(e.target.value)}
              className="mt-1 w-full border-2 border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand">
              <option value="todos">Todas las categorías</option>
              {CATEGORIAS.map(c => <option key={c} value={c}>Solo {c}s</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-700">Formato</label>
            <select value={formato} onChange={e => setFormato(e.target.value)}
              className="mt-1 w-full border-2 border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand">
              {FORMATOS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-700">Tono</label>
            <select value={tono} onChange={e => setTono(e.target.value)}
              className="mt-1 w-full border-2 border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand">
              {TONOS.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        </div>

        {error && <div className="bg-red-50 border border-red-200 text-red-800 rounded-lg px-3 py-2 text-sm">{error}</div>}

        {!result && (
          <button type="button" onClick={generarNueva} disabled={loading || !instruccion.trim()}
            className="w-full bg-gradient-to-r from-violet-600 to-brand-dark hover:from-violet-700 hover:to-brand-dark text-white rounded-lg py-2.5 text-sm font-semibold shadow-md disabled:opacity-50">
            {loading ? 'Generando… (las imágenes pueden tardar hasta ~1 min)' : '✨ Generar campaña'}
          </button>
        )}

        {result && (
          <div className="space-y-3 border-t border-gray-300 pt-3">
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

            <div className="border border-gray-300 rounded-lg overflow-hidden">
              <div className="bg-gray-50 px-3 py-2 text-xs font-semibold text-gray-700 flex items-center justify-between">
                <span>Vista previa (con vet de muestra)</span>
                {loading && <span className="text-[11px] font-normal text-brand">{accion === 'ajustar' ? 'Ajustando…' : 'Generando otra versión…'}</span>}
              </div>
              <iframe srcDoc={proxyImgs(previewHtml)} className="w-full h-[420px] bg-white" sandbox="allow-same-origin" referrerPolicy="no-referrer" />
            </div>

            <div className="bg-gray-50 border border-gray-300 rounded-lg p-3 space-y-2">
              <label className="text-xs font-semibold text-gray-700">¿Quieres ajustar algo? Escribe un comentario</label>
              <textarea value={comentario} onChange={e => setComentario(e.target.value)} rows={2}
                placeholder="Ej: hazlo más corto, agrega un botón para agendar reunión, tono más formal, cambia la foto principal por una de un gato…"
                className="w-full border-2 border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand" />
              <div className="flex gap-2 flex-wrap">
                <button type="button" onClick={ajustar} disabled={loading || !comentario.trim()}
                  className="bg-brand hover:bg-brand-dark text-white rounded-lg px-3 py-1.5 text-sm font-semibold disabled:opacity-50">
                  {loading && accion === 'ajustar' ? 'Ajustando…' : 'Ajustar con comentario'}
                </button>
                <button type="button" onClick={variar} disabled={loading}
                  className="border-2 border-brand/30 bg-brand/10 text-brand hover:bg-brand/10 rounded-lg px-3 py-1.5 text-sm font-semibold disabled:opacity-50">
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
                className="flex-1 bg-brand hover:bg-brand-dark text-white rounded-lg py-2 text-sm font-semibold shadow-md disabled:opacity-50">
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
            className="flex-1 border-2 border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand" />
          <button type="button" onClick={cargar} className="text-xs text-brand hover:underline">Actualizar</button>
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
                className="group text-left border border-gray-300 rounded-lg overflow-hidden hover:ring-2 hover:ring-brand transition">
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

