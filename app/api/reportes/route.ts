import { NextRequest, NextResponse } from 'next/server'
import { getSheetData } from '@/lib/google-sheets'
import { formatDateForSheet } from '@/lib/dates'
import { parseDecimalOr0, parsePeso } from '@/lib/numbers'

type Tramo = {
  id: string; peso_min: string; peso_max: string
  precio_ci: string; precio_cp: string; precio_sd: string
  veterinaria_id?: string
}

function parseFecha(raw: string): Date | null {
  if (!raw) return null
  const iso = formatDateForSheet(raw)
  if (!iso) return null
  const d = new Date(`${iso}T12:00:00`)
  return isNaN(d.getTime()) ? null : d
}

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

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const mes = parseInt(searchParams.get('mes') ?? String(new Date().getMonth() + 1))
    const anio = parseInt(searchParams.get('anio') ?? String(new Date().getFullYear()))

    const safe = (name: string) => getSheetData(name).catch(() => [] as Record<string, string>[])
    const [clientes, ciclos, productos, cargasPet, cargasVeh, vets, preciosGRaw, preciosCRaw, preciosERaw] = await Promise.all([
      safe('clientes'),
      safe('ciclos'),
      safe('productos'),
      safe('cargas_petroleo'),
      safe('vehiculo_cargas'),
      safe('veterinarios'),
      safe('precios_generales'),
      safe('precios_convenio'),
      safe('precios_especiales'),
    ])
    const preciosG = preciosGRaw as unknown as Tramo[]
    const preciosC = preciosCRaw as unknown as Tramo[]
    const preciosE = preciosERaw as unknown as Tramo[]

    const vetById: Record<string, Record<string, string>> = {}
    vets.forEach(v => { vetById[v.id] = v })

    const preciosEByVet = new Map<string, Tramo[]>()
    for (const t of preciosE) {
      const vid = t.veterinaria_id ?? ''
      const arr = preciosEByVet.get(vid) ?? []
      arr.push(t)
      preciosEByVet.set(vid, arr)
    }

    const ingresoCliente = (c: Record<string, string>): number => {
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
      return precioTramo(tramo, codigo)
    }

    const enMes = (raw: string) => {
      const d = parseFecha(raw)
      if (!d) return false
      return d.getMonth() + 1 === mes && d.getFullYear() === anio
    }

    const cicloById = new Map(ciclos.map(c => [c.id, c]))
    const fechaCliente = (c: Record<string, string>): Date | null => {
      if (c.estado === 'cremado' && c.ciclo_id) {
        const ciclo = cicloById.get(c.ciclo_id)
        if (ciclo?.fecha) {
          const d = parseFecha(ciclo.fecha)
          if (d) return d
        }
      }
      return parseFecha(c.fecha_retiro || c.fecha_creacion)
    }

    const delMes = clientes.filter(c => {
      const d = fechaCliente(c)
      return d && d.getMonth() + 1 === mes && d.getFullYear() === anio
    })

    const ciclosDelMes = ciclos.filter(c => enMes(c.fecha))
    const cargasPetMes = cargasPet.filter(r => enMes(r.fecha))
    const cargasVehMes = cargasVeh.filter(r => enMes(r.fecha))

    const cremados = delMes.filter(c => c.estado === 'cremado')
    const pendientes = clientes.filter(c => c.estado === 'pendiente' || !c.estado).length
    const litros = ciclosDelMes.reduce(
      (acc, c) => acc + Math.abs(parseDecimalOr0(c.litros_fin) - parseDecimalOr0(c.litros_inicio)),
      0
    )
    const litrosCargadosMes = cargasPetMes.reduce((s, r) => s + parseDecimalOr0(r.litros), 0)
    const costoPetroleoMes = cargasPetMes.reduce((s, r) => s + parseDecimalOr0(r.total_bruto), 0)
    // monto = precio por litro → costo total = monto × litros
    const costoVehiculoMes = cargasVehMes.reduce((s, r) => s + parseDecimalOr0(r.monto) * parseDecimalOr0(r.litros), 0)
    const litrosVehiculoMes = cargasVehMes.reduce((s, r) => s + parseDecimalOr0(r.litros), 0)

    const ingresos = cremados.reduce((s, c) => s + ingresoCliente(c), 0)

    let pendientesPago = 0
    let montoPendiente = 0
    for (const c of clientes) {
      if (c.estado_pago !== 'pagado') {
        pendientesPago += 1
        montoPendiente += ingresoCliente(c)
      }
    }

    const porEspecie: Record<string, number> = {}
    delMes.forEach(c => {
      porEspecie[c.especie || 'Sin especie'] = (porEspecie[c.especie || 'Sin especie'] || 0) + 1
    })
    const porTipo: Record<string, number> = {}
    delMes.forEach(c => {
      porTipo[c.codigo_servicio || 'CI'] = (porTipo[c.codigo_servicio || 'CI'] || 0) + 1
    })
    const porEstado: Record<string, number> = {}
    delMes.forEach(c => {
      const e = c.estado || 'pendiente'
      porEstado[e] = (porEstado[e] || 0) + 1
    })

    const ratioLitrosPorMascota = delMes.length > 0 ? litros / delMes.length : 0
    const ratioLitrosPorCiclo = ciclosDelMes.length > 0 ? litros / ciclosDelMes.length : 0
    const ratioCostoVehPorMascota = delMes.length > 0 ? costoVehiculoMes / delMes.length : 0

    const ciclosEnriquecidos = ciclosDelMes.map(c => {
      const consumo = Math.abs(parseDecimalOr0(c.litros_fin) - parseDecimalOr0(c.litros_inicio))
      const ids = (() => {
        try { return JSON.parse(c.mascotas_ids || '[]') as string[] } catch { return [] }
      })()
      let pesoTotal = parseDecimalOr0(c.peso_total)
      if (pesoTotal === 0 && ids.length > 0) {
        for (const cid of ids) {
          const cli = clientes.find(cl => cl.id === cid)
          if (cli) pesoTotal += parsePeso(cli.peso_ingreso) || parsePeso(cli.peso_declarado)
        }
      }
      const ltKg = pesoTotal > 0 ? consumo / pesoTotal : 0
      return {
        id: c.id,
        fecha: c.fecha,
        numero_ciclo: c.numero_ciclo,
        litros_inicio: c.litros_inicio,
        litros_fin: c.litros_fin,
        consumo,
        mascotas_ids: ids,
        peso_total: pesoTotal,
        lt_kg: ltKg,
      }
    })

    return NextResponse.json({
      kpis: {
        total_cremaciones_mes: cremados.length,
        ingresos_clientes_mes: delMes.length,
        pendientes,
        ciclos_mes: ciclosDelMes.length,
        litros_mes: Math.round(litros * 10) / 10,
        ingresos_mes: ingresos,
        litros_cargados_mes: litrosCargadosMes,
        costo_petroleo_mes: costoPetroleoMes,
        costo_vehiculo_mes: costoVehiculoMes,
        litros_vehiculo_mes: litrosVehiculoMes,
        pendientes_pago: pendientesPago,
        monto_pendiente: montoPendiente,
      },
      ratios: {
        litros_por_mascota: ratioLitrosPorMascota,
        litros_por_ciclo: ratioLitrosPorCiclo,
        costo_vehiculo_por_mascota: ratioCostoVehPorMascota,
      },
      por_especie: porEspecie,
      por_tipo: porTipo,
      por_estado: porEstado,
      ciclos: ciclosEnriquecidos,
      productos: productos.filter(p => p.activo === 'TRUE'),
    })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
