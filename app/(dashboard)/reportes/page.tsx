'use client'
import { useState, useEffect, useCallback } from 'react'

type ReporteData = {
  kpis: { total_cremaciones_mes: number; pendientes: number; ciclos_mes: number; litros_mes: number; ingresos_mes: number }
  por_especie: Record<string, number>
  por_tipo: Record<string, number>
  ciclos: Array<{ id: string; fecha: string; numero_ciclo: string; litros_inicio: string; litros_fin: string; mascotas_ids: string[] }>
}

export default function ReportesPage() {
  const now = new Date()
  const [mes, setMes] = useState(now.getMonth() + 1)
  const [anio, setAnio] = useState(now.getFullYear())
  const [data, setData] = useState<ReporteData | null>(null)
  const [loading, setLoading] = useState(false)

  const fetchReporte = useCallback(async () => {
    setLoading(true)
    const res = await fetch(`/api/reportes?mes=${mes}&anio=${anio}`)
    const d = await res.json()
    setData(d)
    setLoading(false)
  }, [mes, anio])

  useEffect(() => { fetchReporte() }, [fetchReporte])

  const fmt = (n: number) => `$${n.toLocaleString('es-CL')}`

  async function descargarExcel(tipo: string) {
    const XLSX = await import('xlsx-js-style')
    const wb = XLSX.utils.book_new()

    if (tipo === 'cremaciones' && data) {
      const rows = [
        ['Especie', 'Cantidad'],
        ...Object.entries(data.por_especie).map(([k, v]) => [k, v]),
        [],
        ['Tipo', 'Cantidad'],
        ...Object.entries(data.por_tipo).map(([k, v]) => [k, v]),
      ]
      const ws = XLSX.utils.aoa_to_sheet(rows)
      XLSX.utils.book_append_sheet(wb, ws, 'Cremaciones')
    }

    if (tipo === 'operacional' && data) {
      const rows = [
        ['Ciclo', 'Fecha', 'Mascotas', 'Litros'],
        ...data.ciclos.map(c => [
          `#${c.numero_ciclo}`, c.fecha,
          c.mascotas_ids.length,
          parseFloat(c.litros_fin) - parseFloat(c.litros_inicio),
        ]),
      ]
      const ws = XLSX.utils.aoa_to_sheet(rows)
      XLSX.utils.book_append_sheet(wb, ws, 'Operacional')
    }

    if (tipo === 'ejecutivo' && data) {
      const resumen = [
        ['KPI', 'Valor'],
        ['Total cremaciones', data.kpis.total_cremaciones_mes],
        ['Pendientes', data.kpis.pendientes],
        ['Ciclos realizados', data.kpis.ciclos_mes],
        ['Litros petróleo', data.kpis.litros_mes],
        ['Ingresos estimados', data.kpis.ingresos_mes],
      ]
      const ws1 = XLSX.utils.aoa_to_sheet(resumen)
      XLSX.utils.book_append_sheet(wb, ws1, 'Resumen')

      const crema = [['Especie', 'Cantidad'], ...Object.entries(data.por_especie).map(([k, v]) => [k, v])]
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(crema), 'Cremaciones')

      const ciclos = [['Ciclo', 'Fecha', 'Mascotas', 'Litros'], ...data.ciclos.map(c => [`#${c.numero_ciclo}`, c.fecha, c.mascotas_ids.length, parseFloat(c.litros_fin) - parseFloat(c.litros_inicio)])]
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(ciclos), 'Operacional')
    }

    XLSX.writeFile(wb, `petcrem-reporte-${tipo}-${anio}-${String(mes).padStart(2, '0')}.xlsx`)
  }

  const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Reportes</h1>
        <p className="text-gray-500 text-sm mt-0.5">Análisis y exportación de datos</p>
      </div>

      {/* Selector de período */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 flex items-center gap-4">
        <div>
          <label className="text-xs font-medium text-gray-700">Mes</label>
          <select value={mes} onChange={e => setMes(parseInt(e.target.value))} className="mt-1 block border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
            {MESES.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs font-medium text-gray-700">Año</label>
          <select value={anio} onChange={e => setAnio(parseInt(e.target.value))} className="mt-1 block border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
            {[2024, 2025, 2026, 2027].map(a => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
        <div className="pt-4">
          {loading && <span className="text-xs text-gray-400">Cargando...</span>}
        </div>
      </div>

      {data && (
        <>
          {/* KPIs del período */}
          <div className="grid grid-cols-5 gap-4">
            {[
              { label: 'Cremaciones', value: data.kpis.total_cremaciones_mes, color: 'text-indigo-700' },
              { label: 'Pendientes', value: data.kpis.pendientes, color: 'text-yellow-700' },
              { label: 'Ciclos', value: data.kpis.ciclos_mes, color: 'text-blue-700' },
              { label: 'Litros petróleo', value: `${data.kpis.litros_mes} L`, color: 'text-orange-700' },
              { label: 'Ingresos est.', value: fmt(data.kpis.ingresos_mes), color: 'text-green-700' },
            ].map(k => (
              <div key={k.label} className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 text-center">
                <p className={`text-2xl font-bold ${k.color}`}>{k.value}</p>
                <p className="text-xs text-gray-500 mt-1">{k.label}</p>
              </div>
            ))}
          </div>

          {/* Reporte 1 — Cremaciones */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-gray-900">Cremaciones del período</h2>
              <button onClick={() => descargarExcel('cremaciones')} className="text-sm text-indigo-600 hover:text-indigo-800 font-medium">↓ Excel</button>
            </div>
            <div className="grid grid-cols-2 gap-6">
              <div>
                <p className="text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wide">Por especie</p>
                <div className="space-y-2">
                  {Object.entries(data.por_especie).map(([k, v]) => (
                    <div key={k} className="flex items-center justify-between">
                      <span className="text-sm text-gray-700">{k}</span>
                      <span className="text-sm font-semibold text-gray-900 bg-gray-100 px-2 py-0.5 rounded-full">{v}</span>
                    </div>
                  ))}
                  {Object.keys(data.por_especie).length === 0 && <p className="text-xs text-gray-400">Sin datos</p>}
                </div>
              </div>
              <div>
                <p className="text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wide">Por tipo de servicio</p>
                <div className="space-y-2">
                  {Object.entries(data.por_tipo).map(([k, v]) => (
                    <div key={k} className="flex items-center justify-between">
                      <span className="text-sm text-gray-700">{k}</span>
                      <span className="text-sm font-semibold text-gray-900 bg-gray-100 px-2 py-0.5 rounded-full">{v}</span>
                    </div>
                  ))}
                  {Object.keys(data.por_tipo).length === 0 && <p className="text-xs text-gray-400">Sin datos</p>}
                </div>
              </div>
            </div>
          </div>

          {/* Reporte 3 — Operacional */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-gray-900">Operacional — Ciclos del período</h2>
              <button onClick={() => descargarExcel('operacional')} className="text-sm text-indigo-600 hover:text-indigo-800 font-medium">↓ Excel</button>
            </div>
            {data.ciclos.length === 0 ? (
              <p className="text-sm text-gray-400">Sin ciclos en el período</p>
            ) : (
              <table className="w-full text-sm">
                <thead><tr className="border-b border-gray-100">{['Ciclo', 'Fecha', 'Mascotas', 'Litros'].map(h => <th key={h} className="text-left pb-2 text-xs font-semibold text-gray-500">{h}</th>)}</tr></thead>
                <tbody className="divide-y divide-gray-50">
                  {data.ciclos.map(c => (
                    <tr key={c.id}>
                      <td className="py-2 font-medium">#{c.numero_ciclo}</td>
                      <td className="py-2 text-gray-600">{c.fecha}</td>
                      <td className="py-2 text-gray-600">{c.mascotas_ids.length}</td>
                      <td className="py-2 text-gray-600">{(parseFloat(c.litros_fin) - parseFloat(c.litros_inicio)).toFixed(1)} L</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Informe ejecutivo */}
          <div className="bg-indigo-50 rounded-xl border border-indigo-100 p-6 flex items-center justify-between">
            <div>
              <h2 className="font-semibold text-indigo-900">Informe ejecutivo completo</h2>
              <p className="text-xs text-indigo-600 mt-0.5">Excel con resumen, cremaciones y operacional del período</p>
            </div>
            <button
              onClick={() => descargarExcel('ejecutivo')}
              className="bg-indigo-600 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700"
            >
              ↓ Descargar Excel
            </button>
          </div>
        </>
      )}
    </div>
  )
}
