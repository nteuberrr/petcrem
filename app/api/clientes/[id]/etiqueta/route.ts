import { NextRequest, NextResponse } from 'next/server'
import { getSheetData } from '@/lib/datastore'
import { exigirNivel } from '@/lib/permisos-server'
import { datosEtiqueta, generarEtiquetaDespacho } from '@/lib/etiqueta-despacho'

export const dynamic = 'force-dynamic'

/**
 * Etiqueta de despacho de una ficha, lista para la impresora térmica (80 × 50 mm,
 * se imprime vertical). Va `inline` para que se abra en el visor y se pueda
 * mandar a imprimir directo. La vista previa horizontal de la app es HTML.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const g = await exigirNivel('clientes', 'ver')
    if (g.denegado) return g.denegado

    const { id } = await params
    const clientes = await getSheetData('clientes')
    const c = clientes.find(x => x.id === id)
    if (!c) return NextResponse.json({ error: 'Ficha no encontrada' }, { status: 404 })

    const buffer = await generarEtiquetaDespacho(datosEtiqueta(c))
    const nombre = `Etiqueta_${(c.codigo || c.nombre_mascota || id).replace(/[^\w-]+/g, '_')}.pdf`
    return new Response(buffer as unknown as BodyInit, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${nombre}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
