'use client'
import { useState } from 'react'
import AgentesConfig from '@/components/AgentesConfig'
import MarketingAgenteConfig from '@/components/MarketingAgenteConfig'

/** Pestaña "Agentes" de Configuración Avanzada: alterna entre la config del agente
 *  de WhatsApp (inbox) y la del agente de Marketing (Campañas). */
export default function AgentesPanel() {
  const [sub, setSub] = useState<'whatsapp' | 'marketing'>('whatsapp')
  return (
    <div className="space-y-4">
      <div className="inline-flex gap-1 bg-gray-100 border border-gray-200 rounded-lg p-1">
        {([['whatsapp', '💬 WhatsApp'], ['marketing', '🧠 Marketing']] as const).map(([k, label]) => (
          <button key={k} onClick={() => setSub(k)}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${sub === k ? 'bg-indigo-600 text-white' : 'text-gray-600 hover:bg-white'}`}>
            {label}
          </button>
        ))}
      </div>
      {sub === 'whatsapp' ? <AgentesConfig /> : <MarketingAgenteConfig />}
    </div>
  )
}
