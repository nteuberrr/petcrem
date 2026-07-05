'use client'
import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { fmtFecha } from '@/lib/format'

type Solicitud = {
  id: string; cliente_nombre: string; nombre_mascota: string; peso: string
  direccion: string; comuna: string; fecha_retiro: string; hora_retiro: string
  tipo_servicio: string; origen: string; vet_nombre: string; cliente_wa_id: string
  cliente_id: string
}

type Eutanasia = {
  id: string; mascota_nombre: string; cliente_nombre: string; peso: string; comuna: string
  direccion: string; fecha_servicio: string; hora_servicio: string
  hora_retiro_crematorio: string; vet_nombre: string; cliente_id: string
  estado_cronograma: 'esperando' | 'tomada'
}

const SERVICIO: Record<string, string> = { CI: 'Individual', CP: 'Premium', SD: 'Sin Devolución' }

const GRID = 'grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5 gap-3'
const esVet = (s: Solicitud) => s.origen === 'bot_vet' || !!s.vet_nombre
const quien = (s: Solicitud) => (esVet(s) ? (s.vet_nombre || 'Veterinario') : (s.cliente_nombre || '—'))
const direccion = (s: Solicitud) => [s.direccion, s.comuna].filter(Boolean).join(', ') || '—'
const cuando = (s: Solicitud) => `${s.fecha_retiro ? fmtFecha(s.fecha_retiro) : '—'}${s.hora_retiro ? ` · ${s.hora_retiro}` : ''}`

/**
 * Panel del bot en el DASHBOARD. Grilla de cuadrados que se acumulan hacia la
 * derecha (2→5 columnas). Muestra:
 *  - RETIROS PENDIENTES (rojo) con Confirmar/Rechazar — canal confiable, no depende
 *    de la ventana de 24h de WhatsApp;
 *  - RETIROS CONFIRMADOS (verde) como ficha del retiro coordinado; desaparece al
 *    registrar la ficha.
 *  - EUTANASIAS a domicilio: NARANJA mientras esperan un veterinario, VERDE cuando
 *    un vet la tomó; desaparecen al no realizarse o al registrarse la ficha.
 * Se refresca solo cada 30s.
 *
 * Lo ven TODOS los roles; `puedeResolver` (solo admin) muestra los botones de
 * Confirmar/Rechazar de los retiros pendientes (el POST revalida el rol igual).
 */
export default function SolicitudesPendientes({ puedeResolver = false }: { puedeResolver?: boolean }) {
  const router = useRouter()
  // Abre la ficha borrador del cliente (si la solicitud/eutanasia ya la tiene).
  const abrirFicha = (clienteId?: string) => { if (clienteId) router.push(`/clientes/${clienteId}`) }
  const [pendientes, setPendientes] = useState<Solicitud[]>([])
  const [confirmadas, setConfirmadas] = useState<Solicitud[]>([])
  const [eutanasias, setEutanasias] = useState<Eutanasia[]>([])
  const [cargado, setCargado] = useState(false)
  const [resolviendo, setResolviendo] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<string>('')
  // Tope de tarjetas por sección para no inflar el dashboard; "Ver todas" expande.
  const LIMITE = 20
  const [expandido, setExpandido] = useState<Record<string, boolean>>({})
  const recortar = <T,>(lista: T[], key: string): T[] => (expandido[key] ? lista : lista.slice(0, LIMITE))
  const verTodas = (lista: { length: number }, key: string) =>
    lista.length > LIMITE && !expandido[key] ? (
      <button onClick={() => setExpandido(prev => ({ ...prev, [key]: true }))}
        className="mt-2 text-xs font-semibold text-brand-soft hover:underline">
        Ver todas ({lista.length})
      </button>
    ) : null

  const cargar = useCallback(async () => {
    try {
      const r = await fetch('/api/solicitudes-retiro', { cache: 'no-store' })
      if (!r.ok) return
      const d = await r.json()
      setPendientes(Array.isArray(d?.pendientes) ? d.pendientes : [])
      setConfirmadas(Array.isArray(d?.confirmadas) ? d.confirmadas : [])
      setEutanasias(Array.isArray(d?.eutanasias) ? d.eutanasias : [])
    } catch { /* red: reintenta en el próximo tick */ } finally { setCargado(true) }
  }, [])

  useEffect(() => {
    cargar()
    const t = setInterval(cargar, 30000)
    return () => clearInterval(t)
  }, [cargar])

  async function resolver(id: string, accion: 'confirmar' | 'rechazar') {
    if (accion === 'rechazar' && !confirm('¿Rechazar esta solicitud? Se le avisará al cliente que un agente lo contactará.')) return
    setResolviendo(id)
    setFeedback('')
    try {
      const r = await fetch('/api/solicitudes-retiro', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, accion }),
      })
      const d = await r.json().catch(() => ({}))
      setFeedback(d?.acuseAdmin || (r.ok ? 'Listo.' : d?.error || 'No se pudo procesar.'))
      await cargar()
    } catch {
      setFeedback('Error de red. Intenta de nuevo.')
    } finally {
      setResolviendo(null)
    }
  }

  if (!cargado || (pendientes.length === 0 && confirmadas.length === 0 && eutanasias.length === 0 && !feedback)) return null

  const eutCuando = (e: Eutanasia) => `${e.fecha_servicio ? fmtFecha(e.fecha_servicio) : '—'}${e.hora_servicio ? ` · ${e.hora_servicio}` : ''}`
  const eutDireccion = (e: Eutanasia) => [e.direccion, e.comuna].filter(Boolean).join(', ') || '—'

  return (
    <div className="mb-4 space-y-4">
      {feedback && (
        <div className="rounded-lg px-3 py-2 text-xs font-medium text-amber-900 bg-amber-100 border border-amber-200">{feedback}</div>
      )}

      {pendientes.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-2">
            <span className="text-lg">🔔</span>
            <h2 className="text-sm font-bold text-gray-800">Solicitudes de retiro pendientes ({pendientes.length})</h2>
          </div>
          <div className={GRID}>
            {recortar(pendientes, 'pendientes').map(s => (
              <div key={s.id} className="rounded-xl border-2 border-red-300 bg-red-50 shadow-sm p-3 flex flex-col justify-between gap-2 min-h-[150px]">
                <div className="min-w-0">
                  <div className="flex items-center justify-between gap-1">
                    <p className="font-bold text-gray-900 text-sm truncate">{s.nombre_mascota || '—'}</p>
                    {s.tipo_servicio && (
                      <span className="text-[10px] font-semibold text-red-800 bg-red-100 border border-red-200 px-1.5 py-0.5 rounded shrink-0">{SERVICIO[s.tipo_servicio] || s.tipo_servicio}</span>
                    )}
                  </div>
                  <p className="text-xs text-gray-700 truncate mt-0.5">{esVet(s) ? '🏥 ' : ''}{quien(s)}</p>
                  {s.peso && <p className="text-[11px] text-gray-500">{s.peso} kg</p>}
                  <p className="text-[11px] text-gray-500 mt-1 leading-tight truncate">📍 {direccion(s)}</p>
                  <p className="text-[11px] text-gray-500 leading-tight">🗓 {cuando(s)}</p>
                </div>
                {puedeResolver ? (
                  <div className="flex gap-1.5">
                    <button onClick={() => resolver(s.id, 'confirmar')} disabled={resolviendo === s.id} title="Confirmar retiro"
                      className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white py-1.5 rounded-lg text-[11px] font-semibold transition-colors disabled:opacity-50">
                      {resolviendo === s.id ? '…' : '✅ Confirmar'}
                    </button>
                    <button onClick={() => resolver(s.id, 'rechazar')} disabled={resolviendo === s.id} title="Rechazar"
                      className="bg-white border-2 border-red-300 text-red-700 hover:bg-red-50 px-2 py-1.5 rounded-lg text-[11px] font-semibold transition-colors disabled:opacity-50">
                      ❌
                    </button>
                  </div>
                ) : (
                  <p className="text-[10px] font-semibold text-red-800/70">Pendiente de confirmación del administrador</p>
                )}
              </div>
            ))}
          </div>
          {verTodas(pendientes, 'pendientes')}
        </section>
      )}

      {confirmadas.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-2">
            <span className="text-lg">✅</span>
            <h2 className="text-sm font-bold text-gray-800">Retiros confirmados ({confirmadas.length})</h2>
          </div>
          <div className={GRID}>
            {recortar(confirmadas, 'confirmadas').map(s => (
              <div key={s.id}
                onClick={() => abrirFicha(s.cliente_id)}
                role={s.cliente_id ? 'button' : undefined}
                title={s.cliente_id ? 'Abrir ficha del cliente' : undefined}
                className={`rounded-xl border-2 border-emerald-300 bg-emerald-50 shadow-sm p-3 flex flex-col gap-1 min-h-[150px] ${s.cliente_id ? 'cursor-pointer hover:bg-emerald-100 transition-colors' : ''}`}>
                <div className="flex items-center justify-between gap-1">
                  <span className="text-[10px] font-bold text-emerald-800 bg-emerald-100 border border-emerald-200 px-1.5 py-0.5 rounded">✅ Confirmado</span>
                  {s.tipo_servicio && (
                    <span className="text-[10px] font-semibold text-gray-600 bg-white border border-gray-200 px-1.5 py-0.5 rounded shrink-0">{SERVICIO[s.tipo_servicio] || s.tipo_servicio}</span>
                  )}
                </div>
                <p className="font-bold text-gray-900 text-sm truncate mt-1">{s.nombre_mascota || '—'}</p>
                <p className="text-xs text-gray-700 truncate">{esVet(s) ? '🏥 ' : '👤 '}{quien(s)}</p>
                {s.peso && <p className="text-[11px] text-gray-500">{s.peso} kg</p>}
                <p className="text-[11px] text-gray-600 leading-tight mt-auto">🗓 {cuando(s)}</p>
                <p className="text-[11px] text-gray-600 leading-tight truncate">📍 {direccion(s)}</p>
              </div>
            ))}
          </div>
          {verTodas(confirmadas, 'confirmadas')}
        </section>
      )}

      {eutanasias.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-2">
            <span className="text-lg">🩺</span>
            <h2 className="text-sm font-bold text-gray-800">Eutanasias a domicilio ({eutanasias.length})</h2>
          </div>
          <div className={GRID}>
            {recortar(eutanasias, 'eutanasias').map(e => {
              const esperando = e.estado_cronograma === 'esperando'
              const box = esperando ? 'border-orange-300 bg-orange-50' : 'border-emerald-300 bg-emerald-50'
              const hoverBox = esperando ? 'hover:bg-orange-100' : 'hover:bg-emerald-100'
              return (
                <div key={e.id}
                  onClick={() => abrirFicha(e.cliente_id)}
                  role={e.cliente_id ? 'button' : undefined}
                  title={e.cliente_id ? 'Abrir ficha del cliente' : undefined}
                  className={`rounded-xl border-2 ${box} shadow-sm p-3 flex flex-col gap-1 min-h-[150px] ${e.cliente_id ? `cursor-pointer ${hoverBox} transition-colors` : ''}`}>
                  <div className="flex items-center justify-between gap-1">
                    {esperando ? (
                      <span className="text-[10px] font-bold text-orange-800 bg-orange-100 border border-orange-200 px-1.5 py-0.5 rounded">⏳ Esperando vet</span>
                    ) : (
                      <span className="text-[10px] font-bold text-emerald-800 bg-emerald-100 border border-emerald-200 px-1.5 py-0.5 rounded">✅ Tomada</span>
                    )}
                    <span className="text-[10px] font-semibold text-gray-600 bg-white border border-gray-200 px-1.5 py-0.5 rounded shrink-0">Eutanasia</span>
                  </div>
                  <p className="font-bold text-gray-900 text-sm truncate mt-1">{e.mascota_nombre || '—'}</p>
                  <p className="text-xs text-gray-700 truncate">👤 {e.cliente_nombre || '—'}</p>
                  {e.peso && <p className="text-[11px] text-gray-500">{e.peso} kg</p>}
                  {!esperando && e.vet_nombre && <p className="text-[11px] text-gray-600 truncate">🏥 {e.vet_nombre}</p>}
                  <p className="text-[11px] text-gray-600 leading-tight mt-auto">🩺 Eutanasia: {eutCuando(e)}</p>
                  <p className="text-[11px] leading-tight truncate">
                    🚚 Retiro: {e.hora_retiro_crematorio
                      ? <span className="text-gray-700 font-semibold">{e.hora_retiro_crematorio}</span>
                      : <span className="text-gray-400 italic">por informar</span>}
                  </p>
                  <p className="text-[11px] text-gray-600 leading-tight truncate">📍 {eutDireccion(e)}</p>
                </div>
              )
            })}
          </div>
          {verTodas(eutanasias, 'eutanasias')}
        </section>
      )}
    </div>
  )
}
