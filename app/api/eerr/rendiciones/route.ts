import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { esAdminTotal } from '@/lib/roles'
import { getSheetData, updateById } from '@/lib/datastore'

export const dynamic = 'force-dynamic'

const SHEET = 'rendiciones'

async function noAutorizado(): Promise<boolean> {
  const s = await getServerSession(authOptions)
  return !esAdminTotal((s?.user as { role?: string })?.role)
}

/** Boletas de rendiciones (las únicas que alimentan el EERR). Solo lectura acá:
 *  se crean/eliminan en el módulo Rendiciones; desde Compras solo se les asigna
 *  la partida. */
export async function GET() {
  if (await noAutorizado()) return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
  try {
    const rows = await getSheetData(SHEET)
    const boletas = rows.filter(r => r.tipo_documento === 'boleta')
    boletas.sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''))
    return NextResponse.json(boletas)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

/** Asigna la partida a una boleta (individual `{id}`) o a varias `{ids}`. El tipo
 *  (costo/gasto) lo determina la partida, así que solo guardamos partida_id. No se
 *  permite editar montos/fecha/usuario (eso vive en Rendiciones). */
export async function PATCH(req: NextRequest) {
  if (await noAutorizado()) return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
  try {
    const b = await req.json()
    const { id, ids } = b
    const partidaFinal = String(b.partida_id || '')
    const rows = await getSheetData(SHEET)
    const byId = new Map(rows.map(r => [String(r.id), r]))

    if (Array.isArray(ids) && ids.length > 0) {
      let asignadas = 0
      for (const rid of ids) {
        const row = byId.get(String(rid))
        if (!row || row.tipo_documento !== 'boleta') continue
        await updateById(SHEET, row.id, { ...row, partida_id: partidaFinal })
        asignadas++
      }
      return NextResponse.json({ ok: true, asignadas })
    }

    if (!id) return NextResponse.json({ error: 'id requerido' }, { status: 400 })
    const row = byId.get(String(id))
    if (!row) return NextResponse.json({ error: 'No encontrado' }, { status: 404 })
    if (row.tipo_documento !== 'boleta') return NextResponse.json({ error: 'Solo las boletas se asignan a una partida' }, { status: 400 })
    const updated = { ...row, partida_id: partidaFinal }
    await updateById(SHEET, String(id), updated)
    return NextResponse.json(updated)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 })
  }
}
