import { getSheetData, appendRow, getNextId, updateByIdIf, deleteById } from './datastore'
import { todayISO, formatDateForSheet } from './dates'
import { parseMonto, parsePeso } from './numbers'
import { origenDeVet } from './precios-indexados'
import { boletaAlCliente } from './vet-boleta'
import { calcularPrecioFicha, type Tramo } from './ficha-precio'

/**
 * COMISIONES DE CONVENIO — Configuración → Descuentos Convenios.
 *
 * Lo que se le paga a un veterinario por DERIVAR un caso que terminamos cobrando.
 *
 * ⚠️ La comisión NO decide a quién se le cobra. Eso lo decide el flag
 * `boleta_al_cliente` del veterinario (lib/vet-boleta.ts). Hasta el 19-08-2026 las
 * dos cosas eran una sola —tener comisión ERA la señal de "boletéale al tutor"— y
 * por eso no se podía tener una sin la otra. Van juntas casi siempre (al que solo
 * deriva se le paga comisión y al tutor se le cobra a él), pero son independientes:
 * un vet con comisión y sin el flag recibe factura por el servicio Y comisión por
 * derivarlo, que rara vez es la intención. La pestaña lo avisa.
 *
 * Ciclo de vida:
 *   1. El dueño define la regla del vet: 'fijo' (CLP) o 'variable' (% sobre la cremación).
 *   2. Cuando una ficha de ese vet queda PAGADA se DEVENGA la comisión (una por
 *      ficha, `cliente_id` único). El disparador es el pago, NO el documento: hay
 *      ventas que se cierran sin boleta y la comisión se gana igual. Si la boleta
 *      se emite y luego se anula, el devengo pasa a 'anulada'.
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

/**
 * Desde cuándo se ofrecen fichas para canjear (decisión del dueño 2026-08-22).
 * Antes de agosto los servicios sin documento son historia que ya se cerró de
 * otra forma y ofrecerlos solo agrega ruido a la lista.
 */
export const CANJE_DESDE = '2026-08-01'

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
  /** Ficha contra la que se CANJEO el saldo ('' = fue una transferencia). */
  cliente_id: string
  creado_por_nombre: string
}

export interface SaldoVet {
  veterinaria_id: string
  nombre: string
  regla: ComisionRegla | null
  /** Su tabla de precios está indexada a los GENERALES (lib/precios-indexados.ts). */
  indexado: boolean
  /** Se le boletea al TUTOR en vez de facturarle a él (lib/vet-boleta.ts). */
  boleta_al_cliente: boolean
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
    cliente_id: String(r.cliente_id ?? ''),
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
  if (!vid) throw new Error('Selecciona una veterinaria.')
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
    // Ya devengada y vigente → no tocar (idempotencia). Única excepción: si en su
    // momento se devengó SIN documento (la ficha se pagó antes de boletearse) y
    // ahora sí lo hay, se completa la referencia — es la trazabilidad de la fila.
    if (String(previo.estado || '') === 'devengada') {
      const doc = String(input.documento_id || '').trim()
      if (doc && !String(previo.documento_id || '').trim()) {
        await updateByIdIf(T_COMISIONES, previo.id, {}, { documento_id: doc })
      }
      return { devengada: false }
    }
    await updateByIdIf(T_COMISIONES, previo.id, {}, campos)
    return { devengada: true, monto }
  }

  const id = await getNextId(T_COMISIONES)
  await appendRow(T_COMISIONES, { id: String(id), cliente_id: cid, ...campos, fecha_creacion: todayISO() })
  return { devengada: true, monto }
}

/**
 * Devenga la comisión de UNA FICHA. Es el único punto de entrada del devengo:
 * lo comparten la emisión automática de la boleta al tutor (lib/facturacion) y el
 * botón manual de Facturación → "boletear ficha".
 *
 * ⚠️ El disparador es que la ficha esté PAGADA, no que exista un documento (dueño
 * 2026-08-19). Antes colgaba de la emisión de la boleta y eso dejaba comisiones sin
 * devengar en dos casos reales de Manuel Astorga: una ficha marcada «no emitir
 * boleta por este servicio» (sin_boleta) y otra que nunca se boleteó a mano. La
 * comisión se gana por DERIVAR un caso que se cobró; el documento que emitamos
 * después es otro asunto.
 *
 * Idempotente (`cliente_id` único en `comisiones`), así que da lo mismo cuántas
 * veces se llame ni por qué camino.
 */
export async function devengarComisionDeFicha(
  ficha: Record<string, string>,
  opts: { documento_id?: string } = {},
): Promise<{ devengada: boolean; monto?: number }> {
  const vid = String(ficha.veterinaria_id || '').trim()
  const cid = String(ficha.id || '').trim()
  if (!vid || !cid) return { devengada: false }
  if (String(ficha.estado || '') === 'borrador' || !String(ficha.codigo || '').trim()) return { devengada: false }
  if (String(ficha.estado_pago || '').toLowerCase() !== 'pagado') return { devengada: false }

  const regla = await reglaActivaDeVet(vid)
  if (!regla) return { devengada: false }

  // Base del %: lo efectivamente cobrado por la CREMACIÓN — sin adicionales y ya
  // con descuento, misma regla que rige a los descuentos de convenio. Con la
  // comisión 'fijo' da igual, pero las tablas se leen igual para no tener dos
  // criterios según el tipo.
  const [preciosG, preciosC, preciosE] = await Promise.all([
    getSheetData('precios_generales').catch(() => [] as Record<string, string>[]),
    getSheetData('precios_convenio').catch(() => [] as Record<string, string>[]),
    getSheetData('precios_especiales').catch(() => [] as Record<string, string>[]),
  ])
  const precio = calcularPrecioFicha(ficha, undefined, {
    generales: preciosG as unknown as Tramo[],
    convenio: preciosC as unknown as Tramo[],
    especialesDeVet: (preciosE as unknown as Tramo[]).filter(t => t.veterinaria_id === vid),
  })

  return devengarComision({
    veterinaria_id: vid,
    cliente_id: cid,
    documento_id: String(opts.documento_id || ''),
    base_monto: Math.max(0, precio.servicio - precio.descuento),
  })
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
  const boleteaPorVet = new Map(vets.map(v => [String(v.id), boletaAlCliente(v)]))

  const acc = new Map<string, SaldoVet>()
  const entrada = (vid: string): SaldoVet => {
    let e = acc.get(vid)
    if (!e) {
      e = {
        veterinaria_id: vid,
        nombre: nombrePorVet.get(vid) || `Veterinaria #${vid}`,
        regla: null,
        indexado: indexadoPorVet.get(vid) === true,
        boleta_al_cliente: boleteaPorVet.get(vid) === true,
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
  devengos: Array<ComisionDevengo & { codigo: string; nombre_mascota: string; peso: number; codigo_servicio: string }>
  ajustes: Array<ComisionAjuste & { codigo: string; nombre_mascota: string }>
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
      return {
        ...c,
        codigo: String(f?.codigo || ''),
        nombre_mascota: String(f?.nombre_mascota || ''),
        // El peso real manda sobre el declarado (misma regla que el precio).
        peso: parsePeso(f?.peso_ingreso) || parsePeso(f?.peso_declarado),
        codigo_servicio: String(f?.codigo_servicio || '').toUpperCase(),
      }
    })
    .sort((a, b) => (b.fecha_devengo || '').localeCompare(a.fecha_devengo || ''))

  // Los ajustes canjeados llevan el codigo de su ficha: en el libro mayor es lo
  // que dice contra QUE servicio se aplico ese saldo, en vez de un comentario.
  const lista = ajustes
    .map(toAjuste)
    .filter(a => a.veterinaria_id === vid)
    .map(a => {
      const f = a.cliente_id ? fichaPorId.get(a.cliente_id) : undefined
      return {
        ...a,
        codigo: String(f?.codigo || ''),
        nombre_mascota: String(f?.nombre_mascota || ''),
      }
    })
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
/**
 * Cómo se describe el pago en el EERR. Una sola función para que el alta y la
 * edición escriban EXACTAMENTE lo mismo: si divergen, la partida "Comisiones
 * convenios" queda con dos redacciones para el mismo tipo de gasto.
 */
function detalleGasto(vetNombre: string, detalle: string, ficha?: string): string {
  const partes = [`Comisión convenio — ${vetNombre}`]
  // El código de la ficha canjeada va ANTES del comentario libre: en el EERR es
  // lo único que permite rastrear contra qué servicio se aplicó ese costo.
  if (ficha) partes.push(`canje ${ficha}`)
  if (detalle) partes.push(detalle)
  return partes.join(' · ').slice(0, 500)
}

/** Código de una ficha (para el detalle del gasto), o '' si no hay ficha. */
async function codigoFicha(clienteId: string): Promise<string> {
  const cid = String(clienteId || '').trim()
  if (!cid) return ''
  const rows = await getSheetData('clientes').catch(() => [] as Record<string, string>[])
  const f = rows.find(c => String(c.id) === cid)
  if (!f) return ''
  return [String(f.codigo || `#${cid}`), String(f.nombre_mascota || '')].filter(Boolean).join(' ')
}

/**
 * FICHAS CANJEABLES: los servicios que se pueden pagar con el saldo del vet.
 *
 * Un canje es un servicio que prestamos y que no se le cobró a NADIE: ni boleta
 * al tutor ni factura al veterinario. Por eso el criterio estricto es la marca
 * «No emitir boleta por este servicio» (`sin_boleta`) más la ausencia de los dos
 * documentos — así una ficha que después se boletea deja de ofrecerse sola.
 *
 * `incluirSinMarcar` afloja el filtro a "todavía no tiene documento", que
 * incluye las que están esperando la factura del mes de su veterinario. Es más
 * ancho de la cuenta a propósito: sirve para el canje que se registra ANTES de
 * marcar la ficha, pero elegir ahí una que sí se va a facturar duplica el cobro.
 */
export async function fichasCanjeables(opts: { desde?: string; incluirSinMarcar?: boolean } = {}): Promise<Array<{
  id: string; codigo: string; nombre_mascota: string; fecha: string
  veterinaria_id: string; monto: number; sin_boleta: boolean
}>> {
  const desde = opts.desde || CANJE_DESDE
  const rows = await getSheetData('clientes').catch(() => [] as Record<string, string>[])
  return rows
    .filter(c => String(c.estado || '') !== 'borrador' && String(c.codigo || '').trim())
    .filter(c => !String(c.boleta_id || '').trim() && !String(c.factura_vet_id || '').trim())
    .filter(c => opts.incluirSinMarcar || String(c.sin_boleta || '').toUpperCase() === 'TRUE')
    .map(c => ({
      id: String(c.id),
      codigo: String(c.codigo || ''),
      nombre_mascota: String(c.nombre_mascota || ''),
      fecha: formatDateForSheet(c.fecha_retiro) || formatDateForSheet(c.fecha_creacion) || '',
      veterinaria_id: String(c.veterinaria_id || ''),
      monto: parseMonto(c.precio_total),
      sin_boleta: String(c.sin_boleta || '').toUpperCase() === 'TRUE',
    }))
    .filter(f => f.fecha >= desde)
    .sort((a, b) => b.fecha.localeCompare(a.fecha) || b.codigo.localeCompare(a.codigo))
}

/** Nombre de la veterinaria, para el detalle del gasto. */
async function nombreVet(vid: string): Promise<string> {
  const vets = await getSheetData('veterinarios').catch(() => [] as Record<string, string>[])
  return String(vets.find(v => String(v.id) === vid)?.nombre || `Veterinaria #${vid}`)
}

export async function ajustarSaldo(input: {
  veterinaria_id: string
  monto: number
  detalle?: string
  fecha?: string
  /** Ficha contra la que se canjea el saldo ('' = transferencia). */
  cliente_id?: string
  creado_por_id?: string
  creado_por_nombre?: string
}): Promise<ComisionAjuste> {
  const vid = String(input.veterinaria_id || '').trim()
  if (!vid) throw new Error('Falta la veterinaria.')
  const monto = Math.round(Number(input.monto) || 0)
  if (monto <= 0) throw new Error('El monto debe ser mayor a 0.')

  const vetNombre = await nombreVet(vid)
  const fecha = String(input.fecha || todayISO())
  const detalle = String(input.detalle || '').trim()
  const clienteId = String(input.cliente_id || '').trim()
  const ficha = await codigoFicha(clienteId)

  // Contrapartida en el EERR (costo de venta). Si falla, NO registramos el ajuste:
  // un saldo descontado sin su costo dejaría el Estado de Resultados incompleto.
  const partidaId = await partidaComisiones()
  const gastoId = await getNextId('eerr_gastos_manuales')
  await appendRow('eerr_gastos_manuales', {
    id: String(gastoId),
    tipo_asignacion: 'costo',
    partida_id: partidaId,
    detalle: detalleGasto(vetNombre, detalle, ficha),
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
    cliente_id: clienteId,
    gasto_manual_id: String(gastoId),
    creado_por_id: String(input.creado_por_id || ''),
    creado_por_nombre: String(input.creado_por_nombre || ''),
    fecha_creacion: todayISO(),
  }
  await appendRow(T_AJUSTES, row)
  return toAjuste(row)
}

/**
 * Edita un ajuste ya registrado (monto, detalle o fecha).
 *
 * ⚠️ Un ajuste NO es una fila suelta: tiene su contrapartida en el EERR
 * (`eerr_gastos_manuales`, partida "Comisiones convenios"), y las dos se
 * escribieron juntas. Editar solo el ajuste dejaría el saldo del veterinario
 * diciendo una cosa y el Estado de Resultados otra — un error que no hace ruido
 * en ninguna parte hasta que alguien cuadra los números a fin de mes.
 *
 * Por eso se mueve PRIMERO el gasto y después el ajuste: si el EERR falla, el
 * saldo queda como estaba y se puede reintentar. Si falla el segundo paso, el
 * error nombra las dos filas para poder arreglarlo a mano.
 *
 * La VETERINARIA no se cambia: mover un pago de una vet a otra es borrarlo y
 * cargarlo de nuevo, no editarlo.
 */
export async function editarAjuste(id: string, input: {
  monto: number
  detalle?: string
  fecha?: string
  /** Ficha canjeada. `undefined` = no se toca; '' = se le quita. */
  cliente_id?: string
}): Promise<ComisionAjuste> {
  const aid = String(id || '').trim()
  if (!aid) throw new Error('Falta el ajuste.')
  const monto = Math.round(Number(input.monto) || 0)
  if (monto <= 0) throw new Error('El monto debe ser mayor a 0.')

  const rows = await getSheetData(T_AJUSTES).catch(() => [] as Record<string, string>[])
  const previo = rows.find(r => String(r.id) === aid)
  if (!previo) throw new Error('Ese ajuste ya no existe.')

  const fecha = String(input.fecha || previo.fecha || todayISO())
  const detalle = String(input.detalle ?? previo.detalle ?? '').trim()
  const clienteId = String(input.cliente_id ?? previo.cliente_id ?? '').trim()
  const vid = String(previo.veterinaria_id || '')

  // 1) El EERR. Un ajuste viejo puede no tener `gasto_manual_id`: ahí no hay nada
  //    que sincronizar y se edita solo el saldo.
  const gastoId = String(previo.gasto_manual_id || '').trim()
  if (gastoId) {
    const gastos = await getSheetData('eerr_gastos_manuales').catch(() => [] as Record<string, string>[])
    if (gastos.some(g => String(g.id) === gastoId)) {
      await updateByIdIf('eerr_gastos_manuales', gastoId, {}, {
        detalle: detalleGasto(await nombreVet(vid), detalle, await codigoFicha(clienteId)),
        monto: String(monto),
        fecha,
      })
    } else {
      console.warn(`[comisiones] el ajuste ${aid} apunta al gasto ${gastoId}, que ya no está en el EERR`)
    }
  }

  // 2) El saldo.
  const campos = { monto: String(monto), detalle, fecha, cliente_id: clienteId }
  try {
    await updateByIdIf(T_AJUSTES, aid, {}, campos)
  } catch (e) {
    throw new Error(
      `Se actualizó el gasto ${gastoId} en el EERR pero NO el ajuste ${aid}: quedaron descuadrados. `
      + `Corregí el ajuste a mano. Detalle: ${e instanceof Error ? e.message : String(e)}`,
    )
  }
  return toAjuste({ ...previo, ...campos })
}

/**
 * Borra un ajuste y su gasto en el EERR. Es lo que corresponde cuando el pago se
 * cargó por error o a la veterinaria equivocada (editar no cambia de vet).
 * Mismo orden y mismo motivo que `editarAjuste`.
 */
export async function eliminarAjuste(id: string): Promise<void> {
  const aid = String(id || '').trim()
  if (!aid) throw new Error('Falta el ajuste.')
  const rows = await getSheetData(T_AJUSTES).catch(() => [] as Record<string, string>[])
  const previo = rows.find(r => String(r.id) === aid)
  if (!previo) return

  const gastoId = String(previo.gasto_manual_id || '').trim()
  if (gastoId) await deleteById('eerr_gastos_manuales', gastoId).catch(e =>
    console.warn(`[comisiones] no se pudo borrar el gasto ${gastoId} del EERR:`, e))

  try {
    await deleteById(T_AJUSTES, aid)
  } catch (e) {
    throw new Error(
      `Se borró el gasto ${gastoId} del EERR pero NO el ajuste ${aid}: el saldo sigue descontado sin su costo. `
      + `Borralo a mano. Detalle: ${e instanceof Error ? e.message : String(e)}`,
    )
  }
}
