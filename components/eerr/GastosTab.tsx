'use client'
import { useState } from 'react'
import FacturasSiiTab from './FacturasSiiTab'
import GastosManualesTab from './GastosManualesTab'

const SUBS = [
  { key: 'facturas', label: '📄 Facturas (SII)' },
  { key: 'manuales', label: '✍ Manuales' },
] as const

export default function GastosTab() {
  const [sub, setSub] = useState<string>('facturas')
  return (
    <div className="space-y-4">
      <div className="flex gap-2 flex-wrap">
        {SUBS.map(s => (
          <button
            key={s.key}
            onClick={() => setSub(s.key)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              sub === s.key ? 'bg-indigo-600 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>
      {sub === 'facturas' ? <FacturasSiiTab /> : <GastosManualesTab />}
    </div>
  )
}
