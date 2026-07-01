'use client'
import { useState, useEffect, useCallback } from 'react'
import { fmtFecha } from '@/lib/format'

type Solicitud = {
  id: string; cliente_nombre: string; nombre_mascota: string; peso: string
  direccion: string; comuna: string; fecha_retiro: string; hora_retiro: string
  tipo_servicio: string; origen: string; vet_nombre: string; cliente_wa_id: string
}

const SERVICIO: Record<string, string> = { CI: 'Individual', CP: 'Premium', SD: 'Sin Devolución' }

/**
 * Panel de solicitudes de retiro del bot pendientes de confirmación. Es el canal
 * CONFIABLE de aviso (los botones de WhatsApp solo llegan dentro de la ventana de
 * 24h). Se muestra en el DASHBOARD como una grilla de cuadrados que se acumulan
 * hacia la derecha. Confirmar/Rechazar dispara el mismo flujo que el botón de
 * WhatsApp (ficha borrador + aviso al cliente). Se refresca solo cada 30s.
 */
export default function SolicitudesPendientes() {
  const [items, setItems] = useState<Solicitud[]>([])
  const [cargado, setCargado] = useState(false)
  const [resolviendo, setResolviendo] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<string>('')

  const cargar = useCallback(async () => {
    try {
      const r = await fetch('/api/solicitudes-retiro', { cache: 'no-store' })
      if (!r.ok) return
      const d = await r.json()
      setItems(Array.isArray(d) ? d : [])
    } catch { /* red: reintenta en el próximo tick */ } finally { setCargado(true) }
  }, [])

  useEffect(() => {
    cargar()
    const t = setInterval(cargar, 30000)
    return () => clearInterval(t)
  }, [cargar])

  async function resolver(id: string, accion: 'confirmar' | 'rechazar') {
    if (accion === 'rechazar' && !confirm('¿Rechazar esta solicitud? Se le avisará al cliente que un agente lo contactará.')) return
    setResolviendo(id)
    setFeedback('')
    try {
      const r = await fetch('/api/solicitudes-retiro', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, accion }),
      })
      const d = await r.json().catch(() => ({}))
      setFeedback(d?.acuseAdmin || (r.ok ? 'Listo.' : d?.error || 'No se pudo procesar.'))
      await cargar()
    } catch {
      setFeedback('Error de red. Intenta de nuevo.')
    } finally {
      setResolviendo(null)
    }
  }

  if (!cargado || (items.length === 0 && !feedback)) return null

  return (
    <div className="mb-4">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-lg">🔔</span>
        <h2 className="text-sm font-bold text-gray-800">
          Solicitudes de retiro pendientes{items.length > 0 ? ` (${items.length})` : ''}
        </h2>
      </div>

      {feedback && (
        <div className="mb-2 rounded-lg px-3 py-2 text-xs font-medium text-amber-900 bg-amber-100 border border-amber-200">{feedback}</div>
      )}

      {items.length === 0 ? (
        <p className="text-sm text-gray-400">No quedan solicitudes pendientes.</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5 gap-3">
          {items.map(s => {
            const esVet = s.origen === 'bot_vet' || !!s.vet_nombre
            return (
              <div
                key={s.id}
                className="rounded-xl border-2 border-amber-300 bg-amber-50 shadow-sm p-3 flex flex-col justify-between gap-2 min-h-[150px]"
              >
                <div className="min-w-0">
                  <div className="flex items-center justify-between gap-1">
                    <p className="font-bold text-gray-900 text-sm truncate">{s.nombre_mascota || '—'}</p>
                    {s.tipo_servicio && (
                      <span className="text-[10px] font-semibold text-amber-800 bg-amber-100 border border-amber-200 px-1.5 py-0.5 rounded shrink-0">
                        {SERVICIO[s.tipo_servicio] || s.tipo_servicio}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-700 truncate mt-0.5">
                    {esVet ? '🏥 ' : ''}{esVet ? (s.vet_nombre || 'Veterinario') : (s.cliente_nombre || '—')}
                  </p>
                  {s.peso && <p className="text-[11px] text-gray-500">{s.peso} kg</p>}
                  <p className="text-[11px] text-gray-500 mt-1 leading-tight truncate">📍 {[s.direccion, s.comuna].filter(Boolean).join(', ') || '—'}</p>
                  <p className="text-[11px] text-gray-500 leading-tight">🗓 {s.fecha_retiro ? fmtFecha(s.fecha_retiro) : '—'}{s.hora_retiro ? ` · ${s.hora_retiro}` : ''}</p>
                </div>
                <div className="flex gap-1.5">
                  <button
                    onClick={() => resolver(s.id, 'confirmar')}
                    disabled={resolviendo === s.id}
                    title="Confirmar retiro"
                    className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white py-1.5 rounded-lg text-[11px] font-semibold transition-colors disabled:opacity-50"
                  >
                    {resolviendo === s.id ? '…' : '✅ Confirmar'}
                  </button>
                  <button
                    onClick={() => resolver(s.id, 'rechazar')}
                    disabled={resolviendo === s.id}
                    title="Rechazar"
                    className="bg-white border-2 border-red-300 text-red-700 hover:bg-red-50 px-2 py-1.5 rounded-lg text-[11px] font-semibold transition-colors disabled:opacity-50"
                  >
                    ❌
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
