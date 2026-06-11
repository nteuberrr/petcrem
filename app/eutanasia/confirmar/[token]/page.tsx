'use client'
import { useState } from 'react'
import { useParams } from 'next/navigation'
import { formatDate, formatHoraDia } from '@/lib/dates'

const COLOR = '#143C64'

interface Resultado {
  ok: boolean
  ya_confirmada?: boolean
  mensaje?: string
  error?: string
  mascota_nombre?: string
  cliente_nombre?: string
  fecha_servicio?: string
  hora_servicio?: string
}

/**
 * Página pública. Segundo paso del flujo del vet: ya aceptó y habló con el
 * cliente; ahora confirma que va a realizar el servicio. La mutación (estado →
 * 'confirmada') se dispara SOLO al apretar el botón, no en el montaje (evita que
 * un prefetch/escáner de links confirme sin intención).
 */
export default function ConfirmarPage() {
  const params = useParams<{ token: string }>()
  const token = params?.token ?? ''
  const [estado, setEstado] = useState<'inicial' | 'enviando' | 'listo'>('inicial')
  const [data, setData] = useState<Resultado | null>(null)

  async function confirmar() {
    setEstado('enviando')
    try {
      const r = await fetch('/api/eutanasias/cotizaciones/confirmar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      })
      setData(await r.json())
    } catch {
      setData({ ok: false, error: 'Error de red. Intenta de nuevo.' })
    } finally {
      setEstado('listo')
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-start justify-center p-4 py-12">
      <div className="w-full max-w-lg">
        <div style={{ backgroundColor: COLOR }} className="text-white px-6 py-5 rounded-t-2xl">
          <p className="text-[11px] uppercase tracking-widest opacity-80">Alma Animal · Convenio Eutanasias</p>
          <h1 className="text-xl font-bold mt-1">Confirmación del servicio</h1>
        </div>
        <div className="bg-white border border-gray-200 rounded-b-2xl p-6 shadow-sm text-center">
          {!token && (
            <>
              <p className="text-5xl mb-3">⚠</p>
              <h2 className="text-lg font-semibold text-gray-900 mb-1">Enlace inválido</h2>
              <p className="text-sm text-gray-600">Falta el token en la URL.</p>
            </>
          )}

          {token && estado !== 'listo' && (
            <div className="py-2">
              <p className="text-5xl mb-3">✅</p>
              <h2 className="text-xl font-bold text-gray-900 mb-1">¿Confirmas el servicio?</h2>
              <p className="text-sm text-gray-600 mb-5">
                Al confirmar, dejamos registrado que vas a realizar esta eutanasia a domicilio.
                Después te enviamos el último link para marcarla como realizada.
              </p>
              <button
                onClick={confirmar}
                disabled={estado === 'enviando'}
                className="w-full px-6 py-3 text-white font-medium rounded-lg disabled:opacity-60 transition-opacity text-base"
                style={{ backgroundColor: COLOR }}
              >
                {estado === 'enviando' ? 'Confirmando…' : 'Confirmar el servicio'}
              </button>
            </div>
          )}

          {token && estado === 'listo' && data && !data.ok && (
            <>
              <p className="text-5xl mb-3">⚠</p>
              <h2 className="text-lg font-semibold text-gray-900 mb-1">No pudimos confirmar</h2>
              <p className="text-sm text-gray-600">{data.error}</p>
              <p className="text-xs text-gray-500 mt-4">Si crees que esto es un error, escríbenos a info@crematorioalmaanimal.cl.</p>
            </>
          )}

          {token && estado === 'listo' && data && data.ok && (
            <>
              <p className="text-5xl mb-3">✅</p>
              <h2 className="text-xl font-bold text-gray-900 mb-1">
                {data.ya_confirmada ? 'Ya habías confirmado este servicio' : '¡Servicio confirmado!'}
              </h2>
              <p className="text-sm text-gray-600 mt-2">
                {data.ya_confirmada
                  ? data.mensaje
                  : `Confirmaste el servicio para ${data.mascota_nombre} (${data.cliente_nombre}) el ${formatDate(data.fecha_servicio || '')} a las ${formatHoraDia(data.hora_servicio)} hs.`}
              </p>
              <p className="text-xs text-gray-500 mt-4">Gracias por sumarte al convenio. Cualquier cosa, escríbenos a info@crematorioalmaanimal.cl.</p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
