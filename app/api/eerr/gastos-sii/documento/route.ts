import { NextRequest, NextResponse } from 'next/server'
import { puedeNivel } from '@/lib/permisos-server'
import { puedeConsultarOpenFactura } from '@/lib/openfactura-consulta'
import { detalleDocumento, pdfDocumento } from '@/lib/openfactura-acuse'

/**
 * GET ?rut=&dte=&folio=[&formato=pdf][&descargar=1]
 *
 * Sin `formato` devuelve el detalle en JSON (estado en el SII + encabezado del
 * documento). Con `formato=pdf` devuelve el PDF: `inline` para verlo en el
 * navegador, `attachment` para bajarlo.
 *
 * Es un proxy a propósito: la apikey de OpenFactura es del servidor y no puede
 * viajar al navegador.
 */

export const dynamic = 'force-dynamic'
// Generar el PDF de un documento que no lo tenía toma ~3 s del lado de Haulmer.
export const maxDuration = 60

export async function GET(req: NextRequest) {
  if (!(await puedeNivel('eerr', 'ver'))) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
  }
  if (!puedeConsultarOpenFactura()) {
    return NextResponse.json({ error: 'OpenFactura no está configurado (falta OPENFACTURA_API_KEY).' }, { status: 400 })
  }
  try {
    const q = new URL(req.url).searchParams
    const rut = (q.get('rut') || '').trim()
    const dte = Number(q.get('dte'))
    const folio = Number(q.get('folio'))
    if (!rut || !Number.isFinite(dte) || !Number.isFinite(folio) || folio <= 0) {
      return NextResponse.json({ error: 'Faltan datos del documento (RUT, tipo y folio).' }, { status: 400 })
    }

    if (q.get('formato') === 'pdf') {
      const pdf = await pdfDocumento(rut, dte, folio)
      const nombre = `${dte}-${folio}-${rut}.pdf`
      return new NextResponse(pdf, {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `${q.get('descargar') ? 'attachment' : 'inline'}; filename="${nombre}"`,
          'Cache-Control': 'private, max-age=300',
        },
      })
    }

    return NextResponse.json({ ok: true, ...(await detalleDocumento(rut, dte, folio)) })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
