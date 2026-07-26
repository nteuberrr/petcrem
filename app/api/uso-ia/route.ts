import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { esAdminTotal } from '@/lib/roles'
import { resumenUso } from '@/lib/uso-ia'

export const dynamic = 'force-dynamic'

/**
 * Consumo de IA (tokens + imágenes/video) por módulo, modelo y día.
 * Solo el admin total: vive en Configuración Avanzada → Consumo IA.
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!esAdminTotal((session?.user as { role?: string })?.role)) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }
  try {
    const dias = Math.min(365, Math.max(1, parseInt(new URL(req.url).searchParams.get('dias') || '30', 10) || 30))
    return NextResponse.json(await resumenUso(dias), { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    console.error('[uso-ia GET]', e)
    return NextResponse.json({ error: 'No se pudo leer el consumo de IA.' }, { status: 500 })
  }
}
