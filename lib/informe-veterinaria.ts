import { getSheetData } from '@/lib/datastore'
import { formatDateForSheet, todayISO } from '@/lib/dates'
import { parseDecimalOr0, parsePeso, parseMonto } from '@/lib/numbers'
import { findTramo, precioDelTramo } from '@/lib/tramos'

/**
 * Genera los datos consolidados de un informe de facturación para una veterinaria.
 *
 * Convenciones:
 *  - Driver fecha: fecha_retiro (ingreso). La cremación puede ser posterior y
 *    la facturación a la vet se hace en base al ingreso.
 *  - Acumulado completo desde la primera ficha hasta el último día del mes anterior
 *    (mes cerrado). El mes en curso no entra para que el informe sea estable.
 *  - Snapshot de precio: si la ficha tiene precio_total > 0, se usa tal cual.
 *    Fallback al cálculo en vivo con las tablas vigentes para fichas legacy.
 *  - Semanas: 4 buckets fijos por mes (1-7, 8-14, 15-21, 22-fin).
 */

type Tramo = {
  id?: string
  peso_min: string
  peso_max: string
  precio_ci: string
  precio_cp: string
  precio_sd: string
  veterinaria_id?: string
}
type AdicionalItem = { tipo: string; id: string; nombre?: string; precio?: number; qty?: number }

export interface InformeRow {
  id: string
  codigo: string
  fecha_iso: string
  fecha_label: string
  mascota: string
  tutor: string
  especie: string
  peso: number
  codigo_servicio: string
  precio_servicio: number
  precio_adicionales: number
  descuento_monto: number
  precio_total: number
  estado: 'retirado' | 'cremado' | 'despachado'
  estado_pago: string
  adicionales_label: string
}

export interface SemanaBucket {
  semana_idx: number
  semana_label: string
  fichas: InformeRow[]
  subtotal: number
}

export interface MesBucket {
  mes_key: string
  mes_label: string
  year: number
  month0: number
  semanas: SemanaBucket[]
  total_fichas: number
  total_mes: number
}

export interface InformeVeterinaria {
  veterinaria: {
    id: string; nombre: string; rut: string; razon_social: string; giro: string
    direccion: string; comuna: string; telefono: string; correo: string
    nombre_contacto: string; cargo_contacto: string; tipo_precios: string
  }
  fecha_emision: string
  rango: { desde: string | null; hasta: string; nota: string }
  meses: MesBucket[]
  totales_generales: { total_fichas: number; monto_total: number; cantidad_meses: number }
  resumen: {
    por_especie: Array<{ especie: string; count: number; monto: number }>
    por_peso: Array<{ rango: string; count: number; monto: number }>
    por_servicio: Array<{ codigo: string; count: number; monto: number }>
  }
}

function parseDateSafe(raw: string): Date | null {
  if (!raw) return null
  const iso = formatDateForSheet(raw)
  if (!iso) return null
  const d = new Date(`${iso}T12:00:00`)
  return isNaN(d.getTime()) ? null : d
}

function semanaIndex(day: number): 0 | 1 | 2 | 3 {
  if (day <= 7) return 0
  if (day <= 14) return 1
  if (day <= 21) return 2
  return 3
}

function semanaLabel(idx: number, year: number, month0: number): string {
  const ranges = ['1 – 7', '8 – 14', '15 – 21', `22 – ${new Date(year, month0 + 1, 0).getDate()}`]
  return `Semana ${idx + 1} (${ranges[idx]})`
}

const MESES_ES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']

function rangoPeso(p: number): string {
  if (p <= 0) return 'Sin peso'
  if (p <= 5) return '0 – 5 kg'
  if (p <= 10) return '5 – 10 kg'
  if (p <= 15) return '10 – 15 kg'
  if (p <= 25) return '15 – 25 kg'
  if (p <= 35) return '25 – 35 kg'
  if (p <= 45) return '35 – 45 kg'
  return '45 kg o más'
}

function estadoDisplay(estado: string): 'retirado' | 'cremado' | 'despachado' {
  if (estado === 'cremado') return 'cremado'
  if (estado === 'despachado') return 'despachado'
  return 'retirado'
}

function fmtFechaLabel(d: Date): string {
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  return `${dd}-${mm}-${d.getFullYear()}`
}

export async function generarInformeVeterinaria(vetId: string): Promise<InformeVeterinaria> {
  const [vets, clientes, preciosG, preciosC, preciosE] = await Promise.all([
    getSheetData('veterinarios'),
    getSheetData('clientes'),
    getSheetData('precios_generales'),
    getSheetData('precios_convenio'),
    getSheetData('precios_especiales').catch(() => [] as Record<string, string>[]),
  ])

  const vetFound = vets.find(v => v.id === vetId)
  if (!vetFound) {
    throw Object.assign(new Error('Veterinaria no encontrada'), { status: 404 })
  }
  const vet: Record<string, string> = vetFound

  const tramosG = preciosG as unknown as Tramo[]
  const tramosC = preciosC as unknown as Tramo[]
  const tramosE = preciosE as unknown as Tramo[]
  const tramosEDeEstaVet = tramosE.filter(t => t.veterinaria_id === vetId)

  const hoy = new Date()
  const finMesPrevio = new Date(hoy.getFullYear(), hoy.getMonth(), 0)
  finMesPrevio.setHours(23, 59, 59, 999)

  const fichas = clientes.filter(c => c.veterinaria_id === vetId)

  function calcularPrecioCliente(c: Record<string, string>): {
    servicio: number; adicionales: number; descuento: number; total: number; adicionalesLabel: string
  } {
    const snapTotal = parseDecimalOr0(c.precio_total)
    const snapServ = parseDecimalOr0(c.precio_servicio)
    const snapAdi = parseDecimalOr0(c.precio_adicionales)
    const snapDesc = parseDecimalOr0(c.descuento_monto)
    let items: AdicionalItem[] = []
    try { items = JSON.parse(c.adicionales || '[]') } catch { items = [] }
    const adicionalesLabel = items
      .map(a => `${a.nombre ?? a.id}${(a.qty ?? 1) > 1 ? ' × ' + (a.qty ?? 1) : ''}`)
      .join(', ')

    if (snapTotal > 0 || snapServ > 0 || snapAdi > 0) {
      return { servicio: snapServ, adicionales: snapAdi, descuento: snapDesc, total: snapTotal, adicionalesLabel }
    }

    // Fallback en vivo
    const peso = parsePeso(c.peso_ingreso) || parsePeso(c.peso_declarado)
    const codigo = c.codigo_servicio || 'CI'
    let tabla: Tramo[] = tramosC
    const explicit = c.tipo_precios
    if (explicit === 'especial') tabla = tramosEDeEstaVet
    else if (explicit === 'general') tabla = tramosG
    else if (vet.tipo_precios === 'precios_especiales') tabla = tramosEDeEstaVet
    const tramo = findTramo(tabla, peso)
    const servicio = precioDelTramo(tramo, codigo)
    const adi = items.reduce((s, a) => s + Math.max(0, parseMonto(a.precio)) * Math.max(0, a.qty ?? 1), 0)
    const subtotal = servicio + adi
    let descuento = 0
    const dVal = parseMonto(c.descuento_valor)
    if (dVal > 0) {
      if (c.descuento_tipo === 'fijo') descuento = Math.min(dVal, subtotal)
      else if (c.descuento_tipo === 'variable') descuento = Math.round(subtotal * dVal / 100)
    }
    return {
      servicio: Math.round(servicio),
      adicionales: Math.round(adi),
      descuento: Math.round(descuento),
      total: Math.round(Math.max(0, subtotal - descuento)),
      adicionalesLabel,
    }
  }

  const mesesMap = new Map<string, MesBucket>()
  const porEspecie = new Map<string, { count: number; monto: number }>()
  const porPeso = new Map<string, { count: number; monto: number }>()
  const porServicio = new Map<string, { count: number; monto: number }>()
  let totalFichasGeneral = 0
  let montoTotalGeneral = 0
  let fechaMinima: Date | null = null

  for (const c of fichas) {
    const f = parseDateSafe(c.fecha_retiro || c.fecha_creacion)
    if (!f) continue
    if (f > finMesPrevio) continue

    if (!fechaMinima || f < fechaMinima) fechaMinima = f

    const y = f.getFullYear()
    const m0 = f.getMonth()
    const mesKey = `${y}-${String(m0 + 1).padStart(2, '0')}`
    const mesLabel = `${MESES_ES[m0]} ${y}`
    const semIdx = semanaIndex(f.getDate())

    let bucket = mesesMap.get(mesKey)
    if (!bucket) {
      bucket = {
        mes_key: mesKey,
        mes_label: mesLabel,
        year: y,
        month0: m0,
        semanas: [0, 1, 2, 3].map(i => ({
          semana_idx: i,
          semana_label: semanaLabel(i, y, m0),
          fichas: [],
          subtotal: 0,
        })),
        total_fichas: 0,
        total_mes: 0,
      }
      mesesMap.set(mesKey, bucket)
    }

    const precio = calcularPrecioCliente(c)
    const peso = parsePeso(c.peso_ingreso) || parsePeso(c.peso_declarado)
    const especie = c.especie || 'Sin especie'
    const codServ = (c.codigo_servicio || 'CI').toUpperCase()
    const rangoP = rangoPeso(peso)

    const row: InformeRow = {
      id: c.id,
      codigo: c.codigo,
      fecha_iso: f.toISOString().slice(0, 10),
      fecha_label: fmtFechaLabel(f),
      mascota: c.nombre_mascota,
      tutor: c.nombre_tutor,
      especie,
      peso,
      codigo_servicio: codServ,
      precio_servicio: precio.servicio,
      precio_adicionales: precio.adicionales,
      descuento_monto: precio.descuento,
      precio_total: precio.total,
      estado: estadoDisplay(c.estado || ''),
      estado_pago: c.estado_pago || 'pendiente',
      adicionales_label: precio.adicionalesLabel,
    }

    bucket.semanas[semIdx].fichas.push(row)
    bucket.semanas[semIdx].subtotal += precio.total
    bucket.total_fichas += 1
    bucket.total_mes += precio.total

    totalFichasGeneral += 1
    montoTotalGeneral += precio.total

    const ace = porEspecie.get(especie) ?? { count: 0, monto: 0 }
    ace.count += 1; ace.monto += precio.total
    porEspecie.set(especie, ace)

    const acp = porPeso.get(rangoP) ?? { count: 0, monto: 0 }
    acp.count += 1; acp.monto += precio.total
    porPeso.set(rangoP, acp)

    const acs = porServicio.get(codServ) ?? { count: 0, monto: 0 }
    acs.count += 1; acs.monto += precio.total
    porServicio.set(codServ, acs)
  }

  const meses = Array.from(mesesMap.values()).sort((a, b) => a.mes_key.localeCompare(b.mes_key))
  for (const m of meses) {
    for (const s of m.semanas) {
      s.fichas.sort((a, b) => a.fecha_iso.localeCompare(b.fecha_iso))
    }
  }
  const mesesConDatos = meses.filter(m => m.total_fichas > 0)

  const rangoOrden = ['Sin peso', '0 – 5 kg', '5 – 10 kg', '10 – 15 kg', '15 – 25 kg', '25 – 35 kg', '35 – 45 kg', '45 kg o más']

  return {
    veterinaria: {
      id: vet.id,
      nombre: vet.nombre,
      rut: vet.rut,
      razon_social: vet.razon_social,
      giro: vet.giro,
      direccion: vet.direccion,
      comuna: vet.comuna,
      telefono: vet.telefono,
      correo: vet.correo,
      nombre_contacto: vet.nombre_contacto,
      cargo_contacto: vet.cargo_contacto,
      tipo_precios: vet.tipo_precios,
    },
    fecha_emision: todayISO(),
    rango: {
      desde: fechaMinima ? fechaMinima.toISOString().slice(0, 10) : null,
      hasta: finMesPrevio.toISOString().slice(0, 10),
      nota: 'Incluye todas las fichas desde el primer registro hasta el fin del mes anterior (cerrado).',
    },
    meses: mesesConDatos,
    totales_generales: {
      total_fichas: totalFichasGeneral,
      monto_total: montoTotalGeneral,
      cantidad_meses: mesesConDatos.length,
    },
    resumen: {
      por_especie: Array.from(porEspecie.entries())
        .map(([especie, v]) => ({ especie, count: v.count, monto: v.monto }))
        .sort((a, b) => b.count - a.count),
      por_peso: Array.from(porPeso.entries())
        .map(([rango, v]) => ({ rango, count: v.count, monto: v.monto }))
        .sort((a, b) => rangoOrden.indexOf(a.rango) - rangoOrden.indexOf(b.rango)),
      por_servicio: Array.from(porServicio.entries())
        .map(([codigo, v]) => ({ codigo, count: v.count, monto: v.monto }))
        .sort((a, b) => b.count - a.count),
    },
  }
}
