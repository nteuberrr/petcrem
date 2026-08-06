'use client'
import { Camera, PawPrint } from 'lucide-react'
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
  // ya = la ficha YA tiene una foto de este tipo. Solo se guarda una: la última
  // pisa a la anterior, así que se lo avisamos antes de que suba otra.
  const [ya, setYa] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const [tipo, setTipo] = useState<'certificado' | 'cuadro'>('certificado')
  // Memorial en redes: opt-in explícito del tutor + una dedicatoria opcional.
  // Solo aplica a la foto del CERTIFICADO (la del cuadro es un producto suyo).
  const [consiente, setConsiente] = useState(false)
  const [comentario, setComentario] = useState('')
  const MAX_COMENTARIO = 280
  const esCuadro = tipo === 'cuadro'

  useEffect(() => {
    // Diferido a un microtask: la URL solo existe en cliente y así evitamos
    // setState síncrono en el cuerpo del efecto (y mismatch de hidratación).
    queueMicrotask(() => {
      const params = new URLSearchParams(window.location.search)
      const tok = (params.get('token') || '').trim()
      const tp = params.get('tipo') === 'cuadro' ? 'cuadro' : 'certificado'
      if (!tok) { setEstadoCodigo('sin_token'); return }
      setToken(tok); setTipo(tp)
      fetch(`/api/clientes/foto?token=${encodeURIComponent(tok)}&tipo=${tp}`)
        .then(r => r.json())
        .then(d => {
          if (d?.ok) {
            setMascota(d.nombre_mascota); setYa(!!d.ya); setEstadoCodigo('ok')
            // Si ya había decidido antes, el formulario vuelve como lo dejó.
            setConsiente(!!d.memorial_consentimiento)
            setComentario(d.memorial_comentario || '')
          }
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
      fd.append('tipo', tipo)
      fd.append('foto', foto)
      if (tipo === 'certificado') {
        fd.append('memorial_consentimiento', consiente ? 'true' : 'false')
        if (consiente) fd.append('memorial_comentario', comentario.trim())
      }
      const r = await fetch('/api/clientes/foto', { method: 'POST', body: fd })
      const d = await r.json().catch(() => ({}))
      if (r.ok && d?.ok) {
        setMascota(d.nombre_mascota || mascota)
        setYa(true)
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
            <p className="text-[11px] sm:text-xs uppercase tracking-[0.18em] font-bold" style={{ color: AMBER }}>Crematorio Alma Animal</p>
            <h1 className="text-2xl sm:text-3xl font-bold mt-2">{esCuadro ? 'Foto para el cuadro' : 'Foto para el certificado'}</h1>
            <p className="text-base mt-3 opacity-95">
              {esCuadro
                ? 'Sube una foto de tu mascota para crear su cuadro conmemorativo en acuarela. Elige una foto nítida y de frente para un mejor retrato.'
                : 'Sube una foto de tu mascota y la incluiremos en su certificado de cremación.'}
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
            <PawPrint className="w-12 h-12 mx-auto mb-3 text-brand" aria-hidden="true" />
            <p className="text-base text-gray-800">
              Hemos recibido la foto de <strong>{mascota}</strong>. {esCuadro
                ? 'La usaremos para crear su cuadro conmemorativo en acuarela.'
                : 'La usaremos para incluirla en su certificado de cremación.'}
            </p>
            <p className="text-sm text-gray-500 mt-3">Gracias por confiar en nosotros.</p>
            <button
              onClick={() => { setExito(false); elegirFoto(null) }}
              className="mt-6 text-sm font-medium underline"
              style={{ color: COLOR }}
            >
              Cambiar la foto
            </button>
            <p className="text-xs text-gray-500 mt-2">Si subes otra, quedará esa como la elegida.</p>
          </div>
        )}

        {estadoCodigo === 'ok' && !exito && (
          <form onSubmit={enviar} className="bg-white rounded-xl shadow-md border border-gray-300 p-5 sm:p-6 space-y-5">
            <p className="text-sm text-gray-700">
              Foto de <strong>{mascota}</strong>
            </p>

            {ya && (
              <p className="text-sm rounded-lg p-3 border" style={{ backgroundColor: '#FDF6E7', borderColor: AMBER, color: '#7a5a12' }}>
                Ya has subido una imagen. Si subes una nueva, <strong>esta quedará como la elegida</strong> y reemplazará a la anterior.
              </p>
            )}

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
                <Camera className="w-8 h-8 mx-auto mb-2 text-gray-400" aria-hidden="true" />
                <span className="text-sm font-medium">Toca para elegir una foto</span>
                <span className="block text-xs text-gray-400 mt-1">JPG o PNG, hasta 8 MB</span>
              </button>
            )}

            {/* MEMORIAL EN REDES: permiso opcional, nunca marcado por defecto.
                Solo para la foto del certificado; la del cuadro es un producto
                que se le entrega al tutor y no se publica. */}
            {tipo === 'certificado' && (
              <div className="rounded-xl border p-4" style={{ borderColor: HAIRLINE, backgroundColor: '#FBF8F3' }}>
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={consiente}
                    onChange={e => setConsiente(e.target.checked)}
                    className="mt-1 h-5 w-5 shrink-0 rounded border-gray-400 cursor-pointer"
                    style={{ accentColor: COLOR }}
                  />
                  <span className="text-sm text-gray-700 leading-relaxed">
                    Autorizo a Crematorio Alma Animal a publicar esta foto
                    {mascota ? <> de <strong>{mascota}</strong></> : null} en un
                    homenaje en sus redes sociales.
                    <span className="block text-xs text-gray-500 mt-1">
                      Es opcional y no afecta en nada al servicio. Si no lo marcas, la foto se usa
                      únicamente para el certificado.
                    </span>
                  </span>
                </label>

                {consiente && (
                  <div className="mt-4">
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">
                      ¿Quieres dedicarle unas palabras? <span className="text-gray-400 font-normal">(opcional)</span>
                    </label>
                    <textarea
                      value={comentario}
                      onChange={e => setComentario(e.target.value.slice(0, MAX_COMENTARIO))}
                      rows={3}
                      placeholder={mascota ? `Algo que quieras recordar de ${mascota}…` : 'Algo que quieras recordar…'}
                      className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2"
                      style={{ borderColor: HAIRLINE }}
                    />
                    <p className="text-xs text-gray-400 mt-1 text-right">
                      {comentario.length}/{MAX_COMENTARIO}
                    </p>
                  </div>
                )}
              </div>
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
