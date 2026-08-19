'use client'
import { Clock } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'

const COLOR = '#143C64'
const AMBER = '#F2B84B'

interface Resultado {
  ok: boolean; error?: string
  hora?: string; fecha?: string; fecha_cambio?: boolean
  hora_retiro?: string; mascota_nombre?: string
}

/** "2026-08-19" → "19-08-2026" (la fecha ya viene ISO del servidor). */
function fmt(iso?: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '')
  return m ? `${m[3]}-${m[2]}-${m[1]}` : (iso || '')
}

/**
 * Página pública. El VETERINARIO llega desde el link del correo de coordinación
 * e informa el DÍA y la HORA que acordó con la familia.
 *
 * El día se pregunta además de la hora (dueño 2026-08-18): al coordinar con la
 * familia el servicio a veces se corre de fecha, y guardando solo la hora la
 * eutanasia quedaba agendada el día equivocado. Viene prellenado con lo que ya
 * está agendado, así el caso normal sigue siendo un solo toque.
 */
export default function HoraRetiroPage() {
  const params = useParams<{ token: string }>()
  const token = params?.token ?? ''
  const [hora, setHora] = useState('')
  const [fecha, setFecha] = useState('')
  const [mascota, setMascota] = useState('')
  const [estado, setEstado] = useState<'inicial' | 'enviando' | 'listo'>('inicial')
  const [data, setData] = useState<Resultado | null>(null)

  // Prellenado con lo agendado: el vet solo cambia lo que de verdad se movió.
  useEffect(() => {
    if (!token) return
    let vivo = true
    fetch(`/api/eutanasias/cotizaciones/hora-retiro?token=${encodeURIComponent(token)}`)
      .then(r => r.json())
      .then((d: { ok?: boolean; fecha?: string; hora?: string; mascota_nombre?: string }) => {
        if (!vivo || !d?.ok) return
        if (d.fecha) setFecha(d.fecha)
        if (d.hora) setHora(d.hora)
        if (d.mascota_nombre) setMascota(d.mascota_nombre)
      })
      .catch(() => { /* el formulario funciona igual vacío */ })
    return () => { vivo = false }
  }, [token])

  async function enviar(e: React.FormEvent) {
    e.preventDefault()
    setEstado('enviando')
    try {
      const r = await fetch('/api/eutanasias/cotizaciones/hora-retiro', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, fecha, hora }),
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
          <h1 className="text-xl font-bold mt-1">Día y hora del procedimiento</h1>
        </div>
        <div className="bg-white border border-gray-300 rounded-b-2xl p-6 shadow-md">
          {!token && (
            <p className="text-sm text-gray-600 text-center">Falta el token en la URL.</p>
          )}

          {token && (estado === 'inicial' || estado === 'enviando' || (data && !data.ok)) && (
            <form onSubmit={enviar} className="space-y-4">
              <p className="text-sm text-gray-700 leading-relaxed">
                Indícanos el <strong>día y la hora del procedimiento</strong> que acordaste con la familia
                {mascota ? <> de <strong>{mascota}</strong></> : null}. Con eso agendamos el retiro: nuestro chofer pasa a buscar a la mascota <strong>30 minutos después</strong>.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-900 mb-1">Día acordado</label>
                  <input
                    type="date" required value={fecha} onChange={e => setFecha(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-base focus:outline-none focus:ring-2 focus:ring-[#143C64]/40"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-900 mb-1">Hora acordada</label>
                  <input
                    type="time" required value={hora} onChange={e => setHora(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-base focus:outline-none focus:ring-2 focus:ring-[#143C64]/40"
                  />
                </div>
              </div>
              <p className="text-xs text-gray-500">
                Vienen prellenados con lo que quedó agendado. Si el servicio se movió de día, cámbialo aquí.
              </p>
              {data && !data.ok && <p className="text-sm text-red-700">{data.error}</p>}
              <button
                type="submit" disabled={estado === 'enviando'}
                className="w-full px-6 py-3 text-white font-medium rounded-lg disabled:opacity-60 text-base"
                style={{ backgroundColor: COLOR }}
              >
                {estado === 'enviando' ? 'Enviando…' : 'Informar día y hora'}
              </button>
            </form>
          )}

          {token && estado === 'listo' && data && data.ok && (
            <div className="text-center py-2">
              <Clock className="w-12 h-12 mx-auto mb-3 text-brand" aria-hidden="true" />
              <h2 className="text-xl font-bold text-gray-900 mb-1">¡Gracias!</h2>
              <p className="text-sm text-gray-600 mt-2">
                Registramos el procedimiento
                {data.mascota_nombre ? <> de <strong>{data.mascota_nombre}</strong></> : null} para el{' '}
                <strong style={{ color: COLOR }}>{fmt(data.fecha)}</strong> a las{' '}
                <strong style={{ color: COLOR }}>{data.hora}</strong>.
                {data.hora_retiro ? <> Nuestro chofer pasará a retirar a la mascota a las <strong style={{ color: COLOR }}>{data.hora_retiro}</strong> (30 minutos después).</> : ' Nuestro chofer pasará a retirar a la mascota 30 minutos después.'}
              </p>
              {data.fecha_cambio && (
                <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-3">
                  Anotamos también el cambio de día: movimos la agenda y avisamos a la familia.
                </p>
              )}
              <p className="text-xs text-gray-500 mt-4">Si necesitas cambiarlo, vuelve a abrir este mismo enlace.</p>
            </div>
          )}
        </div>
        <div style={{ backgroundColor: AMBER }} className="h-1 rounded-b" />
      </div>
    </div>
  )
}
