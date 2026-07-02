import { NextRequest, NextResponse } from 'next/server'
import { COMUNAS, normalizar, buscarComuna } from '@/lib/comunas'
import { permitirRequest } from '@/lib/rate-limit'

/**
 * GET /api/eutanasias/comunas/buscar?q=texto
 *
 * Devuelve hasta 8 sugerencias de comunas chilenas. Estrategia:
 *
 * 1) Si está configurada GOOGLE_PLACES_API_KEY, llama a Places API (New)
 *    con types=administrative_area_level_3 + country=CL. Cada predicción
 *    se mapea contra la lista canónica (lib/comunas) por nombre normalizado.
 *    Si Google devuelve un nombre que no existe en nuestra lista, igual lo
 *    incluimos como source='google_extra' (caso raro: comuna recién creada
 *    o nombre escrito raro).
 *
 * 2) Si Google falla o no hay key, hace búsqueda local sobre la lista
 *    canónica (substring sobre forma normalizada sin tildes).
 *
 * En cualquier caso devuelve objetos { nombre, region, source }, ya
 * canónicos — el front guarda directo lo que reciba, así la base queda
 * consistente.
 */

interface Sugerencia {
  nombre: string
  region: string
  source: 'local' | 'google' | 'google_extra'
}

const GOOGLE_AUTOCOMPLETE_URL = 'https://places.googleapis.com/v1/places:autocomplete'

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const q = (url.searchParams.get('q') ?? '').trim()
  if (!q || q.length < 2) return NextResponse.json([])

  // Pública y con costo Google por request: si la IP se pasa del límite,
  // degradamos a la búsqueda local (gratis) en vez de cortar el autocomplete.
  if (!permitirRequest(req, 'comunas-buscar', 60, 60_000)) {
    return NextResponse.json(buscarLocal(q))
  }

  // Misma key que usa /api/places/autocomplete para direcciones.
  const apiKey = process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_PLACES_API_KEY

  if (apiKey) {
    try {
      const sugerenciasGoogle = await buscarConGoogle(q, apiKey)
      if (sugerenciasGoogle.length > 0) return NextResponse.json(sugerenciasGoogle)
    } catch (e) {
      console.warn('[comunas/buscar] Google Places falló, uso lista local:', e)
    }
  }

  return NextResponse.json(buscarLocal(q))
}

function buscarLocal(q: string): Sugerencia[] {
  const qn = normalizar(q)
  const matches = COMUNAS
    .map(c => {
      const cn = normalizar(c.nombre)
      let score = -1
      if (cn === qn) score = 0
      else if (cn.startsWith(qn)) score = 1
      else if (cn.includes(qn)) score = 2
      return { c, score }
    })
    .filter(x => x.score >= 0)
    .sort((a, b) => a.score - b.score || a.c.nombre.localeCompare(b.c.nombre, 'es'))
    .slice(0, 8)
    .map(x => ({ nombre: x.c.nombre, region: x.c.region, source: 'local' as const }))
  return matches
}

async function buscarConGoogle(q: string, apiKey: string): Promise<Sugerencia[]> {
  const res = await fetch(GOOGLE_AUTOCOMPLETE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': 'suggestions.placePrediction.text.text,suggestions.placePrediction.structuredFormat',
    },
    body: JSON.stringify({
      input: q,
      includedRegionCodes: ['cl'],
      includedPrimaryTypes: ['administrative_area_level_3'],
      languageCode: 'es-419',
    }),
  })
  if (!res.ok) {
    const errTxt = await res.text().catch(() => '')
    throw new Error(`Places API ${res.status}: ${errTxt.slice(0, 120)}`)
  }
  type Prediction = {
    placePrediction?: {
      text?: { text?: string }
      structuredFormat?: { mainText?: { text?: string } }
    }
  }
  const data = await res.json() as { suggestions?: Prediction[] }
  const suggestions = data.suggestions ?? []
  const out: Sugerencia[] = []
  const vistos = new Set<string>()
  for (const s of suggestions) {
    const mainText = s.placePrediction?.structuredFormat?.mainText?.text
      ?? s.placePrediction?.text?.text
      ?? ''
    if (!mainText) continue
    const canonico = buscarComuna(mainText)
    if (canonico) {
      if (vistos.has(canonico.nombre)) continue
      vistos.add(canonico.nombre)
      out.push({ nombre: canonico.nombre, region: canonico.region, source: 'google' })
    } else {
      // Comuna que Google reconoce pero no tenemos canónica (raro). La
      // mostramos igual para que el admin sepa que existe la opción.
      if (vistos.has(mainText)) continue
      vistos.add(mainText)
      out.push({ nombre: mainText, region: '', source: 'google_extra' })
    }
    if (out.length >= 8) break
  }
  return out
}
