import { getSheetData, appendRow, getNextId, updateByIdIf, deleteRow } from '@/lib/datastore'
import { todayISO } from '@/lib/dates'

/**
 * Capa CRUD del panel Web (colecciones de contenido del sitio público).
 * Sirve a /api/web/servicios · /api/web/posts · /api/web/paginas.
 *
 * - id por fila con getNextId (nextval) — insert de UNA fila.
 * - update PARCIAL con updateByIdIf (no pisa columnas no enviadas).
 * - whitelist de campos por tabla (no escribe nada fuera del esquema).
 */

export function slugify(s: unknown): string {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 80)
}

export const CAMPOS_WEB: Record<string, string[]> = {
  web_servicios: ['nombre', 'slug', 'resumen', 'descripcion', 'foto_url', 'precio_desde', 'orden', 'publicado', 'seo_titulo', 'seo_desc'],
  web_posts: ['titulo', 'slug', 'categoria', 'extracto', 'contenido', 'foto_url', 'autor', 'fecha', 'publicado', 'seo_titulo', 'seo_desc'],
  web_paginas: ['pagina', 'clave', 'titulo', 'contenido', 'foto_url', 'orden'],
}

function limpiar(tabla: string, body: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const k of CAMPOS_WEB[tabla] || []) {
    if (body[k] !== undefined) out[k] = String(body[k] ?? '')
  }
  return out
}

export function listarWeb(tabla: string) {
  return getSheetData(tabla)
}

export async function crearWeb(tabla: string, body: Record<string, unknown>) {
  const datos = limpiar(tabla, body)
  // slug automático desde nombre/título si la tabla lo tiene y no vino.
  if ((CAMPOS_WEB[tabla] || []).includes('slug') && !datos.slug) {
    const base = String(body.nombre ?? body.titulo ?? '')
    if (base) datos.slug = slugify(base)
  }
  const id = await getNextId(tabla)
  const row = { id, ...datos, fecha_creacion: todayISO() }
  await appendRow(tabla, row)
  return row
}

export async function actualizarWeb(tabla: string, id: string, body: Record<string, unknown>): Promise<boolean> {
  const cambios = limpiar(tabla, body)
  if (Object.keys(cambios).length === 0) return false
  return updateByIdIf(tabla, String(id), {}, cambios)
}

export async function eliminarWeb(tabla: string, id: string): Promise<boolean> {
  const rows = await getSheetData(tabla)
  const idx = rows.findIndex(r => String(r.id) === String(id))
  if (idx === -1) return false
  await deleteRow(tabla, idx)
  return true
}
