'use client'
import { useState } from 'react'
import { useParams } from 'next/navigation'

const COLOR = '#143C64'
const AMBER = '#F2B84B'

interface Resultado { ok: boolean; error?: string; hora?: string; mascota_nombre?: string }

/**
 * Página pública. El VETERINARIO llega desde el link del correo de coordinación
 * e informa la hora acordada con el cliente para el retiro del crematorio.
 */
export default function HoraRetiroPage() {
  const params = useParams<{ token: string }>()
  const token = params?.token ?? ''
  const [hora, setHora] = useState('')
  const [estado, setEstado] = useState<'inicial' | 'enviando' | 'listo'>('inicial')
  const [data, setData] = useState<Resultado | null>(null)

  async function enviar(e: React.FormEvent) {
    e.preventDefault()
    setEstado('enviando')
    try {
      const r = await fetch('/api/eutanasias/cotizaciones/hora-retiro', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, hora }),
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
          <h1 className="text-xl font-bold mt-1">Hora de retiro del crematorio</h1>
        </div>
        <div className="bg-white border border-gray-300 rounded-b-2xl p-6 shadow-md">
          {!token && (
            <p className="text-sm text-gray-600 text-center">Falta el token en la URL.</p>
          )}

          {token && (estado === 'inicial' || estado === 'enviando' || (data && !data.ok)) && (
            <form onSubmit={enviar} className="space-y-4">
              <p className="text-sm text-gray-700 leading-relaxed">
                Indícanos la <strong>hora acordada con el cliente</strong> para que el crematorio pase a retirar a la mascota tras la eutanasia.
              </p>
              <div>
                <label className="block text-sm font-medium text-gray-900 mb-1">Hora de retiro</label>
                <input
                  type="time" required value={hora} onChange={e => setHora(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-base focus:outline-none focus:ring-2 focus:ring-[#143C64]/40"
                />
              </div>
              {data && !data.ok && <p className="text-sm text-red-700">{data.error}</p>}
              <button
                type="submit" disabled={estado === 'enviando'}
                className="w-full px-6 py-3 text-white font-medium rounded-lg disabled:opacity-60 text-base"
                style={{ backgroundColor: COLOR }}
              >
                {estado === 'enviando' ? 'Enviando…' : 'Informar hora'}
              </button>
            </form>
          )}

          {token && estado === 'listo' && data && data.ok && (
            <div className="text-center py-2">
              <p className="text-5xl mb-3">🕒</p>
              <h2 className="text-xl font-bold text-gray-900 mb-1">¡Gracias!</h2>
              <p className="text-sm text-gray-600 mt-2">
                Registramos que el crematorio pasará a las <strong style={{ color: COLOR }}>{data.hora}</strong>
                {data.mascota_nombre ? ` por ${data.mascota_nombre}` : ''}. Coordinamos el retiro con esa hora.
              </p>
              <p className="text-xs text-gray-500 mt-4">Si necesitas cambiarla, vuelve a abrir este mismo enlace.</p>
            </div>
          )}
        </div>
        <div style={{ backgroundColor: AMBER }} className="h-1 rounded-b" />
      </div>
    </div>
  )
}
