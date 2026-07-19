'use client'
import { useState, useEffect, useCallback, useRef, Fragment, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
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
/** Lunes de la semana que contiene a la fecha dada (semana Lun→Dom). */
function lunesDe(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const off = (x.getDay() + 6) % 7 // 0 = lunes
  x.setDate(x.getDate() - off)
  return x
}
/** Cantidad de imágenes del post (para el badge de carrusel). */
function nImgs(it: { imagenes_json: string; imagen_url: string }): number {
  try {
    const a = it.imagenes_json ? JSON.parse(it.imagenes_json) : []
    if (Array.isArray(a) && a.length) return a.length
  } catch { /* ignore */ }
  return it.imagen_url ? 1 : 0
}
/** Primera imagen del post (para miniaturas), sea simple o carrusel. */
function thumbDe(it: { imagen_url: string; imagenes_json: string }): string {
  if (it.imagen_url) return it.imagen_url
  try {
    const a = JSON.parse(it.imagenes_json || '[]')
    if (Array.isArray(a) && a[0]?.url) return a[0].url
  } catch { /* ignore */ }
  return ''
}
/** Color de acento (borde izquierdo) según el canal. */
function acentoCanal(canal: string): string {
  if (canal === 'instagram') return 'border-l-pink-400'
  if (canal === 'facebook') return 'border-l-blue-400'
  return 'border-l-brand'
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

// ── Menú "⋯" de acciones secundarias ─────────────────────────────────────────
// Se renderiza en un portal a document.body (posición fija) para que NO lo recorte
// el overflow de la tabla ni del modal donde vive el botón.
function MenuItem({ onClick, danger, children }: { onClick?: () => void; danger?: boolean; children: ReactNode }) {
  return (
    <button onClick={onClick}
      className={`w-full text-left px-3 py-1.5 text-sm flex items-center gap-2 transition-colors ${danger ? 'text-red-600 hover:bg-red-50' : 'text-gray-700 hover:bg-gray-50'}`}>
      {children}
    </button>
  )
}

function MoreMenu({ children }: { children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const close = useCallback(() => setOpen(false), [])

  function toggle(e: React.MouseEvent) {
    e.stopPropagation()
    if (open) { setOpen(false); return }
    const r = btnRef.current?.getBoundingClientRect()
    if (r) {
      const left = Math.max(8, Math.min(r.right - 184, window.innerWidth - 192))
      const top = Math.min(r.bottom + 4, window.innerHeight - 280)
      setPos({ top, left })
    }
    setOpen(true)
  }

  useEffect(() => {
    if (!open) return
    const onDoc = () => close()
    window.addEventListener('click', onDoc)
    window.addEventListener('scroll', onDoc, true)
    window.addEventListener('resize', onDoc)
    return () => {
      window.removeEventListener('click', onDoc)
      window.removeEventListener('scroll', onDoc, true)
      window.removeEventListener('resize', onDoc)
    }
  }, [open, close])

  return (
    <>
      <button ref={btnRef} onClick={toggle} title="Más acciones" aria-label="Más acciones"
        className={`text-xs px-2 py-1 rounded-lg border transition-colors ${open ? 'border-brand text-brand bg-brand/5' : 'border-gray-300 text-gray-600 hover:bg-gray-50'}`}>⋯</button>
      {open && pos && createPortal(
        <div onClick={e => e.stopPropagation()} style={{ top: pos.top, left: pos.left }}
          className="fixed z-[100] w-[11.5rem] bg-white rounded-xl border border-gray-200 shadow-xl py-1 overflow-hidden">
          {children(close)}
        </div>,
        document.body,
      )}
    </>
  )
}

export default function CalendarioContent({ canalInicial }: { canalInicial?: string }) {
  const [items, setItems] = useState<Item[]>([])
  const [cargando, setCargando] = useState(true)
  const [vista, setVista] = useState<'calendario' | 'semana' | 'lista'>('calendario')
  const [filtroCanal, setFiltroCanal] = useState<string>(canalInicial || 'todos')
  const [filtrosEstado, setFiltrosEstado] = useState<string[]>([])
  const [soloFav, setSoloFav] = useState(false)
  const [perf, setPerf] = useState<Record<string, number>>({})
  const [busy, setBusy] = useState<string>('')
  // Vista semana: ancla (lunes de la semana mostrada) · Drag & drop: día resaltado como destino
  const [semanaIni, setSemanaIni] = useState<Date>(() => lunesDe(new Date()))
  const [dragOverIso, setDragOverIso] = useState<string | null>(null)

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
  // Drag & drop: reprogramar un ítem soltándolo en otro día del calendario.
  async function moverItem(id: string, fecha: string) {
    const it = items.find(x => x.id === id)
    if (!it || it.fecha === fecha) return
    await patch(id, { fecha }, 'move')
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
  // "Misma copy, imagen nueva": conserva el texto y regenera SOLO la imagen desde cero.
  async function nuevaImagen(id: string) {
    setBusy(`${id}:img`)
    try {
      const r = await fetch(`/api/mailing/calendario/${id}/nueva-imagen`, { method: 'POST' })
      const d = await r.json()
      if (!r.ok) { alert(d.error || 'Error al regenerar la imagen'); return }
      setItems(prev => prev.map(x => x.id === id ? d.item : x))
      if (d.avisos?.length) alert('Imagen nueva con avisos:\n' + d.avisos.join('\n'))
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
    const activa = it.activa !== 'FALSE'
    const puedeGenerar = activa && ['propuesta', 'generada', 'aprobada'].includes(it.estado)
    return (
      <div className="flex flex-wrap gap-1 justify-end items-center">
        <button disabled={enCurso} onClick={() => patch(it.id, { favorita: it.favorita === 'TRUE' ? 'FALSE' : 'TRUE' }, 'fav')}
          title={it.favorita === 'TRUE' ? 'Quitar de favoritas' : 'Marcar como favorita'}
          className={`text-xs px-2 py-1 rounded-lg border transition-colors ${it.favorita === 'TRUE' ? 'border-gold text-amber-500 bg-gold/10' : 'border-gray-300 text-gray-300 hover:bg-gray-50 hover:text-amber-400'}`}>{it.favorita === 'TRUE' ? '★' : '☆'}</button>
        {/* Paso principal del pipeline (color = etapa). El resto vive en el menú ⋯. */}
        {puedeGenerar && !it.cuerpo && (
          <button disabled={enCurso} onClick={() => generar(it.id)} className="text-xs px-2 py-1 rounded-lg bg-violet-600 text-white font-medium hover:bg-violet-700 disabled:opacity-50">
            {busy === `${it.id}:gen` ? '…' : 'Generar'}
          </button>
        )}
        {activa && it.estado === 'generada' && it.cuerpo && (
          <button disabled={enCurso} onClick={() => patch(it.id, { estado: 'aprobada' }, 'ap')} title="Aprobá la pieza generada para poder programarla o publicarla" className="text-xs px-2 py-1 rounded-lg bg-sky-600 text-white font-medium hover:bg-sky-700 disabled:opacity-50">Aprobar</button>
        )}
        {social && activa && it.estado === 'aprobada' && (
          <button disabled={enCurso} onClick={() => patch(it.id, { estado: 'programada' }, 'prog')} title="Programar: se publica solo en la fecha/hora del ítem" className="text-xs px-2 py-1 rounded-lg bg-teal-600 text-white font-medium hover:bg-teal-700 disabled:opacity-50">Programar</button>
        )}
        {social && it.cuerpo && ['aprobada', 'programada'].includes(it.estado) && (
          <button disabled={enCurso} onClick={() => publicar(it.id)} title="Publicar ahora a mano" className="text-xs px-2 py-1 rounded-lg bg-emerald-600 text-white font-medium hover:bg-emerald-700 disabled:opacity-50">
            {busy === `${it.id}:pub` ? '…' : 'Publicar'}
          </button>
        )}
        {it.cuerpo && <button onClick={() => setPreview(it)} className="text-xs px-2 py-1 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50">Ver</button>}
        <MoreMenu>{(close) => (
          <>
            {puedeGenerar && it.cuerpo && (
              <MenuItem onClick={() => { close(); generar(it.id) }}>🔄 Regenerar contenido</MenuItem>
            )}
            {social && activa && it.cuerpo && puedeGenerar && (
              <MenuItem onClick={() => { close(); nuevaImagen(it.id) }}>🖼️ Nueva imagen</MenuItem>
            )}
            {social && it.estado === 'programada' && (
              <MenuItem onClick={() => { close(); patch(it.id, { estado: 'aprobada' }, 'desprog') }}>⏸️ Desprogramar</MenuItem>
            )}
            {social && nImgs(it) > 0 && (
              <a href={`/api/mailing/calendario/${it.id}/descargar`} download onClick={close}
                className="w-full text-left px-3 py-1.5 text-sm flex items-center gap-2 text-gray-700 hover:bg-gray-50">⬇ Descargar imagen</a>
            )}
            {it.estado === 'publicada' && it.post_url && (
              <a href={it.post_url} target="_blank" rel="noreferrer" onClick={close}
                className="w-full text-left px-3 py-1.5 text-sm flex items-center gap-2 text-gray-700 hover:bg-gray-50">↗ Ver publicación</a>
            )}
            <MenuItem onClick={() => { close(); setEditItem(it) }}>✏️ Editar</MenuItem>
            {activa
              ? <MenuItem onClick={() => { close(); patch(it.id, { activa: 'FALSE' }, 'inact') }}>🗄️ Inactivar</MenuItem>
              : <MenuItem onClick={() => { close(); patch(it.id, { activa: 'TRUE' }, 'act') }}>♻️ Activar</MenuItem>}
            <div className="my-1 border-t border-gray-100" />
            <MenuItem danger onClick={() => { close(); eliminar(it.id) }}>✕ Eliminar</MenuItem>
          </>
        )}</MoreMenu>
      </div>
    )
  }

  // Tabla de ítems (reusada por cada grupo de la Lista).
  function TablaItems({ its }: { its: Item[] }) {
    return (
      <div className="overflow-x-auto bg-white rounded-xl border border-gray-300">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-brand/[0.06] text-brand text-[11px] uppercase tracking-wide">
            <tr className="divide-x divide-brand/10 border-b-2 border-brand/15">
              <th className="text-left px-3 py-2.5 font-semibold">Fecha</th>
              <th className="text-left px-3 py-2.5 font-semibold">Canal</th>
              <th className="text-left px-3 py-2.5 font-semibold">Tipo</th>
              <th className="text-left px-3 py-2.5 font-semibold">Campaña</th>
              <th className="text-left px-3 py-2.5 font-semibold">Estado</th>
              <th className="text-right px-3 py-2.5 font-semibold">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {its.map(it => {
              const cm = CANAL_MAP[it.canal] || { label: it.canal, icon: '•', cls: 'bg-gray-100 text-gray-600' }
              const em = ESTADO_MAP[it.estado] || { label: it.estado, cls: 'bg-gray-100 text-gray-600' }
              return (
                <Fragment key={it.id}>
                  <tr className="divide-x divide-gray-200/70 odd:bg-white even:bg-gray-50/70 hover:bg-brand/5 transition-colors align-top">
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
  // ── Vista semana: 7 días desde el lunes ancla ────────────────────────────────
  const diasSemana = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(semanaIni.getFullYear(), semanaIni.getMonth(), semanaIni.getDate() + i)
    return { iso: isoDe(d), dia: d.getDate(), fecha: d }
  })
  function cambiarSemana(delta: number) {
    setSemanaIni(p => new Date(p.getFullYear(), p.getMonth(), p.getDate() + delta * 7))
  }
  const finSemana = new Date(semanaIni.getFullYear(), semanaIni.getMonth(), semanaIni.getDate() + 6)
  const tituloSemana = `${new Intl.DateTimeFormat('es-CL', { day: 'numeric', month: 'short' }).format(semanaIni)} — ${new Intl.DateTimeFormat('es-CL', { day: 'numeric', month: 'short', year: 'numeric' }).format(finSemana)}`
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
          <AgenteIcon className="w-9 h-9 shrink-0" />
          <div>
            <h2 className="text-base font-bold text-gray-900 leading-tight">Calendario y Agente de Marketing</h2>
            <p className="text-sm text-gray-500">El agente propone el plan; vos aprobás, generás y publicás. Nada se publica solo.</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setConfigOpen(true)} className="text-sm px-3.5 py-2 rounded-xl border border-gray-300 text-gray-700 hover:bg-gray-50 font-medium">⚙️ Playbook</button>
          <button onClick={() => setNuevoFecha('')} className="text-sm px-3.5 py-2 rounded-xl bg-brand text-white hover:bg-brand-dark font-medium shadow-md">+ Campaña</button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Columna principal */}
        <div className="lg:col-span-2 space-y-3">
          {/* Barra de herramientas: vista + filtros, agrupados en una tarjeta */}
          <div className="rounded-2xl border border-gray-300 bg-white shadow-sm px-3 py-2.5 flex gap-2.5 flex-wrap items-center text-sm">
            <div className="inline-flex rounded-xl border border-gray-300 overflow-hidden">
              <button onClick={() => setVista('calendario')} className={`px-3 py-1.5 font-medium transition-colors ${vista === 'calendario' ? 'bg-brand text-white' : 'text-gray-600 hover:bg-gray-50'}`}>📅 Mes</button>
              <button onClick={() => setVista('semana')} className={`px-3 py-1.5 font-medium transition-colors ${vista === 'semana' ? 'bg-brand text-white' : 'text-gray-600 hover:bg-gray-50'}`}>🗓️ Semana</button>
              <button onClick={() => setVista('lista')} className={`px-3 py-1.5 font-medium transition-colors ${vista === 'lista' ? 'bg-brand text-white' : 'text-gray-600 hover:bg-gray-50'}`}>📋 Lista</button>
            </div>
            <div className="h-6 w-px bg-gray-200" />
            <div className="inline-flex rounded-xl border border-gray-300 overflow-hidden">
              <button onClick={() => setFiltroCanal('todos')} className={`px-3 py-1.5 font-medium transition-colors ${filtroCanal === 'todos' ? 'bg-brand text-white' : 'text-gray-600 hover:bg-gray-50'}`}>Todos</button>
              {CANALES.map(c => (
                <button key={c.key} onClick={() => setFiltroCanal(c.key)} title={c.label}
                  className={`px-2.5 py-1.5 flex items-center gap-1.5 transition-colors ${filtroCanal === c.key ? 'bg-brand text-white' : 'text-gray-600 hover:bg-gray-50'}`}>
                  <CanalIcon canal={c.key} className="w-4 h-4" /><span className="hidden sm:inline">{c.label}</span>
                </button>
              ))}
            </div>
            <button onClick={() => setSoloFav(v => !v)} title="Mostrar solo favoritas"
              className={`px-3 py-1.5 rounded-xl text-sm font-medium border transition-colors ${soloFav ? 'bg-gold/20 text-amber-700 border-gold' : 'bg-white border-gray-300 text-gray-500 hover:bg-gray-50'}`}>★ Favoritas</button>
            <div className="h-6 w-px bg-gray-200 hidden sm:block" />
            <div className="inline-flex gap-1 flex-wrap items-center">
              <span className="text-xs text-gray-400 font-medium mr-0.5">Estado:</span>
              {Object.entries(ESTADO_MAP).map(([k, v]) => {
                const on = filtrosEstado.includes(k)
                return (
                  <button key={k} onClick={() => setFiltrosEstado(s => on ? s.filter(x => x !== k) : [...s, k])}
                    className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium border transition-colors ${on ? `${v.cls} border-transparent` : 'bg-white border-gray-300 text-gray-500 hover:bg-gray-50'}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${v.dot}`} />{v.label}
                  </button>
                )
              })}
              {filtrosEstado.length > 0 && <button onClick={() => setFiltrosEstado([])} className="text-xs text-gray-400 hover:text-gray-600 underline ml-0.5">limpiar</button>}
            </div>
          </div>

          {cargando ? (
            <div className="text-center text-gray-400 py-10">Cargando…</div>
          ) : vista === 'calendario' ? (
            <div className="bg-white rounded-2xl border border-gray-300 p-4 shadow-md">
              {/* Navegación de mes */}
              <div className="flex items-center justify-between mb-4">
                <button onClick={() => cambiarMes(-1)} className="w-9 h-9 rounded-xl border border-gray-300 hover:bg-gray-50 text-gray-600">‹</button>
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-bold text-brand capitalize">{tituloMes}</h3>
                  <button onClick={() => setMes({ y: new Date().getFullYear(), m: new Date().getMonth() })} className="text-xs px-2.5 py-1 rounded-lg border border-gray-300 text-gray-500 hover:bg-gray-50">Hoy</button>
                </div>
                <button onClick={() => cambiarMes(1)} className="w-9 h-9 rounded-xl border border-gray-300 hover:bg-gray-50 text-gray-600">›</button>
              </div>
              {/* Grilla */}
              <div className="overflow-x-auto">
                <div className="min-w-[680px]">
                  <div className="grid grid-cols-7 gap-1.5 text-center text-[11px] font-bold text-gray-400 uppercase tracking-wide mb-1.5">
                    {DIAS.map((d, i) => <div key={d} className={`py-1 ${i >= 5 ? 'text-gray-300' : ''}`}>{d}</div>)}
                  </div>
                  <div className="grid grid-cols-7 gap-1.5">
                    {buildGrid().map(({ iso, dia, inMonth }, idx) => {
                      const its = itemsDe(iso)
                      const esHoy = iso === hoy
                      const finde = idx % 7 >= 5
                      return (
                        <button
                          key={iso}
                          onClick={() => setDiaSel(iso)}
                          onDragOver={e => { e.preventDefault(); if (dragOverIso !== iso) setDragOverIso(iso) }}
                          onDragLeave={() => setDragOverIso(o => (o === iso ? null : o))}
                          onDrop={e => { e.preventDefault(); const id = e.dataTransfer.getData('text/plain'); setDragOverIso(null); if (id) moverItem(id, iso) }}
                          className={`group min-h-[112px] text-left p-2 rounded-xl border align-top transition-all ${
                            dragOverIso === iso
                              ? 'border-brand ring-2 ring-brand/40 bg-brand/5'
                              : esHoy
                                ? 'border-brand ring-1 ring-brand/30 bg-white shadow-sm'
                                : inMonth
                                  ? `${finde ? 'bg-slate-50/70' : 'bg-white'} border-gray-200 hover:border-gold hover:shadow-md hover:-translate-y-px`
                                  : 'bg-slate-100/70 border-transparent'
                          }`}
                        >
                          <div className="flex items-center justify-between mb-1">
                            <span className={`text-xs inline-flex items-center justify-center w-6 h-6 rounded-full ${esHoy ? 'bg-brand text-white font-bold' : inMonth ? 'text-gray-700 font-medium' : 'text-gray-300'}`}>{dia}</span>
                            {its.length > 0 && <span className="text-[10px] font-semibold text-gray-400 group-hover:text-brand transition-colors">{its.length}</span>}
                          </div>
                          <div className="space-y-1">
                            {its.slice(0, 3).map(it => {
                              const cm = CANAL_MAP[it.canal] || { chip: 'bg-gray-100 text-gray-700 border-gray-300' }
                              const dot = ESTADO_MAP[it.estado]?.dot || 'bg-gray-300'
                              const tachado = it.estado === 'descartada'
                              return (
                                <div key={it.id} title={`${CANAL_MAP[it.canal]?.label || it.canal} · ${ESTADO_MAP[it.estado]?.label || it.estado} · arrastrá para reprogramar`}
                                  draggable
                                  onDragStart={e => { e.stopPropagation(); e.dataTransfer.setData('text/plain', it.id); e.dataTransfer.effectAllowed = 'move' }}
                                  className={`flex items-center gap-1 px-1.5 py-1 rounded-md border text-[10px] leading-tight cursor-grab active:cursor-grabbing ${cm.chip} ${tachado ? 'opacity-50 line-through' : ''}`}>
                                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dot}`} />
                                  <CanalIcon canal={it.canal} className="w-3 h-3 shrink-0" />
                                  {it.hora && <span className="font-semibold shrink-0">{it.hora}</span>}
                                  <span className="truncate">{it.titulo || it.idea || '—'}</span>
                                </div>
                              )
                            })}
                            {its.length > 3 && <div className="text-[10px] font-medium text-brand-soft pl-0.5">+{its.length - 3} más</div>}
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
          ) : vista === 'semana' ? (
            <div className="bg-white rounded-2xl border border-gray-300 p-4 shadow-md">
              {/* Navegación de semana */}
              <div className="flex items-center justify-between mb-4">
                <button onClick={() => cambiarSemana(-1)} className="w-9 h-9 rounded-xl border border-gray-300 hover:bg-gray-50 text-gray-600">‹</button>
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-bold text-brand capitalize">{tituloSemana}</h3>
                  <button onClick={() => setSemanaIni(lunesDe(new Date()))} className="text-xs px-2.5 py-1 rounded-lg border border-gray-300 text-gray-500 hover:bg-gray-50">Esta semana</button>
                </div>
                <button onClick={() => cambiarSemana(1)} className="w-9 h-9 rounded-xl border border-gray-300 hover:bg-gray-50 text-gray-600">›</button>
              </div>
              <div className="overflow-x-auto">
                <div className="grid grid-cols-7 gap-2 min-w-[820px]">
                  {diasSemana.map(({ iso, dia }, i) => {
                    const its = itemsDe(iso)
                    const esHoy = iso === hoy
                    const finde = i >= 5
                    return (
                      <div key={iso}
                        onDragOver={e => { e.preventDefault(); if (dragOverIso !== iso) setDragOverIso(iso) }}
                        onDragLeave={() => setDragOverIso(o => (o === iso ? null : o))}
                        onDrop={e => { e.preventDefault(); const id = e.dataTransfer.getData('text/plain'); setDragOverIso(null); if (id) moverItem(id, iso) }}
                        className={`rounded-xl border p-2 min-h-[280px] flex flex-col transition-all ${
                          dragOverIso === iso ? 'border-brand ring-2 ring-brand/40 bg-brand/5'
                            : esHoy ? 'border-brand bg-brand/[0.03]'
                              : `${finde ? 'bg-slate-50/70' : 'bg-white'} border-gray-200`
                        }`}>
                        <div className="flex items-center justify-between mb-2 pb-1.5 border-b border-gray-100">
                          <div className="flex items-center gap-1.5">
                            <span className={`text-[11px] font-bold uppercase ${finde ? 'text-gray-300' : 'text-gray-400'}`}>{DIAS[i]}</span>
                            <span className={`text-xs inline-flex items-center justify-center w-6 h-6 rounded-full ${esHoy ? 'bg-brand text-white font-bold' : 'text-gray-700 font-semibold'}`}>{dia}</span>
                          </div>
                          <button onClick={() => setNuevoFecha(iso)} title="Agregar campaña este día" className="text-gray-300 hover:text-brand text-lg leading-none px-1">+</button>
                        </div>
                        <div className="space-y-1.5 flex-1">
                          {its.length === 0 && <div className="text-[11px] text-gray-300 text-center pt-6">—</div>}
                          {its.map(it => {
                            const cm = CANAL_MAP[it.canal] || { chip: 'bg-gray-100 text-gray-700 border-gray-300' }
                            const dot = ESTADO_MAP[it.estado]?.dot || 'bg-gray-300'
                            const tachado = it.estado === 'descartada'
                            return (
                              <button key={it.id} onClick={() => setDiaSel(iso)}
                                draggable
                                onDragStart={e => { e.stopPropagation(); e.dataTransfer.setData('text/plain', it.id); e.dataTransfer.effectAllowed = 'move' }}
                                title={`${CANAL_MAP[it.canal]?.label || it.canal} · ${ESTADO_MAP[it.estado]?.label || it.estado} · arrastrá para reprogramar`}
                                className={`w-full text-left flex items-start gap-1 px-1.5 py-1.5 rounded-lg border text-[11px] leading-tight cursor-grab active:cursor-grabbing hover:shadow-sm transition-shadow ${cm.chip} ${tachado ? 'opacity-50 line-through' : ''}`}>
                                <span className={`w-1.5 h-1.5 rounded-full shrink-0 mt-1 ${dot}`} />
                                <CanalIcon canal={it.canal} className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                                <span className="min-w-0">
                                  {it.hora && <span className="font-semibold mr-1">{it.hora}</span>}
                                  <span className="break-words">{it.titulo || it.idea || '—'}</span>
                                </span>
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    )
                  })}
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
                  <button onClick={() => setVerInactivas(v => !v)} className="text-sm font-bold text-brand inline-flex items-center gap-1 px-1 py-1.5">
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
                    <button key={i} onClick={() => enviar(q)} className="block w-full text-left text-xs px-3 py-2.5 rounded-xl border border-gray-300 bg-white hover:border-gold hover:shadow-md text-gray-700 transition-all">{q}</button>
                  ))}
                </div>
              )}
              {msgs.map((m, i) => (
                m.rol === 'usuario'
                  ? <div key={i} className="text-sm whitespace-pre-wrap rounded-2xl rounded-br-sm px-3.5 py-2 bg-brand text-white ml-8 shadow-md">{m.texto}</div>
                  : <div key={i} className="rounded-2xl rounded-bl-sm px-3.5 py-2.5 bg-white border border-gray-300 mr-3 shadow-md"><Markdown>{m.texto}</Markdown></div>
              ))}
              {pensando && (
                <div className="rounded-2xl rounded-bl-sm px-3.5 py-3 bg-white border border-gray-300 mr-8 shadow-md inline-flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-gold animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-gold animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-gold animate-bounce" style={{ animationDelay: '300ms' }} />
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
                      <button onClick={() => setAdjuntos(a => a.filter((_, j) => j !== i))} aria-label="Quitar adjunto"
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
                  className="flex-1 text-sm border border-gray-300 rounded-xl px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand" />
                <button disabled={pensando || (!input.trim() && adjuntos.length === 0)} onClick={() => enviar(input)} className="px-4 py-2 rounded-xl bg-brand text-white text-sm font-medium hover:bg-brand-dark disabled:opacity-50 self-end shadow-md">Enviar</button>
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
              const thumb = thumbDe(it)
              return (
                <div key={it.id} className={`rounded-xl border border-gray-200 border-l-4 ${acentoCanal(it.canal)} bg-white shadow-sm`}>
                  <div className="p-3">
                    <div className="flex gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1.5">
                          <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${cm.cls}`}><CanalIcon canal={it.canal} className="w-3.5 h-3.5" /> {cm.label}</span>
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${em.cls}`}><span className={`w-1.5 h-1.5 rounded-full ${ESTADO_MAP[it.estado]?.dot || 'bg-gray-300'}`} />{em.label}</span>
                          {it.hora && <span className="text-[11px] font-semibold text-gray-600">🕐 {it.hora}</span>}
                          {it.objetivo && <span className="text-[11px] text-gray-400">· {OBJETIVO_LABEL[it.objetivo] || it.objetivo}</span>}
                        </div>
                        <div className="font-semibold text-gray-900 text-sm leading-snug">
                          {it.favorita === 'TRUE' && <span className="text-amber-500 mr-1" title="Favorita">★</span>}
                          <span className="text-gray-400 font-normal mr-1">#{it.id}</span>{it.titulo || it.idea || '(sin título)'}
                          {nImgs(it) > 1 && <span className="ml-1 text-[10px] font-semibold text-pink-600">🎠 {nImgs(it)}</span>}
                        </div>
                        {it.titulo && it.idea && <div className="text-xs text-gray-500 mt-0.5 line-clamp-2">{it.idea}</div>}
                      </div>
                      {thumb && (
                        <button onClick={() => setPreview(it)} title="Ver la pieza" className="shrink-0">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={thumb} alt="" className="w-16 h-16 rounded-lg object-cover border border-gray-200 bg-gray-50 hover:brightness-95 transition" />
                        </button>
                      )}
                    </div>
                    <div className="mt-3 pt-2.5 border-t border-gray-100"><Acciones it={it} /></div>
                  </div>
                </div>
              )
            })}
            <button onClick={() => { const f = diaSel; setDiaSel(null); setNuevoFecha(f) }} className="w-full text-sm px-3 py-2.5 rounded-xl border border-dashed border-brand/40 text-brand hover:bg-brand/5 font-medium transition-colors">+ Nueva campaña este día</button>
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
            <input type="date" value={fecha} onChange={e => setFecha(e.target.value)} className="mt-1 w-full border border-gray-300 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand" /></label>
          <label className="block text-sm"><span className="text-gray-600">Hora (opcional)</span>
            <input type="time" value={hora} onChange={e => setHora(e.target.value)} className="mt-1 w-full border border-gray-300 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand" /></label>
          <label className="block text-sm"><span className="text-gray-600">Canal</span>
            <select value={canal} onChange={e => setCanal(e.target.value)} className="mt-1 w-full border border-gray-300 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand">
              {CANALES.map(c => <option key={c.key} value={c.key}>{c.icon} {c.label}</option>)}
            </select></label>
          <label className="block text-sm"><span className="text-gray-600">Audiencia</span>
            <select value={audiencia} onChange={e => setAudiencia(e.target.value)} className="mt-1 w-full border border-gray-300 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand">
              {AUDIENCIAS.map(a => <option key={a.key} value={a.key}>{a.label}</option>)}
            </select></label>
          <label className="block text-sm"><span className="text-gray-600">Objetivo</span>
            <select value={objetivo} onChange={e => setObjetivo(e.target.value)} className="mt-1 w-full border border-gray-300 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand">
              {OBJETIVOS.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
            </select></label>
        </div>
        <label className="block text-sm"><span className="text-gray-600">Título / gancho</span>
          <input value={titulo} onChange={e => setTitulo(e.target.value)} className="mt-1 w-full border border-gray-300 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand" /></label>
        <label className="block text-sm"><span className="text-gray-600">Idea (qué comunica)</span>
          <textarea value={idea} onChange={e => setIdea(e.target.value)} rows={2} className="mt-1 w-full border border-gray-300 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand" /></label>
        {item && (
          <>
            <label className="block text-sm"><span className="text-gray-600">Copy / contenido</span>
              <textarea value={cuerpo} onChange={e => setCuerpo(e.target.value)} rows={5} className="mt-1 w-full border border-gray-300 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand font-mono text-xs" /></label>
            {esCarrusel ? (
              <div className="text-sm rounded-lg bg-pink-50 border border-pink-200 text-pink-800 px-3 py-2">
                🎠 Este post es un <b>carrusel de {nImgs(item)} imágenes</b>. Para cambiar las imágenes usá <b>Regenerar</b> (editar la URL acá no afecta al carrusel).
              </div>
            ) : (
              <label className="block text-sm"><span className="text-gray-600">URL de imagen</span>
                <input value={imagenUrl} onChange={e => setImagenUrl(e.target.value)} className="mt-1 w-full border border-gray-300 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand" /></label>
            )}
          </>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="px-4 py-2 rounded-xl border border-gray-300 text-sm hover:bg-gray-50">Cancelar</button>
          <button disabled={guardando} onClick={guardar} className="px-4 py-2 rounded-xl bg-brand text-white text-sm hover:bg-brand-dark disabled:opacity-50">{guardando ? 'Guardando…' : 'Guardar'}</button>
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
  // Lightbox: índice de la imagen abierta en grande (null = cerrado).
  const [lightbox, setLightbox] = useState<number | null>(null)
  // Descarga mismo-origen (el atributo download se ignora cross-origin en R2).
  const dl = (url: string) => `/api/mailing/imagenes/descargar?url=${encodeURIComponent(url)}`
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
              ✉️ Este correo quedó como <b>borrador en Mailing</b> (Marketing → Mailing → Campañas). Desde ahí lo editás, elegís la segmentación y lo enviás por lotes con seguimiento.
            </div>
          </>
        ) : (
          <>
            {esCarrusel && (
              <div className="text-xs font-medium text-gray-500 inline-flex items-center gap-1">
                <span className="px-2 py-0.5 rounded-full bg-pink-100 text-pink-700">🎠 Carrusel · {imgs.length} imágenes</span>
                <span className="text-gray-400">tocá una para ampliarla y descargarla</span>
              </div>
            )}
            {imgs.length > 0 ? (
              esCarrusel ? (
                <div className="flex gap-2 overflow-x-auto pb-2 snap-x">
                  {imgs.map((im, i) => (
                    <div key={i} className="relative shrink-0 w-48 snap-start">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={im.url} alt={im.alt || ''} onClick={() => setLightbox(i)} title="Ampliar" className="w-48 h-48 object-cover rounded-lg border border-gray-300 bg-gray-50 cursor-zoom-in" />
                      <span className="absolute top-1 left-1 text-[10px] font-bold bg-black/60 text-white rounded px-1.5 py-0.5">{i + 1}/{imgs.length}</span>
                      <div className="absolute bottom-1 right-1 flex items-center gap-1">
                        <a href={dl(im.url)} download title="Descargar" className="text-[10px] bg-white/90 border border-gray-300 rounded px-1.5 py-0.5 hover:bg-white">⬇</a>
                        <button onClick={() => regenerar(i + 1)} disabled={editando !== null} className="text-[10px] bg-white/90 border border-gray-300 rounded px-1.5 py-0.5 hover:bg-white disabled:opacity-50">{editando === i + 1 ? '…' : '✏️ Editar'}</button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="relative inline-block">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={imgs[0].url} alt={imgs[0].alt || ''} onClick={() => setLightbox(0)} title="Ampliar" className="w-full max-h-[40vh] object-contain rounded-lg border border-gray-300 bg-gray-50 cursor-zoom-in" />
                  <div className="absolute bottom-2 right-2 flex items-center gap-1.5">
                    <a href={dl(imgs[0].url)} download title="Descargar" className="text-xs bg-white/90 border border-gray-300 rounded px-2 py-1 hover:bg-white">⬇</a>
                    <button onClick={() => regenerar(1)} disabled={editando !== null} className="text-xs bg-white/90 border border-gray-300 rounded px-2 py-1 hover:bg-white disabled:opacity-50">{editando === 1 ? '…' : '✏️ Editar imagen'}</button>
                  </div>
                </div>
              )
            ) : null}
            <div className="text-sm whitespace-pre-wrap text-gray-800 bg-gray-50 rounded-lg p-3 border border-gray-300">{item.cuerpo || '(sin copy)'}</div>
          </>
        )}
        {item.post_url && <a href={item.post_url} target="_blank" rel="noreferrer" className="text-sm text-emerald-700 hover:underline">Ver publicación ↗</a>}
      </div>

      {/* Lightbox: imagen en grande + descargar (clic en el fondo o ✕ para cerrar). */}
      {lightbox !== null && imgs[lightbox] && (
        <div className="fixed inset-0 z-[80] bg-black/80 flex flex-col items-center justify-center p-4" onClick={() => setLightbox(null)}>
          <div className="absolute top-3 right-3 flex items-center gap-2" onClick={e => e.stopPropagation()}>
            <a href={dl(imgs[lightbox].url)} download className="text-sm font-medium bg-white/95 hover:bg-white text-gray-800 rounded-lg px-3 py-1.5">⬇ Descargar</a>
            <button onClick={() => setLightbox(null)} title="Cerrar" aria-label="Cerrar" className="text-white/90 hover:text-white text-3xl leading-none px-2">×</button>
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={imgs[lightbox].url} alt={imgs[lightbox].alt || ''} onClick={e => e.stopPropagation()} className="max-h-[85vh] max-w-[92vw] object-contain rounded-lg shadow-2xl" />
          {esCarrusel && (
            <div className="mt-3 flex items-center gap-4" onClick={e => e.stopPropagation()}>
              <button onClick={() => setLightbox(l => l === null ? l : (l - 1 + imgs.length) % imgs.length)} className="text-white/90 hover:text-white text-sm bg-white/10 hover:bg-white/20 rounded-lg px-3 py-1.5">← Anterior</button>
              <span className="text-white/80 text-sm tabular-nums">{lightbox + 1} / {imgs.length}</span>
              <button onClick={() => setLightbox(l => l === null ? l : (l + 1) % imgs.length)} className="text-white/90 hover:text-white text-sm bg-white/10 hover:bg-white/20 rounded-lg px-3 py-1.5">Siguiente →</button>
            </div>
          )}
        </div>
      )}
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
            <textarea value={instrucciones} onChange={e => setInstrucciones(e.target.value)} rows={7} className="w-full border border-gray-300 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand text-sm" /></label>
          <label className="block text-sm"><span className="text-gray-600">Línea editorial / estilo (opcional)</span>
            <textarea value={calibracion} onChange={e => setCalibracion(e.target.value)} rows={4} className="w-full border border-gray-300 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand text-sm" /></label>
          <div className="flex justify-end gap-2">
            <button onClick={onClose} className="px-4 py-2 rounded-xl border border-gray-300 text-sm hover:bg-gray-50">Cancelar</button>
            <button disabled={guardando} onClick={guardar} className="px-4 py-2 rounded-xl bg-brand text-white text-sm hover:bg-brand-dark disabled:opacity-50">{guardando ? 'Guardando…' : 'Guardar'}</button>
          </div>
        </div>
      )}
    </Modal>
  )
}
