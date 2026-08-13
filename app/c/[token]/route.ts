import { NextRequest, NextResponse } from 'next/server'
import { verifyTutorToken } from '@/lib/tutor-token'
import { getSheetData } from '@/lib/datastore'

/**
 * EL CERTIFICADO, A UN TOQUE: `/c/<token>` → el PDF del certificado de esa ficha.
 *
 * Existe para que el aviso de WhatsApp pueda llevar un botón «Ver certificado».
 * Hasta ahora el certificado salía SOLO por correo y el propio mensaje asumía la
 * derrota — «si no lo recibes, respóndenos y te lo reenviamos»—, porque en este
 * rubro el correo cae en spam con una frecuencia incómoda.
 *
 * A diferencia de /f/ y /p/, acá SÍ se verifica el token antes de redirigir: el
 * destino es un PDF en R2 y ahí ya no hay ninguna otra puerta que revise nada.
 * Se sirve el ÚLTIMO certificado emitido de la ficha (si se reemitió, el vigente).
 *
 * PÚBLICA (lista blanca de proxy.ts): el tutor no tiene sesión.
 */
export const dynamic = 'force-dynamic'

function pagina(titulo: string, detalle: string, status: number) {
  return new NextResponse(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${titulo}</title>
<div style="font-family:system-ui,sans-serif;max-width:34rem;margin:18vh auto;padding:0 1.5rem;color:#143C64;text-align:center">
  <h1 style="font-size:1.25rem;margin:0 0 .75rem">${titulo}</h1>
  <p style="color:#4b5563;line-height:1.6;margin:0">${detalle}</p>
  <p style="color:#4b5563;line-height:1.6;margin:1.25rem 0 0">Escríbenos por WhatsApp y te lo enviamos al instante.</p>
</div>`,
    { status, headers: { 'content-type': 'text/html; charset=utf-8' } },
  )
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params
  const v = verifyTutorToken(token, 'ver_certificado')
  if (!v.ok) {
    return v.error === 'expired'
      ? pagina('Este enlace venció', 'El enlace del certificado ya no está vigente.', 410)
      : pagina('Enlace no válido', 'No pudimos reconocer este enlace.', 404)
  }
  try {
    const certs = await getSheetData('certificados')
    const dela = certs.filter(c => String(c.cliente_id) === String(v.clienteId) && (c.pdf_url || '').trim())
    const ultimo = dela[dela.length - 1]
    if (!ultimo) return pagina('Todavía no está disponible', 'El certificado de esta mascota aún no fue emitido.', 404)
    return NextResponse.redirect(ultimo.pdf_url)
  } catch {
    return pagina('No pudimos abrirlo', 'Hubo un problema al buscar el certificado.', 500)
  }
}
