import { NextRequest, NextResponse } from 'next/server'
import { getSheetData, appendRow, updateByIdIf, getNextId, ensureColumns, ensureSheet } from '@/lib/datastore'
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

    // Buscar las rendiciones seleccionadas y validar que existan y no estén pagadas.
    const rendiciones = await getSheetData('rendiciones')
    const byId = new Map(rendiciones.map(r => [r.id, r]))
    const seleccionadas: Record<string, string>[] = []
    for (const id of rendicion_ids) {
      const r = byId.get(id)
      if (!r) return NextResponse.json({ error: 'Alguna rendición no existe. Refrescá la página.' }, { status: 400 })
      seleccionadas.push(r)
    }
    const yaPagadas = seleccionadas.filter(r => r.estado === 'pagado' || r.pago_id)
    if (yaPagadas.length > 0) {
      return NextResponse.json({ error: `${yaPagadas.length} rendición(es) ya están pagadas. Refrescá la página.` }, { status: 409 })
    }
    const montoTotal = seleccionadas.reduce((s, r) => s + (parseFloat(r.monto) || 0), 0)

    const pagoId = await getNextId(HOJA_PAGOS)

    // Marcar cada rendición de forma ATÓMICA: solo la toma si sigue impaga
    // (pago_id === ''). Si un pago concurrente ya tomó alguna, revertimos las que
    // alcanzamos a marcar y abortamos — así no se paga dos veces.
    const marcadas: { id: string; estadoPrev: string }[] = []
    const revertir = async () => {
      for (const m of marcadas) {
        await updateByIdIf('rendiciones', m.id, { pago_id: String(pagoId) }, { estado: m.estadoPrev, pago_id: '' }).catch(() => {})
      }
    }
    for (const r of seleccionadas) {
      const ok = await updateByIdIf('rendiciones', r.id, { pago_id: '' }, { estado: 'pagado', pago_id: pagoId })
      if (!ok) {
        await revertir()
        return NextResponse.json({ error: 'Alguna rendición ya fue pagada. Refrescá la página.' }, { status: 409 })
      }
      marcadas.push({ id: String(r.id), estadoPrev: r.estado ?? '' })
    }

    // Crear el registro de pago. Si falla, revertimos las marcas para no dejar
    // rendiciones pagadas sin su pago correspondiente.
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
    try {
      await appendRow(HOJA_PAGOS, pagoRow)
    } catch (e) {
      await revertir()
      throw e
    }

    return NextResponse.json({ ok: true, pago_id: pagoId, monto_total: montoTotal, rendiciones_pagadas: marcadas.length }, { status: 201 })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
