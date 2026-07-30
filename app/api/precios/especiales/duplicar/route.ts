import { NextRequest, NextResponse } from 'next/server'
import { getSheetData, appendRow, getNextId, deleteById, ensureSheet, ensureColumns, updateByIdIf } from '@/lib/datastore'
import { esOrigenIndexable } from '@/lib/precios-indexados'

const EXPECTED_COLS = ['id', 'veterinaria_id', 'peso_min', 'peso_max', 'precio_ci', 'precio_cp', 'precio_sd']

/**
 * POST /api/precios/especiales/duplicar
 * body: { veterinaria_id, origen, reemplazar?, indexar? }
 *
 * Copia TODOS los tramos de una tabla conocida a los precios ESPECIALES de una
 * veterinaria. `origen`:
 *   'general'  → precios_generales
 *   'convenio' → precios_convenio
 *   '<vetId>'  → precios_especiales de esa otra veterinaria
 * Si `reemplazar` es true, primero borra los tramos especiales actuales de la
 * veterinaria destino (para que su tabla quede igual a la de origen).
 *
 * `indexar` (solo con origen 'general' o 'convenio'): deja la copia VIVA — si esa
 * tabla base cambia después, los tramos de esta veterinaria se re-copian solos
 * (lib/precios-indexados.ts). Sin indexar, la copia es un punto de partida que se
 * edita a mano. Copiar desde OTRA veterinaria nunca queda indexado.
 */
export async function POST(req: NextRequest) {
  try {
    const { veterinaria_id, origen, reemplazar, indexar } = await req.json() as {
      veterinaria_id?: string; origen?: string; reemplazar?: boolean; indexar?: boolean
    }
    const destino = String(veterinaria_id ?? '').trim()
    const src = String(origen ?? '').trim()
    if (!destino) return NextResponse.json({ error: 'veterinaria_id requerido' }, { status: 400 })
    if (!src) return NextResponse.json({ error: 'origen requerido' }, { status: 400 })
    if (src === destino) return NextResponse.json({ error: 'El origen no puede ser la misma veterinaria.' }, { status: 400 })

    await ensureSheet('precios_especiales')
    await ensureColumns('precios_especiales', EXPECTED_COLS)

    // 1) Tramos de origen
    let fuente: Record<string, string>[]
    if (src === 'general') fuente = await getSheetData('precios_generales')
    else if (src === 'convenio') fuente = await getSheetData('precios_convenio')
    else fuente = (await getSheetData('precios_especiales')).filter(r => r.veterinaria_id === src)
    if (fuente.length === 0) return NextResponse.json({ error: 'La tabla de origen no tiene tramos.' }, { status: 400 })

    // 2) Reemplazar: borrar los tramos especiales actuales de la vet destino
    let reemplazados = 0
    if (reemplazar) {
      const actuales = (await getSheetData('precios_especiales')).filter(r => r.veterinaria_id === destino)
      for (const r of actuales) { await deleteById('precios_especiales', r.id); reemplazados++ }
    }

    // 3) Insertar copias. Pedimos un id FRESCO por fila (getNextId = nextval en
    //    Postgres, max(id)+1 en Sheets): así la secuencia identity avanza con cada
    //    insert y nunca queda detrás de max(id) — antes hacíamos un solo getNextId
    //    + nextId++ y eso dejaba la secuencia desfasada → "duplicate key _pkey" al
    //    re-duplicar. El loop DEBE ser secuencial (await por iteración): paralelizarlo
    //    rompería la unicidad en el path de Sheets (todas leerían el mismo max).
    let copiados = 0
    for (const t of fuente) {
      await appendRow('precios_especiales', {
        id: await getNextId('precios_especiales'),
        veterinaria_id: destino,
        peso_min: String(t.peso_min ?? ''),
        peso_max: String(t.peso_max ?? ''),
        precio_ci: String(t.precio_ci ?? ''),
        precio_cp: String(t.precio_cp ?? ''),
        precio_sd: String(t.precio_sd ?? ''),
      })
      copiados++
    }

    // La vet destino ahora tiene precios especiales → reflejarlo en su tipo_precios.
    // Y dejar (o limpiar) el INDEXADO a la tabla base según lo pedido: solo se puede
    // indexar a 'general' o 'convenio', nunca a la tabla de otra veterinaria.
    const indexado = indexar === true && esOrigenIndexable(src) ? src : ''
    if (copiados > 0) {
      try {
        await updateByIdIf('veterinarios', destino, {}, {
          tipo_precios: 'precios_especiales',
          precios_indexados: indexado,
        })
      } catch (e) { console.warn('[precios/especiales/duplicar] no se pudo sincronizar tipo_precios/indexado:', e) }
    }

    return NextResponse.json({ ok: true, copiados, reemplazados, indexado })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 })
  }
}
