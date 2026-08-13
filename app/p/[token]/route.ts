import { NextRequest, NextResponse } from 'next/server'
import { accionDeToken } from '@/lib/tutor-token'

/**
 * RUTA CORTA para subir la foto de la mascota: `/p/<token>` → `/subir-foto`.
 *
 * El tipo de foto (certificado o cuadro conmemorativo) sale del propio token, no
 * de un parámetro aparte: un botón de URL de Meta solo puede agregar un sufijo al
 * final de la base aprobada, así que no hay dónde colgar un `&tipo=`.
 *
 * No valida nada — el destino verifica la firma y muestra la pantalla que
 * corresponda si el link venció.
 *
 * PÚBLICA (lista blanca de proxy.ts): el tutor no tiene sesión.
 */
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params
  const destino = new URL('/subir-foto', req.nextUrl.origin)
  if (token) destino.searchParams.set('token', token)
  if (accionDeToken(token) === 'subir_foto_cuadro') destino.searchParams.set('tipo', 'cuadro')
  return NextResponse.redirect(destino)
}
