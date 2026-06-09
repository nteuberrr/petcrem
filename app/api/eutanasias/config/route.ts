import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { esAdmin } from '@/lib/roles'
import { getFijoEutanasia, setFijoEutanasia } from '@/lib/eutanasia-precios'

// Config del módulo de eutanasias: por ahora solo el cargo fijo que se suma al
// precio del vet para dar el precio al cliente. Admin (incl. admin2).

async function requireAdmin() {
  const session = await getServerSession(authOptions)
  if (!esAdmin((session?.user as { role?: string })?.role)) {
    return NextResponse.json({ error: 'Solo admin' }, { status: 403 })
  }
  return null
}

export async function GET() {
  const denied = await requireAdmin()
  if (denied) return denied
  try {
    const fijo = await getFijoEutanasia()
    return NextResponse.json({ fijo })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

export async function PUT(req: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied
  try {
    const body = await req.json()
    const fijo = Number(body.fijo)
    if (!Number.isFinite(fijo) || fijo < 0) {
      return NextResponse.json({ error: 'Fijo inválido' }, { status: 400 })
    }
    await setFijoEutanasia(fijo)
    return NextResponse.json({ fijo: Math.round(fijo) })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 })
  }
}
