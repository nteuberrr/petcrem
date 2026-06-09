import { getSheetData } from './datastore'
import { PrecioTramo } from '@/types'

export async function calcularPrecio(
  peso: number,
  codigoServicio: string,
  tipoPrecios: 'general' | 'convenio',
  preciosEspeciales?: PrecioTramo[]
): Promise<number> {
  let tramos: PrecioTramo[]

  if (preciosEspeciales && preciosEspeciales.length > 0) {
    tramos = preciosEspeciales
  } else {
    const hoja = tipoPrecios === 'general' ? 'precios_generales' : 'precios_convenio'
    const rows = await getSheetData(hoja)
    tramos = rows.map((r) => ({
      id: r.id,
      peso_min: parseFloat(r.peso_min),
      peso_max: parseFloat(r.peso_max),
      precio_ci: parseFloat(r.precio_ci),
      precio_cp: parseFloat(r.precio_cp),
      precio_sd: parseFloat(r.precio_sd),
    }))
  }

  // Regla de borde: en el límite exacto entre dos tramos se usa el tramo MAYOR
  // (intervalos [min, max) ), con fallback al tramo tope cuando el peso lo iguala
  // o supera. Ver findTramo() más abajo y la nota en CLAUDE.md.
  const tramo = findTramo(tramos as unknown as TramoRaw[], peso) as unknown as PrecioTramo | null

  if (!tramo) return 0

  const key = `precio_${codigoServicio.toLowerCase()}` as keyof PrecioTramo
  return Number(tramo[key]) || 0
}

// ─────────────────────────────────────────────────────────────────────────────
// Snapshot completo para una ficha de cliente (precio servicio + adicionales +
// descuento + total). Lo usa POST/PATCH de clientes para "congelar" el monto al
// momento de crear/editar — los cambios posteriores en la tabla de precios NO
// afectan a fichas viejas (lo único que reescribe el snapshot es entrar a la
// ficha y guardar).
// ─────────────────────────────────────────────────────────────────────────────

type TramoRaw = {
  id?: string
  peso_min: string | number
  peso_max: string | number
  precio_ci: string | number
  precio_cp: string | number
  precio_sd: string | number
  veterinaria_id?: string
}

export type AdicionalItem = {
  tipo: 'producto' | 'servicio'
  id: string
  precio?: number
  qty?: number
  nombre?: string
}

export interface PrecioSnapshot {
  precio_servicio: number
  precio_adicionales: number
  precio_total: number
  descuento_monto: number
  tipo_precios_efectivo: 'general' | 'convenio' | 'especial'
}

function num(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0
  if (typeof v === 'string') {
    const n = parseFloat(v.replace(',', '.'))
    return Number.isFinite(n) ? n : 0
  }
  return 0
}

function findTramo(tabla: TramoRaw[], peso: number): TramoRaw | null {
  if (!tabla.length || !Number.isFinite(peso) || peso <= 0) return null
  // Tramo tope = el de mayor peso_min. Si el peso lo iguala o supera, es el que
  // aplica (cubre el borde superior y los pesos por encima de la tabla).
  let maxMin = -Infinity
  let tramoTope: TramoRaw | null = null
  for (const t of tabla) {
    const min = num(t.peso_min)
    if (min > maxMin) { maxMin = min; tramoTope = t }
  }
  if (tramoTope && peso >= maxMin) return tramoTope
  // Regla de borde: intervalos [min, max). En el límite exacto (ej. 15 kg entre
  // 10–15 y 15–25) gana SIEMPRE el tramo MAYOR, porque 15 ya no cae en [10,15).
  for (const t of tabla) {
    const min = num(t.peso_min)
    const max = num(t.peso_max)
    if (peso >= min && peso < max) return t
  }
  return null
}

function precioDelTramo(t: TramoRaw | null, codigo: string): number {
  if (!t) return 0
  const k = codigo === 'CP' ? 'precio_cp' : codigo === 'SD' ? 'precio_sd' : 'precio_ci'
  return num((t as unknown as Record<string, unknown>)[k])
}

export interface SnapshotInput {
  peso: number
  codigo_servicio: string
  veterinaria_id?: string
  /** 'general' | 'convenio' | 'especial' — si viene explícito, se respeta. Si no, se infiere por veterinaria. */
  tipo_precios?: string
  adicionales: AdicionalItem[]
  descuento_tipo?: string  // 'fijo' | 'variable'
  descuento_valor?: number | string
}

export async function calcularSnapshotFicha(input: SnapshotInput): Promise<PrecioSnapshot> {
  const { peso, codigo_servicio, adicionales } = input

  // 1) Determinar tipo_precios efectivo
  let tipo: 'general' | 'convenio' | 'especial' = 'general'
  const explicit = (input.tipo_precios ?? '').toLowerCase()
  if (explicit === 'convenio' || explicit === 'especial' || explicit === 'general') {
    tipo = explicit
  } else if (input.veterinaria_id) {
    try {
      const vets = await getSheetData('veterinarios')
      const vet = vets.find(v => v.id === input.veterinaria_id)
      if (vet) tipo = vet.tipo_precios === 'precios_especiales' ? 'especial' : 'convenio'
    } catch {
      // si falla, dejamos 'general'
    }
  }

  // 2) Cargar tabla aplicable
  let tabla: TramoRaw[] = []
  if (tipo === 'especial' && input.veterinaria_id) {
    const rows = await getSheetData('precios_especiales')
    tabla = rows.filter(r => r.veterinaria_id === input.veterinaria_id) as unknown as TramoRaw[]
    // Fallback: si la vet no tiene tramos especiales cargados, caemos a convenio
    if (tabla.length === 0) {
      tabla = (await getSheetData('precios_convenio')) as unknown as TramoRaw[]
      tipo = 'convenio'
    }
  } else if (tipo === 'convenio') {
    tabla = (await getSheetData('precios_convenio')) as unknown as TramoRaw[]
  } else {
    tabla = (await getSheetData('precios_generales')) as unknown as TramoRaw[]
  }

  // 3) Encontrar tramo y precio del servicio
  const tramo = findTramo(tabla, peso)
  const precio_servicio = precioDelTramo(tramo, (codigo_servicio || 'CI').toUpperCase())

  // 4) Sumar adicionales
  const precio_adicionales = adicionales.reduce(
    (s, a) => s + num(a.precio) * (a.qty ?? 1),
    0
  )

  const subtotal = precio_servicio + precio_adicionales

  // 5) Aplicar descuento (snapshot ya tipeado por el form)
  let descuento_monto = 0
  const valor = num(input.descuento_valor)
  if (valor > 0) {
    if (input.descuento_tipo === 'fijo') {
      descuento_monto = Math.min(valor, subtotal)
    } else if (input.descuento_tipo === 'variable') {
      descuento_monto = Math.round((subtotal * valor) / 100)
    }
  }

  const precio_total = Math.max(0, subtotal - descuento_monto)

  return {
    precio_servicio: Math.round(precio_servicio),
    precio_adicionales: Math.round(precio_adicionales),
    precio_total: Math.round(precio_total),
    descuento_monto: Math.round(descuento_monto),
    tipo_precios_efectivo: tipo,
  }
}

/**
 * Lee el precio congelado de una fila de cliente. Devuelve null si no hay
 * snapshot (ficha legacy creada antes del feature). El llamador decide si
 * recalcula en vivo o muestra un placeholder.
 */
export function leerSnapshotFicha(cliente: Record<string, string>): PrecioSnapshot | null {
  const ps = num(cliente.precio_servicio)
  const pa = num(cliente.precio_adicionales)
  const pt = num(cliente.precio_total)
  const dm = num(cliente.descuento_monto)
  // Si total = 0 Y no hay servicio ni adicionales, asumimos que no hay snapshot.
  if (pt === 0 && ps === 0 && pa === 0) return null
  return {
    precio_servicio: ps,
    precio_adicionales: pa,
    precio_total: pt,
    descuento_monto: dm,
    tipo_precios_efectivo: (cliente.tipo_precios as 'general' | 'convenio' | 'especial') || 'general',
  }
}
