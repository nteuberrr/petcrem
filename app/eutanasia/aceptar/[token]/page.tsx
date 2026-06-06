'use client'
import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { formatDate, formatHoraDia } from '@/lib/dates'

const COLOR = '#143C64'

interface Resultado {
  ok: boolean
  ya_aceptada?: boolean
  mensaje?: string
  error?: string
  cliente_nombre?: string
  cliente_telefono?: string
  cliente_email?: string
  mascota_nombre?: string
  direccion?: string
  comuna?: string
  fecha_servicio?: string
  hora_servicio?: string
}

/**
 * Página pública. El vet llega acá desde el link del email. La página
 * confirma el token vía POST y muestra el resultado: datos del cliente
 * + instrucción para contactarlo, o un mensaje de error/expiración.
 */
export default function AceptarPage() {
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
        const r = await fetch('/api/eutanasias/cotizaciones/aceptar', {
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
          <p className="text-[11px] uppercase tracking-widest opacity-80">Alma Animal · Convenio Eutanasias</p>
          <h1 className="text-xl font-bold mt-1">Confirmación de disponibilidad</h1>
        </div>
        <div className="bg-white border border-gray-200 rounded-b-2xl p-6 shadow-sm">
          {estado === 'cargando' && <p className="text-gray-500 text-sm">Verificando…</p>}

          {estado === 'listo' && data && !data.ok && (
            <div className="text-center py-6">
              <p className="text-5xl mb-3">⚠</p>
              <h2 className="text-lg font-semibold text-gray-900 mb-1">No pudimos confirmar</h2>
              <p className="text-sm text-gray-600">{data.error}</p>
              <p className="text-xs text-gray-500 mt-4">Si crees que esto es un error, escríbenos a info@crematorioalmaanimal.cl.</p>
            </div>
          )}

          {estado === 'listo' && data && data.ok && data.ya_aceptada && (
            <div className="text-center py-4">
              <p className="text-4xl mb-3">✓</p>
              <h2 className="text-lg font-semibold text-gray-900 mb-1">Ya habías confirmado</h2>
              <p className="text-sm text-gray-600 mb-4">{data.mensaje}</p>
              <DatosCliente data={data} />
            </div>
          )}

          {estado === 'listo' && data && data.ok && !data.ya_aceptada && (
            <div>
              <div className="text-center mb-5">
                <p className="text-5xl mb-2">🤝</p>
                <h2 className="text-xl font-bold text-gray-900">¡Gracias por tomar el caso!</h2>
                <p className="text-sm text-gray-600 mt-1">Te enviamos un correo con un link de confirmación final. Antes, contacta a la familia.</p>
              </div>
              <DatosCliente data={data} />
              <p className="text-xs text-gray-500 mt-4 text-center">
                Si después de hablar con la familia no puedes tomar el caso, ignora el correo de confirmación que acabamos de enviarte.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function DatosCliente({ data }: { data: Resultado }) {
  if (!data.cliente_nombre) return null
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${data.direccion}, ${data.comuna}, Chile`)}`
  return (
    <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 mt-3 text-left">
      <p className="text-[11px] uppercase tracking-wider text-slate-500 mb-2">Contacto del cliente</p>
      <p className="text-base font-semibold text-slate-900">{data.cliente_nombre}</p>
      {data.cliente_telefono && (
        <p className="text-sm mt-1">
          <a href={`tel:+56${data.cliente_telefono}`} style={{ color: COLOR }}>+56 {data.cliente_telefono}</a>
        </p>
      )}
      {data.cliente_email && <p className="text-xs text-slate-600 mt-0.5">{data.cliente_email}</p>}
      <hr className="my-3 border-slate-200" />
      <p className="text-[11px] uppercase tracking-wider text-slate-500 mb-1">Servicio</p>
      <p className="text-sm text-slate-900">{data.mascota_nombre} · {formatDate(data.fecha_servicio || '')} {formatHoraDia(data.hora_servicio)} hs</p>
      <p className="text-sm mt-1">
        <a href={mapsUrl} target="_blank" rel="noreferrer" style={{ color: COLOR }} className="underline">
          {data.direccion}, {data.comuna} (mapa)
        </a>
      </p>
    </div>
  )
}
