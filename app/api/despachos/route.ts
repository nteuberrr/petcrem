import { NextRequest, NextResponse } from 'next/server'
import { getSheetData, appendRow, updateById, getNextId, deleteRow, ensureColumns, ensureSheet } from '@/lib/datastore'
import { todayISO, formatDateForSheet } from '@/lib/dates'

// Forzar evaluación dinámica: la planilla cambia fuera de Next, no queremos cache.
export const dynamic = 'force-dynamic'
export const revalidate = 0

const HOJA = 'despachos'
const COLS = [
  'id', 'fecha', 'numero_recorrido', 'numero_global', 'mascotas_ids', 'nota', 'fecha_creacion',
  'estado_ruta',
  'origen_direccion', 'origen_lat', 'origen_lng',
  'destino_direccion', 'destino_lat', 'destino_lng',
  'paradas', 'entregas',
  'hora_inicio_ruta', 'hora_termino_ruta', 'fecha_realizada',
]

async function ensure() {
  await ensureSheet(HOJA)
  await ensureColumns(HOJA, COLS)
}

/** Parada de una ruta guardada: orden + coords + dirección (para Maps). */
interface Parada {
  cliente_id: string
  orden: number
  lat?: number
  lng?: number
  direccion?: string
}

function parseJson<T>(raw: string | undefined, fallback: T): T {
  try { const x = JSON.parse(raw || ''); return (x ?? fallback) as T } catch { return fallback }
}

export async function GET() {
  try {
    await ensure()
    const rows = await getSheetData(HOJA)
    const parsed = rows.map(r => ({
      ...r,
      mascotas_ids: parseJson<string[]>(r.mascotas_ids, []),
      paradas: parseJson<Parada[]>(r.paradas, []),
      entregas: parseJson<Record<string, { fecha_hora: string }>>(r.entregas, {}),
      estado_ruta: r.estado_ruta || 'guardada',
    }))
    return NextResponse.json(parsed.reverse())
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    // Acepta paradas (del optimizador, con coords+orden) o mascotas_ids sueltas
    // (selección manual). Derivamos siempre ambas representaciones.
    const paradasIn: Parada[] = Array.isArray(body.paradas) ? body.paradas : []
    let mascotasIds: string[] = Array.isArray(body.mascotas_ids) ? body.mascotas_ids.map(String) : []
    if (paradasIn.length > 0) mascotasIds = paradasIn.map(p => String(p.cliente_id))

    if (!body.fecha || mascotasIds.length === 0) {
      return NextResponse.json({ error: 'fecha y al menos una mascota requeridas' }, { status: 400 })
    }
    await ensure()

    const clientes = await getSheetData('clientes')
    const byId = new Map(clientes.map(c => [c.id, c]))

    // Si vinieron solo mascotas_ids (manual), armamos paradas con la dirección
    // de despacho (sin coords; Maps las resuelve por texto).
    const paradas: Parada[] = paradasIn.length > 0
      ? paradasIn.map((p, i) => ({
          cliente_id: String(p.cliente_id),
          orden: typeof p.orden === 'number' ? p.orden : i + 1,
          lat: typeof p.lat === 'number' ? p.lat : undefined,
          lng: typeof p.lng === 'number' ? p.lng : undefined,
          direccion: p.direccion || byId.get(String(p.cliente_id))?.direccion_despacho || '',
        }))
      : mascotasIds.map((mid, i) => {
          const c = byId.get(mid)
          const dir = c ? [c.direccion_despacho, c.comuna].filter(Boolean).join(', ') : ''
          return { cliente_id: mid, orden: i + 1, direccion: dir }
        })

    // Correlativos (max+1 para no colisionar tras eliminar+crear).
    const existentes = await getSheetData(HOJA)
    const fechaIso = formatDateForSheet(body.fecha) || String(body.fecha)
    const delDia = existentes.filter(d => (formatDateForSheet(d.fecha) || d.fecha) === fechaIso)
    const numero = (delDia.map(d => parseInt(d.numero_recorrido, 10) || 0).reduce((a, b) => Math.max(a, b), 0)) + 1
    const numeroGlobal = (existentes.map(d => parseInt(d.numero_global, 10) || 0).reduce((a, b) => Math.max(a, b), 0)) + 1

    const id = await getNextId(HOJA)
    const o = body.origen || {}
    const d = body.destino || {}
    const row = {
      id,
      fecha: String(body.fecha),
      numero_recorrido: String(numero),
      numero_global: String(numeroGlobal),
      mascotas_ids: JSON.stringify(mascotasIds),
      nota: body.nota ?? '',
      fecha_creacion: todayISO(),
      estado_ruta: 'guardada',
      origen_direccion: o.direccion ?? '',
      origen_lat: o.lat !== undefined ? String(o.lat) : '',
      origen_lng: o.lng !== undefined ? String(o.lng) : '',
      destino_direccion: d.direccion ?? '',
      destino_lat: d.lat !== undefined ? String(d.lat) : '',
      destino_lng: d.lng !== undefined ? String(d.lng) : '',
      paradas: JSON.stringify(paradas),
      entregas: JSON.stringify({}),
      hora_inicio_ruta: '',
      hora_termino_ruta: '',
      fecha_realizada: '',
    }
    await appendRow(HOJA, row)
    // No tocamos clientes.estado: la mascota pasa a 'despachado' recién al
    // marcarla como entregada. No se manda correo hasta "Iniciar ruta".
    return NextResponse.json(row, { status: 201 })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json()
    const { id, fecha, nota, mascotas_ids } = body as {
      id: string
      fecha?: string
      nota?: string
      mascotas_ids?: string[]
    }
    if (!id) return NextResponse.json({ error: 'id requerido' }, { status: 400 })
    await ensure()
    const rows = await getSheetData(HOJA)
    const idx = rows.findIndex(r => r.id === id)
    if (idx === -1) return NextResponse.json({ error: 'No encontrado' }, { status: 404 })

    const updated: Record<string, string> = { ...rows[idx] }
    if (fecha !== undefined) updated.fecha = String(fecha)
    if (nota !== undefined) updated.nota = String(nota)

    // Editar la lista de mascotas: actualiza mascotas_ids y reconstruye paradas
    // conservando coords/orden de las que se mantienen. No toca clientes.estado
    // (eso pasa al entregar). Las entregas de mascotas removidas se descartan.
    if (Array.isArray(mascotas_ids)) {
      const clientes = await getSheetData('clientes')
      const byId = new Map(clientes.map(c => [c.id, c]))
      const paradasViejas = parseJson<Parada[]>(rows[idx].paradas, [])
      const pById = new Map(paradasViejas.map(p => [String(p.cliente_id), p]))
      const entregasViejas = parseJson<Record<string, { fecha_hora: string }>>(rows[idx].entregas, {})
      const paradas: Parada[] = mascotas_ids.map((mid, i) => {
        const prev = pById.get(mid)
        const c = byId.get(mid)
        const dir = prev?.direccion || (c ? [c.direccion_despacho, c.comuna].filter(Boolean).join(', ') : '')
        return { cliente_id: mid, orden: i + 1, lat: prev?.lat, lng: prev?.lng, direccion: dir }
      })
      const entregas: Record<string, { fecha_hora: string }> = {}
      for (const mid of mascotas_ids) if (entregasViejas[mid]) entregas[mid] = entregasViejas[mid]
      updated.mascotas_ids = JSON.stringify(mascotas_ids)
      updated.paradas = JSON.stringify(paradas)
      updated.entregas = JSON.stringify(entregas)

      // Mascotas que se sacaron de la ruta: si ya estaban entregadas (despachado
      // + vinculadas a ESTA ruta), revertirlas a 'cremado' y limpiar el vínculo,
      // para no dejarlas apuntando a una ruta de la que ya no forman parte.
      const idsViejos = parseJson<string[]>(rows[idx].mascotas_ids, [])
      const idsNuevos = mascotas_ids.map(String)
      for (const mid of idsViejos) {
        if (idsNuevos.includes(mid)) continue
        const cli = byId.get(mid)
        if (cli && cli.estado === 'despachado' && cli.despacho_id === id) {
          await updateById('clientes', mid, { ...cli, estado: 'cremado', despacho_id: '' })
        }
      }
    }

    await updateById(HOJA, id, updated)
    return NextResponse.json({ ok: true, id })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const id = searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'id requerido' }, { status: 400 })
    await ensure()
    const rows = await getSheetData(HOJA)
    const idx = rows.findIndex(r => r.id === id)
    if (idx === -1) return NextResponse.json({ error: 'No encontrado' }, { status: 404 })

    // Revertir mascotas YA entregadas (despachado→cremado, limpiar despacho_id).
    // Las no entregadas siguen 'cremado' intactas.
    try {
      const mascotasIds: string[] = parseJson<string[]>(rows[idx].mascotas_ids, [])
      const clientes = await getSheetData('clientes')
      const idxById = new Map(clientes.map((c, i) => [c.id, i]))
      await Promise.all(
        mascotasIds.map((mid) => {
          const cIdx = idxById.get(mid)
          if (cIdx === undefined) return Promise.resolve()
          if (clientes[cIdx].estado === 'despachado' && clientes[cIdx].despacho_id === id) {
            return updateById('clientes', clientes[cIdx].id, { ...clientes[cIdx], estado: 'cremado', despacho_id: '' })
          }
          return Promise.resolve()
        })
      )
    } catch (e) { console.warn('[despachos DELETE] revert estado fallo', id, e) }

    await deleteRow(HOJA, idx)
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
