'use client'
import { useState } from 'react'
import { PageHeader, Tabs } from '@/components/ui/kit'
import LiquidacionesTab from '@/components/remuneraciones/LiquidacionesTab'
import EmpleadosTab from '@/components/remuneraciones/EmpleadosTab'
import ParametrosTab from '@/components/remuneraciones/ParametrosTab'
import CotizacionesTab from '@/components/remuneraciones/CotizacionesTab'
import HistoricoTab from '@/components/remuneraciones/HistoricoTab'

type TabKey = 'liquidaciones' | 'empleados' | 'parametros' | 'cotizaciones' | 'historico'

const TABS: { key: TabKey; label: string }[] = [
  { key: 'liquidaciones', label: '💵 Liquidaciones' },
  { key: 'empleados', label: '👥 Empleados' },
  { key: 'parametros', label: '⚖️ Parámetros legales' },
  { key: 'cotizaciones', label: '🏦 Cotizaciones' },
  { key: 'historico', label: '📚 Histórico' },
]

export default function RemuneracionesPage() {
  const [tab, setTab] = useState<TabKey>('liquidaciones')

  return (
    <div className="space-y-5">
      <PageHeader
        icon={<span className="text-2xl">💰</span>}
        title="Remuneraciones"
        subtitle="Liquidaciones de sueldo mes a mes, con los parámetros legales al día"
      />
      <Tabs tabs={TABS} value={tab} onChange={k => setTab(k as TabKey)} />

      {tab === 'liquidaciones' && <LiquidacionesTab />}
      {tab === 'empleados' && <EmpleadosTab />}
      {tab === 'parametros' && <ParametrosTab />}
      {tab === 'cotizaciones' && <CotizacionesTab />}
      {tab === 'historico' && <HistoricoTab />}
    </div>
  )
}
