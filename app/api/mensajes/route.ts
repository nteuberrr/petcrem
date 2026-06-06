import { NextRequest, NextResponse } from 'next/server'
import { listConversaciones, type Canal, type Audiencia, type EstadoConv } from '@/lib/mensajes'
import { isMensajesSupabaseConfigured } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET(req: NextRequest) {
  try {
    if (!isMensajesSupabaseConfigured()) return NextResponse.json({ error: 'Supabase no configurado' }, { status: 500 })
    const { searchParams } = new URL(req.url)
    const estado = searchParams.get('estado') as EstadoConv | null
    const canal = searchParams.get('canal') as Canal | null
    const audiencia = searchParams.get('audiencia') as Audiencia | null
    const buscar = searchParams.get('buscar') || undefined
    const rows = await listConversaciones({
      estado: estado || undefined,
      canal: canal || undefined,
      audiencia: audiencia || undefined,
      buscar,
    })
    return NextResponse.json(rows)
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
