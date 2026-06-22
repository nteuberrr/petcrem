import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { getSheetData, appendRow, getNextId, updateById, updateByIdIf, deleteById, ensureColumns, ensureSheet } from '@/lib/datastore'
import { todayISO, formatDateForSheet } from '@/lib/dates'
import { esAdmin } from '@/lib/roles'

export const dynamic = 'force-dynamic'

const HOJA = 'pagos_retiros'
const COLS = [
  'id', 'fecha_pago', 'usuario_id', 'usuario_nombre',
  'retiros_ids', 'cantidad', 'monto_total', 'comentarios',
  'creado_por', 'fecha_creacion',
]

const HOJA_RETIROS = 'retiros_adicionales'
const COLS_RETIROS = ['id', 'usuario_id', 'usuario_nombre', 'fecha', 'hora', 'cliente_nombre', 'comentario', 'pago_id', 'fecha_creacion']

async function ensure() {
  await ensureSheet(HOJA)
  await ensureColumns(HOJA, COLS)
  await ensureSheet(HOJA_RETIROS)
  await ensureColumns(HOJA_RETIROS, COLS_RETIROS)
}

export async function GET() {
  try {
    const session = await getServerSession(authOptions)
    if (!session || !esAdmin(session.user?.role)) {
      return NextResponse.json({ error: 'Solo admin' }, { status: 403 })
    }
    await ensure()
    const rows = await getSheetData(HOJA)
    const pagos = rows.map(r => ({
      id: r.id,
      fecha_pago: formatDateForSheet(r.fecha_pago) || r.fecha_pago,
      usuario_id: r.usuario_id,
      usuario_nombre: r.usuario_nombre,
      retiros_ids: (() => {
        try { return JSON.parse(r.retiros_ids || '[]') as string[] } catch { return [] }
      })(),
      cantidad: parseInt(r.cantidad || '0', 10) || 0,
      monto_total: parseFloat(r.monto_total) || 0,
      comentarios: r.comentarios,
      creado_por: r.creado_por,
      fecha_creacion: formatDateForSheet(r.fecha_creacion) || r.fecha_creacion,
    }))
    pagos.sort((a, b) => b.fecha_pago.localeCompare(a.fecha_pago))
    return NextResponse.json(pagos)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session || !esAdmin(session.user?.role)) {
      return NextResponse.json({ error: 'Solo admin' }, { status: 403 })
    }
    const body = await req.json()
    const { fecha_pago, retiros_ids, comentarios } = body
    if (!fecha_pago || !Array.isArray(retiros_ids) || retiros_ids.length === 0) {
      return NextResponse.json({ error: 'fecha_pago y al menos 1 retiro_id son requeridos' }, { status: 400 })
    }
    await ensure()

    // Validar que los retiros existan, no estén ya pagados y obtener usuario asociado
    const retiros = await getSheetData(HOJA_RETIROS)
    const seleccionados = retiros.filter(r => retiros_ids.includes(r.id))
    if (seleccionados.length !== retiros_ids.length) {
      return NextResponse.json({ error: 'Algunos retiros no existen' }, { status: 400 })
    }
    const yaPagados = seleccionados.filter(r => r.pago_id)
    if (yaPagados.length > 0) {
      return NextResponse.json({
        error: `${yaPagados.length} retiros ya están pagados. Refrescá la página.`,
      }, { status: 409 })
    }

    // Todos deben ser del mismo operador (un pago = un chofer)
    const operadores = new Set(seleccionados.map(r => r.usuario_id))
    if (operadores.size > 1) {
      return NextResponse.json({ error: 'No se pueden mezclar retiros de distintos operadores en un mismo pago' }, { status: 400 })
    }
    const usuarioId = seleccionados[0].usuario_id
    const usuarioNombre = seleccionados[0].usuario_nombre

    // Obtener precio vigente al momento del pago
    const configs = await getSheetData('jornada_config')
    const fechaIso = formatDateForSheet(String(fecha_pago)) || String(fecha_pago)
    const elegibles = configs
      .map(c => ({
        vigente_desde: formatDateForSheet(c.vigente_desde) || c.vigente_desde,
        precio_retiro_adicional: parseFloat(c.precio_retiro_adicional || '0') || 0,
      }))
      .filter(c => c.vigente_desde && c.vigente_desde <= fechaIso)
      .sort((a, b) => b.vigente_desde.localeCompare(a.vigente_desde))
    const precio = elegibles[0]?.precio_retiro_adicional ?? 0
    const monto_total = retiros_ids.length * precio

    const id = await getNextId(HOJA)

    // Marcar cada retiro de forma ATÓMICA: solo lo toma si sigue impago
    // (pago_id === ''). Si un pago concurrente ya tomó alguno, revertimos los que
    // alcanzamos a marcar y abortamos — así un retiro nunca se paga dos veces.
    const marcados: string[] = []
    for (const rid of retiros_ids) {
      const ok = await updateByIdIf('retiros_adicionales', String(rid), { pago_id: '' }, { pago_id: id })
      if (!ok) {
        for (const done of marcados) {
          await updateById('retiros_adicionales', done, { pago_id: '' }).catch(() => {})
        }
        return NextResponse.json({ error: 'Alguno de los retiros ya fue pagado. Refrescá la página.' }, { status: 409 })
      }
      marcados.push(String(rid))
    }

    const row = {
      id,
      fecha_pago: fechaIso,
      usuario_id: usuarioId,
      usuario_nombre: usuarioNombre,
      retiros_ids: JSON.stringify(retiros_ids),
      cantidad: retiros_ids.length,
      monto_total,
      comentarios: comentarios ?? '',
      creado_por: session.user?.email ?? '',
      fecha_creacion: todayISO(),
    }

    // Si el append falla, revertimos las marcas para no dejar retiros pagados
    // sin su pago correspondiente.
    try {
      await appendRow(HOJA, row)
    } catch (e) {
      for (const done of marcados) {
        await updateById('retiros_adicionales', done, { pago_id: '' }).catch(() => {})
      }
      throw e
    }

    return NextResponse.json(row, { status: 201 })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session || !esAdmin(session.user?.role)) {
      return NextResponse.json({ error: 'Solo admin' }, { status: 403 })
    }
    const { searchParams } = new URL(req.url)
    const id = searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'id requerido' }, { status: 400 })
    await ensure()

    const rows = await getSheetData(HOJA)
    const idx = rows.findIndex(r => r.id === id)
    if (idx === -1) return NextResponse.json({ error: 'No encontrado' }, { status: 404 })
    const pago = rows[idx]
    let retirosIds: string[] = []
    try { retirosIds = JSON.parse(pago.retiros_ids || '[]') } catch { /* noop */ }

    // Revertir: limpiar pago_id solo de los retiros que sigan apuntando a ESTE pago
    for (const rid of retirosIds) {
      await updateByIdIf('retiros_adicionales', rid, { pago_id: String(id) }, { pago_id: '' }).catch(() => {})
    }

    // Eliminar la fila del pago
    await deleteById(HOJA, id)

    return NextResponse.json({ ok: true, retiros_revertidos: retirosIds.length })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
