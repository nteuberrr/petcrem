import { getSheetData, appendRow, ensureSheet, ensureColumns } from '@/lib/google-sheets'
import { todayISO } from '@/lib/dates'

const CACHE_SHEET = 'geocoding_cache'
const CACHE_COLS = ['id', 'direccion_normalizada', 'direccion_original', 'lat', 'lng', 'formatted_address', 'fecha_creacion']

function getApiKey(): string {
  const k = process.env.GOOGLE_MAPS_API_KEY
  if (!k) throw new Error('GOOGLE_MAPS_API_KEY no configurada')
  return k
}

export function normalizarDireccion(d: string): string {
  return d.trim().toLowerCase().replace(/\s+/g, ' ').replace(/[.,;]/g, '')
}

export interface GeocodeResult {
  lat: number
  lng: number
  formatted_address: string
  from_cache: boolean
}

let cacheMemoMap: Map<string, { lat: number; lng: number; formatted_address: string }> | null = null
let cacheMaxId = 0

async function loadCache(): Promise<Map<string, { lat: number; lng: number; formatted_address: string }>> {
  if (cacheMemoMap) return cacheMemoMap
  await ensureSheet(CACHE_SHEET)
  await ensureColumns(CACHE_SHEET, CACHE_COLS)
  const rows = await getSheetData(CACHE_SHEET)
  const m = new Map<string, { lat: number; lng: number; formatted_address: string }>()
  let maxId = 0
  for (const r of rows) {
    const norm = r.direccion_normalizada
    const lat = parseFloat(r.lat)
    const lng = parseFloat(r.lng)
    if (norm && Number.isFinite(lat) && Number.isFinite(lng)) {
      m.set(norm, { lat, lng, formatted_address: r.formatted_address || '' })
    }
    const id = parseInt(r.id || '0', 10)
    if (Number.isFinite(id) && id > maxId) maxId = id
  }
  cacheMemoMap = m
  cacheMaxId = maxId
  return m
}

export function invalidarCacheMemo() {
  cacheMemoMap = null
  cacheMaxId = 0
}

export async function geocodeAddress(direccion: string): Promise<GeocodeResult | null> {
  if (!direccion || !direccion.trim()) return null
  const norm = normalizarDireccion(direccion)
  const cache = await loadCache()
  const hit = cache.get(norm)
  if (hit) {
    return { lat: hit.lat, lng: hit.lng, formatted_address: hit.formatted_address, from_cache: true }
  }

  const url = new URL('https://maps.googleapis.com/maps/api/geocode/json')
  url.searchParams.set('address', direccion)
  url.searchParams.set('region', 'cl')
  url.searchParams.set('language', 'es')
  url.searchParams.set('key', getApiKey())
  const res = await fetch(url.toString())
  const j = await res.json()
  if (j.status !== 'OK' || !j.results?.[0]) {
    console.warn('[maps] geocode no encontró:', direccion, '→', j.status, j.error_message ?? '')
    return null
  }
  const loc = j.results[0].geometry.location
  const formatted = j.results[0].formatted_address
  const lat = loc.lat
  const lng = loc.lng

  try {
    cacheMaxId += 1
    const id = String(cacheMaxId)
    await appendRow(CACHE_SHEET, {
      id,
      direccion_normalizada: norm,
      direccion_original: direccion,
      lat,
      lng,
      formatted_address: formatted,
      fecha_creacion: todayISO(),
    })
    cache.set(norm, { lat, lng, formatted_address: formatted })
  } catch (err) {
    console.error('[maps] error guardando en cache:', err)
  }

  return { lat, lng, formatted_address: formatted, from_cache: false }
}

export interface LatLng {
  lat: number
  lng: number
}

export interface RouteResult {
  /** Distancia total en metros */
  distance_meters: number
  /** Duración total en segundos */
  duration_seconds: number
  /** Polyline codificada (formato Google) */
  encoded_polyline: string
  /** Orden de los waypoints intermedios optimizados (índices del input original) */
  optimized_order: number[]
}

export interface RouteOptions {
  origin: LatLng
  destination: LatLng
  /** Waypoints intermedios. Si optimize=true, la API decide el orden */
  intermediates?: LatLng[]
  optimize?: boolean
  /** ISO timestamp de salida (para tráfico). Si vacío, usa "ahora" */
  departure_time?: string
}

/** Considera dos coords iguales si difieren <10m (~ 0.0001° latitud) */
function mismaCoord(a: LatLng, b: LatLng): boolean {
  return Math.abs(a.lat - b.lat) < 1e-4 && Math.abs(a.lng - b.lng) < 1e-4
}

/** Chile continental: lat -56..-17, lng -76..-66. Filtra geocodes basura. */
export function coordEnChile(p: LatLng): boolean {
  if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) return false
  return p.lat >= -56 && p.lat <= -17 && p.lng >= -76 && p.lng <= -66
}

function fmtCoord(p: LatLng): string {
  return `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`
}

async function llamarRoutesApi(body: Record<string, unknown>): Promise<{ status: number; json: Record<string, unknown> }> {
  const url = 'https://routes.googleapis.com/directions/v2:computeRoutes'
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': getApiKey(),
      'X-Goog-FieldMask': 'routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline,routes.optimizedIntermediateWaypointIndex',
    },
    body: JSON.stringify(body),
  })
  const json = await res.json().catch(() => ({}))
  return { status: res.status, json }
}

export async function computeRoute(opts: RouteOptions): Promise<RouteResult> {
  const hasIntermediates = !!(opts.intermediates && opts.intermediates.length > 0)
  // Caso degenerado: origen == destino y sin paradas. La Routes API devuelve
  // `200 {}` (sin la propiedad routes) porque no hay ruta que computar.
  if (mismaCoord(opts.origin, opts.destination) && !hasIntermediates) {
    return { distance_meters: 0, duration_seconds: 0, encoded_polyline: '', optimized_order: [] }
  }

  const body: Record<string, unknown> = {
    origin:      { location: { latLng: { latitude: opts.origin.lat, longitude: opts.origin.lng } } },
    destination: { location: { latLng: { latitude: opts.destination.lat, longitude: opts.destination.lng } } },
    travelMode: 'DRIVE',
    routingPreference: 'TRAFFIC_AWARE',
    languageCode: 'es-CL',
    units: 'METRIC',
  }
  if (hasIntermediates) {
    body.intermediates = opts.intermediates!.map(w => ({ location: { latLng: { latitude: w.lat, longitude: w.lng } } }))
    if (opts.optimize) body.optimizeWaypointOrder = true
  }
  if (opts.departure_time) {
    body.departureTime = opts.departure_time
  }

  // Validar coords: si alguna queda fuera de Chile, Routes API responde 200 {}.
  const fueraDeChile: string[] = []
  if (!coordEnChile(opts.origin)) fueraDeChile.push(`origen (${fmtCoord(opts.origin)})`)
  if (!coordEnChile(opts.destination)) fueraDeChile.push(`destino (${fmtCoord(opts.destination)})`)
  if (opts.intermediates) {
    opts.intermediates.forEach((w, i) => {
      if (!coordEnChile(w)) fueraDeChile.push(`parada ${i + 1} (${fmtCoord(w)})`)
    })
  }
  if (fueraDeChile.length > 0) {
    throw new Error(`Coordenadas fuera de Chile: ${fueraDeChile.join(', ')}. Revisá las direcciones que geocodearon a esa ubicación.`)
  }

  let { status, json: j } = await llamarRoutesApi(body)

  // Routes API a veces devuelve 200 {} con optimizeWaypointOrder=true. Probamos sin.
  let routes = j.routes as Array<Record<string, unknown>> | undefined
  if (status === 200 && !routes?.[0] && body.optimizeWaypointOrder) {
    console.warn('[google-maps] Routes API 200 vacío con optimize=true — retry sin optimize', {
      intermediates: hasIntermediates ? opts.intermediates!.length : 0,
      roundtrip: mismaCoord(opts.origin, opts.destination),
    })
    delete body.optimizeWaypointOrder
    const retry = await llamarRoutesApi(body)
    status = retry.status
    j = retry.json
    routes = j.routes as Array<Record<string, unknown>> | undefined
  }

  // Segundo retry: con TRAFFIC_UNAWARE. Algunas zonas no tienen datos de tráfico
  // y TRAFFIC_AWARE falla con respuesta vacía.
  if (status === 200 && !routes?.[0]) {
    console.warn('[google-maps] Routes API 200 vacío — retry con TRAFFIC_UNAWARE')
    body.routingPreference = 'TRAFFIC_UNAWARE'
    const retry = await llamarRoutesApi(body)
    status = retry.status
    j = retry.json
    routes = j.routes as Array<Record<string, unknown>> | undefined
  }

  if (status !== 200) {
    const errObj = j.error as { message?: string } | undefined
    const msg = errObj?.message ?? JSON.stringify(j).slice(0, 300)
    throw new Error(`Routes API ${status}: ${msg}`)
  }
  if (!routes?.[0]) {
    console.error('[google-maps] Routes API 200 con respuesta vacía tras retries', {
      origin: opts.origin,
      destination: opts.destination,
      intermediates: opts.intermediates,
      body_keys: Object.keys(j),
    })
    const paradas = (opts.intermediates ?? []).map((w, i) => `${i + 1}:${fmtCoord(w)}`).join(' | ')
    const detalle = Object.keys(j).length === 0
      ? `no se encontró ruta. Origen ${fmtCoord(opts.origin)} → destino ${fmtCoord(opts.destination)}${paradas ? ' · paradas: ' + paradas : ''}. Revisá si alguna dirección quedó mal geocodeada (Google Maps).`
      : ((j.error as { message?: string })?.message ?? JSON.stringify(j).slice(0, 300))
    throw new Error(`Routes API ${status}: ${detalle}`)
  }
  const r = routes[0]
  const durationStr = (r.duration as string) ?? '0s'
  const duration_seconds = parseInt(durationStr.replace('s', ''), 10)

  return {
    distance_meters: (r.distanceMeters as number) ?? 0,
    duration_seconds: Number.isFinite(duration_seconds) ? duration_seconds : 0,
    encoded_polyline: ((r.polyline as { encodedPolyline?: string })?.encodedPolyline) ?? '',
    optimized_order: (r.optimizedIntermediateWaypointIndex as number[]) ?? [],
  }
}

/** Construye una URL de Google Maps que abre la ruta con todos los waypoints en orden. */
export function buildGoogleMapsUrl(origin: LatLng, destination: LatLng, waypoints: LatLng[]): string {
  const fmt = (p: LatLng) => `${p.lat},${p.lng}`
  const base = 'https://www.google.com/maps/dir/?api=1'
  const params = new URLSearchParams({
    origin: fmt(origin),
    destination: fmt(destination),
    travelmode: 'driving',
  })
  if (waypoints.length > 0) {
    params.set('waypoints', waypoints.map(fmt).join('|'))
  }
  return `${base}&${params.toString()}`
}
