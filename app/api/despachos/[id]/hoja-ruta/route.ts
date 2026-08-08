import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { getSheetData } from '@/lib/datastore'
import { crearRutaToken } from '@/lib/ruta-token'
import { basePublica } from '@/lib/links-publicos'

export const dynamic = 'force-dynamic'

/**
 * POST /api/despachos/[id]/hoja-ruta → { url, vence_en_dias }
 *
 * Firma el link de la HOJA DE RUTA que se le pasa al repartidor externo. Se
 * emite en el servidor y no en el navegador porque la firma necesita
 * NEXTAUTH_SECRET.
 *
 * ⚠️ El secret de local NO es el de producción: un link firmado corriendo local
 * lo rechaza prod. Por eso, además de la sesión, acepta `Bearer CRON_SECRET`
 * (mismo patrón que /api/clientes/[id]/reenviar-link-borrador): permite mintear
 * el link EN PROD desde fuera del navegador en vez de firmarlo en local y que no
 * sirva. Fail-closed: sin sesión y sin CRON_SECRET configurado, no pasa nadie.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  const bearer = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  const okCron = !!process.env.CRON_SECRET && bearer === process.env.CRON_SECRET
  if (!session?.user && !okCron) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  try {
    const { id } = await params
    const despachos = await getSheetData('despachos')
    const row = despachos.find(d => String(d.id) === String(id))
    if (!row) return NextResponse.json({ error: 'Ruta no encontrada' }, { status: 404 })

    const DIAS = 3
    const token = crearRutaToken(String(id), DIAS * 24 * 3600)
    return NextResponse.json({
      ok: true,
      url: `${basePublica()}/ruta/${encodeURIComponent(token)}`,
      vence_en_dias: DIAS,
    })
  } catch (e) {
    console.error('[despachos/hoja-ruta]', e)
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
