import { NextRequest, NextResponse } from 'next/server'
import { getSheetData } from '@/lib/datastore'
import { parseDecimalOr0, parsePeso } from '@/lib/numbers'
import { findTramo, precioDelTramo } from '@/lib/tramos'
import { crearResolverCremacion, parseFechaSegura } from '@/lib/cremaciones-mes'

type Tramo = {
  id: string; peso_min: string; peso_max: string
  precio_ci: string; precio_cp: string; precio_sd: string
  veterinaria_id?: string
}

const parseFecha = parseFechaSegura

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
      // Snapshot congelado al crear/editar la ficha → blinda el ingreso histórico
      // contra cambios en las tablas de precio (mismo criterio que el dashboard).
      const snap = parseDecimalOr0(c.precio_total)
      if (snap > 0) return snap
      // Fallback en vivo SOLO para fichas legacy sin snapshot guardado.
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
      const servicio = precioDelTramo(findTramo(tabla, peso), codigo)
      let adic = 0
      try {
        const items = JSON.parse(c.adicionales || '[]') as Array<{ precio?: number; qty?: number }>
        adic = items.reduce((s, a) => s + Math.max(0, a.precio ?? 0) * Math.max(0, a.qty ?? 1), 0)
      } catch { /* noop */ }
      return servicio + adic
    }

    const enMes = (raw: string) => {
      const d = parseFecha(raw)
      if (!d) return false
      return d.getMonth() + 1 === mes && d.getFullYear() === anio
    }

    // "Cuándo se cremó" vive en lib/cremaciones-mes: la misma definición la usan
    // el dashboard y Remuneraciones (donde el número de cremaciones del mes
    // define cuánto cobra cada operario).
    const fechaCliente = crearResolverCremacion(ciclos)

    const delMes = clientes.filter(c => {
      const d = fechaCliente(c)
      return d && d.getMonth() + 1 === mes && d.getFullYear() === anio
    })

    const ciclosDelMes = ciclos.filter(c => enMes(c.fecha))
    const cargasPetMes = cargasPet.filter(r => enMes(r.fecha))
    const cargasVehMes = cargasVeh.filter(r => enMes(r.fecha))

    // Cremados: incluye también despachados (todos pasaron por un ciclo de cremación)
    const cremados = delMes.filter(c => c.estado === 'cremado' || c.estado === 'despachado')
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

    // ── Evolución de los últimos 12 meses ─────────────────────────────────────
    // Termina en el mes SELECCIONADO, y usa exactamente los mismos criterios que
    // los KPI de arriba (fecha de cremación para las mascotas, fecha del ciclo
    // para ciclos/litros): así el último punto de la serie es el número de la
    // tarjeta. No se incluyen "En cámara", "Pagos pendientes" ni "Monto por
    // cobrar": son fotos de HOY, no del mes, y no son reconstruibles hacia atrás.
    const meses: Array<{ key: string; label: string }> = []
    const idxDeMes = new Map<string, number>()
    for (let i = 11; i >= 0; i--) {
      const d = new Date(anio, mes - 1 - i, 1)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      idxDeMes.set(key, meses.length)
      meses.push({ key, label: d.toLocaleDateString('es-CL', { month: 'short', year: '2-digit' }) })
    }
    const bucketDeFecha = (d: Date | null): number | null => {
      if (!d) return null
      const i = idxDeMes.get(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
      return i === undefined ? null : i
    }
    const bucketDe = (raw: string) => bucketDeFecha(parseFecha(raw))

    const serie = meses.map(m => ({
      mes: m.label,
      ingresos_clientes_mes: 0, total_cremaciones_mes: 0, ciclos_mes: 0,
      litros_mes: 0, litros_cargados_mes: 0, costo_petroleo_mes: 0,
      costo_vehiculo_mes: 0, ingresos_mes: 0,
      litros_por_mascota: 0, litros_por_ciclo: 0, costo_vehiculo_por_mascota: 0,
    }))

    for (const c of clientes) {
      const i = bucketDeFecha(fechaCliente(c))
      if (i == null) continue
      serie[i].ingresos_clientes_mes += 1
      if (c.estado === 'cremado' || c.estado === 'despachado') {
        serie[i].total_cremaciones_mes += 1
        serie[i].ingresos_mes += ingresoCliente(c)
      }
    }
    for (const c of ciclos) {
      const i = bucketDe(c.fecha)
      if (i == null) continue
      serie[i].ciclos_mes += 1
      serie[i].litros_mes += Math.abs(parseDecimalOr0(c.litros_fin) - parseDecimalOr0(c.litros_inicio))
    }
    for (const r of cargasPet) {
      const i = bucketDe(r.fecha)
      if (i == null) continue
      serie[i].litros_cargados_mes += parseDecimalOr0(r.litros)
      serie[i].costo_petroleo_mes += parseDecimalOr0(r.total_bruto)
    }
    for (const r of cargasVeh) {
      const i = bucketDe(r.fecha)
      if (i == null) continue
      serie[i].costo_vehiculo_mes += parseDecimalOr0(r.monto) * parseDecimalOr0(r.litros)
    }
    for (const f of serie) {
      f.litros_mes = Math.round(f.litros_mes * 10) / 10
      f.litros_por_mascota = f.ingresos_clientes_mes > 0 ? f.litros_mes / f.ingresos_clientes_mes : 0
      f.litros_por_ciclo = f.ciclos_mes > 0 ? f.litros_mes / f.ciclos_mes : 0
      f.costo_vehiculo_por_mascota = f.ingresos_clientes_mes > 0 ? f.costo_vehiculo_mes / f.ingresos_clientes_mes : 0
    }

    return NextResponse.json({
      serie_12m: serie,
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
