import { NextRequest, NextResponse } from 'next/server'
import { getSheetData } from '@/lib/google-sheets'
import { calcularPrecio } from '@/lib/price-calculator'

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const mes = parseInt(searchParams.get('mes') ?? String(new Date().getMonth() + 1))
    const anio = parseInt(searchParams.get('anio') ?? String(new Date().getFullYear()))

    const [clientes, ciclos, productos] = await Promise.all([
      getSheetData('clientes'),
      getSheetData('ciclos'),
      getSheetData('productos'),
    ])

    const delMes = clientes.filter((c) => {
      const d = new Date(c.fecha_creacion)
      return d.getMonth() + 1 === mes && d.getFullYear() === anio
    })

    const ciclosDelMes = ciclos.filter((c) => {
      const d = new Date(c.fecha)
      return d.getMonth() + 1 === mes && d.getFullYear() === anio
    })

    // KPIs
    const cremados = delMes.filter((c) => c.estado === 'cremado')
    const pendientes = clientes.filter((c) => c.estado === 'pendiente').length
    const litros = ciclosDelMes.reduce(
      (acc, c) => acc + (parseFloat(c.litros_fin) - parseFloat(c.litros_inicio)),
      0
    )

    // Ingresos estimados
    const precios = await Promise.all(
      cremados.map((c) => calcularPrecio(parseFloat(c.peso_kg), c.codigo_servicio, 'general'))
    )
    const ingresos = precios.reduce((s, p) => s + p, 0)

    // Por especie
    const porEspecie: Record<string, number> = {}
    delMes.forEach((c) => {
      porEspecie[c.especie] = (porEspecie[c.especie] || 0) + 1
    })

    // Por tipo de servicio
    const porTipo: Record<string, number> = {}
    delMes.forEach((c) => {
      porTipo[c.codigo_servicio] = (porTipo[c.codigo_servicio] || 0) + 1
    })

    return NextResponse.json({
      kpis: {
        total_cremaciones_mes: cremados.length,
        pendientes,
        ciclos_mes: ciclosDelMes.length,
        litros_mes: Math.round(litros * 10) / 10,
        ingresos_mes: ingresos,
      },
      por_especie: porEspecie,
      por_tipo: porTipo,
      ciclos: ciclosDelMes,
      productos: productos.filter((p) => p.activo === 'TRUE'),
    })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
