import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { generarInformeVeterinaria, type InformeVeterinaria } from '@/lib/informe-veterinaria'
import { appendRow, ensureSheet, ensureColumns, getSheetData, getNextId } from '@/lib/datastore'
import { uploadToR2 } from '@/lib/cloudflare-r2'
import { todayISO } from '@/lib/dates'
import { esAdmin } from '@/lib/roles'

const INFORMES_COLS = [
  'id', 'veterinaria_id', 'veterinaria_nombre',
  'version', 'formato',
  'periodo_hasta_mes', 'cantidad_meses', 'cantidad_fichas', 'monto_total_clp',
  'fecha_emision', 'hora_emision',
  'emitido_por_id', 'emitido_por_nombre',
  'archivo_key', 'archivo_url',
  'fecha_creacion',
]

type Style = {
  font?: { name?: string; bold?: boolean; color?: { rgb: string }; sz?: number }
  fill?: { fgColor: { rgb: string } }
  alignment?: { horizontal?: string; vertical?: string; wrapText?: boolean }
  border?: Record<string, { style: string; color: { rgb: string } }>
  numFmt?: string
}
type Cell = { v: string | number; t?: 's' | 'n'; s?: Style }

const BORDER_THIN: Style['border'] = {
  top: { style: 'thin', color: { rgb: 'CCCCCC' } },
  bottom: { style: 'thin', color: { rgb: 'CCCCCC' } },
  left: { style: 'thin', color: { rgb: 'CCCCCC' } },
  right: { style: 'thin', color: { rgb: 'CCCCCC' } },
}

function txt(v: string, s?: Style): Cell { return { v, t: 's', s } }
function num(v: number, s?: Style): Cell { return { v, t: 'n', s: { numFmt: '"$"#,##0', ...(s ?? {}) } } }
function empty(): Cell { return { v: '', t: 's' } }

async function construirWorkbook(informe: InformeVeterinaria): Promise<Buffer> {
  const XLSXmod = await import('xlsx-js-style')
  const XLSX = XLSXmod.default ?? XLSXmod

  // ─── Hoja "Detalle" ───
  const aoa: (Cell | null)[][] = []

  // Header
  aoa.push([txt('CREMATORIO ALMA ANIMAL — Informe de facturación', {
    font: { bold: true, sz: 16, color: { rgb: 'FFFFFF' } },
    fill: { fgColor: { rgb: '1F2937' } },
    alignment: { horizontal: 'center', vertical: 'center' },
  })])
  aoa.push([txt(`Para: ${informe.veterinaria.nombre}`, { font: { bold: true, sz: 12 } })])
  if (informe.veterinaria.razon_social) {
    aoa.push([txt(`Razón social: ${informe.veterinaria.razon_social}`)])
  }
  if (informe.veterinaria.rut) aoa.push([txt(`RUT: ${informe.veterinaria.rut}`)])
  if (informe.veterinaria.direccion || informe.veterinaria.comuna) {
    aoa.push([txt(`Dirección: ${[informe.veterinaria.direccion, informe.veterinaria.comuna].filter(Boolean).join(', ')}`)])
  }
  if (informe.veterinaria.nombre_contacto || informe.veterinaria.telefono || informe.veterinaria.correo) {
    const partes = [informe.veterinaria.nombre_contacto, informe.veterinaria.telefono, informe.veterinaria.correo].filter(Boolean)
    aoa.push([txt(`Contacto: ${partes.join(' · ')}`)])
  }
  aoa.push([txt(`Fecha emisión: ${informe.fecha_emision}`)])
  aoa.push([txt(`Período: ${informe.rango.desde ?? '—'} a ${informe.rango.hasta}`, {
    font: { color: { rgb: '6B7280' } },
  })])
  aoa.push([])  // blank row

  // Header tabla
  const headers = ['Código', 'Fecha', 'Mascota', 'Tutor', 'Especie', 'Peso (kg)', 'Servicio', 'Estado',
    'Precio servicio', 'Adicionales', 'Descuento', 'Total', 'Detalle adicionales']
  const headerStyle: Style = {
    font: { bold: true, color: { rgb: 'FFFFFF' }, sz: 11 },
    fill: { fgColor: { rgb: '4F46E5' } },
    alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
    border: BORDER_THIN,
  }

  const merges: { s: { r: number; c: number }; e: { r: number; c: number } }[] = []
  const titleRow = 0
  merges.push({ s: { r: titleRow, c: 0 }, e: { r: titleRow, c: headers.length - 1 } })

  for (const mes of informe.meses) {
    aoa.push([])  // separator
    const mesRow = aoa.length
    aoa.push([txt(`📅 ${mes.mes_label}`, {
      font: { bold: true, sz: 14, color: { rgb: 'FFFFFF' } },
      fill: { fgColor: { rgb: '4F46E5' } },
      alignment: { horizontal: 'left', vertical: 'center' },
    })])
    merges.push({ s: { r: mesRow, c: 0 }, e: { r: mesRow, c: headers.length - 1 } })

    // Headers de tabla
    aoa.push(headers.map(h => txt(h, headerStyle)))

    for (const sem of mes.semanas) {
      if (sem.fichas.length === 0) continue
      const semRow = aoa.length
      aoa.push([txt(sem.semana_label, {
        font: { bold: true, color: { rgb: '4F46E5' }, sz: 11 },
        fill: { fgColor: { rgb: 'EEF2FF' } },
        alignment: { horizontal: 'left' },
      })])
      merges.push({ s: { r: semRow, c: 0 }, e: { r: semRow, c: headers.length - 1 } })

      for (const f of sem.fichas) {
        const cellStyle: Style = { border: BORDER_THIN, alignment: { vertical: 'center' } }
        aoa.push([
          txt(f.codigo, { ...cellStyle, font: { sz: 10 } }),
          txt(f.fecha_label, cellStyle),
          txt(f.mascota, cellStyle),
          txt(f.tutor, cellStyle),
          txt(f.especie, cellStyle),
          { v: f.peso, t: 'n', s: { ...cellStyle, numFmt: '0.0' } },
          txt(f.codigo_servicio, cellStyle),
          txt(f.estado, cellStyle),
          num(f.precio_servicio, cellStyle),
          num(f.precio_adicionales, cellStyle),
          num(f.descuento_monto, cellStyle),
          num(f.precio_total, { ...cellStyle, font: { bold: true } }),
          txt(f.adicionales_label || '—', { ...cellStyle, alignment: { vertical: 'center', wrapText: true } }),
        ])
      }

      // Subtotal semanal
      const subRow = aoa.length
      aoa.push([
        txt(`Subtotal ${sem.semana_label}`, {
          font: { bold: true, color: { rgb: '4F46E5' } },
          fill: { fgColor: { rgb: 'F3F4F6' } },
          alignment: { horizontal: 'right' },
          border: BORDER_THIN,
        }),
        empty(), empty(), empty(), empty(), empty(), empty(), empty(), empty(), empty(), empty(),
        num(sem.subtotal, {
          font: { bold: true, color: { rgb: '4F46E5' } },
          fill: { fgColor: { rgb: 'F3F4F6' } },
          border: BORDER_THIN,
        }),
        empty(),
      ])
      merges.push({ s: { r: subRow, c: 0 }, e: { r: subRow, c: 10 } })
    }

    // Total mensual destacado
    const totRow = aoa.length
    aoa.push([
      txt(`TOTAL ${mes.mes_label.toUpperCase()} — ${mes.total_fichas} ficha${mes.total_fichas !== 1 ? 's' : ''}`, {
        font: { bold: true, sz: 12, color: { rgb: 'FFFFFF' } },
        fill: { fgColor: { rgb: '10B981' } },
        alignment: { horizontal: 'right', vertical: 'center' },
      }),
      empty(), empty(), empty(), empty(), empty(), empty(), empty(), empty(), empty(), empty(),
      num(mes.total_mes, {
        font: { bold: true, sz: 12, color: { rgb: 'FFFFFF' } },
        fill: { fgColor: { rgb: '10B981' } },
        alignment: { horizontal: 'center', vertical: 'center' },
      }),
      empty(),
    ])
    merges.push({ s: { r: totRow, c: 0 }, e: { r: totRow, c: 10 } })
  }

  // Total general
  aoa.push([])
  const tgRow = aoa.length
  aoa.push([
    txt(`TOTAL GENERAL · ${informe.totales_generales.total_fichas} fichas en ${informe.totales_generales.cantidad_meses} mes${informe.totales_generales.cantidad_meses !== 1 ? 'es' : ''}`, {
      font: { bold: true, sz: 13, color: { rgb: 'FFFFFF' } },
      fill: { fgColor: { rgb: '1F2937' } },
      alignment: { horizontal: 'right', vertical: 'center' },
    }),
    empty(), empty(), empty(), empty(), empty(), empty(), empty(), empty(), empty(), empty(),
    num(informe.totales_generales.monto_total, {
      font: { bold: true, sz: 13, color: { rgb: 'FFFFFF' } },
      fill: { fgColor: { rgb: '1F2937' } },
      alignment: { horizontal: 'center', vertical: 'center' },
    }),
    empty(),
  ])
  merges.push({ s: { r: tgRow, c: 0 }, e: { r: tgRow, c: 10 } })

  const ws = XLSX.utils.aoa_to_sheet(aoa.map(r => (r ?? []).map(c => c ?? empty())))
  ws['!cols'] = [
    { wch: 10 }, { wch: 12 }, { wch: 18 }, { wch: 22 }, { wch: 12 },
    { wch: 10 }, { wch: 10 }, { wch: 12 },
    { wch: 14 }, { wch: 13 }, { wch: 12 }, { wch: 14 },
    { wch: 30 },
  ]
  ws['!merges'] = merges
  ws['!rows'] = [{ hpt: 30 }]  // título más alto

  // ─── Hoja "Resumen" ───
  const aoaR: (Cell | null)[][] = []
  aoaR.push([txt('Resumen del período', {
    font: { bold: true, sz: 14, color: { rgb: 'FFFFFF' } },
    fill: { fgColor: { rgb: '1F2937' } },
    alignment: { horizontal: 'center', vertical: 'center' },
  })])
  aoaR.push([])

  aoaR.push([txt('Por especie', { font: { bold: true, sz: 12, color: { rgb: '4F46E5' } } })])
  aoaR.push(['Especie', 'Cantidad', 'Monto'].map(h => txt(h, headerStyle)))
  for (const r of informe.resumen.por_especie) {
    aoaR.push([
      txt(r.especie, { border: BORDER_THIN }),
      { v: r.count, t: 'n', s: { border: BORDER_THIN, alignment: { horizontal: 'center' } } },
      num(r.monto, { border: BORDER_THIN }),
    ])
  }
  aoaR.push([])

  aoaR.push([txt('Por tramo de peso', { font: { bold: true, sz: 12, color: { rgb: '4F46E5' } } })])
  aoaR.push(['Tramo', 'Cantidad', 'Monto'].map(h => txt(h, headerStyle)))
  for (const r of informe.resumen.por_peso) {
    aoaR.push([
      txt(r.rango, { border: BORDER_THIN }),
      { v: r.count, t: 'n', s: { border: BORDER_THIN, alignment: { horizontal: 'center' } } },
      num(r.monto, { border: BORDER_THIN }),
    ])
  }
  aoaR.push([])

  aoaR.push([txt('Por tipo de servicio', { font: { bold: true, sz: 12, color: { rgb: '4F46E5' } } })])
  aoaR.push(['Código', 'Cantidad', 'Monto'].map(h => txt(h, headerStyle)))
  for (const r of informe.resumen.por_servicio) {
    aoaR.push([
      txt(r.codigo, { border: BORDER_THIN, alignment: { horizontal: 'center' } }),
      { v: r.count, t: 'n', s: { border: BORDER_THIN, alignment: { horizontal: 'center' } } },
      num(r.monto, { border: BORDER_THIN }),
    ])
  }

  const wsR = XLSX.utils.aoa_to_sheet(aoaR.map(r => (r ?? []).map(c => c ?? empty())))
  wsR['!cols'] = [{ wch: 20 }, { wch: 12 }, { wch: 16 }]
  wsR['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 2 } }]

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Detalle')
  XLSX.utils.book_append_sheet(wb, wsR, 'Resumen')

  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', cellStyles: true })
  return buf as Buffer
}

async function calcularVersion(vetId: string): Promise<number> {
  try {
    await ensureSheet('informes_veterinaria')
    await ensureColumns('informes_veterinaria', INFORMES_COLS)
    const rows = await getSheetData('informes_veterinaria')
    const propios = rows.filter(r => r.veterinaria_id === vetId)
    return propios.length + 1
  } catch {
    return 1
  }
}

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions)
    const role = (session?.user as { role?: string })?.role
    if (!esAdmin(role)) {
      return NextResponse.json({ error: 'Solo administradores pueden generar informes' }, { status: 403 })
    }

    const { id } = await params
    const informe = await generarInformeVeterinaria(id)
    if (informe.totales_generales.total_fichas === 0) {
      return NextResponse.json({ error: 'Esta veterinaria aún no tiene fichas para facturar (mes cerrado)' }, { status: 400 })
    }

    const buffer = await construirWorkbook(informe)

    // Subir a R2
    const safeName = (informe.veterinaria.nombre || `vet${id}`).replace(/[^a-zA-Z0-9_-]+/g, '_')
    const version = await calcularVersion(id)
    const filename = `Informe_${safeName}_v${version}.xlsx`
    const key = `informes-veterinaria/${id}/${filename}`
    const upload = await uploadToR2(buffer, key, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').catch(err => {
      console.error('[informe/excel] uploadToR2 falló:', err)
      return null
    })

    // Registrar versión
    try {
      await ensureSheet('informes_veterinaria')
      await ensureColumns('informes_veterinaria', INFORMES_COLS)
      const informeId = await getNextId('informes_veterinaria')
      const now = new Date()
      const hh = String(now.getHours()).padStart(2, '0')
      const mm = String(now.getMinutes()).padStart(2, '0')
      await appendRow('informes_veterinaria', {
        id: informeId,
        veterinaria_id: id,
        veterinaria_nombre: informe.veterinaria.nombre,
        version,
        formato: 'excel',
        periodo_hasta_mes: informe.rango.hasta.slice(0, 7),
        cantidad_meses: informe.totales_generales.cantidad_meses,
        cantidad_fichas: informe.totales_generales.total_fichas,
        monto_total_clp: informe.totales_generales.monto_total,
        fecha_emision: todayISO(),
        hora_emision: `${hh}:${mm}`,
        emitido_por_id: (session?.user as { id?: string })?.id ?? '',
        emitido_por_nombre: session?.user?.name || session?.user?.email || '',
        archivo_key: upload?.key ?? '',
        archivo_url: upload?.url ?? '',
        fecha_creacion: todayISO(),
      })
    } catch (err) {
      console.error('[informe/excel] persistencia falló:', err)
    }

    return new Response(buffer as unknown as BodyInit, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    })
  } catch (e: unknown) {
    const err = e as { status?: number; message?: string }
    return NextResponse.json({ error: err.message ?? String(e) }, { status: err.status ?? 500 })
  }
}

