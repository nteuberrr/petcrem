import { NextResponse } from 'next/server'
import { getSheetData } from '@/lib/google-sheets'

export async function GET() {
  try {
    const [vets, preciosG, preciosC, preciosE, productos, clientes] = await Promise.all([
      getSheetData('veterinarios'),
      getSheetData('precios_generales'),
      getSheetData('precios_convenio'),
      getSheetData('precios_especiales').catch(() => []),
      getSheetData('productos'),
      getSheetData('clientes'),
    ])

    const vetsActivos = vets.filter(v => v.activo === 'TRUE')

    // Count product and service sales from adicionales
    const productSales: Record<string, number> = {}
    clientes.forEach(c => {
      if (c.adicionales) {
        try {
          const items = JSON.parse(c.adicionales) as { tipo: string; id: string; qty?: number }[]
          items.forEach(a => {
            if (a.tipo === 'producto') {
              productSales[a.id] = (productSales[a.id] || 0) + (a.qty ?? 1)
            }
          })
        } catch {}
      }
    })

    const productosConVentas = productos.map(p => ({
      ...p,
      ventas_historicas: productSales[p.id] || 0,
    })) as Array<Record<string, string> & { ventas_historicas: number }>

    // Group vets by price type
    const vetsPorTipo = vetsActivos.reduce<Record<string, number>>((acc, v) => {
      const tipo = v.tipo_precios || 'precios_convenio'
      acc[tipo] = (acc[tipo] || 0) + 1
      return acc
    }, {})

    // Vets with special pricing - include their tramos
    const vetsConEspeciales = vetsActivos
      .filter(v => v.tipo_precios === 'precios_especiales')
      .map(v => ({
        ...v,
        tramos: preciosE.filter(pe => pe.veterinaria_id === v.id),
      }))

    return NextResponse.json({
      resumen: {
        total_vets: vetsActivos.length,
        por_tipo: vetsPorTipo,
      },
      vets_convenio: vetsActivos.filter(v => v.tipo_precios === 'precios_convenio'),
      vets_especiales: vetsConEspeciales,
      precios_generales: preciosG,
      precios_convenio: preciosC,
      productos: productosConVentas.filter(p => p.activo === 'TRUE'),
    })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
