'use client'
import { useState, useEffect, useCallback } from 'react'
import { formatDateTime } from '@/lib/dates'

type Cfg = { instrucciones: string; calibracion: string; updated_at: string | null }

/** Configuración del agente de Marketing (el del calendario/agente de Campañas).
 *  Espeja a AgentesConfig (WhatsApp) pero contra /api/mailing/agente/config. */
export default function MarketingAgenteConfig() {
  const [cargando, setCargando] = useState(true)
  const [cfg, setCfg] = useState<Cfg | null>(null)
  const [instrucciones, setInstrucciones] = useState('')
  const [calibracion, setCalibracion] = useState('')
  const [guardandoInstr, setGuardandoInstr] = useState(false)
  const [guardandoCalib, setGuardandoCalib] = useState(false)
  const [aviso, setAviso] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(null)

  const cargar = useCallback(async () => {
    setCargando(true)
    try {
      const res = await fetch('/api/mailing/agente/config')
      const data = await res.json()
      if (res.ok) { setCfg(data); setInstrucciones(data.instrucciones ?? ''); setCalibracion(data.calibracion ?? '') }
      else setAviso({ tipo: 'error', texto: data?.error ?? 'No se pudo cargar la configuración.' })
    } catch (e) { setAviso({ tipo: 'error', texto: String(e) }) }
    finally { setCargando(false) }
  }, [])
  useEffect(() => { cargar() }, [cargar])

  async function guardar(patch: { instrucciones?: string; calibracion?: string }, which: 'instr' | 'calib') {
    which === 'instr' ? setGuardandoInstr(true) : setGuardandoCalib(true)
    setAviso(null)
    try {
      const res = await fetch('/api/mailing/agente/config', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
      })
      const data = await res.json()
      if (res.ok) { setCfg(data); setAviso({ tipo: 'ok', texto: 'Guardado.' }) }
      else setAviso({ tipo: 'error', texto: data?.error ?? 'Error al guardar.' })
    } catch (e) { setAviso({ tipo: 'error', texto: String(e) }) }
    finally { which === 'instr' ? setGuardandoInstr(false) : setGuardandoCalib(false) }
  }

  if (cargando) return <div className="p-8 text-gray-400 text-sm">Cargando…</div>

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="bg-violet-50 border border-violet-100 rounded-xl px-5 py-3 text-sm text-violet-900">
        🧠 El <strong>agente de Marketing</strong> propone el plan de campañas, redacta las piezas y arma el calendario (en <strong>Campañas</strong>). Acá lo afinás: dale <strong>instrucciones</strong> con efecto inmediato (tono, horarios de publicación, qué priorizar, cómo hablar).
      </div>

      {aviso && (
        <div className={`rounded-lg px-4 py-2 text-sm ${aviso.tipo === 'ok' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
          {aviso.texto}
        </div>
      )}

      {/* Instrucciones */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900">Instrucciones al agente</h2>
          <p className="text-xs text-gray-400 mt-0.5">En lenguaje natural, con prioridad sobre su guion base. Ej.: «Publicá los posts a las 19:00», «Tono más cercano», «Priorizá captación de veterinarios este mes».</p>
        </div>
        <div className="p-5 space-y-3">
          <textarea value={instrucciones} onChange={e => setInstrucciones(e.target.value)} rows={6}
            placeholder="Escribí acá indicaciones para el agente de marketing…"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-y" />
          <div className="flex items-center gap-3">
            <button onClick={() => guardar({ instrucciones }, 'instr')} disabled={guardandoInstr || instrucciones === (cfg?.instrucciones ?? '')}
              className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
              {guardandoInstr ? 'Guardando…' : 'Guardar instrucciones'}
            </button>
            {instrucciones !== (cfg?.instrucciones ?? '') && <span className="text-xs text-amber-600">Cambios sin guardar</span>}
          </div>
        </div>
      </div>

      {/* Guía de marca y tono (texto libre, editable) */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900">Guía de marca y tono</h2>
          <p className="text-xs text-gray-400 mt-0.5">Notas de estilo que el agente usa al redactar (voz, qué sí / qué no, ejemplos). Texto libre.</p>
        </div>
        <div className="p-5 space-y-3">
          <textarea value={calibracion} onChange={e => setCalibracion(e.target.value)} rows={10}
            placeholder="Ej.: Voz cercana y profesional, sin clichés del rubro. Evitar «puente del arcoíris». La mascota va por su nombre…"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-y" />
          <div className="flex items-center gap-3">
            <button onClick={() => guardar({ calibracion }, 'calib')} disabled={guardandoCalib || calibracion === (cfg?.calibracion ?? '')}
              className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
              {guardandoCalib ? 'Guardando…' : 'Guardar guía'}
            </button>
            {calibracion !== (cfg?.calibracion ?? '') && <span className="text-xs text-amber-600">Cambios sin guardar</span>}
          </div>
        </div>
      </div>

      <p className="text-[11px] text-gray-400">Última actualización: {formatDateTime(cfg?.updated_at ?? null) || '—'}</p>
    </div>
  )
}
