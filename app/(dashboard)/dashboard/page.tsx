'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'

type KPIs = {
  total_cremaciones_mes: number
  pendientes: number
  ciclos_mes: number
  litros_mes: number
  ingresos_mes: number
}

export default function DashboardPage() {
  const [kpis, setKpis] = useState<KPIs | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const now = new Date()
    fetch(`/api/reportes?mes=${now.getMonth() + 1}&anio=${now.getFullYear()}`)
      .then(r => r.json())
      .then(d => {
        setKpis(d.kpis ?? null)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  const fmt = (n: number) => `$${n.toLocaleString('es-CL')}`
  const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']
  const mesActual = MESES[new Date().getMonth()]

  const accesos = [
    { href: '/clientes', icon: '🐾', label: 'Clientes', desc: 'Fichas de mascotas' },
    { href: '/servicios', icon: '💼', label: 'Servicios', desc: 'Precios y adicionales' },
    { href: '/operaciones', icon: '🔥', label: 'Operaciones', desc: 'Ciclos de cremación' },
    { href: '/bases', icon: '⚙️', label: 'Bases', desc: 'Configuración general' },
    { href: '/reportes', icon: '📈', label: 'Reportes', desc: 'Análisis y exportación' },
  ]

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-gray-500 text-sm mt-0.5">Resumen — {mesActual} {new Date().getFullYear()}</p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-5 gap-4">
        {loading ? (
          Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 animate-pulse">
              <div className="h-8 bg-gray-100 rounded w-16 mb-2" />
              <div className="h-3 bg-gray-100 rounded w-24" />
            </div>
          ))
        ) : (
          [
            { label: 'Cremaciones del mes', value: kpis?.total_cremaciones_mes ?? 0, icon: '🐾', color: 'text-indigo-700 bg-indigo-50' },
            { label: 'Pendientes', value: kpis?.pendientes ?? 0, icon: '⏳', color: 'text-yellow-700 bg-yellow-50' },
            { label: 'Ciclos realizados', value: kpis?.ciclos_mes ?? 0, icon: '🔥', color: 'text-orange-700 bg-orange-50' },
            { label: 'Litros petróleo', value: `${kpis?.litros_mes ?? 0} L`, icon: '⛽', color: 'text-blue-700 bg-blue-50' },
            { label: 'Ingresos estimados', value: fmt(kpis?.ingresos_mes ?? 0), icon: '💰', color: 'text-green-700 bg-green-50' },
          ].map(k => (
            <div key={k.label} className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
              <div className={`inline-flex items-center justify-center w-9 h-9 rounded-lg text-lg ${k.color} mb-3`}>
                {k.icon}
              </div>
              <p className="text-2xl font-bold text-gray-900">{k.value}</p>
              <p className="text-xs text-gray-500 mt-1">{k.label}</p>
            </div>
          ))
        )}
      </div>

      {/* Accesos rápidos */}
      <div>
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Accesos rápidos</h2>
        <div className="grid grid-cols-5 gap-4">
          {accesos.map(a => (
            <Link
              key={a.href}
              href={a.href}
              className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 hover:border-indigo-200 hover:shadow-md transition-all group"
            >
              <div className="text-2xl mb-3">{a.icon}</div>
              <p className="text-sm font-semibold text-gray-900 group-hover:text-indigo-700">{a.label}</p>
              <p className="text-xs text-gray-500 mt-0.5">{a.desc}</p>
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}
