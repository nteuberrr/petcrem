import { getSheetData, appendRow, getNextId, updateByIdIf, deleteById } from './datastore'
import { todayISO } from './dates'
import { parseMonto } from './numbers'
import { origenDeVet } from './precios-indexados'

/**
 * COMISIONES DE CONVENIO — Configuración → Descuentos Convenios.
 *
 * Hay veterinarios a los que NO se les factura el servicio: la BOLETA se le emite
 * al TUTOR por el precio completo (por eso su tabla de precios especiales se deja
 * igual a la general) y al vet le queda una COMISIÓN por haber derivado el caso.
 *
 * Ciclo de vida:
 *   1. El dueño define la regla del vet: 'fijo' (CLP) o 'variable' (% sobre la cremación).
 *   2. Al emitirle la BOLETA al tutor de una ficha de ese vet, se DEVENGA la comisión
 *      (una por ficha, `cliente_id` único). Si esa boleta se anula, pasa a 'anulada'.
 *   3. El devengo NO toca el EERR: solo acumula saldo.
 *   4. Cuando el dueño le paga y "ajusta saldo", ESE monto se registra como COSTO DE
 *      VENTA en `eerr_gastos_manuales` (partida 'Comisiones convenios'). Único golpe
 *      al Estado de Resultados.
 *
 * El saldo puede quedar negativo (se pagó de más): compensa con derivaciones futuras.
 */

const T_REGLAS = 'comisiones_reglas'
const T_COMISIONES = 'comisiones'
const T_AJUSTES = 'comisiones_ajustes'

export type TipoComision = 'fijo' | 'variable'

export interface ComisionRegla {
  id: string
  veterinaria_id: string
  tipo: TipoComision
  valor: number
  activo: boolean
}

export interface ComisionDevengo {
  id: string
  veterinaria_id: string
  cliente_id: string
  documento_id: string
  base_monto: number
  tipo: string
  valor: number
  monto: number
  estado: string
  fecha_devengo: string
}

export interface ComisionAjuste {
  id: string
  veterinaria_id: string
  monto: number
  detalle: string
  fecha: string
  creado_por_nombre: string
}

export interface SaldoVet {
  veterinaria_id: string
  nombre: string
  regla: ComisionRegla | null
  /** Su tabla de precios está indexada a los GENERALES (lib/precios-indexados.ts). */
  indexado: boolean
  cantidad_devengos: number
  devengado: number
  ajustado: number
  saldo: number
}

function normalizarTipo(v: unknown): TipoComision {
  return String(v ?? '').toLowerCase() === 'variable' ? 'variable' : 'fijo'
}

function toRegla(r: Record<string, string>): ComisionRegla {
  return {
    id: String(r.id ?? ''),
    veterinaria_id: String(r.veterinaria_id ?? ''),
    tipo: normalizarTipo(r.tipo),
    valor: parseMonto(r.valor),
    activo: String(r.activo ?? 'TRUE') === 'TRUE',
  }
}

function toDevengo(r: Record<string, string>): ComisionDevengo {
  return {
    id: String(r.id ?? ''),
    veterinaria_id: String(r.veterinaria_id ?? ''),
    cliente_id: String(r.cliente_id ?? ''),
    documento_id: String(r.documento_id ?? ''),
    base_monto: parseMonto(r.base_monto),
    tipo: String(r.tipo ?? ''),
    valor: parseMonto(r.valor),
    monto: parseMonto(r.monto),
    estado: String(r.estado ?? 'devengada'),
    fecha_devengo: String(r.fecha_devengo ?? ''),
  }
}

function toAjuste(r: Record<string, string>): ComisionAjuste {
  return {
    id: String(r.id ?? ''),
    veterinaria_id: String(r.veterinaria_id ?? ''),
    monto: parseMonto(r.monto),
    detalle: String(r.detalle ?? ''),
    fecha: String(r.fecha ?? ''),
    creado_por_nombre: String(r.creado_por_nombre ?? ''),
  }
}

// ─── Reglas ──────────────────────────────────────────────────────────────────

export async function listarReglas(): Promise<ComisionRegla[]> {
  const rows = await getSheetData(T_REGLAS).catch(() => [] as Record<string, string>[])
  return rows.map(toRegla)
}

/** Regla ACTIVA de una veterinaria, o null si no tiene (→ se factura como siempre). */
export async function reglaActivaDeVet(veterinariaId: string): Promise<ComisionRegla | null> {
  const vid = String(veterinariaId || '').trim()
  if (!vid) return null
  const reglas = await listarReglas()
  return reglas.find(r => r.veterinaria_id === vid && r.activo) ?? null
}

/** Alta o edición de la regla de una vet (una sola por veterinaria). */
export async function guardarRegla(input: {
  veterinaria_id: string
  tipo: TipoComision
  valor: number
  activo?: boolean
}): Promise<ComisionRegla> {
  const vid = String(input.veterinaria_id || '').trim()
  if (!vid) throw new Error('Elegí una veterinaria.')
  const tipo = normalizarTipo(input.tipo)
  const valor = Math.round(Number(input.valor) || 0)
  if (valor <= 0) throw new Error('El valor de la comisión debe ser mayor a 0.')
  if (tipo === 'variable' && valor > 100) throw new Error('Un porcentaje no puede ser mayor a 100.')
  const activo = input.activo !== false

  const rows = await getSheetData(T_REGLAS).catch(() => [] as Record<string, string>[])
  const existente = rows.find(r => String(r.veterinaria_id) === vid)
  const campos = { tipo, valor: String(valor), activo: activo ? 'TRUE' : 'FALSE' }

  if (existente) {
    await updateByIdIf(T_REGLAS, existente.id, {}, campos)
    return toRegla({ ...existente, ...campos })
  }
  const id = await getNextId(T_REGLAS)
  const row = { id: String(id), veterinaria_id: vid, ...campos, fecha_creacion: todayISO() }
  await appendRow(T_REGLAS, row)
  return toRegla(row)
}

/**
 * Elimina la regla. Los devengos YA generados se conservan (el saldo histórico
 * sigue en pie): quitar la regla solo corta las comisiones futuras.
 */
export async function eliminarRegla(id: string): Promise<void> {
  await deleteById(T_REGLAS, String(id))
}

// ─── Devengo ─────────────────────────────────────────────────────────────────

/** Monto de comisión para una base dada (la base solo importa si es 'variable'). */
export function calcularComision(regla: ComisionRegla, baseMonto: number): number {
  const base = Math.max(0, Math.round(baseMonto || 0))
  if (regla.tipo === 'variable') return Math.round((base * regla.valor) / 100)
  return Math.round(regla.valor)
}

/**
 * Devenga la comisión de una ficha al emitirle la boleta al tutor. Idempotente:
 * `cliente_id` es único, así que si la ficha ya devengó no duplica. Si existía un
 * devengo ANULADO (boleta anulada y re-emitida), lo revive con el nuevo documento.
 *
 * Best-effort por diseño: la llama el emisor de la boleta y nunca debe romper una
 * emisión ya confirmada ante el SII.
 */
export async function devengarComision(input: {
  veterinaria_id: string
  cliente_id: string
  documento_id: string
  /** Precio efectivamente cobrado por la CREMACIÓN (sin adicionales, ya con descuento). */
  base_monto: number
}): Promise<{ devengada: boolean; monto?: number }> {
  const vid = String(input.veterinaria_id || '').trim()
  const cid = String(input.cliente_id || '').trim()
  if (!vid || !cid) return { devengada: false }

  const regla = await reglaActivaDeVet(vid)
  if (!regla) return { devengada: false }

  const monto = calcularComision(regla, input.base_monto)
  if (monto <= 0) return { devengada: false }

  const rows = await getSheetData(T_COMISIONES).catch(() => [] as Record<string, string>[])
  const previo = rows.find(r => String(r.cliente_id) === cid)
  const campos = {
    veterinaria_id: vid,
    documento_id: String(input.documento_id || ''),
    base_monto: String(Math.max(0, Math.round(input.base_monto || 0))),
    tipo: regla.tipo,
    valor: String(regla.valor),
    monto: String(monto),
    estado: 'devengada',
    fecha_devengo: todayISO(),
  }

  if (previo) {
    // Ya devengada y vigente → no tocar (idempotencia). Anulada → revivir.
    if (String(previo.estado || '') === 'devengada') return { devengada: false }
    await updateByIdIf(T_COMISIONES, previo.id, {}, campos)
    return { devengada: true, monto }
  }

  const id = await getNextId(T_COMISIONES)
  await appendRow(T_COMISIONES, { id: String(id), cliente_id: cid, ...campos, fecha_creacion: todayISO() })
  return { devengada: true, monto }
}

/**
 * Anula el devengo de una ficha (su boleta se anuló con nota de crédito). No borra
 * la fila: la deja en 'anulada' para conservar la trazabilidad y permitir revivirla
 * si la boleta se re-emite.
 */
export async function anularComisionPorFicha(clienteId: string): Promise<boolean> {
  const cid = String(clienteId || '').trim()
  if (!cid) return false
  const rows = await getSheetData(T_COMISIONES).catch(() => [] as Record<string, string>[])
  const fila = rows.find(r => String(r.cliente_id) === cid && String(r.estado || '') === 'devengada')
  if (!fila) return false
  await updateByIdIf(T_COMISIONES, fila.id, {}, { estado: 'anulada' })
  return true
}

// ─── Saldos ──────────────────────────────────────────────────────────────────

/**
 * Resumen por veterinaria: devengado (comisiones vigentes) − ajustado (lo que ya
 * se le pagó) = saldo. Incluye a las vets con regla aunque todavía no devenguen,
 * y a las que devengaron aunque después se les haya quitado la regla.
 */
export async function resumenComisiones(): Promise<SaldoVet[]> {
  const [reglas, comisiones, ajustes, vets] = await Promise.all([
    listarReglas(),
    getSheetData(T_COMISIONES).catch(() => [] as Record<string, string>[]),
    getSheetData(T_AJUSTES).catch(() => [] as Record<string, string>[]),
    getSheetData('veterinarios').catch(() => [] as Record<string, string>[]),
  ])
  const nombrePorVet = new Map(vets.map(v => [String(v.id), String(v.nombre || '')]))
  const indexadoPorVet = new Map(vets.map(v => [String(v.id), origenDeVet(v) === 'general']))

  const acc = new Map<string, SaldoVet>()
  const entrada = (vid: string): SaldoVet => {
    let e = acc.get(vid)
    if (!e) {
      e = {
        veterinaria_id: vid,
        nombre: nombrePorVet.get(vid) || `Veterinaria #${vid}`,
        regla: null,
        indexado: indexadoPorVet.get(vid) === true,
        cantidad_devengos: 0,
        devengado: 0,
        ajustado: 0,
        saldo: 0,
      }
      acc.set(vid, e)
    }
    return e
  }

  for (const r of reglas) entrada(r.veterinaria_id).regla = r
  for (const c of comisiones.map(toDevengo)) {
    if (c.estado !== 'devengada') continue
    const e = entrada(c.veterinaria_id)
    e.cantidad_devengos += 1
    e.devengado += c.monto
  }
  for (const a of ajustes.map(toAjuste)) entrada(a.veterinaria_id).ajustado += a.monto

  const out = Array.from(acc.values())
  for (const e of out) e.saldo = e.devengado - e.ajustado
  out.sort((a, b) => b.saldo - a.saldo || a.nombre.localeCompare(b.nombre))
  return out
}

/** Devengos + ajustes de una veterinaria, para el detalle expandible. */
export async function detalleVet(veterinariaId: string): Promise<{
  devengos: Array<ComisionDevengo & { codigo: string; nombre_mascota: string }>
  ajustes: ComisionAjuste[]
}> {
  const vid = String(veterinariaId || '').trim()
  const [comisiones, ajustes, clientes] = await Promise.all([
    getSheetData(T_COMISIONES).catch(() => [] as Record<string, string>[]),
    getSheetData(T_AJUSTES).catch(() => [] as Record<string, string>[]),
    getSheetData('clientes').catch(() => [] as Record<string, string>[]),
  ])
  const fichaPorId = new Map(clientes.map(c => [String(c.id), c]))

  const devengos = comisiones
    .map(toDevengo)
    .filter(c => c.veterinaria_id === vid)
    .map(c => {
      const f = fichaPorId.get(c.cliente_id)
      return { ...c, codigo: String(f?.codigo || ''), nombre_mascota: String(f?.nombre_mascota || '') }
    })
    .sort((a, b) => (b.fecha_devengo || '').localeCompare(a.fecha_devengo || ''))

  const lista = ajustes
    .map(toAjuste)
    .filter(a => a.veterinaria_id === vid)
    .sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''))

  return { devengos, ajustes: lista }
}

// ─── Ajuste de saldo → costo de venta ────────────────────────────────────────

const PARTIDA_NOMBRE = 'Comisiones convenios'

/**
 * Id de la partida de COSTO donde caen los pagos de comisión. Si no existe, la
 * crea (para no depender de que el dueño la haya cargado a mano en el EERR).
 */
async function partidaComisiones(): Promise<string> {
  const partidas = await getSheetData('eerr_partidas').catch(() => [] as Record<string, string>[])
  const existente = partidas.find(
    p => String(p.tipo) === 'costo' && String(p.nombre).trim().toLowerCase() === PARTIDA_NOMBRE.toLowerCase(),
  )
  if (existente) return String(existente.id)

  const id = await getNextId('eerr_partidas')
  await appendRow('eerr_partidas', {
    id: String(id),
    tipo: 'costo',
    nombre: PARTIDA_NOMBRE,
    clave: 'comisiones_convenios',
    orden: '90',
    subgrupo_id: '',
    activo: 'TRUE',
    fecha_creacion: todayISO(),
  })
  return String(id)
}

/**
 * Registra un pago de comisión a la veterinaria: descuenta del saldo y deja la
 * contrapartida como COSTO DE VENTA en eerr_gastos_manuales. Es el único momento
 * en que las comisiones golpean el Estado de Resultados.
 */
export async function ajustarSaldo(input: {
  veterinaria_id: string
  monto: number
  detalle?: string
  fecha?: string
  creado_por_id?: string
  creado_por_nombre?: string
}): Promise<ComisionAjuste> {
  const vid = String(input.veterinaria_id || '').trim()
  if (!vid) throw new Error('Falta la veterinaria.')
  const monto = Math.round(Number(input.monto) || 0)
  if (monto <= 0) throw new Error('El monto debe ser mayor a 0.')

  const vets = await getSheetData('veterinarios').catch(() => [] as Record<string, string>[])
  const vetNombre = String(vets.find(v => String(v.id) === vid)?.nombre || `Veterinaria #${vid}`)
  const fecha = String(input.fecha || todayISO())
  const detalle = String(input.detalle || '').trim()

  // Contrapartida en el EERR (costo de venta). Si falla, NO registramos el ajuste:
  // un saldo descontado sin su costo dejaría el Estado de Resultados incompleto.
  const partidaId = await partidaComisiones()
  const gastoId = await getNextId('eerr_gastos_manuales')
  await appendRow('eerr_gastos_manuales', {
    id: String(gastoId),
    tipo_asignacion: 'costo',
    partida_id: partidaId,
    detalle: `Comisión convenio — ${vetNombre}${detalle ? ` · ${detalle}` : ''}`.slice(0, 500),
    monto: String(monto),
    fecha,
    fecha_creacion: todayISO(),
  })

  const id = await getNextId(T_AJUSTES)
  const row = {
    id: String(id),
    veterinaria_id: vid,
    monto: String(monto),
    detalle,
    fecha,
    gasto_manual_id: String(gastoId),
    creado_por_id: String(input.creado_por_id || ''),
    creado_por_nombre: String(input.creado_por_nombre || ''),
    fecha_creacion: todayISO(),
  }
  await appendRow(T_AJUSTES, row)
  return toAjuste(row)
}
