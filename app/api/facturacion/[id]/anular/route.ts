import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { esAdminTotal } from '@/lib/roles'
import { anularDocumento } from '@/lib/facturacion'

interface Body { motivo?: string; dev?: boolean }

/** POST /api/facturacion/[id]/anular — anula un documento (genera NC 61 que lo referencia). Solo admin. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  const user = session?.user as { role?: string; id?: string; name?: string } | undefined
  if (!esAdminTotal(user?.role)) {
    return NextResponse.json({ error: 'Solo admin' }, { status: 403 })
  }
  const { id } = await params
  const body = await req.json().catch(() => ({})) as Body

  const r = await anularDocumento({
    documentoId: id,
    motivo: body.motivo?.trim() || '',
    dev: !!body.dev,
    creadoPorId: user?.id || '',
    creadoPorNombre: user?.name || '',
  })

  if (!r.ok) return NextResponse.json({ error: r.error || 'No se pudo anular el documento.' }, { status: 502 })
  return NextResponse.json({ ok: true, notaCredito: r.documento })
}
