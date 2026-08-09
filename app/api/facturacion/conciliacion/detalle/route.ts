import { NextRequest, NextResponse } from 'next/server'
import { puedeNivel } from '@/lib/permisos-server'
import { detalleIngresos, LABEL_INGRESO, SE_DOCUMENTA, type ClaveIngreso } from '@/lib/eerr-ingresos'

/**
 * GET ?periodo=YYYY-MM → desglose del cuadro «según el sistema» de la
 * Conciliación: qué fichas componen cada tipo de ingreso y cuáles quedaron sin
 * documento. Es lo que abre el «+» de cada fila, para pasar de "faltan $3M" a la
 * lista concreta de fichas sin boleta.
 */

export const dynamic = 'force-dynamic'

const esPeriodo = (s: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(s)

export async function GET(req: NextRequest) {
  if (!(await puedeNivel('facturacion', 'ver'))) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
  }
  try {
    const periodo = (new URL(req.url).searchParams.get('periodo') || '').trim()
    if (!esPeriodo(periodo)) return NextResponse.json({ error: 'Período inválido' }, { status: 400 })

    const items = await detalleIngresos(periodo)
    const claves = Object.keys(LABEL_INGRESO) as ClaveIngreso[]
    const grupos = claves.map(clave => {
      const propios = items.filter(i => i.clave === clave)
      // "Desviado" = monto sin respaldo tributario. En las eutanasias no aplica:
      // se cobran fuera de la boleta a propósito, y contarlas como desviación
      // marcaría un problema inexistente todos los meses.
      const sinDoc = SE_DOCUMENTA[clave] ? propios.filter(i => !i.documentado) : []
      return {
        clave,
        label: LABEL_INGRESO[clave],
        se_documenta: SE_DOCUMENTA[clave],
        total: propios.reduce((s, i) => s + i.monto, 0),
        docs: propios.length,
        sin_documento: sinDoc.length,
        monto_sin_documento: sinDoc.reduce((s, i) => s + i.monto, 0),
        items: propios,
      }
    })
    return NextResponse.json({ periodo, grupos })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
