'use client'
import { use, useCallback, useEffect, useState } from 'react'
import { Check, MapPin, Phone, Navigation, PawPrint, Loader2 } from 'lucide-react'

// ─────────────────────────────────────────────────────────────────────────────
// HOJA DE RUTA del repartidor — página PÚBLICA (sin sesión) que se abre con el
// link firmado que genera Operaciones → Despachos ("Compartir con el delivery").
//
// Pensada para usarse con una mano, en la calle y con el celular: parada por
// parada, cada una con lo mismo que dice la etiqueta pegada en el ánfora
// (código, mascota, tutor, dirección, teléfono), botones grandes para llamar o
// abrir el mapa, y un único botón de "Entregado" que hace EXACTAMENTE lo mismo
// que si el equipo lo marcara desde el sistema: avisa al tutor, al veterinario
// y publica la despedida si el tutor la autorizó.
//
// Deliberadamente NO hay "deshacer": el correo ya salió. Si se marca por error,
// lo corrige el equipo.
// ─────────────────────────────────────────────────────────────────────────────

const COLOR = '#143C64'
const AMBER = '#F2B84B'
const CREAM = '#FBF8F3'
const LOGO = '/brand/logo-alma-animal.png'

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

export default function HojaDeRutaPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params)
  const [ruta, setRuta] = useState<Ruta | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [marcando, setMarcando] = useState('')
  /** Parada que espera el segundo toque de confirmación. */
  const [confirmar, setConfirmar] = useState('')

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

  async function entregar(clienteId: string) {
    setMarcando(clienteId)
    setError('')
    try {
      const r = await fetch(`/api/rutas/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cliente_id: clienteId }),
      })
      const d = await r.json()
      if (!r.ok) { setError(d?.error || 'No pudimos registrar la entrega.'); return }
      if (d.ruta) setRuta(d.ruta)
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
      <header style={{ backgroundColor: COLOR }} className="text-white px-4 pt-6 pb-5">
        <div className="max-w-xl mx-auto">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-[11px] uppercase tracking-[0.18em] font-bold" style={{ color: AMBER }}>
                Crematorio Alma Animal
              </p>
              <h1 className="text-2xl font-bold mt-1.5">Hoja de ruta</h1>
              {ruta && (
                <p className="text-sm mt-1 opacity-90">
                  Recorrido N° {ruta.numero_recorrido}{ruta.fecha ? ` · ${ruta.fecha}` : ''}
                </p>
              )}
            </div>
            <img src={LOGO} alt="" className="h-16 w-auto shrink-0 opacity-95" />
          </div>

          {ruta && total > 0 && (
            <div className="mt-5">
              <div className="flex items-baseline justify-between text-sm font-semibold">
                <span>{listas} de {total} entregadas</span>
                <span style={{ color: AMBER }}>{pendientes} {pendientes === 1 ? 'pendiente' : 'pendientes'}</span>
              </div>
              <div className="mt-2 h-2 w-full rounded-full bg-white/20 overflow-hidden">
                <div className="h-full rounded-full transition-all duration-500"
                  style={{ width: `${Math.round((listas / total) * 100)}%`, backgroundColor: AMBER }} />
              </div>
            </div>
          )}
        </div>
      </header>
      <div style={{ backgroundColor: AMBER }} className="h-1" />

      <main className="max-w-xl mx-auto px-4 py-6 space-y-4">
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
            <p className="text-sm text-gray-500 mt-2">
              Escríbenos y te enviamos un enlace nuevo.
            </p>
          </div>
        )}

        {ruta && (
          <>
            {error && (
              <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800">{error}</p>
            )}

            {completa && (
              <div className="rounded-2xl border-2 p-5 text-center shadow-sm"
                style={{ borderColor: AMBER, backgroundColor: '#FDF6E7' }}>
                <Check className="w-8 h-8 mx-auto mb-2" style={{ color: COLOR }} aria-hidden="true" />
                <p className="text-base font-bold" style={{ color: COLOR }}>Ruta completa</p>
                <p className="text-sm text-gray-600 mt-1">Entregaste todas las paradas. Gracias.</p>
              </div>
            )}

            {ruta.nota && (
              <p className="rounded-xl border border-gray-300 bg-white px-4 py-3 text-sm text-gray-700 shadow-sm">
                <span className="font-semibold" style={{ color: COLOR }}>Nota: </span>{ruta.nota}
              </p>
            )}

            {ruta.paradas.map(p => {
              const enCurso = marcando === p.cliente_id
              const pidiendo = confirmar === p.cliente_id
              return (
                <article key={p.cliente_id}
                  className={`rounded-2xl border-2 bg-white shadow-sm overflow-hidden transition-colors ${
                    p.entregada ? 'border-emerald-300' : 'border-gray-300'
                  }`}>
                  <div className="flex items-start gap-3 p-4">
                    <span
                      className="shrink-0 w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold text-white"
                      style={{ backgroundColor: p.entregada ? '#059669' : COLOR }}
                      aria-hidden="true"
                    >
                      {p.entregada ? <Check className="w-5 h-5" /> : p.orden}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h2 className="text-lg font-bold leading-tight" style={{ color: COLOR }}>
                          {p.nombre_mascota || 'Sin nombre'}
                        </h2>
                        {p.codigo && (
                          <span className="rounded-md border border-gray-300 bg-gray-50 px-1.5 py-0.5 font-mono text-[11px] font-bold text-gray-600">
                            {p.codigo}
                          </span>
                        )}
                      </div>
                      <p className="text-sm font-medium text-gray-800 mt-0.5">{p.nombre_tutor || '—'}</p>
                      <p className="text-sm text-gray-600 mt-1.5 flex items-start gap-1.5">
                        <MapPin className="w-4 h-4 shrink-0 mt-0.5 text-gray-400" aria-hidden="true" />
                        <span>{p.direccion || 'Sin dirección'}</span>
                      </p>
                      {p.entregada && (
                        <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-bold text-emerald-800">
                          <Check className="w-3.5 h-3.5" aria-hidden="true" />
                          Entregada{p.entregada_hora ? ` · ${horaCorta(p.entregada_hora)}` : ''}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Acciones: objetivos grandes, se usan caminando */}
                  <div className="grid grid-cols-2 gap-px bg-gray-200 border-t border-gray-200">
                    <a href={p.direccion ? mapsUrl(p.direccion) : undefined}
                      target="_blank" rel="noopener noreferrer"
                      className={`flex items-center justify-center gap-2 bg-white py-3 text-sm font-semibold ${p.direccion ? '' : 'pointer-events-none text-gray-300'}`}
                      style={p.direccion ? { color: COLOR } : undefined}>
                      <Navigation className="w-4 h-4 shrink-0" aria-hidden="true" /> Cómo llegar
                    </a>
                    <a href={p.telefono ? `tel:+56${p.telefono}` : undefined}
                      className={`flex items-center justify-center gap-2 bg-white py-3 text-sm font-semibold ${p.telefono ? '' : 'pointer-events-none text-gray-300'}`}
                      style={p.telefono ? { color: COLOR } : undefined}>
                      <Phone className="w-4 h-4 shrink-0" aria-hidden="true" />
                      {p.telefono_legible || 'Sin teléfono'}
                    </a>
                  </div>

                  {!p.entregada && (
                    <div className="p-3 border-t border-gray-200">
                      {pidiendo ? (
                        <div className="space-y-2">
                          <p className="text-center text-xs font-medium text-gray-600">
                            Al confirmar le avisamos al tutor de {p.nombre_mascota || 'la mascota'}. No se puede deshacer.
                          </p>
                          <div className="grid grid-cols-2 gap-2">
                            <button onClick={() => setConfirmar('')} disabled={enCurso}
                              className="rounded-xl border-2 border-gray-300 bg-white py-3 text-sm font-semibold text-gray-700 disabled:opacity-50">
                              Cancelar
                            </button>
                            <button onClick={() => entregar(p.cliente_id)} disabled={enCurso}
                              className="rounded-xl py-3 text-sm font-bold text-white shadow-md disabled:opacity-60"
                              style={{ backgroundColor: '#059669' }}>
                              {enCurso ? 'Registrando…' : 'Sí, entregada'}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button onClick={() => { setConfirmar(p.cliente_id); setError('') }}
                          className="w-full rounded-xl py-3.5 text-base font-bold text-white shadow-md active:scale-[0.99] transition-transform"
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

            <p className="pt-2 text-center text-xs text-gray-500">
              Huellas que no se borran · Crematorio Alma Animal
            </p>
          </>
        )}
      </main>
    </div>
  )
}
