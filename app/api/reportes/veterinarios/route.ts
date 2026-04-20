import { NextRequest, NextResponse } from 'next/server'
import { getSheetData } from '@/lib/google-sheets'

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const mes = parseInt(searchParams.get('mes') ?? String(new Date().getMonth() + 1))
    const anio = parseInt(searchParams.get('anio') ?? String(new Date().getFullYear()))

    const [clientes, vets] = await Promise.all([
      getSheetData('clientes'),
      getSheetData('veterinarios'),
    ])

    const delMes = clientes.filter(c => {
      const d = new Date(c.fecha_creacion)
      return d.getMonth() + 1 === mes && d.getFullYear() === anio
    })

    const rankingMap: Record<string, number> = {}
    delMes.forEach(c => {
      if (c.veterinaria_id) {
        rankingMap[c.veterinaria_id] = (rankingMap[c.veterinaria_id] || 0) + 1
      }
    })

    const vetMap: Record<string, { nombre: string; correo: string; telefono: string }> = {}
    vets.forEach(v => {
      vetMap[v.id] = { nombre: v.nombre, correo: v.correo, telefono: v.telefono }
    })

    const ranking = Object.entries(rankingMap)
      .map(([id, count]) => ({
        id,
        nombre: vetMap[id]?.nombre ?? `Veterinaria #${id}`,
        correo: vetMap[id]?.correo ?? '',
        telefono: vetMap[id]?.telefono ?? '',
        count,
      }))
      .sort((a, b) => b.count - a.count)

    const sinVet = delMes.filter(c => !c.veterinaria_id).length

    // All-time vet totals
    const totalMap: Record<string, number> = {}
    clientes.forEach(c => {
      if (c.veterinaria_id) {
        totalMap[c.veterinaria_id] = (totalMap[c.veterinaria_id] || 0) + 1
      }
    })
    const totalesHistoricos = Object.entries(totalMap)
      .map(([id, count]) => ({ id, nombre: vetMap[id]?.nombre ?? `Veterinaria #${id}`, count }))
      .sort((a, b) => b.count - a.count)

    return NextResponse.json({
      ranking,
      sin_veterinaria: sinVet,
      total_del_mes: delMes.length,
      totales_historicos: totalesHistoricos,
    })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
