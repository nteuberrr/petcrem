import { NextRequest, NextResponse } from 'next/server'

/**
 * RUTA CORTA del link que se le manda al tutor por WhatsApp para que adelante
 * los datos de su mascota: `/f/<token>` → `/registro-mascota?ficha=<token>`.
 *
 * Existe solo por el largo. El link viaja dentro de un mensaje que lee alguien
 * que acaba de perder a su mascota, y `…/registro-mascota?ficha=<105 caracteres>`
 * ocupaba tres renglones de ruido. Con el token compacto (lib/borrador-token) y
 * esta ruta, el link entero queda en ~50 caracteres y se lee como un link.
 *
 * No valida nada: redirige y listo. La verificación de la firma vive donde
 * siempre —en la página y en el endpoint que guarda—, así un token vencido o
 * falso llega a la misma pantalla explicativa de siempre en vez de a un 404 seco.
 *
 * PÚBLICA (lista blanca de proxy.ts): el tutor no tiene sesión.
 */
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params
  const destino = new URL('/registro-mascota', req.nextUrl.origin)
  if (token) destino.searchParams.set('ficha', token)
  return NextResponse.redirect(destino)
}
