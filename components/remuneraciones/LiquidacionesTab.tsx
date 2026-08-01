'use client'
import { useCallback, useEffect, useState } from 'react'
import { Card, Button } from '@/components/ui/kit'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { TableSkeleton } from '@/components/ui/Skeleton'
import { fmtPrecio, fmtFecha } from '@/lib/format'
import { useAccionUnica } from '@/lib/use-accion-unica'
import DetalleLiquidacion from './DetalleLiquidacion'
import type { Novedades, PeriodoUI, ResultadoUI } from './tipos-ui'
import { moverPeriodo, nombrePeriodo, periodoActual } from './tipos-ui'

export default function LiquidacionesTab() {
  const [periodo, setPeriodo] = useState(() => moverPeriodo(periodoActual(), -1))
  const [data, setData] = useState<PeriodoUI | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [abierto, setAbierto] = useState<string | null>(null)
  const [verFichas, setVerFichas] = useState(false)
  const { ejecutar, procesando } = useAccionUnica()

  const cargar = useCallback(async () => {
    setLoading(true); setErr('')
    try {
      const r = await fetch(`/api/remuneraciones/periodos/${periodo}`, { cache: 'no-store' })
      const d = await r.json()
      if (!r.ok) { setErr(d.error || 'No se pudo cargar el período'); setData(null) }
      else setData(d)
    } catch { setErr('Error de red'); setData(null) }
    setLoading(false)
  }, [periodo])

  useEffect(() => { cargar() }, [cargar])

  async function accion(url: string, body: unknown, exito?: string) {
    setErr('')
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    })
    const d = await r.json().catch(() => ({}))
    if (!r.ok) { setErr(d.error || 'No se pudo completar la acción'); return false }
    await cargar()
    if (exito) setErr('')
    return true
  }

  const recalcular = (novedades: Record<string, Partial<Novedades>> = {}) =>
    accion(`/api/remuneraciones/periodos/${periodo}/calcular`, { novedades })

  const editable = data?.estado === 'borrador'
  const listo = data && data.faltantes.length === 0 && data.empleados.length > 0

  return (
    <div className="space-y-4">
      {/* ── Selector de período ────────────────────────────────────────────── */}
      <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={() => setPeriodo(moverPeriodo(periodo, -1))} aria-label="Mes anterior">‹</Button>
          <span className="min-w-[9rem] text-center text-lg font-bold capitalize text-brand">{nombrePeriodo(periodo)}</span>
          <Button variant="secondary" onClick={() => setPeriodo(moverPeriodo(periodo, 1))} aria-label="Mes siguiente">›</Button>
          <Button variant="ghost" onClick={() => setPeriodo(moverPeriodo(periodoActual(), -1))}>Mes pasado</Button>
        </div>
        {data && (
          <div className="flex items-center gap-2">
            {data.estado === 'pagada' && <Badge variant="green">Pagado</Badge>}
            {data.estado === 'cerrada' && <Badge variant="blue">Cerrado</Badge>}
            {data.estado === 'borrador' && <Badge variant="gray">Borrador</Badge>}
            {data.pago?.fecha_pago && (
              <span className="text-xs text-gray-600">Pagado el {fmtFecha(data.pago.fecha_pago)}</span>
            )}
          </div>
        )}
      </Card>

      {err && (
        <Card className="border-red-300 bg-red-50 p-4 text-sm text-red-700">{err}</Card>
      )}

      {loading && <TableSkeleton rows={4} />}

      {!loading && data && (
        <>
          {/* ── Base del mes ────────────────────────────────────────────────── */}
          <Card className="p-4">
            <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-brand">Base del mes</h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Dato
                titulo="Cremaciones realizadas"
                valor={String(data.cremaciones)}
                pie={<button className="text-brand-soft underline" onClick={() => setVerFichas(true)}>ver el detalle</button>}
              />
              <Dato
                titulo="Días trabajados"
                valor={String(data.calendario.dias_habiles)}
                pie={<>lunes a viernes hábiles{data.calendario.manual && ' (ajustado a mano)'}</>}
              />
              <Dato
                titulo="Días de descanso"
                valor={String(data.calendario.dias_descanso)}
                pie={<>{data.calendario.detalle.domingos} domingos + {data.calendario.detalle.feriados} feriados</>}
              />
              <Dato
                titulo="UF / UTM del mes"
                valor={data.parametros?.valor_uf ? fmtPrecio(data.parametros.valor_uf) : '—'}
                pie={data.parametros?.valor_utm ? <>UTM {fmtPrecio(data.parametros.valor_utm)}</> : <>sin cargar</>}
              />
            </div>

            {data.faltantes.length > 0 && (
              <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                <p className="font-semibold">Falta cargar los parámetros de {nombrePeriodo(periodo)}</p>
                <ul className="ml-4 list-disc">{data.faltantes.map((f, i) => <li key={i}>{f}</li>)}</ul>
                <p className="mt-1 text-xs">Cárgalos en la pestaña «Parámetros legales» — se pueden duplicar del mes anterior.</p>
              </div>
            )}
            {data.empleados.length === 0 && (
              <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                No hay empleados activos. Créalos en la pestaña «Empleados».
              </div>
            )}
          </Card>

          {/* ── Liquidación por empleado ────────────────────────────────────── */}
          {listo && (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {data.resultados.map(r => (
                <TarjetaEmpleado key={r.empleado_id} r={r} onAbrir={() => setAbierto(r.empleado_id)} />
              ))}
            </div>
          )}

          {/* ── Costo empresa + acciones ────────────────────────────────────── */}
          {listo && (
            <Card className="p-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <Dato titulo="Total a transferir" valor={fmtPrecio(data.totales.transferido)} pie={<>líquidos {fmtPrecio(data.totales.liquidos)}{data.totales.reembolsos > 0 && <> + reembolsos {fmtPrecio(data.totales.reembolsos)}</>}</>} />
                <Dato titulo="Aportes del empleador" valor={fmtPrecio(data.totales.aportes)} pie={<>cesantía, mutual y previsional</>} />
                <Dato titulo="Costo empresa del mes" valor={fmtPrecio(data.totales.costo_empresa)} destacado pie={<>es lo que va al Estado de Resultados</>} />
              </div>

              <div className="mt-4 flex flex-wrap gap-2 border-t border-gray-200 pt-4">
                {editable && (
                  <Button variant="primary" disabled={procesando} onClick={() => ejecutar(async () => { await recalcular() })}>
                    {procesando ? 'Calculando…' : 'Calcular y guardar'}
                  </Button>
                )}
                {editable && data.guardadas.length > 0 && (
                  <Button variant="secondary" disabled={procesando} onClick={() => ejecutar(async () => {
                    if (!confirm(`Se cerrará ${nombrePeriodo(periodo)} y los montos quedarán congelados. ¿Continuar?`)) return
                    await accion(`/api/remuneraciones/periodos/${periodo}/cerrar`, {})
                  })}>Cerrar período</Button>
                )}
                {data.estado === 'cerrada' && (
                  <Button variant="gold" disabled={procesando} onClick={() => ejecutar(async () => {
                    if (!confirm('Se marcará como pagado y el costo aparecerá en el Estado de Resultados. ¿Continuar?')) return
                    await accion(`/api/remuneraciones/periodos/${periodo}/pagar`, {})
                  })}>Marcar como pagado</Button>
                )}
                {data.estado !== 'borrador' && (
                  <Button variant="danger" disabled={procesando} onClick={() => ejecutar(async () => {
                    if (!confirm('Reabrir vuelve el período a borrador y anula la orden de pago. ¿Continuar?')) return
                    await accion(`/api/remuneraciones/periodos/${periodo}/cerrar`, { reabrir: true })
                  })}>Reabrir</Button>
                )}
                {data.guardadas.length > 0 && (
                  <a
                    href={`/api/remuneraciones/periodos/${periodo}/libro`}
                    className="inline-flex items-center rounded-xl border border-gray-300 bg-white px-3.5 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                  >📗 Libro de remuneraciones</a>
                )}
              </div>
            </Card>
          )}
        </>
      )}

      {abierto && data && (
        <DetalleLiquidacion
          periodo={periodo}
          resultado={data.resultados.find(r => r.empleado_id === abierto)!}
          editable={!!editable}
          onCerrar={() => setAbierto(null)}
          onGuardarNovedades={async (empleadoId, novedades) => {
            await recalcular({ [empleadoId]: novedades })
          }}
        />
      )}

      {verFichas && <ModalFichas periodo={periodo} onCerrar={() => setVerFichas(false)} />}
    </div>
  )
}

function TarjetaEmpleado({ r, onAbrir }: { r: ResultadoUI; onAbrir: () => void }) {
  const t = r.liquidacion.totales
  return (
    <Card className="transition hover:border-brand">
      <button type="button" onClick={onAbrir} className="w-full rounded-2xl p-4 text-left">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-bold text-brand">{r.empleado_nombre}</p>
          <p className="text-xs text-gray-600">
            {r.cargo || 'Sin cargo'} · AFP {r.afp || '—'} ·{' '}
            {r.prevision_salud === 'fonasa' ? 'Fonasa' : r.prevision_salud === 'isapre' ? 'Isapre' : 'Sin previsión de salud'}
          </p>
        </div>
        {r.solver && (
          r.solver.exacto
            ? <Badge variant="green">meta exacta</Badge>
            : <Badge variant="yellow">+{fmtPrecio(r.solver.diferencia)}</Badge>
        )}
      </div>

      <div className="mt-3 border-t border-gray-200 pt-3">
        <div className="flex items-baseline justify-between">
          <span className="text-sm text-gray-600">Líquido a pago</span>
          <span className="text-2xl font-extrabold text-brand">{fmtPrecio(t.liquido)}</span>
        </div>
        {t.reembolso_salud > 0 && (
          <>
            <div className="mt-1 flex items-baseline justify-between text-sm text-gray-600">
              <span>+ Reembolso de salud</span>
              <span className="font-semibold">{fmtPrecio(t.reembolso_salud)}</span>
            </div>
            <div className="mt-1 flex items-baseline justify-between border-t border-dashed border-gray-300 pt-1">
              <span className="text-sm font-medium text-gray-700">Total a transferir</span>
              <span className="text-lg font-extrabold text-gold-soft">{fmtPrecio(t.total_a_transferir)}</span>
            </div>
          </>
        )}
      </div>

      <p className="mt-3 text-xs text-brand-soft underline">ver la liquidación completa</p>
      </button>
    </Card>
  )
}

function Dato({ titulo, valor, pie, destacado }: { titulo: string; valor: string; pie?: React.ReactNode; destacado?: boolean }) {
  return (
    <div className={`rounded-xl border p-3 ${destacado ? 'border-brand bg-cream' : 'border-gray-200 bg-white'}`}>
      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">{titulo}</p>
      <p className={`mt-1 font-extrabold ${destacado ? 'text-2xl text-brand' : 'text-2xl text-gray-900'}`}>{valor}</p>
      {pie && <p className="mt-0.5 text-xs text-gray-600">{pie}</p>}
    </div>
  )
}

/** El respaldo auditable del número de cremaciones: ficha por ficha. */
function ModalFichas({ periodo, onCerrar }: { periodo: string; onCerrar: () => void }) {
  const [fichas, setFichas] = useState<{ id: string; codigo: string; nombre_mascota: string; fecha: string }[] | null>(null)

  useEffect(() => {
    fetch(`/api/remuneraciones/cremaciones?periodo=${periodo}`, { cache: 'no-store' })
      .then(r => r.json())
      .then(d => setFichas(d.fichas || []))
      .catch(() => setFichas([]))
  }, [periodo])

  return (
    <Modal open onClose={onCerrar} title={`Cremaciones de ${nombrePeriodo(periodo)}`} size="2xl">
      {!fichas && <TableSkeleton rows={6} />}
      {fichas && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[420px] text-sm">
            <thead>
              <tr className="border-b border-gray-300 text-left text-xs uppercase text-gray-500">
                <th className="py-2">Fecha</th><th>Código</th><th>Mascota</th>
              </tr>
            </thead>
            <tbody>
              {fichas.map(f => (
                <tr key={f.id} className="border-b border-gray-100">
                  <td className="py-1.5">{fmtFecha(f.fecha)}</td>
                  <td className="font-mono text-xs">{f.codigo || '—'}</td>
                  <td>{f.nombre_mascota || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 text-sm font-semibold text-brand">{fichas.length} cremaciones en el mes</p>
        </div>
      )}
    </Modal>
  )
}
