import { NextRequest, NextResponse } from 'next/server'
import { getSheetData, appendRow, updateRow, getNextId, ensureColumns, ensureSheet } from '@/lib/google-sheets'
import { todayISO } from '@/lib/dates'

const HOJA_PAGOS = 'pagos_rendicion'
const COLS_PAGOS = ['id', 'fecha_pago', 'usuario_pagado', 'rendicion_ids', 'monto_total', 'comentarios', 'fecha_creacion']

async function ensurePagos() {
  await ensureSheet(HOJA_PAGOS)
  await ensureColumns(HOJA_PAGOS, COLS_PAGOS)
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { rendicion_ids, fecha_pago, usuario_pagado, comentarios } = body as {
      rendicion_ids: string[]
      fecha_pago: string
      usuario_pagado: string
      comentarios?: string
    }
    if (!Array.isArray(rendicion_ids) || rendicion_ids.length === 0) {
      return NextResponse.json({ error: 'rendicion_ids requerido' }, { status: 400 })
    }
    if (!fecha_pago || !usuario_pagado) {
      return NextResponse.json({ error: 'fecha_pago y usuario_pagado requeridos' }, { status: 400 })
    }
    await ensurePagos()

    // Buscar las rendiciones para calcular monto total
    const rendiciones = await getSheetData('rendiciones')
    const idxById = new Map(rendiciones.map((r, i) => [r.id, i]))
    let montoTotal = 0
    const indices: number[] = []
    for (const id of rendicion_ids) {
      const idx = idxById.get(id)
      if (idx !== undefined) {
        indices.push(idx)
        montoTotal += parseFloat(rendiciones[idx].monto) || 0
      }
    }

    // Crear registro de pago
    const pagoId = await getNextId(HOJA_PAGOS)
    const now = todayISO()
    const pagoRow = {
      id: pagoId,
      fecha_pago,
      usuario_pagado,
      rendicion_ids: JSON.stringify(rendicion_ids),
      monto_total: String(montoTotal),
      comentarios: comentarios ?? '',
      fecha_creacion: now,
    }
    await appendRow(HOJA_PAGOS, pagoRow)

    // Marcar rendiciones como pagadas con referencia al pago
    await Promise.all(
      indices.map((idx) =>
        updateRow('rendiciones', idx, {
          ...rendiciones[idx],
          estado: 'pagado',
          pago_id: pagoId,
        })
      )
    )

    return NextResponse.json({ ok: true, pago_id: pagoId, monto_total: montoTotal, rendiciones_pagadas: indices.length }, { status: 201 })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
