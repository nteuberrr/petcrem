'use client'
import { useState, useEffect, useCallback, useMemo } from 'react'
import { fmtPrecio, fmtNumero as fmtNum, fmtLitros, fmtFecha } from '@/lib/format'
import { formatDateForSheet } from '@/lib/dates'
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, CartesianGrid,
} from 'recharts'

type ReporteData = {
  kpis: {
    total_cremaciones_mes: number; ingresos_clientes_mes: number; pendientes: number
    ciclos_mes: number; litros_mes: number; ingresos_mes: number
    litros_cargados_mes: number; costo_petroleo_mes: number
    costo_vehiculo_mes: number; litros_vehiculo_mes: number
    pendientes_pago: number; monto_pendiente: number
  }
  ratios: { litros_por_mascota: number; litros_por_ciclo: number; costo_vehiculo_por_mascota: number }
  por_especie: Record<string, number>
  por_tipo: Record<string, number>
  por_estado: Record<string, number>
  ciclos: Array<{ id: string; fecha: string; numero_ciclo: string; litros_inicio: string; litros_fin: string; mascotas_ids: string[]; consumo: number; peso_total: number; lt_kg: number }>
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

type RegistroAsistencia = {
  id: string
  usuario_id: string
  usuario_nombre: string
  fecha: string
  hora_entrada: string
  hora_salida: string
  minutos_trabajados: string
  minutos_normales: string
  minutos_extra: string
  estado_aprobacion: string
}
type JornadaCfg = { id: string; vigente_desde: string; hora_entrada: string; hora_salida: string; precio_hora_extra: number; tolerancia_minutos: number; precio_retiro_adicional: number }

const TABS = ['Mensual', 'Ingresos', 'Configuraciones', 'Veterinarios', 'Asistencia', 'Retiros'] as const
type Tab = typeof TABS[number]
const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']
const CHART_COLORS = ['#6366f1', '#ec4899', '#f59e0b', '#10b981', '#3b82f6', '#ef4444', '#8b5cf6', '#14b8a6', '#f43f5e', '#0ea5e9']

type IngresoBucket = { mes_key: string; mes_label: string; ingresos: number; cantidad: number }
type IngresoSlice = { ingresos: number; cantidad: number }
type IngresosData = {
  resumen: { total: number; cantidad: number; ticket_promedio: number }
  evolucion_mensual: IngresoBucket[]
  por_tramo: Array<IngresoSlice & { tramo: string; orden: number }>
  por_servicio: Array<IngresoSlice & { codigo: string }>
  por_especie: Array<IngresoSlice & { especie: string }>
  por_comuna: Array<IngresoSlice & { comuna: string }>
  por_tipo_precio: Array<IngresoSlice & { tipo: string }>
}

function fmtPrecioCorto(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toLocaleString('es-CL', { maximumFractionDigits: 1 })}M`
  if (n >= 1_000) return `$${Math.round(n / 1000).toLocaleString('es-CL')}k`
  return fmtPrecio(n)
}

export default function ReportesPage() {
  const now = new Date()
  const [tab, setTab] = useState<Tab>('Mensual')
  const [mes, setMes] = useState(now.getMonth() + 1)
  const [anio, setAnio] = useState(now.getFullYear())
  const [data, setData] = useState<ReporteData | null>(null)
  const [configData, setConfigData] = useState<ConfigData | null>(null)
  const [vetData, setVetData] = useState<VetReporteData | null>(null)
  const [asistencia, setAsistencia] = useState<RegistroAsistencia[]>([])
  const [jornadaVigente, setJornadaVigente] = useState<JornadaCfg | null>(null)
  const [loading, setLoading] = useState(false)
  const [ingresosData, setIngresosData] = useState<IngresosData | null>(null)
  const [ingresosDesde, setIngresosDesde] = useState('')
  const [ingresosHasta, setIngresosHasta] = useState('')

  type RetiroAdicional = { id: string; usuario_id: string; usuario_nombre: string; fecha: string; hora: string; cliente_nombre: string; comentario: string }
  const [retiros, setRetiros] = useState<RetiroAdicional[]>([])
  const [retirosDesde, setRetirosDesde] = useState('')
  const [retirosHasta, setRetirosHasta] = useState('')

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

  const fetchIngresos = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams()
    if (ingresosDesde) params.set('desde', ingresosDesde)
    if (ingresosHasta) params.set('hasta', ingresosHasta)
    const qs = params.toString()
    const res = await fetch(`/api/reportes/ingresos${qs ? `?${qs}` : ''}`, { cache: 'no-store' })
    setIngresosData(await res.json())
    setLoading(false)
  }, [ingresosDesde, ingresosHasta])

  const fetchAsistencia = useCallback(async () => {
    setLoading(true)
    const desde = `${anio}-${String(mes).padStart(2, '0')}-01`
    const lastDay = new Date(anio, mes, 0).getDate()
    const hasta = `${anio}-${String(mes).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
    const [resAsist, resCfg] = await Promise.all([
      fetch(`/api/asistencia?desde=${desde}&hasta=${hasta}`).then(r => r.json()),
      fetch('/api/jornada-config').then(r => r.json()),
    ])
    setAsistencia(Array.isArray(resAsist) ? resAsist : [])
    setJornadaVigente(resCfg?.vigente ?? null)
    setLoading(false)
  }, [mes, anio])

  const fetchRetiros = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams()
    if (retirosDesde) params.set('desde', retirosDesde)
    if (retirosHasta) params.set('hasta', retirosHasta)
    const qs = params.toString()
    const [resRet, resCfg] = await Promise.all([
      fetch(`/api/retiros-adicionales${qs ? `?${qs}` : ''}`, { cache: 'no-store' }).then(r => r.json()),
      fetch('/api/jornada-config', { cache: 'no-store' }).then(r => r.json()),
    ])
    setRetiros(Array.isArray(resRet) ? resRet : [])
    setJornadaVigente(resCfg?.vigente ?? null)
    setLoading(false)
  }, [retirosDesde, retirosHasta])

  useEffect(() => {
    if (tab === 'Mensual') fetchReporte()
    else if (tab === 'Ingresos') fetchIngresos()
    else if (tab === 'Configuraciones') fetchConfig()
    else if (tab === 'Veterinarios') fetchVets()
    else if (tab === 'Asistencia') fetchAsistencia()
    else if (tab === 'Retiros') fetchRetiros()
  }, [tab, fetchReporte, fetchIngresos, fetchConfig, fetchVets, fetchAsistencia, fetchRetiros])

  // Resumen asistencia por operador
  type ResumenOperador = {
    usuario_id: string; usuario_nombre: string
    minutos_normales: number; minutos_extra_aprobado: number; minutos_extra_pendiente: number; minutos_extra_rechazado: number
    costo_extra: number
    registros: number
  }
  const resumenAsistencia = useMemo<ResumenOperador[]>(() => {
    const precio = jornadaVigente?.precio_hora_extra ?? 0
    const m = new Map<string, ResumenOperador>()
    for (const r of asistencia) {
      let acc = m.get(r.usuario_id)
      if (!acc) {
        acc = { usuario_id: r.usuario_id, usuario_nombre: r.usuario_nombre, minutos_normales: 0, minutos_extra_aprobado: 0, minutos_extra_pendiente: 0, minutos_extra_rechazado: 0, costo_extra: 0, registros: 0 }
        m.set(r.usuario_id, acc)
      }
      acc.minutos_normales += parseFloat(r.minutos_normales) || 0
      const extra = parseFloat(r.minutos_extra) || 0
      if (r.estado_aprobacion === 'aprobado') acc.minutos_extra_aprobado += extra
      else if (r.estado_aprobacion === 'rechazado') acc.minutos_extra_rechazado += extra
      else acc.minutos_extra_pendiente += extra
      acc.registros += 1
    }
    for (const acc of m.values()) {
      acc.costo_extra = (acc.minutos_extra_aprobado / 60) * precio
    }
    return Array.from(m.values()).sort((a, b) => b.minutos_extra_aprobado - a.minutos_extra_aprobado)
  }, [asistencia, jornadaVigente])

  async function aprobarRegistro(id: string, estado: 'aprobado' | 'rechazado') {
    const res = await fetch('/api/asistencia', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, estado_aprobacion: estado }),
    })
    if (res.ok) await fetchAsistencia()
  }

  function fmtMinutos(mins: number): string {
    if (mins <= 0) return '0:00'
    const h = Math.floor(mins / 60)
    const m = mins % 60
    return `${h}:${String(m).padStart(2, '0')}`
  }

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
        ['Ciclo', 'Fecha', 'Mascotas', 'Peso total (kg)', 'Litros', 'Lt/kg'],
        ...data.ciclos.map(c => [
          `N° ${c.numero_ciclo}`, c.fecha,
          c.mascotas_ids.length,
          c.peso_total,
          c.consumo,
          c.lt_kg,
        ]),
      ]
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Operacional')
    }

    if (tipo === 'ejecutivo' && data) {
      const resumen = [
        ['KPI', 'Valor'],
        ['Mascotas ingresadas', data.kpis.ingresos_clientes_mes],
        ['Total cremaciones', data.kpis.total_cremaciones_mes],
        ['En cámara', data.kpis.pendientes],
        ['Ciclos realizados', data.kpis.ciclos_mes],
        ['Litros consumidos', data.kpis.litros_mes],
        ['Litros cargados', data.kpis.litros_cargados_mes],
        ['Costo petróleo', data.kpis.costo_petroleo_mes],
        ['Costo vehículo', data.kpis.costo_vehiculo_mes],
        ['Ingresos estimados', data.kpis.ingresos_mes],
        ['Pagos pendientes', data.kpis.pendientes_pago],
        ['Monto por cobrar', data.kpis.monto_pendiente],
        [],
        ['Ratio', 'Valor'],
        ['Litros / mascota', data.ratios.litros_por_mascota],
        ['Litros / ciclo', data.ratios.litros_por_ciclo],
        ['Costo vehículo / mascota', data.ratios.costo_vehiculo_por_mascota],
      ]
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(resumen), 'Resumen')
      const crema = [['Especie', 'Cantidad'], ...Object.entries(data.por_especie).map(([k, v]) => [k, v])]
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(crema), 'Cremaciones')
      const ciclos = [['Ciclo', 'Fecha', 'Mascotas', 'Peso total (kg)', 'Litros', 'Lt/kg'],
        ...data.ciclos.map(c => [`N° ${c.numero_ciclo}`, c.fecha, c.mascotas_ids.length, c.peso_total, c.consumo, c.lt_kg])]
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(ciclos), 'Operacional')
    }

    if (tipo === 'asistencia') {
      const resumen = [
        ['Operador', 'Hs normales', 'Hs extra aprobadas', 'Hs extra pendientes', 'Hs extra rechazadas', 'Costo extra (aprobado)', 'Registros'],
        ...resumenAsistencia.map(r => [
          r.usuario_nombre,
          (r.minutos_normales / 60).toFixed(2),
          (r.minutos_extra_aprobado / 60).toFixed(2),
          (r.minutos_extra_pendiente / 60).toFixed(2),
          (r.minutos_extra_rechazado / 60).toFixed(2),
          r.costo_extra,
          r.registros,
        ]),
      ]
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(resumen), 'Resumen')
      const detalle = [
        ['Operador', 'Fecha', 'Entrada', 'Salida', 'Min trabajados', 'Min normales', 'Min extra', 'Estado'],
        ...asistencia.map(r => [r.usuario_nombre, r.fecha, r.hora_entrada, r.hora_salida, r.minutos_trabajados, r.minutos_normales, r.minutos_extra, r.estado_aprobacion]),
      ]
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(detalle), 'Detalle')
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

      {/* Selector período — compartido para Mensual, Veterinarios y Asistencia (Ingresos tiene su propio rango) */}
      {(tab === 'Mensual' || tab === 'Veterinarios' || tab === 'Asistencia') && (
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
      {tab === 'Mensual' && data && data.kpis && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {[
              { label: 'Mascotas ingresadas', value: data.kpis.ingresos_clientes_mes, color: 'text-indigo-700' },
              { label: 'Cremaciones', value: data.kpis.total_cremaciones_mes, color: 'text-rose-700' },
              { label: 'En cámara', value: data.kpis.pendientes, color: 'text-yellow-700' },
              { label: 'Ciclos', value: data.kpis.ciclos_mes, color: 'text-blue-700' },
              { label: 'Litros consumidos', value: fmtLitros(data.kpis.litros_mes), color: 'text-orange-700' },
              { label: 'Litros cargados', value: fmtLitros(data.kpis.litros_cargados_mes), color: 'text-amber-700' },
              { label: 'Costo petróleo', value: fmt(data.kpis.costo_petroleo_mes), color: 'text-red-700' },
              { label: 'Costo vehículo', value: fmt(data.kpis.costo_vehiculo_mes), color: 'text-purple-700' },
              { label: 'Ingresos est.', value: fmt(data.kpis.ingresos_mes), color: 'text-green-700' },
              { label: 'Pagos pendientes', value: data.kpis.pendientes_pago, color: 'text-amber-700' },
              { label: 'Monto por cobrar', value: fmt(data.kpis.monto_pendiente), color: 'text-rose-700' },
            ].map(k => (
              <div key={k.label} className="bg-white rounded-xl shadow-sm border-2 border-gray-200 p-4 text-center">
                <p className={`text-xl font-bold ${k.color}`}>{k.value}</p>
                <p className="text-xs text-gray-500 mt-1">{k.label}</p>
              </div>
            ))}
          </div>

          {/* Ratios del período */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {[
              { label: 'Litros / mascota', value: `${data.ratios.litros_por_mascota.toFixed(1)} L` },
              { label: 'Litros / ciclo', value: `${data.ratios.litros_por_ciclo.toFixed(1)} L` },
              { label: 'Costo vehículo / mascota', value: fmt(data.ratios.costo_vehiculo_por_mascota) },
            ].map(r => (
              <div key={r.label} className="bg-white rounded-xl shadow-sm border-2 border-gray-200 p-4">
                <p className="text-xs font-semibold text-gray-600">{r.label}</p>
                <p className="text-xl font-bold text-gray-900 mt-1">{r.value}</p>
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
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[640px]">
                  <thead><tr className="border-b border-gray-100">{['Ciclo', 'Fecha', 'Mascotas', 'Peso total', 'Litros', 'Lt/kg'].map(h => <th key={h} className="text-left pb-2 text-xs font-semibold text-gray-500">{h}</th>)}</tr></thead>
                  <tbody className="divide-y divide-gray-50">
                    {data.ciclos.map(c => (
                      <tr key={c.id}>
                        <td className="py-2 font-medium">N° {c.numero_ciclo}</td>
                        <td className="py-2 text-gray-600">{fmtFecha(c.fecha)}</td>
                        <td className="py-2 text-gray-600">{c.mascotas_ids.length}</td>
                        <td className="py-2 text-gray-600">{c.peso_total > 0 ? `${c.peso_total.toFixed(1)} kg` : '—'}</td>
                        <td className="py-2 text-gray-600">{fmtLitros(c.consumo)}</td>
                        <td className="py-2 text-gray-700 font-medium">{c.lt_kg > 0 ? c.lt_kg.toFixed(2) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
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

      {/* ─── TAB INGRESOS ─── */}
      {tab === 'Ingresos' && (
        <IngresosTab
          data={ingresosData}
          loading={loading}
          desde={ingresosDesde}
          hasta={ingresosHasta}
          setDesde={setIngresosDesde}
          setHasta={setIngresosHasta}
          onAplicar={fetchIngresos}
        />
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

      {/* ─── TAB ASISTENCIA ─── */}
      {tab === 'Asistencia' && (
        <div className="space-y-6">
          {!jornadaVigente && (
            <div className="bg-amber-50 border-2 border-amber-200 rounded-xl p-4 text-sm text-amber-800">
              ⚠ No hay jornada vigente configurada. Los costos no se pueden calcular hasta crear una en Configuración → Jornada.
            </div>
          )}

          {/* Resumen por operador */}
          <div className="bg-white rounded-xl shadow-md border-2 border-gray-200 overflow-hidden">
            <div className="px-6 py-4 border-b-2 border-gray-200 flex items-center justify-between">
              <h2 className="font-semibold text-gray-900">Resumen por operador — {MESES[mes - 1]} {anio}</h2>
              <button onClick={() => descargarExcel('asistencia')}
                className="text-sm text-indigo-600 hover:text-indigo-800 font-medium">↓ Excel</button>
            </div>
            {resumenAsistencia.length === 0 ? (
              <div className="p-8 text-center text-gray-400 text-sm">Sin registros en el período</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[720px]">
                  <thead className="bg-gray-50">
                    <tr>
                      {['Operador', 'Normales', 'Extra aprobadas', 'Extra pendientes', 'Extra rechazadas', 'Costo extra'].map(h => (
                        <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-gray-500">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {resumenAsistencia.map(r => (
                      <tr key={r.usuario_id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 font-medium text-gray-900">{r.usuario_nombre}</td>
                        <td className="px-4 py-3 text-blue-700">{fmtMinutos(r.minutos_normales)}</td>
                        <td className="px-4 py-3 font-semibold text-emerald-700">{fmtMinutos(r.minutos_extra_aprobado)}</td>
                        <td className="px-4 py-3 text-amber-700">{fmtMinutos(r.minutos_extra_pendiente)}</td>
                        <td className="px-4 py-3 text-gray-500">{fmtMinutos(r.minutos_extra_rechazado)}</td>
                        <td className="px-4 py-3 font-bold text-emerald-700">{fmtPrecio(r.costo_extra)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Pendientes de aprobación */}
          <div className="bg-white rounded-xl shadow-md border-2 border-gray-200 overflow-hidden">
            <div className="px-6 py-4 border-b-2 border-gray-200">
              <h2 className="font-semibold text-gray-900">Horas extra pendientes de aprobación</h2>
            </div>
            {(() => {
              const pendientes = asistencia.filter(r => r.estado_aprobacion === 'pendiente' && (parseFloat(r.minutos_extra) || 0) > 0)
              if (pendientes.length === 0) {
                return <div className="p-8 text-center text-gray-400 text-sm">No hay horas extra pendientes en el período</div>
              }
              return (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm min-w-[720px]">
                    <thead className="bg-gray-50">
                      <tr>
                        {['Operador', 'Fecha', 'Entrada', 'Salida', 'Extra', 'Acciones'].map(h => (
                          <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-gray-500">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {pendientes.map(r => (
                        <tr key={r.id} className="hover:bg-gray-50">
                          <td className="px-4 py-3 font-medium text-gray-900">{r.usuario_nombre}</td>
                          <td className="px-4 py-3 text-gray-700">{fmtFecha(r.fecha)}</td>
                          <td className="px-4 py-3 text-gray-700">{r.hora_entrada}</td>
                          <td className="px-4 py-3 text-gray-700">{r.hora_salida}</td>
                          <td className="px-4 py-3 font-bold text-amber-700">{fmtMinutos(parseFloat(r.minutos_extra) || 0)}</td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <button onClick={() => aprobarRegistro(r.id, 'aprobado')}
                                className="bg-emerald-500 hover:bg-emerald-600 text-white px-2.5 py-1 rounded-md text-xs font-medium">
                                ✓ Aprobar
                              </button>
                              <button onClick={() => aprobarRegistro(r.id, 'rechazado')}
                                className="bg-amber-500 hover:bg-amber-600 text-white px-2.5 py-1 rounded-md text-xs font-medium">
                                ✗ Rechazar
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            })()}
          </div>
        </div>
      )}

      {/* ─── TAB RETIROS FUERA DE HORARIO ─── */}
      {tab === 'Retiros' && (
        <RetirosTab
          retiros={retiros}
          jornadaVigente={jornadaVigente}
          loading={loading}
          desde={retirosDesde}
          hasta={retirosHasta}
          setDesde={setRetirosDesde}
          setHasta={setRetirosHasta}
          onAplicar={fetchRetiros}
        />
      )}
    </div>
  )
}

function RetirosTab({
  retiros, jornadaVigente, loading, desde, hasta, setDesde, setHasta, onAplicar,
}: {
  retiros: Array<{ id: string; usuario_id: string; usuario_nombre: string; fecha: string; hora: string; cliente_nombre: string; comentario: string }>
  jornadaVigente: JornadaCfg | null
  loading: boolean
  desde: string; hasta: string
  setDesde: (v: string) => void
  setHasta: (v: string) => void
  onAplicar: () => void
}) {
  const precio = jornadaVigente?.precio_retiro_adicional ?? 0

  type ResumenOp = { usuario_id: string; usuario_nombre: string; cantidad: number; pago: number }
  const resumenPorOperador = useMemo<ResumenOp[]>(() => {
    const m = new Map<string, ResumenOp>()
    for (const r of retiros) {
      let acc = m.get(r.usuario_id)
      if (!acc) {
        acc = { usuario_id: r.usuario_id, usuario_nombre: r.usuario_nombre, cantidad: 0, pago: 0 }
        m.set(r.usuario_id, acc)
      }
      acc.cantidad += 1
      acc.pago += precio
    }
    return Array.from(m.values()).sort((a, b) => b.cantidad - a.cantidad)
  }, [retiros, precio])

  const total = retiros.length
  const totalPago = total * precio

  async function descargarExcel() {
    const XLSX = await import('xlsx-js-style')
    const wb = XLSX.utils.book_new()
    const resumen: (string | number)[][] = [
      ['Total retiros', total],
      ['Pago por retiro', precio],
      ['Total a pagar', totalPago],
      [],
      ['Operador', 'Cantidad', 'Pago'],
      ...resumenPorOperador.map(r => [r.usuario_nombre, r.cantidad, r.pago]),
      [],
      ['Detalle', '', '', '', ''],
      ['Operador', 'Fecha', 'Hora', 'Cliente', 'Comentario'],
      ...retiros.map(r => [r.usuario_nombre, r.fecha, r.hora, r.cliente_nombre, r.comentario || '']),
    ]
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(resumen), 'Retiros')
    const sufijo = desde || hasta ? `${desde || 'inicio'}_${hasta || 'hoy'}` : 'completo'
    XLSX.writeFile(wb, `petcrem-retiros-fuera-horario-${sufijo}.xlsx`)
  }

  return (
    <div className="space-y-6">
      {/* Filtros */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 flex flex-wrap items-end gap-4">
        <div>
          <label className="text-xs font-medium text-gray-700">Desde</label>
          <input type="date" value={desde} onChange={e => setDesde(e.target.value)}
            className="mt-1 block border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
        </div>
        <div>
          <label className="text-xs font-medium text-gray-700">Hasta</label>
          <input type="date" value={hasta} onChange={e => setHasta(e.target.value)}
            className="mt-1 block border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
        </div>
        <button onClick={onAplicar}
          className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
          Aplicar
        </button>
        {(desde || hasta) && (
          <button onClick={() => { setDesde(''); setHasta(''); setTimeout(onAplicar, 0) }}
            className="text-sm text-gray-500 hover:text-gray-700 underline">
            Limpiar
          </button>
        )}
        <div className="ml-auto">
          <button onClick={descargarExcel} disabled={retiros.length === 0}
            className="text-sm text-indigo-600 hover:text-indigo-800 font-medium disabled:opacity-40">
            ↓ Excel
          </button>
        </div>
        {loading && <span className="text-xs text-gray-400">Cargando...</span>}
      </div>

      {/* KPIs totales */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl shadow-sm border-2 border-gray-200 p-5 text-center">
          <p className="text-2xl font-bold text-indigo-700">{fmtNum(total)}</p>
          <p className="text-xs text-gray-500 mt-1">Retiros en el período</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm border-2 border-gray-200 p-5 text-center">
          <p className="text-2xl font-bold text-amber-700">{fmtPrecio(precio)}</p>
          <p className="text-xs text-gray-500 mt-1">Pago por retiro</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm border-2 border-gray-200 p-5 text-center">
          <p className="text-2xl font-bold text-emerald-700">{fmtPrecio(totalPago)}</p>
          <p className="text-xs text-gray-500 mt-1">Total a pagar</p>
        </div>
      </div>

      {/* Resumen por operador */}
      {resumenPorOperador.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100">
            <h2 className="font-semibold text-gray-900">Pago por chofer</h2>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>{['Operador', 'Cantidad', 'Pago'].map(h => <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-gray-500">{h}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {resumenPorOperador.map(r => (
                <tr key={r.usuario_id}>
                  <td className="px-4 py-3 font-medium text-gray-900">{r.usuario_nombre}</td>
                  <td className="px-4 py-3 text-gray-700">{r.cantidad}</td>
                  <td className="px-4 py-3 font-semibold text-emerald-700">{fmtPrecio(r.pago)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Detalle de retiros */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900">Detalle de retiros</h2>
        </div>
        {retiros.length === 0 ? (
          <div className="p-8 text-center text-gray-400 text-sm">Sin retiros en el período</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[680px]">
              <thead className="bg-gray-50">
                <tr>{['Operador', 'Fecha', 'Hora', 'Cliente', 'Comentario'].map(h => <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-gray-500">{h}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {retiros.map(r => (
                  <tr key={r.id}>
                    <td className="px-4 py-3 font-medium text-gray-900">{r.usuario_nombre}</td>
                    <td className="px-4 py-3 text-gray-700">{fmtFecha(r.fecha)}</td>
                    <td className="px-4 py-3 text-gray-700">{r.hora || '—'}</td>
                    <td className="px-4 py-3 text-gray-700">{r.cliente_nombre}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{r.comentario || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
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
            {data.productos.map((p, i) => (
              <tr key={`${p.id}-${i}`}>
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

function IngresosTab({
  data, loading, desde, hasta, setDesde, setHasta, onAplicar,
}: {
  data: IngresosData | null
  loading: boolean
  desde: string; hasta: string
  setDesde: (v: string) => void
  setHasta: (v: string) => void
  onAplicar: () => void
}) {
  const evolucion = data?.evolucion_mensual ?? []
  const porTramo = data?.por_tramo ?? []
  const porServicio = data?.por_servicio ?? []
  const porEspecie = data?.por_especie ?? []
  const porComuna = (data?.por_comuna ?? []).slice(0, 10)
  const porTipoPrecio = data?.por_tipo_precio ?? []

  async function descargarExcel() {
    if (!data) return
    const XLSX = await import('xlsx-js-style')
    const wb = XLSX.utils.book_new()
    const resumen: (string | number)[][] = [
      ['Total ingresos', data.resumen.total],
      ['Mascotas', data.resumen.cantidad],
      ['Ticket promedio', data.resumen.ticket_promedio],
      [],
      ['Evolución mensual', '', ''],
      ['Mes', 'Ingresos', 'Mascotas'],
      ...evolucion.map(e => [e.mes_label, e.ingresos, e.cantidad]),
      [],
      ['Por tramo de precio', '', ''],
      ['Tramo', 'Ingresos', 'Mascotas'],
      ...porTramo.map(t => [t.tramo, t.ingresos, t.cantidad]),
      [],
      ['Por tipo de servicio', '', ''],
      ['Código', 'Ingresos', 'Mascotas'],
      ...porServicio.map(s => [s.codigo, s.ingresos, s.cantidad]),
      [],
      ['Por especie', '', ''],
      ['Especie', 'Ingresos', 'Mascotas'],
      ...porEspecie.map(s => [s.especie, s.ingresos, s.cantidad]),
      [],
      ['Por comuna', '', ''],
      ['Comuna', 'Ingresos', 'Mascotas'],
      ...porComuna.map(s => [s.comuna, s.ingresos, s.cantidad]),
    ]
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(resumen), 'Ingresos')
    const sufijo = desde || hasta ? `${desde || 'inicio'}_${hasta || 'hoy'}` : 'completo'
    XLSX.writeFile(wb, `petcrem-ingresos-${sufijo}.xlsx`)
  }

  return (
    <div className="space-y-6">
      {/* Filtros de período */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 flex flex-wrap items-end gap-4">
        <div>
          <label className="text-xs font-medium text-gray-700">Desde</label>
          <input type="date" value={desde} onChange={e => setDesde(e.target.value)}
            className="mt-1 block border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
        </div>
        <div>
          <label className="text-xs font-medium text-gray-700">Hasta</label>
          <input type="date" value={hasta} onChange={e => setHasta(e.target.value)}
            className="mt-1 block border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
        </div>
        <button onClick={onAplicar}
          className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
          Aplicar
        </button>
        {(desde || hasta) && (
          <button onClick={() => { setDesde(''); setHasta(''); setTimeout(onAplicar, 0) }}
            className="text-sm text-gray-500 hover:text-gray-700 underline">
            Limpiar
          </button>
        )}
        <div className="ml-auto">
          <button onClick={descargarExcel} disabled={!data}
            className="text-sm text-indigo-600 hover:text-indigo-800 font-medium disabled:opacity-40">
            ↓ Excel
          </button>
        </div>
        {loading && <span className="text-xs text-gray-400">Cargando...</span>}
      </div>

      {!data && !loading && (
        <p className="text-sm text-gray-400 text-center py-12">Sin datos</p>
      )}

      {data && (
        <>
          {/* KPIs resumen */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <KpiBox label="Total ingresos" value={fmtPrecio(data.resumen.total)} color="text-emerald-700" />
            <KpiBox label="Mascotas" value={fmtNumero(data.resumen.cantidad)} color="text-indigo-700" />
            <KpiBox label="Ticket promedio" value={fmtPrecio(data.resumen.ticket_promedio)} color="text-amber-700" />
          </div>

          {/* Evolución mensual */}
          <ChartBox title="Evolución mensual de ingresos">
            {evolucion.length === 0 ? (
              <EmptyChart label="Sin datos en el rango" />
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={evolucion}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="mes_label" fontSize={11} tick={{ fill: '#6b7280' }} />
                  <YAxis fontSize={11} tick={{ fill: '#6b7280' }} tickFormatter={v => fmtPrecioCorto(v as number)} />
                  <Tooltip formatter={(v) => fmtPrecio(v as number)} />
                  <Line type="monotone" dataKey="ingresos" stroke="#10b981" strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </ChartBox>

          {/* Por tramo de precio */}
          <ChartBox title="Ingresos por tramo de precio">
            {porTramo.length === 0 ? (
              <EmptyChart label="Sin datos" />
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={porTramo}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="tramo" fontSize={11} tick={{ fill: '#6b7280' }} />
                  <YAxis fontSize={11} tick={{ fill: '#6b7280' }} tickFormatter={v => fmtPrecioCorto(v as number)} />
                  <Tooltip formatter={(v) => fmtPrecio(v as number)} />
                  <Legend />
                  <Bar name="Ingresos" dataKey="ingresos" fill="#6366f1" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </ChartBox>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
            {/* Por tipo de servicio */}
            <ChartBox title="Ingresos por tipo de servicio">
              {porServicio.length === 0 ? (
                <EmptyChart label="Sin datos" />
              ) : (
                <ResponsiveContainer width="100%" height={260}>
                  <PieChart>
                    <Pie data={porServicio} dataKey="ingresos" nameKey="codigo" outerRadius={90}
                      label={({ name, value }) => `${name}: ${fmtPrecioCorto(value as number)}`}>
                      {porServicio.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                    </Pie>
                    <Tooltip formatter={(v) => fmtPrecio(v as number)} />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </ChartBox>

            {/* Por especie */}
            <ChartBox title="Ingresos por tipo de mascota">
              {porEspecie.length === 0 ? (
                <EmptyChart label="Sin datos" />
              ) : (
                <ResponsiveContainer width="100%" height={260}>
                  <PieChart>
                    <Pie data={porEspecie} dataKey="ingresos" nameKey="especie" outerRadius={90}
                      label={({ name, value }) => `${name}: ${fmtPrecioCorto(value as number)}`}>
                      {porEspecie.map((_, i) => <Cell key={i} fill={CHART_COLORS[(i + 2) % CHART_COLORS.length]} />)}
                    </Pie>
                    <Tooltip formatter={(v) => fmtPrecio(v as number)} />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </ChartBox>
          </div>

          {/* Por comuna */}
          <ChartBox title="Ingresos por comuna (top 10)">
            {porComuna.length === 0 ? (
              <EmptyChart label="Sin datos" />
            ) : (
              <ResponsiveContainer width="100%" height={Math.max(280, porComuna.length * 38)}>
                <BarChart data={porComuna} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis type="number" fontSize={11} tick={{ fill: '#6b7280' }} tickFormatter={v => fmtPrecioCorto(v as number)} />
                  <YAxis dataKey="comuna" type="category" fontSize={11} width={140} tick={{ fill: '#6b7280' }} />
                  <Tooltip formatter={(v) => fmtPrecio(v as number)} />
                  <Bar dataKey="ingresos" fill="#8b5cf6" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </ChartBox>

          {/* Por tipo de precio (general/convenio/especial) */}
          {porTipoPrecio.length > 1 && (
            <ChartBox title="Ingresos por tipo de precio">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {porTipoPrecio.map(p => (
                  <div key={p.tipo} className="border border-gray-100 rounded-lg p-4">
                    <p className="text-xs text-gray-500 uppercase tracking-wide">{p.tipo}</p>
                    <p className="text-xl font-bold text-gray-900 mt-1">{fmtPrecio(p.ingresos)}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{fmtNumero(p.cantidad)} mascotas</p>
                  </div>
                ))}
              </div>
            </ChartBox>
          )}

          {/* Tabla detalle por tramo */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
            <h2 className="font-semibold text-gray-900 mb-4">Detalle por tramo</h2>
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>{['Tramo', 'Ingresos', 'Mascotas', '% del total'].map(h => <th key={h} className="text-left px-4 py-2 text-xs font-semibold text-gray-500">{h}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {porTramo.map(t => (
                  <tr key={t.tramo}>
                    <td className="px-4 py-2 font-medium text-gray-900">{t.tramo}</td>
                    <td className="px-4 py-2 font-semibold text-emerald-700">{fmtPrecio(t.ingresos)}</td>
                    <td className="px-4 py-2 text-gray-700">{fmtNumero(t.cantidad)}</td>
                    <td className="px-4 py-2 text-gray-500">
                      {data.resumen.total > 0 ? `${((t.ingresos / data.resumen.total) * 100).toFixed(1)}%` : '0%'}
                    </td>
                  </tr>
                ))}
                {porTramo.length === 0 && (
                  <tr><td colSpan={4} className="px-4 py-6 text-center text-xs text-gray-400">Sin datos</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

function KpiBox({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="bg-white rounded-xl shadow-sm border-2 border-gray-200 p-5 text-center">
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
      <p className="text-xs text-gray-500 mt-1">{label}</p>
    </div>
  )
}

function ChartBox({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
      <h3 className="text-sm font-semibold text-gray-700 mb-4">{title}</h3>
      {children}
    </div>
  )
}

function EmptyChart({ label }: { label: string }) {
  return <div className="flex items-center justify-center h-[200px] text-sm text-gray-400">{label}</div>
}
