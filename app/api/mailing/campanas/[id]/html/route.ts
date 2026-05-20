import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { getSheetData } from '@/lib/google-sheets'
import { getFromR2 } from '@/lib/cloudflare-r2'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if ((session?.user as { role?: string })?.role !== 'admin') {
    return NextResponse.json({ error: 'Solo admin' }, { status: 403 })
  }
  const { id } = await params
  const rows = await getSheetData('mailing_campanas')
  const row = rows.find(r => r.id === id)
  if (!row) return NextResponse.json({ error: 'No encontrada' }, { status: 404 })
  if (!row.html_key) return NextResponse.json({ html: '' })

  const buf = await getFromR2(row.html_key)
  if (!buf) return NextResponse.json({ error: 'HTML no encontrado en R2' }, { status: 404 })
  return NextResponse.json({ html: buf.toString('utf8') })
}
