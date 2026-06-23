import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { esAdminTotal } from '@/lib/roles'
import { getSheetData, appendRow, updateById, getNextId } from '@/lib/datastore'
import { todayISO } from '@/lib/dates'
import { parseCsvSii, decodeCsvSii } from '@/lib/eerr-sii'

export const dynamic = 'force-dynamic'

const SHEET = 'eerr_gastos_sii'
const PROV = 'eerr_proveedores'
const TIPOS = ['costo', 'gasto', 'impuesto']

async function noAutorizado(): Promise<boolean> {
  const s = await getServerSession(authOptions)
  return !esAdminTotal((s?.user as { role?: string })?.role)
}

const claveDedup = (rut: string, tipoDoc: string, folio: string) => `${rut}|${tipoDoc}|${folio}`

// Campos que vienen del SII (no del usuario: comentario/partida/etc. no se tocan).
// Para un documento YA cargado, si uno está en blanco y el nuevo lo trae, se
// rellena. Los montos vacíos se guardan como '0', así que '0' cuenta como blanco
// (solo se rellena si el nuevo trae un valor distinto de vacío/0).
const CAMPOS_SII = ['razon_social', 'tipo_compra', 'fecha_documento', 'fecha_recepcion', 'monto_exento', 'monto_neto', 'monto_iva', 'monto_total', 'valor_otro_impuesto']
const esBlank = (v: string | undefined) => { const s = (v || '').trim(); return s === '' || s === '0' }

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

    const [existentes, proveedores] = await Promise.all([getSheetData(SHEET), getSheetData(PROV)])
    const existByKey = new Map(existentes.map(r => [claveDedup(r.rut, r.tipo_doc, r.folio), r]))
    const provByRut = new Map(proveedores.map(p => [p.rut, p]))
    const fechaCarga = todayISO()

    // Crear proveedores que aparezcan por primera vez (sin contabilización auto).
    const rutsNuevos = new Map<string, string>() // rut -> razon_social
    for (const f of facturas) {
      if (!provByRut.has(f.rut) && !rutsNuevos.has(f.rut)) rutsNuevos.set(f.rut, f.razon_social)
    }
    for (const [rut, razon] of rutsNuevos) {
      const id = await getNextId(PROV)
      await appendRow(PROV, {
        id, rut, razon_social: razon,
        auto_contabiliza: 'FALSE', auto_tipo: '', auto_partida_id: '',
        fecha_creacion: fechaCarga,
      })
    }

    let nuevas = 0, duplicadas = 0, completadas = 0
    const vistas = new Set<string>()
    for (const f of facturas) {
      const k = claveDedup(f.rut, f.tipo_doc, f.folio)
      if (vistas.has(k)) { duplicadas++; continue }
      vistas.add(k)

      const existe = existByKey.get(k)
      if (existe) {
        // Ya cargada: no se duplica. Si lo existente tiene campos en blanco y el
        // nuevo los trae completos, rellenamos SOLO esos blancos (no pisamos datos
        // ya cargados ni los del usuario: comentario/partida/contabilizado).
        const fRec = f as unknown as Record<string, string>
        const cambios: Record<string, string> = {}
        for (const c of CAMPOS_SII) {
          if (esBlank(existe[c]) && !esBlank(fRec[c])) cambios[c] = fRec[c]
        }
        if (Object.keys(cambios).length > 0) {
          await updateById(SHEET, existe.id, { ...existe, ...cambios })
          completadas++
        } else {
          duplicadas++
        }
        continue
      }

      // Nueva: contabilización automática si el proveedor ya la tenía configurada.
      const prov = provByRut.get(f.rut)
      const auto = prov?.auto_contabiliza === 'TRUE' && prov.auto_partida_id
        ? { tipo_asignacion: prov.auto_tipo, partida_id: prov.auto_partida_id, contabilizado: 'TRUE' }
        : { tipo_asignacion: '', partida_id: '', contabilizado: 'FALSE' }

      const id = await getNextId(SHEET)
      await appendRow(SHEET, {
        id,
        tipo_doc: f.tipo_doc, tipo_compra: f.tipo_compra, rut: f.rut, razon_social: f.razon_social, folio: f.folio,
        fecha_documento: f.fecha_documento, fecha_recepcion: f.fecha_recepcion,
        monto_exento: f.monto_exento, monto_neto: f.monto_neto, monto_iva: f.monto_iva,
        monto_total: f.monto_total, valor_otro_impuesto: f.valor_otro_impuesto,
        comentario: '',
        ...auto,
        fecha_carga: fechaCarga,
        fecha_creacion: fechaCarga,
      })
      nuevas++
    }

    return NextResponse.json({ ok: true, nuevas, duplicadas, completadas, proveedores_nuevos: rutsNuevos.size, fecha_carga: fechaCarga })
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
