import { NextResponse } from 'next/server'
import { getSheetData } from '@/lib/datastore'

/**
 * GET — público (sin auth) para que el landing /convenio-veterinarias muestre la
 * tabla de tarifas de convenio de cremación (precios_convenio). Solo lectura de
 * los tramos por peso y los 3 tipos de servicio (CI / CP / SD). Whitelisteado en
 * proxy.ts.
 */
export async function GET() {
  try {
    const rows = await getSheetData('precios_convenio')
    rows.sort((a, b) => (parseFloat(a.peso_min) || 0) - (parseFloat(b.peso_min) || 0))
    const tramos = rows.map(r => ({
      id: r.id,
      peso_min: r.peso_min,
      peso_max: r.peso_max,
      precio_ci: r.precio_ci,
      precio_cp: r.precio_cp,
      precio_sd: r.precio_sd,
    }))
    return NextResponse.json({ tramos })
  } catch (e) {
    console.error('[veterinarios/precios-convenio GET]', e)
    return NextResponse.json({ error: 'No se pudieron cargar los precios. Intenta nuevamente.' }, { status: 500 })
  }
}
