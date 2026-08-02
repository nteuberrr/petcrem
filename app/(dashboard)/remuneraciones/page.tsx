'use client'
import { useState, type ReactNode } from 'react'
import { PageHeader, Tabs } from '@/components/ui/kit'
import { Banknote, Users, Scale, Landmark, Library, HandCoins } from 'lucide-react'
import LiquidacionesTab from '@/components/remuneraciones/LiquidacionesTab'
import EmpleadosTab from '@/components/remuneraciones/EmpleadosTab'
import ParametrosTab from '@/components/remuneraciones/ParametrosTab'
import CotizacionesTab from '@/components/remuneraciones/CotizacionesTab'
import HistoricoTab from '@/components/remuneraciones/HistoricoTab'

type TabKey = 'liquidaciones' | 'empleados' | 'parametros' | 'cotizaciones' | 'historico'

const TABS: { key: TabKey; label: ReactNode }[] = [
  { key: 'liquidaciones', label: <><Banknote className="w-4 h-4" aria-hidden="true" /> Liquidaciones</> },
  { key: 'empleados', label: <><Users className="w-4 h-4" aria-hidden="true" /> Empleados</> },
  { key: 'parametros', label: <><Scale className="w-4 h-4" aria-hidden="true" /> Parámetros legales</> },
  { key: 'cotizaciones', label: <><Landmark className="w-4 h-4" aria-hidden="true" /> Cotizaciones</> },
  { key: 'historico', label: <><Library className="w-4 h-4" aria-hidden="true" /> Histórico</> },
]

export default function RemuneracionesPage() {
  const [tab, setTab] = useState<TabKey>('liquidaciones')

  return (
    <div className="space-y-5">
      <PageHeader
        icon={<HandCoins className="w-7 h-7 text-brand" aria-hidden="true" />}
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
