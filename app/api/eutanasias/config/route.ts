import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { esAdmin } from '@/lib/roles'
import { getFijoEutanasia, setFijoEutanasia, getConsultaEutanasia, setConsultaEutanasia, getRecargoFueraHorario, setRecargoFueraHorario } from '@/lib/eutanasia-precios'

// Config del módulo de eutanasias. Admin (incl. admin2):
//  - fijo: cargo al cliente sobre el pago al vet cuando SÍ se realiza.
//  - consulta_vet + consulta_alma: consulta cobrada cuando NO se realiza.
//  - recargo_fuera_horario: recargo al cliente si el servicio es fuera de horario.

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
    const [fijo, consulta, recargoFueraHorario] = await Promise.all([getFijoEutanasia(), getConsultaEutanasia(), getRecargoFueraHorario()])
    return NextResponse.json({ fijo, consulta_vet: consulta.vet, consulta_alma: consulta.alma, consulta_total: consulta.total, recargo_fuera_horario: recargoFueraHorario })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

export async function PUT(req: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied
  try {
    const body = await req.json()

    // Guardado del recargo fuera de horario (finde/feriado/≥18:00 L-V).
    if ('recargo_fuera_horario' in body) {
      const monto = Number(body.recargo_fuera_horario)
      if (!Number.isFinite(monto) || monto < 0) {
        return NextResponse.json({ error: 'Recargo inválido' }, { status: 400 })
      }
      await setRecargoFueraHorario(monto)
      return NextResponse.json({ recargo_fuera_horario: Math.round(monto) })
    }

    // Guardado de la consulta (fijo vet + spread Alma) — cuando NO se realiza.
    if ('consulta_vet' in body || 'consulta_alma' in body) {
      const vet = Number(body.consulta_vet)
      const alma = Number(body.consulta_alma)
      if (!Number.isFinite(vet) || vet < 0 || !Number.isFinite(alma) || alma < 0) {
        return NextResponse.json({ error: 'Valores de consulta inválidos' }, { status: 400 })
      }
      await setConsultaEutanasia({ vet, alma })
      return NextResponse.json({ consulta_vet: Math.round(vet), consulta_alma: Math.round(alma), consulta_total: Math.round(vet) + Math.round(alma) })
    }

    // Guardado del cargo fijo al cliente (cuando SÍ se realiza).
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
