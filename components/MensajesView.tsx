'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { formatDateTime } from '@/lib/dates'

type Canal = 'whatsapp' | 'instagram' | 'facebook'
type Contacto = { id: number; nombre: string | null; telefono: string | null; audiencia: string; cliente_id: string | null }
type EstadoConv = 'activo' | 'cliente' | 'veterinario' | 'archivado' | 'cerrado'
type Conversacion = {
  id: number; contacto_id: number; canal: Canal; audiencia: string
  estado: string; etiquetas: string[]; fuente: string
  ultimo_mensaje_at: string | null; contacto: Contacto | null
  no_leido?: boolean
}
// Valores legacy → nuevos.
const normEstado = (e: string): EstadoConv =>
  e === 'abierta' ? 'activo' : e === 'cerrada' ? 'cerrado' : (['activo', 'cliente', 'veterinario', 'archivado', 'cerrado'].includes(e) ? e as EstadoConv : 'activo')
const CATEGORIAS: { v: EstadoConv; label: string }[] = [
  { v: 'activo', label: 'Activos' },
  { v: 'cliente', label: 'Clientes' },
  { v: 'veterinario', label: 'Veterinarios' },
  { v: 'archivado', label: 'Archivados' },
  { v: 'cerrado', label: 'Cerrados' },
]
const CAT_LABEL: Record<string, string> = Object.fromEntries(CATEGORIAS.map(c => [c.v, c.label]))
type Mensaje = {
  id: number; direccion: 'entrante' | 'saliente'; cuerpo: string | null
  tipo: string; estado: string | null; enviado_por: string | null; ts: string
  media_url: string | null
}

const ETIQUETAS = ['consulta', 'cotizacion', 'agendado', 'seguimiento', 'urgente', 'convenio']
const CANAL_LABEL: Record<Canal, string> = { whatsapp: 'WhatsApp', instagram: 'Instagram', facebook: 'Facebook' }
const CANAL_CLS: Record<Canal, string> = {
  whatsapp: 'bg-green-100 text-green-800', instagram: 'bg-pink-100 text-pink-800', facebook: 'bg-blue-100 text-blue-800',
}

function fecha(iso: string | null): string {
  // Los ts de mensajes/conversaciones se guardan en UTC (ISO con Z). Hay que
  // MOSTRARLOS en hora de Chile, si no se ve corrido (ej. 18:50 UTC = 14:50 CL).
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return formatDateTime(iso) // fallback (no-ISO/serial)
  const p = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Santiago',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d)
  const g = (t: string) => p.find(x => x.type === t)?.value || ''
  return `${g('day')}-${g('month')}-${g('year')} ${g('hour')}:${g('minute')}`
}

export default function MensajesView() {
  const [convs, setConvs] = useState<Conversacion[]>([])
  const [estado, setEstado] = useState<EstadoConv | ''>('activo')
  const [buscar, setBuscar] = useState('')
  const [sel, setSel] = useState<number | null>(null)
  const [conv, setConv] = useState<Conversacion | null>(null)
  const [msgs, setMsgs] = useState<Mensaje[]>([])
  const [texto, setTexto] = useState('')
  const [cargando, setCargando] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [subiendo, setSubiendo] = useState(false)
  const [error, setError] = useState('')
  const [noLeidosCat, setNoLeidosCat] = useState<Record<string, number>>({})
  const fileRef = useRef<HTMLInputElement>(null)
  // >0 mientras hay una mutación del usuario en curso: suprime el polling para que
  // un refresco viejo no sobrescriba el estado recién cambiado (ej. activar el agente).
  const pausaRef = useRef(0)

  const fetchConvs = useCallback(async (silent = false) => {
    if (!silent) { setCargando(true); setError('') }
    try {
      const p = new URLSearchParams()
      if (estado) p.set('estado', estado)
      if (buscar) p.set('buscar', buscar)
      const r = await fetch(`/api/mensajes?${p}`, { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok) { if (!silent) { setError(j.error || 'Error al cargar'); setConvs([]) } }
      else setConvs(Array.isArray(j) ? j : [])
    } catch { if (!silent) setError('Error de red') }
    if (!silent) setCargando(false)
  }, [estado, buscar])

  useEffect(() => { fetchConvs() }, [fetchConvs])

  // No leídos por categoría → "(N)" en cada tab (para saber en qué grupo está el chat sin leer).
  const fetchNoLeidos = useCallback(async () => {
    try {
      const r = await fetch('/api/mensajes/no-leidos-count', { cache: 'no-store' })
      if (r.ok) { const j = await r.json(); setNoLeidosCat(j.porCategoria || {}) }
    } catch { /* silencioso */ }
  }, [])
  useEffect(() => { fetchNoLeidos() }, [fetchNoLeidos])

  const abrir = useCallback(async (id: number) => {
    pausaRef.current++
    try {
      setSel(id); setConv(null); setMsgs([])
      // Al abrir, la marcamos leída localmente (el GET la marca en el server).
      setConvs(prev => prev.map(c => (c.id === id ? { ...c, no_leido: false } : c)))
      const r = await fetch(`/api/mensajes/${id}`, { cache: 'no-store' })
      const j = await r.json()
      if (r.ok) { setConv(j.conversacion); setMsgs(j.mensajes || []) }
    } finally { pausaRef.current-- }
  }, [])

  // Refresco SILENCIOSO de la conversación abierta (no resetea ni parpadea).
  // Solo reemplaza los mensajes si cambió el último o la cantidad → evita re-render inútil.
  // Se salta si hay una mutación del usuario en curso (evita pisar un cambio recién hecho).
  const refrescarAbierta = useCallback(async () => {
    if (sel == null || pausaRef.current > 0) return
    try {
      const r = await fetch(`/api/mensajes/${sel}`, { cache: 'no-store' })
      if (!r.ok || pausaRef.current > 0) return
      const j = await r.json()
      if (pausaRef.current > 0) return
      const nuevos: Mensaje[] = j.mensajes || []
      setMsgs(prev => {
        const a = prev[prev.length - 1]
        const b = nuevos[nuevos.length - 1]
        if (prev.length === nuevos.length && a?.id === b?.id) return prev
        return nuevos
      })
      if (j.conversacion) setConv(j.conversacion)
    } catch { /* silencioso */ }
  }, [sel])

  // Polling en vivo: refresca la lista y la conversación abierta cada 5s.
  useEffect(() => {
    const t = setInterval(() => {
      fetchConvs(true)
      refrescarAbierta()
      fetchNoLeidos()
    }, 5000)
    return () => clearInterval(t)
  }, [fetchConvs, refrescarAbierta, fetchNoLeidos])

  // Auto-scroll al final cuando llegan/envían mensajes nuevos (no al releer historial).
  const bottomRef = useRef<HTMLDivElement>(null)
  const prevLenRef = useRef(0)
  useEffect(() => {
    if (msgs.length > prevLenRef.current) bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    prevLenRef.current = msgs.length
  }, [msgs])

  async function enviar() {
    if (!sel || !texto.trim()) return
    setEnviando(true); pausaRef.current++
    try {
      const r = await fetch(`/api/mensajes/${sel}/mensaje`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cuerpo: texto }),
      })
      const j = await r.json().catch(() => ({}))
      if (r.ok) {
        setTexto(''); await abrir(sel)
        if (j.plantilla_disponible) {
          // Ventana de 24h cerrada: ofrecer la plantilla aprobada de reapertura.
          if (confirm('La ventana de 24h está cerrada, así que ese texto no se pudo entregar.\n\n¿Enviar la plantilla de reapertura? ("Hola…, te escribimos de Crematorio Alma Animal para retomar tu conversación…")\nTiene un costo pequeño por mensaje; si la persona responde, la conversación se reabre y puedes escribir libre.')) {
            const r2 = await fetch(`/api/mensajes/${sel}/mensaje`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ plantilla: true }),
            })
            const j2 = await r2.json().catch(() => ({}))
            if (r2.ok) await abrir(sel)
            else alert(j2.error || 'No se pudo enviar la plantilla')
          }
        } else if (j.aviso) alert(j.aviso)
      }
      else alert(j.error || 'No se pudo registrar el mensaje')
    } finally { pausaRef.current--; setEnviando(false) }
  }

  async function enviarArchivo(file: File) {
    if (!sel || !file) return
    setSubiendo(true); pausaRef.current++
    try {
      const fd = new FormData()
      fd.append('file', file)
      if (texto.trim()) fd.append('caption', texto.trim())
      const r = await fetch(`/api/mensajes/${sel}/media`, { method: 'POST', body: fd })
      const j = await r.json().catch(() => ({}))
      if (r.ok) { setTexto(''); await abrir(sel); if (j.aviso) alert(j.aviso) }
      else alert(j.error || 'No se pudo enviar el archivo')
    } finally { pausaRef.current--; setSubiendo(false) }
  }

  async function patch(body: Record<string, unknown>) {
    if (!sel) return
    pausaRef.current++
    try {
      await fetch(`/api/mensajes/${sel}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      await abrir(sel); await fetchConvs()
    } finally { pausaRef.current-- }
  }

  // Activar/pausar el agente. Al ACTIVAR limpia 'pausado' Y 'requiere-humano'
  // (la conversación vuelve a manos del agente). Al pausar, agrega 'pausado'.
  function setAgentePausado(pausar: boolean) {
    if (!conv) return
    const set = new Set(conv.etiquetas)
    if (pausar) set.add('pausado')
    else { set.delete('pausado'); set.delete('requiere-humano') }
    patch({ etiquetas: Array.from(set) })
  }

  async function eliminar() {
    if (!sel) return
    if (!confirm('¿Eliminar esta conversación y todos sus mensajes? Esta acción no se puede deshacer.')) return
    pausaRef.current++
    try {
      const r = await fetch(`/api/mensajes/${sel}`, { method: 'DELETE' })
      if (!r.ok) { const j = await r.json().catch(() => ({})); alert(j.error || 'No se pudo eliminar'); return }
      setSel(null); setConv(null); setMsgs([])
      await fetchConvs()
    } finally { pausaRef.current-- }
  }

  function toggleEtiqueta(e: string) {
    if (!conv) return
    const set = new Set(conv.etiquetas)
    if (set.has(e)) set.delete(e); else set.add(e)
    patch({ etiquetas: Array.from(set) })
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-[360px_1fr] gap-4 h-[calc(100vh-180px)]">
      {/* Lista — en móvil se oculta cuando hay una conversación abierta */}
      <div className={`bg-white rounded-xl border border-gray-300 shadow-md flex-col overflow-hidden ${sel !== null ? 'hidden md:flex' : 'flex'}`}>
        <div className="p-3 border-b border-gray-300 space-y-2">
          <input value={buscar} onChange={e => setBuscar(e.target.value)} placeholder="Buscar por nombre, teléfono o texto del chat…"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand" />
          <div className="flex flex-wrap gap-1 text-xs">
            {([...CATEGORIAS.map(c => c.v), ''] as const).map(s => {
              // (N) de no leídos por categoría → saber en qué grupo está el chat sin leer.
              const n = s === '' ? Object.values(noLeidosCat).reduce((a, b) => a + b, 0) : (noLeidosCat[s] || 0)
              return (
              <button key={s || 'todas'} onClick={() => setEstado(s)}
                className={`px-2.5 py-1 rounded-md font-medium ${estado === s ? 'bg-brand text-white' : 'bg-gray-100 text-gray-600'}`}>
                {s === '' ? 'Todas' : CAT_LABEL[s]}{n > 0 ? <span className={`ml-1 font-bold ${estado === s ? 'text-white' : 'text-brand'}`}>({n})</span> : ''}
              </button>
              )
            })}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto divide-y divide-gray-50">
          {cargando ? <p className="p-4 text-sm text-gray-400">Cargando…</p>
            : error ? <p className="p-4 text-sm text-red-600">{error}</p>
            : convs.length === 0 ? <p className="p-4 text-sm text-gray-400">Sin conversaciones</p>
            : convs.map(c => {
              const noLeido = !!c.no_leido && sel !== c.id
              return (
              <button key={c.id} onClick={() => abrir(c.id)}
                className={`w-full text-left px-3 py-2.5 border-l-4 ${
                  sel === c.id ? 'bg-brand/10 border-brand'
                  : noLeido ? 'bg-slate-200 hover:bg-slate-300 border-brand'
                  : 'hover:bg-gray-50 border-transparent'
                }`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 min-w-0">
                    {noLeido && <span className="w-2 h-2 rounded-full bg-brand shrink-0" aria-label="No leído" />}
                    <span className={`text-sm truncate ${noLeido ? 'font-bold text-gray-900' : 'font-medium text-gray-900'}`}>{c.contacto?.nombre || c.contacto?.telefono || 'Contacto'}</span>
                  </span>
                  <span className={`text-[10px] font-bold uppercase rounded px-1.5 py-0.5 ${CANAL_CLS[c.canal]}`}>{CANAL_LABEL[c.canal]}</span>
                </div>
                <div className="flex items-center justify-between gap-2 mt-0.5">
                  <span className={`text-[11px] truncate ${noLeido ? 'text-gray-600' : 'text-gray-400'}`}>{c.contacto?.telefono || ''}</span>
                  <span className={`text-[10px] shrink-0 ${noLeido ? 'text-gray-600 font-semibold' : 'text-gray-400'}`}>{fecha(c.ultimo_mensaje_at)}</span>
                </div>
                {c.etiquetas.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {c.etiquetas.map(e => <span key={e} className="text-[9px] uppercase bg-amber-100 text-amber-800 rounded px-1 py-0.5">{e}</span>)}
                  </div>
                )}
              </button>
              )
            })}
        </div>
      </div>

      {/* Conversación — en móvil ocupa toda la pantalla; en desktop, panel derecho */}
      <div className={`bg-white rounded-xl border border-gray-300 shadow-md flex-col overflow-hidden ${sel !== null ? 'flex' : 'hidden md:flex'}`}>
        {!conv ? (
          <div className="flex-1 flex items-center justify-center text-sm text-gray-400">Selecciona una conversación</div>
        ) : (
          <>
            <div className="p-3 border-b border-gray-300">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 min-w-0">
                  <button onClick={() => { setSel(null); setConv(null); setMsgs([]) }}
                    aria-label="Volver a la lista"
                    className="md:hidden shrink-0 text-gray-500 hover:text-gray-800 text-2xl leading-none px-1">‹</button>
                  <div className="min-w-0">
                    <p className="font-semibold text-gray-900 truncate">{conv.contacto?.nombre || conv.contacto?.telefono || 'Contacto'}</p>
                    <p className="text-xs text-gray-400 truncate">{conv.contacto?.telefono} · {CANAL_LABEL[conv.canal]} · audiencia {conv.audiencia}{conv.fuente === 'historico' ? ' · histórico' : ''}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button onClick={() => setAgentePausado(!conv.etiquetas.includes('pausado'))}
                    title={conv.etiquetas.includes('pausado') ? 'El agente está en pausa (responde un humano). Clic para reactivarlo.' : 'El agente responde automáticamente. Clic para pausarlo y atender tú.'}
                    className={`text-xs font-semibold rounded-lg px-3 py-1.5 ${conv.etiquetas.includes('pausado') ? 'bg-gray-200 text-gray-600' : 'bg-emerald-600 text-white'}`}>
                    {conv.etiquetas.includes('pausado') ? '🤖 Agente en pausa' : '🤖 Agente activo'}
                  </button>
                  <select
                    value={normEstado(conv.estado)}
                    onChange={e => patch({ estado: e.target.value })}
                    title="Categoría de la conversación"
                    className="text-xs font-semibold rounded-lg px-2 py-1.5 bg-slate-700 text-white border-0 cursor-pointer">
                    {CATEGORIAS.map(c => <option key={c.v} value={c.v} className="bg-white text-gray-900">{c.label}</option>)}
                  </select>
                  <button onClick={eliminar} title="Eliminar conversación y todos sus mensajes"
                    className="text-xs font-semibold rounded-lg px-2.5 py-1.5 border border-red-200 text-red-600 hover:bg-red-50">
                    🗑
                  </button>
                </div>
              </div>
              <div className="flex flex-wrap gap-1 mt-2">
                {ETIQUETAS.map(e => (
                  <button key={e} onClick={() => toggleEtiqueta(e)}
                    className={`text-[10px] uppercase rounded px-1.5 py-0.5 font-medium ${conv.etiquetas.includes(e) ? 'bg-amber-500 text-white' : 'bg-gray-100 text-gray-500'}`}>{e}</button>
                ))}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-2 bg-gray-50/50">
              {msgs.map(m => (
                <div key={m.id} className={`flex ${m.direccion === 'saliente' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[75%] rounded-lg px-3 py-2 text-sm ${m.direccion === 'saliente' ? 'bg-brand text-white' : 'bg-white border border-gray-300 text-gray-800'}`}>
                    {m.media_url ? (
                      m.tipo === 'imagen' ? (
                        <a href={m.media_url} target="_blank" rel="noreferrer">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={m.media_url} alt="" className="rounded-md max-w-full max-h-56" />
                        </a>
                      ) : m.tipo === 'video' ? (
                        <video src={m.media_url} controls className="rounded-md max-w-full max-h-56" />
                      ) : m.tipo === 'audio' ? (
                        <audio src={m.media_url} controls className="max-w-full" />
                      ) : (
                        <a href={m.media_url} target="_blank" rel="noreferrer" className="underline break-all">📎 Abrir archivo</a>
                      )
                    ) : (m.tipo !== 'texto' && <span className="text-[10px] opacity-70 italic">[{m.tipo}]</span>)}
                    {m.cuerpo ? <div className={m.media_url ? 'mt-1' : ''}>{m.cuerpo}</div> : null}
                    <div className={`text-[9px] mt-0.5 ${m.direccion === 'saliente' ? 'text-white/60' : 'text-gray-400'}`}>{fecha(m.ts)}{m.enviado_por === 'agente' ? ' · 🤖' : ''}{m.estado ? ` · ${m.estado}` : ''}</div>
                  </div>
                </div>
              ))}
              {msgs.length === 0 && <p className="text-center text-xs text-gray-400 py-6">Sin mensajes</p>}
              <div ref={bottomRef} />
            </div>

            <div className="p-3 border-t border-gray-300">
              <div className="flex gap-2 items-center">
                <input ref={fileRef} type="file" className="hidden"
                  accept="image/*,video/*,audio/*,application/pdf,.doc,.docx,.xls,.xlsx,.txt"
                  onChange={e => { const f = e.target.files?.[0]; if (f) enviarArchivo(f); e.target.value = '' }} />
                <button onClick={() => fileRef.current?.click()} disabled={subiendo || enviando}
                  title="Adjuntar foto, video o documento (máx ~4 MB)"
                  className="shrink-0 w-9 h-9 rounded-lg border border-gray-300 text-gray-500 hover:bg-gray-50 disabled:opacity-50 flex items-center justify-center text-2xl leading-none font-light">
                  {subiendo ? '…' : '+'}
                </button>
                <input value={texto} onChange={e => setTexto(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') enviar() }}
                  onPaste={e => {
                    // Pegar una imagen (Ctrl/⌘+V) → se envía como adjunto.
                    const item = Array.from(e.clipboardData?.items || []).find(i => i.kind === 'file' && i.type.startsWith('image/'))
                    const file = item?.getAsFile()
                    if (file) { e.preventDefault(); enviarArchivo(file) }
                  }}
                  placeholder="Escribe un mensaje… (o pega una imagen)"
                  className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand" />
                <button onClick={enviar} disabled={enviando || subiendo || !texto.trim()}
                  className="bg-brand hover:bg-brand-dark text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50">
                  {enviando ? '…' : 'Enviar'}
                </button>
              </div>
              <p className="text-[10px] text-gray-400 mt-1">📎 Adjunta fotos, videos o documentos (máx ~4 MB); si escribes texto, va como comentario del archivo. El envío en vivo requiere WhatsApp conectado y la ventana de 24h abierta.</p>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
