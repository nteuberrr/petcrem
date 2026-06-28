'use client'
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Card, Button } from '@/components/ui/kit'

/**
 * BANCO de imágenes y videos de campañas — vista de galería profesional.
 * - Cada pieza muestra su CÓDIGO legible (i-N foto · C-X.Y campaña · v-N/ai-N video).
 * - Filtros completos + multiselección con acciones masivas (grupo, WhatsApp,
 *   favorita, descargar, animar, eliminar).
 * - BancoMiniPanel: versión compacta para el panel lateral "abrir en paralelo".
 */

export type ImagenBanco = {
  id: string; url: string; key: string; codigo: string
  descripcion: string; prompt: string; tags: string; alt: string
  grupo: string; subgrupo: string; whatsapp: boolean; favorita: boolean
  aspect: string; origen: string; modelo: string; creado_por: string; fecha_creacion: string
}
export type VideoBanco = {
  id: string; url: string; codigo: string; descripcion: string; prompt: string
  imagen_origen: string; aspect: string; duracion: string; favorita: boolean; fecha_creacion: string
}

const GRUPOS = ['marca', 'mascotas', 'personas', 'productos', 'instalaciones', 'otro'] as const
const GRUPOS_GEN = ['mascotas', 'personas', 'productos', 'otro'] as const
const GRUPO_LABEL: Record<string, string> = {
  marca: 'Marca', mascotas: 'Mascotas', personas: 'Personas', productos: 'Productos',
  instalaciones: 'Instalaciones', otro: 'Otro', sin: 'Sin grupo',
}
/** Orden de los grupos en la galería (acordeón). */
const ORDEN_GRUPOS = ['marca', 'mascotas', 'personas', 'productos', 'instalaciones', 'otro', 'sin'] as const
const ASPECTOS = ['16:9', '4:3', '1:1', '4:5', '3:2', '9:16'] as const
const num = (s: string) => parseInt(s, 10) || 0

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader()
    fr.onload = () => resolve(String(fr.result))
    fr.onerror = reject
    fr.readAsDataURL(file)
  })
}

/** Botón cuadrado uniforme (acciones de la tarjeta), en el estilo de la página. */
function SquareBtn({ title, onClick, active, danger, href, download, children }: {
  title: string; onClick?: () => void; active?: boolean; danger?: boolean
  href?: string; download?: boolean; children: React.ReactNode
}) {
  const cls = `w-8 h-8 shrink-0 rounded-lg border grid place-items-center text-sm transition ${
    danger ? 'border-gray-300 text-gray-500 hover:border-red-300 hover:text-red-600 hover:bg-red-50'
      : active ? 'border-green-400 bg-green-50 text-green-700'
        : 'border-gray-300 text-gray-600 hover:border-brand hover:text-brand hover:bg-brand/5'}`
  if (href) return <a href={href} download={download} title={title} className={cls}>{children}</a>
  return <button type="button" title={title} onClick={onClick} className={cls}>{children}</button>
}

/** Tarjeta de imagen del banco — galería, imagen completa, acciones cuadradas, estrella, código. */
function ImagenCard({ img, selected, onToggleSelect, onGrupo, onWhatsapp, onFavorita, onRename, onCopyUrl, onCopyCodigo, onDelete, onAnimar, onZoom }: {
  img: ImagenBanco
  selected: boolean
  onToggleSelect: (img: ImagenBanco) => void
  onGrupo: (img: ImagenBanco, grupo: string) => void
  onWhatsapp: (img: ImagenBanco, on: boolean) => void
  onFavorita: (img: ImagenBanco, on: boolean) => void
  onRename: (img: ImagenBanco, descripcion: string) => void
  onCopyUrl: (url: string) => void
  onCopyCodigo: (codigo: string) => void
  onDelete: (img: ImagenBanco) => void
  onAnimar: (img: ImagenBanco) => void
  onZoom: (url: string) => void
}) {
  const [editando, setEditando] = useState(false)
  const [texto, setTexto] = useState(img.descripcion || img.alt || '')
  function guardar() {
    setEditando(false)
    const t = texto.trim()
    if (t !== (img.descripcion || '')) onRename(img, t)
  }
  const esGenerada = img.origen !== 'upload'
  const esCampania = (img.codigo || '').startsWith('C-')
  return (
    <div className={`group relative rounded-2xl border bg-white shadow-sm overflow-hidden flex flex-col transition ${selected ? 'border-brand ring-2 ring-brand/40' : 'border-gray-300 hover:shadow-md'}`}>
      <div className="relative bg-slate-100 h-56 grid place-items-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={img.url} alt={img.alt} onClick={() => onZoom(img.url)} title="Clic para ampliar" className="max-h-56 max-w-full object-contain cursor-zoom-in" />
        <label className="absolute top-2 left-2 cursor-pointer" title="Seleccionar">
          <input type="checkbox" checked={selected} onChange={() => onToggleSelect(img)} className="w-5 h-5 rounded accent-brand shadow" />
        </label>
        <button type="button" onClick={() => onFavorita(img, !img.favorita)} title={img.favorita ? 'Quitar de favoritas' : 'Marcar como favorita'}
          className={`absolute top-2 right-2 w-8 h-8 rounded-lg grid place-items-center shadow-sm text-base ${img.favorita ? 'bg-gold text-brand' : 'bg-white/90 text-gray-400 hover:text-gold'}`}>
          {img.favorita ? '★' : '☆'}
        </button>
        <button type="button" onClick={() => onCopyCodigo(img.codigo)} title="Copiar código"
          className={`absolute bottom-2 left-2 text-[11px] font-bold px-2 py-0.5 rounded-md shadow-sm ${esCampania ? 'bg-brand text-white' : 'bg-white/95 text-brand border border-brand/30'}`}>
          {img.codigo || '—'}
        </button>
        <span className={`absolute bottom-2 right-2 text-[9px] font-semibold px-1.5 py-0.5 rounded-full ${esGenerada ? 'bg-violet-100 text-violet-700' : 'bg-sky-100 text-sky-700'}`}>
          {esGenerada ? 'IA' : 'Subida'}
        </span>
      </div>
      <div className="p-3 flex flex-col gap-2 flex-1">
        {editando ? (
          <input autoFocus value={texto} onChange={e => setTexto(e.target.value)} onBlur={guardar}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); guardar() }
              else if (e.key === 'Escape') { setTexto(img.descripcion || img.alt || ''); setEditando(false) }
            }}
            placeholder="Nombre / descripción"
            className="w-full text-sm border border-brand/40 rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-brand" />
        ) : (
          <button type="button" onClick={() => { setTexto(img.descripcion || img.alt || ''); setEditando(true) }}
            title="Clic para editar el nombre" className="text-left text-sm text-gray-800 font-medium line-clamp-1 hover:text-brand">
            {img.descripcion || img.alt || <span className="text-gray-400 italic font-normal">Sin nombre</span>}
          </button>
        )}
        <div className="flex items-center justify-between gap-2 flex-wrap mt-auto">
          <select value={(GRUPOS as readonly string[]).includes(img.grupo) ? img.grupo : ''} onChange={e => onGrupo(img, e.target.value)} title="Grupo"
            className="text-xs border border-gray-300 rounded-lg px-1.5 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-brand max-w-[120px]">
            <option value="">sin grupo</option>
            {GRUPOS.map(g => <option key={g} value={g}>{GRUPO_LABEL[g] || g}</option>)}
          </select>
          <div className="flex items-center gap-1 flex-wrap justify-end">
            <SquareBtn title="Editar nombre" onClick={() => { setTexto(img.descripcion || img.alt || ''); setEditando(true) }}>✏️</SquareBtn>
            <SquareBtn title="El agente de WhatsApp puede enviarla al cliente" active={img.whatsapp} onClick={() => onWhatsapp(img, !img.whatsapp)}>💬</SquareBtn>
            <SquareBtn title="Animar a video (Veo)" onClick={() => onAnimar(img)}>🎬</SquareBtn>
            <SquareBtn title="Descargar" href={`/api/mailing/imagenes/descargar?id=${encodeURIComponent(img.id)}`} download>⬇</SquareBtn>
            <SquareBtn title="Copiar URL" onClick={() => onCopyUrl(img.url)}>⧉</SquareBtn>
            <SquareBtn title="Eliminar" danger onClick={() => onDelete(img)}>🗑</SquareBtn>
          </div>
        </div>
      </div>
    </div>
  )
}

/** Modal para animar 1 o varias imágenes a video (Veo). Procesa la selección en serie. */
function AnimarModal({ imgs, onClose, onDone }: { imgs: ImagenBanco[]; onClose: () => void; onDone: (msg: string) => void }) {
  const [prompt, setPrompt] = useState('')
  const [dur, setDur] = useState('8')
  const [aspect, setAspect] = useState('16:9')
  const [fase, setFase] = useState<'' | 'trabajando'>('')
  const [progreso, setProgreso] = useState<{ i: number; n: number } | null>(null)
  const [error, setError] = useState('')
  const multiple = imgs.length > 1

  async function animarUna(img: ImagenBanco): Promise<void> {
    const r = await fetch('/api/mailing/videos', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accion: 'lanzar', prompt: prompt.trim(), imagen_url: img.url, aspect, resolution: '1080p', duracion: dur }),
    })
    const j = await r.json().catch(() => ({}))
    if (!r.ok || !j.operation) throw new Error(j.error || `Error ${r.status}`)
    let uri = ''
    for (let k = 0; k < 70; k++) {
      await new Promise(res => setTimeout(res, 6000))
      const er = await fetch(`/api/mailing/videos/estado?op=${encodeURIComponent(j.operation)}`, { cache: 'no-store' })
      const ej = await er.json().catch(() => ({}))
      if (!er.ok) throw new Error(ej.error || 'Error consultando el estado')
      if (ej.done) { if (ej.error) throw new Error(ej.error); uri = ej.uri || ''; break }
    }
    if (!uri) throw new Error('el video tardó demasiado')
    const gr = await fetch('/api/mailing/videos', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accion: 'guardar', uri, prompt: prompt.trim(), descripcion: img.descripcion || prompt.trim(), imagen_origen: img.id, aspect, duracion: dur }),
    })
    if (!gr.ok) { const gj = await gr.json().catch(() => ({})); throw new Error(gj.error || 'error al guardar') }
  }

  async function generar() {
    if (!prompt.trim()) { setError('Describe el movimiento del video (ej. "cámara lenta acercándose, brisa suave").'); return }
    setError(''); setFase('trabajando')
    let ok = 0
    const errores: string[] = []
    for (let idx = 0; idx < imgs.length; idx++) {
      setProgreso({ i: idx + 1, n: imgs.length })
      try { await animarUna(imgs[idx]); ok++ }
      catch (e) { errores.push(`${imgs[idx].codigo || imgs[idx].id}: ${e instanceof Error ? e.message : 'error'}`) }
    }
    setFase(''); setProgreso(null)
    if (errores.length) setError(`${ok}/${imgs.length} listos. Errores: ${errores.join(' · ')}`)
    else { onDone(`🎬 ${ok} video${ok === 1 ? '' : 's'} generado${ok === 1 ? '' : 's'} y guardado${ok === 1 ? '' : 's'} en el banco.`) }
  }

  return (
    <Modal open onClose={() => { if (!fase) onClose() }} title={multiple ? `Animar ${imgs.length} imágenes a video (Veo)` : 'Animar a video (Veo)'} size="lg">
      <div className="space-y-3">
        <div className="flex gap-2 overflow-x-auto pb-1">
          {imgs.slice(0, 8).map(img => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={img.id} src={img.url} alt="" className="w-20 h-20 object-cover rounded-lg border border-gray-300 shrink-0" />
          ))}
          {imgs.length > 8 && <div className="w-20 h-20 rounded-lg border border-gray-300 grid place-items-center text-xs text-gray-500 shrink-0">+{imgs.length - 8}</div>}
        </div>
        <div className="text-sm text-gray-600">
          <p>Veo va a <b>animar {multiple ? 'cada imagen' : 'esta imagen'}</b> en un clip corto. Describí el movimiento que querés (se aplica a {multiple ? 'todas' : 'la imagen'}).</p>
          <p className="text-[11px] text-gray-400 mt-1">Calidad alta (1080p). Cada clip tarda 1-3 min y cuesta ~US$2-3{multiple ? ` — ${imgs.length} clips` : ''}. <b>No cierres esta ventana</b> mientras genera.</p>
        </div>
        <textarea value={prompt} onChange={e => setPrompt(e.target.value)} rows={3} disabled={!!fase}
          placeholder="Ej: cámara acercándose lentamente, brisa suave moviendo el pelaje, luz cálida del atardecer."
          className="w-full border-2 border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand disabled:opacity-60" />
        <div className="flex items-center gap-2 flex-wrap">
          <select value={aspect} onChange={e => setAspect(e.target.value)} disabled={!!fase} title="Formato"
            className="border-2 border-gray-300 rounded-lg px-2 py-1.5 text-sm">
            <option value="16:9">16:9 (horizontal)</option>
            <option value="9:16">9:16 (vertical / stories)</option>
          </select>
          <select value={dur} onChange={e => setDur(e.target.value)} disabled={!!fase} title="Duración"
            className="border-2 border-gray-300 rounded-lg px-2 py-1.5 text-sm">
            <option value="4">4 seg</option>
            <option value="6">6 seg</option>
            <option value="8">8 seg</option>
          </select>
          <Button onClick={generar} disabled={!!fase || !prompt.trim()}>
            {fase ? (progreso ? `Generando ${progreso.i}/${progreso.n}…` : 'Generando…') : `🎬 Generar video${multiple ? 's' : ''}`}
          </Button>
        </div>
        {error && <div className="bg-red-50 border border-red-200 text-red-800 rounded-lg px-3 py-2 text-sm">{error}</div>}
        {fase && <p className="text-xs text-gray-500">Veo está renderizando… esto puede tardar 1-3 min por clip. No cierres la ventana.</p>}
      </div>
    </Modal>
  )
}

const TIPOS: { key: string; label: string }[] = [
  { key: 'todos', label: 'Todo tipo' },
  { key: 'i', label: 'Fotos (i-)' },
  { key: 'C', label: 'Campañas (C-)' },
]

export default function BancoView() {
  const [imgs, setImgs] = useState<ImagenBanco[]>([])
  const [videos, setVideos] = useState<VideoBanco[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')

  // generar / subir
  const [prompt, setPrompt] = useState('')
  const [aspect, setAspect] = useState<string>('16:9')
  const [genGrupo, setGenGrupo] = useState<string>('mascotas')
  const [upGrupo, setUpGrupo] = useState<string>('instalaciones')
  const [generando, setGenerando] = useState(false)
  const [subiendo, setSubiendo] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  // filtros
  const [q, setQ] = useState('')
  const [qCodigo, setQCodigo] = useState('')
  const [fOrigen, setFOrigen] = useState('todos')
  const [fTipo, setFTipo] = useState('todos')
  const [fWhatsapp, setFWhatsapp] = useState(false)
  const [fFav, setFFav] = useState(false)
  const [orden, setOrden] = useState('reciente')
  // grupos abiertos en el acordeón (colapsados por defecto)
  const [abiertos, setAbiertos] = useState<Set<string>>(new Set())

  // selección
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [bulkGrupo, setBulkGrupo] = useState('')
  const [bulkBusy, setBulkBusy] = useState(false)

  // modales
  const [animar, setAnimar] = useState<ImagenBanco[] | null>(null)
  const [verImg, setVerImg] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/mailing/imagenes', { cache: 'no-store' })
      const d = await r.json()
      setImgs(Array.isArray(d) ? d : [])
    } catch { setImgs([]) }
    setLoading(false)
  }, [])
  const cargarVideos = useCallback(async () => {
    try { const r = await fetch('/api/mailing/videos', { cache: 'no-store' }); const d = await r.json(); setVideos(Array.isArray(d) ? d : []) } catch { /* ignore */ }
  }, [])
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    cargar(); cargarVideos()
  }, [cargar, cargarVideos])

  const filtradas = useMemo(() => {
    let l = imgs
    const term = q.trim().toLowerCase()
    if (term) l = l.filter(i => `${i.codigo} ${i.descripcion} ${i.alt} ${i.tags} ${i.grupo} ${i.subgrupo}`.toLowerCase().includes(term))
    const cod = qCodigo.trim().toLowerCase()
    if (cod) l = l.filter(i => (i.codigo || '').toLowerCase().includes(cod))
    if (fOrigen !== 'todos') l = l.filter(i => fOrigen === 'ai' ? i.origen !== 'upload' : i.origen === 'upload')
    if (fTipo !== 'todos') l = l.filter(i => (i.codigo || '').startsWith(fTipo + '-'))
    if (fWhatsapp) l = l.filter(i => i.whatsapp)
    if (fFav) l = l.filter(i => i.favorita)
    l = [...l]
    if (orden === 'reciente') l.sort((a, b) => num(b.id) - num(a.id))
    else if (orden === 'antiguo') l.sort((a, b) => num(a.id) - num(b.id))
    else if (orden === 'favoritas') l.sort((a, b) => (b.favorita ? 1 : 0) - (a.favorita ? 1 : 0) || num(b.id) - num(a.id))
    return l
  }, [imgs, q, qCodigo, fOrigen, fTipo, fWhatsapp, fFav, orden])

  // Agrupadas para el acordeón (orden fijo; "sin grupo" al final).
  const grupos = useMemo(() => {
    const by = new Map<string, ImagenBanco[]>()
    for (const i of filtradas) {
      const k = (GRUPOS as readonly string[]).includes(i.grupo) ? i.grupo : 'sin'
      const arr = by.get(k); if (arr) arr.push(i); else by.set(k, [i])
    }
    return ORDEN_GRUPOS.map(k => ({ key: k as string, label: GRUPO_LABEL[k] || k, imgs: by.get(k) || [] })).filter(g => g.imgs.length > 0)
  }, [filtradas])

  // Al buscar (texto o código) se abren todos los grupos con resultados; si no, manda el set manual.
  const buscando = !!q.trim() || !!qCodigo.trim()
  const hayFiltro = buscando || fOrigen !== 'todos' || fTipo !== 'todos' || fWhatsapp || fFav
  const seleccionadas = useMemo(() => imgs.filter(i => sel.has(i.id)), [imgs, sel])

  function limpiarFiltros() { setQ(''); setQCodigo(''); setFOrigen('todos'); setFTipo('todos'); setFWhatsapp(false); setFFav(false) }
  function toggleGrupo(k: string) { setAbiertos(prev => { const n = new Set(prev); if (n.has(k)) n.delete(k); else n.add(k); return n }) }
  function abrirTodos() { setAbiertos(new Set(grupos.map(g => g.key))) }
  function cerrarTodos() { setAbiertos(new Set()) }
  function toggleSel(img: ImagenBanco) { setSel(prev => { const n = new Set(prev); if (n.has(img.id)) n.delete(img.id); else n.add(img.id); return n }) }
  function limpiarSel() { setSel(new Set()); setBulkGrupo('') }
  function toggleTodasVisibles() {
    setSel(prev => {
      const todasSel = filtradas.length > 0 && filtradas.every(i => prev.has(i.id))
      const n = new Set(prev)
      if (todasSel) filtradas.forEach(i => n.delete(i.id))
      else filtradas.forEach(i => n.add(i.id))
      return n
    })
  }

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
      setPrompt(''); setInfo(`Imagen generada${j.codigo ? ` (${j.codigo})` : ''} y guardada en el banco.`)
      await cargar()
    } catch (e) { setError(e instanceof Error ? e.message : 'Error de red') }
    finally { setGenerando(false) }
  }

  async function subir(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || [])
    if (files.length === 0) return
    if (fileRef.current) fileRef.current.value = ''
    setSubiendo(true); setError(''); setInfo('')
    let ok = 0
    const fallidas: string[] = []
    try {
      for (const file of files) {
        try {
          const dataUrl = await fileToDataUrl(file)
          const r = await fetch('/api/mailing/imagenes', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ data_url: dataUrl, descripcion: file.name.replace(/\.[^.]+$/, ''), grupo: upGrupo }),
          })
          if (r.ok) ok++
          else { const j = await r.json().catch(() => ({})); fallidas.push(`${file.name}: ${j.error || `Error ${r.status}`}`) }
        } catch (err) { fallidas.push(`${file.name}: ${err instanceof Error ? err.message : 'error'}`) }
        await cargar()
      }
      if (ok > 0) setInfo(`${ok} imagen${ok === 1 ? '' : 'es'} subida${ok === 1 ? '' : 's'} (grupo: ${upGrupo}).`)
      if (fallidas.length) setError(`No se pudieron subir ${fallidas.length}: ${fallidas.slice(0, 3).join(' · ')}${fallidas.length > 3 ? '…' : ''}`)
    } finally { setSubiendo(false) }
  }

  async function patch(img: ImagenBanco, body: Record<string, unknown>, optimista: (i: ImagenBanco) => ImagenBanco) {
    setImgs(prev => prev.map(i => i.id === img.id ? optimista(i) : i))
    const r = await fetch(`/api/mailing/imagenes?id=${encodeURIComponent(img.id)}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
    if (!r.ok) { setError('No se pudo guardar el cambio'); await cargar() }
  }
  const cambiarGrupo = (img: ImagenBanco, grupo: string) => patch(img, { grupo }, i => ({ ...i, grupo }))
  const cambiarWhatsapp = (img: ImagenBanco, on: boolean) => patch(img, { whatsapp: on }, i => ({ ...i, whatsapp: on }))
  const cambiarFavorita = (img: ImagenBanco, on: boolean) => patch(img, { favorita: on }, i => ({ ...i, favorita: on }))
  const renombrar = (img: ImagenBanco, descripcion: string) => patch(img, { descripcion }, i => ({ ...i, descripcion }))

  async function eliminar(img: ImagenBanco) {
    if (!confirm(`¿Eliminar ${img.codigo || 'esta imagen'} del banco? Si está usada en una campaña ya enviada, esa copia no se ve afectada.`)) return
    const r = await fetch(`/api/mailing/imagenes?id=${encodeURIComponent(img.id)}`, { method: 'DELETE' })
    if (r.ok) { setSel(prev => { const n = new Set(prev); n.delete(img.id); return n }); await cargar() }
    else alert('Error al eliminar')
  }

  async function bulk(action: string, value?: string | boolean, confirmar?: string) {
    if (seleccionadas.length === 0) return
    if (confirmar && !confirm(confirmar)) return
    setBulkBusy(true); setError('')
    try {
      const r = await fetch('/api/mailing/imagenes/bulk', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: seleccionadas.map(i => i.id), action, value }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { setError(j.error || 'Error en la acción masiva'); return }
      setInfo(`${j.afectadas} imagen(es) actualizada(s).${j.errores?.length ? ` ${j.errores.length} con error.` : ''}`)
      if (action === 'delete') limpiarSel()
      await cargar()
    } catch (e) { setError(e instanceof Error ? e.message : 'Error de red') }
    finally { setBulkBusy(false); setBulkGrupo('') }
  }

  async function eliminarVideo(v: VideoBanco) {
    if (!confirm(`¿Eliminar el video ${v.codigo || ''}?`)) return
    const r = await fetch(`/api/mailing/videos?id=${encodeURIComponent(v.id)}`, { method: 'DELETE' })
    if (r.ok) await cargarVideos(); else alert('Error al eliminar el video')
  }
  async function copiar(texto: string, msg: string) {
    try { await navigator.clipboard.writeText(texto); setInfo(msg) } catch { /* ignore */ }
  }

  const todasVisiblesSel = filtradas.length > 0 && filtradas.every(i => sel.has(i.id))

  return (
    <div className="space-y-4">
      {/* Generar / subir */}
      <Card className="p-5 space-y-4">
        <div>
          <h2 className="text-base font-bold text-gray-900">Banco de imágenes</h2>
          <p className="text-sm text-gray-500">Imágenes y videos reutilizables. El agente las recicla y vos te referís a cada una por su <b>código</b> (i-N foto · C-X.Y campaña · v-N/ai-N video).</p>
        </div>
        <div>
          <label className="text-xs font-semibold text-gray-700">Generar una imagen nueva (Nano Banana Pro)</label>
          <textarea value={prompt} onChange={e => setPrompt(e.target.value)} rows={2}
            placeholder="Ej: una mujer acariciando a su perro mayor en un living luminoso, luz natural, momento cálido y sereno."
            className="mt-1 w-full border-2 border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand" />
          <div className="mt-2 flex items-center gap-2 flex-wrap">
            <select value={aspect} onChange={e => setAspect(e.target.value)} title="Relación de aspecto"
              className="border-2 border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand">
              {ASPECTOS.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
            <select value={genGrupo} onChange={e => setGenGrupo(e.target.value)} title="Grupo"
              className="border-2 border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand">
              {GRUPOS_GEN.map(g => <option key={g} value={g}>{GRUPO_LABEL[g] || g}</option>)}
            </select>
            <Button onClick={generar} disabled={generando || !prompt.trim()}>
              {generando ? 'Generando… (puede tardar)' : '✨ Generar imagen'}
            </Button>
          </div>
          <p className="text-[11px] text-gray-400 mt-1">La IA no genera fotos de instalaciones — esas se suben.</p>
        </div>
        <div className="border-t border-gray-200 pt-3">
          <label className="text-xs font-semibold text-gray-700">Subir imágenes propias (ej. fotos reales de las instalaciones)</label>
          <div className="mt-2 flex items-center gap-2 flex-wrap">
            <span className="text-xs text-gray-500">Grupo:</span>
            <select value={upGrupo} onChange={e => setUpGrupo(e.target.value)} title="Grupo de la imagen a subir"
              className="border-2 border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand">
              {GRUPOS.map(g => <option key={g} value={g}>{GRUPO_LABEL[g] || g}</option>)}
            </select>
            <Button variant="secondary" onClick={() => fileRef.current?.click()} disabled={subiendo}>
              {subiendo ? 'Subiendo…' : '📤 Subir imágenes'}
            </Button>
            <input ref={fileRef} type="file" multiple accept="image/png,image/jpeg,image/webp,image/gif" onChange={subir} className="hidden" />
            <span className="text-[11px] text-gray-400">Podés elegir varias a la vez.</span>
          </div>
        </div>
        {error && <div className="bg-red-50 border border-red-200 text-red-800 rounded-lg px-3 py-2 text-sm">{error}</div>}
        {info && <div className="bg-green-50 border border-green-200 text-green-800 rounded-lg px-3 py-2 text-sm">{info}</div>}
      </Card>

      {/* Filtros */}
      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-2">
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar por nombre, tag…"
            className="flex-1 min-w-[160px] border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand" />
          <input value={qCodigo} onChange={e => setQCodigo(e.target.value)} placeholder="Código (C-26, i-5)…" title="Buscar por código"
            className="w-[150px] border border-gray-300 rounded-lg px-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand" />
          <select value={fTipo} onChange={e => setFTipo(e.target.value)} title="Tipo de código" className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm">
            {TIPOS.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
          </select>
          <select value={fOrigen} onChange={e => setFOrigen(e.target.value)} title="Origen" className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm">
            <option value="todos">IA + subidas</option>
            <option value="ai">Generadas (IA)</option>
            <option value="upload">Subidas</option>
          </select>
          <select value={orden} onChange={e => setOrden(e.target.value)} title="Orden" className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm">
            <option value="reciente">Más recientes</option>
            <option value="antiguo">Más antiguas</option>
            <option value="favoritas">Favoritas primero</option>
          </select>
          <button type="button" onClick={() => setFWhatsapp(v => !v)} title="Solo enviables por WhatsApp"
            className={`text-xs rounded-lg px-2.5 py-1.5 border ${fWhatsapp ? 'bg-green-50 border-green-400 text-green-700' : 'border-gray-300 text-gray-600 hover:bg-gray-50'}`}>💬 WhatsApp</button>
          <button type="button" onClick={() => setFFav(v => !v)} title="Solo favoritas"
            className={`text-xs rounded-lg px-2.5 py-1.5 border ${fFav ? 'bg-gold/20 border-gold text-brand' : 'border-gray-300 text-gray-600 hover:bg-gray-50'}`}>★ Favoritas</button>
          {hayFiltro && <button type="button" onClick={limpiarFiltros} className="text-xs text-brand hover:underline">Limpiar filtros</button>}
        </div>
        <div className="flex items-center justify-between mt-2 text-xs text-gray-500 flex-wrap gap-2">
          <span>{filtradas.length} de {imgs.length} imágenes · {grupos.length} grupo{grupos.length === 1 ? '' : 's'}</span>
          <div className="flex items-center gap-3 flex-wrap">
            {!buscando && <>
              <button type="button" onClick={abrirTodos} className="text-brand hover:underline">Abrir todos</button>
              <button type="button" onClick={cerrarTodos} className="text-brand hover:underline">Cerrar todos</button>
            </>}
            <button type="button" onClick={toggleTodasVisibles} className="text-brand hover:underline">{todasVisiblesSel ? 'Deseleccionar' : 'Seleccionar'} visibles</button>
            <a href="/api/mailing/imagenes/descargar" download className="text-brand hover:underline">⬇ Descargar todo (ZIP)</a>
            <button type="button" onClick={() => { cargar(); cargarVideos() }} className="text-brand hover:underline">Actualizar</button>
          </div>
        </div>
      </Card>

      {/* Barra de selección masiva */}
      {sel.size > 0 && (
        <div className="sticky top-2 z-20 bg-brand text-white rounded-2xl shadow-lg px-4 py-2.5 flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold">{sel.size} seleccionada{sel.size === 1 ? '' : 's'}</span>
          <select value={bulkGrupo} onChange={e => { const g = e.target.value; setBulkGrupo(g); if (g) bulk('set_grupo', g === 'sin' ? '' : g) }}
            disabled={bulkBusy} className="text-sm text-gray-800 rounded-lg px-2 py-1 bg-white">
            <option value="">Cambiar grupo…</option>
            {GRUPOS.map(g => <option key={g} value={g}>{GRUPO_LABEL[g] || g}</option>)}
            <option value="sin">Sin grupo</option>
          </select>
          <button type="button" disabled={bulkBusy} onClick={() => bulk('set_favorita', true)} className="text-sm bg-white/15 hover:bg-white/25 rounded-lg px-2.5 py-1">★ Favorita</button>
          <button type="button" disabled={bulkBusy} onClick={() => bulk('set_favorita', false)} className="text-sm bg-white/15 hover:bg-white/25 rounded-lg px-2.5 py-1">☆ Quitar</button>
          <button type="button" disabled={bulkBusy} onClick={() => bulk('set_whatsapp', true)} className="text-sm bg-white/15 hover:bg-white/25 rounded-lg px-2.5 py-1">💬 WhatsApp ✓</button>
          <button type="button" disabled={bulkBusy} onClick={() => bulk('set_whatsapp', false)} className="text-sm bg-white/15 hover:bg-white/25 rounded-lg px-2.5 py-1">💬 ✕</button>
          <a href={`/api/mailing/imagenes/descargar?ids=${seleccionadas.map(i => i.id).join(',')}`} download
            className="text-sm bg-white/15 hover:bg-white/25 rounded-lg px-2.5 py-1">⬇ Descargar</a>
          <button type="button" disabled={bulkBusy} onClick={() => setAnimar(seleccionadas)} className="text-sm bg-white/15 hover:bg-white/25 rounded-lg px-2.5 py-1">🎬 Animar</button>
          <button type="button" disabled={bulkBusy} onClick={() => bulk('delete', undefined, `¿Eliminar ${sel.size} imagen(es) del banco? No se puede deshacer.`)}
            className="text-sm bg-red-500/90 hover:bg-red-500 rounded-lg px-2.5 py-1">🗑 Eliminar</button>
          <button type="button" onClick={limpiarSel} className="text-xs text-white/80 hover:text-white ml-auto">Limpiar selección</button>
        </div>
      )}

      {/* Galería por grupos (acordeón; colapsado por defecto, se abre el que quieras) */}
      {loading ? (
        <Card className="p-8 text-center text-sm text-gray-400">Cargando…</Card>
      ) : filtradas.length === 0 ? (
        <Card className="p-8 text-center text-sm text-gray-400">
          {imgs.length === 0 ? 'Sin imágenes todavía. Generá la primera arriba o subí una propia.' : 'Sin resultados con esos filtros.'}
        </Card>
      ) : (
        <div className="space-y-3">
          {grupos.map(g => {
            const abierto = buscando || abiertos.has(g.key)
            const selEnGrupo = g.imgs.reduce((n, i) => n + (sel.has(i.id) ? 1 : 0), 0)
            return (
              <Card key={g.key} className="overflow-hidden">
                <button type="button" onClick={() => toggleGrupo(g.key)} title={abierto ? 'Colapsar' : 'Expandir'}
                  className="w-full flex items-center justify-between gap-3 px-4 py-3 hover:bg-slate-50 transition">
                  <span className="flex items-center gap-2 font-bold text-brand">
                    <span className={`inline-block transition-transform ${abierto ? 'rotate-90' : ''}`}>▸</span>
                    {g.label}
                    <span className="text-xs font-normal text-gray-400">({g.imgs.length}{selEnGrupo ? ` · ${selEnGrupo} sel.` : ''})</span>
                  </span>
                  <span className="text-xs text-gray-400">{abierto ? 'ocultar' : 'ver'}</span>
                </button>
                {abierto && (
                  <div className="px-4 pb-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    {g.imgs.map(img => (
                      <ImagenCard key={img.id} img={img} selected={sel.has(img.id)} onToggleSelect={toggleSel}
                        onGrupo={cambiarGrupo} onWhatsapp={cambiarWhatsapp} onFavorita={cambiarFavorita} onRename={renombrar}
                        onCopyUrl={u => copiar(u, 'URL copiada.')} onCopyCodigo={c => copiar(c, `Código ${c} copiado.`)}
                        onDelete={eliminar} onAnimar={i => setAnimar([i])} onZoom={setVerImg} />
                    ))}
                  </div>
                )}
              </Card>
            )
          })}
        </div>
      )}

      {/* Banco de videos */}
      {videos.length > 0 && (
        <Card className="p-4 space-y-3">
          <h2 className="text-base font-bold text-gray-900">🎬 Videos <span className="text-xs font-normal text-gray-400">({videos.length})</span></h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {videos.map(v => (
              <div key={v.id} className="rounded-2xl border border-gray-300 overflow-hidden bg-black/5 shadow-sm">
                <div className="relative">
                  <video src={v.url} controls className="w-full max-h-56 bg-black" />
                  <span className="absolute top-2 left-2 text-[11px] font-bold px-2 py-0.5 rounded-md bg-brand text-white shadow">{v.codigo || '—'}</span>
                </div>
                <div className="p-2 flex items-center gap-1.5">
                  <p className="flex-1 text-[11px] text-gray-600 line-clamp-2">{v.descripcion || v.prompt || 'Video'}</p>
                  <SquareBtn title="Descargar" href={v.url} download>⬇</SquareBtn>
                  <SquareBtn title="Copiar URL" onClick={() => copiar(v.url, 'URL copiada.')}>⧉</SquareBtn>
                  <SquareBtn title="Eliminar" danger onClick={() => eliminarVideo(v)}>🗑</SquareBtn>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {animar && <AnimarModal imgs={animar} onClose={() => setAnimar(null)} onDone={msg => { setAnimar(null); setInfo(msg); limpiarSel(); cargar(); cargarVideos() }} />}
      {verImg && (
        <Modal open onClose={() => setVerImg(null)} title="Vista de la imagen" size="2xl">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={verImg} alt="" className="w-full max-h-[75vh] object-contain rounded-lg" />
        </Modal>
      )}
    </div>
  )
}

/**
 * Panel COMPACTO del banco para "abrir en paralelo" mientras se chatea con el agente:
 * buscar y ver el CÓDIGO de cada imagen sin salir del chat. Clic en la tarjeta copia el código.
 */
export function BancoMiniPanel() {
  const [imgs, setImgs] = useState<ImagenBanco[]>([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [fTipo, setFTipo] = useState('todos')
  const [copiado, setCopiado] = useState('')

  const cargar = useCallback(async () => {
    setLoading(true)
    try { const r = await fetch('/api/mailing/imagenes', { cache: 'no-store' }); const d = await r.json(); setImgs(Array.isArray(d) ? d : []) } catch { setImgs([]) }
    setLoading(false)
  }, [])
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    cargar()
  }, [cargar])

  const filtradas = useMemo(() => {
    let l = imgs
    const term = q.trim().toLowerCase()
    if (term) l = l.filter(i => `${i.codigo} ${i.descripcion} ${i.alt} ${i.tags} ${i.grupo}`.toLowerCase().includes(term))
    if (fTipo !== 'todos') l = l.filter(i => (i.codigo || '').startsWith(fTipo + '-'))
    return l
  }, [imgs, q, fTipo])

  async function copiarCodigo(c: string) {
    if (!c) return
    try { await navigator.clipboard.writeText(c); setCopiado(c); setTimeout(() => setCopiado(''), 1200) } catch { /* ignore */ }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b border-gray-200 space-y-2">
        <div className="flex items-center gap-2">
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar (código / nombre)…"
            className="flex-1 border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand" />
          <button type="button" onClick={cargar} title="Actualizar" className="text-xs text-brand hover:underline">↻</button>
        </div>
        <div className="flex items-center gap-1">
          {TIPOS.map(t => (
            <button key={t.key} type="button" onClick={() => setFTipo(t.key)}
              className={`text-xs rounded-lg px-2 py-1 border ${fTipo === t.key ? 'bg-brand text-white border-brand' : 'border-gray-300 text-gray-600 hover:bg-gray-50'}`}>{t.label}</button>
          ))}
        </div>
        <p className="text-[11px] text-gray-400">Clic en una imagen para copiar su código y pegarlo en el chat.</p>
      </div>
      <div className="flex-1 overflow-y-auto p-3">
        {loading ? (
          <p className="text-sm text-gray-400 text-center py-6">Cargando…</p>
        ) : filtradas.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-6">Sin resultados.</p>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {filtradas.map(img => (
              <button key={img.id} type="button" onClick={() => copiarCodigo(img.codigo)} title={`${img.codigo} — clic para copiar`}
                className="text-left rounded-xl border border-gray-300 overflow-hidden hover:ring-2 hover:ring-brand transition bg-white">
                <div className="relative bg-slate-100 h-24 grid place-items-center">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={img.url} alt={img.alt} className="max-h-24 max-w-full object-contain" />
                  <span className={`absolute bottom-1 left-1 text-[10px] font-bold px-1.5 py-0.5 rounded ${(img.codigo || '').startsWith('C-') ? 'bg-brand text-white' : 'bg-white/95 text-brand border border-brand/30'}`}>
                    {copiado === img.codigo ? '¡copiado!' : (img.codigo || '—')}
                  </span>
                </div>
                <div className="px-1.5 py-1 text-[10px] text-gray-600 line-clamp-1">{img.descripcion || img.alt || '—'}</div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
