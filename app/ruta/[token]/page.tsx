'use client'
import { use, useCallback, useEffect, useRef, useState } from 'react'
import { Check, MapPin, Phone, Navigation, PawPrint, Loader2, Camera, X, Clock } from 'lucide-react'

// ─────────────────────────────────────────────────────────────────────────────
// HOJA DE RUTA del repartidor — página PÚBLICA (sin sesión) que se abre con el
// link firmado que genera Operaciones → Despachos ("Compartir con el delivery").
//
// Pensada para usarse con una mano, en la calle y con el celular: parada por
// parada, cada una con lo mismo que dice la etiqueta pegada en el ánfora
// (código, mascota, tutor, dirección, teléfono), acciones grandes para llamar,
// abrir el mapa o sacar una foto, y un botón de "Entregada" que hace EXACTAMENTE
// lo mismo que si el equipo lo marcara desde el sistema: avisa al tutor, al
// veterinario y publica la despedida si el tutor la autorizó.
//
// Las fotos se achican ACÁ antes de subirlas (lado largo 1600 px, JPEG 0.8): una
// foto de celular pesa varios MB y el repartidor está con datos móviles.
//
// Deliberadamente NO hay "deshacer": el correo ya salió. Si se marca por error,
// lo corrige el equipo.
// ─────────────────────────────────────────────────────────────────────────────

const COLOR = '#143C64'
const AMBER = '#F2B84B'
const CREAM = '#FBF8F3'
const LOGO = '/brand/logo-alma-animal.png'

const MAX_FOTOS = 5
const LADO_MAX = 1600

interface Parada {
  cliente_id: string
  orden: number
  codigo: string
  nombre_mascota: string
  nombre_tutor: string
  direccion: string
  telefono: string
  telefono_legible: string
  entregada: boolean
  entregada_hora: string
  fotos: string[]
}

interface Ruta {
  numero_recorrido: string
  fecha: string
  estado_ruta: string
  nota: string
  origen_direccion: string
  destino_direccion: string
  paradas: Parada[]
}

/** "2026-08-07T18:04:12.000Z" → "18:04" en hora de Chile. */
function horaCorta(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  return d.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Santiago' })
}

function mapsUrl(direccion: string): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(direccion)}`
}

/** Reduce la foto en el navegador para que la subida no dependa de la señal. */
async function achicar(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file)
  const escala = Math.min(1, LADO_MAX / Math.max(bitmap.width, bitmap.height))
  const w = Math.round(bitmap.width * escala)
  const h = Math.round(bitmap.height * escala)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) return file
  ctx.drawImage(bitmap, 0, 0, w, h)
  bitmap.close?.()
  const blob = await new Promise<Blob | null>(res => canvas.toBlob(res, 'image/jpeg', 0.8))
  return blob ?? file
}

export default function HojaDeRutaPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params)
  const [ruta, setRuta] = useState<Ruta | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [marcando, setMarcando] = useState('')
  /** Parada que espera el segundo toque de confirmación. */
  const [confirmar, setConfirmar] = useState('')
  /** Fotos ya subidas a R2 pero todavía no asociadas (parada aún sin entregar). */
  const [pendientesFoto, setPendientesFoto] = useState<Record<string, string[]>>({})
  const [subiendo, setSubiendo] = useState('')
  const inputs = useRef<Record<string, HTMLInputElement | null>>({})

  const cargar = useCallback(async () => {
    try {
      const r = await fetch(`/api/rutas/${token}`, { cache: 'no-store' })
      const d = await r.json()
      if (!r.ok) { setError(d?.error || 'No pudimos cargar la ruta.'); return }
      setRuta(d.ruta)
    } catch {
      setError('Sin conexión. Revisa tus datos e inténtalo de nuevo.')
    } finally {
      setCargando(false)
    }
  }, [token])

  // Carga inicial (mismo patrón que el resto de las pantallas del sistema).
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { cargar() }, [cargar])

  /** Sube la foto apenas se elige: si el repartidor cierra la app, no se pierde. */
  async function subirFoto(p: Parada, file: File) {
    setSubiendo(p.cliente_id)
    setError('')
    try {
      const blob = await achicar(file)
      const fd = new FormData()
      fd.append('cliente_id', p.cliente_id)
      fd.append('foto', new File([blob], 'entrega.jpg', { type: 'image/jpeg' }))
      const r = await fetch(`/api/rutas/${token}/foto`, { method: 'POST', body: fd })
      const d = await r.json()
      if (!r.ok || !d.url) { setError(d?.error || 'No pudimos subir la foto.'); return }

      if (p.entregada) {
        // Ya entregada: se adjunta de una, sin volver a avisarle al tutor.
        const r2 = await fetch(`/api/rutas/${token}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cliente_id: p.cliente_id, fotos: [d.url], solo_fotos: true }),
        })
        const d2 = await r2.json()
        if (!r2.ok) { setError(d2?.error || 'La foto se subió pero no quedó guardada.'); return }
        if (d2.ruta) setRuta(d2.ruta)
      } else {
        // Todavía no entregada: queda en espera y viaja con la entrega.
        setPendientesFoto(f => ({ ...f, [p.cliente_id]: [...(f[p.cliente_id] ?? []), d.url].slice(0, MAX_FOTOS) }))
      }
    } catch {
      setError('No pudimos subir la foto. Revisa tu conexión.')
    } finally {
      setSubiendo('')
    }
  }

  async function entregar(p: Parada) {
    setMarcando(p.cliente_id)
    setError('')
    try {
      const r = await fetch(`/api/rutas/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cliente_id: p.cliente_id, fotos: pendientesFoto[p.cliente_id] ?? [] }),
      })
      const d = await r.json()
      if (!r.ok) { setError(d?.error || 'No pudimos registrar la entrega.'); return }
      if (d.ruta) setRuta(d.ruta)
      setPendientesFoto(f => { const n = { ...f }; delete n[p.cliente_id]; return n })
      setConfirmar('')
    } catch {
      setError('Sin conexión. La entrega no se registró: inténtalo de nuevo.')
    } finally {
      setMarcando('')
    }
  }

  const total = ruta?.paradas.length ?? 0
  const listas = ruta?.paradas.filter(p => p.entregada).length ?? 0
  const pendientes = total - listas
  const completa = total > 0 && pendientes === 0

  return (
    <div className="min-h-screen pb-10" style={{ backgroundColor: CREAM }}>
      {/* Cabecera de marca */}
      <header style={{ backgroundColor: COLOR }} className="text-white px-4 pt-5 pb-4">
        <div className="max-w-xl mx-auto">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-[0.18em] font-bold" style={{ color: AMBER }}>
                Crematorio Alma Animal
              </p>
              <h1 className="text-xl font-bold mt-1">Hoja de ruta</h1>
              {ruta && (
                <p className="text-xs mt-0.5 opacity-90">
                  Recorrido N° {ruta.numero_recorrido}{ruta.fecha ? ` · ${ruta.fecha}` : ''}
                </p>
              )}
            </div>
            <img src={LOGO} alt="" className="h-12 w-auto shrink-0 opacity-95" />
          </div>

          {ruta && total > 0 && (
            <div className="mt-4">
              <div className="flex items-baseline justify-between text-xs font-semibold">
                <span>{listas} de {total} entregadas</span>
                <span style={{ color: AMBER }}>{pendientes} {pendientes === 1 ? 'pendiente' : 'pendientes'}</span>
              </div>
              <div className="mt-1.5 h-1.5 w-full rounded-full bg-white/20 overflow-hidden">
                <div className="h-full rounded-full transition-all duration-500"
                  style={{ width: `${Math.round((listas / total) * 100)}%`, backgroundColor: AMBER }} />
              </div>
            </div>
          )}
        </div>
      </header>
      <div style={{ backgroundColor: AMBER }} className="h-1" />

      <main className="max-w-xl mx-auto px-3 py-4 space-y-3">
        {cargando && (
          <div className="rounded-2xl border border-gray-300 bg-white p-10 text-center text-gray-500 shadow-sm">
            <Loader2 className="w-6 h-6 mx-auto mb-3 animate-spin" aria-hidden="true" />
            Cargando la ruta…
          </div>
        )}

        {!cargando && error && !ruta && (
          <div className="rounded-2xl border border-gray-300 bg-white p-8 text-center shadow-sm">
            <PawPrint className="w-10 h-10 mx-auto mb-3" style={{ color: COLOR }} aria-hidden="true" />
            <p className="text-base font-semibold" style={{ color: COLOR }}>{error}</p>
            <p className="text-sm text-gray-500 mt-2">Escríbenos y te enviamos un enlace nuevo.</p>
          </div>
        )}

        {ruta && (
          <>
            {error && (
              <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-800">{error}</p>
            )}

            {completa && (
              <div className="rounded-2xl border-2 px-4 py-3 text-center shadow-sm"
                style={{ borderColor: AMBER, backgroundColor: '#FDF6E7' }}>
                <p className="text-sm font-bold" style={{ color: COLOR }}>
                  <Check className="w-4 h-4 inline-block align-[-3px] mr-1" aria-hidden="true" />
                  Ruta completa · gracias
                </p>
              </div>
            )}

            {ruta.nota && (
              <p className="rounded-xl border border-gray-300 bg-white px-3 py-2 text-xs text-gray-700 shadow-sm">
                <span className="font-semibold" style={{ color: COLOR }}>Nota: </span>{ruta.nota}
              </p>
            )}

            {ruta.paradas.map(p => {
              const enCurso = marcando === p.cliente_id
              const pidiendo = confirmar === p.cliente_id
              const cargandoFoto = subiendo === p.cliente_id
              const fotos = p.entregada ? p.fotos : (pendientesFoto[p.cliente_id] ?? [])
              const topeFotos = fotos.length >= MAX_FOTOS
              return (
                <article key={p.cliente_id}
                  className={`rounded-xl border bg-white shadow-sm overflow-hidden ${
                    p.entregada ? 'border-emerald-300' : 'border-gray-300'
                  }`}>
                  {/* Datos de la etiqueta, compactos */}
                  <div className="flex items-start gap-2.5 px-3 pt-2.5 pb-2">
                    <span
                      className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white"
                      style={{ backgroundColor: p.entregada ? '#059669' : COLOR }}
                      aria-hidden="true"
                    >
                      {p.entregada ? <Check className="w-4 h-4" /> : p.orden}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2 flex-wrap">
                        <h2 className="text-base font-bold leading-tight" style={{ color: COLOR }}>
                          {p.nombre_mascota || 'Sin nombre'}
                        </h2>
                        {p.codigo && (
                          <span className="font-mono text-[10px] font-bold text-gray-500">{p.codigo}</span>
                        )}
                        {p.entregada && (
                          <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800">
                            <Clock className="w-3 h-3" aria-hidden="true" />
                            {horaCorta(p.entregada_hora) || 'entregada'}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-700 mt-0.5 truncate">{p.nombre_tutor || '—'}</p>
                      <p className="text-xs text-gray-600 mt-0.5 flex items-start gap-1">
                        <MapPin className="w-3.5 h-3.5 shrink-0 mt-px text-gray-400" aria-hidden="true" />
                        <span>{p.direccion || 'Sin dirección'}</span>
                      </p>
                    </div>
                  </div>

                  {/* Fotos de la entrega */}
                  {fotos.length > 0 && (
                    <div className="flex gap-1.5 overflow-x-auto px-3 pb-2">
                      {fotos.map(url => (
                        <a key={url} href={url} target="_blank" rel="noopener noreferrer" className="shrink-0">
                          <img src={url} alt="Foto de la entrega"
                            className="h-14 w-14 rounded-lg border border-gray-300 object-cover" />
                        </a>
                      ))}
                      {!p.entregada && (
                        <button onClick={() => setPendientesFoto(f => ({ ...f, [p.cliente_id]: [] }))}
                          aria-label="Quitar las fotos"
                          className="shrink-0 h-14 w-9 rounded-lg border border-gray-300 text-gray-400 flex items-center justify-center">
                          <X className="w-4 h-4" aria-hidden="true" />
                        </button>
                      )}
                    </div>
                  )}

                  {/* Acciones: con color y objetivos grandes, se usan caminando */}
                  <input
                    ref={el => { inputs.current[p.cliente_id] = el }}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="hidden"
                    onChange={e => { const f = e.target.files?.[0]; if (f) subirFoto(p, f); e.target.value = '' }}
                  />
                  <div className="grid grid-cols-3 gap-px bg-gray-200 border-t border-gray-200">
                    <a href={p.direccion ? mapsUrl(p.direccion) : undefined}
                      target="_blank" rel="noopener noreferrer"
                      className={`flex items-center justify-center gap-1.5 py-2.5 text-xs font-bold text-white ${p.direccion ? '' : 'pointer-events-none opacity-40'}`}
                      style={{ backgroundColor: '#2A6DB0' }}>
                      <Navigation className="w-3.5 h-3.5 shrink-0" aria-hidden="true" /> Llegar
                    </a>
                    <a href={p.telefono ? `tel:+56${p.telefono}` : undefined}
                      className={`flex items-center justify-center gap-1.5 py-2.5 text-xs font-bold text-white ${p.telefono ? '' : 'pointer-events-none opacity-40'}`}
                      style={{ backgroundColor: '#059669' }}>
                      <Phone className="w-3.5 h-3.5 shrink-0" aria-hidden="true" /> Llamar
                    </a>
                    <button
                      onClick={() => inputs.current[p.cliente_id]?.click()}
                      disabled={cargandoFoto || topeFotos}
                      className="flex items-center justify-center gap-1.5 py-2.5 text-xs font-bold disabled:opacity-50"
                      style={{ backgroundColor: AMBER, color: COLOR }}>
                      {cargandoFoto
                        ? <><Loader2 className="w-3.5 h-3.5 shrink-0 animate-spin" aria-hidden="true" /> Subiendo…</>
                        : <><Camera className="w-3.5 h-3.5 shrink-0" aria-hidden="true" /> {topeFotos ? 'Máximo' : 'Foto'}</>}
                    </button>
                  </div>

                  {!p.entregada && (
                    <div className="p-2.5 border-t border-gray-200">
                      {pidiendo ? (
                        <div className="space-y-2">
                          <p className="text-center text-[11px] font-medium text-gray-600">
                            Le avisamos al tutor de {p.nombre_mascota || 'la mascota'}. No se puede deshacer.
                          </p>
                          <div className="grid grid-cols-2 gap-2">
                            <button onClick={() => setConfirmar('')} disabled={enCurso}
                              className="rounded-lg border-2 border-gray-300 bg-white py-2.5 text-sm font-semibold text-gray-700 disabled:opacity-50">
                              Cancelar
                            </button>
                            <button onClick={() => entregar(p)} disabled={enCurso}
                              className="rounded-lg py-2.5 text-sm font-bold text-white shadow-sm disabled:opacity-60"
                              style={{ backgroundColor: '#059669' }}>
                              {enCurso ? 'Registrando…' : 'Sí, entregada'}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button onClick={() => { setConfirmar(p.cliente_id); setError('') }}
                          className="w-full rounded-lg py-2.5 text-sm font-bold text-white shadow-sm active:scale-[0.99] transition-transform"
                          style={{ backgroundColor: COLOR }}>
                          Marcar entregada
                        </button>
                      )}
                    </div>
                  )}
                </article>
              )
            })}

            {total === 0 && (
              <div className="rounded-2xl border border-gray-300 bg-white p-8 text-center text-gray-500 shadow-sm">
                Esta ruta no tiene paradas.
              </div>
            )}

            <p className="pt-1 text-center text-[11px] text-gray-500">
              Huellas que no se borran · Crematorio Alma Animal
            </p>
          </>
        )}
      </main>
    </div>
  )
}
