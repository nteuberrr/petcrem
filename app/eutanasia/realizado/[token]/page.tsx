'use client'
import { useState } from 'react'
import { useParams } from 'next/navigation'
import { fmtPrecio } from '@/lib/format'

const COLOR = '#143C64'

interface Resultado {
  ok: boolean
  ya_realizada?: boolean
  mensaje?: string
  error?: string
  mascota_nombre?: string
  fecha_pago?: string
  precio?: string
}

/**
 * Página pública. Tercer paso del flujo del vet: ya confirmó la cita, realizó
 * el servicio, y desde el correo presiona "Confirma aquí una vez realizado".
 * La mutación (estado → 'realizada' + correo de agradecimiento) se dispara SOLO
 * al apretar el botón, no en el montaje (evita que un prefetch/escáner la marque
 * como realizada sin intención).
 */
export default function RealizadoPage() {
  const params = useParams<{ token: string }>()
  const token = params?.token ?? ''
  const [estado, setEstado] = useState<'inicial' | 'enviando' | 'listo'>('inicial')
  const [data, setData] = useState<Resultado | null>(null)

  async function confirmar() {
    setEstado('enviando')
    try {
      const r = await fetch('/api/eutanasias/cotizaciones/realizado', {
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

  const precioNum = data?.precio ? parseInt(data.precio, 10) || 0 : 0

  return (
    <div className="min-h-screen bg-gray-50 flex items-start justify-center p-4 py-12">
      <div className="w-full max-w-lg">
        <div style={{ backgroundColor: COLOR }} className="text-white px-6 py-5 rounded-t-2xl">
          <p className="text-[11px] uppercase tracking-widest opacity-80">Alma Animal · Convenio Eutanasias</p>
          <h1 className="text-xl font-bold mt-1">Realización del servicio</h1>
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
              <p className="text-5xl mb-3">🙏</p>
              <h2 className="text-xl font-bold text-gray-900 mb-1">¿Ya realizaste el servicio?</h2>
              <p className="text-sm text-gray-600 mb-5">
                Al confirmar, dejamos registrado que el servicio se realizó y agendamos tu pago
                para el día hábil siguiente.
              </p>
              <button
                onClick={confirmar}
                disabled={estado === 'enviando'}
                className="w-full px-6 py-3 text-white font-medium rounded-lg disabled:opacity-60 transition-opacity text-base"
                style={{ backgroundColor: COLOR }}
              >
                {estado === 'enviando' ? 'Registrando…' : 'Sí, ya realicé el servicio'}
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
              <p className="text-5xl mb-3">🙏</p>
              <h2 className="text-xl font-bold text-gray-900 mb-2">
                {data.ya_realizada ? 'Ya habías confirmado este servicio' : '¡Gracias por completar el servicio!'}
              </h2>
              {!data.ya_realizada && data.mascota_nombre && (
                <p className="text-sm text-gray-600 mt-2">
                  Registramos la realización del servicio para <strong>{data.mascota_nombre}</strong>.
                </p>
              )}

              {data.fecha_pago && (
                <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 mt-5 text-left">
                  <p className="text-[11px] uppercase tracking-wider text-emerald-700 font-semibold">Tu pago</p>
                  {precioNum > 0 && (
                    <p className="text-xl font-bold text-gray-900 mt-1">{fmtPrecio(precioNum)}</p>
                  )}
                  <p className="text-sm text-gray-700 mt-1">
                    Recibirás el pago <strong>{data.fecha_pago}</strong> (día hábil siguiente).
                  </p>
                  <p className="text-xs text-gray-500 mt-2">
                    Te enviamos un correo con todos los detalles.
                  </p>
                </div>
              )}

              <p className="text-xs text-gray-500 mt-5">
                Nos pondremos en contacto contigo cuando alguien más necesite nuestro apoyo.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
