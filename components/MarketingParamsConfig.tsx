'use client'
import { useState, useEffect, useCallback } from 'react'
import type { MarketingParams } from '@/lib/marketing-params'

/**
 * Parámetros EDITABLES del plan de marketing (cadencia, pilares, ads) + el
 * interruptor del AUTOPILOTO (Etapa 1: auto-genera el plan semanal para tu
 * aprobación; nada se publica solo). Lee/escribe /api/mailing/agente/params.
 */
export default function MarketingParamsConfig() {
  const [p, setP] = useState<MarketingParams | null>(null)
  const [cargando, setCargando] = useState(true)
  const [guardando, setGuardando] = useState(false)
  const [generando, setGenerando] = useState(false)
  const [aviso, setAviso] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(null)

  const cargar = useCallback(async () => {
    setCargando(true)
    try {
      const res = await fetch('/api/mailing/agente/params')
      const data = await res.json()
      if (res.ok) setP(data)
      else setAviso({ tipo: 'error', texto: data?.error ?? 'No se pudieron cargar los parámetros.' })
    } catch (e) { setAviso({ tipo: 'error', texto: String(e) }) }
    finally { setCargando(false) }
  }, [])
  useEffect(() => { cargar() }, [cargar])

  function set<K extends keyof MarketingParams>(k: K, v: MarketingParams[K]) {
    setP(prev => (prev ? { ...prev, [k]: v } : prev))
  }
  const num = (v: string): number => (v === '' ? 0 : Math.max(0, parseInt(v, 10) || 0))
  const numOrNull = (v: string): number | null => (v.trim() === '' ? null : Math.max(0, parseInt(v, 10) || 0))

  async function guardar() {
    if (!p) return
    setGuardando(true); setAviso(null)
    try {
      const res = await fetch('/api/mailing/agente/params', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p),
      })
      const data = await res.json()
      if (res.ok) { setP(data); setAviso({ tipo: 'ok', texto: 'Parámetros guardados.' }) }
      else setAviso({ tipo: 'error', texto: data?.error ?? 'Error al guardar.' })
    } catch (e) { setAviso({ tipo: 'error', texto: String(e) }) }
    finally { setGuardando(false) }
  }

  async function generarAhora() {
    setGenerando(true); setAviso(null)
    try {
      const res = await fetch('/api/mailing/cron-autopiloto', { method: 'POST' })
      const d = await res.json()
      if (!res.ok) setAviso({ tipo: 'error', texto: d?.error ?? 'No se pudo ejecutar.' })
      else if (!d.activo) setAviso({ tipo: 'error', texto: 'El autopiloto está desactivado: activalo y guardá primero.' })
      else setAviso({ tipo: 'ok', texto: `Listo: planifiqué ${d.planificadas}, generé ${d.generadas}, quedan ${d.pendientes} por generar. Revisá en Campañas.` })
    } catch (e) { setAviso({ tipo: 'error', texto: String(e) }) }
    finally { setGenerando(false) }
  }

  if (cargando) return <div className="p-8 text-gray-400 text-sm">Cargando parámetros…</div>
  if (!p) return <div className="p-8 text-red-500 text-sm">No se pudieron cargar los parámetros.</div>

  const totalPct = p.pilares.reduce((s, x) => s + (x.pct || 0), 0)
  const inputCls = 'w-20 border border-gray-300 rounded-lg px-2 py-1 text-sm text-right focus:outline-none focus:ring-2 focus:ring-brand'

  return (
    <div className="space-y-4 max-w-3xl">
      {aviso && (
        <div className={`rounded-lg px-4 py-2 text-sm ${aviso.tipo === 'ok' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
          {aviso.texto}
        </div>
      )}

      {/* Autopiloto */}
      <div className="bg-white rounded-xl shadow-md border border-gray-300 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-300 flex items-start justify-between gap-4">
          <div>
            <h2 className="font-semibold text-gray-900">🤖 Autopiloto semanal</h2>
            <p className="text-xs text-gray-500 mt-0.5 max-w-xl">Genera el plan de la semana siguiente y prepara las piezas <strong>para tu aprobación</strong>. Nada se publica ni se programa solo: apruebas y programas tú en Campañas. Las piezas con observaciones de QA quedan marcadas.</p>
          </div>
          <button
            onClick={() => set('autopiloto_activo', !p.autopiloto_activo)}
            role="switch" aria-checked={p.autopiloto_activo}
            className={`shrink-0 relative inline-flex h-7 w-12 items-center rounded-full transition-colors ${p.autopiloto_activo ? 'bg-emerald-500' : 'bg-gray-300'}`}>
            <span className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${p.autopiloto_activo ? 'translate-x-6' : 'translate-x-1'}`} />
          </button>
        </div>
        <div className="p-5 flex flex-wrap items-center gap-3">
          <span className={`text-sm font-medium ${p.autopiloto_activo ? 'text-emerald-700' : 'text-gray-500'}`}>{p.autopiloto_activo ? 'Activado' : 'Desactivado'}</span>
          <button onClick={generarAhora} disabled={generando || !p.autopiloto_activo}
            className="ml-auto bg-brand hover:bg-brand-dark disabled:opacity-40 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
            {generando ? 'Generando…' : 'Generar plan ahora'}
          </button>
        </div>
      </div>

      {/* Cadencia */}
      <div className="bg-white rounded-xl shadow-md border border-gray-300 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-300">
          <h2 className="font-semibold text-gray-900">Cadencia de publicación</h2>
          <p className="text-xs text-gray-400 mt-0.5">Cuánto contenido por semana/mes. El planner reparte el calendario según esto.</p>
        </div>
        <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
          <Row label="Instagram · posts/semana"><input type="number" min={0} className={inputCls} value={p.ig_posts_semana} onChange={e => set('ig_posts_semana', num(e.target.value))} /></Row>
          <Row label="…de esos, carruseles"><input type="number" min={0} className={inputCls} value={p.ig_carruseles_semana} onChange={e => set('ig_carruseles_semana', num(e.target.value))} /></Row>
          <Row label="Facebook · posts/semana"><input type="number" min={0} className={inputCls} value={p.fb_posts_semana} onChange={e => set('fb_posts_semana', num(e.target.value))} /></Row>
          <Row label="Email a veterinarios · por mes"><input type="number" min={0} className={inputCls} value={p.email_por_mes} onChange={e => set('email_por_mes', num(e.target.value))} /></Row>
          <Row label="Horarios (HH:MM, separados por coma)"><input type="text" className="w-40 border border-gray-300 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-brand" value={p.horarios_publicacion.join(', ')} onChange={e => set('horarios_publicacion', e.target.value.split(',').map(s => s.trim()).filter(Boolean))} /></Row>
          <Row label="Venta directa máxima (%)"><input type="number" min={0} max={100} className={inputCls} value={p.venta_directa_max_pct} onChange={e => set('venta_directa_max_pct', num(e.target.value))} /></Row>
        </div>
      </div>

      {/* Pilares */}
      <div className="bg-white rounded-xl shadow-md border border-gray-300 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-300 flex items-center justify-between">
          <div>
            <h2 className="font-semibold text-gray-900">Pilares editoriales (mix %)</h2>
            <p className="text-xs text-gray-400 mt-0.5">Cómo se reparten los temas. Ideal que sumen ~100%.</p>
          </div>
          <span className={`text-xs font-semibold ${totalPct === 100 ? 'text-emerald-600' : 'text-amber-600'}`}>Total: {totalPct}%</span>
        </div>
        <div className="p-5 space-y-2">
          {p.pilares.map((pil, i) => (
            <div key={pil.key} className="flex items-center gap-3">
              <span className="flex-1 text-sm text-gray-700">{pil.label}</span>
              <input type="number" min={0} max={100} className={inputCls}
                value={pil.pct}
                onChange={e => set('pilares', p.pilares.map((x, j) => j === i ? { ...x, pct: num(e.target.value) } : x))} />
              <span className="text-xs text-gray-400 w-4">%</span>
            </div>
          ))}
        </div>
      </div>

      {/* Ads (pendiente) */}
      <div className="bg-white rounded-xl shadow-md border border-gray-300 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-300">
          <h2 className="font-semibold text-gray-900">Publicidad pagada (pendiente de activar)</h2>
          <p className="text-xs text-gray-400 mt-0.5">Aún no se invierte en ads. Definí tus objetivos en CLP para cuando lo activemos; sin presupuesto, el agente no propone gasto.</p>
        </div>
        <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
          <Row label="CPA objetivo (CLP)"><input type="number" min={0} placeholder="—" className={inputCls} value={p.cpa_objetivo_clp ?? ''} onChange={e => set('cpa_objetivo_clp', numOrNull(e.target.value))} /></Row>
          <Row label="CPL objetivo (CLP)"><input type="number" min={0} placeholder="—" className={inputCls} value={p.cpl_objetivo_clp ?? ''} onChange={e => set('cpl_objetivo_clp', numOrNull(e.target.value))} /></Row>
          <Row label="Presupuesto mensual (CLP)"><input type="number" min={0} placeholder="—" className="w-32 border border-gray-300 rounded-lg px-2 py-1 text-sm text-right focus:outline-none focus:ring-2 focus:ring-brand" value={p.presupuesto_mensual_clp ?? ''} onChange={e => set('presupuesto_mensual_clp', numOrNull(e.target.value))} /></Row>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button onClick={guardar} disabled={guardando}
          className="bg-brand hover:bg-brand-dark disabled:opacity-40 text-white px-5 py-2 rounded-lg text-sm font-medium transition-colors">
          {guardando ? 'Guardando…' : 'Guardar parámetros'}
        </button>
      </div>
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-gray-700">{label}</span>
      {children}
    </div>
  )
}
