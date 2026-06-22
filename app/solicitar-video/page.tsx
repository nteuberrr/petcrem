'use client'
import { useState, useEffect } from 'react'

// ─────────────────────────────────────────────────────────────────────────────
// Landing PÚBLICO para que el tutor solicite el video del proceso (link del correo
// de registro: /solicitar-video?token=XXX). El token (HMAC firmado, válido 24h)
// viene en la URL, se valida y se resuelve el nombre de la mascota. Al confirmar,
// se registra la solicitud en la ficha. Postea a /api/clientes/video.
// ─────────────────────────────────────────────────────────────────────────────

const COLOR = '#143C64'
const AMBER = '#F2B84B'
const CREAM = '#FBF8F3'
const HAIRLINE = '#ece6db'
const LOGO = '/brand/logo-alma-animal.png'
const SELLO = '/brand/sello-alma-animal.png'

export default function SolicitarVideoPage() {
  const [token, setToken] = useState('')
  const [mascota, setMascota] = useState<string | null>(null)
  const [estado, setEstado] = useState<'cargando' | 'ok' | 'invalido' | 'sin_token'>('cargando')
  const [yaPedido, setYaPedido] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState('')
  const [exito, setExito] = useState(false)

  useEffect(() => {
    queueMicrotask(() => {
      const tok = (new URLSearchParams(window.location.search).get('token') || '').trim()
      if (!tok) { setEstado('sin_token'); return }
      setToken(tok)
      fetch(`/api/clientes/video?token=${encodeURIComponent(tok)}`)
        .then(r => r.json())
        .then(d => {
          if (d?.ok) { setMascota(d.nombre_mascota); setYaPedido(!!d.ya); setEstado('ok') }
          else setEstado('invalido')
        })
        .catch(() => setEstado('invalido'))
    })
  }, [])

  async function confirmar() {
    setError('')
    setEnviando(true)
    try {
      const r = await fetch('/api/clientes/video', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token }),
      })
      const d = await r.json().catch(() => ({}))
      if (r.ok && d?.ok) {
        setMascota(d.nombre_mascota || mascota)
        setExito(true)
      } else {
        setError(d?.error || 'No pudimos registrar tu solicitud. Inténtalo de nuevo.')
      }
    } catch {
      setError('Error de red. Verifica tu conexión e inténtalo de nuevo.')
    } finally {
      setEnviando(false)
    }
  }

  const confirmado = exito || yaPedido

  return (
    <div className="min-h-screen" style={{ backgroundColor: CREAM }}>
      <header style={{ backgroundColor: COLOR }} className="text-white py-8 sm:py-10 px-4">
        <div className="max-w-2xl mx-auto flex items-center justify-between gap-4">
          <div>
            <p className="text-[11px] sm:text-xs uppercase tracking-[0.18em] font-bold" style={{ color: AMBER }}>🐾 Crematorio Alma Animal</p>
            <h1 className="text-2xl sm:text-3xl font-bold mt-2">Video del proceso</h1>
            <p className="text-base mt-3 opacity-95">
              Solicita el video del proceso de cremación de tu mascota.
            </p>
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={LOGO} alt="Alma Animal" className="hidden sm:block h-24 w-auto shrink-0" />
        </div>
      </header>
      <div style={{ backgroundColor: AMBER }} className="h-1" />

      <main className="max-w-2xl mx-auto px-4 py-8 sm:py-10">
        {estado === 'cargando' && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 text-center text-gray-500">Cargando…</div>
        )}

        {estado === 'sin_token' && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 text-center text-gray-600">
            El enlace no es válido. Usa el botón que te enviamos por correo.
          </div>
        )}

        {estado === 'invalido' && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 text-center text-gray-600">
            El enlace no es válido o venció. Revisa el correo que te enviamos o escríbenos a{' '}
            <a href="mailto:contacto@crematorioalmaanimal.cl" className="underline" style={{ color: COLOR }}>contacto@crematorioalmaanimal.cl</a>.
          </div>
        )}

        {estado === 'ok' && confirmado && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 text-center">
            <div className="text-5xl mb-3">🎥</div>
            <p className="text-base text-gray-800">
              Registramos que quieres el video del proceso de <strong>{mascota}</strong>. Te lo haremos llegar como parte del servicio.
            </p>
            <p className="text-sm text-gray-500 mt-3">Gracias por confiar en nosotros.</p>
          </div>
        )}

        {estado === 'ok' && !confirmado && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 sm:p-6 space-y-5 text-center">
            <p className="text-base text-gray-800">
              ¿Quieres recibir el <strong>video del proceso</strong> de <strong>{mascota}</strong>?
            </p>
            <p className="text-sm text-gray-500">
              Confírmalo aquí y lo prepararemos como parte de su servicio.
            </p>

            {error && <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">{error}</p>}

            <button
              type="button"
              onClick={confirmar}
              disabled={enviando}
              className="w-full px-6 py-3.5 text-white font-semibold rounded-lg disabled:opacity-60 transition-opacity text-base"
              style={{ backgroundColor: COLOR }}
            >
              {enviando ? 'Enviando…' : 'Sí, quiero el video'}
            </button>
          </div>
        )}

        <footer className="text-center pt-8 mt-8 border-t" style={{ borderColor: HAIRLINE }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={SELLO} alt="Sello Crematorio Alma Animal" className="mx-auto h-20 w-20 mb-3" />
          <p className="text-xs text-gray-500">
            ¿Dudas? Escríbenos a <a href="mailto:contacto@crematorioalmaanimal.cl" className="underline" style={{ color: COLOR }}>contacto@crematorioalmaanimal.cl</a>
          </p>
        </footer>
      </main>
    </div>
  )
}
