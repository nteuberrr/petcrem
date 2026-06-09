'use client'
import { useState, useEffect, useCallback, useMemo } from 'react'

type CorreoMeta = { key: string; titulo: string; modulo: string; audiencia: 'Tutor' | 'Veterinario'; cuando: string }
type Muestra = { nombreMascota: string; nombreTutor: string; codigo: string; email: string; fechaCremacion: string }

export default function CorreosConfig() {
  const [correos, setCorreos] = useState<CorreoMeta[]>([])
  const [muestra, setMuestra] = useState<Muestra | null>(null)
  const [seguimiento, setSeguimiento] = useState('')
  const [sel, setSel] = useState<string>('')
  const [html, setHtml] = useState<string>('')
  const [subject, setSubject] = useState<string>('')
  const [cargandoPreview, setCargandoPreview] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'error'; msg: string } | null>(null)

  useEffect(() => {
    fetch('/api/correos').then(r => r.json()).then(d => {
      const list: CorreoMeta[] = Array.isArray(d?.correos) ? d.correos : []
      setCorreos(list)
      setMuestra(d?.muestra ?? null)
      setSeguimiento(d?.seguimiento ?? '')
      if (list.length > 0) setSel(list[0].key)
    }).catch(() => {})
  }, [])

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

  const grupos = useMemo(() => {
    const map = new Map<string, CorreoMeta[]>()
    for (const c of correos) {
      const arr = map.get(c.modulo) ?? []
      arr.push(c)
      map.set(c.modulo, arr)
    }
    return Array.from(map.entries())
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

  const seleccionado = correos.find(c => c.key === sel)

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-lg font-bold text-gray-900">Correos</h2>
        <p className="text-sm text-gray-600 mt-0.5">
          Todos los correos que enviamos, agrupados por módulo. Previsualízalos acá y envía una prueba
          {seguimiento ? <> a <span className="font-mono text-gray-800">{seguimiento}</span></> : ' al correo de seguimiento'}.
        </p>
        {!seguimiento && (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2 mt-2">
            No hay correo de seguimiento configurado. Defínelo en Configuración → Mantenimiento para poder enviar pruebas.
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4">
        {/* Lista agrupada por módulo */}
        <div className="space-y-4">
          {grupos.map(([modulo, items]) => (
            <div key={modulo} className="bg-white rounded-xl border-2 border-gray-200 overflow-hidden">
              <div className="px-3 py-2 bg-gray-50 border-b border-gray-200">
                <p className="text-xs font-bold text-gray-700 uppercase tracking-wide">{modulo}</p>
              </div>
              <div className="divide-y divide-gray-100">
                {items.map(c => {
                  const activo = c.key === sel
                  return (
                    <button
                      key={c.key}
                      onClick={() => setSel(c.key)}
                      className={`w-full text-left px-3 py-2.5 transition-colors ${activo ? 'bg-indigo-50' : 'hover:bg-gray-50'}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className={`text-sm font-medium ${activo ? 'text-indigo-800' : 'text-gray-800'}`}>{c.titulo}</span>
                        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full shrink-0 ${c.audiencia === 'Tutor' ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700'}`}>{c.audiencia}</span>
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
        <div className="bg-white rounded-xl border-2 border-gray-200 overflow-hidden flex flex-col min-h-[520px]">
          <div className="px-4 py-3 border-b border-gray-200 flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-gray-900 truncate">{seleccionado?.titulo ?? 'Selecciona un correo'}</p>
              {subject && <p className="text-xs text-gray-500 truncate">Asunto: {subject}</p>}
            </div>
            <button
              onClick={enviarPrueba}
              disabled={enviando || !sel || !seguimiento}
              className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-semibold shadow-sm shrink-0"
              title={!seguimiento ? 'Configura el correo de seguimiento primero' : `Enviar prueba a ${seguimiento}`}
            >
              {enviando ? '⌛ Enviando…' : '📧 Enviar prueba'}
            </button>
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
                className="w-full h-full min-h-[440px] rounded-lg border border-gray-200 bg-white"
              />
            ) : (
              <div className="h-full flex items-center justify-center text-gray-400 text-sm">Sin vista previa.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
