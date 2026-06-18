import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { esAdminTotal } from '@/lib/roles'
import { listarCorreoLog, obtenerCorreoLog } from '@/lib/correos-audit'

// Registro/respaldo de correos transaccionales enviados. Solo admin total
// (Configuración Avanzada → Correos). GET ?id= devuelve el correo completo
// (con html) para el visor; sin id devuelve la lista paginada/filtrada.

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!esAdminTotal((session?.user as { role?: string })?.role)) {
    return NextResponse.json({ error: 'Solo el administrador' }, { status: 403 })
  }
  try {
    const sp = new URL(req.url).searchParams
    const id = sp.get('id')
    if (id) {
      const row = await obtenerCorreoLog(id)
      if (!row) return NextResponse.json({ error: 'No encontrado' }, { status: 404 })
      return NextResponse.json(row)
    }
    const res = await listarCorreoLog({
      desde: sp.get('desde') || undefined,
      hasta: sp.get('hasta') || undefined,
      q: sp.get('q') || undefined,
      page: parseInt(sp.get('page') || '1', 10) || 1,
      pageSize: parseInt(sp.get('pageSize') || '10', 10) || 10,
    })
    return NextResponse.json(res)
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
