import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { getSheetData, updateRow } from '@/lib/google-sheets'

/**
 * POST /api/mailing/campanas/[id]/cancelar
 * Marca la campaña como 'cancelando'. El handler de /enviar revisa este flag
 * entre cada chunk de 100 y aborta si lo encuentra. Los emails ya despachados
 * por Resend no se pueden recuperar; solo cancela lo que falta enviar.
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if ((session?.user as { role?: string })?.role !== 'admin') {
    return NextResponse.json({ error: 'Solo admin' }, { status: 403 })
  }

  try {
    const { id } = await params
    const rows = await getSheetData('mailing_campanas')
    const idx = rows.findIndex(r => r.id === id)
    if (idx === -1) return NextResponse.json({ error: 'No encontrada' }, { status: 404 })
    const campana = rows[idx]
    if (campana.estado !== 'enviando' && campana.estado !== 'borrador') {
      return NextResponse.json({ error: `No se puede cancelar una campaña en estado "${campana.estado}"` }, { status: 400 })
    }
    await updateRow('mailing_campanas', idx, { ...campana, estado: 'cancelando' })
    return NextResponse.json({ ok: true, previo: campana.estado })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
