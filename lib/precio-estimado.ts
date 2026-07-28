import { getSheetData } from './datastore'
import { findTramo, precioDelTramo, numTramo } from './tramos'
import { repartirAnforasPremium } from './anforas-premium'
import { aplicaReglaAuto, cremacionLlevaRecargoFueraHorario } from './adicionales-auto'
import { getConfigCobroEutanasia, recargoEutanasiaPara } from './eutanasia-precios'
import { leerSnapshotFicha, type AdicionalItem } from './price-calculator'
import { parsePeso } from './numbers'
import { formatDateForSheet } from './dates'

/**
 * VALOR A COBRAR de una ficha que TODAVÍA no tiene precio congelado.
 *
 * El snapshot (`precio_servicio` / `precio_total`) se escribe recién al crear o
 * guardar la ficha desde el panel. Las fichas que nacen de un AGENDAMIENTO —el
 * bot de WhatsApp, el agendamiento manual o una eutanasia a domicilio— entran
 * como borrador ("Por ingresar") SIN snapshot, así que no mostraban ningún
 * monto hasta que alguien las registraba.
 *
 * Este módulo calcula ese valor EN VIVO con los mismos criterios del snapshot
 * (lib/price-calculator): tabla según veterinaria/tipo de precios, tramo por
 * peso, ánfora premium incluida en CP, descuento solo sobre la cremación. Suma
 * además los recargos automáticos (fuera de horario / distancia) que la ficha
 * todavía no tiene cargados como adicionales, porque igual se van a cobrar.
 *
 * Es una ESTIMACIÓN: mientras falten datos (peso, modalidad) puede cambiar, y
 * no se persiste — al registrar la ficha manda el snapshot.
 */

export interface LineaEstimada {
  nombre: string
  monto: number
  /** Va incluida en el servicio (ánfora premium del CP) → monto 0. */
  incluido?: boolean
}

export interface EstimacionFicha {
  servicio: number
  adicionales: number
  descuento: number
  /** Total de la cremación (lo que iría en la boleta). */
  total: number
  lineas: LineaEstimada[]
  /** Modalidad usada en el cálculo (la de la ficha, o 'CI' si aún no se define). */
  codigo_servicio: string
  /** true si la ficha no tiene modalidad y se estimó con Cremación Individual. */
  modalidad_asumida: boolean
  /** true si no hay peso todavía → el monto no se puede calcular. */
  falta_peso: boolean
  tipo_precios: 'general' | 'convenio' | 'especial'
}

type Fila = Record<string, string>
/** Fila de una tabla de precios (las columnas llegan como texto desde el datastore). */
type TramoFila = Fila & {
  peso_min: string; peso_max: string
  precio_ci?: string; precio_cp?: string; precio_sd?: string
}
const comoTramos = (rows: Fila[]) => rows as TramoFila[]

const NOMBRE_MODALIDAD: Record<string, string> = {
  CI: 'Cremación Individual',
  CP: 'Cremación Premium',
  SD: 'Cremación Sin Devolución',
}

function parseAdicionales(json: string | undefined): AdicionalItem[] {
  try {
    const arr = JSON.parse(json || '[]')
    return Array.isArray(arr) ? (arr as AdicionalItem[]) : []
  } catch {
    return []
  }
}

/**
 * Carga UNA sola vez las tablas de precios (generales, convenio, especiales),
 * los productos y los "otros servicios" con regla automática, y devuelve una
 * función pura que estima el valor de cada ficha. Pensado para listas: evita
 * releer las tablas por fila.
 */
export async function crearEstimadorFichas(): Promise<(row: Fila) => EstimacionFicha> {
  const [generales, convenio, especiales, productos, otros, cotis, cfgEut] = await Promise.all([
    getSheetData('precios_generales').catch(() => [] as Fila[]),
    getSheetData('precios_convenio').catch(() => [] as Fila[]),
    getSheetData('precios_especiales').catch(() => [] as Fila[]),
    getSheetData('productos').catch(() => [] as Fila[]),
    getSheetData('otros_servicios').catch(() => [] as Fila[]),
    getSheetData('cotizaciones_eutanasia').catch(() => [] as Fila[]),
    getConfigCobroEutanasia().catch(() => null),
  ])
  const categoriaPorProducto = new Map(productos.map(p => [String(p.id), String(p.categoria ?? '')]))
  const serviciosAuto = otros.filter(
    s => String(s.activo ?? 'TRUE').toUpperCase() !== 'FALSE' && (s.auto_regla || '').trim(),
  )

  // Eutanasia asociada a la ficha: (a) si ya cobra su propio recargo fuera de
  // horario, la cremación NO lo suma (regla única, ver lib/adicionales-auto);
  // (b) mientras la ficha no tenga fecha/hora de retiro propias, el retiro es el
  // que coordinó el veterinario (`hora_retiro_crematorio`) — así el recargo del
  // retiro no se pierde por tener la ficha en blanco.
  const eutPorCliente = new Map<string, { yaCobraRecargo: boolean; fecha: string; hora: string }>()
  for (const c of cotis) {
    const clienteId = String(c.cliente_id || '')
    if (!clienteId) continue
    if (['cancelada', 'no_realizada'].includes(String(c.estado || ''))) continue
    const recargo = cfgEut ? recargoEutanasiaPara(c.fecha_servicio, c.hora_servicio, cfgEut.recargoMonto) : 0
    eutPorCliente.set(clienteId, {
      yaCobraRecargo: recargo > 0,
      fecha: String(c.fecha_servicio || ''),
      hora: String(c.hora_retiro_crematorio || ''),
    })
  }

  return (row: Fila): EstimacionFicha => {
    // Tabla de precios: misma regla que el snapshot — para un veterinario manda
    // la EXISTENCIA de filas especiales; si no tiene, convenio.
    const vetId = String(row.veterinaria_id || '').trim()
    let tipo: 'general' | 'convenio' | 'especial' = 'general'
    let tabla = comoTramos(generales)
    if (vetId) {
      const suyas = especiales.filter(r => String(r.veterinaria_id) === vetId)
      if (suyas.length > 0) { tipo = 'especial'; tabla = comoTramos(suyas) }
      else { tipo = 'convenio'; tabla = comoTramos(convenio) }
    } else if (String(row.tipo_precios || '').toLowerCase() === 'convenio') {
      tipo = 'convenio'; tabla = comoTramos(convenio)
    }

    const peso = parsePeso(row.peso_ingreso) || parsePeso(row.peso_declarado)
    const codigoFicha = String(row.codigo_servicio || '').trim().toUpperCase()
    const codigo = codigoFicha || 'CI'
    const servicio = precioDelTramo(findTramo(tabla, peso), codigo)

    // Adicionales ya cargados en la ficha + los recargos automáticos que
    // correspondan por fecha/hora/comuna del retiro y todavía no estén puestos.
    const items = parseAdicionales(row.adicionales)
    const eut = eutPorCliente.get(String(row.id))
    const ctx = {
      fecha: formatDateForSheet(row.fecha_retiro) || String(row.fecha_retiro || '') || eut?.fecha || '',
      hora: String(row.hora_retiro || '') || eut?.hora || '',
      comuna: String(row.comuna || ''),
    }
    for (const s of serviciosAuto) {
      const esFueraHorario = (s.auto_regla || '').trim() === 'fuera_horario'
      // Recargo fuera de horario: UNO SOLO por atención. Si la eutanasia asociada
      // ya lo cobra (fuera de boleta), la cremación no vuelve a sumarlo.
      const aplica = esFueraHorario
        ? cremacionLlevaRecargoFueraHorario({
            retiroFueraHorario: aplicaReglaAuto(s, ctx),
            eutanasiaYaCobraRecargo: !!eut?.yaCobraRecargo,
          })
        : aplicaReglaAuto(s, ctx)
      const yaEsta = items.some(a => a.tipo === 'servicio' && String(a.id) === String(s.id))
      if (aplica && !yaEsta) {
        items.push({ tipo: 'servicio', id: String(s.id), nombre: s.nombre || '', precio: numTramo(s.precio), qty: 1 })
      } else if (!aplica && yaEsta && esFueraHorario && eut?.yaCobraRecargo) {
        // Venía persistido en los adicionales pero lo cobra la eutanasia → fuera
        // (así el cobro doble tampoco se arrastra desde una ficha guardada).
        const i = items.findIndex(a => a.tipo === 'servicio' && String(a.id) === String(s.id))
        if (i >= 0) items.splice(i, 1)
      }
    }

    const reparto = repartirAnforasPremium(codigo, items, categoriaPorProducto)
    const adicionales = reparto.reduce((sum, r) => sum + Math.max(0, numTramo(r.item.precio)) * r.qtyCobrable, 0)

    // Descuento: SOLO sobre la cremación, nunca sobre los adicionales.
    let descuento = 0
    const valorDesc = numTramo(row.descuento_valor)
    if (valorDesc > 0) {
      if (row.descuento_tipo === 'fijo') descuento = Math.min(valorDesc, servicio)
      else if (row.descuento_tipo === 'variable') descuento = Math.round((servicio * valorDesc) / 100)
    }

    const lineas: LineaEstimada[] = [
      { nombre: NOMBRE_MODALIDAD[codigo] || 'Cremación', monto: Math.round(servicio) },
    ]
    reparto.forEach(r => {
      const monto = Math.max(0, numTramo(r.item.precio)) * r.qtyCobrable
      const qty = Math.max(1, Math.round(numTramo(r.item.qty) || 1))
      lineas.push({
        nombre: `${r.item.nombre || 'Adicional'}${qty > 1 ? ` ×${qty}` : ''}`,
        monto: Math.round(monto),
        incluido: r.qtyIncluida > 0 && r.qtyCobrable === 0,
      })
    })
    if (descuento > 0) lineas.push({ nombre: `Descuento${row.descuento_nombre ? ` (${row.descuento_nombre})` : ''}`, monto: -Math.round(descuento) })

    return {
      servicio: Math.round(servicio),
      adicionales: Math.round(adicionales),
      descuento: Math.round(descuento),
      total: Math.max(0, Math.round(servicio + adicionales - descuento)),
      lineas,
      codigo_servicio: codigo,
      modalidad_asumida: !codigoFicha,
      falta_peso: peso <= 0,
      tipo_precios: tipo,
    }
  }
}

/** Estimación de varias fichas de una sola pasada (una lectura de tablas). */
export async function estimarFichas(rows: Fila[]): Promise<Map<string, EstimacionFicha>> {
  const out = new Map<string, EstimacionFicha>()
  if (!rows.length) return out
  const estimar = await crearEstimadorFichas()
  for (const r of rows) out.set(String(r.id), estimar(r))
  return out
}

/**
 * Valor VISIBLE de una ficha: el snapshot congelado si ya existe, y si no la
 * estimación en vivo. `estimado` indica cuál de los dos se está mostrando.
 */
export function valorFicha(
  row: Fila,
  estimar: (row: Fila) => EstimacionFicha,
): { total: number; estimado: boolean; estimacion: EstimacionFicha | null } {
  const snap = leerSnapshotFicha(row)
  if (snap) return { total: snap.precio_total, estimado: false, estimacion: null }
  const est = estimar(row)
  return { total: est.total, estimado: true, estimacion: est }
}
