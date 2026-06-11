import { NextRequest, NextResponse } from 'next/server'
import { buscarComuna } from '@/lib/comunas'

/**
 * GET /api/eutanasias/place-details?placeId=XYZ
 *
 * Dado un placeId de Google (obtenido vía AddressAutocomplete), llama a
 * Google Places API (New) y extrae:
 *  - comuna (administrative_area_level_3)
 *  - region (administrative_area_level_1)
 *  - direccion formateada
 *
 * La comuna se mapea contra la lista canónica para mantener consistencia
 * con lo que declararon los vets en su inscripción (que también pasó por
 * el mismo mapeo canónico).
 *
 * Esto permite resolver el problema: vet declara comuna "Las Condes" en
 * el form de inscripción → el sistema guarda "Las Condes" canónica.
 * Cuando el admin crea una cotización para una dirección en Las Condes,
 * acá derivamos también "Las Condes" canónica y el matcher hace match.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const placeId = url.searchParams.get('placeId') ?? ''
  if (!placeId) return NextResponse.json({ error: 'placeId requerido' }, { status: 400 })

  const apiKey = process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_PLACES_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'GOOGLE_MAPS_API_KEY no configurada' }, { status: 500 })

  try {
    const r = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`, {
      method: 'GET',
      headers: {
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': 'addressComponents,formattedAddress,location',
        'Accept-Language': 'es-CL',
      },
    })
    if (!r.ok) {
      const t = await r.text().catch(() => '')
      return NextResponse.json({ error: `Places API ${r.status}: ${t.slice(0, 120)}` }, { status: r.status })
    }
    type Comp = { longText?: string; shortText?: string; types?: string[] }
    const j = await r.json() as {
      addressComponents?: Comp[]
      formattedAddress?: string
      location?: { latitude?: number; longitude?: number }
    }
    const comps = j.addressComponents ?? []
    const comunaRaw = comps.find(c => (c.types ?? []).includes('administrative_area_level_3'))?.longText
      ?? comps.find(c => (c.types ?? []).includes('locality'))?.longText
      ?? ''
    const regionRaw = comps.find(c => (c.types ?? []).includes('administrative_area_level_1'))?.longText ?? ''

    // Normalizamos a la lista canónica (Las Condes, La Florida, etc.)
    const canon = buscarComuna(comunaRaw)

    return NextResponse.json({
      ok: true,
      comuna: canon?.nombre ?? comunaRaw,
      comuna_canonica: !!canon,
      region: canon?.region ?? regionRaw,
      formatted_address: j.formattedAddress ?? '',
      lat: j.location?.latitude ?? null,
      lng: j.location?.longitude ?? null,
    })
  } catch (e) {
    console.error('[eutanasias/place-details]', e)
    return NextResponse.json({ error: 'No se pudo obtener la dirección. Intenta nuevamente.' }, { status: 500 })
  }
}
