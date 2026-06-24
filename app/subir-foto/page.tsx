'use client'
import { useState, useEffect, useRef } from 'react'

// ─────────────────────────────────────────────────────────────────────────────
// Landing PÚBLICO para que el tutor suba una foto de su mascota (link del correo
// de registro: /subir-foto?token=XXX). El token (HMAC firmado) viene en la URL,
// se valida y se resuelve el nombre de la mascota. Al enviar, la foto se guarda en
// su ficha para incluirla en el certificado de cremación. Postea a /api/clientes/foto.
// ─────────────────────────────────────────────────────────────────────────────

const COLOR = '#143C64'
const AMBER = '#F2B84B'
const CREAM = '#FBF8F3'
const HAIRLINE = '#ece6db'
const LOGO = '/brand/logo-alma-animal.png'
const SELLO = '/brand/sello-alma-animal.png'

export default function SubirFotoPage() {
  const [token, setToken] = useState('')
  const [mascota, setMascota] = useState<string | null>(null)
  const [estadoCodigo, setEstadoCodigo] = useState<'cargando' | 'ok' | 'invalido' | 'sin_token'>('cargando')
  const [foto, setFoto] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState('')
  const [exito, setExito] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    // Diferido a un microtask: la URL solo existe en cliente y así evitamos
    // setState síncrono en el cuerpo del efecto (y mismatch de hidratación).
    queueMicrotask(() => {
      const tok = (new URLSearchParams(window.location.search).get('token') || '').trim()
      if (!tok) { setEstadoCodigo('sin_token'); return }
      setToken(tok)
      fetch(`/api/clientes/foto?token=${encodeURIComponent(tok)}`)
        .then(r => r.json())
        .then(d => {
          if (d?.ok) { setMascota(d.nombre_mascota); setEstadoCodigo('ok') }
          else setEstadoCodigo('invalido')
        })
        .catch(() => setEstadoCodigo('invalido'))
    })
  }, [])

  function elegirFoto(f: File | null) {
    setFoto(f)
    setError('')
    if (preview) URL.revokeObjectURL(preview)
    setPreview(f ? URL.createObjectURL(f) : null)
  }

  async function enviar(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!foto) { setError('Selecciona una foto primero.'); return }
    setEnviando(true)
    try {
      const fd = new FormData()
      fd.append('token', token)
      fd.append('foto', foto)
      const r = await fetch('/api/clientes/foto', { method: 'POST', body: fd })
      const d = await r.json().catch(() => ({}))
      if (r.ok && d?.ok) {
        setMascota(d.nombre_mascota || mascota)
        setExito(true)
      } else {
        setError(d?.error || 'No pudimos subir la foto. Inténtalo de nuevo.')
      }
    } catch {
      setError('Error de red. Verifica tu conexión e inténtalo de nuevo.')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div className="min-h-screen" style={{ backgroundColor: CREAM }}>
      <header style={{ backgroundColor: COLOR }} className="text-white py-8 sm:py-10 px-4">
        <div className="max-w-2xl mx-auto flex items-center justify-between gap-4">
          <div>
            <p className="text-[11px] sm:text-xs uppercase tracking-[0.18em] font-bold" style={{ color: AMBER }}>🐾 Crematorio Alma Animal</p>
            <h1 className="text-2xl sm:text-3xl font-bold mt-2">Foto para el certificado</h1>
            <p className="text-base mt-3 opacity-95">
              Sube una foto de tu mascota y la incluiremos en su certificado de cremación.
            </p>
          </div>
          <img src={LOGO} alt="Alma Animal" className="hidden sm:block h-24 w-auto shrink-0" />
        </div>
      </header>
      <div style={{ backgroundColor: AMBER }} className="h-1" />

      <main className="max-w-2xl mx-auto px-4 py-8 sm:py-10">
        {estadoCodigo === 'cargando' && (
          <div className="bg-white rounded-xl shadow-md border border-gray-300 p-8 text-center text-gray-500">Cargando…</div>
        )}

        {estadoCodigo === 'sin_token' && (
          <div className="bg-white rounded-xl shadow-md border border-gray-300 p-8 text-center text-gray-600">
            El enlace no es válido. Usa el botón que te enviamos por correo.
          </div>
        )}

        {estadoCodigo === 'invalido' && (
          <div className="bg-white rounded-xl shadow-md border border-gray-300 p-8 text-center text-gray-600">
            El enlace no es válido o venció. Revisa el correo que te enviamos o escríbenos a{' '}
            <a href="mailto:contacto@crematorioalmaanimal.cl" className="underline" style={{ color: COLOR }}>contacto@crematorioalmaanimal.cl</a>.
          </div>
        )}

        {estadoCodigo === 'ok' && exito && (
          <div className="bg-white rounded-xl shadow-md border border-gray-300 p-8 text-center">
            <div className="text-5xl mb-3">🐾</div>
            <p className="text-base text-gray-800">
              Hemos recibido la foto de <strong>{mascota}</strong>. La usaremos para incluirla en su certificado de cremación.
            </p>
            <p className="text-sm text-gray-500 mt-3">Gracias por confiar en nosotros.</p>
            <button
              onClick={() => { setExito(false); elegirFoto(null) }}
              className="mt-6 text-sm font-medium underline"
              style={{ color: COLOR }}
            >
              Subir otra foto
            </button>
          </div>
        )}

        {estadoCodigo === 'ok' && !exito && (
          <form onSubmit={enviar} className="bg-white rounded-xl shadow-md border border-gray-300 p-5 sm:p-6 space-y-5">
            <p className="text-sm text-gray-700">
              Foto de <strong>{mascota}</strong>
            </p>

            <input
              ref={inputRef}
              type="file"
              accept="image/jpeg,image/jpg,image/png"
              onChange={e => elegirFoto(e.target.files?.[0] ?? null)}
              className="hidden"
            />

            {preview ? (
              <div className="flex flex-col items-center gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={preview} alt="vista previa" className="max-h-64 rounded-lg border border-gray-300 object-contain" />
                <button type="button" onClick={() => elegirFoto(null)} className="text-sm text-red-600 hover:text-red-800 font-medium">
                  Quitar foto
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                className="w-full border-2 border-dashed rounded-xl py-10 text-center text-gray-500 hover:bg-gray-50 transition-colors"
                style={{ borderColor: HAIRLINE }}
              >
                <span className="block text-3xl mb-2">📷</span>
                <span className="text-sm font-medium">Toca para elegir una foto</span>
                <span className="block text-xs text-gray-400 mt-1">JPG o PNG, hasta 8 MB</span>
              </button>
            )}

            {error && <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">{error}</p>}

            <button
              type="submit"
              disabled={enviando || !foto}
              className="w-full px-6 py-3.5 text-white font-semibold rounded-lg disabled:opacity-60 transition-opacity text-base"
              style={{ backgroundColor: COLOR }}
            >
              {enviando ? 'Enviando…' : 'Enviar foto'}
            </button>
          </form>
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
