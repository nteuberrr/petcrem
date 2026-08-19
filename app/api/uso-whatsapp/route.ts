import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { esAdminTotal } from '@/lib/roles'
import { costosWhatsapp } from '@/lib/whatsapp-costos'
import { resumenEnviosWa } from '@/lib/uso-whatsapp'

export const dynamic = 'force-dynamic'

/**
 * Gasto de WhatsApp, en dos capas que se complementan:
 *  · `meta`   — lo que Meta nos cobra DE VERDAD (su pricing_analytics), por día y
 *               categoría, en la moneda de facturación de la cuenta.
 *  · `envios` — nuestro propio registro, que agrega lo que Meta no dice: qué
 *               plantilla y qué flujo produjo cada mensaje.
 *
 * Solo el admin total: vive en Configuración Avanzada → Consumo IA.
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!esAdminTotal((session?.user as { role?: string })?.role)) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }
  try {
    const dias = Math.min(90, Math.max(1, parseInt(new URL(req.url).searchParams.get('dias') || '30', 10) || 30))
    const [meta, envios] = await Promise.all([
      costosWhatsapp(dias),
      resumenEnviosWa(dias),
    ])
    return NextResponse.json({ meta, envios }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    console.error('[uso-whatsapp GET]', e)
    return NextResponse.json({ error: 'No se pudo leer el gasto de WhatsApp.' }, { status: 500 })
  }
}
