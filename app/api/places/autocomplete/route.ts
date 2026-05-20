import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  try {
    const { input } = (await req.json().catch(() => ({}))) as { input?: string }
    if (!input || input.trim().length < 3) {
      return NextResponse.json({ suggestions: [] })
    }
    const key = process.env.GOOGLE_MAPS_API_KEY
    if (!key) {
      return NextResponse.json({ error: 'GOOGLE_MAPS_API_KEY no configurada' }, { status: 500 })
    }

    const r = await fetch('https://places.googleapis.com/v1/places:autocomplete', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': key,
        'X-Goog-FieldMask': 'suggestions.placePrediction.text,suggestions.placePrediction.placeId',
      },
      body: JSON.stringify({
        input,
        includedRegionCodes: ['cl'],
        languageCode: 'es-CL',
      }),
    })

    const j = await r.json()
    if (r.status !== 200) {
      return NextResponse.json({ error: j.error?.message || 'Places API error', suggestions: [] }, { status: r.status })
    }

    const sugs = (j.suggestions || []).map((s: { placePrediction?: { text?: { text: string }; placeId: string } }) => ({
      text: s.placePrediction?.text?.text ?? '',
      placeId: s.placePrediction?.placeId ?? '',
    })).filter((s: { text: string }) => !!s.text)

    return NextResponse.json({ suggestions: sugs })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg, suggestions: [] }, { status: 500 })
  }
}
