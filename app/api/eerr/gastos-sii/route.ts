import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { esAdmin } from '@/lib/roles'
import { getSheetData, updateById } from '@/lib/datastore'
import { parseCsvSii, decodeCsvSii } from '@/lib/eerr-sii'
import { ingestarCompras } from '@/lib/eerr-compras-ingesta'

export const dynamic = 'force-dynamic'

const SHEET = 'eerr_gastos_sii'
const PROV = 'eerr_proveedores'
const TIPOS = ['costo', 'gasto', 'impuesto']

async function noAutorizado(): Promise<boolean> {
  const s = await getServerSession(authOptions)
  return !esAdmin((s?.user as { role?: string })?.role)
}


export async function GET(req: NextRequest) {
  if (await noAutorizado()) return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
  try {
    const { searchParams } = new URL(req.url)
    const desde = (searchParams.get('desde') || '').trim()   // ISO
    const hasta = (searchParams.get('hasta') || '').trim()   // ISO
    const estado = (searchParams.get('estado') || '').trim() // contabilizado | pendiente | ''
    let rows = await getSheetData(SHEET)
    rows = rows.filter(r => {
      const f = r.fecha_documento || ''
      if (desde && f < desde) return false
      if (hasta && f > hasta) return false
      if (estado === 'contabilizado' && r.contabilizado !== 'TRUE') return false
      if (estado === 'pendiente' && r.contabilizado === 'TRUE') return false
      return true
    })
    rows.sort((a, b) => (b.fecha_documento || '').localeCompare(a.fecha_documento || ''))
    return NextResponse.json(rows)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

/** Carga un CSV del SII (multipart `archivo`). Dedup por rut+tipo_doc+folio; aplica
 *  la contabilización automática del proveedor a las facturas nuevas. */
export async function POST(req: NextRequest) {
  if (await noAutorizado()) return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
  try {
    const form = await req.formData()
    const file = form.get('archivo')
    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.json({ error: 'Sube el archivo CSV del SII.' }, { status: 400 })
    }
    const facturas = parseCsvSii(decodeCsvSii(await file.arrayBuffer()))
    if (facturas.length === 0) {
      return NextResponse.json({ error: 'No se encontraron facturas en el archivo. ¿Es el CSV de compras del SII?' }, { status: 400 })
    }
    // La ingesta (dedupe + proveedores + contabilización automática) vive en
    // lib/eerr-compras-ingesta: la comparte el botón «Sincronizar SII».
    return NextResponse.json({ ok: true, ...(await ingestarCompras(facturas)) })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

/** Asigna/edita una factura: tipo_asignacion + partida + comentario. Con
 *  `aplicar_proveedor`, configura la contabilización auto del proveedor (no toca
 *  lo ya cargado, solo aplica a futuras). */
export async function PATCH(req: NextRequest) {
  if (await noAutorizado()) return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
  try {
    const b = await req.json()
    const { id, ids, aplicar_proveedor, ...updates } = b

    // Bulk: asignar la misma partida a varias compras a la vez.
    if (Array.isArray(ids) && ids.length > 0) {
      const partidaFinal = String(updates.partida_id || '')
      const tipoAsig = String(updates.tipo_asignacion || '')
      if (tipoAsig && !TIPOS.includes(tipoAsig)) return NextResponse.json({ error: 'Tipo inválido' }, { status: 400 })
      const rows = await getSheetData(SHEET)
      const byId = new Map(rows.map(r => [String(r.id), r]))
      let asignadas = 0
      for (const rid of ids) {
        const row = byId.get(String(rid))
        if (!row) continue
        await updateById(SHEET, row.id, { ...row, tipo_asignacion: tipoAsig, partida_id: partidaFinal, contabilizado: partidaFinal ? 'TRUE' : 'FALSE' })
        asignadas++
      }
      return NextResponse.json({ ok: true, asignadas })
    }

    if (!id) return NextResponse.json({ error: 'id requerido' }, { status: 400 })

    const rows = await getSheetData(SHEET)
    const row = rows.find(r => String(r.id) === String(id))
    if (!row) return NextResponse.json({ error: 'No encontrado' }, { status: 404 })

    if ('tipo_asignacion' in updates && updates.tipo_asignacion && !TIPOS.includes(String(updates.tipo_asignacion))) {
      return NextResponse.json({ error: 'Tipo inválido (costo/gasto/impuesto)' }, { status: 400 })
    }
    // contabilizado = TRUE si quedó con partida asignada.
    const partidaFinal = 'partida_id' in updates ? String(updates.partida_id || '') : row.partida_id
    updates.contabilizado = partidaFinal ? 'TRUE' : 'FALSE'

    const updated = { ...row, ...updates }
    await updateById(SHEET, String(id), updated)

    // Contabilización automática del proveedor: se guarda para las FUTURAS (al
    // cargar) y se aplica a las que ya están PENDIENTES de ese proveedor. Las que
    // ya tenían una partida asignada se dejan como están.
    if (aplicar_proveedor && partidaFinal) {
      const tipoAuto = String(updated.tipo_asignacion || '')
      const provs = await getSheetData(PROV)
      const prov = provs.find(p => p.rut === row.rut)
      if (prov) {
        await updateById(PROV, prov.id, { ...prov, auto_contabiliza: 'TRUE', auto_tipo: tipoAuto, auto_partida_id: partidaFinal })
      }
      const todas = await getSheetData(SHEET)
      for (const g of todas) {
        if (g.rut === row.rut && !g.partida_id) {
          await updateById(SHEET, g.id, { ...g, tipo_asignacion: tipoAuto, partida_id: partidaFinal, contabilizado: 'TRUE' })
        }
      }
    }

    return NextResponse.json(updated)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 })
  }
}
