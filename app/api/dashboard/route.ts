import { NextResponse } from 'next/server'
import { getSheetData } from '@/lib/google-sheets'
import { formatDateForSheet } from '@/lib/dates'

type Tramo = { id: string; peso_min: string; peso_max: string; precio_ci: string; precio_cp: string; precio_sd: string; veterinaria_id?: string }
type AdicionalItem = { tipo: string; id: string; nombre?: string; precio?: number; qty?: number }

function findTramo(tabla: Tramo[], pesoKg: number): Tramo | null {
  if (!tabla.length || !isFinite(pesoKg) || pesoKg <= 0) return null
  let maxMin = -Infinity
  let top: Tramo | null = null
  for (const t of tabla) {
    const min = parseFloat(t.peso_min) || 0
    const max = parseFloat(t.peso_max) || 0
    if (min > maxMin) { maxMin = min; top = t }
    if (pesoKg >= min && pesoKg <= max) return t
  }
  if (top && pesoKg >= maxMin) return top
  return null
}

function precioTramo(tramo: Tramo | null, codigo: string): number {
  if (!tramo) return 0
  const raw = codigo === 'CP' ? tramo.precio_cp : codigo === 'SD' ? tramo.precio_sd : tramo.precio_ci
  return parseFloat(raw) || 0
}

export async function GET() {
  try {
    const safe = (name: string) => getSheetData(name).catch(() => [] as Record<string, string>[])
    const [clientes, ciclos, cargas, cargasVehiculo, vets, preciosGRaw, preciosCRaw, preciosERaw, productos, otrosSrv] = await Promise.all([
      safe('clientes'),
      safe('ciclos'),
      safe('cargas_petroleo'),
      safe('vehiculo_cargas'),
      safe('veterinarios'),
      safe('precios_generales'),
      safe('precios_convenio'),
      safe('precios_especiales'),
      safe('productos'),
      safe('otros_servicios'),
    ])
    const preciosG = preciosGRaw as unknown as Tramo[]
    const preciosC = preciosCRaw as unknown as Tramo[]
    const preciosE = preciosERaw as unknown as Tramo[]

    const vetById: Record<string, Record<string, string>> = {}
    vets.forEach(v => { vetById[v.id] = v })

    const productoNombreMap = new Map(productos.map(p => [p.id, p.nombre]))
    const servicioNombreMap = new Map(otrosSrv.map(s => [s.id, s.nombre]))
    const productoNombre = (pid: string) => productoNombreMap.get(pid) ?? `prod:${pid}`
    const servicioNombre = (sid: string) => servicioNombreMap.get(sid) ?? `srv:${sid}`

    // Pre-filter tabla especiales por veterinaria para evitar recalcular en cada cliente
    const preciosEByVet = new Map<string, Tramo[]>()
    for (const t of preciosE) {
      const vid = t.veterinaria_id ?? ''
      const arr = preciosEByVet.get(vid) ?? []
      arr.push(t)
      preciosEByVet.set(vid, arr)
    }

    const now = new Date()
    const mesActual = now.getMonth()
    const anioActual = now.getFullYear()
    const startMesActual = new Date(anioActual, mesActual, 1)
    startMesActual.setHours(0, 0, 0, 0)

    // Cache de fecha por cliente (parseo una sola vez).
    // Driver: si el cliente está cremado y tiene ciclo_id, la fecha "del mes" es
    // la fecha del ciclo (fecha de cremación). Fallback a fecha_retiro / fecha_creacion.
    const cicloById = new Map(ciclos.map(c => [c.id, c]))
    const fechaCache = new Map<string, Date | null>()
    function parseDateSafe(raw: string): Date | null {
      if (!raw) return null
      const iso = formatDateForSheet(raw) // maneja serial Excel + ISO + DD/MM/YYYY
      if (!iso) return null
      const d = new Date(`${iso}T12:00:00`) // mediodía local para evitar UTC shift
      return isNaN(d.getTime()) ? null : d
    }
    function fechaCliente(c: Record<string, string>): Date | null {
      const cached = fechaCache.get(c.id)
      if (cached !== undefined) return cached
      let d: Date | null = null
      if (c.estado === 'cremado' && c.ciclo_id) {
        const ciclo = cicloById.get(c.ciclo_id)
        if (ciclo?.fecha) d = parseDateSafe(ciclo.fecha)
      }
      if (!d) d = parseDateSafe(c.fecha_retiro || c.fecha_creacion)
      fechaCache.set(c.id, d)
      return d
    }

    // Cache de adicionales parseados (evita JSON.parse repetido por cliente)
    const adicionalesCache = new Map<string, AdicionalItem[]>()
    function adicionalesDe(c: Record<string, string>): AdicionalItem[] {
      const cached = adicionalesCache.get(c.id)
      if (cached) return cached
      let items: AdicionalItem[] = []
      try { items = JSON.parse(c.adicionales || '[]') } catch (e) { console.warn('[dashboard] adicionales parse fail', c.id, e) }
      adicionalesCache.set(c.id, items)
      return items
    }

    // Cálculo de ingreso por cliente (cacheado por id)
    type Ingreso = { total: number; servicio: number; adicionales: number; adicionalesItems: AdicionalItem[] }
    const ingresoCache = new Map<string, Ingreso>()
    function ingresoCliente(c: Record<string, string>): Ingreso {
      const cached = ingresoCache.get(c.id)
      if (cached) return cached
      const peso = parseFloat(c.peso_kg) || 0
      const codigo = c.codigo_servicio || 'CI'
      let tabla: Tramo[] = preciosG
      const explicit = c.tipo_precios
      if (explicit === 'convenio') tabla = preciosC
      else if (explicit === 'especial') tabla = preciosEByVet.get(c.veterinaria_id ?? '') ?? []
      else if (explicit === 'general') tabla = preciosG
      else if (c.veterinaria_id) {
        const vet = vetById[c.veterinaria_id]
        if (vet?.tipo_precios === 'precios_especiales') tabla = preciosEByVet.get(c.veterinaria_id) ?? []
        else tabla = preciosC
      }
      const tramo = findTramo(tabla, peso)
      const servicio = precioTramo(tramo, codigo)
      const adicionalesItems = adicionalesDe(c)
      const adicionales = adicionalesItems.reduce((s, a) => s + (a.precio ?? 0) * (a.qty ?? 1), 0)
      const result = { total: servicio + adicionales, servicio, adicionales, adicionalesItems }
      ingresoCache.set(c.id, result)
      return result
    }

    // Stock petróleo
    const totalCargado = cargas.reduce((s, r) => s + (parseFloat(r.litros) || 0), 0)
    const totalConsumido = ciclos.reduce((s, c) => {
      const ini = parseFloat(c.litros_inicio) || 0
      const fin = parseFloat(c.litros_fin) || 0
      return s + Math.abs(fin - ini)
    }, 0)
    const stock = totalCargado - totalConsumido

    // Total monto gastado en combustible del vehículo
    const totalMontoVehiculo = cargasVehiculo.reduce((s, r) => s + (parseFloat(r.monto) || 0), 0)

    // Filtros base — calculados una sola vez
    const cremadosTodos = clientes.filter(c => c.estado === 'cremado')
    const cremadosMes = cremadosTodos.filter(c => {
      const f = fechaCliente(c)
      return f && f >= startMesActual && f <= now
    })
    const ciclosMes = ciclos.filter(c => {
      const f = c.fecha ? new Date(c.fecha) : null
      return f && !isNaN(f.getTime()) && f >= startMesActual && f <= now
    })
    const litrosMes = ciclosMes.reduce((s, c) => s + Math.abs((parseFloat(c.litros_fin) || 0) - (parseFloat(c.litros_inicio) || 0)), 0)
    // "Pendientes" = pendientes de cremación (en cámara). Mismo criterio que TimelineStatus.
    const pendientes = clientes.filter(c => c.estado === 'pendiente').length

    const ingresosMes = cremadosMes.reduce((s, c) => s + ingresoCliente(c).total, 0)

    // Ratios
    const mascotasTotalCremadas = cremadosTodos.length
    const ciclosPorLitro = totalConsumido > 0 ? ciclos.length / totalConsumido : 0
    const litrosPorCiclo = ciclos.length > 0 ? totalConsumido / ciclos.length : 0
    const litrosPorMascota = mascotasTotalCremadas > 0 ? totalConsumido / mascotasTotalCremadas : 0
    const costoVehiculoPorMascota = mascotasTotalCremadas > 0 ? totalMontoVehiculo / mascotasTotalCremadas : 0

    // Ventas últimos 12 meses — agrupar en una pasada en vez de 12 filters
    const startVentanas = Array.from({ length: 12 }, (_, k) => {
      const i = 11 - k
      return new Date(anioActual, mesActual - i, 1)
    })
    const ventanaIdx = new Map<string, number>() // key "yyyy-mm" → bucket index
    startVentanas.forEach((d, idx) => ventanaIdx.set(`${d.getFullYear()}-${d.getMonth()}`, idx))
    const buckets = startVentanas.map(d => ({
      mes: d.toLocaleDateString('es-CL', { month: 'short', year: '2-digit' }),
      ingresos: 0,
      mascotas: 0,
    }))
    const limiteIzq = startVentanas[0]
    for (const c of cremadosTodos) {
      const f = fechaCliente(c)
      if (!f || f < limiteIzq) continue
      const idx = ventanaIdx.get(`${f.getFullYear()}-${f.getMonth()}`)
      if (idx === undefined) continue
      buckets[idx].ingresos += ingresoCliente(c).total
      buckets[idx].mascotas += 1
    }
    const ventasPorMes = buckets

    // Top servicios + ventas por vet + por especie + pendientes pago — un solo loop sobre cremados
    const servicioCount: Record<string, number> = { CI: 0, CP: 0, SD: 0 }
    const ventasVet: Record<string, { vet: string; ingresos: number; mascotas: number }> = {}
    const especieCount: Record<string, number> = {}
    let pendientesPago = 0
    let montoPendientePago = 0
    for (const c of cremadosTodos) {
      const k = (c.codigo_servicio || 'CI').toUpperCase()
      servicioCount[k] = (servicioCount[k] || 0) + 1
      const e = c.especie || 'Sin especie'
      especieCount[e] = (especieCount[e] || 0) + 1
      const ingreso = ingresoCliente(c).total
      if (c.veterinaria_id) {
        const vetName = vetById[c.veterinaria_id]?.nombre ?? `Vet #${c.veterinaria_id}`
        if (!ventasVet[c.veterinaria_id]) ventasVet[c.veterinaria_id] = { vet: vetName, ingresos: 0, mascotas: 0 }
        ventasVet[c.veterinaria_id].ingresos += ingreso
        ventasVet[c.veterinaria_id].mascotas += 1
      }
      if (c.estado_pago !== 'pagado') {
        pendientesPago += 1
        montoPendientePago += ingreso
      }
    }
    const topServicios = Object.entries(servicioCount)
      .map(([codigo, count]) => ({ codigo, count }))
      .sort((a, b) => b.count - a.count)
    const ventasPorVet = Object.values(ventasVet).sort((a, b) => b.ingresos - a.ingresos).slice(0, 10)
    const porEspecie = Object.entries(especieCount)
      .map(([especie, count]) => ({ especie, count }))
      .sort((a, b) => b.count - a.count)

    // Top productos + top otros servicios — un solo loop sobre clientes (parsea adicionales 1 vez)
    const prodCount: Record<string, number> = {}
    const srvCount: Record<string, number> = {}
    for (const c of clientes) {
      const items = adicionalesDe(c)
      for (const i of items) {
        if (i.tipo === 'producto') prodCount[i.id] = (prodCount[i.id] || 0) + (i.qty ?? 1)
        else if (i.tipo === 'servicio') srvCount[i.id] = (srvCount[i.id] || 0) + (i.qty ?? 1)
      }
    }
    const topProductos = Object.entries(prodCount)
      .map(([id, qty]) => ({ nombre: productoNombre(id), qty }))
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 5)
    const topOtrosServicios = Object.entries(srvCount)
      .map(([id, qty]) => ({ nombre: servicioNombre(id), qty }))
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 5)

    return NextResponse.json({
      kpis: {
        cremaciones_mes: cremadosMes.length,
        pendientes,
        ciclos_mes: ciclosMes.length,
        litros_mes: litrosMes,
        ingresos_mes: ingresosMes,
        stock_petroleo: stock,
        stock_bajo: stock < 100,
        pendientes_pago: pendientesPago,
        monto_pendiente: montoPendientePago,
      },
      ratios: {
        ciclos_por_litro: ciclosPorLitro,
        litros_por_ciclo: litrosPorCiclo,
        litros_por_mascota: litrosPorMascota,
        costo_vehiculo_por_mascota: costoVehiculoPorMascota,
      },
      ventas_por_mes: ventasPorMes,
      top_servicios: topServicios,
      ventas_por_vet: ventasPorVet,
      top_productos: topProductos,
      top_otros_servicios: topOtrosServicios,
      por_especie: porEspecie,
    })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
