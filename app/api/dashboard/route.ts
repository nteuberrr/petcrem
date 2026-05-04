import { NextResponse } from 'next/server'
import { getSheetData } from '@/lib/google-sheets'
import { formatDateForSheet, horaToMinutos } from '@/lib/dates'
import { parseDecimalOr0, parsePeso, parseMonto } from '@/lib/numbers'

export const dynamic = 'force-dynamic'

type Tramo = { id: string; peso_min: string; peso_max: string; precio_ci: string; precio_cp: string; precio_sd: string; veterinaria_id?: string }
type AdicionalItem = { tipo: string; id: string; nombre?: string; precio?: number; qty?: number }

function findTramo(tabla: Tramo[], pesoKg: number): Tramo | null {
  if (!tabla.length || !isFinite(pesoKg) || pesoKg <= 0) return null
  let maxMin = -Infinity
  let top: Tramo | null = null
  for (const t of tabla) {
    const min = parseDecimalOr0(t.peso_min)
    const max = parseDecimalOr0(t.peso_max)
    if (min > maxMin) { maxMin = min; top = t }
    if (pesoKg >= min && pesoKg <= max) return t
  }
  if (top && pesoKg >= maxMin) return top
  return null
}

function precioTramo(tramo: Tramo | null, codigo: string): number {
  if (!tramo) return 0
  const raw = codigo === 'CP' ? tramo.precio_cp : codigo === 'SD' ? tramo.precio_sd : tramo.precio_ci
  return parseDecimalOr0(raw)
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

    // Caches de fechas por cliente (parseo una sola vez).
    //
    // Dos drivers distintos según la métrica:
    // - fechaVenta:     fecha_retiro (cuando se cobra e inicia el ciclo de venta)
    //                   → ingresos, mascotas del mes, costo vehículo / mascota
    // - fechaCremacion: fecha del ciclo asociado (cuando se ejecutó la cremación)
    //                   → mascotas cremadas por mes, litros / mascota
    const cicloById = new Map(ciclos.map(c => [c.id, c]))
    const fechaVentaCache = new Map<string, Date | null>()
    const fechaCremacionCache = new Map<string, Date | null>()

    function parseDateSafe(raw: string): Date | null {
      if (!raw) return null
      const iso = formatDateForSheet(raw) // maneja serial Excel + ISO + DD/MM/YYYY
      if (!iso) return null
      const d = new Date(`${iso}T12:00:00`) // mediodía local para evitar UTC shift
      return isNaN(d.getTime()) ? null : d
    }

    function fechaVenta(c: Record<string, string>): Date | null {
      const cached = fechaVentaCache.get(c.id)
      if (cached !== undefined) return cached
      const d = parseDateSafe(c.fecha_retiro || c.fecha_creacion)
      fechaVentaCache.set(c.id, d)
      return d
    }

    function fechaCremacion(c: Record<string, string>): Date | null {
      const cached = fechaCremacionCache.get(c.id)
      if (cached !== undefined) return cached
      let d: Date | null = null
      if (c.estado === 'cremado' && c.ciclo_id) {
        const ciclo = cicloById.get(c.ciclo_id)
        if (ciclo?.fecha) d = parseDateSafe(ciclo.fecha)
      }
      // Fallback: fecha_retiro (para cremados sin ciclo válido)
      if (!d) d = parseDateSafe(c.fecha_retiro || c.fecha_creacion)
      fechaCremacionCache.set(c.id, d)
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
      // Driver: peso_ingreso (real) tiene prioridad. Fallback a peso_declarado si aún no fue pesada.
      // parsePeso normaliza escalamiento heredado de Sheets es-CL (ej. 12500 → 12.5).
      const peso = parsePeso(c.peso_ingreso) || parsePeso(c.peso_declarado)
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
    const totalCargado = cargas.reduce((s, r) => s + parseDecimalOr0(r.litros), 0)
    const totalConsumido = ciclos.reduce((s, c) => {
      const ini = parseDecimalOr0(c.litros_inicio)
      const fin = parseDecimalOr0(c.litros_fin)
      return s + Math.abs(fin - ini)
    }, 0)
    const stock = totalCargado - totalConsumido

    // Costo total de combustible del vehículo: monto (precio/litro) × litros, por carga.
    const totalMontoVehiculo = cargasVehiculo.reduce((s, r) => {
      const lt = parseDecimalOr0(r.litros)
      const precioLt = parseMonto(r.monto)
      return s + precioLt * lt
    }, 0)

    // Filtros base — calculados una sola vez
    const cremadosTodos = clientes.filter(c => c.estado === 'cremado')
    // Cremaciones del mes: driver fecha del ciclo
    const cremadosMes = cremadosTodos.filter(c => {
      const f = fechaCremacion(c)
      return f && f >= startMesActual && f <= now
    })
    // Ingresos del mes: driver fecha_retiro (cuando se cobra)
    const ingresoClientesMes = clientes.filter(c => {
      const f = fechaVenta(c)
      return f && f >= startMesActual && f <= now
    })
    const ciclosMes = ciclos.filter(c => {
      const f = parseDateSafe(c.fecha)
      return f && f >= startMesActual && f <= now
    })
    const litrosMes = ciclosMes.reduce((s, c) => s + Math.abs(parseDecimalOr0(c.litros_fin) - parseDecimalOr0(c.litros_inicio)), 0)
    // "Pendientes" = pendientes de cremación (en cámara). Mismo criterio que TimelineStatus.
    // Estado vacío también cuenta como pendiente (mascotas viejas sin estado seteado).
    const pendientes = clientes.filter(c => c.estado === 'pendiente' || !c.estado).length

    // Ingresos del mes: suma todos los clientes (cremados o no) cuya fecha_retiro cae en el mes
    const ingresosMes = ingresoClientesMes.reduce((s, c) => s + ingresoCliente(c).total, 0)

    // Ratios — driver: "mascotas" = total de mascotas ingresadas (todas), no solo cremadas
    const mascotasTotal = clientes.length
    const litrosPorCiclo = ciclos.length > 0 ? totalConsumido / ciclos.length : 0
    const litrosPorMascota = mascotasTotal > 0 ? totalConsumido / mascotasTotal : 0
    const costoVehiculoPorMascota = mascotasTotal > 0 ? totalMontoVehiculo / mascotasTotal : 0

    // Duración promedio del ciclo (minutos): solo ciclos con ambas horas válidas
    let sumDuracion = 0
    let countDuracion = 0
    for (const c of ciclos) {
      const ini = horaToMinutos(c.hora_inicio)
      const fin = horaToMinutos(c.hora_fin)
      if (ini === null || fin === null) continue
      const dur = fin - ini
      if (dur > 0 && dur < 24 * 60) {  // descartar valores absurdos (>24h)
        sumDuracion += dur
        countDuracion += 1
      }
    }
    const duracionPromedioCicloMin = countDuracion > 0 ? sumDuracion / countDuracion : 0

    // Rango adaptativo: desde el mes más antiguo con actividad (o últimos 12 meses si hay menos),
    // hasta el mes actual. Cap superior de 24 meses para no inflar el chart.
    function mesKeyOf(d: Date): { y: number; m: number } {
      return { y: d.getFullYear(), m: d.getMonth() }
    }
    const fechasRelevantes: Date[] = []
    for (const c of clientes) {
      const f = fechaVenta(c)
      if (f) fechasRelevantes.push(f)
    }
    for (const c of cremadosTodos) {
      const f = fechaCremacion(c)
      if (f) fechasRelevantes.push(f)
    }
    for (const c of ciclos) {
      const f = parseDateSafe(c.fecha)
      if (f) fechasRelevantes.push(f)
    }
    for (const r of cargasVehiculo) {
      const f = parseDateSafe(r.fecha)
      if (f) fechasRelevantes.push(f)
    }
    for (const r of cargas) {
      const f = parseDateSafe(r.fecha)
      if (f) fechasRelevantes.push(f)
    }
    const masAntigua = fechasRelevantes.length > 0
      ? new Date(Math.min(...fechasRelevantes.map(d => d.getTime())))
      : new Date(anioActual, mesActual - 11, 1)

    // Default mínimo: 12 meses; cap máximo: 24 meses
    const startMin = new Date(anioActual, mesActual - 11, 1)
    const startCap = new Date(anioActual, mesActual - 23, 1)
    let startEffective = new Date(masAntigua.getFullYear(), masAntigua.getMonth(), 1)
    if (startEffective > startMin) startEffective = startMin
    if (startEffective < startCap) startEffective = startCap

    // Generar buckets desde startEffective hasta mesActual (inclusivo)
    const startVentanas: Date[] = []
    let cursor = new Date(startEffective)
    const endDate = new Date(anioActual, mesActual, 1)
    while (cursor <= endDate) {
      startVentanas.push(new Date(cursor))
      cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1)
    }
    const ventanaIdx = new Map<string, number>() // key "yyyy-mm" → bucket index
    startVentanas.forEach((d, idx) => ventanaIdx.set(`${d.getFullYear()}-${d.getMonth()}`, idx))
    const buckets = startVentanas.map(d => ({
      mes: d.toLocaleDateString('es-CL', { month: 'short', year: '2-digit' }),
      ingresos: 0,
      mascotas: 0,
    }))
    const limiteIzq = startVentanas[0]
    // Ingresos mensuales: driver fecha_retiro (TODOS los clientes con fecha de retiro en el mes)
    for (const c of clientes) {
      const f = fechaVenta(c)
      if (!f || f < limiteIzq) continue
      const idx = ventanaIdx.get(`${f.getFullYear()}-${f.getMonth()}`)
      if (idx === undefined) continue
      buckets[idx].ingresos += ingresoCliente(c).total
    }
    // Mascotas cremadas por mes: driver fecha del ciclo (solo cremados)
    for (const c of cremadosTodos) {
      const f = fechaCremacion(c)
      if (!f || f < limiteIzq) continue
      const idx = ventanaIdx.get(`${f.getFullYear()}-${f.getMonth()}`)
      if (idx === undefined) continue
      buckets[idx].mascotas += 1
    }
    const ventasPorMes = buckets

    // Series temporales por ratio — últimos 12 meses
    // Notar: dos drivers distintos para "mascotas":
    // - mascotas_cremadas (por fecha del ciclo) → para litros/mascota
    // - mascotas_retiradas (por fecha_retiro)   → para costo_vehiculo/mascota
    type RBucket = {
      mes: string; litros: number; ciclos: number;
      mascotas_cremadas: number; mascotas_retiradas: number;
      monto_vehiculo: number; sum_duracion: number; count_duracion: number;
    }
    const rBuckets: RBucket[] = startVentanas.map(d => ({
      mes: d.toLocaleDateString('es-CL', { month: 'short', year: '2-digit' }),
      litros: 0, ciclos: 0, mascotas_cremadas: 0, mascotas_retiradas: 0,
      monto_vehiculo: 0, sum_duracion: 0, count_duracion: 0,
    }))
    // Litros consumidos + ciclos del mes (por fecha del ciclo)
    for (const c of ciclos) {
      const iso = c.fecha ? formatDateForSheet(c.fecha) : ''
      if (!iso) continue
      const f = new Date(`${iso}T12:00:00`)
      if (isNaN(f.getTime()) || f < limiteIzq) continue
      const idx = ventanaIdx.get(`${f.getFullYear()}-${f.getMonth()}`)
      if (idx === undefined) continue
      const ini = parseDecimalOr0(c.litros_inicio)
      const fin = parseDecimalOr0(c.litros_fin)
      rBuckets[idx].litros += Math.abs(fin - ini)
      rBuckets[idx].ciclos += 1
      // Duración del ciclo
      const hi = horaToMinutos(c.hora_inicio)
      const hf = horaToMinutos(c.hora_fin)
      if (hi !== null && hf !== null) {
        const dur = hf - hi
        if (dur > 0 && dur < 24 * 60) {
          rBuckets[idx].sum_duracion += dur
          rBuckets[idx].count_duracion += 1
        }
      }
    }
    // Mascotas cremadas en el mes (driver: fecha del ciclo) — usado para litros/mascota
    for (const c of cremadosTodos) {
      const f = fechaCremacion(c)
      if (!f || f < limiteIzq) continue
      const idx = ventanaIdx.get(`${f.getFullYear()}-${f.getMonth()}`)
      if (idx === undefined) continue
      rBuckets[idx].mascotas_cremadas += 1
    }
    // Mascotas retiradas en el mes (driver: fecha_retiro) — usado para costo_vehiculo/mascota
    for (const c of clientes) {
      const f = fechaVenta(c)
      if (!f || f < limiteIzq) continue
      const idx = ventanaIdx.get(`${f.getFullYear()}-${f.getMonth()}`)
      if (idx === undefined) continue
      rBuckets[idx].mascotas_retiradas += 1
    }
    // Monto vehículo del mes
    for (const r of cargasVehiculo) {
      const iso = r.fecha ? formatDateForSheet(r.fecha) : ''
      if (!iso) continue
      const f = new Date(`${iso}T12:00:00`)
      if (isNaN(f.getTime()) || f < limiteIzq) continue
      const idx = ventanaIdx.get(`${f.getFullYear()}-${f.getMonth()}`)
      if (idx === undefined) continue
      // monto = precio por litro → costo total = monto × litros
      rBuckets[idx].monto_vehiculo += parseMonto(r.monto) * parseDecimalOr0(r.litros)
    }
    const ratiosPorMes = rBuckets.map(b => ({
      mes: b.mes,
      litros_por_mascota: b.mascotas_cremadas > 0 ? b.litros / b.mascotas_cremadas : 0,
      litros_por_ciclo: b.ciclos > 0 ? b.litros / b.ciclos : 0,
      costo_vehiculo_por_mascota: b.mascotas_retiradas > 0 ? b.monto_vehiculo / b.mascotas_retiradas : 0,
      duracion_promedio_ciclo_min: b.count_duracion > 0 ? b.sum_duracion / b.count_duracion : 0,
    }))

    // Top servicios + ventas por vet + por especie — un solo loop sobre cremados
    const servicioCount: Record<string, number> = { CI: 0, CP: 0, SD: 0 }
    const ventasVet: Record<string, { vet: string; ingresos: number; mascotas: number }> = {}
    const especieCount: Record<string, number> = {}
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
    }

    // Pendientes de pago: TODOS los clientes (no solo cremados) con estado_pago != 'pagado'
    let pendientesPago = 0
    let montoPendientePago = 0
    for (const c of clientes) {
      if (c.estado_pago !== 'pagado') {
        pendientesPago += 1
        montoPendientePago += ingresoCliente(c).total
      }
    }

    // Mascotas del mes: ingresadas en el mes según fecha_retiro (mismo driver que sección clientes)
    const mascotasMes = clientes.filter(c => {
      const f = parseDateSafe(c.fecha_retiro || c.fecha_creacion)
      return f && f >= startMesActual && f <= now
    }).length
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
        mascotas_total: mascotasTotal,
        mascotas_mes: mascotasMes,
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
        litros_por_ciclo: litrosPorCiclo,
        litros_por_mascota: litrosPorMascota,
        costo_vehiculo_por_mascota: costoVehiculoPorMascota,
        duracion_promedio_ciclo_min: duracionPromedioCicloMin,
      },
      ratios_por_mes: ratiosPorMes,
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
