'use client'
import { Eye, Send } from 'lucide-react'
import { useState, useEffect, useCallback } from 'react'
import { useAccionUnica } from '@/lib/use-accion-unica'

/**
 * Configuración Avanzada → AVISOS.
 *
 * Correos internos programados (ver lib/avisos): a quién se mandan, a qué hora
 * de Chile y si salen cuando no hay nada que reportar. Incluye vista previa con
 * datos REALES y envío de prueba. El catálogo lo define lib/avisos: cada aviso
 * nuevo aparece acá solo.
 */

type Aviso = {
  clave: string
  titulo: string
  descripcion: string
  activo: boolean
  destinatarios: string[]
  hora: string
  omitirVacio: boolean
  ultimoEnvio: string
}

type Borrador = { destinatarios: string; hora: string; omitirVacio: boolean }

export default function AvisosConfig() {
  const [avisos, setAvisos] = useState<Aviso[]>([])
  const [resendOk, setResendOk] = useState(true)
  const [cargando, setCargando] = useState(true)
  const [borradores, setBorradores] = useState<Record<string, Borrador>>({})
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'error'; msg: string } | null>(null)
  const [preview, setPreview] = useState<{ clave: string; subject: string; html: string; resumen: string } | null>(null)
  const [cargandoPreview, setCargandoPreview] = useState('')
  const { ejecutar, procesando } = useAccionUnica()

  const cargar = useCallback(async () => {
    setCargando(true)
    try {
      const d = await fetch('/api/avisos', { cache: 'no-store' }).then(r => r.json())
      const list: Aviso[] = Array.isArray(d?.avisos) ? d.avisos : []
      setAvisos(list)
      setResendOk(d?.resendConfigurado !== false)
      setBorradores(Object.fromEntries(list.map(a => [a.clave, {
        destinatarios: a.destinatarios.join(', '),
        hora: a.hora,
        omitirVacio: a.omitirVacio,
      }])))
    } catch {
      setFeedback({ kind: 'error', msg: 'No se pudo cargar la configuración de avisos.' })
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => { queueMicrotask(() => cargar()) }, [cargar])

  function setBorrador(clave: string, patch: Partial<Borrador>) {
    setBorradores(prev => ({ ...prev, [clave]: { ...prev[clave], ...patch } }))
  }

  async function guardar(a: Aviso, extra: { activo?: boolean } = {}) {
    const b = borradores[a.clave]
    setFeedback(null)
    const destinatarios = (b?.destinatarios ?? '').split(/[,;\n]/).map(s => s.trim()).filter(Boolean)
    const invalido = destinatarios.find(d => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d))
    if (invalido) { setFeedback({ kind: 'error', msg: `"${invalido}" no es un correo válido.` }); return }
    if ((extra.activo ?? a.activo) && destinatarios.length === 0) {
      setFeedback({ kind: 'error', msg: 'Agrega al menos un correo antes de activar el aviso.' })
      return
    }
    try {
      const r = await fetch('/api/avisos', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clave: a.clave,
          activo: extra.activo ?? a.activo,
          destinatarios,
          hora: b?.hora || a.hora,
          omitirVacio: b?.omitirVacio ?? a.omitirVacio,
        }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) { setFeedback({ kind: 'error', msg: d.error || 'No se pudo guardar.' }); return }
      setAvisos(prev => prev.map(x => x.clave === a.clave ? { ...x, ...d.config } : x))
      setFeedback({ kind: 'ok', msg: 'Cambios guardados.' })
    } catch {
      setFeedback({ kind: 'error', msg: 'Error de red al guardar.' })
    }
  }

  async function verPreview(a: Aviso) {
    setCargandoPreview(a.clave)
    setFeedback(null)
    try {
      const r = await fetch(`/api/avisos?key=${encodeURIComponent(a.clave)}`, { cache: 'no-store' })
      const d = await r.json().catch(() => ({}))
      if (r.ok) setPreview({ clave: a.clave, subject: d.subject || '', html: d.html || '', resumen: d.resumen || '' })
      else setFeedback({ kind: 'error', msg: d.error || 'No se pudo generar la vista previa.' })
    } catch {
      setFeedback({ kind: 'error', msg: 'Error de red al generar la vista previa.' })
    } finally {
      setCargandoPreview('')
    }
  }

  async function enviar(a: Aviso, modo: 'prueba' | 'ahora') {
    setFeedback(null)
    let to: string[] | undefined
    if (modo === 'prueba') {
      const destino = window.prompt('¿A qué correo mando la prueba?', a.destinatarios[0] || '')
      if (destino === null) return
      const limpio = destino.trim()
      if (!limpio) return
      to = [limpio]
    } else {
      const lista = a.destinatarios.join(', ')
      if (!lista) { setFeedback({ kind: 'error', msg: 'Guarda primero los destinatarios.' }); return }
      if (!confirm(`Se enviará el aviso "${a.titulo}" ahora mismo a: ${lista}. ¿Continuar?`)) return
    }
    try {
      const r = await fetch('/api/avisos', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clave: a.clave, ...(to ? { to } : {}) }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) { setFeedback({ kind: 'error', msg: d.error || 'No se pudo enviar.' }); return }
      setFeedback({
        kind: d.fallidos ? 'error' : 'ok',
        msg: `Enviado a ${d.destinatarios?.join(', ')} — ${d.resumen}${d.fallidos ? ` · ${d.fallidos} falló(aron)` : ''}`,
      })
    } catch {
      setFeedback({ kind: 'error', msg: 'Error de red al enviar.' })
    }
  }

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-lg font-bold text-gray-900">Avisos</h2>
        <p className="text-sm text-gray-600 mt-0.5">
          Informes automáticos que el sistema le manda al equipo. Elige quién los recibe y a qué hora salen (hora de Chile).
        </p>
        {!resendOk && (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2 mt-2">
            Falta configurar <span className="font-mono">RESEND_API_KEY</span>: los avisos no se pueden enviar.
          </p>
        )}
      </div>

      {feedback && (
        <div className={`mb-4 text-sm rounded-lg px-3 py-2 border ${feedback.kind === 'ok' ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-red-50 border-red-200 text-red-700'}`}>
          {feedback.msg}
        </div>
      )}

      {cargando && <p className="text-sm text-gray-500">Cargando…</p>}

      <div className="space-y-4">
        {avisos.map(a => {
          const b = borradores[a.clave] ?? { destinatarios: '', hora: a.hora, omitirVacio: a.omitirVacio }
          return (
            <div key={a.clave} className="bg-white rounded-xl border-2 border-gray-300 overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-300 flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-bold text-gray-900">{a.titulo}</p>
                  <p className="text-xs text-gray-500 mt-0.5 max-w-2xl">{a.descripcion}</p>
                </div>
                <button
                  onClick={() => ejecutar(() => guardar(a, { activo: !a.activo }))}
                  disabled={procesando}
                  className={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold border-2 transition-colors disabled:opacity-50 ${a.activo ? 'bg-emerald-50 border-emerald-300 text-emerald-800' : 'bg-gray-50 border-gray-300 text-gray-600'}`}
                  title={a.activo ? 'El aviso está activo — clic para desactivarlo' : 'El aviso está apagado — clic para activarlo'}
                >
                  {a.activo ? '● Activo' : '○ Desactivado'}
                </button>
              </div>

              <div className="p-4 grid grid-cols-1 lg:grid-cols-3 gap-4">
                <div className="lg:col-span-2">
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Destinatarios</label>
                  <textarea
                    value={b.destinatarios}
                    onChange={e => setBorrador(a.clave, { destinatarios: e.target.value })}
                    rows={2}
                    placeholder="correo@almaanimal.cl, otro@almaanimal.cl"
                    className="w-full border-2 border-gray-300 rounded-lg px-3 py-2 text-sm focus:border-brand focus:outline-none"
                  />
                  <p className="text-[11px] text-gray-500 mt-1">Separa los correos con coma. Cada uno recibe el informe por separado.</p>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Hora de envío</label>
                  <input
                    type="time"
                    value={b.hora}
                    onChange={e => setBorrador(a.clave, { hora: e.target.value })}
                    className="w-full border-2 border-gray-300 rounded-lg px-3 py-2 text-sm focus:border-brand focus:outline-none"
                  />
                  <p className="text-[11px] text-gray-500 mt-1">Hora de Chile, todos los días.</p>
                  <label className="flex items-start gap-2 mt-3 text-xs text-gray-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={b.omitirVacio}
                      onChange={e => setBorrador(a.clave, { omitirVacio: e.target.checked })}
                      className="mt-0.5"
                    />
                    <span>No enviar si no hay nada que reportar</span>
                  </label>
                </div>
              </div>

              <div className="px-4 pb-4 flex flex-wrap items-center gap-2">
                <button
                  onClick={() => ejecutar(() => guardar(a))}
                  disabled={procesando}
                  className="bg-brand hover:bg-brand-dark disabled:opacity-50 text-white px-3 py-2 rounded-lg text-sm font-semibold shadow-md"
                >
                  Guardar
                </button>
                <button
                  onClick={() => verPreview(a)}
                  disabled={cargandoPreview === a.clave}
                  className="border-2 border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50 px-3 py-2 rounded-lg text-sm font-semibold"
                >
                  {cargandoPreview === a.clave ? 'Generando…' : <><Eye className="w-3.5 h-3.5 shrink-0" aria-hidden="true" /> Vista previa</>}
                </button>
                <button
                  onClick={() => ejecutar(() => enviar(a, 'prueba'))}
                  disabled={procesando || !resendOk}
                  className="border-2 border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50 px-3 py-2 rounded-lg text-sm font-semibold"
                >
                  <Send className="w-3.5 h-3.5 shrink-0 inline-block align-[-2px]" aria-hidden="true" /> Enviar prueba
                </button>
                <button
                  onClick={() => ejecutar(() => enviar(a, 'ahora'))}
                  disabled={procesando || !resendOk || a.destinatarios.length === 0}
                  className="border-2 border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50 px-3 py-2 rounded-lg text-sm font-semibold"
                  title="Manda el aviso ahora a los destinatarios configurados"
                >
                  ▶ Enviar ahora
                </button>
                <span className="text-[11px] text-gray-500 ml-auto">
                  {a.ultimoEnvio ? `Último envío automático: ${a.ultimoEnvio}` : 'Todavía no ha salido automáticamente'}
                </span>
              </div>

              {preview?.clave === a.clave && (
                <div className="border-t border-gray-300 bg-gray-50 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                    <div className="min-w-0">
                      <p className="text-xs text-gray-500">Asunto</p>
                      <p className="text-sm font-semibold text-gray-900 truncate">{preview.subject}</p>
                    </div>
                    <button onClick={() => setPreview(null)} className="text-xs text-gray-500 hover:text-gray-800 shrink-0">Cerrar ✕</button>
                  </div>
                  <iframe
                    title={`preview-${a.clave}`}
                    srcDoc={preview.html}
                    className="w-full h-[60vh] min-h-[420px] rounded-lg border border-gray-300 bg-white"
                  />
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
