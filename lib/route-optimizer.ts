import { getSheetData } from '@/lib/google-sheets'
import { agregarDiasHabiles, isoFecha, proximosDiasHabiles } from '@/lib/dias-habiles'
import { formatDate, formatDateForSheet } from '@/lib/dates'
import { geocodeAddress, computeRoute, buildGoogleMapsUrl, type LatLng } from '@/lib/google-maps'

export interface ParadaCliente {
  cliente_id: string
  codigo: string
  nombre_mascota: string
  nombre_tutor: string
  direccion: string
  formatted_address: string
  lat: number
  lng: number
  fecha_objetivo_iso: string
  fecha_objetivo_dmy: string
  atrasada: boolean
  veterinaria: string
  telefono: string
}

export interface ParadaObligatoria extends ParadaCliente {
  order: number
}

export interface ParadaCandidata extends ParadaCliente {
  detour_minutes: number
  recommended: boolean
}

export interface OptimizadorOpts {
  origin_address: string
  destination_address?: string
  max_detour_minutes?: number
  dias_recomendadas?: number
  /** Fecha base de la ruta (ISO YYYY-MM-DD). Si vacío, usa hoy. Obligatorias = fecha_objetivo <= fecha_base. */
  fecha_base?: string
  /** IDs de clientes (candidatas) que se promueven a obligatorias para re-optimizar con ellas dentro. */
  incluir_extras_ids?: string[]
}

export interface OptimizadorResult {
  origin: { address: string; lat: number; lng: number }
  destination: { address: string; lat: number; lng: number }
  obligatorias: ParadaObligatoria[]
  candidatas: ParadaCandidata[]
  baseline: {
    distance_km: number
    duration_minutes: number
    google_maps_url: string
  }
  skipped: Array<{ cliente_id: string; codigo: string; motivo: string }>
}

interface ClienteRow extends Record<string, string> {
  id: string
  codigo: string
  nombre_mascota: string
  nombre_tutor: string
  direccion_despacho: string
  fecha_retiro: string
  codigo_servicio: string
  estado: string
  veterinaria_id: string
  telefono: string
}

async function clasificarClientes(opts: { dias_recomendadas: number; fecha_base_iso: string; incluir_extras_ids: Set<string> }): Promise<{
  obligatorias: ClienteRow[]
  candidatas: ClienteRow[]
  plazoMap: Map<string, number>
}> {
  const [clientes, tiposServicio, veterinarios] = await Promise.all([
    getSheetData('clientes'),
    getSheetData('tipos_servicio'),
    getSheetData('veterinarios'),
  ])

  const plazoMap = new Map<string, number>()
  for (const t of tiposServicio) {
    const n = parseInt(t.plazo_entrega_dias || '0', 10)
    plazoMap.set((t.codigo || '').toUpperCase(), Number.isFinite(n) && n > 0 ? n : 3)
  }

  const vetById = new Map<string, string>()
  for (const v of veterinarios) vetById.set(v.id, v.nombre || '')

  const fechaBaseIso = opts.fecha_base_iso
  const fechaBaseDate = new Date(`${fechaBaseIso}T12:00:00`)
  const limiteDias = proximosDiasHabiles(fechaBaseDate, opts.dias_recomendadas + 1)
  const isoLimite = isoFecha(limiteDias[limiteDias.length - 1])

  const obligatorias: ClienteRow[] = []
  const candidatas: ClienteRow[] = []

  for (const c of clientes as ClienteRow[]) {
    if (c.estado === 'despachado') continue
    const codigo = (c.codigo_servicio || 'CI').toUpperCase()
    if (codigo === 'SD') continue
    if (!c.fecha_retiro) continue
    if (!c.direccion_despacho || !c.direccion_despacho.trim()) continue

    const isoRetiro = formatDateForSheet(c.fecha_retiro)
    if (!isoRetiro) continue
    const fechaRetiro = new Date(`${isoRetiro}T12:00:00`)
    if (isNaN(fechaRetiro.getTime())) continue
    const plazo = plazoMap.get(codigo) ?? 3
    const fechaObjetivo = agregarDiasHabiles(fechaRetiro, plazo)
    const isoObj = isoFecha(fechaObjetivo)

    const enriched: ClienteRow = { ...c, veterinaria_id: vetById.get(c.veterinaria_id) || c.veterinaria_id }

    // Si el cliente está marcado para incluir como extra, va directo a obligatorias
    if (opts.incluir_extras_ids.has(c.id)) {
      obligatorias.push(enriched)
      continue
    }

    if (isoObj <= fechaBaseIso) {
      obligatorias.push(enriched)
    } else if (isoObj <= isoLimite) {
      candidatas.push(enriched)
    }
  }

  return { obligatorias, candidatas, plazoMap }
}

async function geocodearClientes(
  rows: ClienteRow[],
  skipped: Array<{ cliente_id: string; codigo: string; motivo: string }>,
): Promise<Array<{ row: ClienteRow; geo: { lat: number; lng: number; formatted_address: string } }>> {
  const out: Array<{ row: ClienteRow; geo: { lat: number; lng: number; formatted_address: string } }> = []
  for (const r of rows) {
    const geo = await geocodeAddress(r.direccion_despacho)
    if (!geo) {
      skipped.push({ cliente_id: r.id, codigo: r.codigo, motivo: `No se pudo geocodear "${r.direccion_despacho}"` })
      continue
    }
    out.push({ row: r, geo: { lat: geo.lat, lng: geo.lng, formatted_address: geo.formatted_address } })
  }
  return out
}

function toParada(
  c: { row: ClienteRow; geo: { lat: number; lng: number; formatted_address: string } },
  plazoMap: Map<string, number>,
  fechaBaseIso: string,
): ParadaCliente {
  const codigo = (c.row.codigo_servicio || 'CI').toUpperCase()
  const isoRetiro = formatDateForSheet(c.row.fecha_retiro) || ''
  const fechaRetiro = new Date(`${isoRetiro}T12:00:00`)
  const plazo = plazoMap.get(codigo) ?? 3
  const fechaObjetivo = agregarDiasHabiles(fechaRetiro, plazo)
  const isoObj = isoFecha(fechaObjetivo)
  return {
    cliente_id: c.row.id,
    codigo: c.row.codigo,
    nombre_mascota: c.row.nombre_mascota,
    nombre_tutor: c.row.nombre_tutor,
    direccion: c.row.direccion_despacho,
    formatted_address: c.geo.formatted_address,
    lat: c.geo.lat,
    lng: c.geo.lng,
    fecha_objetivo_iso: isoObj,
    fecha_objetivo_dmy: formatDate(isoObj) || '',
    atrasada: isoObj < fechaBaseIso,
    veterinaria: c.row.veterinaria_id,
    telefono: c.row.telefono || '',
  }
}

export async function optimizarRuta(opts: OptimizadorOpts): Promise<OptimizadorResult> {
  const maxDetour = opts.max_detour_minutes ?? 10
  const diasRec = opts.dias_recomendadas ?? 3
  const fechaBaseIso = (opts.fecha_base && /^\d{4}-\d{2}-\d{2}$/.test(opts.fecha_base))
    ? opts.fecha_base
    : isoFecha(new Date())
  const incluirExtras = new Set(opts.incluir_extras_ids ?? [])

  const originGeo = await geocodeAddress(opts.origin_address)
  if (!originGeo) throw new Error(`No se pudo geocodear el origen: "${opts.origin_address}"`)

  const destAddress = opts.destination_address?.trim() || opts.origin_address
  const destGeo = await geocodeAddress(destAddress)
  if (!destGeo) throw new Error(`No se pudo geocodear el destino: "${destAddress}"`)

  const origin: LatLng = { lat: originGeo.lat, lng: originGeo.lng }
  const destination: LatLng = { lat: destGeo.lat, lng: destGeo.lng }

  const { obligatorias: obligatoriasRows, candidatas: candidatasRows, plazoMap } = await clasificarClientes({
    dias_recomendadas: diasRec,
    fecha_base_iso: fechaBaseIso,
    incluir_extras_ids: incluirExtras,
  })

  const skipped: OptimizadorResult['skipped'] = []
  const obligatoriasGeo = await geocodearClientes(obligatoriasRows, skipped)
  const candidatasGeo = await geocodearClientes(candidatasRows, skipped)

  if (obligatoriasGeo.length > 23) {
    skipped.push({
      cliente_id: '',
      codigo: '',
      motivo: `Hay ${obligatoriasGeo.length} obligatorias pero Routes API limita a 25 waypoints. Tomamos las primeras 23 por fecha_objetivo.`,
    })
    obligatoriasGeo.sort((a, b) => {
      const ao = a.row.fecha_retiro || ''
      const bo = b.row.fecha_retiro || ''
      return ao < bo ? -1 : ao > bo ? 1 : 0
    })
    obligatoriasGeo.length = 23
  }

  // 1. Baseline = ruta optima con solo obligatorias
  let baselineDuration = 0
  let baselineDistance = 0
  let optimizedOrder: number[] = []
  if (obligatoriasGeo.length === 0) {
    const r = await computeRoute({ origin, destination, intermediates: [] })
    baselineDuration = r.duration_seconds
    baselineDistance = r.distance_meters
  } else {
    const r = await computeRoute({
      origin,
      destination,
      intermediates: obligatoriasGeo.map(c => ({ lat: c.geo.lat, lng: c.geo.lng })),
      optimize: true,
    })
    baselineDuration = r.duration_seconds
    baselineDistance = r.distance_meters
    optimizedOrder = r.optimized_order.length > 0 ? r.optimized_order : obligatoriasGeo.map((_, i) => i)
  }

  const obligatorias: ParadaObligatoria[] = optimizedOrder.map((origIdx, i) => ({
    ...toParada(obligatoriasGeo[origIdx], plazoMap, fechaBaseIso),
    order: i + 1,
  }))
  if (obligatorias.length === 0 && obligatoriasGeo.length > 0) {
    obligatoriasGeo.forEach((c, i) => obligatorias.push({ ...toParada(c, plazoMap, fechaBaseIso), order: i + 1 }))
  }

  // 2. Para cada candidata, calcular el costo marginal de incluirla
  const candidatas: ParadaCandidata[] = []
  for (const c of candidatasGeo) {
    const intermediates = [
      ...obligatoriasGeo.map(x => ({ lat: x.geo.lat, lng: x.geo.lng })),
      { lat: c.geo.lat, lng: c.geo.lng },
    ]
    try {
      const r = await computeRoute({ origin, destination, intermediates, optimize: true })
      const detourSeconds = r.duration_seconds - baselineDuration
      const detourMinutes = Math.max(0, Math.round(detourSeconds / 60))
      candidatas.push({
        ...toParada(c, plazoMap, fechaBaseIso),
        detour_minutes: detourMinutes,
        recommended: detourMinutes <= maxDetour,
      })
    } catch (err) {
      console.warn('[optimizer] candidata falló:', c.row.codigo, err)
      skipped.push({ cliente_id: c.row.id, codigo: c.row.codigo, motivo: `Routes API falló: ${String(err).slice(0, 80)}` })
    }
  }

  // Filtrar candidatas que exceden el umbral de desvío — solo mostrar las que valen la pena
  const candidatasFiltradas = candidatas
    .filter(c => c.detour_minutes <= maxDetour)
    .sort((a, b) => a.detour_minutes - b.detour_minutes)

  const waypointsOptim: LatLng[] = obligatorias.map(o => ({ lat: o.lat, lng: o.lng }))
  const gmapsUrl = buildGoogleMapsUrl(origin, destination, waypointsOptim)

  return {
    origin: { address: originGeo.formatted_address, lat: origin.lat, lng: origin.lng },
    destination: { address: destGeo.formatted_address, lat: destination.lat, lng: destination.lng },
    obligatorias,
    candidatas: candidatasFiltradas,
    baseline: {
      distance_km: +(baselineDistance / 1000).toFixed(2),
      duration_minutes: Math.round(baselineDuration / 60),
      google_maps_url: gmapsUrl,
    },
    skipped,
  }
}
