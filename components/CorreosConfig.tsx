'use client'
import {
  Mail, Search, Send, RefreshCw, ChevronLeft, ChevronRight, ArrowLeft,
  PauseCircle, Forward, Eye,
} from 'lucide-react'
import { useState, useEffect, useCallback, useMemo } from 'react'
import { Card, Button, Tabs } from '@/components/ui/kit'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { Toggle } from '@/components/ui/Toggle'

/**
 * Configuración Avanzada → CORREOS.
 *
 * Tres tareas distintas que antes vivían apiladas en una sola columna de cinco
 * pantallas (y con el panel de vista previa estirado al alto de los 25 correos,
 * dejando un vacío enorme). Ahora son tres pestañas:
 *
 *  · Catálogo — la lista de todos los correos + su vista previa + los dos
 *    interruptores de cada uno: «Se envía» (al destinatario) y «Recibir copia»
 *    (BCC a tu casilla de seguimiento). No son lo mismo y se ven distintos.
 *  · Registro — respaldo de lo enviado, con filtros, visor y reenvío.
 *  · Ajustes  — la casilla de seguimiento (antes vivía suelta al final de la
 *    página, tres pantallas más abajo del aviso que la mencionaba).
 */

type CorreoMeta = {
  key: string; titulo: string; modulo: string
  audiencia: 'Tutor' | 'Veterinario' | 'Empleado'
  cuando: string; manual?: boolean
}
type Muestra = { nombreMascota: string; nombreTutor: string; codigo: string; email: string; fechaCremacion: string }
type LogRow = {
  id: string; fecha_envio: string; tipo: string; audiencia: string; destinatario: string
  asunto: string; codigo: string; nombre: string; estado: string; motivo: string
}
type Tab = 'Catálogo' | 'Registro' | 'Ajustes'

/** Formatea un ISO (UTC) a "DD-MM-YYYY HH:MM" en hora de Chile. */
function fmtCL(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  const p = new Intl.DateTimeFormat('es-CL', {
    timeZone: 'America/Santiago', day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(d)
  const g = (t: string) => p.find(x => x.type === t)?.value ?? ''
  return `${g('day')}-${g('month')}-${g('year')} ${g('hour')}:${g('minute')}`
}

type BadgeVariant = 'green' | 'yellow' | 'gray' | 'blue' | 'red' | 'purple' | 'gold'

function estadoVariant(estado: string): BadgeVariant {
  const e = (estado || '').toLowerCase()
  if (e === 'fallido') return 'red'
  if (e === 'omitido') return 'gray'
  if (e === 'rebotado' || e === 'spam') return 'yellow'
  if (e === 'entregado' || e === 'abierto' || e === 'clic') return 'blue'
  return 'green' // enviado
}

const AUDIENCIA_VARIANT: Record<CorreoMeta['audiencia'], BadgeVariant> = {
  Tutor: 'green', Veterinario: 'blue', Empleado: 'purple',
}

const INPUT = 'w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand focus:border-brand'

export default function CorreosConfig() {
  const [tab, setTab] = useState<Tab>('Catálogo')
  const [correos, setCorreos] = useState<CorreoMeta[]>([])
  const [muestra, setMuestra] = useState<Muestra | null>(null)
  const [seguimiento, setSeguimiento] = useState('')
  const [segActivo, setSegActivo] = useState(false)
  const [segTipos, setSegTipos] = useState<Record<string, boolean>>({})
  const [desactivados, setDesactivados] = useState<Record<string, boolean>>({})
  const [savingSeg, setSavingSeg] = useState(false)
  const [sel, setSel] = useState<string>('')
  const [busqueda, setBusqueda] = useState('')
  const [verDetalleMovil, setVerDetalleMovil] = useState(false)
  const [html, setHtml] = useState<string>('')
  const [subject, setSubject] = useState<string>('')
  const [cargandoPreview, setCargandoPreview] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [enviandoTodos, setEnviandoTodos] = useState(false)
  const [actualizando, setActualizando] = useState(false)
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'error'; msg: string } | null>(null)

  // ── Casilla de seguimiento (pestaña Ajustes) ──
  const [segEmailEdit, setSegEmailEdit] = useState('')
  const [segActivoEdit, setSegActivoEdit] = useState(false)
  const [guardandoCasilla, setGuardandoCasilla] = useState(false)
  const [casillaMsg, setCasillaMsg] = useState<{ ok: boolean; texto: string } | null>(null)

  // ── Registro / respaldo de correos enviados ──
  const [logItems, setLogItems] = useState<LogRow[]>([])
  const [logTotal, setLogTotal] = useState(0)
  const [logPage, setLogPage] = useState(1)
  const [logDesde, setLogDesde] = useState('')
  const [logHasta, setLogHasta] = useState('')
  const [logQ, setLogQ] = useState('')
  const [logLoading, setLogLoading] = useState(false)
  const [verMeta, setVerMeta] = useState<LogRow | null>(null)
  const [verHtml, setVerHtml] = useState('')
  const [verLoading, setVerLoading] = useState(false)
  const [reenviando, setReenviando] = useState<string | null>(null)
  const [reenviarRow, setReenviarRow] = useState<LogRow | null>(null)
  const [reenviarTo, setReenviarTo] = useState('')
  const [reenviarMsg, setReenviarMsg] = useState('')

  const cargarLista = useCallback(async (opts?: { aviso?: boolean }) => {
    setActualizando(true)
    try {
      const d = await fetch('/api/correos', { cache: 'no-store' }).then(r => r.json())
      const list: CorreoMeta[] = Array.isArray(d?.correos) ? d.correos : []
      setCorreos(list)
      setMuestra(d?.muestra ?? null)
      setSeguimiento(d?.seguimiento ?? '')
      setSegEmailEdit(d?.seguimiento ?? '')
      setSegActivo(!!d?.seguimientoActivo)
      setSegActivoEdit(!!d?.seguimientoActivo)
      setSegTipos(d?.seguimientoTipos && typeof d.seguimientoTipos === 'object' ? d.seguimientoTipos : {})
      setDesactivados(d?.correosDesactivados && typeof d.correosDesactivados === 'object' ? d.correosDesactivados : {})
      setSel(prev => prev || (list[0]?.key ?? ''))
      if (opts?.aviso) setFeedback({ kind: 'ok', msg: `Lista actualizada — ${list.length} correos en el catálogo.` })
    } catch {
      if (opts?.aviso) setFeedback({ kind: 'error', msg: 'No se pudo actualizar la lista.' })
    } finally {
      setActualizando(false)
    }
  }, [])

  useEffect(() => { queueMicrotask(() => cargarLista()) }, [cargarLista])

  const cargarPreview = useCallback(async (key: string) => {
    setCargandoPreview(true)
    setFeedback(null)
    try {
      const r = await fetch(`/api/correos?key=${encodeURIComponent(key)}`)
      const d = await r.json().catch(() => ({}))
      if (r.ok) { setHtml(d.html || ''); setSubject(d.subject || '') }
      else { setHtml(''); setSubject(''); setFeedback({ kind: 'error', msg: d.error || 'No se pudo cargar' }) }
    } finally {
      setCargandoPreview(false)
    }
  }, [])

  useEffect(() => { if (sel) queueMicrotask(() => cargarPreview(sel)) }, [sel, cargarPreview])

  // Fetcher estable del registro (no depende de estado → no se re-crea por tecla).
  const cargarLog = useCallback(async (p: { page: number; desde: string; hasta: string; q: string }) => {
    setLogLoading(true)
    try {
      const sp = new URLSearchParams()
      if (p.desde) sp.set('desde', p.desde)
      if (p.hasta) sp.set('hasta', p.hasta)
      if (p.q.trim()) sp.set('q', p.q.trim())
      sp.set('page', String(p.page))
      sp.set('pageSize', '10')
      const d = await fetch(`/api/correos/log?${sp.toString()}`, { cache: 'no-store' }).then(r => r.json())
      setLogItems(Array.isArray(d?.items) ? d.items : [])
      setLogTotal(d?.total || 0)
      setLogPage(p.page)
    } catch {
      setLogItems([]); setLogTotal(0)
    } finally {
      setLogLoading(false)
    }
  }, [])

  useEffect(() => { queueMicrotask(() => cargarLog({ page: 1, desde: '', hasta: '', q: '' })) }, [cargarLog])

  const filtrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    if (!q) return correos
    return correos.filter(c =>
      `${c.titulo} ${c.modulo} ${c.audiencia} ${c.cuando}`.toLowerCase().includes(q))
  }, [correos, busqueda])

  const grupos = useMemo(() => {
    const map = new Map<string, CorreoMeta[]>()
    for (const c of filtrados) {
      const arr = map.get(c.modulo) ?? []
      arr.push(c)
      map.set(c.modulo, arr)
    }
    return Array.from(map.entries())
  }, [filtrados])

  const tituloPorKey = useMemo(() => {
    const m = new Map<string, string>()
    for (const c of correos) m.set(c.key, c.titulo)
    return m
  }, [correos])

  const pausados = useMemo(() => correos.filter(c => desactivados[c.key] === true), [correos, desactivados])

  async function enviarPrueba() {
    if (!sel) return
    setEnviando(true)
    setFeedback(null)
    try {
      const r = await fetch('/api/correos', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: sel }),
      })
      const d = await r.json().catch(() => ({}))
      if (r.ok) setFeedback({ kind: 'ok', msg: `Correo de prueba enviado a ${d.to}` })
      else setFeedback({ kind: 'error', msg: d.error || 'No se pudo enviar la prueba' })
    } catch {
      setFeedback({ kind: 'error', msg: 'Error de red al enviar la prueba' })
    } finally {
      setEnviando(false)
    }
  }

  async function enviarTodos() {
    if (!seguimiento || correos.length === 0) return
    if (!confirm(`Se enviará una copia de los ${correos.length} correos del catálogo a ${seguimiento}, con datos del último cliente. ¿Continuar?`)) return
    setEnviandoTodos(true)
    setFeedback(null)
    try {
      const r = await fetch('/api/correos', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ all: true }),
      })
      const d = await r.json().catch(() => ({}))
      if (r.ok) {
        setFeedback({
          kind: d.fallidos ? 'error' : 'ok',
          msg: `Se enviaron ${d.enviados}/${d.total} correos a ${d.to}${d.fallidos ? ` · ${d.fallidos} fallaron` : ''}.`,
        })
      } else setFeedback({ kind: 'error', msg: d.error || 'No se pudieron enviar los correos' })
    } catch {
      setFeedback({ kind: 'error', msg: 'Error de red al enviar los correos' })
    } finally {
      setEnviandoTodos(false)
    }
  }

  /** Guarda un mapa por-tipo en empresa_config. Optimista: revierte si falla. */
  async function guardarMapa(
    campo: 'seguimiento_tipos' | 'correos_desactivados',
    next: Record<string, boolean>,
    revertir: () => void,
    errorMsg: string,
  ) {
    setSavingSeg(true)
    try {
      const r = await fetch('/api/empresa-config', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [campo]: JSON.stringify(next) }),
      })
      if (!r.ok) throw new Error()
    } catch {
      revertir()
      setFeedback({ kind: 'error', msg: errorMsg })
    } finally {
      setSavingSeg(false)
    }
  }

  /** Copia (BCC) de seguimiento para UN correo. */
  function toggleCopia(key: string) {
    if (!key) return
    const previo = segTipos
    const next = { ...segTipos, [key]: segTipos[key] === false }
    setSegTipos(next)
    guardarMapa('seguimiento_tipos', next, () => setSegTipos(previo), 'No se pudo guardar la preferencia de copia.')
  }

  /**
   * PAUSA un correo: deja de enviarse al destinatario. El corte real vive en
   * lib/resend-mailer, así que aplica venga el envío de donde venga.
   */
  function toggleEnvio(c: CorreoMeta) {
    const pausadoAhora = desactivados[c.key] === true
    if (!pausadoAhora) {
      const extra = c.manual
        ? '\n\nOJO: este correo lo dispara un botón del sistema. El botón va a seguir ahí, pero no va a enviar nada.'
        : ''
      if (!confirm(`¿Pausar «${c.titulo}»?\n\nDeja de enviarse a ${c.audiencia.toLowerCase()}es. Los intentos quedan en el Registro como «omitido», así se puede ver qué no salió.${extra}`)) return
    }
    const previo = desactivados
    const next = { ...desactivados }
    if (pausadoAhora) delete next[c.key]
    else next[c.key] = true
    setDesactivados(next)
    guardarMapa('correos_desactivados', next, () => setDesactivados(previo), 'No se pudo guardar el estado del correo.')
  }

  async function guardarCasilla() {
    const lista = segEmailEdit.split(',').map(c => c.trim()).filter(Boolean)
    if (segActivoEdit && (lista.length === 0 || !lista.every(c => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c)))) {
      setCasillaMsg({ ok: false, texto: 'Revisa los correos: alguno no es válido.' })
      return
    }
    setGuardandoCasilla(true); setCasillaMsg(null)
    try {
      const res = await fetch('/api/empresa-config', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email_seguimiento_activo: segActivoEdit ? 'TRUE' : 'FALSE',
          email_seguimiento: lista.join(', '),
        }),
      })
      const d = await res.json().catch(() => ({}))
      if (res.ok) {
        setCasillaMsg({ ok: true, texto: 'Guardado.' })
        setSeguimiento(lista.join(', '))
        setSegActivo(segActivoEdit)
      } else setCasillaMsg({ ok: false, texto: d?.error || 'Error al guardar' })
    } catch {
      setCasillaMsg({ ok: false, texto: 'Error de red al guardar.' })
    } finally {
      setGuardandoCasilla(false)
    }
  }

  async function ver(row: LogRow) {
    setVerMeta(row); setVerHtml(''); setVerLoading(true)
    try {
      const d = await fetch(`/api/correos/log?id=${encodeURIComponent(row.id)}`, { cache: 'no-store' }).then(r => r.json())
      setVerHtml(d?.html || '')
    } catch { setVerHtml('') }
    finally { setVerLoading(false) }
  }

  function abrirReenviar(row: LogRow) {
    setReenviarRow(row)
    setReenviarTo(row.destinatario || '')
    setReenviarMsg('')
  }

  /** Reenvía un correo del registro (mismo asunto + cuerpo) a otra dirección. */
  async function reenviar() {
    const row = reenviarRow
    if (!row) return
    const to = reenviarTo.trim()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) { setReenviarMsg('Escribe un correo válido.'); return }
    setReenviando(row.id); setReenviarMsg('')
    try {
      const r = await fetch('/api/correos/log', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: row.id, to }),
      })
      const d = await r.json().catch(() => ({}))
      if (r.ok) {
        const copia = segActivo && segTipos[row.tipo] !== false
        const links = d.links_renovados ? ' Con enlaces nuevos y vigentes (subir foto / video).' : ''
        setReenviarRow(null)
        setFeedback({ kind: 'ok', msg: `Reenviado a ${d.to}${copia ? ' (con copia a tu seguimiento)' : ''}.${links}` })
        cargarLog({ page: logPage, desde: logDesde, hasta: logHasta, q: logQ })
      } else {
        setReenviarMsg(d.error || 'No se pudo reenviar.')
      }
    } catch {
      setReenviarMsg('Error de red al reenviar.')
    } finally {
      setReenviando(null)
    }
  }

  const seleccionado = correos.find(c => c.key === sel)
  const copiaSel = sel ? segTipos[sel] !== false : true
  const envioSel = sel ? desactivados[sel] !== true : true
  const totalPaginas = Math.max(1, Math.ceil(logTotal / 10))
  const buscarLog = () => cargarLog({ page: 1, desde: logDesde, hasta: logHasta, q: logQ })
  const irPagina = (n: number) => cargarLog({ page: n, desde: logDesde, hasta: logHasta, q: logQ })

  return (
    <div className="space-y-4">
      {/* ── Cabecera ───────────────────────────────────────────────────────── */}
      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-brand">Correos</h2>
            <p className="text-sm text-gray-600 mt-0.5">
              Todos los correos que envía el sistema: revisa cómo se ven, manda pruebas, consulta el
              respaldo de lo enviado y pausa los que no quieras que salgan.
            </p>
            <div className="flex flex-wrap items-center gap-2 mt-2">
              <Badge variant="blue">{correos.length} correos</Badge>
              {pausados.length > 0 && <Badge variant="yellow">{pausados.length} pausado{pausados.length === 1 ? '' : 's'}</Badge>}
              {seguimiento && segActivo && <Badge variant="green">Copia a {seguimiento.split(',').length} casilla{seguimiento.split(',').length === 1 ? '' : 's'}</Badge>}
              {!segActivo && <Badge variant="gray">Sin copia de seguimiento</Badge>}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button variant="secondary" onClick={() => cargarLista({ aviso: true })} disabled={actualizando}
              title="Volver a leer el catálogo (por si salió un deploy con correos nuevos)">
              <RefreshCw className={`w-4 h-4 shrink-0 ${actualizando ? 'animate-spin' : ''}`} aria-hidden="true" />
              Actualizar
            </Button>
            <Button onClick={enviarTodos} disabled={enviandoTodos || !seguimiento || correos.length === 0}
              title={!seguimiento ? 'Configura la casilla de seguimiento en Ajustes' : `Enviar una copia de los ${correos.length} correos a ${seguimiento}`}>
              <Send className="w-4 h-4 shrink-0" aria-hidden="true" />
              {enviandoTodos ? 'Enviando…' : `Enviar todos (${correos.length})`}
            </Button>
          </div>
        </div>

        {!seguimiento && (
          <p className="text-xs text-amber-800 bg-amber-50 border border-amber-300 rounded-xl px-3 py-2 mt-3">
            No hay casilla de seguimiento configurada. Defínela en la pestaña <strong>Ajustes</strong> para poder enviar pruebas y recibir copias.
          </p>
        )}
        {feedback && (
          <p className={`text-xs font-medium rounded-xl px-3 py-2 mt-3 border ${
            feedback.kind === 'ok' ? 'bg-emerald-50 border-emerald-300 text-emerald-900' : 'bg-red-50 border-red-300 text-red-800'
          }`}>
            {feedback.msg}
          </p>
        )}
      </Card>

      <Tabs<Tab>
        tabs={[
          { key: 'Catálogo', label: <><Mail className="w-4 h-4" aria-hidden="true" /> Catálogo</> },
          { key: 'Registro', label: <><Eye className="w-4 h-4" aria-hidden="true" /> Registro</> },
          { key: 'Ajustes', label: 'Ajustes' },
        ]}
        value={tab}
        onChange={setTab}
      />

      {/* ── CATÁLOGO ───────────────────────────────────────────────────────── */}
      {tab === 'Catálogo' && (
        <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-4 items-start">
          {/* Lista */}
          <Card className={`overflow-hidden ${verDetalleMovil ? 'hidden lg:block' : ''}`}>
            <div className="p-3 border-b border-gray-300">
              <div className="relative">
                <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
                <input
                  type="text" value={busqueda} onChange={e => setBusqueda(e.target.value)}
                  placeholder="Buscar correo…"
                  className={`${INPUT} pl-9`}
                />
              </div>
            </div>
            <div className="max-h-[68vh] overflow-y-auto">
              {grupos.length === 0 && (
                <p className="px-4 py-8 text-center text-sm text-gray-500">Ningún correo coincide con la búsqueda.</p>
              )}
              {grupos.map(([modulo, items]) => (
                <div key={modulo}>
                  <div className="px-3 py-2 bg-gray-50 border-y border-gray-200 sticky top-0 z-10">
                    <p className="text-[11px] font-bold text-gray-600 uppercase tracking-wide">{modulo}</p>
                  </div>
                  {items.map(c => {
                    const activo = c.key === sel
                    const pausado = desactivados[c.key] === true
                    return (
                      <button
                        key={c.key}
                        onClick={() => { setSel(c.key); setVerDetalleMovil(true) }}
                        className={`w-full text-left px-3 py-3 border-b border-gray-100 transition-colors ${
                          activo ? 'bg-brand/10' : 'hover:bg-gray-50'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <span className={`text-sm font-semibold ${pausado ? 'text-gray-500 line-through' : activo ? 'text-brand' : 'text-gray-800'}`}>
                            {c.titulo}
                          </span>
                          <span className="shrink-0"><Badge variant={AUDIENCIA_VARIANT[c.audiencia]}>{c.audiencia}</Badge></span>
                        </div>
                        <p className="text-[11px] text-gray-600 mt-1 leading-snug">{c.cuando}</p>
                        <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                          {pausado && <Badge variant="yellow">Pausado</Badge>}
                          {segTipos[c.key] === false && <Badge variant="gray">Sin copia</Badge>}
                        </div>
                      </button>
                    )
                  })}
                </div>
              ))}
            </div>
          </Card>

          {/* Vista previa + interruptores */}
          <Card className={`overflow-hidden lg:sticky lg:top-4 ${verDetalleMovil ? '' : 'hidden lg:block'}`}>
            <div className="px-4 py-3 border-b border-gray-300">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <button
                    onClick={() => setVerDetalleMovil(false)}
                    className="lg:hidden inline-flex items-center gap-1 text-xs font-semibold text-brand-soft mb-1">
                    <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" /> Volver a la lista
                  </button>
                  <p className="text-sm font-bold text-gray-900">{seleccionado?.titulo ?? 'Selecciona un correo'}</p>
                  {subject && <p className="text-xs text-gray-600 mt-0.5 truncate">Asunto: {subject}</p>}
                </div>
                <Button onClick={enviarPrueba} disabled={enviando || !sel || !seguimiento}
                  title={!seguimiento ? 'Configura la casilla de seguimiento en Ajustes' : `Enviar prueba a ${seguimiento}`}>
                  <Mail className="w-4 h-4 shrink-0" aria-hidden="true" />
                  {enviando ? 'Enviando…' : 'Enviar prueba'}
                </Button>
              </div>

              {seleccionado && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-3">
                  <div className={`flex items-start gap-3 rounded-xl border px-3 py-2 ${
                    envioSel ? 'border-gray-300 bg-white' : 'border-amber-300 bg-amber-50'
                  }`}>
                    <Toggle checked={envioSel} disabled={savingSeg} onChange={() => toggleEnvio(seleccionado)} />
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-gray-900">{envioSel ? 'Se envía' : 'Pausado'}</p>
                      <p className="text-[11px] text-gray-600 leading-snug">
                        {envioSel
                          ? `Le llega a ${seleccionado.audiencia.toLowerCase()}.`
                          : 'No se envía a nadie; queda en el Registro como «omitido».'}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3 rounded-xl border border-gray-300 px-3 py-2">
                    <Toggle checked={copiaSel} disabled={savingSeg} onChange={() => toggleCopia(sel)} />
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-gray-900">Recibir copia</p>
                      <p className="text-[11px] text-gray-600 leading-snug">
                        Copia oculta (BCC) a tu casilla de seguimiento.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {seleccionado?.manual && !envioSel && (
                <p className="text-[11px] text-amber-900 bg-amber-50 border border-amber-300 rounded-xl px-3 py-2 mt-2">
                  Este correo lo dispara un botón del sistema: el botón sigue ahí, pero no va a enviar nada mientras esté pausado.
                </p>
              )}

              {muestra && (
                <p className="text-[11px] text-gray-500 mt-2">
                  Vista con datos del último cliente: <span className="font-semibold text-gray-700">{muestra.nombreMascota}</span> · {muestra.codigo}
                  {' · '}las pruebas se envían aunque el correo esté pausado.
                </p>
              )}
            </div>

            <div className="p-4">
              {cargandoPreview ? (
                <div className="h-[440px] flex items-center justify-center text-gray-500 text-sm">Cargando…</div>
              ) : html ? (
                <iframe
                  title="preview-correo"
                  srcDoc={html}
                  className="w-full h-[62vh] min-h-[440px] rounded-xl border border-gray-300 bg-white"
                />
              ) : (
                <div className="h-[440px] flex items-center justify-center text-gray-500 text-sm">Sin vista previa.</div>
              )}
            </div>
          </Card>
        </div>
      )}

      {/* ── REGISTRO ───────────────────────────────────────────────────────── */}
      {tab === 'Registro' && (
        <div className="space-y-4">
          <Card className="p-4">
            <p className="text-sm text-gray-600">
              Respaldo de todos los correos transaccionales enviados (no incluye campañas de mailing).
              Filtra por fecha o busca por destinatario, código, nombre o asunto.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-[160px_160px_1fr_auto] gap-2 items-end mt-3">
              <div>
                <label className="block text-[11px] font-semibold text-gray-600 mb-1">Desde</label>
                <input type="date" value={logDesde} onChange={e => setLogDesde(e.target.value)} className={INPUT} />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-gray-600 mb-1">Hasta</label>
                <input type="date" value={logHasta} onChange={e => setLogHasta(e.target.value)} className={INPUT} />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-gray-600 mb-1">Buscar</label>
                <input
                  type="text" value={logQ} onChange={e => setLogQ(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') buscarLog() }}
                  placeholder="destinatario, código, nombre, asunto…"
                  className={INPUT}
                />
              </div>
              <div className="flex items-center gap-2">
                <Button onClick={buscarLog} disabled={logLoading}>
                  <Search className="w-4 h-4 shrink-0" aria-hidden="true" /> Buscar
                </Button>
                {(logDesde || logHasta || logQ) && (
                  <Button variant="secondary"
                    onClick={() => { setLogDesde(''); setLogHasta(''); setLogQ(''); cargarLog({ page: 1, desde: '', hasta: '', q: '' }) }}>
                    Limpiar
                  </Button>
                )}
              </div>
            </div>
          </Card>

          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-300 text-left text-[11px] uppercase tracking-wide text-gray-600">
                    <th className="px-3 py-2.5 font-semibold">Fecha</th>
                    <th className="px-3 py-2.5 font-semibold">Correo</th>
                    <th className="px-3 py-2.5 font-semibold">Destinatario</th>
                    <th className="px-3 py-2.5 font-semibold">Asunto</th>
                    <th className="px-3 py-2.5 font-semibold">Estado</th>
                    <th className="px-3 py-2.5 font-semibold text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {logLoading ? (
                    <tr><td colSpan={6} className="px-3 py-8 text-center text-gray-500">Cargando…</td></tr>
                  ) : logItems.length === 0 ? (
                    <tr><td colSpan={6} className="px-3 py-8 text-center text-gray-500">No hay correos para mostrar.</td></tr>
                  ) : logItems.map(row => (
                    <tr key={row.id} className="hover:bg-gray-50">
                      <td className="px-3 py-2.5 whitespace-nowrap text-gray-700">{fmtCL(row.fecha_envio)}</td>
                      <td className="px-3 py-2.5">
                        <span className="text-gray-800">{tituloPorKey.get(row.tipo) || row.tipo}</span>
                        {row.nombre && <span className="block text-[11px] text-gray-500">{row.nombre}{row.codigo ? ` · ${row.codigo}` : ''}</span>}
                      </td>
                      <td className="px-3 py-2.5 text-gray-700">{row.destinatario}</td>
                      <td className="px-3 py-2.5 text-gray-600 max-w-[260px] truncate" title={row.asunto}>{row.asunto}</td>
                      <td className="px-3 py-2.5"><Badge variant={estadoVariant(row.estado)}>{row.estado || 'enviado'}</Badge></td>
                      <td className="px-3 py-2.5 text-right whitespace-nowrap">
                        <Button variant="ghost" className="px-2 py-1.5" onClick={() => ver(row)}>Ver</Button>
                        <Button variant="ghost" className="px-2 py-1.5 ml-1" onClick={() => abrirReenviar(row)}>Reenviar</Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between gap-2 px-3 py-2 border-t border-gray-300 bg-gray-50 text-xs text-gray-600">
              <span>{logTotal} correo{logTotal === 1 ? '' : 's'} en total</span>
              <div className="flex items-center gap-2">
                <Button variant="secondary" className="px-2.5 py-2" onClick={() => irPagina(logPage - 1)} disabled={logLoading || logPage <= 1} aria-label="Página anterior">
                  <ChevronLeft className="w-4 h-4" aria-hidden="true" />
                </Button>
                <span>Página {logPage} de {totalPaginas}</span>
                <Button variant="secondary" className="px-2.5 py-2" onClick={() => irPagina(logPage + 1)} disabled={logLoading || logPage >= totalPaginas} aria-label="Página siguiente">
                  <ChevronRight className="w-4 h-4" aria-hidden="true" />
                </Button>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* ── AJUSTES ────────────────────────────────────────────────────────── */}
      {tab === 'Ajustes' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
          <Card className="p-5">
            <h3 className="text-base font-bold text-brand">Copia de seguimiento</h3>
            <p className="text-sm text-gray-600 mt-1">
              Si está activa, llega una <strong>copia oculta (BCC)</strong> de cada correo transaccional
              que envía el sistema (registro, cremación, despachos, eutanasias, informes…).
              <strong> No incluye</strong> el mailing masivo. En el <strong>Catálogo</strong> eliges,
              correo por correo, cuáles quieres recibir.
            </p>
            <div className="flex items-center gap-3 mt-4">
              <Toggle checked={segActivoEdit} onChange={setSegActivoEdit} />
              <span className="text-sm font-medium text-gray-700">{segActivoEdit ? 'Activada' : 'Desactivada'}</span>
            </div>
            <label className="block text-xs font-semibold text-gray-700 mt-4">Reenviar copia a estos correos</label>
            <input type="text" value={segEmailEdit} onChange={e => setSegEmailEdit(e.target.value)}
              placeholder="uno o varios separados por coma" className={`${INPUT} mt-1`} />
            <p className="text-[11px] text-gray-600 mt-1">
              Puedes poner <strong>varios correos separados por coma</strong> y la copia le llega a todos.
            </p>
            <div className="flex items-center gap-3 mt-4">
              <Button onClick={guardarCasilla} disabled={guardandoCasilla}>
                {guardandoCasilla ? 'Guardando…' : 'Guardar'}
              </Button>
              {casillaMsg && (
                <span className={`text-sm ${casillaMsg.ok ? 'text-emerald-700' : 'text-red-600'}`}>{casillaMsg.texto}</span>
              )}
            </div>
            <p className="text-[11px] text-gray-500 mt-2">El cambio puede tardar hasta ~1 minuto en aplicarse a los envíos.</p>
          </Card>

          <Card className="p-5">
            <h3 className="text-base font-bold text-brand">Correos pausados</h3>
            <p className="text-sm text-gray-600 mt-1">
              Los que dejaron de enviarse. Se pausan y se reactivan desde el <strong>Catálogo</strong>,
              y mientras estén acá cada intento queda en el Registro como <strong>«omitido»</strong>.
            </p>
            {pausados.length === 0 ? (
              <p className="text-sm text-gray-500 mt-4">Ninguno: los {correos.length} correos del catálogo se están enviando.</p>
            ) : (
              <ul className="mt-4 space-y-2">
                {pausados.map(c => (
                  <li key={c.key} className="flex items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-gray-900 flex items-center gap-1.5">
                        <PauseCircle className="w-4 h-4 shrink-0 text-amber-700" aria-hidden="true" />
                        {c.titulo}
                      </p>
                      <p className="text-[11px] text-gray-600 mt-0.5">{c.modulo} · {c.audiencia}</p>
                    </div>
                    <Button variant="secondary" className="shrink-0" disabled={savingSeg} onClick={() => toggleEnvio(c)}>
                      Reactivar
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}

      {/* Visor de un correo del registro */}
      <Modal open={!!verMeta} onClose={() => setVerMeta(null)} title={verMeta?.asunto || '(sin asunto)'} size="3xl">
        {verMeta && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs text-gray-600">
                  {tituloPorKey.get(verMeta.tipo) || verMeta.tipo} · {verMeta.destinatario} · {fmtCL(verMeta.fecha_envio)}
                </p>
                {verMeta.motivo && <p className="text-xs text-red-600 mt-0.5">{verMeta.motivo}</p>}
              </div>
              <Button variant="secondary" onClick={() => abrirReenviar(verMeta)} disabled={reenviando === verMeta.id}>
                <Forward className="w-4 h-4 shrink-0" aria-hidden="true" /> Reenviar
              </Button>
            </div>
            {verLoading ? (
              <div className="h-[420px] flex items-center justify-center text-gray-500 text-sm">Cargando…</div>
            ) : verHtml ? (
              <iframe title="correo-enviado" srcDoc={verHtml} className="w-full h-[60vh] min-h-[420px] rounded-xl border border-gray-300 bg-white" />
            ) : (
              <div className="h-[420px] flex items-center justify-center text-gray-500 text-sm">Este correo no guardó cuerpo (o no se pudo cargar).</div>
            )}
          </div>
        )}
      </Modal>

      {/* Reenviar a otra dirección */}
      <Modal open={!!reenviarRow} onClose={() => setReenviarRow(null)} title="Reenviar correo">
        {reenviarRow && (
          <div>
            <p className="text-sm text-gray-600">
              Se reenvía <strong>{reenviarRow.asunto || tituloPorKey.get(reenviarRow.tipo) || reenviarRow.tipo}</strong> tal
              cual se envió. Original: <span className="text-gray-800">{reenviarRow.destinatario || '—'}</span>.
            </p>
            <label className="block text-xs font-semibold text-gray-700 mt-4">Enviar a</label>
            <input
              type="email" value={reenviarTo} onChange={e => setReenviarTo(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') reenviar() }}
              placeholder="correo@ejemplo.cl" className={`${INPUT} mt-1`} autoFocus
            />
            {reenviarMsg && <p className="text-sm text-red-600 mt-2">{reenviarMsg}</p>}
            <div className="flex justify-end gap-2 mt-5">
              <Button variant="secondary" onClick={() => setReenviarRow(null)} disabled={!!reenviando}>Cancelar</Button>
              <Button onClick={reenviar} disabled={!!reenviando}>
                {reenviando ? 'Enviando…' : 'Reenviar'}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
