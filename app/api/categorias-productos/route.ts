import { NextRequest, NextResponse } from 'next/server'
import { getSheetData, appendRow, updateRow, getNextId, deleteRow, ensureSheet, ensureColumns } from '@/lib/datastore'
import { todayISO } from '@/lib/dates'

const HOJA = 'categorias_productos'
const COLS = ['id', 'nombre', 'activo', 'fecha_creacion']

async function ensure() {
  await ensureSheet(HOJA)
  await ensureColumns(HOJA, COLS)
}

export async function GET() {
  try {
    await ensure()
    let rows = await getSheetData(HOJA)

    // Auto-reparación: las categorías que los productos YA usan pero que no
    // tienen fila acá (p. ej. tipeadas libres en el form de producto, o las
    // ánforas históricas) se agregan solas, para que el panel muestre TODAS.
    try {
      const productos = await getSheetData('productos')
      const existentes = new Set(rows.map(c => (c.nombre || '').trim().toLowerCase()))
      const faltantes = new Map<string, string>()
      for (const p of productos) {
        const cat = (p.categoria || '').trim()
        if (cat && !existentes.has(cat.toLowerCase())) faltantes.set(cat.toLowerCase(), cat)
      }
      // Secuencial con getNextId fresco por fila (regla del repo: nunca ids en JS).
      for (const nombre of faltantes.values()) {
        const id = await getNextId(HOJA)
        await appendRow(HOJA, { id, nombre, activo: 'TRUE', fecha_creacion: todayISO() })
      }
      if (faltantes.size > 0) rows = await getSheetData(HOJA)
    } catch (e) {
      console.warn('[categorias-productos GET] auto-reparación falló (se listan las existentes):', e)
    }

    return NextResponse.json(rows)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    await ensure()
    const body = await req.json()
    const nombre = String(body.nombre ?? '').trim()
    if (!nombre) return NextResponse.json({ error: 'Nombre requerido' }, { status: 400 })

    const existentes = await getSheetData(HOJA)
    if (existentes.some(c => c.nombre.toLowerCase() === nombre.toLowerCase())) {
      return NextResponse.json({ error: 'Ya existe una categoría con ese nombre' }, { status: 409 })
    }

    const id = await getNextId(HOJA)
    const row = { id, nombre, activo: 'TRUE', fecha_creacion: todayISO() }
    await appendRow(HOJA, row)
    return NextResponse.json(row, { status: 201 })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    await ensure()
    const body = await req.json()
    const { id, ...updates } = body
    if (!id) return NextResponse.json({ error: 'id requerido' }, { status: 400 })

    const rows = await getSheetData(HOJA)
    const idx = rows.findIndex(r => r.id === id)
    if (idx === -1) return NextResponse.json({ error: 'No encontrado' }, { status: 404 })

    const original = rows[idx]
    const nuevoNombre = updates.nombre !== undefined ? String(updates.nombre).trim() : original.nombre
    if (!nuevoNombre) return NextResponse.json({ error: 'Nombre requerido' }, { status: 400 })

    // Si cambia el nombre, cascadear a productos que usan la categoría vieja
    const renombro = nuevoNombre.toLowerCase() !== original.nombre.toLowerCase()
    if (renombro) {
      if (rows.some(r => r.id !== id && r.nombre.toLowerCase() === nuevoNombre.toLowerCase())) {
        return NextResponse.json({ error: 'Ya existe una categoría con ese nombre' }, { status: 409 })
      }
      const productos = await getSheetData('productos')
      const afectados = productos
        .map((p, i) => ({ p, i }))
        .filter(({ p }) => (p.categoria ?? '').trim().toLowerCase() === original.nombre.toLowerCase())
      for (const { p, i } of afectados) {
        await updateRow('productos', i, { ...p, categoria: nuevoNombre })
      }
    }

    const updated = { ...original, ...updates, nombre: nuevoNombre }
    await updateRow(HOJA, idx, updated)
    return NextResponse.json(updated)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    await ensure()
    const { searchParams } = new URL(req.url)
    const id = searchParams.get('id')
    const reasignarA = searchParams.get('reasignar_a') ?? ''
    if (!id) return NextResponse.json({ error: 'id requerido' }, { status: 400 })

    const rows = await getSheetData(HOJA)
    const idx = rows.findIndex(r => r.id === id)
    if (idx === -1) return NextResponse.json({ error: 'No encontrado' }, { status: 404 })

    const categoria = rows[idx]

    // Si hay productos usando esta categoría, los reasignamos (o los dejamos sin categoría).
    const productos = await getSheetData('productos')
    const afectados = productos
      .map((p, i) => ({ p, i }))
      .filter(({ p }) => (p.categoria ?? '').trim().toLowerCase() === categoria.nombre.toLowerCase())

    if (afectados.length > 0) {
      const nuevoValor = reasignarA.trim()  // '' => productos quedan sin categoría
      for (const { p, i } of afectados) {
        await updateRow('productos', i, { ...p, categoria: nuevoValor })
      }
    }

    await deleteRow(HOJA, idx)
    return NextResponse.json({ ok: true, productos_afectados: afectados.length })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
