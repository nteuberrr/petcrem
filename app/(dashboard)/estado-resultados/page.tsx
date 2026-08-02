'use client'
import { useState } from 'react'
import ParametrosTab from '@/components/eerr/ParametrosTab'
import ProveedoresTab from '@/components/eerr/ProveedoresTab'
import GastosTab from '@/components/eerr/GastosTab'
import EerrIntegralTab from '@/components/eerr/EerrIntegralTab'
import { PageHeader, Tabs } from '@/components/ui/kit'

const TABS = [
  { key: 'eerr', label: 'EERR Integral' },
  { key: 'gastos', label: 'Compras' },
  { key: 'parametros', label: 'Parámetros' },
  { key: 'proveedores', label: 'Proveedores' },
] as const

export default function EstadoResultadosPage() {
  const [tab, setTab] = useState<string>('eerr')

  return (
    <div className="max-w-6xl mx-auto space-y-4">
      <PageHeader
        title="Estado de Resultados"
        subtitle="Resultado del crematorio por mes: ingresos, costos y gastos (en neto)."
      />

      <Tabs tabs={TABS.map(t => ({ key: t.key as string, label: t.label }))} value={tab} onChange={setTab} className="mb-2" />

      {tab === 'eerr' && <EerrIntegralTab />}
      {tab === 'gastos' && <GastosTab />}
      {tab === 'parametros' && <ParametrosTab />}
      {tab === 'proveedores' && <ProveedoresTab />}
    </div>
  )
}
