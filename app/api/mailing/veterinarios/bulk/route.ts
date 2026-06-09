import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { getSheetData, updateRow, deleteRow } from '@/lib/datastore'
import { esAdmin } from '@/lib/roles'

const SHEET = 'mailing_veterinarios'

type BulkAction = 'set_categoria' | 'set_suscrito' | 'delete'

interface BulkBody {
  ids: string[]
  action: BulkAction
  value?: string  // para set_categoria ('prospecto'/'cliente'/'inactivo') o set_suscrito ('TRUE'/'FALSE')
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!esAdmin((session?.user as { role?: string })?.role)) {
    return NextResponse.json({ error: 'Solo admin' }, { status: 403 })
  }

  try {
    const body = (await req.json()) as BulkBody
    if (!Array.isArray(body.ids) || body.ids.length === 0) {
      return NextResponse.json({ error: 'ids requerido' }, { status: 400 })
    }
    if (!['set_categoria', 'set_suscrito', 'delete'].includes(body.action)) {
      return NextResponse.json({ error: 'action inválida' }, { status: 400 })
    }

    const rows = await getSheetData(SHEET)
    const idsSet = new Set(body.ids)
    // Procesar de mayor a menor índice para que deleteRow no descalce los índices
    const matches = rows
      .map((r, i) => ({ row: r, idx: i }))
      .filter(x => idsSet.has(x.row.id))
      .sort((a, b) => b.idx - a.idx)

    let affected = 0
    for (const m of matches) {
      if (body.action === 'delete') {
        await deleteRow(SHEET, m.idx)
        affected++
      } else if (body.action === 'set_categoria') {
        const value = (body.value || '').trim()
        if (!value) continue
        await updateRow(SHEET, m.idx, { ...m.row, categoria: value })
        affected++
      } else if (body.action === 'set_suscrito') {
        const value = body.value === 'FALSE' || body.value === 'false' ? 'FALSE' : 'TRUE'
        await updateRow(SHEET, m.idx, { ...m.row, suscrito: value })
        affected++
      }
    }
    return NextResponse.json({ ok: true, affected })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
