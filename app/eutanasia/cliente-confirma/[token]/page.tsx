'use client'
import { useState } from 'react'
import { useParams } from 'next/navigation'
import { formatDate, formatHoraDia } from '@/lib/dates'

const COLOR = '#143C64'

interface Resultado {
  ok: boolean
  ya_confirmada?: boolean
  error?: string
  mascota_nombre?: string
  vet_nombre?: string
  fecha_servicio?: string
  hora_servicio?: string
}

/**
 * Página pública. El CLIENTE (tutor) llega desde el link "confirma aquí" que
 * recibió por WhatsApp cuando un veterinario tomó su caso. La confirmación se
 * dispara SOLO al apretar el botón (no en el montaje), para que un preview de
 * link en WhatsApp no la confirme sola.
 */
export default function ClienteConfirmaPage() {
  const params = useParams<{ token: string }>()
  const token = params?.token ?? ''
  const [estado, setEstado] = useState<'inicial' | 'enviando' | 'listo'>('inicial')
  const [data, setData] = useState<Resultado | null>(null)

  async function confirmar() {
    setEstado('enviando')
    try {
      const r = await fetch('/api/eutanasias/cotizaciones/cliente-confirmar', {
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
          <p className="text-[11px] uppercase tracking-widest opacity-80">Alma Animal · Eutanasia a domicilio</p>
          <h1 className="text-xl font-bold mt-1">Confirmación de la visita</h1>
        </div>
        <div className="bg-white border border-gray-300 rounded-b-2xl p-6 shadow-md text-center">
          {!token && (
            <>
              <p className="text-5xl mb-3">⚠</p>
              <h2 className="text-lg font-semibold text-gray-900 mb-1">Enlace inválido</h2>
              <p className="text-sm text-gray-600">Falta el token en la URL.</p>
            </>
          )}

          {token && estado !== 'listo' && (
            <div className="py-2">
              <p className="text-5xl mb-3">🐾</p>
              <h2 className="text-xl font-bold text-gray-900 mb-1">Confirma la visita</h2>
              <p className="text-sm text-gray-600 mb-5">
                Si ya coordinaste con el veterinario el día y la hora de la visita,
                confírmalo aquí para que lo dejemos registrado.
              </p>
              <button
                onClick={confirmar}
                disabled={estado === 'enviando'}
                className="w-full px-6 py-3 text-white font-medium rounded-lg disabled:opacity-60 transition-opacity text-base"
                style={{ backgroundColor: COLOR }}
              >
                {estado === 'enviando' ? 'Confirmando…' : 'Sí, confirmo la visita'}
              </button>
            </div>
          )}

          {token && estado === 'listo' && data && !data.ok && (
            <>
              <p className="text-5xl mb-3">⚠</p>
              <h2 className="text-lg font-semibold text-gray-900 mb-1">No pudimos confirmar</h2>
              <p className="text-sm text-gray-600">{data.error}</p>
              <p className="text-xs text-gray-500 mt-4">Si crees que esto es un error, escríbenos por WhatsApp.</p>
            </>
          )}

          {token && estado === 'listo' && data && data.ok && (
            <>
              <p className="text-5xl mb-3">🐾</p>
              <h2 className="text-xl font-bold text-gray-900 mb-1">
                {data.ya_confirmada ? 'Ya habías confirmado la visita' : '¡Visita confirmada!'}
              </h2>
              <p className="text-sm text-gray-600 mt-2">
                Gracias por confirmar. Dejamos registrada la visita
                {data.vet_nombre ? ` con ${data.vet_nombre}` : ''}
                {data.fecha_servicio ? ` para el ${formatDate(data.fecha_servicio)}` : ''}
                {data.hora_servicio ? ` a las ${formatHoraDia(data.hora_servicio)} hs` : ''}.
              </p>
              <p className="text-xs text-gray-500 mt-4">Cualquier duda, escríbenos por WhatsApp. Estamos para acompañarte.</p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
