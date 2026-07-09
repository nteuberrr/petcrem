import type { InformeVeterinaria } from './informe-veterinaria'

/**
 * Genera el workbook (.xlsx) del informe de facturación a veterinarias.
 * Paleta de marca (navy #143C64 / dorado #F2B84B — misma que lib/email-layout.ts
 * BRAND y lib/informe-veterinaria-pdf.ts), filas con altura explícita (el default
 * de Excel quedaba muy apretado con los montos) y cebrado suave para las tablas
 * largas.
 */

const NAVY = '143C64'
const NAVY_SOFT = 'E8EEF4'   // tinte navy claro (bandas de semana)
const GOLD = 'F2B84B'
const CREAM = 'FBF8F3'
const INK = '1F2937'
const MUTED = '6B7280'
const BORDER_RGB = 'D9D3C7' // cálido, a tono con el hairline de marca (ECE6DB)
const ZEBRA = 'FCFAF6'

type Style = {
  font?: { name?: string; bold?: boolean; color?: { rgb: string }; sz?: number }
  fill?: { fgColor: { rgb: string } }
  alignment?: { horizontal?: string; vertical?: string; wrapText?: boolean }
  border?: Record<string, { style: string; color: { rgb: string } }>
  numFmt?: string
}
type Cell = { v: string | number; t?: 's' | 'n'; s?: Style }

const BORDER_THIN: Style['border'] = {
  top: { style: 'thin', color: { rgb: BORDER_RGB } },
  bottom: { style: 'thin', color: { rgb: BORDER_RGB } },
  left: { style: 'thin', color: { rgb: BORDER_RGB } },
  right: { style: 'thin', color: { rgb: BORDER_RGB } },
}

function txt(v: string, s?: Style): Cell { return { v, t: 's', s } }
function num(v: number, s?: Style): Cell { return { v, t: 'n', s: { numFmt: '"$"#,##0', ...(s ?? {}) } } }
function empty(): Cell { return { v: '', t: 's' } }

const headerStyle: Style = {
  font: { bold: true, color: { rgb: 'FFFFFF' }, sz: 11 },
  fill: { fgColor: { rgb: NAVY } },
  alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
  border: BORDER_THIN,
}

export async function construirWorkbook(informe: InformeVeterinaria): Promise<Buffer> {
  const XLSXmod = await import('xlsx-js-style')
  const XLSX = XLSXmod.default ?? XLSXmod

  // ─── Hoja "Detalle" ───
  const aoa: (Cell | null)[][] = []
  const rowHeights: (number | undefined)[] = []
  const pushRow = (row: (Cell | null)[], h?: number) => { aoa.push(row); rowHeights.push(h) }

  pushRow([txt('CREMATORIO ALMA ANIMAL — Informe de facturación', {
    font: { bold: true, sz: 16, color: { rgb: 'FFFFFF' } },
    fill: { fgColor: { rgb: NAVY } },
    alignment: { horizontal: 'center', vertical: 'center' },
  })], 32)
  pushRow([txt(`Para: ${informe.veterinaria.nombre}`, { font: { bold: true, sz: 12 } })], 20)
  if (informe.veterinaria.razon_social) pushRow([txt(`Razón social: ${informe.veterinaria.razon_social}`)], 18)
  if (informe.veterinaria.rut) pushRow([txt(`RUT: ${informe.veterinaria.rut}`)], 18)
  if (informe.veterinaria.direccion || informe.veterinaria.comuna) {
    pushRow([txt(`Dirección: ${[informe.veterinaria.direccion, informe.veterinaria.comuna].filter(Boolean).join(', ')}`)], 18)
  }
  if (informe.veterinaria.nombre_contacto || informe.veterinaria.telefono || informe.veterinaria.correo) {
    const partes = [informe.veterinaria.nombre_contacto, informe.veterinaria.telefono, informe.veterinaria.correo].filter(Boolean)
    pushRow([txt(`Contacto: ${partes.join(' · ')}`)], 18)
  }
  pushRow([txt(`Fecha emisión: ${informe.fecha_emision}`)], 18)
  pushRow([txt(`Período: ${informe.rango.desde ?? '—'} a ${informe.rango.hasta}`, { font: { color: { rgb: MUTED } } })], 18)
  pushRow([], 8)

  const headers = ['Código', 'Fecha', 'Mascota', 'Tutor', 'Especie', 'Peso (kg)', 'Servicio', 'Estado',
    'Precio servicio', 'Adicionales', 'Descuento', 'Total', 'Detalle adicionales']

  const merges: { s: { r: number; c: number }; e: { r: number; c: number } }[] = []
  merges.push({ s: { r: 0, c: 0 }, e: { r: 0, c: headers.length - 1 } })

  for (const mes of informe.meses) {
    pushRow([], 10)
    const mesRow = aoa.length
    pushRow([txt(`${mes.mes_label}`, {
      font: { bold: true, sz: 14, color: { rgb: 'FFFFFF' } },
      fill: { fgColor: { rgb: NAVY } },
      alignment: { horizontal: 'left', vertical: 'center' },
    })], 26)
    merges.push({ s: { r: mesRow, c: 0 }, e: { r: mesRow, c: headers.length - 1 } })

    pushRow(headers.map(h => txt(h, headerStyle)), 24)

    for (const sem of mes.semanas) {
      if (sem.fichas.length === 0) continue
      const semRow = aoa.length
      pushRow([txt(sem.semana_label, {
        font: { bold: true, color: { rgb: NAVY }, sz: 11 },
        fill: { fgColor: { rgb: NAVY_SOFT } },
        alignment: { horizontal: 'left' },
      })], 20)
      merges.push({ s: { r: semRow, c: 0 }, e: { r: semRow, c: headers.length - 1 } })

      sem.fichas.forEach((f, i) => {
        const bg = i % 2 === 0 ? 'FFFFFF' : ZEBRA
        const cellStyle: Style = { border: BORDER_THIN, alignment: { vertical: 'center' }, fill: { fgColor: { rgb: bg } } }
        pushRow([
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
          num(f.precio_total, { ...cellStyle, font: { bold: true, color: { rgb: NAVY } } }),
          txt(f.adicionales_label || '—', { ...cellStyle, alignment: { vertical: 'center', wrapText: true } }),
        ], 20)
      })

      // Subtotal semanal
      const subRow = aoa.length
      pushRow([
        txt(`Subtotal ${sem.semana_label}`, {
          font: { bold: true, color: { rgb: NAVY } },
          fill: { fgColor: { rgb: CREAM } },
          alignment: { horizontal: 'right' },
          border: BORDER_THIN,
        }),
        empty(), empty(), empty(), empty(), empty(), empty(), empty(), empty(), empty(), empty(),
        num(sem.subtotal, {
          font: { bold: true, color: { rgb: NAVY } },
          fill: { fgColor: { rgb: CREAM } },
          border: BORDER_THIN,
        }),
        empty(),
      ], 20)
      merges.push({ s: { r: subRow, c: 0 }, e: { r: subRow, c: 10 } })
    }

    // Total mensual destacado (navy + monto en dorado, igual que el PDF)
    const totRow = aoa.length
    pushRow([
      txt(`TOTAL ${mes.mes_label.toUpperCase()} — ${mes.total_fichas} ficha${mes.total_fichas !== 1 ? 's' : ''}`, {
        font: { bold: true, sz: 12, color: { rgb: 'FFFFFF' } },
        fill: { fgColor: { rgb: NAVY } },
        alignment: { horizontal: 'right', vertical: 'center' },
      }),
      empty(), empty(), empty(), empty(), empty(), empty(), empty(), empty(), empty(), empty(),
      num(mes.total_mes, {
        font: { bold: true, sz: 13, color: { rgb: GOLD } },
        fill: { fgColor: { rgb: NAVY } },
        alignment: { horizontal: 'center', vertical: 'center' },
      }),
      empty(),
    ], 26)
    merges.push({ s: { r: totRow, c: 0 }, e: { r: totRow, c: 10 } })
  }

  // Total general
  pushRow([], 10)
  const tgRow = aoa.length
  pushRow([
    txt(`TOTAL GENERAL · ${informe.totales_generales.total_fichas} fichas en ${informe.totales_generales.cantidad_meses} mes${informe.totales_generales.cantidad_meses !== 1 ? 'es' : ''}`, {
      font: { bold: true, sz: 13, color: { rgb: 'FFFFFF' } },
      fill: { fgColor: { rgb: INK } },
      alignment: { horizontal: 'right', vertical: 'center' },
    }),
    empty(), empty(), empty(), empty(), empty(), empty(), empty(), empty(), empty(), empty(),
    num(informe.totales_generales.monto_total, {
      font: { bold: true, sz: 13, color: { rgb: GOLD } },
      fill: { fgColor: { rgb: INK } },
      alignment: { horizontal: 'center', vertical: 'center' },
    }),
    empty(),
  ], 28)
  merges.push({ s: { r: tgRow, c: 0 }, e: { r: tgRow, c: 10 } })

  const ws = XLSX.utils.aoa_to_sheet(aoa.map(r => (r ?? []).map(c => c ?? empty())))
  // Columnas más anchas (montos con separador de miles + fuente bold en Total
  // se veían pegados con el ancho anterior).
  ws['!cols'] = [
    { wch: 11 }, { wch: 13 }, { wch: 20 }, { wch: 24 }, { wch: 13 },
    { wch: 11 }, { wch: 10 }, { wch: 13 },
    { wch: 16 }, { wch: 15 }, { wch: 13 }, { wch: 16 },
    { wch: 32 },
  ]
  ws['!merges'] = merges
  ws['!rows'] = rowHeights.map(h => (h ? { hpt: h } : {}))

  // ─── Hoja "Resumen" ───
  const aoaR: (Cell | null)[][] = []
  const rowHeightsR: (number | undefined)[] = []
  const pushRowR = (row: (Cell | null)[], h?: number) => { aoaR.push(row); rowHeightsR.push(h) }

  pushRowR([txt('Resumen del período', {
    font: { bold: true, sz: 14, color: { rgb: 'FFFFFF' } },
    fill: { fgColor: { rgb: NAVY } },
    alignment: { horizontal: 'center', vertical: 'center' },
  })], 30)
  pushRowR([], 10)

  const seccionResumen = (titulo: string, filas: { etiqueta: string; count: number; monto: number }[]) => {
    pushRowR([txt(titulo, { font: { bold: true, sz: 12, color: { rgb: NAVY } } })], 22)
    pushRowR(['Concepto', 'Cantidad', 'Monto'].map(h => txt(h, headerStyle)), 22)
    filas.forEach((r, i) => {
      const bg = i % 2 === 0 ? 'FFFFFF' : ZEBRA
      pushRowR([
        txt(r.etiqueta, { border: BORDER_THIN, fill: { fgColor: { rgb: bg } } }),
        { v: r.count, t: 'n', s: { border: BORDER_THIN, fill: { fgColor: { rgb: bg } }, alignment: { horizontal: 'center' } } },
        num(r.monto, { border: BORDER_THIN, fill: { fgColor: { rgb: bg } }, font: { bold: true, color: { rgb: NAVY } } }),
      ], 20)
    })
    pushRowR([], 12)
  }

  seccionResumen('Por especie', informe.resumen.por_especie.map(r => ({ etiqueta: r.especie, count: r.count, monto: r.monto })))
  seccionResumen('Por tramo de peso', informe.resumen.por_peso.map(r => ({ etiqueta: r.rango, count: r.count, monto: r.monto })))
  seccionResumen('Por tipo de servicio', informe.resumen.por_servicio.map(r => ({ etiqueta: r.codigo, count: r.count, monto: r.monto })))

  const wsR = XLSX.utils.aoa_to_sheet(aoaR.map(r => (r ?? []).map(c => c ?? empty())))
  wsR['!cols'] = [{ wch: 22 }, { wch: 13 }, { wch: 17 }]
  wsR['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 2 } }]
  wsR['!rows'] = rowHeightsR.map(h => (h ? { hpt: h } : {}))

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Detalle')
  XLSX.utils.book_append_sheet(wb, wsR, 'Resumen')

  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', cellStyles: true })
  return buf as Buffer
}
