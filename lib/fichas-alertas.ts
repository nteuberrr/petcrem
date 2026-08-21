import { findTramo } from './tramos'
import { parsePeso } from './numbers'
import { pidioVideo } from './video-solicitado'
import { formatDateForSheet } from './dates'

/**
 * Las situaciones que la sección /clientes destaca (los chips de arriba) —
 * definidas UNA sola vez.
 *
 * Existen acá y no dentro de la página porque el CONTEO tiene que salir del
 * servidor: la lista carga solo las fichas recientes, así que si los chips se
 * calcularan sobre lo que el navegador tiene en memoria dirían "3 con video por
 * subir" cuando en la base hay 15. El servidor cuenta sobre todas las fichas y
 * manda los números; la página usa estos mismos predicados para pintar y filtrar
 * lo que sí tiene cargado. Las dos puntas leen de acá o vuelven a divergir.
 */

/** Fila de ficha, tal como sale del datastore (todo string). */
export type FichaRow = Record<string, string>

/** Tramo de una tabla de precios (generales / convenio). */
export interface TramoPrecio {
  peso_min: string; peso_max: string
  precio_ci: string; precio_cp: string; precio_sd: string
}

export interface ContextoAlertas {
  preciosGenerales: TramoPrecio[]
  preciosConvenio: TramoPrecio[]
  /** Ids de fichas con al menos un COBRO abierto (no pagado, tipo ≠ devolución). */
  idsConCobroPendiente: Set<string>
  /** Ficha → monto que le debemos devolver al tutor (0 si no le debemos nada). */
  devolucionPorFicha: Map<string, number>
  /** Ids de fichas cuyo correo de tutor rebotó / falló. */
  idsCorreoMalo: Set<string>
}

/** Desde cuándo avisamos por los videos sin subir (ISO). Antes de esa fecha la
 *  solicitud quedaba sin cargar y no se va a completar hacia atrás. */
export const VIDEO_DESDE = '2026-08-01'

function precioDelTramo(t: TramoPrecio | null, codigo: string): number {
  if (!t) return 0
  const raw = codigo === 'CP' ? t.precio_cp : codigo === 'SD' ? t.precio_sd : t.precio_ci
  return parseFloat(raw) || 0
}

const jsonTieneItems = (s?: string) => {
  try { const a = JSON.parse(s || '[]'); return Array.isArray(a) && a.length > 0 } catch { return false }
}

/** Faltan campos obligatorios (los mismos `required` del alta de ficha). */
export function tieneDatosPendientes(c: FichaRow): boolean {
  const vacio = (v?: string) => !v || !String(v).trim()
  if (vacio(c.nombre_mascota)) return true
  if (vacio(c.nombre_tutor)) return true
  if (vacio(c.email)) return true
  if (vacio(c.telefono)) return true
  if (vacio(c.direccion_retiro)) return true
  if (vacio(c.direccion_despacho)) return true
  if (vacio(c.comuna)) return true
  if (vacio(c.fecha_retiro)) return true
  if (vacio(c.especie)) return true
  if (!c.peso_declarado || (parseFloat(c.peso_declarado) || 0) <= 0) return true
  if (vacio(c.codigo_servicio)) return true
  if (vacio(c.tipo_pago)) return true
  if (vacio(c.estado_pago)) return true
  return false
}

/** Ficha ya en proceso (retirada, no despachada) sin el peso real registrado. */
export function faltaPesoIngreso(c: FichaRow): boolean {
  return c.estado !== 'borrador' && c.estado !== 'despachado' && (!c.peso_ingreso || !c.peso_ingreso.trim())
}

/**
 * El peso de ingreso cae en un tramo más caro que el declarado y todavía no se
 * envió el cobro de diferencia. Solo fichas EN PROCESO: una vez despachada la
 * ventana de cobro ya pasó y sumaría ruido de fichas viejas.
 */
export function tieneDiferenciaPorCobrar(c: FichaRow, ctx: ContextoAlertas): boolean {
  if (c.estado === 'borrador' || c.estado === 'despachado') return false
  if (c.correo_diferencia_fecha && c.correo_diferencia_fecha.trim()) return false
  const pd = parsePeso(c.peso_declarado)
  const pi = parsePeso(c.peso_ingreso)
  if (!(pi > pd)) return false
  const tabla = c.veterinaria_id ? ctx.preciosConvenio : ctx.preciosGenerales
  if (!tabla.length) return false
  const cod = c.codigo_servicio || 'CI'
  return precioDelTramo(findTramo(tabla, pi), cod) > precioDelTramo(findTramo(tabla, pd), cod)
}

/** El tutor pidió el video y no hay ningún archivo cargado (de VIDEO_DESDE en adelante). */
export function videoPendiente(c: FichaRow): boolean {
  if (c.estado === 'borrador') return false
  if (!pidioVideo(c) || jsonTieneItems(c.videos_servicio)) return false
  const iso = formatDateForSheet(c.fecha_retiro || c.fecha_creacion)
  return !!iso && iso >= VIDEO_DESDE
}

/**
 * El TUTOR avisó que algún dato de su mascota está mal (respondió "Hay un dato
 * malo" al WhatsApp de validación — lib/validacion-datos). Sigue abierto hasta
 * que alguien lo corrija: es lo que evita que el error llegue al certificado o a
 * la etiqueta. Solo fichas EN PROCESO — despachada, ya no hay nada que corregir.
 */
export function datosObservados(c: FichaRow): boolean {
  if (c.estado === 'borrador' || c.estado === 'despachado') return false
  return String(c.datos_validados || '').trim().toLowerCase() === 'observado'
}

/** Las situaciones filtrables desde los chips. */
export type FiltroSituacion = 'todos' | 'borrador' | 'pendiente' | 'cremado' | 'despachado'
  | 'pago_pendiente' | 'datos_pendientes' | 'falta_peso' | 'diferencia'
  | 'pendiente_cobro' | 'devolucion' | 'correo_malo' | 'video_pendiente' | 'datos_observados'

export const FILTROS_VALIDOS: FiltroSituacion[] = ['todos', 'borrador', 'pendiente', 'cremado', 'despachado',
  'pago_pendiente', 'datos_pendientes', 'falta_peso', 'diferencia', 'pendiente_cobro', 'devolucion',
  'correo_malo', 'video_pendiente', 'datos_observados']

/**
 * ¿Esta ficha cae en esta situación? Es el mismo criterio que usan el chip (para
 * contar) y la lista (para filtrar), así que el número del chip y lo que se ve al
 * tocarlo no pueden discrepar.
 */
export function cumpleFiltro(c: FichaRow, filtro: FiltroSituacion, ctx: ContextoAlertas): boolean {
  const id = String(c.id)
  // Los borradores solo se ven bajo "Por ingresar": en el resto de las vistas
  // todavía no son fichas reales.
  if (filtro === 'borrador') return c.estado === 'borrador'
  if (c.estado === 'borrador') return false
  switch (filtro) {
    case 'todos': return true
    case 'pendiente': return c.estado === 'pendiente' || !c.estado
    case 'cremado': return c.estado === 'cremado'
    case 'despachado': return c.estado === 'despachado'
    // "Pago pendiente" = servicio no pagado O ficha con un cobro abierto
    // (incluye el saldo de un pago parcial). Un solo filtro que las muestra todas.
    case 'pago_pendiente': return c.estado_pago !== 'pagado' || ctx.idsConCobroPendiente.has(id)
    case 'datos_pendientes': return tieneDatosPendientes(c)
    case 'falta_peso': return faltaPesoIngreso(c)
    case 'diferencia': return tieneDiferenciaPorCobrar(c, ctx)
    case 'pendiente_cobro': return ctx.idsConCobroPendiente.has(id)
    case 'devolucion': return (ctx.devolucionPorFicha.get(id) ?? 0) > 0
    case 'correo_malo': return ctx.idsCorreoMalo.has(id)
    case 'video_pendiente': return videoPendiente(c)
    case 'datos_observados': return datosObservados(c)
    default: return true
  }
}

export interface ResumenFichas {
  /** Total de fichas reales (sin borradores) en la base. */
  total: number
  borradores: number
  pagoPendiente: number
  enCamara: number
  porDespachar: number
  datosPendientes: number
  faltaPeso: number
  diferencia: number
  videoPendiente: number
  pendienteCobro: number
  devolucion: number
  devolucionMonto: number
  correoMalo: number
  datosObservados: number
}

/**
 * Los conteos de los chips, sobre TODAS las fichas. Lo llama el endpoint de
 * resumen: el servidor lee todo (barato) y manda ~300 bytes en vez del histórico.
 */
export function resumirFichas(rows: FichaRow[], ctx: ContextoAlertas): ResumenFichas {
  const reales = rows.filter(c => c.estado !== 'borrador')
  return {
    total: reales.length,
    borradores: rows.length - reales.length,
    pagoPendiente: reales.filter(c => cumpleFiltro(c, 'pago_pendiente', ctx)).length,
    // Los Sin Devolución (SD) NO se despachan (su flujo termina en "cremado").
    enCamara: reales.filter(c => cumpleFiltro(c, 'pendiente', ctx)).length,
    porDespachar: reales.filter(c => c.estado === 'cremado' && (c.codigo_servicio || 'CI').toUpperCase() !== 'SD').length,
    datosPendientes: reales.filter(c => cumpleFiltro(c, 'datos_pendientes', ctx)).length,
    faltaPeso: reales.filter(c => cumpleFiltro(c, 'falta_peso', ctx)).length,
    diferencia: reales.filter(c => cumpleFiltro(c, 'diferencia', ctx)).length,
    videoPendiente: reales.filter(c => cumpleFiltro(c, 'video_pendiente', ctx)).length,
    pendienteCobro: reales.filter(c => cumpleFiltro(c, 'pendiente_cobro', ctx)).length,
    datosObservados: reales.filter(c => cumpleFiltro(c, 'datos_observados', ctx)).length,
    devolucion: reales.filter(c => cumpleFiltro(c, 'devolucion', ctx)).length,
    devolucionMonto: reales.reduce((s, c) => s + (ctx.devolucionPorFicha.get(String(c.id)) ?? 0), 0),
    correoMalo: reales.filter(c => cumpleFiltro(c, 'correo_malo', ctx)).length,
  }
}
