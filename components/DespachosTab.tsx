'use client'
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { formatDate, formatDateForSheet, todayISO } from '@/lib/dates'
import { Modal } from '@/components/ui/Modal'
import AddressAutocomplete from '@/components/ui/AddressAutocomplete'
import { proximosDiasHabiles, agregarDiasHabiles, isoFecha } from '@/lib/dias-habiles'

type TipoServicio = { id: string; codigo: string; plazo_entrega_dias: string; activo: string }

type Cliente = {
  id: string; codigo: string; nombre_mascota: string; nombre_tutor: string
  especie: string; estado: string; codigo_servicio?: string
  direccion_despacho?: string; comuna?: string; telefono?: string
  fecha_retiro?: string
}

type Parada = { cliente_id: string; orden: number; lat?: number; lng?: number; direccion?: string }
type EstadoRuta = 'guardada' | 'en_curso' | 'terminada'
type Despacho = {
  id: string; fecha: string; numero_recorrido: string; numero_global?: string
  mascotas_ids: string[]; nota: string; fecha_creacion: string
  estado_ruta?: EstadoRuta
  paradas?: Parada[]
  entregas?: Record<string, { fecha_hora: string }>
  origen_direccion?: string; origen_lat?: string; origen_lng?: string
  destino_direccion?: string; destino_lat?: string; destino_lng?: string
  hora_inicio_ruta?: string; hora_termino_ruta?: string; fecha_realizada?: string
}

type ParadaOptim = {
  cliente_id: string; codigo: string; nombre_mascota: string; nombre_tutor: string
  direccion: string; formatted_address: string; lat: number; lng: number
  fecha_objetivo_iso: string; fecha_objetivo_dmy: string; atrasada: boolean
  veterinaria: string; telefono: string
}
type ParadaObligatoria = ParadaOptim & { order: number }
type ParadaCandidata = ParadaOptim & { detour_minutes: number; recommended: boolean }
type OptimResult = {
  origin: { address: string; lat: number; lng: number }
  destination: { address: string; lat: number; lng: number }
  obligatorias: ParadaObligatoria[]
  candidatas: ParadaCandidata[]
  retiros_crematorio: ParadaOptim[]
  baseline: { distance_km: number; duration_minutes: number; google_maps_url: string }
  skipped: Array<{ cliente_id: string; codigo: string; motivo: string }>
}

const LS_ORIGIN = 'petcrem.optimizer.origin'
const LS_DEST = 'petcrem.optimizer.destination'

export default function DespachosTab() {
  const [despachos, setDespachos] = useState<Despacho[]>([])
  const [clientesMap, setClientesMap] = useState<Record<string, Cliente>>({})
  const [expandido, setExpandido] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const [fecha, setFecha] = useState(() => todayISO())
  const [nota, setNota] = useState('')
  const [seleccionadas, setSeleccionadas] = useState<Cliente[]>([])

  // Modal selección
  const [showModal, setShowModal] = useState(false)
  const [disponibles, setDisponibles] = useState<Cliente[]>([])
  const [cargando, setCargando] = useState(false)
  const [buscar, setBuscar] = useState('')

  // Optimizador de ruta
  const [optimOpen, setOptimOpen] = useState(false)
  const [optimOrigin, setOptimOrigin] = useState('')
  const [optimDest, setOptimDest] = useState('')
  const [optimFechaBase, setOptimFechaBase] = useState(() => todayISO())
  const [optimMaxDetour, setOptimMaxDetour] = useState(10)
  const [optimDiasRec, setOptimDiasRec] = useState(3)
  const [optimLoading, setOptimLoading] = useState(false)
  const [optimResult, setOptimResult] = useState<OptimResult | null>(null)
  const [optimError, setOptimError] = useState<string | null>(null)
  const [optimPicks, setOptimPicks] = useState<Set<string>>(new Set())
  const [optimPromovidosFijos, setOptimPromovidosFijos] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setOptimOrigin(window.localStorage.getItem(LS_ORIGIN) || '')
      setOptimDest(window.localStorage.getItem(LS_DEST) || '')
    }
  }, [])

  // Edición
  const [editId, setEditId] = useState<string | null>(null)
  const [editFecha, setEditFecha] = useState('')
  const [editNota, setEditNota] = useState('')
  const [editMascotas, setEditMascotas] = useState<Cliente[]>([])
  const [editDisponibles, setEditDisponibles] = useState<Cliente[]>([])
  const [editBuscar, setEditBuscar] = useState('')
  const [savingEdit, setSavingEdit] = useState(false)

  const fetchDespachos = useCallback(async () => {
    const res = await fetch('/api/despachos', { cache: 'no-store' })
    const data = await res.json()
    setDespachos(Array.isArray(data) ? data : [])
  }, [])

  useEffect(() => { fetchDespachos() }, [fetchDespachos])

  // Mascotas ya asignadas a una ruta no terminada: no se ofrecen para otra ruta
  // ni aparecen en el calendario (evita re-rutearlas).
  const enRutaActiva = useMemo(() => {
    const s = new Set<string>()
    for (const d of despachos) {
      if ((d.estado_ruta || 'guardada') === 'terminada') continue
      for (const mid of d.mascotas_ids) s.add(mid)
    }
    return s
  }, [despachos])

  const [routeBusy, setRouteBusy] = useState<string | null>(null)

  // ─── Calendario de entregas ───
  const [tiposServicio, setTiposServicio] = useState<TipoServicio[]>([])
  const [allClientes, setAllClientes] = useState<Cliente[]>([])

  useEffect(() => {
    Promise.all([
      fetch('/api/servicios', { cache: 'no-store' }).then(r => r.json()).catch(() => []),
      fetch('/api/clientes', { cache: 'no-store' }).then(r => r.json()).catch(() => []),
    ]).then(([ts, all]) => {
      setTiposServicio(Array.isArray(ts) ? ts : [])
      setAllClientes(Array.isArray(all) ? all : [])
    })
  }, [])

  const calendario = useMemo(() => {
    const plazoMap = new Map<string, number>()
    for (const t of tiposServicio) {
      const n = parseInt(t.plazo_entrega_dias || '0', 10)
      plazoMap.set((t.codigo || '').toUpperCase(), Number.isFinite(n) && n > 0 ? n : 3)
    }
    const dias = proximosDiasHabiles(new Date(), 5)
    type ClienteEnFecha = Cliente & { fecha_objetivo_iso: string }
    const buckets = new Map<string, { fecha: Date; pendientes: ClienteEnFecha[]; atrasadas: ClienteEnFecha[] }>()
    for (const d of dias) buckets.set(isoFecha(d), { fecha: d, pendientes: [], atrasadas: [] })
    const hoyIso = isoFecha(new Date())
    const hoyBucket = buckets.get(hoyIso) ?? buckets.get(isoFecha(dias[0]))

    // Procesa todas las mascotas con fecha_retiro que aún NO están despachadas.
    // fecha_objetivo = fecha_retiro + plazo_entrega_dias hábiles del tipo de servicio.
    // No depende del estado (pendiente / cremado): toda mascota tiene fecha de entrega
    // desde el momento del retiro.
    for (const c of allClientes) {
      if (c.estado === 'despachado') continue // ya salió, no la mostramos
      if (enRutaActiva.has(c.id)) continue // ya está en una ruta activa
      const codigo = (c.codigo_servicio || 'CI').toUpperCase()
      if (codigo === 'SD') continue // Sin Devolución, no se entrega
      const isoRetiro = c.fecha_retiro ? formatDateForSheet(c.fecha_retiro) : ''
      if (!isoRetiro) continue
      const fechaRetiro = new Date(`${isoRetiro}T12:00:00`)
      if (isNaN(fechaRetiro.getTime())) continue
      const plazo = plazoMap.get(codigo) ?? 3
      const fechaObjetivo = agregarDiasHabiles(fechaRetiro, plazo)
      const isoObj = isoFecha(fechaObjetivo)
      const enriched: ClienteEnFecha = { ...c, fecha_objetivo_iso: isoObj }

      const bucket = buckets.get(isoObj)
      if (bucket) {
        bucket.pendientes.push(enriched)
        continue
      }
      // Fuera del rango: si el objetivo ya pasó → atrasada en la columna de hoy
      if (isoObj < hoyIso && hoyBucket) {
        hoyBucket.atrasadas.push(enriched)
      }
    }

    return dias.map(d => buckets.get(isoFecha(d))!)
  }, [tiposServicio, allClientes, enRutaActiva])

  async function abrirModal() {
    setShowModal(true)
    setBuscar('')
    setCargando(true)
    // Disponibles: mascotas cremadas aún no despachadas. Excluimos las SD (Sin Devolución)
    // — esas no se despachan, su flujo termina en "cremado".
    const all = await fetch('/api/clientes?estado=cremado').then(r => r.json())
    const seleIds = seleccionadas.map(s => s.id)
    setDisponibles(Array.isArray(all)
      ? all.filter((c: Cliente) => !seleIds.includes(c.id) && c.codigo_servicio !== 'SD' && !enRutaActiva.has(c.id))
      : [])
    setCargando(false)
  }

  function toggle(c: Cliente) {
    setSeleccionadas(prev => {
      const isIn = prev.some(p => p.id === c.id)
      return isIn ? prev.filter(p => p.id !== c.id) : [...prev, c]
    })
  }

  function quitar(id: string) {
    setSeleccionadas(s => s.filter(x => x.id !== id))
  }

  async function guardar(e: React.FormEvent) {
    e.preventDefault()
    if (seleccionadas.length === 0) return alert('Selecciona al menos una mascota')
    setSaving(true)
    const res = await fetch('/api/despachos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fecha,
        mascotas_ids: seleccionadas.map(s => s.id),
        nota,
      }),
    })
    if (res.ok) {
      setSeleccionadas([])
      setNota('')
      await fetchDespachos()
    } else {
      const err = await res.json().catch(() => ({}))
      alert(`Error: ${err.error ?? res.status}`)
    }
    setSaving(false)
  }

  async function toggleExpandir(d: Despacho) {
    if (expandido === d.id) { setExpandido(null); return }
    setExpandido(d.id)
    const faltantes = d.mascotas_ids.filter(id => !clientesMap[id])
    if (faltantes.length > 0) {
      const all = await fetch('/api/clientes').then(r => r.json())
      const map: Record<string, Cliente> = {}
      if (Array.isArray(all)) all.forEach((c: Cliente) => { map[c.id] = c })
      setClientesMap(m => ({ ...m, ...map }))
    }
  }

  async function abrirEditar(d: Despacho) {
    setEditId(d.id)
    setEditFecha(formatDateForSheet(d.fecha))
    setEditNota(d.nota ?? '')
    setEditBuscar('')
    // Resolver mascotas actuales + traer disponibles (cremados)
    const all: Cliente[] = await fetch('/api/clientes').then(r => r.json()).catch(() => [])
    const byId = new Map(Array.isArray(all) ? all.map((c: Cliente) => [c.id, c]) : [])
    const actuales = d.mascotas_ids.map(id => byId.get(id)).filter((x): x is Cliente => !!x)
    setEditMascotas(actuales)
    // Disponibles para agregar al recorrido: cremados, excluyendo SD (no se despachan)
    const cremadosLibres = (Array.isArray(all) ? all : [])
      .filter((c: Cliente) => c.estado === 'cremado' && c.codigo_servicio !== 'SD' && !enRutaActiva.has(c.id))
    setEditDisponibles(cremadosLibres)
  }

  function quitarEdit(id: string) {
    setEditMascotas(s => s.filter(x => x.id !== id))
  }

  function agregarEdit(c: Cliente) {
    setEditMascotas(s => s.some(x => x.id === c.id) ? s : [...s, c])
  }

  async function guardarEdicion(e: React.FormEvent) {
    e.preventDefault()
    if (!editId) return
    if (editMascotas.length === 0) return alert('El recorrido debe tener al menos una mascota')
    setSavingEdit(true)
    const res = await fetch('/api/despachos', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: editId,
        fecha: editFecha,
        nota: editNota,
        mascotas_ids: editMascotas.map(m => m.id),
      }),
    })
    if (res.ok) {
      setEditId(null)
      await fetchDespachos()
    } else {
      const err = await res.json().catch(() => ({}))
      alert(`Error: ${err.error ?? res.status}`)
    }
    setSavingEdit(false)
  }

  async function eliminar(id: string, numero: string) {
    if (!confirm(`¿Eliminar el recorrido N°${numero}? Las mascotas vuelven a estado "cremado".`)) return
    const res = await fetch(`/api/despachos?id=${id}`, { method: 'DELETE' })
    if (res.ok) await fetchDespachos()
    else alert('Error al eliminar')
  }

  function optimToggle(id: string) {
    setOptimPicks(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  async function optimCalcular(opts?: { incluir_extras_ids?: string[] }) {
    if (!optimOrigin.trim()) { setOptimError('Falta la dirección de origen'); return }
    setOptimLoading(true)
    setOptimError(null)
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(LS_ORIGIN, optimOrigin)
      window.localStorage.setItem(LS_DEST, optimDest)
    }
    try {
      const res = await fetch('/api/despachos/optimizar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          origin_address: optimOrigin,
          destination_address: optimDest || undefined,
          max_detour_minutes: optimMaxDetour,
          dias_recomendadas: optimDiasRec,
          fecha_base: optimFechaBase,
          incluir_extras_ids: opts?.incluir_extras_ids ?? [],
        }),
      })
      const j = await res.json()
      if (!res.ok) {
        const stack = typeof j.stack === 'string' ? `\n\n${j.stack.split('\n').slice(0, 4).join('\n')}` : ''
        setOptimError((j.error || `Error ${res.status}`) + stack)
      } else {
        const r = j as OptimResult
        setOptimResult(r)
        if (opts?.incluir_extras_ids && opts.incluir_extras_ids.length > 0) {
          setOptimPromovidosFijos(new Set(opts.incluir_extras_ids))
          setOptimPicks(new Set())
        } else {
          setOptimPromovidosFijos(new Set())
          setOptimPicks(new Set())
        }
      }
    } catch (e) {
      setOptimError(String(e))
    } finally {
      setOptimLoading(false)
    }
  }

  async function optimReoptimizarConSugeridas() {
    const ids = Array.from(optimPicks)
    if (ids.length === 0) return
    await optimCalcular({ incluir_extras_ids: [...Array.from(optimPromovidosFijos), ...ids] })
  }

  function optimGmapsUrl(): string {
    if (!optimResult) return ''
    const all = [
      ...optimResult.obligatorias.map(o => ({ lat: o.lat, lng: o.lng })),
      ...optimResult.candidatas.filter(c => optimPicks.has(c.cliente_id)).map(c => ({ lat: c.lat, lng: c.lng })),
    ]
    const fmt = (p: { lat: number; lng: number }) => `${p.lat},${p.lng}`
    const u = new URLSearchParams({
      api: '1',
      origin: fmt(optimResult.origin),
      destination: fmt(optimResult.destination),
      travelmode: 'driving',
    })
    if (all.length > 0) u.set('waypoints', all.map(fmt).join('|'))
    return `https://www.google.com/maps/dir/?${u.toString()}`
  }

  // ─── Ruta viva: guardar desde el optimizador + tracking de entregas ───
  async function optimGuardarRuta() {
    if (!optimResult) return
    const picks = optimResult.candidatas.filter(c => optimPicks.has(c.cliente_id))
    const paradas = [
      ...optimResult.obligatorias.map(o => ({ cliente_id: o.cliente_id, orden: o.order, lat: o.lat, lng: o.lng, direccion: o.formatted_address })),
      ...picks.map((c, i) => ({ cliente_id: c.cliente_id, orden: optimResult.obligatorias.length + i + 1, lat: c.lat, lng: c.lng, direccion: c.formatted_address })),
    ]
    if (paradas.length === 0) { alert('La ruta no tiene paradas para guardar.'); return }
    setSaving(true)
    const res = await fetch('/api/despachos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fecha: optimFechaBase,
        paradas,
        origen: optimResult.origin,
        destino: optimResult.destination,
      }),
    })
    setSaving(false)
    if (res.ok) {
      setOptimResult(null)
      setOptimOpen(false)
      await fetchDespachos()
      alert('Ruta guardada. La encontrarás en "Rutas" para iniciarla y marcar las entregas.')
    } else {
      const err = await res.json().catch(() => ({}))
      alert(`Error al guardar la ruta: ${err.error ?? res.status}`)
    }
  }

  /** Paradas de la ruta ordenadas; opcionalmente solo las no entregadas. */
  function paradasOrdenadas(d: Despacho, soloPendientes: boolean): Parada[] {
    const base = (d.paradas && d.paradas.length > 0)
      ? [...d.paradas]
      : d.mascotas_ids.map((id, i) => ({ cliente_id: id, orden: i + 1 } as Parada))
    return base
      .sort((a, b) => a.orden - b.orden)
      .filter(p => soloPendientes ? !d.entregas?.[p.cliente_id] : true)
  }

  /** URL de Google Maps de la ruta. Usa coords si las hay, si no la dirección. */
  function rutaMapsUrl(d: Despacho, soloPendientes: boolean): string {
    const ptStr = (p: Parada) =>
      (p.lat != null && p.lng != null) ? `${p.lat},${p.lng}`
        : (p.direccion || [clientesMap[p.cliente_id]?.direccion_despacho, clientesMap[p.cliente_id]?.comuna].filter(Boolean).join(', ') || '')
    const stops = paradasOrdenadas(d, soloPendientes).map(ptStr).filter(Boolean)
    if (stops.length === 0) return ''
    const u = new URLSearchParams({ api: '1', travelmode: 'driving' })
    const origen = (d.origen_lat && d.origen_lng) ? `${d.origen_lat},${d.origen_lng}` : (d.origen_direccion || '')
    const destino = (d.destino_lat && d.destino_lng) ? `${d.destino_lat},${d.destino_lng}` : (d.destino_direccion || origen)
    if (origen) {
      u.set('origin', origen)
      u.set('destination', destino || origen)
      u.set('waypoints', stops.join('|'))
    } else {
      // Ruta sin origen definido (manual): la primera parada es el origen y la
      // última el destino; el resto, waypoints intermedios.
      u.set('origin', stops[0])
      u.set('destination', stops[stops.length - 1])
      if (stops.length > 2) u.set('waypoints', stops.slice(1, -1).join('|'))
    }
    return `https://www.google.com/maps/dir/?${u.toString()}`
  }

  /** Carga clientesMap para una ruta si faltan datos (para Maps por dirección). */
  async function asegurarClientes(d: Despacho) {
    const faltan = d.mascotas_ids.some(id => !clientesMap[id])
    if (!faltan) return
    const all = await fetch('/api/clientes').then(r => r.json()).catch(() => [])
    if (Array.isArray(all)) {
      const map: Record<string, Cliente> = {}
      all.forEach((c: Cliente) => { map[c.id] = c })
      setClientesMap(m => ({ ...m, ...map }))
    }
  }

  async function iniciarRuta(d: Despacho) {
    if (!confirm(`¿Iniciar la ruta N°${d.numero_recorrido}? Se enviará a cada tutor el correo avisando que su mascota va en camino.`)) return
    setRouteBusy(d.id)
    const res = await fetch(`/api/despachos/${d.id}/iniciar`, { method: 'POST' })
    setRouteBusy(null)
    if (res.ok) await fetchDespachos()
    else alert('No se pudo iniciar la ruta.')
  }

  async function toggleEntrega(d: Despacho, clienteId: string, entregadaActual: boolean) {
    setRouteBusy(d.id + ':' + clienteId)
    const res = await fetch(`/api/despachos/${d.id}/entregar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cliente_id: clienteId, deshacer: entregadaActual }),
    })
    setRouteBusy(null)
    if (res.ok) await fetchDespachos()
    else { const e = await res.json().catch(() => ({})); alert(`Error: ${e.error ?? res.status}`) }
  }

  async function terminarRuta(d: Despacho) {
    const pendientes = d.mascotas_ids.filter(id => !d.entregas?.[id]).length
    const msg = pendientes > 0
      ? `Quedan ${pendientes} mascota(s) sin marcar como entregadas. ¿Terminar la ruta de todas formas?`
      : '¿Terminar la ruta de entrega? Se registrará la hora de término.'
    if (!confirm(msg)) return
    setRouteBusy(d.id)
    const res = await fetch(`/api/despachos/${d.id}/terminar`, { method: 'POST' })
    setRouteBusy(null)
    if (res.ok) await fetchDespachos()
    else alert('No se pudo terminar la ruta.')
  }

  const editDisponiblesFiltradas = editDisponibles.filter(p => {
    if (editMascotas.some(m => m.id === p.id)) return false // ya está en la lista
    if (!editBuscar) return true
    const q = editBuscar.toLowerCase()
    return p.nombre_mascota.toLowerCase().includes(q) ||
      p.nombre_tutor.toLowerCase().includes(q) ||
      p.codigo.toLowerCase().includes(q)
  })

  const disponiblesFiltradas = disponibles.filter(p => {
    if (!buscar) return true
    const q = buscar.toLowerCase()
    return p.nombre_mascota.toLowerCase().includes(q) ||
      p.nombre_tutor.toLowerCase().includes(q) ||
      p.codigo.toLowerCase().includes(q) ||
      (p.direccion_despacho ?? '').toLowerCase().includes(q) ||
      (p.comuna ?? '').toLowerCase().includes(q)
  })

  return (
    <>
      {/* Calendario de entregas — próximos 5 días hábiles */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 mb-4">
        <div className="flex items-baseline justify-between mb-3 gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <h2 className="text-base font-semibold text-gray-900">Calendario de entregas</h2>
            <button
              type="button"
              onClick={() => setOptimOpen(true)}
              className="inline-flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg px-3 py-1.5 shadow-sm transition-colors"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clipRule="evenodd" />
              </svg>
              Optimizar ruta
            </button>
          </div>
          <div className="flex items-center gap-3 text-[11px] text-gray-500">
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-3 rounded-sm bg-yellow-300 border border-yellow-400" /> Pendiente
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-3 rounded-sm bg-red-300 border border-red-400" /> Atrasada
            </span>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {calendario.map(col => {
            const total = col.pendientes.length + col.atrasadas.length
            const esHoy = isoFecha(col.fecha) === isoFecha(new Date())
            return (
              <div key={isoFecha(col.fecha)} className={`rounded-lg border-2 ${esHoy ? 'border-indigo-300 bg-indigo-50/30' : 'border-gray-200 bg-gray-50/30'} p-3`}>
                <div className="text-center pb-2 border-b border-gray-200 mb-2">
                  <p className="text-[10px] uppercase font-semibold text-gray-500 tracking-wide">
                    {col.fecha.toLocaleDateString('es-CL', { weekday: 'long' })}
                  </p>
                  <p className={`text-base font-bold ${esHoy ? 'text-indigo-700' : 'text-gray-900'}`}>
                    {String(col.fecha.getDate()).padStart(2, '0')}/{String(col.fecha.getMonth() + 1).padStart(2, '0')}
                  </p>
                  <p className="text-[10px] text-gray-400">
                    {total} {total === 1 ? 'mascota' : 'mascotas'}
                    {col.atrasadas.length > 0 && <span className="text-red-600 font-semibold"> · {col.atrasadas.length} atrasadas</span>}
                  </p>
                </div>
                <div className="space-y-1 max-h-72 overflow-y-auto">
                  {col.atrasadas.map(c => (
                    <Link href={`/clientes/${c.id}`} key={`a-${c.id}`}
                      className="block bg-red-50 border border-red-300 rounded-md px-2 py-1 text-xs hover:bg-red-100 transition-colors">
                      <div className="font-semibold text-red-900 truncate">⚠ {c.nombre_mascota}</div>
                      <div className="text-red-700 text-[10px] truncate">{c.codigo} · {c.nombre_tutor}</div>
                      <div className="text-red-600 text-[10px] truncate">objetivo: {c.fecha_objetivo_iso}</div>
                    </Link>
                  ))}
                  {col.pendientes.map(c => (
                    <Link href={`/clientes/${c.id}`} key={`p-${c.id}`}
                      className="block bg-yellow-50 border border-yellow-300 rounded-md px-2 py-1 text-xs hover:bg-yellow-100 transition-colors">
                      <div className="font-semibold text-yellow-900 truncate">{c.nombre_mascota}</div>
                      <div className="text-yellow-700 text-[10px] truncate">{c.codigo} · {c.nombre_tutor}</div>
                    </Link>
                  ))}
                  {total === 0 && (
                    <p className="text-[10px] text-gray-400 text-center py-3">Sin entregas</p>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Form */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        <h2 className="text-base font-semibold text-gray-900 mb-5">Nuevo recorrido</h2>
        <form onSubmit={guardar} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium text-gray-700">Fecha</label>
              <input type="date" required value={fecha} onChange={e => setFecha(e.target.value)}
                className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
            <div className="flex items-end">
              <button type="button" onClick={abrirModal}
                className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
                🔍 Seleccionar mascotas
              </button>
            </div>
          </div>

          {seleccionadas.length > 0 && (
            <div className="border border-gray-200 rounded-xl overflow-hidden">
              <div className="divide-y divide-gray-100">
                {seleccionadas.map(c => (
                  <div key={c.id} className="flex items-center justify-between px-4 py-3">
                    <div className="flex-1 min-w-0">
                      <span className="font-mono text-xs text-indigo-700 font-semibold">{c.codigo}</span>
                      <span className="ml-2 text-sm text-gray-900 font-medium">{c.nombre_mascota}</span>
                      <span className="ml-2 text-xs text-gray-500">· {c.nombre_tutor}</span>
                      {c.direccion_despacho && <div className="text-xs text-gray-500 mt-0.5">{c.direccion_despacho}{c.comuna ? ` · ${c.comuna}` : ''}</div>}
                    </div>
                    <button type="button" onClick={() => quitar(c.id)}
                      className="text-red-400 hover:text-red-600 text-xl leading-none w-6 h-6 flex items-center justify-center">×</button>
                  </div>
                ))}
              </div>
              <div className="px-4 py-2.5 bg-gray-50 border-t border-gray-100 text-xs text-gray-600 font-medium">
                {seleccionadas.length} mascota(s)
              </div>
            </div>
          )}

          <div>
            <label className="text-xs font-medium text-gray-700">Nota</label>
            <textarea value={nota} onChange={e => setNota(e.target.value)} rows={2}
              className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none" />
          </div>

          <button type="submit" disabled={saving}
            className="bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50">
            {saving ? 'Guardando...' : 'Guardar recorrido'}
          </button>
        </form>
      </div>

      {/* Historial */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">Rutas de entrega</h2>
        </div>
        {despachos.length === 0 ? (
          <div className="p-8 text-center text-gray-400 text-sm">Sin recorridos registrados</div>
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[680px]">
            <thead className="bg-gray-50">
              <tr>
                {['N° Global', 'N° Recorrido', 'Fecha', 'Estado', 'Entregas', 'Nota', 'Acciones', ''].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-gray-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {despachos.map(d => {
                const estado = (d.estado_ruta || 'guardada') as EstadoRuta
                const total = d.mascotas_ids.length
                const entregadas = d.mascotas_ids.filter(id => d.entregas?.[id]).length
                const badge = ESTADO_BADGE[estado]
                return (
                <Fragment key={d.id}>
                  <tr className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-mono text-xs text-indigo-700 font-bold cursor-pointer" onClick={() => toggleExpandir(d)}>#{d.numero_global || '—'}</td>
                    <td className="px-4 py-3 font-semibold text-gray-900 cursor-pointer" onClick={() => toggleExpandir(d)}>N° {d.numero_recorrido}</td>
                    <td className="px-4 py-3 text-gray-700 cursor-pointer" onClick={() => toggleExpandir(d)}>{formatDate(d.fecha)}</td>
                    <td className="px-4 py-3 cursor-pointer" onClick={() => toggleExpandir(d)}>
                      <span className={`inline-block text-[10px] font-bold uppercase tracking-wide rounded px-1.5 py-0.5 ${badge.cls}`}>{badge.label}</span>
                    </td>
                    <td className="px-4 py-3 cursor-pointer" onClick={() => toggleExpandir(d)}>
                      <span className={entregadas === total && total > 0 ? 'text-green-700 font-semibold' : 'text-gray-700'}>{entregadas}/{total}</span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500 max-w-[12rem] truncate cursor-pointer" onClick={() => toggleExpandir(d)}>{d.nota || '—'}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <button onClick={(e) => { e.stopPropagation(); abrirEditar(d) }}
                          className="bg-emerald-500 hover:bg-emerald-600 text-white px-3 py-1 rounded-md text-xs font-medium transition-colors">
                          Editar
                        </button>
                        <button onClick={(e) => { e.stopPropagation(); eliminar(d.id, d.numero_recorrido) }}
                          className="bg-red-500 hover:bg-red-600 text-white px-3 py-1 rounded-md text-xs font-medium transition-colors">
                          Eliminar
                        </button>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-400 cursor-pointer" onClick={() => toggleExpandir(d)}>{expandido === d.id ? '▲' : '▼'}</td>
                  </tr>
                  {expandido === d.id && (
                    <tr>
                      <td colSpan={8} className="px-6 py-4 bg-gray-50">
                        {/* Barra de acciones de la ruta */}
                        <div className="flex flex-wrap items-center gap-2 mb-3">
                          {estado === 'guardada' && (
                            <button onClick={() => iniciarRuta(d)} disabled={routeBusy === d.id}
                              className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg px-3 py-1.5 disabled:opacity-50">
                              {routeBusy === d.id ? 'Iniciando…' : '▶ Iniciar ruta'}
                            </button>
                          )}
                          {(() => { const url = rutaMapsUrl(d, true); const pend = total - entregadas; return (
                            <a href={url || undefined} target="_blank" rel="noopener noreferrer"
                              onClick={e => { if (!url) { e.preventDefault(); alert('No hay paradas pendientes.') } }}
                              className={`text-xs font-semibold rounded-lg px-3 py-1.5 ${pend > 0 ? 'bg-green-600 hover:bg-green-700 text-white' : 'bg-gray-200 text-gray-400 cursor-not-allowed'}`}>
                              🗺 Abrir en Maps ({pend} {pend === 1 ? 'pendiente' : 'pendientes'})
                            </a>
                          ) })()}
                          {estado !== 'terminada' && (
                            <button onClick={() => terminarRuta(d)} disabled={routeBusy === d.id}
                              className="bg-slate-700 hover:bg-slate-800 text-white text-xs font-semibold rounded-lg px-3 py-1.5 disabled:opacity-50">
                              🏁 Terminar ruta
                            </button>
                          )}
                          <span className="text-[11px] text-gray-500 ml-auto">
                            {d.hora_inicio_ruta && <>Inicio {horaCorta(d.hora_inicio_ruta)}</>}
                            {d.hora_inicio_ruta && d.hora_termino_ruta && <> · Término {horaCorta(d.hora_termino_ruta)} · {duracion(d.hora_inicio_ruta, d.hora_termino_ruta)}</>}
                          </span>
                        </div>

                        {/* Paradas en orden con toggle de entrega */}
                        <div className="border border-gray-200 rounded-lg overflow-hidden bg-white">
                          {paradasOrdenadas(d, false).map((p, i) => {
                            const m = clientesMap[p.cliente_id]
                            const ent = d.entregas?.[p.cliente_id]
                            const busy = routeBusy === d.id + ':' + p.cliente_id
                            return (
                              <div key={p.cliente_id} className={`flex items-start gap-3 px-3 py-2 border-t first:border-t-0 border-gray-100 ${ent ? 'bg-green-50/50' : ''}`}>
                                <span className="shrink-0 w-6 h-6 bg-indigo-600 text-white text-xs font-bold rounded-full flex items-center justify-center">{i + 1}</span>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className="font-semibold text-sm text-gray-900">{m?.nombre_mascota ?? p.cliente_id}</span>
                                    <span className="text-xs text-gray-500 font-mono">{m?.codigo ?? ''}</span>
                                    {ent && <span className="text-[10px] uppercase font-bold bg-green-100 text-green-800 rounded px-1.5 py-0.5">Entregada {horaCorta(ent.fecha_hora)}</span>}
                                  </div>
                                  <div className="text-xs text-gray-600 truncate">{m?.nombre_tutor ?? '—'} · {m?.telefono || 'sin teléfono'}</div>
                                  <div className="text-xs text-gray-500 truncate">{p.direccion || [m?.direccion_despacho, m?.comuna].filter(Boolean).join(', ') || '—'}</div>
                                </div>
                                <button onClick={() => toggleEntrega(d, p.cliente_id, !!ent)} disabled={busy}
                                  className={`shrink-0 text-xs font-semibold rounded-lg px-3 py-1.5 transition-colors disabled:opacity-50 ${ent ? 'bg-gray-100 text-gray-600 hover:bg-gray-200' : 'bg-green-600 hover:bg-green-700 text-white'}`}>
                                  {busy ? '…' : ent ? 'Deshacer' : '✓ Entregar'}
                                </button>
                              </div>
                            )
                          })}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
                )
              })}
            </tbody>
          </table>
          </div>
        )}
      </div>

      {/* Modal selección */}
      <Modal open={showModal} onClose={() => setShowModal(false)} title="Mascotas cremadas disponibles para despacho">
        <div className="space-y-3">
          <input
            type="text"
            placeholder="Filtrar por nombre, código, tutor, dirección o comuna..."
            value={buscar}
            onChange={e => setBuscar(e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          {cargando ? (
            <p className="text-sm text-gray-400 text-center py-4">Cargando...</p>
          ) : disponiblesFiltradas.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-4">Sin mascotas disponibles para despacho</p>
          ) : (
            <div className="max-h-80 overflow-y-auto divide-y divide-gray-100 border border-gray-200 rounded-lg">
              {disponiblesFiltradas.map(c => {
                const isSelected = seleccionadas.some(s => s.id === c.id)
                return (
                  <label key={c.id} className={`flex items-start gap-3 px-4 py-3 cursor-pointer hover:bg-gray-50 transition-colors ${isSelected ? 'bg-indigo-50' : ''}`}>
                    <input type="checkbox" checked={isSelected} onChange={() => toggle(c)}
                      className="w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <div>
                        <span className="font-mono text-xs text-indigo-700 font-semibold">{c.codigo}</span>
                        <span className="ml-2 text-sm text-gray-900 font-medium">{c.nombre_mascota}</span>
                        <span className="ml-1 text-xs text-gray-500">({c.nombre_tutor})</span>
                      </div>
                      {c.direccion_despacho && (
                        <div className="text-xs text-gray-500 mt-0.5">{c.direccion_despacho}{c.comuna ? ` · ${c.comuna}` : ''}</div>
                      )}
                    </div>
                  </label>
                )
              })}
            </div>
          )}
          <div className="flex items-center justify-between pt-2 border-t border-gray-100">
            <span className="text-xs text-gray-500">{seleccionadas.length} seleccionada(s)</span>
            <button
              onClick={() => setShowModal(false)}
              className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
            >
              Confirmar selección
            </button>
          </div>
        </div>
      </Modal>

      {/* Modal editar despacho */}
      <Modal open={!!editId} onClose={() => setEditId(null)} title="Editar recorrido">
        <form onSubmit={guardarEdicion} className="space-y-4">
          <div>
            <label className="text-xs font-semibold text-gray-700">Fecha</label>
            <input type="date" required value={editFecha} onChange={e => setEditFecha(e.target.value)}
              className="mt-1 w-full border-2 border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>

          <div>
            <label className="text-xs font-semibold text-gray-700">Nota</label>
            <textarea rows={2} value={editNota} onChange={e => setEditNota(e.target.value)}
              className="mt-1 w-full border-2 border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none" />
          </div>

          <div>
            <label className="text-xs font-semibold text-gray-700">
              Mascotas asignadas ({editMascotas.length})
            </label>
            <div className="mt-1 border-2 border-gray-300 rounded-lg divide-y divide-gray-100 max-h-48 overflow-y-auto">
              {editMascotas.length === 0 ? (
                <p className="text-xs text-gray-400 text-center py-3">Ninguna mascota asignada</p>
              ) : editMascotas.map(c => (
                <div key={c.id} className="flex items-center justify-between px-3 py-2">
                  <div className="flex-1 min-w-0">
                    <span className="font-mono text-xs text-indigo-700 font-semibold">{c.codigo}</span>
                    <span className="ml-2 text-sm text-gray-900">{c.nombre_mascota}</span>
                    <span className="ml-1 text-xs text-gray-500">({c.nombre_tutor})</span>
                  </div>
                  <button type="button" onClick={() => quitarEdit(c.id)}
                    className="text-red-500 hover:text-red-700 text-lg leading-none w-6 h-6 flex items-center justify-center">×</button>
                </div>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-gray-700">Agregar mascotas (cremadas disponibles)</label>
            <input type="text" placeholder="Buscar..." value={editBuscar} onChange={e => setEditBuscar(e.target.value)}
              className="mt-1 w-full border-2 border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            <div className="mt-2 max-h-48 overflow-y-auto divide-y divide-gray-100 border-2 border-gray-200 rounded-lg">
              {editDisponiblesFiltradas.length === 0 ? (
                <p className="text-xs text-gray-400 text-center py-3">Sin mascotas disponibles</p>
              ) : editDisponiblesFiltradas.map(c => (
                <button type="button" key={c.id} onClick={() => agregarEdit(c)}
                  className="w-full text-left px-3 py-2 hover:bg-emerald-50 transition-colors">
                  <span className="font-mono text-xs text-indigo-700 font-semibold">{c.codigo}</span>
                  <span className="ml-2 text-sm text-gray-900">{c.nombre_mascota}</span>
                  <span className="ml-1 text-xs text-gray-500">({c.nombre_tutor})</span>
                </button>
              ))}
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={() => setEditId(null)}
              className="flex-1 border-2 border-gray-300 text-gray-700 rounded-lg py-2 text-sm font-semibold hover:bg-gray-50 transition-colors">
              Cancelar
            </button>
            <button type="submit" disabled={savingEdit}
              className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg py-2 text-sm font-semibold shadow-md transition-colors disabled:opacity-50">
              {savingEdit ? 'Guardando...' : 'Guardar cambios'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Modal: Optimizador de ruta */}
      <Modal open={optimOpen} onClose={() => setOptimOpen(false)} title="Optimizar ruta de despachos">
        <div className="space-y-4">
          {/* Form */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Dirección de origen</label>
              <AddressAutocomplete
                value={optimOrigin}
                onChange={setOptimOrigin}
                placeholder="Ej. Av. Apoquindo 4700, Las Condes"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Dirección de fin (opcional)</label>
              <AddressAutocomplete
                value={optimDest}
                onChange={setOptimDest}
                placeholder="Vacío = vuelve al origen"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Fecha de la ruta</label>
              <input
                type="date"
                value={optimFechaBase}
                onChange={e => setOptimFechaBase(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
              />
              <p className="text-[10px] text-gray-500 mt-0.5">Obligatorias = entregas que vencen hasta esta fecha</p>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Máximo desvío para sugeridas: <span className="font-bold text-indigo-700">{optimMaxDetour} min</span>
              </label>
              <input
                type="range" min={0} max={30} step={1}
                value={optimMaxDetour}
                onChange={e => setOptimMaxDetour(parseInt(e.target.value))}
                className="w-full"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Días hábiles a futuro para buscar sugeridas: <span className="font-bold text-indigo-700">{optimDiasRec}</span>
              </label>
              <input
                type="range" min={1} max={5} step={1}
                value={optimDiasRec}
                onChange={e => setOptimDiasRec(parseInt(e.target.value))}
                className="w-full"
              />
            </div>
          </div>

          <button
            type="button"
            onClick={() => optimCalcular()}
            disabled={optimLoading || !optimOrigin.trim()}
            className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-lg py-2.5 text-sm shadow-md transition-colors disabled:opacity-50"
          >
            {optimLoading ? 'Calculando ruta…' : 'Calcular ruta'}
          </button>

          {optimError && (
            <div className="bg-red-50 border border-red-200 text-red-800 rounded-lg px-3 py-2 text-sm whitespace-pre-wrap font-mono text-[11px]">
              {optimError}
            </div>
          )}

          {optimResult && (
            <div className="space-y-3">
              {/* Origen/destino formateados */}
              <div className="text-xs text-gray-600 bg-gray-50 rounded-lg px-3 py-2 border border-gray-200">
                <div><span className="font-semibold text-gray-700">Origen:</span> {optimResult.origin.address}</div>
                <div><span className="font-semibold text-gray-700">Destino:</span> {optimResult.destination.address}</div>
              </div>

              {/* Ruta obligatoria */}
              <div className="border border-indigo-200 rounded-lg overflow-hidden">
                <div className="bg-indigo-50 px-3 py-2 flex items-center justify-between">
                  <div className="font-semibold text-indigo-900 text-sm">
                    Ruta obligatoria · {optimResult.obligatorias.length} {optimResult.obligatorias.length === 1 ? 'parada' : 'paradas'}
                  </div>
                  <div className="text-xs text-indigo-700">
                    {optimResult.baseline.distance_km} km · {optimResult.baseline.duration_minutes} min
                  </div>
                </div>
                {optimResult.obligatorias.length === 0 ? (
                  <div className="px-3 py-4 text-center text-sm text-gray-500">Sin entregas pendientes para hoy</div>
                ) : (
                  <ul className="divide-y divide-gray-100">
                    {optimResult.obligatorias.map(o => (
                      <li key={o.cliente_id} className="px-3 py-2 flex items-start gap-3">
                        <span className="shrink-0 w-6 h-6 bg-indigo-600 text-white text-xs font-bold rounded-full flex items-center justify-center">{o.order}</span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold text-sm text-gray-900">{o.nombre_mascota}</span>
                            <span className="text-xs text-gray-500">{o.codigo}</span>
                            {o.atrasada && <span className="text-[10px] uppercase font-bold bg-red-100 text-red-800 rounded px-1.5 py-0.5">Atrasada</span>}
                          </div>
                          <div className="text-xs text-gray-600 truncate">{o.nombre_tutor} · {o.telefono || 'sin teléfono'}</div>
                          <div className="text-xs text-gray-500 truncate">{o.formatted_address}</div>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Candidatas */}
              {optimResult.candidatas.length > 0 ? (
                <div className="border border-amber-200 rounded-lg overflow-hidden">
                  <div className="bg-amber-50 px-3 py-2 font-semibold text-amber-900 text-sm flex items-center justify-between">
                    <span>Sugeridas para sumar · {optimResult.candidatas.length} (desvío ≤ {optimMaxDetour} min)</span>
                  </div>
                  <ul className="divide-y divide-gray-100">
                    {optimResult.candidatas.map(c => (
                      <li key={c.cliente_id} className="px-3 py-2 flex items-start gap-3">
                        <input
                          type="checkbox"
                          checked={optimPicks.has(c.cliente_id)}
                          onChange={() => optimToggle(c.cliente_id)}
                          className="mt-1 w-4 h-4 text-indigo-600 rounded"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold text-sm text-gray-900">{c.nombre_mascota}</span>
                            <span className="text-xs text-gray-500">{c.codigo}</span>
                            <span className="text-[10px] uppercase font-medium bg-gray-100 text-gray-700 rounded px-1.5 py-0.5">
                              objetivo: {c.fecha_objetivo_dmy}
                            </span>
                            <span className="text-[10px] uppercase font-bold rounded px-1.5 py-0.5 bg-green-100 text-green-800">
                              +{c.detour_minutes} min
                            </span>
                          </div>
                          <div className="text-xs text-gray-600 truncate">{c.nombre_tutor} · {c.telefono || 'sin teléfono'}</div>
                          <div className="text-xs text-gray-500 truncate">{c.formatted_address}</div>
                        </div>
                      </li>
                    ))}
                  </ul>
                  {optimPicks.size > 0 && (
                    <div className="bg-amber-50/50 border-t border-amber-200 px-3 py-2">
                      <button
                        type="button"
                        onClick={optimReoptimizarConSugeridas}
                        disabled={optimLoading}
                        className="w-full bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold rounded-lg py-2 disabled:opacity-50 transition-colors"
                      >
                        {optimLoading ? 'Re-optimizando…' : `Re-optimizar incluyendo ${optimPicks.size} sugerida${optimPicks.size === 1 ? '' : 's'} marcada${optimPicks.size === 1 ? '' : 's'}`}
                      </button>
                      <p className="text-[10px] text-amber-700 mt-1 text-center">Las sugeridas marcadas se promueven a obligatorias y la ruta se recalcula en orden óptimo.</p>
                    </div>
                  )}
                </div>
              ) : (
                <div className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-xs text-gray-600">
                  No hay sugeridas dentro del umbral de {optimMaxDetour} min de desvío. Subí el slider para considerar más opciones.
                </div>
              )}

              {/* Retiros en crematorio */}
              {optimResult.retiros_crematorio && optimResult.retiros_crematorio.length > 0 && (
                <div className="border border-emerald-200 rounded-lg overflow-hidden">
                  <div className="bg-emerald-50 px-3 py-2 font-semibold text-emerald-900 text-sm flex items-center justify-between">
                    <span>Retiros en crematorio · {optimResult.retiros_crematorio.length}</span>
                    <span className="text-[10px] font-normal text-emerald-700 uppercase tracking-wider">no van en la ruta</span>
                  </div>
                  <ul className="divide-y divide-gray-100">
                    {optimResult.retiros_crematorio.map(r => (
                      <li key={r.cliente_id} className="px-3 py-2 flex items-start gap-3">
                        <span className="shrink-0 w-6 h-6 bg-emerald-100 text-emerald-700 text-sm rounded-full flex items-center justify-center" title="Retiro en local">🏠</span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold text-sm text-gray-900">{r.nombre_mascota}</span>
                            <span className="text-xs text-gray-500">{r.codigo}</span>
                            <span className="text-[10px] uppercase font-medium bg-emerald-100 text-emerald-800 rounded px-1.5 py-0.5">
                              objetivo: {r.fecha_objetivo_dmy}
                            </span>
                            {r.atrasada && <span className="text-[10px] uppercase font-bold bg-red-100 text-red-800 rounded px-1.5 py-0.5">Atrasada</span>}
                          </div>
                          <div className="text-xs text-gray-600 truncate">{r.nombre_tutor} · {r.telefono || 'sin teléfono'}</div>
                          <div className="text-xs text-gray-500 truncate italic">El tutor retira en el crematorio</div>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Skipped */}
              {optimResult.skipped.length > 0 && (
                <div className="border border-gray-200 rounded-lg overflow-hidden">
                  <div className="bg-gray-50 px-3 py-2 font-semibold text-gray-700 text-sm">
                    No procesadas · {optimResult.skipped.length}
                  </div>
                  <ul className="divide-y divide-gray-100">
                    {optimResult.skipped.map((s, i) => (
                      <li key={i} className="px-3 py-2 text-xs">
                        <span className="font-semibold text-gray-700">{s.codigo || '(sin código)'}</span>
                        <span className="text-gray-500"> — {s.motivo}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Acción final */}
              <div className="flex flex-col sm:flex-row gap-2">
                <a
                  href={optimGmapsUrl()}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 text-center bg-green-600 hover:bg-green-700 text-white font-semibold rounded-lg py-2.5 text-sm shadow-md transition-colors"
                >
                  Abrir en Google Maps ({optimResult.obligatorias.length + optimPicks.size} {optimResult.obligatorias.length + optimPicks.size === 1 ? 'parada' : 'paradas'})
                </a>
                <button
                  type="button"
                  onClick={optimGuardarRuta}
                  disabled={saving || (optimResult.obligatorias.length + optimPicks.size === 0)}
                  className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-lg py-2.5 text-sm shadow-md transition-colors disabled:opacity-50"
                >
                  {saving ? 'Guardando…' : '💾 Guardar ruta'}
                </button>
              </div>
              <p className="text-[11px] text-gray-500 text-center">Guardar la ruta te permite seguirla, marcar entregas e ir avisando a cada tutor.</p>
            </div>
          )}
        </div>
      </Modal>
    </>
  )
}

const ESTADO_BADGE: Record<EstadoRuta, { label: string; cls: string }> = {
  guardada: { label: 'Guardada', cls: 'bg-gray-100 text-gray-600' },
  en_curso: { label: 'En curso', cls: 'bg-amber-100 text-amber-800' },
  terminada: { label: 'Terminada', cls: 'bg-green-100 text-green-800' },
}

/** "HH:MM" en hora local a partir de un ISO. Vacío si no parsea. */
function horaCorta(iso?: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** Duración legible entre dos ISO, ej. "1 h 25 min". */
function duracion(inicioIso?: string, finIso?: string): string {
  if (!inicioIso || !finIso) return ''
  const a = new Date(inicioIso).getTime()
  const b = new Date(finIso).getTime()
  if (isNaN(a) || isNaN(b) || b < a) return ''
  const min = Math.round((b - a) / 60000)
  if (min < 60) return `${min} min`
  return `${Math.floor(min / 60)} h ${min % 60} min`
}
