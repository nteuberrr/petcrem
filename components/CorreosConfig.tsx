'use client'
import { useState, useEffect, useCallback, useMemo } from 'react'

type CorreoMeta = { key: string; titulo: string; modulo: string; audiencia: 'Tutor' | 'Veterinario'; cuando: string }
type Muestra = { nombreMascota: string; nombreTutor: string; codigo: string; email: string; fechaCremacion: string }
type LogRow = {
  id: string; fecha_envio: string; tipo: string; audiencia: string; destinatario: string
  asunto: string; codigo: string; nombre: string; estado: string; motivo: string
}

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

function estadoBadge(estado: string): string {
  const e = (estado || '').toLowerCase()
  if (e === 'fallido') return 'bg-red-100 text-red-700'
  if (e === 'rebotado' || e === 'spam') return 'bg-amber-100 text-amber-700'
  if (e === 'entregado' || e === 'abierto' || e === 'clic') return 'bg-blue-100 text-blue-700'
  return 'bg-emerald-100 text-emerald-700' // enviado
}

export default function CorreosConfig() {
  const [correos, setCorreos] = useState<CorreoMeta[]>([])
  const [muestra, setMuestra] = useState<Muestra | null>(null)
  const [seguimiento, setSeguimiento] = useState('')
  const [segActivo, setSegActivo] = useState(false)
  const [segTipos, setSegTipos] = useState<Record<string, boolean>>({})
  const [savingSeg, setSavingSeg] = useState(false)
  const [sel, setSel] = useState<string>('')
  const [html, setHtml] = useState<string>('')
  const [subject, setSubject] = useState<string>('')
  const [cargandoPreview, setCargandoPreview] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [enviandoTodos, setEnviandoTodos] = useState(false)
  const [actualizando, setActualizando] = useState(false)
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'error'; msg: string } | null>(null)

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

  const cargarLista = useCallback(async (opts?: { aviso?: boolean }) => {
    setActualizando(true)
    try {
      const d = await fetch('/api/correos', { cache: 'no-store' }).then(r => r.json())
      const list: CorreoMeta[] = Array.isArray(d?.correos) ? d.correos : []
      setCorreos(list)
      setMuestra(d?.muestra ?? null)
      setSeguimiento(d?.seguimiento ?? '')
      setSegActivo(!!d?.seguimientoActivo)
      setSegTipos(d?.seguimientoTipos && typeof d.seguimientoTipos === 'object' ? d.seguimientoTipos : {})
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

  const grupos = useMemo(() => {
    const map = new Map<string, CorreoMeta[]>()
    for (const c of correos) {
      const arr = map.get(c.modulo) ?? []
      arr.push(c)
      map.set(c.modulo, arr)
    }
    return Array.from(map.entries())
  }, [correos])

  const tituloPorKey = useMemo(() => {
    const m = new Map<string, string>()
    for (const c of correos) m.set(c.key, c.titulo)
    return m
  }, [correos])

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

  // Activa/desactiva la copia de seguimiento para UN tipo de correo. Optimista.
  async function toggleSeguimiento(key: string) {
    if (!key) return
    const copiaActual = segTipos[key] !== false
    const next = { ...segTipos, [key]: !copiaActual }
    setSegTipos(next)
    setSavingSeg(true)
    try {
      const r = await fetch('/api/empresa-config', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seguimiento_tipos: JSON.stringify(next) }),
      })
      if (!r.ok) throw new Error()
    } catch {
      setSegTipos(segTipos) // revertir
      setFeedback({ kind: 'error', msg: 'No se pudo guardar la preferencia de copia.' })
    } finally {
      setSavingSeg(false)
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

  // Reenvía un correo del registro (mismo asunto + cuerpo) a una dirección ingresada
  // a mano. Si el seguimiento está activo para ese tipo, te llega copia (BCC).
  async function reenviar(row: LogRow) {
    const destino = window.prompt(`¿A qué correo reenviar "${row.asunto || row.tipo}"?\n(Original: ${row.destinatario || '—'})`, '')
    if (destino === null) return
    const to = destino.trim()
    if (!to) return
    setReenviando(row.id)
    try {
      const r = await fetch('/api/correos/log', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: row.id, to }),
      })
      const d = await r.json().catch(() => ({}))
      if (r.ok) {
        const copia = segActivo && segTipos[row.tipo] !== false
        const links = d.links_renovados ? ' Con enlaces nuevos y vigentes (subir foto / video).' : ''
        alert(`Reenviado a ${d.to}${copia ? ' (con copia a tu seguimiento)' : ''}.${links}`)
        cargarLog({ page: logPage, desde: logDesde, hasta: logHasta, q: logQ }) // aparece el reenvío en el registro
      } else {
        alert(d.error || 'No se pudo reenviar.')
      }
    } catch {
      alert('Error de red al reenviar.')
    } finally {
      setReenviando(null)
    }
  }

  const seleccionado = correos.find(c => c.key === sel)
  const copiaSel = sel ? segTipos[sel] !== false : true
  const totalPaginas = Math.max(1, Math.ceil(logTotal / 10))
  const buscarLog = () => cargarLog({ page: 1, desde: logDesde, hasta: logHasta, q: logQ })
  const irPagina = (n: number) => cargarLog({ page: n, desde: logDesde, hasta: logHasta, q: logQ })

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-bold text-gray-900">Correos</h2>
          <p className="text-sm text-gray-600 mt-0.5">
            Todos los correos que enviamos, agrupados por módulo. Previsualízalos acá y envía pruebas
            {seguimiento ? <> a <span className="font-mono text-gray-800">{seguimiento}</span></> : ' al correo de seguimiento'}.
          </p>
          {!seguimiento && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2 mt-2">
              No hay correo de seguimiento configurado. Defínelo en «Datos Personales» para poder enviar pruebas y recibir copias.
            </p>
          )}
          {seguimiento && !segActivo && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2 mt-2">
              La copia de seguimiento está <strong>desactivada</strong>. Actívala en «Datos Personales» para recibir copias; acá eliges, correo por correo, cuáles quieres recibir.
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => cargarLista({ aviso: true })}
            disabled={actualizando}
            className="border-2 border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50 px-3 py-2 rounded-lg text-sm font-semibold"
            title="Volver a leer el catálogo (por si saliste un deploy con correos nuevos)"
          >
            {actualizando ? '⌛' : '↻'} Actualizar
          </button>
          <button
            onClick={enviarTodos}
            disabled={enviandoTodos || !seguimiento || correos.length === 0}
            className="bg-brand hover:bg-brand-dark disabled:opacity-50 text-white px-3 py-2 rounded-lg text-sm font-semibold shadow-md"
            title={!seguimiento ? 'Configura el correo de seguimiento primero' : `Enviar una copia de los ${correos.length} correos a ${seguimiento}`}
          >
            {enviandoTodos ? '⌛ Enviando…' : `📨 Enviar todos (${correos.length})`}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4">
        {/* Lista agrupada por módulo */}
        <div className="space-y-4">
          {grupos.map(([modulo, items]) => (
            <div key={modulo} className="bg-white rounded-xl border-2 border-gray-300 overflow-hidden">
              <div className="px-3 py-2 bg-gray-50 border-b border-gray-300">
                <p className="text-xs font-bold text-gray-700 uppercase tracking-wide">{modulo}</p>
              </div>
              <div className="divide-y divide-gray-100">
                {items.map(c => {
                  const activo = c.key === sel
                  const copia = segTipos[c.key] !== false
                  return (
                    <button
                      key={c.key}
                      onClick={() => setSel(c.key)}
                      className={`w-full text-left px-3 py-2.5 transition-colors ${activo ? 'bg-brand/10' : 'hover:bg-gray-50'}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className={`text-sm font-medium ${activo ? 'text-brand' : 'text-gray-800'}`}>{c.titulo}</span>
                        <span className="flex items-center gap-1.5 shrink-0">
                          <span
                            title={copia ? 'Recibes copia de este correo' : 'No recibes copia de este correo'}
                            className={`inline-block w-2 h-2 rounded-full ${copia ? 'bg-emerald-500' : 'bg-gray-300'}`}
                          />
                          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${c.audiencia === 'Tutor' ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700'}`}>{c.audiencia}</span>
                        </span>
                      </div>
                      <p className="text-[11px] text-gray-500 mt-0.5">{c.cuando}</p>
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>

        {/* Panel de previsualización */}
        <div className="bg-white rounded-xl border-2 border-gray-300 overflow-hidden flex flex-col min-h-[520px]">
          <div className="px-4 py-3 border-b border-gray-300 flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-gray-900 truncate">{seleccionado?.titulo ?? 'Selecciona un correo'}</p>
              {subject && <p className="text-xs text-gray-500 truncate">Asunto: {subject}</p>}
            </div>
            <div className="flex items-center gap-3 shrink-0">
              {sel && (
                <label
                  className="flex items-center gap-2 text-xs font-medium text-gray-700 cursor-pointer select-none"
                  title="Recibir una copia (BCC) de este correo en la casilla de seguimiento"
                >
                  <input
                    type="checkbox"
                    checked={copiaSel}
                    onChange={() => toggleSeguimiento(sel)}
                    disabled={savingSeg}
                    className="h-4 w-4 rounded border-gray-300 text-brand focus:ring-brand"
                  />
                  Recibir copia
                </label>
              )}
              <button
                onClick={enviarPrueba}
                disabled={enviando || !sel || !seguimiento}
                className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-semibold shadow-md"
                title={!seguimiento ? 'Configura el correo de seguimiento primero' : `Enviar prueba a ${seguimiento}`}
              >
                {enviando ? '⌛ Enviando…' : '📧 Enviar prueba'}
              </button>
            </div>
          </div>

          {feedback && (
            <div className={`mx-4 mt-3 rounded-lg px-3 py-2 text-xs font-medium border ${feedback.kind === 'ok' ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-red-50 border-red-200 text-red-800'}`}>
              {feedback.msg}
            </div>
          )}

          {muestra && (
            <p className="px-4 pt-3 text-[11px] text-gray-400">
              Vista con datos del último cliente: <span className="font-medium text-gray-600">{muestra.nombreMascota}</span> · {muestra.codigo}
            </p>
          )}

          <div className="flex-1 p-4">
            {cargandoPreview ? (
              <div className="h-full flex items-center justify-center text-gray-400 text-sm">Cargando…</div>
            ) : html ? (
              <iframe
                title="preview-correo"
                srcDoc={html}
                className="w-full h-full min-h-[440px] rounded-lg border border-gray-300 bg-white"
              />
            ) : (
              <div className="h-full flex items-center justify-center text-gray-400 text-sm">Sin vista previa.</div>
            )}
          </div>
        </div>
      </div>

      {/* ── Registro / respaldo de correos enviados ── */}
      <div className="mt-8">
        <div className="mb-3">
          <h3 className="text-base font-bold text-gray-900">Registro de correos enviados</h3>
          <p className="text-sm text-gray-600 mt-0.5">
            Respaldo de todos los correos transaccionales enviados (no incluye campañas de mailing). Filtra por fecha o busca por destinatario, código, nombre o asunto.
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-2 mb-3">
          <div>
            <label className="block text-[11px] font-semibold text-gray-500 mb-1">Desde</label>
            <input type="date" value={logDesde} onChange={e => setLogDesde(e.target.value)}
              className="border-2 border-gray-300 rounded-lg px-2 py-1.5 text-sm" />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-gray-500 mb-1">Hasta</label>
            <input type="date" value={logHasta} onChange={e => setLogHasta(e.target.value)}
              className="border-2 border-gray-300 rounded-lg px-2 py-1.5 text-sm" />
          </div>
          <div className="flex-1 min-w-[180px]">
            <label className="block text-[11px] font-semibold text-gray-500 mb-1">Buscar</label>
            <input
              type="text" value={logQ} onChange={e => setLogQ(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') buscarLog() }}
              placeholder="destinatario, código, nombre, asunto…"
              className="w-full border-2 border-gray-300 rounded-lg px-3 py-1.5 text-sm"
            />
          </div>
          <button onClick={buscarLog} disabled={logLoading}
            className="bg-brand hover:bg-brand-dark disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-semibold shadow-md">
            {logLoading ? '⌛' : '🔍'} Buscar
          </button>
          {(logDesde || logHasta || logQ) && (
            <button
              onClick={() => { setLogDesde(''); setLogHasta(''); setLogQ(''); cargarLog({ page: 1, desde: '', hasta: '', q: '' }) }}
              className="border-2 border-gray-300 text-gray-700 hover:bg-gray-50 px-3 py-2 rounded-lg text-sm font-semibold">
              Limpiar
            </button>
          )}
        </div>

        <div className="bg-white rounded-xl border-2 border-gray-300 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-300 text-left text-[11px] uppercase tracking-wide text-gray-500">
                  <th className="px-3 py-2 font-semibold">Fecha</th>
                  <th className="px-3 py-2 font-semibold">Correo</th>
                  <th className="px-3 py-2 font-semibold">Destinatario</th>
                  <th className="px-3 py-2 font-semibold">Asunto</th>
                  <th className="px-3 py-2 font-semibold">Estado</th>
                  <th className="px-3 py-2 font-semibold text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {logLoading ? (
                  <tr><td colSpan={6} className="px-3 py-8 text-center text-gray-400">Cargando…</td></tr>
                ) : logItems.length === 0 ? (
                  <tr><td colSpan={6} className="px-3 py-8 text-center text-gray-400">No hay correos para mostrar.</td></tr>
                ) : logItems.map(row => (
                  <tr key={row.id} className="hover:bg-gray-50">
                    <td className="px-3 py-2 whitespace-nowrap text-gray-700">{fmtCL(row.fecha_envio)}</td>
                    <td className="px-3 py-2">
                      <span className="text-gray-800">{tituloPorKey.get(row.tipo) || row.tipo}</span>
                      {row.nombre && <span className="block text-[11px] text-gray-400">{row.nombre}{row.codigo ? ` · ${row.codigo}` : ''}</span>}
                    </td>
                    <td className="px-3 py-2 text-gray-700">{row.destinatario}</td>
                    <td className="px-3 py-2 text-gray-600 max-w-[260px] truncate" title={row.asunto}>{row.asunto}</td>
                    <td className="px-3 py-2">
                      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${estadoBadge(row.estado)}`}>{row.estado || 'enviado'}</span>
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      <button onClick={() => ver(row)} className="text-brand hover:text-brand font-semibold text-xs">Ver</button>
                      <button onClick={() => reenviar(row)} disabled={reenviando === row.id} className="ml-3 text-brand hover:text-brand font-semibold text-xs disabled:opacity-50">{reenviando === row.id ? 'Enviando…' : 'Reenviar'}</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between gap-2 px-3 py-2 border-t border-gray-300 bg-gray-50 text-xs text-gray-600">
            <span>{logTotal} correo{logTotal === 1 ? '' : 's'} en total</span>
            <div className="flex items-center gap-2">
              <button onClick={() => irPagina(logPage - 1)} disabled={logLoading || logPage <= 1}
                className="border border-gray-300 rounded px-2 py-1 disabled:opacity-40 hover:bg-white">‹</button>
              <span>Página {logPage} de {totalPaginas}</span>
              <button onClick={() => irPagina(logPage + 1)} disabled={logLoading || logPage >= totalPaginas}
                className="border border-gray-300 rounded px-2 py-1 disabled:opacity-40 hover:bg-white">›</button>
            </div>
          </div>
        </div>
      </div>

      {/* Visor de un correo del registro */}
      {verMeta && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setVerMeta(null)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="px-4 py-3 border-b border-gray-300 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-gray-900 truncate">{verMeta.asunto || '(sin asunto)'}</p>
                <p className="text-[11px] text-gray-500 mt-0.5">
                  {tituloPorKey.get(verMeta.tipo) || verMeta.tipo} · {verMeta.destinatario} · {fmtCL(verMeta.fecha_envio)}
                </p>
                {verMeta.motivo && <p className="text-[11px] text-red-600 mt-0.5">Error: {verMeta.motivo}</p>}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => reenviar(verMeta)}
                  disabled={reenviando === verMeta.id}
                  className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg text-xs font-semibold shadow-sm"
                >
                  {reenviando === verMeta.id ? '⌛ Enviando…' : '↪ Reenviar'}
                </button>
                <button onClick={() => setVerMeta(null)} className="text-gray-400 hover:text-gray-700 text-xl leading-none">✕</button>
              </div>
            </div>
            <div className="flex-1 p-3 overflow-auto bg-gray-50">
              {verLoading ? (
                <div className="h-[420px] flex items-center justify-center text-gray-400 text-sm">Cargando…</div>
              ) : verHtml ? (
                <iframe title="correo-enviado" srcDoc={verHtml} className="w-full h-[60vh] min-h-[420px] rounded-lg border border-gray-300 bg-white" />
              ) : (
                <div className="h-[420px] flex items-center justify-center text-gray-400 text-sm">Este correo no guardó cuerpo (o no se pudo cargar).</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
