'use client'
import { useEffect, useState } from 'react'
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
 * recibió por WhatsApp cuando un veterinario tomó su caso. Al abrirla, confirma
 * que ya coordinó la visita con el veterinario.
 */
export default function ClienteConfirmaPage() {
  const params = useParams<{ token: string }>()
  const token = params?.token ?? ''
  const [estado, setEstado] = useState<'cargando' | 'listo'>('cargando')
  const [data, setData] = useState<Resultado | null>(null)

  useEffect(() => {
    ;(async () => {
      if (!token) {
        setData({ ok: false, error: 'Falta el token en la URL.' })
        setEstado('listo')
        return
      }
      try {
        const r = await fetch('/api/eutanasias/cotizaciones/cliente-confirmar', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        })
        const j = await r.json()
        setData(j)
      } catch {
        setData({ ok: false, error: 'Error de red. Intenta de nuevo.' })
      } finally {
        setEstado('listo')
      }
    })()
  }, [token])

  return (
    <div className="min-h-screen bg-gray-50 flex items-start justify-center p-4 py-12">
      <div className="w-full max-w-lg">
        <div style={{ backgroundColor: COLOR }} className="text-white px-6 py-5 rounded-t-2xl">
          <p className="text-[11px] uppercase tracking-widest opacity-80">Alma Animal · Eutanasia a domicilio</p>
          <h1 className="text-xl font-bold mt-1">Confirmación de la visita</h1>
        </div>
        <div className="bg-white border border-gray-200 rounded-b-2xl p-6 shadow-sm text-center">
          {estado === 'cargando' && <p className="text-gray-500 text-sm py-4">Verificando…</p>}

          {estado === 'listo' && data && !data.ok && (
            <>
              <p className="text-5xl mb-3">⚠</p>
              <h2 className="text-lg font-semibold text-gray-900 mb-1">No pudimos confirmar</h2>
              <p className="text-sm text-gray-600">{data.error}</p>
              <p className="text-xs text-gray-500 mt-4">Si crees que esto es un error, escríbenos por WhatsApp.</p>
            </>
          )}

          {estado === 'listo' && data && data.ok && (
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
