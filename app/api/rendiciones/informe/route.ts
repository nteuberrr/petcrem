import { NextResponse } from 'next/server'
import { getSheetData } from '@/lib/google-sheets'
import * as XLSX from 'xlsx-js-style'

type CellStyle = {
  fill?: { fgColor: { rgb: string } }
  font?: { bold?: boolean; color?: { rgb: string } }
  alignment?: { horizontal?: 'left' | 'center' | 'right'; vertical?: 'top' | 'center' | 'bottom' }
  border?: {
    top?: { style: string; color: { rgb: string } }
    bottom?: { style: string; color: { rgb: string } }
    left?: { style: string; color: { rgb: string } }
    right?: { style: string; color: { rgb: string } }
  }
}

type Cell = { v: string | number; t?: 's' | 'n'; s?: CellStyle }

function cell(value: string | number, style?: CellStyle): Cell {
  return {
    v: value,
    t: typeof value === 'number' ? 'n' : 's',
    s: style,
  }
}

export async function GET() {
  try {
    const rows = await getSheetData('rendiciones')

    const header = ['Usuario', 'Descripción', 'Fecha', 'Monto', 'Tipo documento', 'Estado']
    const headerStyle: CellStyle = {
      fill: { fgColor: { rgb: '1F2937' } },
      font: { bold: true, color: { rgb: 'FFFFFF' } },
      alignment: { horizontal: 'center', vertical: 'center' },
    }

    const aoa: Cell[][] = [header.map(h => cell(h, headerStyle))]

    let totalPendiente = 0
    let totalPagado = 0
    for (const r of rows) {
      const monto = parseFloat(r.monto) || 0
      const pendiente = r.estado !== 'pagado'
      if (pendiente) totalPendiente += monto
      else totalPagado += monto

      const color = pendiente ? 'FEF3C7' : 'D1FAE5'
      const row: Cell[] = [
        cell(r.usuario ?? '', { fill: { fgColor: { rgb: color } } }),
        cell(r.descripcion ?? '', { fill: { fgColor: { rgb: color } } }),
        cell(r.fecha ?? '', { fill: { fgColor: { rgb: color } }, alignment: { horizontal: 'center' } }),
        cell(monto, { fill: { fgColor: { rgb: color } }, alignment: { horizontal: 'right' } }),
        cell(r.tipo_documento ?? '', { fill: { fgColor: { rgb: color } }, alignment: { horizontal: 'center' } }),
        cell(r.estado ?? 'pendiente', {
          fill: { fgColor: { rgb: color } },
          alignment: { horizontal: 'center' },
          font: { bold: true, color: { rgb: pendiente ? '92400E' : '065F46' } },
        }),
      ]
      aoa.push(row)
    }

    // Fila en blanco + totales
    aoa.push([])
    const totalStyle: CellStyle = {
      font: { bold: true },
      fill: { fgColor: { rgb: 'E5E7EB' } },
    }
    aoa.push([cell('Total pendiente', totalStyle), cell('', totalStyle), cell('', totalStyle), cell(totalPendiente, { ...totalStyle, alignment: { horizontal: 'right' } }), cell('', totalStyle), cell('', totalStyle)])
    aoa.push([cell('Total pagado', totalStyle), cell('', totalStyle), cell('', totalStyle), cell(totalPagado, { ...totalStyle, alignment: { horizontal: 'right' } }), cell('', totalStyle), cell('', totalStyle)])

    const ws = XLSX.utils.aoa_to_sheet(aoa)
    ws['!cols'] = [{ wch: 22 }, { wch: 40 }, { wch: 14 }, { wch: 14 }, { wch: 16 }, { wch: 14 }]

    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Rendiciones')

    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
    const now = new Date()
    const filename = `rendiciones_${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}.xlsx`

    return new Response(buffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
