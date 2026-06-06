'use client'
import { useEffect, useState } from 'react'
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
 * Acá hacemos POST al backend, se marca la cotización como 'realizada' y
 * se dispara el correo de agradecimiento con la fecha de pago.
 */
export default function RealizadoPage() {
  const params = useParams<{ token: string }>()
  const token = params?.token ?? ''
  const [estado, setEstado] = useState<'cargando' | 'listo'>('cargando')
  const [data, setData] = useState<Resultado | null>(null)

  useEffect(() => {
    if (!token) {
      setData({ ok: false, error: 'Falta el token en la URL.' })
      setEstado('listo')
      return
    }
    ;(async () => {
      try {
        const r = await fetch('/api/eutanasias/cotizaciones/realizado', {
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

  const precioNum = data?.precio ? parseInt(data.precio, 10) || 0 : 0

  return (
    <div className="min-h-screen bg-gray-50 flex items-start justify-center p-4 py-12">
      <div className="w-full max-w-lg">
        <div style={{ backgroundColor: COLOR }} className="text-white px-6 py-5 rounded-t-2xl">
          <p className="text-[11px] uppercase tracking-widest opacity-80">Alma Animal · Convenio Eutanasias</p>
          <h1 className="text-xl font-bold mt-1">Realización del servicio</h1>
        </div>
        <div className="bg-white border border-gray-200 rounded-b-2xl p-6 shadow-sm text-center">
          {estado === 'cargando' && <p className="text-gray-500 text-sm py-4">Verificando…</p>}

          {estado === 'listo' && data && !data.ok && (
            <>
              <p className="text-5xl mb-3">⚠</p>
              <h2 className="text-lg font-semibold text-gray-900 mb-1">No pudimos confirmar</h2>
              <p className="text-sm text-gray-600">{data.error}</p>
              <p className="text-xs text-gray-500 mt-4">Si crees que esto es un error, escríbenos a info@crematorioalmaanimal.cl.</p>
            </>
          )}

          {estado === 'listo' && data && data.ok && (
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
