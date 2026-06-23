'use client'
import { useState } from 'react'
import ParametrosTab from '@/components/eerr/ParametrosTab'
import ProveedoresTab from '@/components/eerr/ProveedoresTab'
import GastosTab from '@/components/eerr/GastosTab'
import EerrIntegralTab from '@/components/eerr/EerrIntegralTab'

const TABS = [
  { key: 'eerr', label: 'EERR Integral' },
  { key: 'gastos', label: 'Compras' },
  { key: 'parametros', label: 'Parámetros' },
  { key: 'proveedores', label: 'Proveedores' },
] as const

export default function EstadoResultadosPage() {
  const [tab, setTab] = useState<string>('eerr')

  return (
    <div className="max-w-6xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-1">Estado de Resultados</h1>
      <p className="text-sm text-gray-500 mb-5">Resultado del crematorio por mes: ingresos, costos y gastos (en neto).</p>

      <div className="flex gap-2 flex-wrap mb-6">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              tab === t.key ? 'bg-indigo-600 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'eerr' && <EerrIntegralTab />}
      {tab === 'gastos' && <GastosTab />}
      {tab === 'parametros' && <ParametrosTab />}
      {tab === 'proveedores' && <ProveedoresTab />}
    </div>
  )
}
