'use client'
import { useState, useEffect, useCallback } from 'react'
import { fmtPrecio, fmtNumero as fmtNum, fmtLitros, fmtFecha } from '@/lib/format'

type ReporteData = {
  kpis: { total_cremaciones_mes: number; pendientes: number; ciclos_mes: number; litros_mes: number; ingresos_mes: number }
  por_especie: Record<string, number>
  por_tipo: Record<string, number>
  ciclos: Array<{ id: string; fecha: string; numero_ciclo: string; litros_inicio: string; litros_fin: string; mascotas_ids: string[] }>
}

type Tramo = { id: string; peso_min: string; peso_max: string; precio_ci: string; precio_cp: string; precio_sd: string }
type Producto = { id: string; nombre: string; precio: string; stock: string; ventas_historicas: number }
type ConfigData = {
  resumen: { total_vets: number; por_tipo: Record<string, number> }
  vets_convenio: Array<{ id: string; nombre: string; comuna: string }>
  vets_especiales: Array<{ id: string; nombre: string; tramos: Tramo[] }>
  precios_generales: Tramo[]
  precios_convenio: Tramo[]
  productos: Producto[]
}
type VetRanking = { id: string; nombre: string; correo: string; count: number }
type VetReporteData = {
  ranking: VetRanking[]
  sin_veterinaria: number
  total_del_mes: number
  totales_historicos: VetRanking[]
}

const TABS = ['Mensual', 'Configuraciones', 'Veterinarios'] as const
type Tab = typeof TABS[number]
const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']

export default function ReportesPage() {
  const now = new Date()
  const [tab, setTab] = useState<Tab>('Mensual')
  const [mes, setMes] = useState(now.getMonth() + 1)
  const [anio, setAnio] = useState(now.getFullYear())
  const [data, setData] = useState<ReporteData | null>(null)
  const [configData, setConfigData] = useState<ConfigData | null>(null)
  const [vetData, setVetData] = useState<VetReporteData | null>(null)
  const [loading, setLoading] = useState(false)

  const fetchReporte = useCallback(async () => {
    setLoading(true)
    const res = await fetch(`/api/reportes?mes=${mes}&anio=${anio}`)
    setData(await res.json())
    setLoading(false)
  }, [mes, anio])

  const fetchConfig = useCallback(async () => {
    setLoading(true)
    const res = await fetch('/api/reportes/configuraciones')
    setConfigData(await res.json())
    setLoading(false)
  }, [])

  const fetchVets = useCallback(async () => {
    setLoading(true)
    const res = await fetch(`/api/reportes/veterinarios?mes=${mes}&anio=${anio}`)
    setVetData(await res.json())
    setLoading(false)
  }, [mes, anio])

  useEffect(() => {
    if (tab === 'Mensual') fetchReporte()
    else if (tab === 'Configuraciones') fetchConfig()
    else if (tab === 'Veterinarios') fetchVets()
  }, [tab, fetchReporte, fetchConfig, fetchVets])

  const fmt = fmtPrecio

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
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Cremaciones')
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
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Operacional')
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
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(resumen), 'Resumen')
      const crema = [['Especie', 'Cantidad'], ...Object.entries(data.por_especie).map(([k, v]) => [k, v])]
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(crema), 'Cremaciones')
      const ciclos = [['Ciclo', 'Fecha', 'Mascotas', 'Litros'], ...data.ciclos.map(c => [`#${c.numero_ciclo}`, c.fecha, c.mascotas_ids.length, parseFloat(c.litros_fin) - parseFloat(c.litros_inicio)])]
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(ciclos), 'Operacional')
    }

    if (tipo === 'vets' && vetData) {
      const rows = [
        ['Ranking', 'Veterinaria', 'Servicios mes'],
        ...vetData.ranking.map((v, i) => [i + 1, v.nombre, v.count]),
        [],
        ['Veterinaria', 'Total histórico'],
        ...vetData.totales_historicos.map(v => [v.nombre, v.count]),
      ]
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Veterinarios')
    }

    XLSX.writeFile(wb, `petcrem-reporte-${tipo}-${anio}-${String(mes).padStart(2, '0')}.xlsx`)
  }

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Reportes</h1>
        <p className="text-gray-500 text-sm mt-0.5">Análisis y exportación de datos</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl w-fit">
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)} className={`px-4 py-1.5 rounded-lg text-xs font-medium transition-colors ${tab === t ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>
            {t}
          </button>
        ))}
      </div>

      {/* Selector período — compartido para Mensual y Veterinarios */}
      {(tab === 'Mensual' || tab === 'Veterinarios') && (
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
          {loading && <span className="text-xs text-gray-400 pt-4">Cargando...</span>}
        </div>
      )}

      {/* ─── TAB MENSUAL ─── */}
      {tab === 'Mensual' && data && (
        <>
          <div className="grid grid-cols-5 gap-4">
            {[
              { label: 'Cremaciones', value: data.kpis.total_cremaciones_mes, color: 'text-indigo-700' },
              { label: 'Pendientes', value: data.kpis.pendientes, color: 'text-yellow-700' },
              { label: 'Ciclos', value: data.kpis.ciclos_mes, color: 'text-blue-700' },
              { label: 'Litros petróleo', value: fmtLitros(data.kpis.litros_mes), color: 'text-orange-700' },
              { label: 'Ingresos est.', value: fmt(data.kpis.ingresos_mes), color: 'text-green-700' },
            ].map(k => (
              <div key={k.label} className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 text-center">
                <p className={`text-2xl font-bold ${k.color}`}>{k.value}</p>
                <p className="text-xs text-gray-500 mt-1">{k.label}</p>
              </div>
            ))}
          </div>

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
                      <td className="py-2 text-gray-600">{fmtFecha(c.fecha)}</td>
                      <td className="py-2 text-gray-600">{c.mascotas_ids.length}</td>
                      <td className="py-2 text-gray-600">{fmtLitros(parseFloat(c.litros_fin) - parseFloat(c.litros_inicio))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="bg-indigo-50 rounded-xl border border-indigo-100 p-6 flex items-center justify-between">
            <div>
              <h2 className="font-semibold text-indigo-900">Informe ejecutivo completo</h2>
              <p className="text-xs text-indigo-600 mt-0.5">Excel con resumen, cremaciones y operacional del período</p>
            </div>
            <button onClick={() => descargarExcel('ejecutivo')} className="bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2 rounded-lg text-sm font-medium transition-colors">
              ↓ Descargar Excel
            </button>
          </div>
        </>
      )}

      {/* ─── TAB CONFIGURACIONES ─── */}
      {tab === 'Configuraciones' && (
        configData ? <ConfiguracionesTab data={configData} fmt={fmt} /> :
        loading ? <div className="text-sm text-gray-400 text-center py-12">Cargando...</div> : null
      )}

      {/* ─── TAB VETERINARIOS ─── */}
      {tab === 'Veterinarios' && (
        vetData ? <VeterinariosTab data={vetData} mes={mes} anio={anio} meses={MESES} onExcel={() => descargarExcel('vets')} /> :
        loading ? <div className="text-sm text-gray-400 text-center py-12">Cargando...</div> : null
      )}
    </div>
  )
}

function ConfiguracionesTab({ data, fmt }: { data: ConfigData; fmt: (n: number | string) => string }) {
  const maxPrecioCI = Math.max(
    ...data.precios_generales.map(t => parseFloat(t.precio_ci) || 0),
    ...data.precios_convenio.map(t => parseFloat(t.precio_ci) || 0),
    1
  )

  return (
    <div className="space-y-6">
      {/* Resumen vets */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 text-center">
          <p className="text-3xl font-bold text-indigo-700">{data.resumen.total_vets}</p>
          <p className="text-xs text-gray-500 mt-1">Veterinarias activas</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 text-center">
          <p className="text-3xl font-bold text-blue-700">{data.resumen.por_tipo['precios_convenio'] ?? 0}</p>
          <p className="text-xs text-gray-500 mt-1">Con convenio estándar</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 text-center">
          <p className="text-3xl font-bold text-purple-700">{data.resumen.por_tipo['precios_especiales'] ?? 0}</p>
          <p className="text-xs text-gray-500 mt-1">Con convenio especial</p>
        </div>
      </div>

      {/* Gráfico comparativo de precios CI */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        <h2 className="font-semibold text-gray-900 mb-4">Comparativa CI — General vs Convenio por tramo</h2>
        <div className="space-y-3">
          {data.precios_generales.map((tg, i) => {
            const tc = data.precios_convenio[i]
            const pG = parseFloat(tg.precio_ci) || 0
            const pC = tc ? parseFloat(tc.precio_ci) || 0 : 0
            const widthG = Math.round((pG / maxPrecioCI) * 200)
            const widthC = Math.round((pC / maxPrecioCI) * 200)
            return (
              <div key={tg.id} className="text-xs">
                <p className="text-gray-500 mb-1">{fmtNumero(tg.peso_min)}–{fmtNumero(tg.peso_max)} kg</p>
                <div className="flex items-center gap-2 mb-1">
                  <span className="w-16 text-right text-gray-400">General</span>
                  <div className="h-5 bg-indigo-400 rounded" style={{ width: widthG }} />
                  <span className="font-semibold text-gray-700">{fmt(pG)}</span>
                </div>
                {pC > 0 && (
                  <div className="flex items-center gap-2">
                    <span className="w-16 text-right text-gray-400">Convenio</span>
                    <div className="h-5 bg-emerald-400 rounded" style={{ width: widthC }} />
                    <span className="font-semibold text-gray-700">{fmt(pC)}</span>
                  </div>
                )}
              </div>
            )
          })}
        </div>
        <div className="flex gap-4 mt-4 text-xs text-gray-500">
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-indigo-400 inline-block" /> General</span>
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-emerald-400 inline-block" /> Convenio</span>
        </div>
      </div>

      {/* Precios generales */}
      <TramosTable title="Precios generales" tramos={data.precios_generales} fmt={fmt} />

      {/* Precios convenio */}
      <TramosTable title="Precios convenio estándar" tramos={data.precios_convenio} fmt={fmt} />

      {/* Veterinarias con precios especiales */}
      {data.vets_especiales.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100">
            <h2 className="font-semibold text-gray-900">Veterinarias con precios especiales</h2>
          </div>
          <div className="divide-y divide-gray-50">
            {data.vets_especiales.map(v => (
              <div key={v.id} className="px-6 py-4">
                <p className="text-sm font-semibold text-gray-900 mb-3">{v.nombre}</p>
                {v.tramos.length > 0 ? (
                  <TramosTable title="" tramos={v.tramos} fmt={fmt} compact />
                ) : (
                  <p className="text-xs text-gray-400">Sin tramos especiales cargados</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Productos / ánforas */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900">Productos y ánforas disponibles</h2>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>{['Producto', 'Precio', 'Stock', 'Ventas históricas'].map(h => <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-gray-500">{h}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {data.productos.map(p => (
              <tr key={p.id}>
                <td className="px-4 py-3 font-medium text-gray-900">{p.nombre}</td>
                <td className="px-4 py-3 text-gray-600">{fmt(p.precio)}</td>
                <td className="px-4 py-3">
                  <span className={`font-semibold ${parseInt(p.stock || '0') < 50 ? 'text-red-600' : 'text-gray-900'}`}>
                    {fmtNumero(p.stock || '0')}
                    {parseInt(p.stock || '0') < 50 && <span className="ml-1 text-xs text-red-500">⚠ bajo</span>}
                  </span>
                </td>
                <td className="px-4 py-3 text-gray-600">{fmtNumero(p.ventas_historicas)}</td>
              </tr>
            ))}
            {data.productos.length === 0 && (
              <tr><td colSpan={4} className="px-4 py-6 text-center text-xs text-gray-400">Sin productos registrados</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function TramosTable({ title, tramos, fmt, compact = false }: { title: string; tramos: Tramo[]; fmt: (n: number | string) => string; compact?: boolean }) {
  return (
    <div className={compact ? '' : 'bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden'}>
      {title && <div className="px-6 py-4 border-b border-gray-100"><h2 className="font-semibold text-gray-900">{title}</h2></div>}
      <table className="w-full text-sm">
        <thead className="bg-gray-50">
          <tr>{['Peso mín', 'Peso máx', 'CI', 'CP', 'SD'].map(h => <th key={h} className="text-left px-4 py-2 text-xs font-semibold text-gray-500">{h}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-gray-50">
          {tramos.map(t => (
            <tr key={t.id}>
              <td className="px-4 py-2 text-gray-600">{fmtNumero(t.peso_min)} kg</td>
              <td className="px-4 py-2 text-gray-600">{fmtNumero(t.peso_max)} kg</td>
              <td className="px-4 py-2 font-medium">{fmt(t.precio_ci)}</td>
              <td className="px-4 py-2 font-medium">{fmt(t.precio_cp)}</td>
              <td className="px-4 py-2 font-medium">{fmt(t.precio_sd)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function VeterinariosTab({ data, mes, anio, meses, onExcel }: {
  data: VetReporteData; mes: number; anio: number; meses: string[]; onExcel: () => void
}) {
  const maxCount = Math.max(...data.ranking.map(v => v.count), 1)

  return (
    <div className="space-y-6">
      {/* Ranking mensual */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div>
            <h2 className="font-semibold text-gray-900">Ranking veterinarias — {meses[mes - 1]} {anio}</h2>
            <p className="text-xs text-gray-500 mt-0.5">{data.total_del_mes} ingresos totales · {data.sin_veterinaria} sin veterinaria asignada</p>
          </div>
          <button onClick={onExcel} className="text-sm text-indigo-600 hover:text-indigo-800 font-medium">↓ Excel</button>
        </div>
        {data.ranking.length === 0 ? (
          <div className="p-8 text-center text-gray-400 text-sm">Sin servicios por veterinaria este mes</div>
        ) : (
          <div className="divide-y divide-gray-50">
            {data.ranking.map((v, i) => (
              <div key={v.id} className="px-6 py-4 flex items-center gap-4">
                <span className="w-6 text-right text-xs font-bold text-gray-400">#{i + 1}</span>
                <div className="flex-1">
                  <p className="text-sm font-semibold text-gray-900">{v.nombre}</p>
                  {v.correo && <p className="text-xs text-gray-400">{v.correo}</p>}
                </div>
                <div className="flex items-center gap-3">
                  <div className="h-3 bg-indigo-200 rounded-full overflow-hidden" style={{ width: 120 }}>
                    <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${(v.count / maxCount) * 100}%` }} />
                  </div>
                  <span className="text-sm font-bold text-indigo-700 w-8 text-right">{v.count}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Ranking histórico */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900">Total histórico por veterinaria</h2>
        </div>
        {data.totales_historicos.length === 0 ? (
          <div className="p-8 text-center text-gray-400 text-sm">Sin datos históricos</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500">#</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500">Veterinaria</th>
                <th className="text-right px-6 py-3 text-xs font-semibold text-gray-500">Total servicios</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {data.totales_historicos.map((v, i) => (
                <tr key={v.id}>
                  <td className="px-6 py-3 text-gray-400 text-xs">{i + 1}</td>
                  <td className="px-4 py-3 font-medium text-gray-900">{v.nombre}</td>
                  <td className="px-6 py-3 text-right font-bold text-gray-700">{fmtNumero(v.count)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

function fmtNumero(n: number | string) { return fmtNum(n) }
