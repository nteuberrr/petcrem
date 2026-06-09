'use client'
import { useState, useEffect, useCallback } from 'react'
import { formatDateTime } from '@/lib/dates'

type Cfg = {
  instrucciones: string
  calibracion: string
  calibracion_at: string | null
  calibracion_muestra: number | null
  updated_at: string | null
}

function fmtFechaHora(iso: string | null): string {
  return formatDateTime(iso) || '—' // dd-mm-yyyy HH:MM
}

export default function AgentesConfig() {
  const [cargando, setCargando] = useState(true)
  const [cfg, setCfg] = useState<Cfg | null>(null)
  const [instrucciones, setInstrucciones] = useState('')
  const [calibracion, setCalibracion] = useState('')
  const [guardandoInstr, setGuardandoInstr] = useState(false)
  const [guardandoCalib, setGuardandoCalib] = useState(false)
  const [calibrando, setCalibrando] = useState(false)
  const [aviso, setAviso] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(null)

  const cargar = useCallback(async () => {
    setCargando(true)
    try {
      const res = await fetch('/api/mensajes/agente')
      const data = await res.json()
      if (res.ok) {
        setCfg(data)
        setInstrucciones(data.instrucciones ?? '')
        setCalibracion(data.calibracion ?? '')
      } else {
        setAviso({ tipo: 'error', texto: data?.error ?? 'No se pudo cargar la configuración.' })
      }
    } catch (e) {
      setAviso({ tipo: 'error', texto: String(e) })
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => { cargar() }, [cargar])

  async function guardar(patch: { instrucciones?: string; calibracion?: string }, which: 'instr' | 'calib') {
    which === 'instr' ? setGuardandoInstr(true) : setGuardandoCalib(true)
    setAviso(null)
    try {
      const res = await fetch('/api/mensajes/agente', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
      })
      const data = await res.json()
      if (res.ok) { setCfg(data); setAviso({ tipo: 'ok', texto: 'Guardado.' }) }
      else setAviso({ tipo: 'error', texto: data?.error ?? 'Error al guardar.' })
    } catch (e) {
      setAviso({ tipo: 'error', texto: String(e) })
    } finally {
      which === 'instr' ? setGuardandoInstr(false) : setGuardandoCalib(false)
    }
  }

  async function calibrar() {
    if (!confirm('Voy a analizar una muestra de las conversaciones (históricas y nuevas) con la IA para regenerar la guía de calibración. Esto puede tardar ~30 segundos y reemplaza la calibración actual. ¿Continuar?')) return
    setCalibrando(true)
    setAviso(null)
    try {
      const res = await fetch('/api/mensajes/agente/calibrar', { method: 'POST' })
      const data = await res.json()
      if (res.ok) {
        setCfg(data)
        setCalibracion(data.calibracion ?? '')
        setAviso({ tipo: 'ok', texto: `Calibración lista (analizó ${data.calibracion_muestra ?? '—'} conversaciones).` })
      } else {
        setAviso({ tipo: 'error', texto: data?.error ?? 'Error al calibrar.' })
      }
    } catch (e) {
      setAviso({ tipo: 'error', texto: String(e) })
    } finally {
      setCalibrando(false)
    }
  }

  if (cargando) return <div className="p-8 text-gray-400 text-sm">Cargando…</div>

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="bg-indigo-50 border border-indigo-100 rounded-xl px-5 py-3 text-sm text-indigo-900">
        🤖 El <strong>agente de WhatsApp</strong> responde solo a los clientes usando el flujo de atención + los precios en vivo. Aquí lo afinas: dale <strong>instrucciones</strong> y/o <strong>calíbralo</strong> con las conversaciones reales.
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
          <p className="text-xs text-gray-400 mt-0.5">En lenguaje natural. Tienen efecto inmediato y prioridad sobre su guion base (salvo no inventar precios y escalar reclamos). Ej.: «Cuando pregunten por convenios, ofrece hablar con el equipo», «Sé más breve».</p>
        </div>
        <div className="p-5 space-y-3">
          <textarea value={instrucciones} onChange={e => setInstrucciones(e.target.value)} rows={6}
            placeholder="Escribe aquí indicaciones para el agente…"
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

      {/* Calibración */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex items-start justify-between gap-3">
          <div>
            <h2 className="font-semibold text-gray-900">Calibración con conversaciones reales</h2>
            <p className="text-xs text-gray-400 mt-0.5">La IA analiza una muestra de los chats (históricos <strong>y</strong> los nuevos que van entrando) y arma una guía de tono y respuestas. Puedes editarla a mano.</p>
            <p className="text-[11px] text-gray-400 mt-1">
              Última calibración: <strong>{fmtFechaHora(cfg?.calibracion_at ?? null)}</strong>
              {cfg?.calibracion_muestra ? ` · ${cfg.calibracion_muestra} conversaciones` : ''}
            </p>
          </div>
          <button onClick={calibrar} disabled={calibrando}
            className="shrink-0 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
            {calibrando ? 'Calibrando…' : '✨ Calibrar ahora'}
          </button>
        </div>
        <div className="p-5 space-y-3">
          <textarea value={calibracion} onChange={e => setCalibracion(e.target.value)} rows={12}
            placeholder="Aún no hay calibración. Presiona «Calibrar ahora» para generarla a partir de las conversaciones."
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono leading-relaxed focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-y" />
          <div className="flex items-center gap-3">
            <button onClick={() => guardar({ calibracion }, 'calib')} disabled={guardandoCalib || calibracion === (cfg?.calibracion ?? '')}
              className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
              {guardandoCalib ? 'Guardando…' : 'Guardar calibración'}
            </button>
            {calibracion !== (cfg?.calibracion ?? '') && <span className="text-xs text-amber-600">Cambios sin guardar</span>}
          </div>
        </div>
      </div>

      <p className="text-[11px] text-gray-400">Última actualización: {fmtFechaHora(cfg?.updated_at ?? null)}</p>
    </div>
  )
}
