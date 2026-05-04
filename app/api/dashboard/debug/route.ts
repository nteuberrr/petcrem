import { NextResponse } from 'next/server'
import { getSheetData } from '@/lib/google-sheets'
import { formatDateForSheet } from '@/lib/dates'

export const dynamic = 'force-dynamic'

/**
 * Endpoint de diagnóstico: cuenta por mes (yyyy-mm) cuántos registros hay
 * según distintos drivers. Útil para entender por qué los gráficos del
 * dashboard se ven vacíos en ciertos meses.
 */
export async function GET() {
  try {
    const [clientes, ciclos] = await Promise.all([
      getSheetData('clientes'),
      getSheetData('ciclos'),
    ])

    const cicloById = new Map(ciclos.map(c => [c.id, c]))

    function parseISO(raw: string): string | null {
      if (!raw) return null
      const iso = formatDateForSheet(raw)
      if (!iso) return null
      return iso.slice(0, 7) // "yyyy-mm"
    }

    // Bucket por mes según diferentes drivers
    const cremadosPorFechaCiclo: Record<string, number> = {}
    const cremadosPorFechaRetiro: Record<string, number> = {}
    const cremadosPorFechaCreacion: Record<string, number> = {}
    const cremadosSinCicloId: { id: string; codigo: string; ciclo_id: string; fecha_retiro: string; raw: string }[] = []
    const cremadosCicloIdNoEncontrado: { id: string; codigo: string; ciclo_id: string }[] = []
    const ciclosPorFecha: Record<string, number> = {}
    const clientesPorFechaRetiro: Record<string, number> = {}

    for (const c of ciclos) {
      const mes = parseISO(c.fecha)
      if (mes) ciclosPorFecha[mes] = (ciclosPorFecha[mes] ?? 0) + 1
    }

    for (const c of clientes) {
      const mesRetiro = parseISO(c.fecha_retiro)
      if (mesRetiro) clientesPorFechaRetiro[mesRetiro] = (clientesPorFechaRetiro[mesRetiro] ?? 0) + 1

      if (c.estado === 'cremado') {
        if (mesRetiro) cremadosPorFechaRetiro[mesRetiro] = (cremadosPorFechaRetiro[mesRetiro] ?? 0) + 1
        const mesCreacion = parseISO(c.fecha_creacion)
        if (mesCreacion) cremadosPorFechaCreacion[mesCreacion] = (cremadosPorFechaCreacion[mesCreacion] ?? 0) + 1

        if (!c.ciclo_id) {
          cremadosSinCicloId.push({
            id: c.id, codigo: c.codigo, ciclo_id: c.ciclo_id,
            fecha_retiro: c.fecha_retiro, raw: JSON.stringify({ estado: c.estado, ciclo_id: c.ciclo_id }),
          })
        } else {
          const ciclo = cicloById.get(c.ciclo_id)
          if (!ciclo) {
            cremadosCicloIdNoEncontrado.push({
              id: c.id, codigo: c.codigo, ciclo_id: c.ciclo_id,
            })
          } else {
            const mesCiclo = parseISO(ciclo.fecha)
            if (mesCiclo) cremadosPorFechaCiclo[mesCiclo] = (cremadosPorFechaCiclo[mesCiclo] ?? 0) + 1
          }
        }
      }
    }

    function ordenado(obj: Record<string, number>) {
      return Object.entries(obj).sort(([a], [b]) => a.localeCompare(b))
    }

    return NextResponse.json({
      total_clientes: clientes.length,
      total_cremados: clientes.filter(c => c.estado === 'cremado').length,
      total_ciclos: ciclos.length,
      ciclos_por_fecha: ordenado(ciclosPorFecha),
      cremados_por_fecha_ciclo: ordenado(cremadosPorFechaCiclo),
      cremados_por_fecha_retiro: ordenado(cremadosPorFechaRetiro),
      cremados_por_fecha_creacion: ordenado(cremadosPorFechaCreacion),
      clientes_por_fecha_retiro: ordenado(clientesPorFechaRetiro),
      problemas: {
        cremados_sin_ciclo_id: cremadosSinCicloId.length,
        cremados_con_ciclo_id_inexistente: cremadosCicloIdNoEncontrado.length,
        ejemplos_sin_ciclo_id: cremadosSinCicloId.slice(0, 10),
        ejemplos_ciclo_id_inexistente: cremadosCicloIdNoEncontrado.slice(0, 10),
      },
    }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
