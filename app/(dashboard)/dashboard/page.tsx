'use client'
import { useState, useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { fmtPrecio, fmtLitros, fmtNumero } from '@/lib/format'
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, CartesianGrid,
} from 'recharts'
import TimelineStatus from '@/components/TimelineStatus'
import { Modal } from '@/components/ui/Modal'

type RatioKey = 'litros_por_mascota' | 'litros_por_ciclo' | 'costo_vehiculo_por_mascota' | 'duracion_promedio_ciclo_min'
type RatioMensual = { mes: string; litros_por_mascota: number; litros_por_ciclo: number; costo_vehiculo_por_mascota: number; duracion_promedio_ciclo_min: number }

type Data = {
  kpis: {
    mascotas_total: number; mascotas_mes: number; cremaciones_mes: number
    pendientes: number; ciclos_mes: number
    litros_mes: number; ingresos_mes: number; stock_petroleo: number
    stock_bajo: boolean; pendientes_pago: number; monto_pendiente: number
  }
  ratios: { litros_por_ciclo: number; litros_por_mascota: number; costo_vehiculo_por_mascota: number; duracion_promedio_ciclo_min: number }
  ratios_por_mes: RatioMensual[]
  ventas_por_mes: Array<{ mes: string; ingresos: number; mascotas: number; ciclos: number }>
  top_servicios: Array<{ codigo: string; count: number }>
  ventas_por_vet: Array<{ vet: string; ingresos: number; mascotas: number }>
  top_productos: Array<{ nombre: string; qty: number }>
  top_otros_servicios: Array<{ nombre: string; qty: number }>
  por_especie: Array<{ especie: string; count: number }>
}

const COLORS = ['#6366f1', '#ec4899', '#f59e0b', '#10b981', '#3b82f6', '#ef4444', '#8b5cf6', '#14b8a6']

export default function DashboardPage() {
  const { data: session } = useSession()
  const isAdmin = (session?.user as { role?: string })?.role === 'admin'
  const [data, setData] = useState<Data | null>(null)
  const [loading, setLoading] = useState(true)
  const [ratioOpen, setRatioOpen] = useState<RatioKey | null>(null)

  useEffect(() => {
    fetch('/api/dashboard', { cache: 'no-store' })
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']
  const mesActual = MESES[new Date().getMonth()]

  if (loading || !data) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-gray-500 text-sm mt-0.5">Cargando…</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-white rounded-xl border border-gray-100 p-5 animate-pulse h-28" />
          ))}
        </div>
      </div>
    )
  }

  // KPIs operativos (todos los usuarios)
  const kpisOperativos = [
    { label: `Mascotas ${mesActual}`, value: fmtNumero(data.kpis.mascotas_mes), icon: '🐾', color: 'text-indigo-700 bg-indigo-50' },
    { label: 'Cremaciones del mes', value: fmtNumero(data.kpis.cremaciones_mes), icon: '🔥', color: 'text-rose-700 bg-rose-50' },
    { label: 'Ciclos del mes', value: fmtNumero(data.kpis.ciclos_mes), icon: '♻️', color: 'text-orange-700 bg-orange-50' },
    { label: 'Stock petróleo', value: fmtLitros(data.kpis.stock_petroleo), icon: '⛽', color: data.kpis.stock_bajo ? 'text-red-700 bg-red-50' : 'text-blue-700 bg-blue-50', alert: data.kpis.stock_bajo },
    { label: 'Litros del mes', value: fmtLitros(data.kpis.litros_mes), icon: '🛢️', color: 'text-sky-700 bg-sky-50' },
  ]

  // KPIs financieros (solo admin)
  const kpisFinancieros = [
    { label: 'Ingresos del mes', value: fmtPrecio(data.kpis.ingresos_mes), icon: '💰', color: 'text-emerald-700 bg-emerald-50' },
    { label: 'Pagos pendientes', value: fmtNumero(data.kpis.pendientes_pago), icon: '💳', color: 'text-rose-700 bg-rose-50' },
    { label: 'Monto por cobrar', value: fmtPrecio(data.kpis.monto_pendiente), icon: '📋', color: 'text-amber-700 bg-amber-50' },
  ]

  const fmtDuracion = (mins: number): string => {
    if (mins <= 0) return '—'
    const h = Math.floor(mins / 60)
    const m = Math.round(mins % 60)
    return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m} min`
  }

  const ratiosArr = [
    { key: 'litros_por_mascota', label: 'Litros / mascota', value: data.ratios.litros_por_mascota.toFixed(1) + ' L', sub: 'consumo promedio por mascota' },
    { key: 'litros_por_ciclo', label: 'Litros / ciclo', value: data.ratios.litros_por_ciclo.toFixed(1) + ' L', sub: 'consumo promedio por ciclo' },
    { key: 'duracion_promedio_ciclo_min', label: 'Duración promedio ciclo', value: fmtDuracion(data.ratios.duracion_promedio_ciclo_min), sub: 'tiempo promedio de cada ciclo' },
    { key: 'costo_vehiculo_por_mascota', label: 'Costo vehículo / mascota', value: fmtPrecio(data.ratios.costo_vehiculo_por_mascota), sub: 'gasto combustible por mascota retirada' },
  ] as const

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-gray-500 text-xs sm:text-sm mt-0.5">Resumen operativo — {mesActual} {new Date().getFullYear()}</p>
      </div>

      {/* Timeline Status */}
      <TimelineStatus />

      {/* KPIs operativos */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3 sm:gap-4">
        {kpisOperativos.map(k => (
          <div key={k.label} className={`bg-white rounded-xl shadow-md border-2 p-4 sm:p-5 flex items-center gap-3 sm:gap-4 ${k.alert ? 'border-red-300' : 'border-gray-200'}`}>
            <div className={`shrink-0 inline-flex items-center justify-center w-11 h-11 sm:w-12 sm:h-12 rounded-xl text-xl sm:text-2xl ${k.color}`}>
              {k.icon}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-lg sm:text-xl font-bold text-gray-900 truncate">{k.value}</p>
              <p className="text-xs text-gray-500 mt-0.5 truncate">{k.label}</p>
              {k.alert && <p className="text-xs text-red-600 mt-0.5 font-medium">⚠ Stock bajo</p>}
            </div>
          </div>
        ))}
      </div>

      {/* KPIs financieros (solo admin) — antes de los ratios para tenerlos a la vista */}
      {isAdmin && (
        <div>
          <h2 className="text-xs sm:text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Indicadores financieros</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
            {kpisFinancieros.map(k => (
              <div key={k.label} className="bg-white rounded-xl shadow-md border-2 border-gray-200 p-4 sm:p-5 flex items-center gap-3 sm:gap-4">
                <div className={`shrink-0 inline-flex items-center justify-center w-11 h-11 sm:w-12 sm:h-12 rounded-xl text-xl sm:text-2xl ${k.color}`}>
                  {k.icon}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-lg sm:text-xl font-bold text-gray-900 truncate">{k.value}</p>
                  <p className="text-xs text-gray-500 mt-0.5 truncate">{k.label}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Ratios */}
      <div>
        <h2 className="text-xs sm:text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Ratios de eficiencia</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          {ratiosArr.map(r => (
            <button key={r.key} type="button" onClick={() => setRatioOpen(r.key)}
              className="text-left bg-white rounded-xl shadow-md border-2 border-gray-200 hover:border-indigo-400 hover:shadow-lg p-4 sm:p-5 transition-all">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-gray-600">{r.label}</p>
                <span className="text-xs text-indigo-500">📈</span>
              </div>
              <p className="text-lg sm:text-xl font-bold text-gray-900 mt-1">{r.value}</p>
              <p className="text-xs text-gray-500 mt-1 leading-tight">{r.sub}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
        {/* Mascotas ingresadas por mes (driver: fecha de retiro) */}
        <ChartCard title="Mascotas ingresadas por mes">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={data.ventas_por_mes} margin={{ bottom: 20, right: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="mes" fontSize={11} tick={{ fill: '#6b7280' }}
                interval={0} angle={-35} textAnchor="end" height={52} />
              <YAxis fontSize={11} tick={{ fill: '#6b7280' }} tickFormatter={v => fmtNumero(v as number)} />
              <Tooltip formatter={(v) => fmtNumero(v as number)} />
              <Bar dataKey="mascotas" fill="#10b981" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* Ciclos por mes (driver: fecha del ciclo) */}
        <ChartCard title="Ciclos por mes">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={data.ventas_por_mes} margin={{ bottom: 20, right: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="mes" fontSize={11} tick={{ fill: '#6b7280' }}
                interval={0} angle={-35} textAnchor="end" height={52} />
              <YAxis fontSize={11} tick={{ fill: '#6b7280' }} tickFormatter={v => fmtNumero(v as number)} />
              <Tooltip formatter={(v) => fmtNumero(v as number)} />
              <Bar dataKey="ciclos" fill="#f59e0b" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* Top servicios — leyenda al costado y gráfico centrado */}
        <ChartCard title="Tipos de servicio contratados">
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie data={data.top_servicios} dataKey="count" nameKey="codigo"
                cx="35%" cy="50%" outerRadius={80}
                label={({ value }) => value}>
                {data.top_servicios.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Pie>
              <Tooltip />
              <Legend layout="vertical" align="right" verticalAlign="middle"
                wrapperStyle={{ fontSize: '12px', paddingLeft: '8px' }} />
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* Por especie — leyenda al costado y gráfico centrado */}
        <ChartCard title="Mascotas por especie">
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie data={data.por_especie} dataKey="count" nameKey="especie"
                cx="35%" cy="50%" outerRadius={80}
                label={({ value }) => value}>
                {data.por_especie.map((_, i) => <Cell key={i} fill={COLORS[(i + 2) % COLORS.length]} />)}
              </Pie>
              <Tooltip />
              <Legend layout="vertical" align="right" verticalAlign="middle"
                wrapperStyle={{ fontSize: '12px', paddingLeft: '8px' }} />
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* Ventas por veterinaria (solo admin) */}
        {isAdmin && (
          <ChartCard title="Top veterinarias por ingresos">
            {data.ventas_por_vet.length === 0 ? (
              <EmptyChart label="Sin ventas a veterinarias aún" />
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={data.ventas_por_vet} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis type="number" fontSize={11} tick={{ fill: '#6b7280' }} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
                  <YAxis dataKey="vet" type="category" fontSize={11} width={110} tick={{ fill: '#6b7280' }} />
                  <Tooltip formatter={(v) => fmtPrecio(v as number)} />
                  <Bar dataKey="ingresos" fill="#8b5cf6" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </ChartCard>
        )}

        {/* Top productos */}
        <ChartCard title="Top productos adicionales vendidos">
          {data.top_productos.length === 0 ? (
            <EmptyChart label="Sin productos vendidos aún" />
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={data.top_productos} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis type="number" fontSize={11} tick={{ fill: '#6b7280' }} />
                <YAxis dataKey="nombre" type="category" fontSize={11} width={110} tick={{ fill: '#6b7280' }} />
                <Tooltip />
                <Bar dataKey="qty" fill="#f59e0b" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>

      {/* Top otros servicios (solo si hay datos) */}
      {data.top_otros_servicios.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
          <ChartCard title="Top servicios adicionales vendidos">
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={data.top_otros_servicios} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis type="number" fontSize={11} tick={{ fill: '#6b7280' }} />
                <YAxis dataKey="nombre" type="category" fontSize={11} width={110} tick={{ fill: '#6b7280' }} />
                <Tooltip />
                <Bar dataKey="qty" fill="#14b8a6" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        </div>
      )}

      {/* Modal evolución de ratios */}
      <Modal open={!!ratioOpen} onClose={() => setRatioOpen(null)}
        title={ratioOpen === 'litros_por_mascota' ? 'Litros / mascota — evolución'
          : ratioOpen === 'litros_por_ciclo' ? 'Litros / ciclo — evolución'
          : ratioOpen === 'costo_vehiculo_por_mascota' ? 'Costo vehículo / mascota — evolución'
          : ratioOpen === 'duracion_promedio_ciclo_min' ? 'Duración promedio del ciclo — evolución'
          : ''}>
        {ratioOpen && (
          <div>
            <p className="text-xs text-gray-500 mb-3">
              {ratioOpen === 'costo_vehiculo_por_mascota' ? 'Promedio mensual en pesos. '
                : ratioOpen === 'duracion_promedio_ciclo_min' ? 'Promedio mensual en minutos. '
                : 'Promedio mensual. '}
              Últimos {data.ratios_por_mes.length} mes{data.ratios_por_mes.length !== 1 ? 'es' : ''} con actividad (máx 12).
            </p>
            {data.ratios_por_mes.length === 0 ? (
              <div className="flex items-center justify-center h-[240px] text-sm text-gray-400">
                Sin datos históricos
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={320}>
                <LineChart data={data.ratios_por_mes} margin={{ bottom: 24, right: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="mes" fontSize={11} tick={{ fill: '#6b7280' }}
                    interval={0} angle={-35} textAnchor="end" height={56} />
                  <YAxis fontSize={11} tick={{ fill: '#6b7280' }}
                    tickFormatter={v => ratioOpen === 'costo_vehiculo_por_mascota' ? `$${(v / 1000).toFixed(0)}k`
                      : ratioOpen === 'duracion_promedio_ciclo_min' ? `${Math.round(v as number)}m`
                      : (v as number).toFixed(1)} />
                  <Tooltip formatter={(v) => ratioOpen === 'costo_vehiculo_por_mascota'
                    ? fmtPrecio(v as number)
                    : ratioOpen === 'duracion_promedio_ciclo_min'
                    ? fmtDuracion(v as number)
                    : `${(v as number).toFixed(2)}${ratioOpen?.startsWith('litros') ? ' L' : ''}`} />
                  <Line type="monotone" dataKey={ratioOpen} stroke="#6366f1" strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        )}
      </Modal>
    </div>
  )
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 sm:p-5">
      <h3 className="text-sm font-semibold text-gray-700 mb-4">{title}</h3>
      {children}
    </div>
  )
}

function EmptyChart({ label }: { label: string }) {
  return <div className="flex items-center justify-center h-[240px] text-sm text-gray-400">{label}</div>
}
