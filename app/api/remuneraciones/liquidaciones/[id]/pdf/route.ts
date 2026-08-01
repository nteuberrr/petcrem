import { NextRequest, NextResponse } from 'next/server'
import { getSheetData } from '@/lib/datastore'
import { guard } from '@/lib/remuneraciones/auth'
import { getEmpleado, getLiquidacion } from '@/lib/remuneraciones/datos'
import { generarLiquidacionPdf } from '@/lib/remuneraciones/pdf'
import { nombreDePeriodo } from '@/lib/remuneraciones/periodo'

export const dynamic = 'force-dynamic'

/**
 * La liquidación en PDF. Se dibuja desde el SNAPSHOT guardado, no recalculando:
 * reimprimir enero en diciembre da exactamente el mismo documento.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await guard('ver')
  if (g.denegado) return g.denegado
  const { id } = await params

  try {
    const liq = await getLiquidacion(id)
    if (!liq) return NextResponse.json({ error: 'Liquidación no encontrada' }, { status: 404 })
    if (!liq.detalle) {
      return NextResponse.json({ error: 'La liquidación no tiene el detalle guardado. Recalcula el período.' }, { status: 409 })
    }

    const [empleado, empresaRows] = await Promise.all([
      getEmpleado(liq.empleado_id),
      getSheetData('empresa_config').catch(() => [] as Record<string, string>[]),
    ])
    const empresa = empresaRows[0] || {}

    const buffer = await generarLiquidacionPdf({
      periodo: liq.periodo,
      periodoTexto: nombreDePeriodo(liq.periodo),
      empleador: {
        razon_social: String(empresa.nombre || 'Alma Animal'),
        rut: String(empresa.rut || ''),
        direccion: [empresa.direccion, empresa.comuna].filter(Boolean).join(', '),
      },
      trabajador: {
        nombre: liq.empleado_nombre || empleado?.nombre_completo || '',
        rut: empleado?.rut || '',
        cargo: empleado?.cargo || '',
        unidad_negocio: empleado?.unidad_negocio || '',
        tipo_contrato: empleado?.tipo_contrato === 'indefinido' ? 'Indefinido' : 'Plazo fijo',
        fecha_ingreso: empleado?.fecha_ingreso || '',
        fecha_termino: empleado?.fecha_termino || '',
        sueldo_base: empleado?.sueldo_base || 0,
      },
      liquidacion: liq.detalle,
    })

    const nombre = `liquidacion_${liq.periodo}_${(liq.empleado_nombre || 'empleado').split(' ')[0].toLowerCase()}.pdf`
    return new Response(buffer as unknown as BodyInit, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${nombre}"`,
      },
    })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
