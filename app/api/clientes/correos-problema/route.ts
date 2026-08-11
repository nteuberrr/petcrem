import { NextResponse } from 'next/server'
import { getSheetData } from '@/lib/datastore'
import { fichasConCorreoProblema } from '@/lib/correos-problema'

export const dynamic = 'force-dynamic'

/**
 * GET /api/clientes/correos-problema — clientes cuyo email VIGENTE tiene
 * problemas de entrega (rebotó / spam / falló en algún correo transaccional).
 * Alimenta el aviso de control en la lista /clientes, para corregir la
 * dirección en la ficha. Si el operador ya corrigió el email (la ficha tiene
 * otra dirección que la que rebotó), el cliente deja de aparecer.
 */
export async function GET() {
  try {
    const clientes = await getSheetData('clientes')
    return NextResponse.json(await fichasConCorreoProblema(clientes))
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
