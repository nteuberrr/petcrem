'use client'
import { useState, useEffect, useCallback, useRef, Fragment } from 'react'
import { Modal } from '@/components/ui/Modal'
import { formatDate } from '@/lib/dates'
import { Markdown } from '@/components/marketing/Markdown'
import { CanalIcon, AgenteIcon } from '@/components/marketing/BrandIcons'

// ── Tipos ─────────────────────────────────────────────────────────────────────
type Item = {
  id: string
  fecha: string
  hora: string
  canal: string
  estado: string
  activa: string
  favorita: string
  objetivo: string
  audiencia: string
  idea: string
  titulo: string
  cuerpo: string
  imagen_id: string
  imagen_url: string
  imagenes_json: string
  campana_id: string
  post_externo_id: string
  post_url: string
  estado_publicacion: string
  error_publicacion: string
  generado_por: string
  aprobado_por: string
  fecha_publicacion: string
  notas: string
}
type Msg = { rol: 'usuario' | 'agente'; texto: string }

const CANALES = [
  { key: 'email', label: 'Email', icon: '✉️' },
  { key: 'instagram', label: 'Instagram', icon: '📸' },
  { key: 'facebook', label: 'Facebook', icon: '👍' },
] as const
const CANAL_MAP: Record<string, { label: string; icon: string; cls: string; chip: string }> = {
  email: { label: 'Email', icon: '✉️', cls: 'bg-brand/10 text-brand', chip: 'bg-brand/10 text-brand border-brand/30' },
  instagram: { label: 'Instagram', icon: '📸', cls: 'bg-pink-100 text-pink-700', chip: 'bg-pink-100 text-pink-800 border-pink-200' },
  facebook: { label: 'Facebook', icon: '👍', cls: 'bg-blue-100 text-blue-700', chip: 'bg-blue-100 text-blue-800 border-blue-200' },
}
const ESTADO_MAP: Record<string, { label: string; cls: string; dot: string }> = {
  propuesta: { label: 'Propuesta', cls: 'bg-amber-100 text-amber-700', dot: 'bg-amber-400' },
  aprobada: { label: 'Aprobada', cls: 'bg-sky-100 text-sky-700', dot: 'bg-sky-400' },
  generada: { label: 'Generada', cls: 'bg-violet-100 text-violet-700', dot: 'bg-violet-400' },
  programada: { label: 'Programada', cls: 'bg-teal-100 text-teal-700', dot: 'bg-teal-400' },
  publicada: { label: 'Publicada', cls: 'bg-emerald-100 text-emerald-700', dot: 'bg-emerald-500' },
  descartada: { label: 'Descartada', cls: 'bg-gray-100 text-gray-500', dot: 'bg-gray-300' },
}
const OBJETIVOS = [
  { key: 'captacion_vets', label: 'Captar veterinarios' },
  { key: 'recordacion', label: 'Recordación de marca' },
  { key: 'educacion_tutores', label: 'Educar tutores' },
  { key: 'postventa', label: 'Postventa' },
  { key: 'promocion', label: 'Promoción' },
]
const OBJETIVO_LABEL: Record<string, string> = Object.fromEntries(OBJETIVOS.map(o => [o.key, o.label]))
const AUDIENCIAS = [
  { key: 'tutores', label: 'Tutores' },
  { key: 'veterinarios', label: 'Veterinarios' },
  { key: 'ambos', label: 'Ambos' },
]
const DIAS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']
const QUICK = [
  'Armá un plan de campañas para este mes, repartido por canal.',
  'Dame 3 ideas de contenido para Instagram esta semana.',
  'Propón un correo para captar nuevas clínicas veterinarias.',
]

// Fecha de hoy en ISO (getters locales = zona del navegador, sin shift UTC).
function hoyISO(): string {
  const n = new Date()
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`
}
function isoDe(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
/** Cantidad de imágenes del post (para el badge de carrusel). */
function nImgs(it: { imagenes_json: string; imagen_url: string }): number {
  try {
    const a = it.imagenes_json ? JSON.parse(it.imagenes_json) : []
    if (Array.isArray(a) && a.length) return a.length
  } catch { /* ignore */ }
  return it.imagen_url ? 1 : 0
}
/** Tipo de pieza para mostrar/identificar (derivado del canal + nº de imágenes). */
function tipoDe(it: { canal: string; imagenes_json: string; imagen_url: string }): string {
  if (it.canal === 'email') return 'Email'
  const n = nImgs(it)
  if (n > 1) return 'Carrusel'
  if (n === 1) return 'Imagen'
  return 'Texto'
}
/** Lee un File como data URL base64 (para adjuntar imágenes de referencia al agente). */
function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = reject
    r.readAsDataURL(file)
  })
}

export default function CalendarioContent({ onBack, canalInicial }: { onBack?: () => void; canalInicial?: string }) {
  const [items, setItems] = useState<Item[]>([])
  const [cargando, setCargando] = useState(true)
  const [vista, setVista] = useState<'calendario' | 'lista'>('calendario')
  const [filtroCanal, setFiltroCanal] = useState<string>(canalInicial || 'todos')
  const [filtrosEstado, setFiltrosEstado] = useState<string[]>([])
  const [soloFav, setSoloFav] = useState(false)
  const [perf, setPerf] = useState<Record<string, number>>({})
  const [busy, setBusy] = useState<string>('')

  // mes mostrado en la vista calendario
  const ahora = new Date()
  const [mes, setMes] = useState<{ y: number; m: number }>({ y: ahora.getFullYear(), m: ahora.getMonth() })

  // chat (persistido en localStorage por canal para que sobreviva la navegación)
  const chatKey = `mkt-chat-${canalInicial || 'general'}`
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [pensando, setPensando] = useState(false)
  const chatEnd = useRef<HTMLDivElement>(null)
  const chatCargado = useRef(false)
  const [verInactivas, setVerInactivas] = useState(false)
  const [adjuntos, setAdjuntos] = useState<string[]>([])
  const fileRef = useRef<HTMLInputElement>(null)

  // modales
  const [editItem, setEditItem] = useState<Item | null>(null)
  const [preview, setPreview] = useState<Item | null>(null)
  const [nuevoFecha, setNuevoFecha] = useState<string | null>(null) // '' = nuevo sin fecha; null = cerrado
  const [configOpen, setConfigOpen] = useState(false)
  const [diaSel, setDiaSel] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    setCargando(true)
    try {
      const r = await fetch('/api/mailing/calendario')
      const d = await r.json()
      if (r.ok) {
        const its: Item[] = d.items || []
        setItems(its)
        // Performance de los posts publicados → para destacar (🔥) los que rinden bien.
        const pubIds = its.filter(x => x.post_externo_id).map(x => x.post_externo_id)
        if (pubIds.length) {
          fetch('/api/mailing/calendario/performance', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: pubIds }) })
            .then(r2 => (r2.ok ? r2.json() : {})).then(p => setPerf(p || {})).catch(() => { /* ignore */ })
        }
      }
    } finally { setCargando(false) }
  }, [])

  useEffect(() => { cargar() }, [cargar])
  useEffect(() => { chatEnd.current?.scrollIntoView({ behavior: 'smooth' }) }, [msgs, pensando])
  // Cargar el chat guardado al montar (una vez); después persistir cada cambio.
  useEffect(() => {
    try { const s = localStorage.getItem(chatKey); if (s) setMsgs(JSON.parse(s)) } catch { /* ignore */ }
    chatCargado.current = true
  }, [chatKey])
  useEffect(() => {
    if (!chatCargado.current) return
    try { localStorage.setItem(chatKey, JSON.stringify(msgs)) } catch { /* ignore */ }
  }, [msgs, chatKey])
  function resetearChat() {
    setMsgs([])
    try { localStorage.removeItem(chatKey) } catch { /* ignore */ }
  }

  // inactiva = archivada a mano. El calendario y la lista principal la excluyen (va al archivo).
  const inactiva = (it: Item) => it.activa === 'FALSE'
  const visibles = items.filter(it =>
    (filtroCanal === 'todos' || it.canal === filtroCanal) &&
    (filtrosEstado.length === 0 || filtrosEstado.includes(it.estado)) &&
    (!soloFav || it.favorita === 'TRUE')
  )
  const activos = visibles.filter(it => !inactiva(it))
  const archivados = items.filter(it => (filtroCanal === 'todos' || it.canal === filtroCanal) && inactiva(it))

  async function patch(id: string, cambios: Record<string, string>, accion = 'patch') {
    setBusy(`${id}:${accion}`)
    try {
      const r = await fetch(`/api/mailing/calendario/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cambios) })
      const d = await r.json()
      if (!r.ok) { alert(d.error || 'Error'); return }
      setItems(prev => prev.map(x => x.id === id ? d.item : x))
    } finally { setBusy('') }
  }
  async function eliminar(id: string) {
    if (!confirm('¿Eliminar este ítem del calendario?')) return
    setBusy(`${id}:del`)
    try {
      const r = await fetch(`/api/mailing/calendario/${id}`, { method: 'DELETE' })
      if (r.ok) setItems(prev => prev.filter(x => x.id !== id))
      else alert((await r.json()).error || 'Error')
    } finally { setBusy('') }
  }
  async function generar(id: string) {
    setBusy(`${id}:gen`)
    try {
      const r = await fetch(`/api/mailing/calendario/${id}/generar`, { method: 'POST' })
      const d = await r.json()
      if (!r.ok) { alert(d.error || 'Error al generar'); return }
      setItems(prev => prev.map(x => x.id === id ? d.item : x))
      if (d.avisos?.length) alert('Generado con avisos:\n' + d.avisos.join('\n'))
      setPreview(d.item)
    } finally { setBusy('') }
  }
  async function publicar(id: string) {
    if (!confirm('¿Publicar ahora en la red? Esta acción es pública.')) return
    setBusy(`${id}:pub`)
    try {
      const r = await fetch(`/api/mailing/calendario/${id}/publicar`, { method: 'POST' })
      const d = await r.json()
      if (!r.ok) { alert(d.error || 'Error al publicar'); if (d.error) setItems(prev => prev.map(x => x.id === id ? { ...x, estado_publicacion: 'error', error_publicacion: d.error } : x)); return }
      setItems(prev => prev.map(x => x.id === id ? d.item : x))
      alert('¡Publicado!' + (d.post?.url ? `\n${d.post.url}` : ''))
    } finally { setBusy('') }
  }
  async function enviar(texto: string) {
    const t = texto.trim()
    if ((!t && adjuntos.length === 0) || pensando) return
    const adj = adjuntos
    const textoBase = t || '(imagen adjunta)'
    const textoMostrado = adj.length ? `${textoBase}\n\n📎 ${adj.length} imagen(es) adjunta(s)` : textoBase
    const nuevos = [...msgs, { rol: 'usuario' as const, texto: textoMostrado }]
    setMsgs(nuevos); setInput(''); setAdjuntos([]); setPensando(true)
    try {
      const r = await fetch('/api/mailing/agente', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ historial: nuevos, adjuntos: adj }) })
      const d = await r.json()
      if (!r.ok) { setMsgs(m => [...m, { rol: 'agente', texto: `⚠️ ${d.error || 'Error'}` }]); return }
      setMsgs(m => [...m, { rol: 'agente', texto: d.mensaje || '(sin respuesta)' }])
      if (d.cambios) await cargar()
    } catch { setMsgs(m => [...m, { rol: 'agente', texto: '⚠️ Error de conexión' }]) }
    finally { setPensando(false) }
  }
  async function onPickFiles(files: FileList | null) {
    if (!files?.length) return
    const nuevas: string[] = []
    for (const f of Array.from(files).slice(0, 4)) {
      if (!f.type.startsWith('image/')) continue
      try { nuevas.push(await fileToDataUrl(f)) } catch { /* ignore */ }
    }
    setAdjuntos(prev => [...prev, ...nuevas].slice(0, 4))
    if (fileRef.current) fileRef.current.value = ''
  }

  // Botonera de acciones de un ítem (reusada en lista y en el modal de día).
  function Acciones({ it }: { it: Item }) {
    const social = it.canal === 'instagram' || it.canal === 'facebook'
    const enCurso = busy.startsWith(it.id + ':')
    return (
      <div className="flex flex-wrap gap-1 justify-end">
        <button disabled={enCurso} onClick={() => patch(it.id, { favorita: it.favorita === 'TRUE' ? 'FALSE' : 'TRUE' }, 'fav')}
          title={it.favorita === 'TRUE' ? 'Quitar de favoritas' : 'Marcar como favorita'}
          className={`text-xs px-2 py-1 rounded border ${it.favorita === 'TRUE' ? 'border-amber-300 text-amber-500 bg-amber-50' : 'border-gray-300 text-gray-400 hover:bg-gray-50'}`}>{it.favorita === 'TRUE' ? '★' : '☆'}</button>
        {it.activa !== 'FALSE' && (it.estado === 'propuesta' || it.estado === 'generada') && (
          <button disabled={enCurso} onClick={() => patch(it.id, { estado: 'aprobada' }, 'ap')} className="text-xs px-2 py-1 rounded bg-sky-600 text-white hover:bg-sky-700 disabled:opacity-50">Aprobar</button>
        )}
        {it.activa !== 'FALSE' && (it.estado === 'aprobada' || it.estado === 'generada' || it.estado === 'propuesta') && (
          <button disabled={enCurso} onClick={() => generar(it.id)} className="text-xs px-2 py-1 rounded bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50">
            {busy === `${it.id}:gen` ? '…' : it.cuerpo ? 'Regenerar' : 'Generar'}
          </button>
        )}
        {it.cuerpo && <button onClick={() => setPreview(it)} className="text-xs px-2 py-1 rounded border border-gray-300 hover:bg-gray-50">Ver</button>}
        {social && it.cuerpo && ['aprobada', 'generada', 'programada'].includes(it.estado) && (
          <button disabled={enCurso} onClick={() => publicar(it.id)} className="text-xs px-2 py-1 rounded bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50">
            {busy === `${it.id}:pub` ? '…' : 'Publicar'}
          </button>
        )}
        {it.estado === 'publicada' && it.post_url && (
          <a href={it.post_url} target="_blank" rel="noreferrer" className="text-xs px-2 py-1 rounded border border-emerald-300 text-emerald-700 hover:bg-emerald-50">Ver post ↗</a>
        )}
        {it.activa !== 'FALSE' ? (
          <button disabled={enCurso} onClick={() => patch(it.id, { activa: 'FALSE' }, 'inact')} className="text-xs px-2 py-1 rounded border border-amber-300 text-amber-700 hover:bg-amber-50 disabled:opacity-50">Inactivar</button>
        ) : (
          <button disabled={enCurso} onClick={() => patch(it.id, { activa: 'TRUE' }, 'act')} className="text-xs px-2 py-1 rounded border border-emerald-300 text-emerald-700 hover:bg-emerald-50 disabled:opacity-50">Activar</button>
        )}
        <button onClick={() => setEditItem(it)} className="text-xs px-2 py-1 rounded border border-gray-300 hover:bg-gray-50">Editar</button>
        <button disabled={enCurso} onClick={() => eliminar(it.id)} className="text-xs px-2 py-1 rounded border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-50">✕</button>
      </div>
    )
  }

  // Tabla de ítems (reusada por cada grupo de la Lista).
  function TablaItems({ its }: { its: Item[] }) {
    return (
      <div className="overflow-x-auto bg-white rounded-xl border border-gray-300">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wide">
            <tr>
              <th className="text-left px-3 py-2">Fecha</th>
              <th className="text-left px-3 py-2">Canal</th>
              <th className="text-left px-3 py-2">Tipo</th>
              <th className="text-left px-3 py-2">Campaña</th>
              <th className="text-left px-3 py-2">Estado</th>
              <th className="text-right px-3 py-2">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {its.map(it => {
              const cm = CANAL_MAP[it.canal] || { label: it.canal, icon: '•', cls: 'bg-gray-100 text-gray-600' }
              const em = ESTADO_MAP[it.estado] || { label: it.estado, cls: 'bg-gray-100 text-gray-600' }
              return (
                <Fragment key={it.id}>
                  <tr className="hover:bg-gray-50 align-top">
                    <td className="px-3 py-2 whitespace-nowrap text-gray-700">{it.fecha ? formatDate(it.fecha) : '—'}{it.hora ? ` · ${it.hora}` : ''}</td>
                    <td className="px-3 py-2"><span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${cm.cls}`}><CanalIcon canal={it.canal} className="w-3.5 h-3.5" /> {cm.label}</span></td>
                    <td className="px-3 py-2"><span className="text-xs text-gray-600 whitespace-nowrap">{tipoDe(it)}</span></td>
                    <td className="px-3 py-2 max-w-[280px]">
                      <div className="font-medium text-gray-900">
                        {it.favorita === 'TRUE' && <span className="text-amber-500 mr-1" title="Favorita">★</span>}
                        <span className="text-gray-400 font-normal mr-1">#{it.id}</span>{it.titulo || it.idea || '(sin título)'}
                        {nImgs(it) > 1 && <span className="ml-1 text-[10px] font-semibold text-pink-600">🎠 {nImgs(it)}</span>}
                        {destacada(it) && <span className="ml-1 text-[10px]" title={`Buen rendimiento (${perf[it.post_externo_id] ?? 0} interacciones)`}>🔥</span>}
                      </div>
                      {it.titulo && it.idea && <div className="text-xs text-gray-500 line-clamp-2">{it.idea}</div>}
                      <div className="text-[11px] text-gray-400 mt-0.5">{it.audiencia && `${it.audiencia}`}{it.objetivo && ` · ${OBJETIVO_LABEL[it.objetivo] || it.objetivo}`}</div>
                    </td>
                    <td className="px-3 py-2">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${em.cls}`}>{em.label}</span>
                      {it.estado_publicacion === 'error' && <div className="text-[11px] text-red-500 mt-0.5">error al publicar</div>}
                    </td>
                    <td className="px-3 py-2"><Acciones it={it} /></td>
                  </tr>
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
    )
  }
  // ── Vista calendario: matriz de 6 semanas ────────────────────────────────────
  function buildGrid(): { iso: string; dia: number; inMonth: boolean }[] {
    const primero = new Date(mes.y, mes.m, 1)
    const offset = (primero.getDay() + 6) % 7 // lunes primero
    const celdas: { iso: string; dia: number; inMonth: boolean }[] = []
    for (let i = 0; i < 42; i++) {
      const d = new Date(mes.y, mes.m, 1 - offset + i)
      celdas.push({ iso: isoDe(d), dia: d.getDate(), inMonth: d.getMonth() === mes.m })
    }
    return celdas
  }
  function itemsDe(iso: string): Item[] {
    return activos.filter(it => it.fecha === iso)
  }
  function cambiarMes(delta: number) {
    setMes(p => {
      const d = new Date(p.y, p.m + delta, 1)
      return { y: d.getFullYear(), m: d.getMonth() }
    })
  }
  const tituloMes = new Intl.DateTimeFormat('es-CL', { month: 'long', year: 'numeric' }).format(new Date(mes.y, mes.m, 1))
  const hoy = hoyISO()
  // Destacados por rendimiento: por encima del promedio de interacciones de lo publicado.
  const perfVals = Object.values(perf).filter(v => v > 0)
  const perfAvg = perfVals.length ? perfVals.reduce((a, b) => a + b, 0) / perfVals.length : 0
  function destacada(it: Item): boolean {
    const v = it.post_externo_id ? perf[it.post_externo_id] : 0
    return !!v && v >= Math.max(1, perfAvg)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap rounded-2xl border border-gray-300 bg-white px-5 py-4 shadow-md">
        <div className="flex items-center gap-3">
          <AgenteIcon className="w-11 h-11 shrink-0" />
          <div>
            {onBack && <button onClick={onBack} className="text-xs text-[#2a6db0] hover:underline font-semibold">← Campañas</button>}
            <h2 className="text-lg font-extrabold text-[#143C64] leading-tight">Calendario y Agente de Marketing</h2>
            <p className="text-sm text-gray-500">El agente propone el plan; vos aprobás, generás y publicás. Nada se publica solo.</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setConfigOpen(true)} className="text-sm px-3.5 py-2 rounded-xl border border-gray-300 text-gray-700 hover:bg-gray-50 font-medium">⚙️ Playbook</button>
          <button onClick={() => setNuevoFecha('')} className="text-sm px-3.5 py-2 rounded-xl bg-[#143C64] text-white hover:bg-[#0f2e4d] font-medium shadow-md">+ Campaña</button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Columna principal */}
        <div className="lg:col-span-2 space-y-3">
          {/* Controles: toggle + filtros */}
          <div className="flex gap-2 flex-wrap items-center text-sm">
            <div className="inline-flex rounded-xl border border-gray-300 bg-white overflow-hidden shadow-md">
              <button onClick={() => setVista('calendario')} className={`px-3 py-1.5 font-medium ${vista === 'calendario' ? 'bg-[#143C64] text-white' : 'text-gray-600 hover:bg-gray-50'}`}>📅 Calendario</button>
              <button onClick={() => setVista('lista')} className={`px-3 py-1.5 font-medium ${vista === 'lista' ? 'bg-[#143C64] text-white' : 'text-gray-600 hover:bg-gray-50'}`}>📋 Lista</button>
            </div>
            <div className="inline-flex rounded-xl border border-gray-300 bg-white overflow-hidden shadow-md">
              <button onClick={() => setFiltroCanal('todos')} className={`px-3 py-1.5 font-medium ${filtroCanal === 'todos' ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-50'}`}>Todos</button>
              {CANALES.map(c => (
                <button key={c.key} onClick={() => setFiltroCanal(c.key)} title={c.label}
                  className={`px-2.5 py-1.5 flex items-center gap-1.5 ${filtroCanal === c.key ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-50'}`}>
                  <CanalIcon canal={c.key} className="w-4 h-4" /><span className="hidden sm:inline">{c.label}</span>
                </button>
              ))}
            </div>
            <div className="inline-flex gap-1 flex-wrap items-center">
              {Object.entries(ESTADO_MAP).map(([k, v]) => {
                const on = filtrosEstado.includes(k)
                return (
                  <button key={k} onClick={() => setFiltrosEstado(s => on ? s.filter(x => x !== k) : [...s, k])}
                    className={`px-2.5 py-1 rounded-full text-xs font-medium border ${on ? `${v.cls} border-transparent` : 'bg-white border-gray-300 text-gray-500 hover:bg-gray-50'}`}>
                    {v.label}
                  </button>
                )
              })}
              {filtrosEstado.length > 0 && <button onClick={() => setFiltrosEstado([])} className="text-xs text-gray-400 underline ml-1">limpiar</button>}
            </div>
            <button onClick={() => setSoloFav(v => !v)} title="Mostrar solo favoritas"
              className={`px-3 py-1.5 rounded-xl text-sm font-medium border shadow-md ${soloFav ? 'bg-amber-100 text-amber-700 border-amber-300' : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50'}`}>★ Favoritas</button>
          </div>

          {cargando ? (
            <div className="text-center text-gray-400 py-10">Cargando…</div>
          ) : vista === 'calendario' ? (
            <div className="bg-white rounded-2xl border border-gray-300 p-4 shadow-md">
              {/* Navegación de mes */}
              <div className="flex items-center justify-between mb-4">
                <button onClick={() => cambiarMes(-1)} className="w-9 h-9 rounded-xl border border-gray-300 hover:bg-gray-50 text-gray-600">‹</button>
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-bold text-[#143C64] capitalize">{tituloMes}</h3>
                  <button onClick={() => setMes({ y: new Date().getFullYear(), m: new Date().getMonth() })} className="text-xs px-2.5 py-1 rounded-lg border border-gray-300 text-gray-500 hover:bg-gray-50">Hoy</button>
                </div>
                <button onClick={() => cambiarMes(1)} className="w-9 h-9 rounded-xl border border-gray-300 hover:bg-gray-50 text-gray-600">›</button>
              </div>
              {/* Grilla */}
              <div className="overflow-x-auto">
                <div className="min-w-[680px]">
                  <div className="grid grid-cols-7 gap-1.5 text-center text-[11px] font-bold text-gray-400 uppercase tracking-wide mb-1.5">
                    {DIAS.map(d => <div key={d} className="py-1">{d}</div>)}
                  </div>
                  <div className="grid grid-cols-7 gap-1.5">
                    {buildGrid().map(({ iso, dia, inMonth }) => {
                      const its = itemsDe(iso)
                      const esHoy = iso === hoy
                      return (
                        <button
                          key={iso}
                          onClick={() => setDiaSel(iso)}
                          className={`min-h-[104px] text-left p-1.5 rounded-xl border align-top transition-all ${esHoy ? 'border-brand ring-1 ring-brand/30' : 'border-gray-300'} ${inMonth ? 'bg-white hover:border-gold hover:shadow-md' : 'bg-slate-100'}`}
                        >
                          <div className={`text-xs mb-1 inline-flex items-center justify-center w-6 h-6 rounded-full ${esHoy ? 'bg-[#143C64] text-white font-bold' : inMonth ? 'text-gray-700' : 'text-gray-300'}`}>{dia}</div>
                          <div className="space-y-1">
                            {its.slice(0, 3).map(it => {
                              const cm = CANAL_MAP[it.canal] || { chip: 'bg-gray-100 text-gray-700 border-gray-300' }
                              const dot = ESTADO_MAP[it.estado]?.dot || 'bg-gray-300'
                              const tachado = it.estado === 'descartada'
                              return (
                                <div key={it.id} title={`${CANAL_MAP[it.canal]?.label || it.canal} · ${ESTADO_MAP[it.estado]?.label || it.estado}`}
                                  className={`flex items-center gap-1 px-1.5 py-1 rounded-lg border text-[10px] leading-tight ${cm.chip} ${tachado ? 'opacity-50 line-through' : ''}`}>
                                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dot}`} />
                                  <CanalIcon canal={it.canal} className="w-3.5 h-3.5 shrink-0" />
                                  {it.hora && <span className="font-semibold shrink-0">{it.hora}</span>}
                                  <span className="truncate">{it.titulo || it.idea || '—'}</span>
                                </div>
                              )
                            })}
                            {its.length > 3 && <div className="text-[10px] font-medium text-[#2a6db0] pl-1">+{its.length - 3} más</div>}
                          </div>
                        </button>
                      )
                    })}
                  </div>
                </div>
              </div>
              {/* Leyenda */}
              <div className="flex flex-wrap gap-x-3 gap-y-1.5 mt-4 pt-3 border-t border-gray-300 text-[11px] text-gray-500">
                {CANALES.map(c => <span key={c.key} className="inline-flex items-center gap-1"><CanalIcon canal={c.key} className="w-3.5 h-3.5" />{c.label}</span>)}
                <span className="mx-1 text-gray-300">|</span>
                {Object.entries(ESTADO_MAP).map(([k, v]) => <span key={k} className="inline-flex items-center gap-1"><span className={`w-1.5 h-1.5 rounded-full ${v.dot}`} />{v.label}</span>)}
              </div>
            </div>
          ) : activos.length === 0 && archivados.length === 0 ? (
            <div className="bg-white rounded-2xl border-2 border-dashed border-gray-300 p-8 text-center text-sm text-gray-500">
              No hay campañas todavía. Pedile al agente un plan o creá una manual.
            </div>
          ) : (
            <div className="space-y-4">
              {activos.length === 0
                ? <p className="text-sm text-gray-400 px-1">No hay campañas activas con estos filtros.</p>
                : <TablaItems its={activos} />}
              {archivados.length > 0 && (
                <div>
                  <button onClick={() => setVerInactivas(v => !v)} className="text-sm font-bold text-[#143C64] inline-flex items-center gap-1 px-1 py-1.5">
                    <span className="text-gray-400">{verInactivas ? '▾' : '▸'}</span> 🗄️ Inactivas (archivo) <span className="text-gray-400 font-medium">({archivados.length})</span>
                  </button>
                  {verInactivas && <div className="mt-1"><TablaItems its={archivados} /></div>}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Agente */}
        <div className="lg:col-span-1">
          <div className="bg-white rounded-2xl border border-gray-300 flex flex-col h-[72vh] sticky top-4 shadow-md overflow-hidden">
            <div className="px-4 py-3 border-b border-white/10 flex items-center gap-2.5 bg-brand">
              <AgenteIcon className="w-9 h-9 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="font-bold text-white text-sm">Agente de Marketing</div>
                <div className="text-[11px] text-white/70">Planifica, redacta y propone</div>
              </div>
              {msgs.length > 0 && (
                <button onClick={resetearChat} title="Borrar la conversación y empezar de cero"
                  className="text-[11px] px-2 py-1 rounded-lg bg-white/15 text-white hover:bg-white/25 shrink-0">Resetear</button>
              )}
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-3 bg-slate-50">
              {msgs.length === 0 && (
                <div className="space-y-2">
                  <p className="text-xs text-gray-500 px-1">Probá con:</p>
                  {QUICK.map((q, i) => (
                    <button key={i} onClick={() => enviar(q)} className="block w-full text-left text-xs px-3 py-2.5 rounded-xl border border-gray-300 bg-white hover:border-[#F2B84B] hover:shadow-md text-gray-700 transition-all">{q}</button>
                  ))}
                </div>
              )}
              {msgs.map((m, i) => (
                m.rol === 'usuario'
                  ? <div key={i} className="text-sm whitespace-pre-wrap rounded-2xl rounded-br-sm px-3.5 py-2 bg-[#143C64] text-white ml-8 shadow-md">{m.texto}</div>
                  : <div key={i} className="rounded-2xl rounded-bl-sm px-3.5 py-2.5 bg-white border border-gray-300 mr-3 shadow-md"><Markdown>{m.texto}</Markdown></div>
              ))}
              {pensando && (
                <div className="rounded-2xl rounded-bl-sm px-3.5 py-3 bg-white border border-gray-300 mr-8 shadow-md inline-flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#F2B84B] animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-[#F2B84B] animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-[#F2B84B] animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
              )}
              <div ref={chatEnd} />
            </div>
            <div className="p-3 border-t border-gray-300 bg-white">
              {adjuntos.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-2">
                  {adjuntos.map((src, i) => (
                    <div key={i} className="relative">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={src} alt="" className="w-12 h-12 object-cover rounded-lg border border-gray-300" />
                      <button onClick={() => setAdjuntos(a => a.filter((_, j) => j !== i))}
                        className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-gray-700 text-white text-[10px] leading-none flex items-center justify-center">×</button>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex gap-2 items-end">
                <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={e => onPickFiles(e.target.files)} />
                <button type="button" onClick={() => fileRef.current?.click()} title="Subir imagen de referencia"
                  className="px-2.5 py-2 rounded-xl border border-gray-300 text-gray-600 hover:bg-gray-50 self-end shrink-0">
                  <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5M5 12l7-7 7 7" /></svg>
                </button>
                <textarea value={input} onChange={e => setInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar(input) } }}
                  rows={2} placeholder="Escribile al agente…"
                  className="flex-1 text-sm border border-gray-300 rounded-xl px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-[#143C64]/20 focus:border-[#143C64]" />
                <button disabled={pensando || (!input.trim() && adjuntos.length === 0)} onClick={() => enviar(input)} className="px-4 py-2 rounded-xl bg-[#143C64] text-white text-sm font-medium hover:bg-[#0f2e4d] disabled:opacity-50 self-end shadow-md">Enviar</button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Modal de día */}
      {diaSel && (
        <Modal open onClose={() => setDiaSel(null)} title={`Campañas del ${formatDate(diaSel)}`} size="2xl">
          <div className="space-y-3">
            {itemsDe(diaSel).length === 0 && <p className="text-sm text-gray-500">No hay campañas este día.</p>}
            {itemsDe(diaSel).map(it => {
              const cm = CANAL_MAP[it.canal] || { label: it.canal, icon: '•', cls: 'bg-gray-100 text-gray-600' }
              const em = ESTADO_MAP[it.estado] || { label: it.estado, cls: 'bg-gray-100 text-gray-600' }
              return (
                <div key={it.id} className="border border-gray-300 rounded-xl p-3">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${cm.cls}`}><CanalIcon canal={it.canal} className="w-3.5 h-3.5" /> {cm.label}</span>
                    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${em.cls}`}>{em.label}</span>
                    {it.hora && <span className="text-[11px] font-semibold text-gray-600">🕐 {it.hora}</span>}
                    {it.objetivo && <span className="text-[11px] text-gray-400">{OBJETIVO_LABEL[it.objetivo] || it.objetivo}</span>}
                  </div>
                  <div className="font-medium text-gray-900 text-sm">
                    <span className="text-gray-400 font-normal mr-1">#{it.id}</span>{it.titulo || it.idea || '(sin título)'}
                    {nImgs(it) > 1 && <span className="ml-1 text-[10px] font-semibold text-pink-600">🎠 {nImgs(it)}</span>}
                  </div>
                  {it.titulo && it.idea && <div className="text-xs text-gray-500">{it.idea}</div>}
                  <div className="mt-2"><Acciones it={it} /></div>
                </div>
              )
            })}
            <button onClick={() => { const f = diaSel; setDiaSel(null); setNuevoFecha(f) }} className="w-full text-sm px-3 py-2 rounded-xl border border-dashed border-[#143C64]/30 text-[#143C64] hover:bg-[#143C64]/5 font-medium">+ Nueva campaña este día</button>
          </div>
        </Modal>
      )}

      {nuevoFecha !== null && <ItemForm fechaInicial={nuevoFecha} onClose={() => setNuevoFecha(null)} onSaved={(it) => { setItems(p => [...p, it]); setNuevoFecha(null) }} />}
      {editItem && <ItemForm item={editItem} onClose={() => setEditItem(null)} onSaved={(it) => { setItems(p => p.map(x => x.id === it.id ? it : x)); setEditItem(null) }} />}
      {preview && <PreviewModal item={preview} onClose={() => setPreview(null)} onUpdated={(it) => { setItems(p => p.map(x => x.id === it.id ? it : x)); setPreview(it) }} />}
      {configOpen && <ConfigModal onClose={() => setConfigOpen(false)} />}
    </div>
  )
}

// ── Modal: crear/editar ítem ──────────────────────────────────────────────────
function ItemForm({ item, fechaInicial, onClose, onSaved }: { item?: Item; fechaInicial?: string; onClose: () => void; onSaved: (it: Item) => void }) {
  const [fecha, setFecha] = useState(item?.fecha || fechaInicial || '')
  const [hora, setHora] = useState(item?.hora || '')
  const [canal, setCanal] = useState(item?.canal || 'instagram')
  const [audiencia, setAudiencia] = useState(item?.audiencia || 'tutores')
  const [objetivo, setObjetivo] = useState(item?.objetivo || 'recordacion')
  const [idea, setIdea] = useState(item?.idea || '')
  const [titulo, setTitulo] = useState(item?.titulo || '')
  const [cuerpo, setCuerpo] = useState(item?.cuerpo || '')
  const [imagenUrl, setImagenUrl] = useState(item?.imagen_url || '')
  const [guardando, setGuardando] = useState(false)
  const esCarrusel = !!item && nImgs(item) > 1

  async function guardar() {
    if (!fecha || !canal || !idea.trim()) { alert('Fecha, canal e idea son obligatorios.'); return }
    setGuardando(true)
    try {
      const payload: Record<string, string> = { fecha, hora, canal, audiencia, objetivo, idea, titulo }
      if (item) {
        payload.cuerpo = cuerpo
        // No tocar las imágenes de un carrusel desde acá (se editan con Regenerar).
        // Para imagen simple, al fijar la URL limpiamos imagenes_json para que
        // preview/publicación usen lo que el usuario ve.
        if (!esCarrusel) { payload.imagen_url = imagenUrl; payload.imagenes_json = '' }
      }
      const r = item
        ? await fetch(`/api/mailing/calendario/${item.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
        : await fetch('/api/mailing/calendario', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      const d = await r.json()
      if (!r.ok) { alert(d.error || 'Error'); return }
      onSaved(d.item)
    } finally { setGuardando(false) }
  }

  return (
    <Modal open onClose={onClose} title={item ? 'Editar campaña' : 'Nueva campaña (manual)'} size="2xl">
      <div className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block text-sm"><span className="text-gray-600">Fecha</span>
            <input type="date" value={fecha} onChange={e => setFecha(e.target.value)} className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2" /></label>
          <label className="block text-sm"><span className="text-gray-600">Hora (opcional)</span>
            <input type="time" value={hora} onChange={e => setHora(e.target.value)} className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2" /></label>
          <label className="block text-sm"><span className="text-gray-600">Canal</span>
            <select value={canal} onChange={e => setCanal(e.target.value)} className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2">
              {CANALES.map(c => <option key={c.key} value={c.key}>{c.icon} {c.label}</option>)}
            </select></label>
          <label className="block text-sm"><span className="text-gray-600">Audiencia</span>
            <select value={audiencia} onChange={e => setAudiencia(e.target.value)} className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2">
              {AUDIENCIAS.map(a => <option key={a.key} value={a.key}>{a.label}</option>)}
            </select></label>
          <label className="block text-sm"><span className="text-gray-600">Objetivo</span>
            <select value={objetivo} onChange={e => setObjetivo(e.target.value)} className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2">
              {OBJETIVOS.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
            </select></label>
        </div>
        <label className="block text-sm"><span className="text-gray-600">Título / gancho</span>
          <input value={titulo} onChange={e => setTitulo(e.target.value)} className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2" /></label>
        <label className="block text-sm"><span className="text-gray-600">Idea (qué comunica)</span>
          <textarea value={idea} onChange={e => setIdea(e.target.value)} rows={2} className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2" /></label>
        {item && (
          <>
            <label className="block text-sm"><span className="text-gray-600">Copy / contenido</span>
              <textarea value={cuerpo} onChange={e => setCuerpo(e.target.value)} rows={5} className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 font-mono text-xs" /></label>
            {esCarrusel ? (
              <div className="text-sm rounded-lg bg-pink-50 border border-pink-200 text-pink-800 px-3 py-2">
                🎠 Este post es un <b>carrusel de {nImgs(item)} imágenes</b>. Para cambiar las imágenes usá <b>Regenerar</b> (editar la URL acá no afecta al carrusel).
              </div>
            ) : (
              <label className="block text-sm"><span className="text-gray-600">URL de imagen</span>
                <input value={imagenUrl} onChange={e => setImagenUrl(e.target.value)} className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2" /></label>
            )}
          </>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="px-4 py-2 rounded-lg border border-gray-300 text-sm hover:bg-gray-50">Cancelar</button>
          <button disabled={guardando} onClick={guardar} className="px-4 py-2 rounded-lg bg-brand text-white text-sm hover:bg-brand-dark disabled:opacity-50">{guardando ? 'Guardando…' : 'Guardar'}</button>
        </div>
      </div>
    </Modal>
  )
}

// ── Modal: preview de la pieza ────────────────────────────────────────────────
function PreviewModal({ item, onClose, onUpdated }: { item: Item; onClose: () => void; onUpdated?: (it: Item) => void }) {
  const esEmail = item.canal === 'email'
  // Imágenes del post (carrusel) → desde imagenes_json; si no, la principal.
  let imgs: { url: string; alt?: string }[] = []
  if (!esEmail) {
    try {
      const arr = item.imagenes_json ? JSON.parse(item.imagenes_json) : []
      if (Array.isArray(arr)) imgs = arr.filter((x: { url?: string }) => x && x.url)
    } catch { /* ignore */ }
    if (imgs.length === 0 && item.imagen_url) imgs = [{ url: item.imagen_url }]
  }
  const esCarrusel = imgs.length > 1
  const [editando, setEditando] = useState<number | null>(null)
  async function regenerar(indice: number) {
    const instruccion = window.prompt('¿Qué querés ajustar de esta imagen? (ej. "corregí las manos", "poné el logo arriba a la derecha")')
    if (!instruccion?.trim()) return
    setEditando(indice)
    try {
      const r = await fetch(`/api/mailing/calendario/${item.id}/editar-imagen`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ indice, instruccion }) })
      const d = await r.json()
      if (!r.ok) { alert(d.error || 'Error'); return }
      if (d.avisos?.length) alert('Listo con avisos:\n' + d.avisos.join('\n'))
      onUpdated?.(d.item)
    } catch { alert('Error de red') } finally { setEditando(null) }
  }
  return (
    <Modal open onClose={onClose} title={`Vista previa · ${CANAL_MAP[item.canal]?.label || item.canal}`} size="2xl">
      <div className="space-y-3">
        {esEmail ? (
          <>
            {item.titulo && <div className="text-sm"><span className="text-gray-500">Asunto:</span> <span className="font-medium">{item.titulo}</span></div>}
            <iframe title="preview" srcDoc={item.cuerpo} className="w-full h-[60vh] border border-gray-300 rounded-lg bg-white" />
            <div className="text-xs rounded-lg bg-brand/10 border border-brand/30 text-brand px-3 py-2">
              ✉️ Este correo quedó como <b>borrador en Mail</b> (Campañas → Mail → Campañas). Desde ahí lo editás, elegís la segmentación y lo enviás por lotes con seguimiento.
            </div>
          </>
        ) : (
          <>
            {esCarrusel && (
              <div className="text-xs font-medium text-gray-500 inline-flex items-center gap-1">
                <span className="px-2 py-0.5 rounded-full bg-pink-100 text-pink-700">🎠 Carrusel · {imgs.length} imágenes</span>
                <span className="text-gray-400">desliza para verlas todas</span>
              </div>
            )}
            {imgs.length > 0 ? (
              esCarrusel ? (
                <div className="flex gap-2 overflow-x-auto pb-2 snap-x">
                  {imgs.map((im, i) => (
                    <div key={i} className="relative shrink-0 w-48 snap-start">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={im.url} alt={im.alt || ''} className="w-48 h-48 object-cover rounded-lg border border-gray-300 bg-gray-50" />
                      <span className="absolute top-1 left-1 text-[10px] font-bold bg-black/60 text-white rounded px-1.5 py-0.5">{i + 1}/{imgs.length}</span>
                      <button onClick={() => regenerar(i + 1)} disabled={editando !== null} className="absolute bottom-1 right-1 text-[10px] bg-white/90 border border-gray-300 rounded px-1.5 py-0.5 hover:bg-white disabled:opacity-50">{editando === i + 1 ? '…' : '✏️ Editar'}</button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="relative inline-block">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={imgs[0].url} alt={imgs[0].alt || ''} className="w-full max-h-[40vh] object-contain rounded-lg border border-gray-300 bg-gray-50" />
                  <button onClick={() => regenerar(1)} disabled={editando !== null} className="absolute bottom-2 right-2 text-xs bg-white/90 border border-gray-300 rounded px-2 py-1 hover:bg-white disabled:opacity-50">{editando === 1 ? '…' : '✏️ Editar imagen'}</button>
                </div>
              )
            ) : null}
            <div className="text-sm whitespace-pre-wrap text-gray-800 bg-gray-50 rounded-lg p-3 border border-gray-300">{item.cuerpo || '(sin copy)'}</div>
          </>
        )}
        {item.post_url && <a href={item.post_url} target="_blank" rel="noreferrer" className="text-sm text-emerald-700 hover:underline">Ver publicación ↗</a>}
      </div>
    </Modal>
  )
}

// ── Modal: playbook del agente ────────────────────────────────────────────────
function ConfigModal({ onClose }: { onClose: () => void }) {
  const [instrucciones, setInstrucciones] = useState('')
  const [calibracion, setCalibracion] = useState('')
  const [cargando, setCargando] = useState(true)
  const [guardando, setGuardando] = useState(false)

  useEffect(() => {
    fetch('/api/mailing/agente/config').then(r => r.json()).then(d => {
      setInstrucciones(d.instrucciones || ''); setCalibracion(d.calibracion || '')
    }).finally(() => setCargando(false))
  }, [])

  async function guardar() {
    setGuardando(true)
    try {
      const r = await fetch('/api/mailing/agente/config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ instrucciones, calibracion }) })
      if (!r.ok) { alert((await r.json()).error || 'Error'); return }
      onClose()
    } finally { setGuardando(false) }
  }

  return (
    <Modal open onClose={onClose} title="Playbook del agente de marketing" size="2xl">
      {cargando ? <div className="text-gray-400 text-sm py-6 text-center">Cargando…</div> : (
        <div className="space-y-3">
          <label className="block text-sm"><span className="text-gray-600">Instrucciones y datos vigentes</span>
            <p className="text-xs text-gray-400 mb-1">Lo que el equipo define manda sobre el guion base (frecuencia, fechas clave, promociones reales, líneas que NO usar, etc.). Los precios siempre salen de Configuración → Precios.</p>
            <textarea value={instrucciones} onChange={e => setInstrucciones(e.target.value)} rows={7} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" /></label>
          <label className="block text-sm"><span className="text-gray-600">Línea editorial / estilo (opcional)</span>
            <textarea value={calibracion} onChange={e => setCalibracion(e.target.value)} rows={4} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" /></label>
          <div className="flex justify-end gap-2">
            <button onClick={onClose} className="px-4 py-2 rounded-lg border border-gray-300 text-sm hover:bg-gray-50">Cancelar</button>
            <button disabled={guardando} onClick={guardar} className="px-4 py-2 rounded-lg bg-brand text-white text-sm hover:bg-brand-dark disabled:opacity-50">{guardando ? 'Guardando…' : 'Guardar'}</button>
          </div>
        </div>
      )}
    </Modal>
  )
}
