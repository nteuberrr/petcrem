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
 * 24h). Confirmar/Rechazar dispara el mismo flujo (ficha borrador + aviso al cliente).
 * Se refresca solo cada 30s.
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
    <div className="mb-5 rounded-2xl border-2 border-amber-300 bg-amber-50 shadow-md overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 bg-amber-100 border-b border-amber-200">
        <span className="text-lg">🔔</span>
        <h2 className="text-sm font-bold text-amber-900">
          Solicitudes de retiro pendientes{items.length > 0 ? ` (${items.length})` : ''}
        </h2>
      </div>

      {feedback && (
        <div className="px-4 py-2 text-xs font-medium text-amber-900 bg-amber-100/70 border-b border-amber-200">{feedback}</div>
      )}

      {items.length === 0 ? (
        <div className="px-4 py-3 text-sm text-amber-800">No quedan solicitudes pendientes.</div>
      ) : (
        <ul className="divide-y divide-amber-200">
          {items.map(s => {
            const esVet = s.origen === 'bot_vet' || !!s.vet_nombre
            return (
              <li key={s.id} className="px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-3">
                <div className="flex-1 min-w-0 text-sm text-gray-800">
                  <p className="font-semibold text-gray-900">
                    {s.nombre_mascota || '—'}{s.peso ? ` · ${s.peso} kg` : ''}
                    {s.tipo_servicio ? <span className="ml-2 text-xs font-medium text-amber-800">{SERVICIO[s.tipo_servicio] || s.tipo_servicio}</span> : null}
                  </p>
                  <p className="text-gray-700">
                    {esVet ? <span className="font-medium">🏥 {s.vet_nombre || 'Veterinario'} · </span> : null}
                    {s.cliente_nombre || '—'}
                    {s.cliente_wa_id ? <span className="text-gray-400"> · +{s.cliente_wa_id}</span> : null}
                  </p>
                  <p className="text-gray-600 text-xs mt-0.5">
                    📍 {[s.direccion, s.comuna].filter(Boolean).join(', ') || '—'}
                    {'   '}🗓 {s.fecha_retiro ? fmtFecha(s.fecha_retiro) : '—'}{s.hora_retiro ? ` ${s.hora_retiro}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => resolver(s.id, 'confirmar')}
                    disabled={resolviendo === s.id}
                    className="bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50"
                  >
                    {resolviendo === s.id ? '…' : '✅ Confirmar'}
                  </button>
                  <button
                    onClick={() => resolver(s.id, 'rechazar')}
                    disabled={resolviendo === s.id}
                    className="border-2 border-red-300 text-red-700 hover:bg-red-50 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50"
                  >
                    ❌ Rechazar
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
