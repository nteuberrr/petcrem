'use client'
import { useCallback, useEffect, useState } from 'react'
import { Card, Button } from '@/components/ui/kit'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { TableSkeleton } from '@/components/ui/Skeleton'
import { fmtPrecio } from '@/lib/format'
import { useAccionUnica } from '@/lib/use-accion-unica'
import { InfoTip } from '@/components/ui/InfoTip'
import { NOMBRES_AFP } from '@/lib/remuneraciones/tablas'
import type { Parametros } from './tipos-ui'
import { moverPeriodo, nombrePeriodo, periodoActual } from './tipos-ui'

type Fila = Parametros & { dias_habiles: number | null; dias_descanso: number | null; notas: string }

interface Indicadores {
  uf: { valor: number; fecha: string; provisional: boolean } | null
  utm: { valor: number; fecha: string; provisional: boolean } | null
  avisos: string[]
}

export default function ParametrosTab() {
  const [filas, setFilas] = useState<Fila[] | null>(null)
  const [editando, setEditando] = useState<string | null>(null)
  const [err, setErr] = useState('')

  const cargar = useCallback(async () => {
    try {
      const r = await fetch('/api/remuneraciones/parametros', { cache: 'no-store' })
      const d = await r.json()
      if (!r.ok) { setErr(d.error || 'No se pudo cargar'); setFilas([]) }
      else setFilas(d.periodos || [])
    } catch { setErr('Error de red'); setFilas([]) }
  }, [])

  useEffect(() => { cargar() }, [cargar])

  const actual = periodoActual()
  const faltaActual = filas ? !filas.some(f => f.periodo === actual) : false

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-brand">
            Valores legales por mes
            <InfoTip titulo="Por qué esto vive por período">
              Los topes imponibles se reajustan todos los años y el aporte previsional del empleador sube por tramos
              hasta 2033: guardar los valores mes a mes es lo que impide que el módulo quede desactualizado como el
              Excel.
              <br /><br />
              <b>La UF y la UTM se traen solas</b> del Banco Central y el SII (vía mindicador.cl). Un cron diario deja
              el mes en curso al día y vuelve a buscar la UF definitiva cuando el mes cierra. Nunca pisa un valor que
              hayas corregido a mano.
              <br /><br />
              <b>Ojo con agosto 2026:</b> desde las remuneraciones de este mes el aporte del empleador pasa de 1% a
              3,5% y absorbe el SIS, que deja de pagarse por separado.
            </InfoTip>
          </h2>
          <Button variant="primary" onClick={() => setEditando(actual)}>+ Cargar un período</Button>
        </div>

        {faltaActual && (
          <div className="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            Todavía no están cargados los parámetros de <b className="capitalize">{nombrePeriodo(actual)}</b>.{' '}
            <button className="underline" onClick={() => setEditando(actual)}>Cargarlos ahora</button>.
          </div>
        )}
      </Card>

      {err && <Card className="border-red-300 bg-red-50 p-4 text-sm text-red-700">{err}</Card>}
      {!filas && <TableSkeleton rows={4} />}

      {filas && filas.length === 0 && (
        <Card className="p-8 text-center text-sm text-gray-600">Todavía no hay períodos cargados.</Card>
      )}

      {filas && filas.length > 0 && (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead>
              <tr className="border-b border-gray-300 bg-cream text-left text-xs uppercase tracking-wide text-gray-600">
                <th className="px-4 py-3">Período</th>
                <th className="px-3 text-right">UF</th>
                <th className="px-3 text-right">UTM</th>
                <th className="px-3 text-right">Mínimo</th>
                <th className="px-3 text-right">Tope AFP</th>
                <th className="px-3 text-right">Tope AFC</th>
                <th className="px-3">Aporte empleador</th>
                <th className="px-3"></th>
              </tr>
            </thead>
            <tbody>
              {filas.map(f => {
                const completo = f.valor_uf > 0 && f.valor_utm > 0
                return (
                  <tr key={f.periodo} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="px-4 py-2.5">
                      <span className="font-medium capitalize text-gray-900">{nombrePeriodo(f.periodo)}</span>
                      {!completo && <span className="ml-2"><Badge variant="yellow">incompleto</Badge></span>}
                    </td>
                    <td className="px-3 text-right tabular-nums">{f.valor_uf ? fmtPrecio(f.valor_uf) : '—'}</td>
                    <td className="px-3 text-right tabular-nums">{f.valor_utm ? fmtPrecio(f.valor_utm) : '—'}</td>
                    <td className="px-3 text-right tabular-nums">{fmtPrecio(f.imm)}</td>
                    <td className="px-3 text-right tabular-nums">{f.tope_afp_uf} UF</td>
                    <td className="px-3 text-right tabular-nums">{f.tope_afc_uf} UF</td>
                    <td className="px-3 text-xs text-gray-600">
                      {[
                        f.tasa_sis ? `SIS ${f.tasa_sis}%` : '',
                        f.tasa_seguro_social ? `Seg. social ${f.tasa_seguro_social}%` : '',
                        `cta. ${f.tasa_cuenta_individual}%`,
                        `FAPP ${f.tasa_fapp}%`,
                      ].filter(Boolean).join(' · ')}
                    </td>
                    <td className="px-3 text-right">
                      <Button variant="ghost" onClick={() => setEditando(f.periodo)}>Editar</Button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </Card>
      )}

      {editando && (
        <ModalParametros
          periodo={editando}
          onCerrar={() => setEditando(null)}
          onGuardado={async () => { setEditando(null); await cargar() }}
        />
      )}
    </div>
  )
}

function ModalParametros({ periodo: periodoInicial, onCerrar, onGuardado }: {
  periodo: string; onCerrar: () => void; onGuardado: () => Promise<void>
}) {
  const [periodo, setPeriodo] = useState(periodoInicial)
  const [f, setF] = useState<(Parametros & { dias_habiles: number | null; dias_descanso: number | null; notas: string }) | null>(null)
  const [existe, setExiste] = useState(false)
  const [err, setErr] = useState('')
  const [ind, setInd] = useState<Indicadores | null>(null)
  const [trayendo, setTrayendo] = useState(false)
  const { ejecutar, procesando } = useAccionUnica()

  /** Consulta la UF y la UTM del período y las deja en el formulario. */
  async function traerIndicadores() {
    setTrayendo(true); setErr('')
    try {
      const r = await fetch(`/api/remuneraciones/indicadores?periodo=${periodo}`, { cache: 'no-store' })
      const d = await r.json()
      if (!r.ok) { setErr(d.error || 'No se pudieron traer los indicadores'); return }
      setInd(d)
      setF(prev => (prev ? {
        ...prev,
        valor_uf: d.uf?.valor ?? prev.valor_uf,
        valor_utm: d.utm?.valor ?? prev.valor_utm,
      } : prev))
    } catch {
      setErr('No pude conectarme a la fuente de indicadores.')
    } finally {
      setTrayendo(false)
    }
  }

  const cargar = useCallback(async (p: string) => {
    setF(null); setErr('')
    const r = await fetch(`/api/remuneraciones/parametros?periodo=${p}`, { cache: 'no-store' })
    const d = await r.json()
    const base = d.parametros || d.sugerido
    setExiste(!!d.parametros)
    setF({
      ...base,
      dias_habiles: d.calendario?.dias_habiles ?? null,
      dias_descanso: d.calendario?.dias_descanso ?? null,
      notas: d.notas || '',
    })
  }, [])

  useEffect(() => { cargar(periodo) }, [cargar, periodo])

  async function duplicar() {
    setErr('')
    const anterior = moverPeriodo(periodo, -1)
    const r = await fetch(`/api/remuneraciones/parametros?periodo=${anterior}`, { cache: 'no-store' })
    const d = await r.json()
    if (!d.parametros) { setErr(`No hay parámetros cargados para ${nombrePeriodo(anterior)}.`); return }
    setF(prev => ({ ...d.parametros, periodo, dias_habiles: prev?.dias_habiles ?? null, dias_descanso: prev?.dias_descanso ?? null, notas: prev?.notas || '' }))
  }

  async function guardar() {
    if (!f) return
    setErr('')
    const r = await fetch('/api/remuneraciones/parametros', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...f, periodo }),
    })
    const d = await r.json().catch(() => ({}))
    if (!r.ok) { setErr(d.error || 'No se pudo guardar'); return }
    await onGuardado()
  }

  const set = (k: keyof Parametros, v: number) => setF(prev => (prev ? { ...prev, [k]: v } : prev))

  return (
    <Modal open onClose={onCerrar} title={`Parámetros de ${nombrePeriodo(periodo)}`} size="3xl">
      {!f && <TableSkeleton rows={4} />}
      {f && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-end gap-3">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-gray-600">Período</span>
              <input
                type="month" value={periodo} onChange={e => setPeriodo(e.target.value)}
                className="rounded-xl border border-gray-300 px-3 py-2 text-sm"
              />
            </label>
            <Button variant="secondary" onClick={duplicar}>Duplicar de {nombrePeriodo(moverPeriodo(periodo, -1))}</Button>
            {existe && <Badge variant="blue">ya cargado</Badge>}
          </div>

          <section>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h3 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-brand">
                Valores del mes
                <InfoTip titulo="Cómo validarlos">
                  Se traen de <b>mindicador.cl</b>, que espeja la UF del Banco Central y la UTM del SII.
                  <br /><br />
                  La UF que corresponde es la del <b>último día del mes</b> (es la que usa Previred para los topes
                  imponibles y los planes de isapre), no la del día en que calculas. Abajo se muestra la fecha exacta
                  del valor traído: si dice «provisional» es porque el mes todavía no cerró.
                  <br /><br />
                  Además se compara contra el mes anterior: si la variación pasa el 3% te avisa, porque estos
                  indicadores se mueven poco y un salto grande es señal de dato malo.
                  <br /><br />
                  Para contrastar a mano:{' '}
                  <a className="underline" href="https://www.sii.cl/valores_y_fechas/utm/utm.htm" target="_blank" rel="noreferrer">UTM en el SII</a>{' · '}
                  <a className="underline" href="https://www.bcentral.cl/web/banco-central/areas/estadisticas/uf-utm-e-ipc" target="_blank" rel="noreferrer">UF en el Banco Central</a>
                </InfoTip>
              </h3>
              <Button variant="secondary" onClick={traerIndicadores} disabled={trayendo}>
                {trayendo ? 'Buscando…' : '↻ Traer UF y UTM'}
              </Button>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <N label="Valor UF" value={f.valor_uf} onChange={v => set('valor_uf', v)} paso="0.01"
                pie={ind?.uf ? `del ${ind.uf.fecha}${ind.uf.provisional ? ' · provisional' : ''}` : 'lo publica el Banco Central'} />
              <N label="Valor UTM" value={f.valor_utm} onChange={v => set('valor_utm', v)}
                pie={ind?.utm ? `de ${ind.utm.fecha.slice(0, 7)}` : 'lo publica el SII'} />
              <N label="Ingreso mínimo mensual" value={f.imm} onChange={v => set('imm', v)} />
            </div>

            {ind?.avisos && ind.avisos.length > 0 && (
              <ul className="mt-2 space-y-0.5 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
                {ind.avisos.map((a, i) => <li key={i}>· {a}</li>)}
              </ul>
            )}
          </section>

          <Grupo titulo="Topes imponibles">
            <N label="Tope AFP y salud (UF)" value={f.tope_afp_uf} onChange={v => set('tope_afp_uf', v)} paso="0.1" pie="90,0 UF en 2026" />
            <N label="Tope seguro de cesantía (UF)" value={f.tope_afc_uf} onChange={v => set('tope_afc_uf', v)} paso="0.1" pie="135,2 UF en 2026" />
            <N label="Tope gratificación (IMM anuales)" value={f.tope_gratificacion_imm} onChange={v => set('tope_gratificacion_imm', v)} paso="0.01" pie={`= ${fmtPrecio(Math.round((f.imm * f.tope_gratificacion_imm) / 12))} al mes`} />
          </Grupo>

          <Grupo titulo="Descuentos del trabajador">
            <N label="Seguro de cesantía (%)" value={f.tasa_afc_trabajador} onChange={v => set('tasa_afc_trabajador', v)} paso="0.1" pie="solo contratos indefinidos" />
            <N label="Factor de gratificación" value={f.factor_gratificacion} onChange={v => set('factor_gratificacion', v)} paso="0.01" pie="0,25 = 25%" />
          </Grupo>

          <Grupo titulo="Aportes del empleador">
            <N label="Cesantía, indefinido (%)" value={f.tasa_afc_empleador_indefinido} onChange={v => set('tasa_afc_empleador_indefinido', v)} paso="0.1" />
            <N label="Cesantía, plazo fijo (%)" value={f.tasa_afc_empleador_plazo_fijo} onChange={v => set('tasa_afc_empleador_plazo_fijo', v)} paso="0.1" />
            <N label="Mutual / ISL (%)" value={f.tasa_mutual} onChange={v => set('tasa_mutual', v)} paso="0.01" />
            <N label="SIS (%)" value={f.tasa_sis} onChange={v => set('tasa_sis', v)} paso="0.01" pie="0 desde ago-2026: lo absorbe el seguro social" />
            <N label="Seguro social (%)" value={f.tasa_seguro_social} onChange={v => set('tasa_seguro_social', v)} paso="0.01" pie="2,5% desde ago-2026" />
            <N label="Cuenta individual (%)" value={f.tasa_cuenta_individual} onChange={v => set('tasa_cuenta_individual', v)} paso="0.01" />
            <N label="FAPP / expectativa de vida (%)" value={f.tasa_fapp} onChange={v => set('tasa_fapp', v)} paso="0.01" />
          </Grupo>

          <Grupo titulo="Cotización por AFP (%)">
            {Object.entries(NOMBRES_AFP).map(([codigo, nombre]) => (
              <N
                key={codigo} label={nombre} paso="0.01"
                value={f.tasas_afp?.[codigo] ?? 0}
                onChange={v => setF(prev => (prev ? { ...prev, tasas_afp: { ...prev.tasas_afp, [codigo]: v } } : prev))}
              />
            ))}
          </Grupo>

          <Grupo titulo="Calendario (opcional)">
            <N label="Días trabajados" value={f.dias_habiles ?? 0} onChange={v => setF(prev => (prev ? { ...prev, dias_habiles: v || null } : prev))} pie="0 = usar el calendario chileno" />
            <N label="Días de descanso" value={f.dias_descanso ?? 0} onChange={v => setF(prev => (prev ? { ...prev, dias_descanso: v || null } : prev))} pie="domingos + feriados" />
          </Grupo>

          {err && <p className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-700">{err}</p>}

          <div className="flex justify-end gap-2 border-t border-gray-200 pt-4">
            <Button variant="secondary" onClick={onCerrar}>Cancelar</Button>
            <Button variant="primary" disabled={procesando} onClick={() => ejecutar(guardar)}>
              {procesando ? 'Guardando…' : 'Guardar'}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  )
}

function Grupo({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-brand">{titulo}</h3>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
    </section>
  )
}

function N({ label, value, onChange, pie, paso = '1' }: {
  label: string; value: number; onChange: (v: number) => void; pie?: string; paso?: string
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-gray-600">{label}</span>
      <input
        type="number" step={paso} value={value}
        onChange={e => onChange(Number(e.target.value) || 0)}
        className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm"
      />
      {pie && <span className="mt-0.5 block text-xs text-gray-500">{pie}</span>}
    </label>
  )
}
