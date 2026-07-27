import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { evaluarSlotRetiro } from '@/lib/agenda'

export const dynamic = 'force-dynamic'

/**
 * GET ?fecha=YYYY-MM-DD&hora=HH:MM → ¿ese horario está libre para un retiro?
 * Devuelve `{ ok, motivo?, libres[] }` con la MISMA regla que usa el bot
 * (ventana 09:00–21:10, bloqueos manuales y separación de 30 min antes / 45
 * después de cada reserva).
 *
 * Es solo un AVISO para el alta manual del equipo: la UI muestra la advertencia
 * y las horas libres, pero deja guardar igual (el equipo puede tener motivos
 * para pisar un horario). El bot, en cambio, sí respeta el `ok`.
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
  try {
    const { searchParams } = new URL(req.url)
    const fecha = (searchParams.get('fecha') || '').trim()
    const hora = (searchParams.get('hora') || '').trim()
    if (!fecha || !hora) return NextResponse.json({ error: 'fecha y hora requeridas' }, { status: 400 })
    const r = await evaluarSlotRetiro(fecha, hora)
    return NextResponse.json(r, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    console.error('[agenda/slot GET]', e)
    return NextResponse.json({ error: 'No se pudo revisar el horario.' }, { status: 500 })
  }
}
