import { getSheetData, appendRow, getNextId, updateById, updateByIdIf, deleteById } from './datastore'
import { todayISO } from './dates'

/**
 * Capa de datos del CALENDARIO DE CAMPAÑAS (tabla campaign_calendar). Es la capa
 * de planificación multicanal (email | instagram | facebook) que alimenta el
 * agente de marketing. Flujo de estados (human-in-the-loop, nada se publica solo):
 *   propuesta → aprobada → generada → programada → publicada | descartada
 */

const TABLE = 'campaign_calendar'

export type CanalCampana = 'email' | 'instagram' | 'facebook'
export type EstadoCampana = 'propuesta' | 'aprobada' | 'generada' | 'programada' | 'publicada' | 'descartada'

export interface ItemCalendario {
  id: string
  fecha: string
  hora: string
  canal: string
  estado: string
  /** 'TRUE' (activa) | 'FALSE' (inactiva/repositorio). Eje independiente del estado. */
  activa: string
  /** 'TRUE' si el dueño la marcó como favorita (para reutilizarla a futuro). */
  favorita: string
  objetivo: string
  audiencia: string
  idea: string
  titulo: string
  cuerpo: string
  imagen_id: string
  imagen_url: string
  /** JSON array de {url, alt} para carruseles (la 1ª = imagen_url). '' si no aplica. */
  imagenes_json: string
  campana_id: string
  post_externo_id: string
  post_url: string
  estado_publicacion: string
  error_publicacion: string
  generado_por: string
  aprobado_por: string
  fecha_publicacion: string
  notas: string
  creado_por: string
  fecha_creacion: string
}

function toItem(r: Record<string, string>): ItemCalendario {
  return {
    id: r.id || '', fecha: r.fecha || '', hora: r.hora || '', canal: r.canal || '', estado: r.estado || '',
    activa: r.activa || 'TRUE',
    favorita: r.favorita || 'FALSE',
    objetivo: r.objetivo || '', audiencia: r.audiencia || '', idea: r.idea || '',
    titulo: r.titulo || '', cuerpo: r.cuerpo || '',
    imagen_id: r.imagen_id || '', imagen_url: r.imagen_url || '', imagenes_json: r.imagenes_json || '',
    campana_id: r.campana_id || '', post_externo_id: r.post_externo_id || '', post_url: r.post_url || '',
    estado_publicacion: r.estado_publicacion || '', error_publicacion: r.error_publicacion || '',
    generado_por: r.generado_por || '', aprobado_por: r.aprobado_por || '', fecha_publicacion: r.fecha_publicacion || '',
    notas: r.notas || '', creado_por: r.creado_por || '', fecha_creacion: r.fecha_creacion || '',
  }
}

export interface FiltroCalendario {
  desde?: string   // ISO inclusive
  hasta?: string   // ISO inclusive
  canal?: string
  estado?: string
}

/** Lista el calendario (orden por fecha asc, luego id). Filtra por rango/canal/estado. */
export async function listarCalendario(f: FiltroCalendario = {}): Promise<ItemCalendario[]> {
  const rows = (await getSheetData(TABLE)).map(toItem)
  const out = rows.filter(it => {
    if (f.canal && it.canal !== f.canal) return false
    if (f.estado && it.estado !== f.estado) return false
    if (f.desde && it.fecha && it.fecha < f.desde) return false
    if (f.hasta && it.fecha && it.fecha > f.hasta) return false
    return true
  })
  out.sort((a, b) => (a.fecha || '').localeCompare(b.fecha || '') || (parseInt(a.id, 10) || 0) - (parseInt(b.id, 10) || 0))
  return out
}

export async function obtenerItem(id: string): Promise<ItemCalendario | null> {
  const rows = await getSheetData(TABLE)
  const r = rows.find(x => String(x.id) === String(id))
  return r ? toItem(r) : null
}

export interface NuevoItem {
  fecha: string
  hora?: string
  canal: string
  objetivo?: string
  audiencia?: string
  idea: string
  titulo?: string
  cuerpo?: string
  estado?: string
  generado_por?: string
  notas?: string
  creadoPor?: string
}

function filaDesde(n: NuevoItem, id: string): Record<string, string> {
  return {
    id,
    fecha: (n.fecha || '').trim(),
    hora: (n.hora || '').trim(),
    canal: (n.canal || '').trim(),
    estado: (n.estado || 'propuesta').trim(),
    activa: 'TRUE',
    favorita: 'FALSE',
    objetivo: (n.objetivo || '').trim(),
    audiencia: (n.audiencia || '').trim(),
    idea: (n.idea || '').trim(),
    titulo: (n.titulo || '').trim(),
    cuerpo: (n.cuerpo || '').trim(),
    imagen_id: '', imagen_url: '', imagenes_json: '',
    campana_id: '', post_externo_id: '', post_url: '',
    estado_publicacion: '', error_publicacion: '',
    generado_por: (n.generado_por || 'ia').trim(),
    aprobado_por: '',
    fecha_publicacion: '',
    notas: (n.notas || '').trim(),
    creado_por: (n.creadoPor || '').trim(),
    fecha_creacion: todayISO(),
  }
}

/** Crea un ítem del calendario. */
export async function crearItem(n: NuevoItem): Promise<ItemCalendario> {
  const id = await getNextId(TABLE)
  const row = filaDesde(n, id)
  await appendRow(TABLE, row)
  return toItem(row)
}

/**
 * Crea varios ítems (propuesta del agente). getNextId FRESCO por fila, secuencial
 * con await — nunca ids calculados en JS (rompería la secuencia en Postgres).
 */
export async function crearItems(items: NuevoItem[]): Promise<ItemCalendario[]> {
  const out: ItemCalendario[] = []
  for (const n of items) {
    const id = await getNextId(TABLE)
    const row = filaDesde(n, id)
    await appendRow(TABLE, row)
    out.push(toItem(row))
  }
  return out
}

/**
 * Actualiza campos de un ítem. updateById sobreescribe la fila completa, así que
 * mergeamos sobre la fila existente para no borrar columnas.
 */
export async function actualizarItem(id: string, cambios: Partial<Record<keyof ItemCalendario, string>>): Promise<ItemCalendario> {
  const rows = await getSheetData(TABLE)
  const row = rows.find(r => String(r.id) === String(id))
  if (!row) throw new Error(`ítem ${id} no encontrado`)
  const merged = { ...row }
  for (const [k, v] of Object.entries(cambios)) {
    if (v !== undefined) merged[k] = v
  }
  await updateById(TABLE, id, merged)
  return toItem(merged)
}

export async function eliminarItem(id: string): Promise<void> {
  await deleteById(TABLE, id)
}

/**
 * Valida una transición de estado en el flujo controlado generar → aprobar → programar:
 *  - APROBAR requiere la pieza GENERADA (con cuerpo; en social, también su imagen).
 *  - PROGRAMAR requiere estar APROBADA, generada y con fecha (el cron la autopublica).
 * Devuelve un mensaje de error, o null si la transición es válida. (Pasar a otros
 * estados —descartada, generada, publicada, etc.— no se restringe acá.)
 */
export function validarCambioEstado(item: ItemCalendario, nuevo: string): string | null {
  if (!nuevo || nuevo === item.estado) return null
  const generado = !!(item.cuerpo && item.cuerpo.trim())
  if (nuevo === 'aprobada' && !generado) {
    return 'No se puede aprobar sin generar la pieza primero (necesita copy y, en social, imagen). Generala y después aprobala.'
  }
  if (nuevo === 'programada') {
    if (!generado) return 'No se puede programar sin generar la pieza primero.'
    if (item.estado !== 'aprobada') return 'No se puede programar sin aprobar primero. El flujo es: generar → aprobar → programar.'
    if (!item.fecha?.trim()) return 'Para programar la publicación, la campaña necesita una fecha (y opcionalmente hora).'
  }
  return null
}

// ─── Publicación atómica (anti doble-publicación) ─────────────────────────────
// Reclamar/finalizar pasan por updateByIdIf, que en Postgres es un UPDATE
// condicional ATÓMICO (UPDATE ... WHERE id=? AND col=?) y PARCIAL (no pisa la fila
// entera). Así dos publicaciones solapadas (doble clic, manual + cron) no publican
// el mismo ítem dos veces, y no se clobbean columnas que esté editando otro proceso.

/**
 * Reclama el ítem para publicar: marca estado_publicacion='publicando' SOLO si su
 * estado previo es seguro (sin publicar / con error de un intento anterior).
 * Devuelve true si ganó la carrera; false si otro ya lo está publicando o ya se publicó.
 */
export async function claimPublicacion(id: string): Promise<boolean> {
  for (const prev of ['', 'error']) {
    const ok = await updateByIdIf(TABLE, id, { estado_publicacion: prev }, { estado_publicacion: 'publicando', error_publicacion: '' })
    if (ok) return true
  }
  return false
}

/** Marca el ítem como publicado con el id/URL del post (solo si seguía 'publicando'). */
export async function finalizarPublicacion(id: string, r: { postId: string; postUrl: string; fecha: string }): Promise<void> {
  await updateByIdIf(TABLE, id, { estado_publicacion: 'publicando' }, {
    estado: 'publicada',
    estado_publicacion: 'publicado',
    post_externo_id: r.postId,
    post_url: r.postUrl,
    fecha_publicacion: r.fecha,
    error_publicacion: '',
  })
}

/** Marca el ítem con error de publicación (solo si seguía 'publicando'). */
export async function marcarErrorPublicacion(id: string, msg: string): Promise<void> {
  await updateByIdIf(TABLE, id, { estado_publicacion: 'publicando' }, { estado_publicacion: 'error', error_publicacion: msg })
}
