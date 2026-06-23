import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { esAdminTotal } from '@/lib/roles'
import { getSheetData, appendRow, updateById, getNextId, deleteById, ensureColumns, ensureSheet } from '@/lib/datastore'
import { todayISO } from '@/lib/dates'

// Editar/eliminar rendiciones existentes es solo del admin principal; admin2 puede
// ver, crear y pagar (gateado en proxy.ts), pero no corregir/borrar.
async function noEsPrincipal(): Promise<boolean> {
  const s = await getServerSession(authOptions)
  return !esAdminTotal((s?.user as { role?: string })?.role)
}

const HOJA = 'rendiciones'
const COLS = ['id', 'usuario', 'descripcion', 'fecha', 'monto', 'tipo_documento', 'partida_id', 'clasificacion', 'estado', 'pago_id', 'fecha_creacion']
// Documento: boleta | factura | '' (vacío en los aportes). Clasificación: rendicion | aporte.
const DOCS = ['boleta', 'factura']
const CLASIF = ['rendicion', 'aporte']

async function ensure() {
  await ensureSheet(HOJA)
  await ensureColumns(HOJA, COLS)
}

export async function GET() {
  try {
    await ensure()
    const rows = await getSheetData(HOJA)
    return NextResponse.json(rows.reverse())
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    if (!body.usuario || !body.descripcion || !body.fecha || body.monto === undefined) {
      return NextResponse.json({ error: 'usuario, descripcion, fecha y monto requeridos' }, { status: 400 })
    }
    await ensure()
    const id = await getNextId(HOJA)
    // Clasificación: rendicion | aporte. El aporte (préstamo a la empresa) no tiene
    // documento ni partida y NO va al resultado del EERR.
    const clasif = CLASIF.includes(body.clasificacion) ? String(body.clasificacion) : 'rendicion'
    const tipoDoc = clasif === 'aporte' ? '' : (DOCS.includes(body.tipo_documento) ? String(body.tipo_documento) : 'boleta')
    // Solo una BOLETA de una RENDICIÓN se asigna a una partida del EERR.
    const partida = clasif === 'rendicion' && tipoDoc === 'boleta' ? String(body.partida_id || '') : ''
    const row = {
      id,
      usuario: String(body.usuario),
      descripcion: String(body.descripcion),
      fecha: String(body.fecha),
      monto: String(body.monto),
      tipo_documento: tipoDoc,
      clasificacion: clasif,
      partida_id: partida,
      estado: 'pendiente',
      pago_id: '',
      fecha_creacion: todayISO(),
    }
    await appendRow(HOJA, row)
    return NextResponse.json(row, { status: 201 })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    if (await noEsPrincipal()) return NextResponse.json({ error: 'Solo el administrador principal puede editar rendiciones.' }, { status: 403 })
    const body = await req.json()
    const { id, ids, ...updates } = body
    await ensure()

    // Aplica las reglas de coherencia: un aporte no tiene documento ni partida;
    // una factura no lleva partida (solo la boleta de una rendición).
    const normalizar = (u: Record<string, unknown>) => {
      if (u.clasificacion === 'aporte') { u.tipo_documento = ''; u.partida_id = '' }
      else if (u.tipo_documento === 'factura') { u.partida_id = '' }
      return u
    }

    // Bulk: cambiar documento y/o clasificación de varias rendiciones a la vez.
    if (Array.isArray(ids) && ids.length > 0) {
      const rows = await getSheetData(HOJA)
      const byId = new Map(rows.map(r => [String(r.id), r]))
      let asignadas = 0
      for (const rid of ids) {
        const row = byId.get(String(rid))
        if (!row) continue
        await updateById(HOJA, row.id, normalizar({ ...row, ...updates }))
        asignadas++
      }
      return NextResponse.json({ ok: true, asignadas })
    }

    if (!id) return NextResponse.json({ error: 'id requerido' }, { status: 400 })
    const rows = await getSheetData(HOJA)
    const row = rows.find(r => String(r.id) === String(id))
    if (!row) return NextResponse.json({ error: 'No encontrado' }, { status: 404 })
    const updated = normalizar({ ...row, ...updates })
    await updateById(HOJA, String(id), updated)
    return NextResponse.json(updated)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    if (await noEsPrincipal()) return NextResponse.json({ error: 'Solo el administrador principal puede eliminar rendiciones.' }, { status: 403 })
    const { searchParams } = new URL(req.url)
    const id = searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'id requerido' }, { status: 400 })
    await ensure()
    const rows = await getSheetData(HOJA)
    if (!rows.some(r => String(r.id) === String(id))) return NextResponse.json({ error: 'No encontrado' }, { status: 404 })
    await deleteById(HOJA, id)
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
