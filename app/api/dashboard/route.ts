import { NextResponse } from 'next/server'
import { getSheetData } from '@/lib/google-sheets'

type Tramo = { id: string; peso_min: string; peso_max: string; precio_ci: string; precio_cp: string; precio_sd: string; veterinaria_id?: string }
type AdicionalItem = { tipo: string; id: string; nombre?: string; precio?: number; qty?: number }

function findTramo(tabla: Tramo[], pesoKg: number): Tramo | null {
  if (!tabla.length || !isFinite(pesoKg) || pesoKg <= 0) return null
  const maxMin = Math.max(...tabla.map(t => parseFloat(t.peso_min) || 0))
  const top = tabla.find(t => (parseFloat(t.peso_min) || 0) === maxMin)
  if (top && pesoKg >= maxMin) return top
  return tabla.find(t => {
    const min = parseFloat(t.peso_min) || 0
    const max = parseFloat(t.peso_max) || 0
    return pesoKg >= min && pesoKg <= max
  }) ?? null
}

function precioTramo(tramo: Tramo | null, codigo: string): number {
  if (!tramo) return 0
  const raw = codigo === 'CP' ? tramo.precio_cp : codigo === 'SD' ? tramo.precio_sd : tramo.precio_ci
  return parseFloat(raw) || 0
}

export async function GET() {
  try {
    const safe = (name: string) => getSheetData(name).catch(() => [] as Record<string, string>[])
    const [clientes, ciclos, cargas, vets, preciosGRaw, preciosCRaw, preciosERaw, productos, otrosSrv] = await Promise.all([
      safe('clientes'),
      safe('ciclos'),
      safe('cargas_petroleo'),
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

    const productoNombre = (pid: string) => productos.find(p => p.id === pid)?.nombre ?? `prod:${pid}`
    const servicioNombre = (sid: string) => otrosSrv.find(s => s.id === sid)?.nombre ?? `srv:${sid}`

    const now = new Date()
    const mesActual = now.getMonth()
    const anioActual = now.getFullYear()
    const startMesActual = new Date(anioActual, mesActual, 1)
    startMesActual.setHours(0, 0, 0, 0)

    function fechaCliente(c: Record<string, string>): Date | null {
      const raw = c.fecha_retiro || c.fecha_creacion
      if (!raw) return null
      const d = new Date(raw)
      return isNaN(d.getTime()) ? null : d
    }

    // Cálculo de ingreso por cliente
    function ingresoCliente(c: Record<string, string>): { total: number; servicio: number; adicionales: number; adicionalesItems: AdicionalItem[] } {
      const peso = parseFloat(c.peso_kg) || 0
      const codigo = c.codigo_servicio || 'CI'
      let tabla: Tramo[] = preciosG
      const explicit = c.tipo_precios
      if (explicit === 'convenio') tabla = preciosC
      else if (explicit === 'especial') tabla = preciosE.filter(t => t.veterinaria_id === c.veterinaria_id)
      else if (explicit === 'general') tabla = preciosG
      else if (c.veterinaria_id) {
        const vet = vetById[c.veterinaria_id]
        if (vet?.tipo_precios === 'precios_especiales') tabla = preciosE.filter(t => t.veterinaria_id === c.veterinaria_id)
        else tabla = preciosC
      }
      const tramo = findTramo(tabla, peso)
      const servicio = precioTramo(tramo, codigo)
      let adicionalesItems: AdicionalItem[] = []
      try { adicionalesItems = JSON.parse(c.adicionales || '[]') } catch { /* empty */ }
      const adicionales = adicionalesItems.reduce((s, a) => s + (a.precio ?? 0) * (a.qty ?? 1), 0)
      return { total: servicio + adicionales, servicio, adicionales, adicionalesItems }
    }

    // Stock petróleo
    const totalCargado = cargas.reduce((s, r) => s + (parseFloat(r.litros) || 0), 0)
    const totalConsumido = ciclos.reduce((s, c) => {
      const ini = parseFloat(c.litros_inicio) || 0
      const fin = parseFloat(c.litros_fin) || 0
      return s + Math.max(0, fin - ini)
    }, 0)
    const stock = totalCargado - totalConsumido

    // Mes actual
    const cremadosMes = clientes.filter(c => c.estado === 'cremado' && (() => {
      const f = fechaCliente(c)
      return f && f >= startMesActual && f <= now
    })())
    const ciclosMes = ciclos.filter(c => {
      const f = c.fecha ? new Date(c.fecha) : null
      return f && !isNaN(f.getTime()) && f >= startMesActual && f <= now
    })
    const litrosMes = ciclosMes.reduce((s, c) => s + Math.max(0, (parseFloat(c.litros_fin) || 0) - (parseFloat(c.litros_inicio) || 0)), 0)
    const pendientes = clientes.filter(c => c.estado !== 'cremado').length

    const ingresosMes = cremadosMes.reduce((s, c) => s + ingresoCliente(c).total, 0)

    // Ratios
    const mascotasTotalCremadas = clientes.filter(c => c.estado === 'cremado').length
    const mascotasPorLitro = totalConsumido > 0 ? mascotasTotalCremadas / totalConsumido : 0
    const ciclosPorLitro = totalConsumido > 0 ? ciclos.length / totalConsumido : 0
    const litrosPorCiclo = ciclos.length > 0 ? totalConsumido / ciclos.length : 0
    const litrosPorMascota = mascotasTotalCremadas > 0 ? totalConsumido / mascotasTotalCremadas : 0

    // Ventas últimos 12 meses
    const ventasPorMes: Array<{ mes: string; ingresos: number; mascotas: number }> = []
    for (let i = 11; i >= 0; i--) {
      const d = new Date(anioActual, mesActual - i, 1)
      const start = new Date(d.getFullYear(), d.getMonth(), 1)
      const end = new Date(d.getFullYear(), d.getMonth() + 1, 1)
      const cremadosEnMes = clientes.filter(c => {
        if (c.estado !== 'cremado') return false
        const f = fechaCliente(c)
        return f && f >= start && f < end
      })
      const ingresos = cremadosEnMes.reduce((s, c) => s + ingresoCliente(c).total, 0)
      ventasPorMes.push({
        mes: d.toLocaleDateString('es-CL', { month: 'short', year: '2-digit' }),
        ingresos,
        mascotas: cremadosEnMes.length,
      })
    }

    // Top servicios
    const servicioCount: Record<string, number> = { CI: 0, CP: 0, SD: 0 }
    clientes.filter(c => c.estado === 'cremado').forEach(c => {
      const k = (c.codigo_servicio || 'CI').toUpperCase()
      servicioCount[k] = (servicioCount[k] || 0) + 1
    })
    const topServicios = Object.entries(servicioCount)
      .map(([codigo, count]) => ({ codigo, count }))
      .sort((a, b) => b.count - a.count)

    // Ventas por veterinaria
    const ventasVet: Record<string, { vet: string; ingresos: number; mascotas: number }> = {}
    clientes.filter(c => c.estado === 'cremado' && c.veterinaria_id).forEach(c => {
      const vetName = vetById[c.veterinaria_id]?.nombre ?? `Vet #${c.veterinaria_id}`
      if (!ventasVet[c.veterinaria_id]) ventasVet[c.veterinaria_id] = { vet: vetName, ingresos: 0, mascotas: 0 }
      ventasVet[c.veterinaria_id].ingresos += ingresoCliente(c).total
      ventasVet[c.veterinaria_id].mascotas += 1
    })
    const ventasPorVet = Object.values(ventasVet).sort((a, b) => b.ingresos - a.ingresos).slice(0, 10)

    // Top productos
    const prodCount: Record<string, number> = {}
    clientes.forEach(c => {
      try {
        const items: AdicionalItem[] = JSON.parse(c.adicionales || '[]')
        items.filter(i => i.tipo === 'producto').forEach(i => {
          prodCount[i.id] = (prodCount[i.id] || 0) + (i.qty ?? 1)
        })
      } catch { /* empty */ }
    })
    const topProductos = Object.entries(prodCount)
      .map(([id, qty]) => ({ nombre: productoNombre(id), qty }))
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 5)

    // Top otros servicios
    const srvCount: Record<string, number> = {}
    clientes.forEach(c => {
      try {
        const items: AdicionalItem[] = JSON.parse(c.adicionales || '[]')
        items.filter(i => i.tipo === 'servicio').forEach(i => {
          srvCount[i.id] = (srvCount[i.id] || 0) + (i.qty ?? 1)
        })
      } catch { /* empty */ }
    })
    const topOtrosServicios = Object.entries(srvCount)
      .map(([id, qty]) => ({ nombre: servicioNombre(id), qty }))
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 5)

    // Por especie
    const especieCount: Record<string, number> = {}
    clientes.filter(c => c.estado === 'cremado').forEach(c => {
      const e = c.especie || 'Sin especie'
      especieCount[e] = (especieCount[e] || 0) + 1
    })
    const porEspecie = Object.entries(especieCount)
      .map(([especie, count]) => ({ especie, count }))
      .sort((a, b) => b.count - a.count)

    // Pagos pendientes
    const pendientesPago = clientes.filter(c => c.estado === 'cremado' && c.estado_pago !== 'pagado').length
    const montoPendientePago = clientes
      .filter(c => c.estado === 'cremado' && c.estado_pago !== 'pagado')
      .reduce((s, c) => s + ingresoCliente(c).total, 0)

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
        mascotas_por_litro: mascotasPorLitro,
        ciclos_por_litro: ciclosPorLitro,
        litros_por_ciclo: litrosPorCiclo,
        litros_por_mascota: litrosPorMascota,
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
