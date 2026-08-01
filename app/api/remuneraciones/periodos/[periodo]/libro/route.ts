import { NextRequest, NextResponse } from 'next/server'
import * as XLSX from 'xlsx-js-style'
import { guard } from '@/lib/remuneraciones/auth'
import { listarEmpleados, listarLiquidaciones } from '@/lib/remuneraciones/datos'
import { esPeriodoValido, nombreDePeriodo } from '@/lib/remuneraciones/periodo'
import { NOMBRES_AFP } from '@/lib/remuneraciones/tablas'

export const dynamic = 'force-dynamic'

type CellStyle = {
  fill?: { fgColor: { rgb: string } }
  font?: { bold?: boolean; color?: { rgb: string }; sz?: number }
  alignment?: { horizontal?: 'left' | 'center' | 'right'; vertical?: 'center' }
  numFmt?: string
}
type Cell = { v: string | number; t?: 's' | 'n'; s?: CellStyle }

const cell = (v: string | number, s?: CellStyle): Cell => ({
  v, t: typeof v === 'number' ? 'n' : 's', s,
})

const HEADER: CellStyle = {
  fill: { fgColor: { rgb: '143C64' } },
  font: { bold: true, color: { rgb: 'FFFFFF' } },
  alignment: { horizontal: 'center', vertical: 'center' },
}
const TOTAL: CellStyle = {
  fill: { fgColor: { rgb: 'F2B84B' } },
  font: { bold: true, color: { rgb: '143C64' } },
  numFmt: '#,##0',
}
const PLATA: CellStyle = { numFmt: '#,##0' }

/**
 * Libro de remuneraciones del mes en Excel: una fila por trabajador con el
 * desglose de haberes, descuentos y aportes patronales, más la fila de totales.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ periodo: string }> }) {
  const g = await guard('ver')
  if (g.denegado) return g.denegado
  const { periodo } = await params
  if (!esPeriodoValido(periodo)) {
    return NextResponse.json({ error: 'El período debe tener el formato YYYY-MM' }, { status: 400 })
  }

  try {
    const [liquidaciones, empleados] = await Promise.all([
      listarLiquidaciones(periodo),
      listarEmpleados(true),
    ])
    if (!liquidaciones.length) {
      return NextResponse.json({ error: 'El período no tiene liquidaciones calculadas.' }, { status: 404 })
    }
    const empPorId = new Map(empleados.map(e => [e.id, e]))

    const columnas = [
      'Trabajador', 'RUT', 'Cargo', 'AFP', 'Salud', 'Cremaciones',
      'Sueldo base', 'Variable', 'Semana corrida', 'Gratificación', 'Otros imponibles',
      'Total imponible', 'No imponible', 'Total haberes',
      'AFP (desc.)', 'Salud (desc.)', 'Cesantía', 'Impuesto único', 'Otros desc.', 'Total descuentos',
      'Líquido', 'Reembolso salud', 'Total a transferir',
      'Aportes empleador', 'Costo empresa',
    ]

    const aoa: Cell[][] = [
      [cell(`Libro de remuneraciones — ${nombreDePeriodo(periodo)}`, { font: { bold: true, sz: 14, color: { rgb: '143C64' } } })],
      [],
      columnas.map(c => cell(c, HEADER)),
    ]

    const busca = (lineas: { etiqueta: string; monto: number }[], re: RegExp) =>
      lineas.filter(l => re.test(l.etiqueta)).reduce((s, l) => s + l.monto, 0)

    const acc = { imponible: 0, haberes: 0, descuentos: 0, liquido: 0, reembolso: 0, transferido: 0, aportes: 0, costo: 0 }

    for (const l of liquidaciones) {
      const e = empPorId.get(l.empleado_id)
      const d = l.detalle
      const imp = d?.haberes.imponibles ?? []
      const legales = d?.descuentos.legales ?? []
      const otrosDesc = d?.descuentos.otros ?? []

      const base = busca(imp, /^SUELDO BASE/)
      const variable = busca(imp, /^Variable/)
      const semana = busca(imp, /^Semana corrida/)
      const gratif = busca(imp, /^GRATIFICACIÓN/)
      const otrosImp = (d?.totales.total_imponible ?? 0) - base - variable - semana - gratif

      const descAfp = busca(legales, /^AFP /)
      const descSalud = busca(legales, /FONASA|ISAPRE|SALUD/)
      const descAfc = busca(legales, /CESANTÍA/)
      const otros = otrosDesc.reduce((s, x) => s + x.monto, 0) + busca(legales, /^APV/)

      acc.imponible += d?.totales.total_imponible ?? 0
      acc.haberes += l.total_haberes
      acc.descuentos += l.total_descuentos
      acc.liquido += l.liquido
      acc.reembolso += l.reembolso_salud
      acc.transferido += l.total_a_transferir
      acc.aportes += l.aportes_empleador
      acc.costo += l.costo_empresa

      aoa.push([
        cell(l.empleado_nombre),
        cell(e?.rut || ''),
        cell(e?.cargo || ''),
        cell(NOMBRES_AFP[e?.afp || ''] || e?.afp || ''),
        cell(e?.prevision_salud === 'fonasa' ? 'Fonasa' : e?.prevision_salud === 'isapre' ? (e.isapre_codigo || 'Isapre') : 'Sin previsión'),
        cell(l.cremaciones),
        cell(base, PLATA), cell(variable, PLATA), cell(semana, PLATA), cell(gratif, PLATA), cell(otrosImp, PLATA),
        cell(d?.totales.total_imponible ?? 0, PLATA), cell(l.total_haberes - (d?.totales.total_imponible ?? 0), PLATA), cell(l.total_haberes, PLATA),
        cell(descAfp, PLATA), cell(descSalud, PLATA), cell(descAfc, PLATA), cell(d?.totales.impuesto_unico ?? 0, PLATA), cell(otros, PLATA), cell(l.total_descuentos, PLATA),
        cell(l.liquido, PLATA), cell(l.reembolso_salud, PLATA), cell(l.total_a_transferir, PLATA),
        cell(l.aportes_empleador, PLATA), cell(l.costo_empresa, PLATA),
      ])
    }

    aoa.push([])
    const totalRow: Cell[] = new Array(columnas.length).fill(null).map(() => cell('', TOTAL))
    totalRow[0] = cell('TOTALES', TOTAL)
    totalRow[11] = cell(acc.imponible, TOTAL)
    totalRow[13] = cell(acc.haberes, TOTAL)
    totalRow[19] = cell(acc.descuentos, TOTAL)
    totalRow[20] = cell(acc.liquido, TOTAL)
    totalRow[21] = cell(acc.reembolso, TOTAL)
    totalRow[22] = cell(acc.transferido, TOTAL)
    totalRow[23] = cell(acc.aportes, TOTAL)
    totalRow[24] = cell(acc.costo, TOTAL)
    aoa.push(totalRow)

    const ws = XLSX.utils.aoa_to_sheet(aoa)
    ws['!cols'] = [{ wch: 32 }, { wch: 14 }, { wch: 16 }, { wch: 12 }, { wch: 14 }, { wch: 12 },
      ...new Array(columnas.length - 6).fill({ wch: 15 })]

    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, `Remuneraciones ${periodo}`)
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })

    return new Response(buffer as unknown as BodyInit, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="libro_remuneraciones_${periodo}.xlsx"`,
      },
    })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
