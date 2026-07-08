import { NextRequest, NextResponse } from 'next/server'
import { getSheetData, updateByIdIf } from '@/lib/datastore'

/**
 * /api/web — datos que administra el panel "Web" (sitio público).
 *
 *  GET   → { productos, categorias, descuentos } (espejo de Bodega + convenios).
 *  PATCH { entidad:'producto'|'descuento', id, mostrar_web?, foto_url? }
 *          → update PARCIAL (updateByIdIf) de los campos web, sin tocar el resto.
 *
 * Owner-only por el módulo 'web' del proxy (activable a otros roles).
 * El catálogo de productos es un ESPEJO de Bodega: el producto se crea/edita en
 * Configuración → Bodega; acá solo se decide si se muestra en la web y su visibilidad.
 */

export async function GET() {
  try {
    const [productos, categorias, descuentos] = await Promise.all([
      getSheetData('productos'),
      getSheetData('categorias_productos'),
      getSheetData('descuentos'),
    ])
    return NextResponse.json({ productos, categorias, descuentos })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json()
    const entidad = String(body?.entidad ?? '')
    const id = body?.id
    if (!id || (entidad !== 'producto' && entidad !== 'descuento')) {
      return NextResponse.json({ error: 'entidad ("producto"|"descuento") + id requeridos' }, { status: 400 })
    }

    const changes: Record<string, string> = {}
    if (body.mostrar_web !== undefined) {
      changes.mostrar_web = body.mostrar_web === true || body.mostrar_web === 'TRUE' ? 'TRUE' : 'FALSE'
    }
    // foto_url solo aplica a descuentos (los productos traen su foto de Bodega).
    if (entidad === 'descuento' && body.foto_url !== undefined) {
      changes.foto_url = String(body.foto_url ?? '')
    }
    if (Object.keys(changes).length === 0) {
      return NextResponse.json({ error: 'Nada que actualizar' }, { status: 400 })
    }

    const tabla = entidad === 'producto' ? 'productos' : 'descuentos'
    const ok = await updateByIdIf(tabla, String(id), {}, changes)
    if (!ok) return NextResponse.json({ error: 'No encontrado' }, { status: 404 })
    return NextResponse.json({ ok: true, ...changes })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 })
  }
}
