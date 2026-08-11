import './_env-preload'
import { getSheetData } from '../lib/datastore'
import { cobrosPendientesTodos } from '../lib/cobros'
import { fichasConCorreoProblema } from '../lib/correos-problema'
import { resumirFichas, type ContextoAlertas, type TramoPrecio } from '../lib/fichas-alertas'
import { findTramo } from '../lib/tramos'
import { parsePeso } from '../lib/numbers'
import { pidioVideo } from '../lib/video-solicitado'
import { formatDateForSheet } from '../lib/dates'

/**
 * Contrasta los conteos de /api/clientes/resumen (lib/fichas-alertas, que corre en
 * el SERVIDOR) contra la lógica ORIGINAL que vivía dentro de la página, copiada
 * acá tal cual. Existe porque al mover los contadores al servidor un predicado
 * mal traducido no se nota: el chip muestra un número plausible y nadie lo cruza.
 *
 *   npx tsx scripts/verificar-resumen-clientes.ts
 */

type Row = Record<string, string>

// ── Lógica ORIGINAL de la página (copiada textual, no importar) ───────────────
const jsonTieneItems = (s?: string) => { try { const a = JSON.parse(s || '[]'); return Array.isArray(a) && a.length > 0 } catch { return false } }
function precioDelTramo(t: TramoPrecio | null, codigo: string): number {
  if (!t) return 0
  const raw = codigo === 'CP' ? t.precio_cp : codigo === 'SD' ? t.precio_sd : t.precio_ci
  return parseFloat(raw) || 0
}
function datosPendientesViejo(c: Row): boolean {
  const vacio = (v?: string) => !v || !String(v).trim()
  return vacio(c.nombre_mascota) || vacio(c.nombre_tutor) || vacio(c.email) || vacio(c.telefono)
    || vacio(c.direccion_retiro) || vacio(c.direccion_despacho) || vacio(c.comuna) || vacio(c.fecha_retiro)
    || vacio(c.especie) || !c.peso_declarado || (parseFloat(c.peso_declarado) || 0) <= 0
    || vacio(c.codigo_servicio) || vacio(c.tipo_pago) || vacio(c.estado_pago)
}
function faltaPesoViejo(c: Row): boolean {
  return c.estado !== 'borrador' && c.estado !== 'despachado' && (!c.peso_ingreso || !c.peso_ingreso.trim())
}
function diferenciaVieja(c: Row, gen: TramoPrecio[], conv: TramoPrecio[]): boolean {
  if (c.estado === 'borrador' || c.estado === 'despachado') return false
  if (c.correo_diferencia_fecha && c.correo_diferencia_fecha.trim()) return false
  const pd = parsePeso(c.peso_declarado)
  const pi = parsePeso(c.peso_ingreso)
  if (!(pi > pd)) return false
  const tabla = c.veterinaria_id ? conv : gen
  if (!tabla.length) return false
  const cod = c.codigo_servicio || 'CI'
  return precioDelTramo(findTramo(tabla, pi), cod) > precioDelTramo(findTramo(tabla, pd), cod)
}
function videoPendienteViejo(c: Row): boolean {
  if (c.estado === 'borrador') return false
  if (!pidioVideo(c) || jsonTieneItems(c.videos_servicio)) return false
  const iso = formatDateForSheet(c.fecha_retiro || c.fecha_creacion)
  return !!iso && iso >= '2026-08-01'
}

async function main() {
  const [clientes, gen, conv, cobros] = await Promise.all([
    getSheetData('clientes'),
    getSheetData('precios_generales') as Promise<unknown> as Promise<TramoPrecio[]>,
    getSheetData('precios_convenio') as Promise<unknown> as Promise<TramoPrecio[]>,
    cobrosPendientesTodos().catch(() => [] as { cliente_id: string; monto: string; tipo: string }[]),
  ])
  const correosMalos = await fichasConCorreoProblema(clientes).catch(() => [])

  const devolucionPorFicha = new Map<string, number>()
  const idsConCobroPendiente = new Set<string>()
  for (const c of cobros) {
    const id = String(c.cliente_id)
    if (c.tipo === 'devolucion') {
      const monto = parseFloat(String(c.monto).replace(/[^\d.-]/g, '')) || 0
      devolucionPorFicha.set(id, (devolucionPorFicha.get(id) ?? 0) + monto)
    } else idsConCobroPendiente.add(id)
  }
  const ctx: ContextoAlertas = {
    preciosGenerales: gen, preciosConvenio: conv, idsConCobroPendiente, devolucionPorFicha,
    idsCorreoMalo: new Set(correosMalos.map(c => String(c.cliente_id))),
  }

  const nuevo = resumirFichas(clientes, ctx)
  const reales = clientes.filter(c => c.estado !== 'borrador')
  const viejo = {
    total: reales.length,
    borradores: clientes.length - reales.length,
    pagoPendiente: reales.filter(c => c.estado_pago !== 'pagado' || idsConCobroPendiente.has(String(c.id))).length,
    enCamara: reales.filter(c => c.estado === 'pendiente' || !c.estado).length,
    porDespachar: reales.filter(c => c.estado === 'cremado' && (c.codigo_servicio || 'CI').toUpperCase() !== 'SD').length,
    datosPendientes: reales.filter(c => datosPendientesViejo(c)).length,
    faltaPeso: reales.filter(c => faltaPesoViejo(c)).length,
    diferencia: reales.filter(c => diferenciaVieja(c, gen, conv)).length,
    videoPendiente: reales.filter(c => videoPendienteViejo(c)).length,
    pendienteCobro: reales.filter(c => idsConCobroPendiente.has(String(c.id))).length,
    devolucion: reales.filter(c => (devolucionPorFicha.get(String(c.id)) ?? 0) > 0).length,
    devolucionMonto: reales.reduce((s, c) => s + (devolucionPorFicha.get(String(c.id)) ?? 0), 0),
    correoMalo: reales.filter(c => ctx.idsCorreoMalo.has(String(c.id))).length,
  }

  let fallos = 0
  for (const k of Object.keys(viejo) as (keyof typeof viejo)[]) {
    const ok = viejo[k] === nuevo[k]
    if (!ok) fallos++
    console.log(`${ok ? 'OK   ' : 'FALLA'} ${k.padEnd(16)} servidor ${String(nuevo[k]).padStart(8)}  original ${String(viejo[k]).padStart(8)}`)
  }
  console.log(fallos === 0 ? `\n${Object.keys(viejo).length}/${Object.keys(viejo).length} contadores coinciden` : `\n${fallos} contadores NO coinciden`)
  if (fallos > 0) process.exit(1)
}
main().catch(e => { console.error(e); process.exit(1) })
