'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, ChevronDown, ChevronRight, CreditCard, Landmark, Link2 } from 'lucide-react'
import { Card, Button } from '@/components/ui/kit'
import { TablaScroll, THEAD_STICKY } from '@/components/ui/TablaScroll'
import { TableSkeleton } from '@/components/ui/Skeleton'
import { fmtPrecio, fmtFecha } from '@/lib/format'
import { useAccionUnica } from '@/lib/use-accion-unica'

/**
 * VENTAS POS — cuánto tiene que abonarnos el procesador de pagos (TUU/Haulmer).
 *
 * Muestra día por día las ventas cobradas con máquina o link de pago (las únicas
 * que pagan comisión), desplegables como el historial de ciclos. En la cabecera
 * de cada día va el LÍQUIDO: lo que debería haber llegado por esa jornada, ya
 * descontada la comisión, y el día hábil en que se abona.
 */

interface ConfigPos { comision_fija: number; comision_variable: number; iva: number }

interface VentaPos {
  id: string
  codigo: string
  nombre_mascota: string
  fecha_retiro: string
  fecha_boleta: string
  folio: string
  tipo_pago: 'pos' | 'link'
  bruto: number
  comision_neta: number
  comision_iva: number
  comision_bruta: number
  liquidado: number
  fecha_estimada: boolean
}

interface DiaPos {
  fecha: string
  fecha_abono: string
  ventas: VentaPos[]
  bruto: number
  comision_neta: number
  comision_bruta: number
  liquidado: number
}

interface Resumen {
  config: ConfigPos
  dias: DiaPos[]
  sin_fecha: VentaPos[]
  totales: { ventas: number; bruto: number; comision_bruta: number; liquidado: number }
}

const DIAS_SEMANA = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']

/** Nombre del día de una fecha ISO, sin pasar por el huso horario. */
function diaSemana(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return ''
  return DIAS_SEMANA[new Date(y, m - 1, d, 12, 0, 0).getDay()] ?? ''
}

/** Primer y último día del mes en curso, para arrancar con algo acotado. */
function mesActual(): { desde: string; hasta: string } {
  const hoy = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  const y = hoy.getFullYear()
  const m = hoy.getMonth()
  return {
    desde: `${y}-${p(m + 1)}-01`,
    hasta: `${y}-${p(m + 1)}-${p(new Date(y, m + 1, 0).getDate())}`,
  }
}

function IconoPago({ tipo }: { tipo: 'pos' | 'link' }) {
  return tipo === 'link'
    ? <Link2 className="w-3.5 h-3.5 text-brand-soft" aria-label="Link de pago" />
    : <CreditCard className="w-3.5 h-3.5 text-brand-soft" aria-label="POS" />
}

export default function VentasPosTab() {
  const [rango, setRango] = useState(mesActual)
  const [data, setData] = useState<Resumen | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [abierto, setAbierto] = useState<string | null>(null)

  // Config editable (se sincroniza con lo que devuelve el servidor).
  const [cfg, setCfg] = useState<ConfigPos>({ comision_fija: 65, comision_variable: 0.79, iva: 19 })
  const [cfgGuardada, setCfgGuardada] = useState('')
  const { ejecutar, procesando } = useAccionUnica()

  const cargar = useCallback(async () => {
    setCargando(true)
    setError('')
    try {
      const r = await fetch(`/api/facturacion/ventas-pos?desde=${rango.desde}&hasta=${rango.hasta}`, { cache: 'no-store' })
      const d = await r.json()
      if (!r.ok) throw new Error(d?.error || 'No se pudo cargar')
      setData(d)
      setCfg(d.config)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error')
    } finally {
      setCargando(false)
    }
  }, [rango.desde, rango.hasta])

  useEffect(() => { cargar() }, [cargar])

  const guardarConfig = () => ejecutar(async () => {
    setCfgGuardada('')
    const r = await fetch('/api/facturacion/pos-config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cfg),
    })
    const d = await r.json()
    if (!r.ok) { setError(d?.error || 'No se pudo guardar'); return }
    setCfgGuardada('Comisión guardada')
    setTimeout(() => setCfgGuardada(''), 2500)
    await cargar()
  })

  /** Los días que Haulmer paga juntos (viernes, sábado y domingo caen el lunes). */
  const abonos = useMemo(() => {
    if (!data) return []
    const m = new Map<string, { total: number; dias: string[] }>()
    for (const d of data.dias) {
      const a = m.get(d.fecha_abono) ?? { total: 0, dias: [] }
      a.total += d.liquidado
      a.dias.push(d.fecha)
      m.set(d.fecha_abono, a)
    }
    return [...m.entries()]
      .map(([fecha, v]) => ({ fecha, ...v, dias: v.dias.sort() }))
      .sort((a, b) => b.fecha.localeCompare(a.fecha))
  }, [data])

  return (
    <div className="space-y-5">
      {/* ── Comisión del procesador ─────────────────────────────────────── */}
      <Card className="p-5">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h3 className="text-sm font-bold text-brand">Comisión del procesador de pagos</h3>
            <p className="text-xs text-gray-600 mt-0.5">
              Se descuenta de cada venta por POS o link de pago. El fijo y el porcentaje son netos;
              el IVA se aplica sobre la suma de los dos.
            </p>
          </div>
          {cfgGuardada && <span className="text-xs font-semibold text-emerald-700">{cfgGuardada}</span>}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mt-4">
          <div>
            <label className="text-xs font-semibold text-gray-700">Comisión fija (por venta)</label>
            <div className="mt-1 flex items-center gap-2">
              <span className="text-sm text-gray-500">$</span>
              <input type="number" min={0} step={1} value={cfg.comision_fija}
                onChange={e => setCfg(c => ({ ...c, comision_fija: Number(e.target.value) }))}
                className="w-full border-2 border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand" />
            </div>
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-700">Comisión variable</label>
            <div className="mt-1 flex items-center gap-2">
              <input type="number" min={0} step={0.01} value={cfg.comision_variable}
                onChange={e => setCfg(c => ({ ...c, comision_variable: Number(e.target.value) }))}
                className="w-full border-2 border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand" />
              <span className="text-sm text-gray-500">%</span>
            </div>
            <p className="text-[11px] text-gray-500 mt-1">Sobre el total cobrado (con IVA).</p>
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-700">IVA sobre la comisión</label>
            <div className="mt-1 flex items-center gap-2">
              <input type="number" min={0} step={1} value={cfg.iva}
                onChange={e => setCfg(c => ({ ...c, iva: Number(e.target.value) }))}
                className="w-full border-2 border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand" />
              <span className="text-sm text-gray-500">%</span>
            </div>
          </div>
          <div className="flex items-end">
            <Button variant="primary" onClick={guardarConfig} disabled={procesando} className="w-full">
              {procesando ? 'Guardando…' : 'Guardar comisión'}
            </Button>
          </div>
        </div>

        <p className="text-[11px] text-gray-500 mt-3">
          Comisión de una venta = ${cfg.comision_fija} + {String(cfg.comision_variable).replace('.', ',')}% del total,
          más {cfg.iva}% de IVA.
        </p>
      </Card>

      {/* ── Rango ───────────────────────────────────────────────────────── */}
      <Card className="p-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 items-end">
          <div>
            <label className="text-xs font-semibold text-gray-700">Desde</label>
            <input type="date" value={rango.desde} onChange={e => setRango(r => ({ ...r, desde: e.target.value }))}
              className="mt-1 w-full border-2 border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand" />
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-700">Hasta</label>
            <input type="date" value={rango.hasta} onChange={e => setRango(r => ({ ...r, hasta: e.target.value }))}
              className="mt-1 w-full border-2 border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand" />
          </div>
          <div className="lg:col-span-2 flex gap-2">
            <Button variant="secondary" onClick={() => setRango(mesActual())}>Mes actual</Button>
          </div>
        </div>
      </Card>

      {error && (
        <Card className="p-4 border-red-300 bg-red-50">
          <p className="text-sm text-red-700">{error}</p>
        </Card>
      )}

      {cargando ? <TableSkeleton /> : data && (
        <>
          {/* ── Totales del rango ─────────────────────────────────────── */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              { t: 'Ventas por POS / link', v: String(data.totales.ventas), sub: 'solo las pagadas' },
              { t: 'Total cobrado (bruto)', v: fmtPrecio(data.totales.bruto), sub: 'lo que pasó por la máquina' },
              { t: 'Comisión (con IVA)', v: fmtPrecio(data.totales.comision_bruta), sub: 'lo que se queda el procesador' },
              { t: 'A recibir de Haulmer', v: fmtPrecio(data.totales.liquidado), sub: 'líquido del período', destacar: true },
            ].map(k => (
              <Card key={k.t} className={`p-4 ${k.destacar ? 'border-brand' : ''}`}>
                <p className="text-[11px] uppercase tracking-wide font-semibold text-gray-500">{k.t}</p>
                <p className={`text-lg font-bold mt-1 ${k.destacar ? 'text-brand' : 'text-gray-900'}`}>{k.v}</p>
                <p className="text-[11px] text-gray-500 mt-0.5">{k.sub}</p>
              </Card>
            ))}
          </div>

          {/* ── Fichas sin fecha ──────────────────────────────────────── */}
          {data.sin_fecha.length > 0 && (
            <Card className="p-4 border-amber-300 bg-amber-50">
              <div className="flex gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" aria-hidden="true" />
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-amber-900">
                    {data.sin_fecha.length} venta{data.sin_fecha.length === 1 ? '' : 's'} sin fecha de pago
                  </p>
                  <p className="text-xs text-amber-800 mt-0.5">
                    En todo el histórico, no solo en este rango: no tienen fecha de pago ni documento
                    emitido, así que no se pueden asignar a un día ni al abono. La fecha se completa en
                    la ficha, junto a la forma de pago.
                  </p>
                  <p className="text-xs text-amber-800 mt-1.5 break-words">
                    {data.sin_fecha.slice(0, 12).map(v => v.codigo).join(' · ')}
                    {data.sin_fecha.length > 12 && ` · y ${data.sin_fecha.length - 12} más`}
                  </p>
                </div>
              </div>
            </Card>
          )}

          {/* ── Día por día ───────────────────────────────────────────── */}
          <Card className="overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-300 flex items-center justify-between gap-3 flex-wrap">
              <h3 className="text-base font-semibold text-gray-900">Resumen día por día</h3>
              <p className="text-xs text-gray-600">Toca un día para ver sus ventas</p>
            </div>

            {data.dias.length === 0 ? (
              <div className="p-8 text-center text-gray-400 text-sm">
                Sin ventas por POS o link de pago en este rango
              </div>
            ) : (
              <div className="divide-y divide-gray-200">
                {data.dias.map(d => {
                  const open = abierto === d.fecha
                  return (
                    <div key={d.fecha}>
                      <button
                        onClick={() => setAbierto(open ? null : d.fecha)}
                        aria-expanded={open}
                        className="w-full text-left px-4 sm:px-5 py-3 hover:bg-gray-50 transition-colors flex items-start gap-3"
                      >
                        {open
                          ? <ChevronDown className="w-4 h-4 text-gray-400 shrink-0 mt-1" aria-hidden="true" />
                          : <ChevronRight className="w-4 h-4 text-gray-400 shrink-0 mt-1" aria-hidden="true" />}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline gap-2 flex-wrap">
                            <span className="font-semibold text-gray-900">{fmtFecha(d.fecha)}</span>
                            <span className="text-xs text-gray-500 capitalize">{diaSemana(d.fecha)}</span>
                            <span className="text-xs text-gray-500">
                              · {d.ventas.length} venta{d.ventas.length === 1 ? '' : 's'}
                            </span>
                          </div>
                          <div className="text-xs text-gray-600 mt-1 flex flex-wrap gap-x-4 gap-y-0.5">
                            <span>Bruto {fmtPrecio(d.bruto)}</span>
                            <span>Comisión {fmtPrecio(d.comision_bruta)}</span>
                            <span className="inline-flex items-center gap-1 text-brand">
                              <Landmark className="w-3.5 h-3.5" aria-hidden="true" />
                              Se abona el {fmtFecha(d.fecha_abono)}
                            </span>
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-[10px] uppercase tracking-wide font-semibold text-gray-500">A recibir</p>
                          <p className="text-base font-bold text-brand">{fmtPrecio(d.liquidado)}</p>
                        </div>
                      </button>

                      {open && (
                        <div className="bg-gray-50 border-t border-gray-200">
                          {/* En el teléfono la línea compacta muestra código,
                              mascota y el líquido: el monto es el dato del módulo. */}
                          <TablaScroll resumen={[0, 1, 7]}>
                            <table className="w-full text-sm min-w-[760px]">
                              <thead className={THEAD_STICKY}>
                                <tr>
                                  {['Código', 'Mascota', 'F. retiro', 'F. boleta', 'Bruto', 'Com. neta', 'Com. bruta', 'Liquidado'].map((h, i) => (
                                    <th key={h} className={`px-3 py-2.5 text-[11px] uppercase tracking-wide font-semibold text-gray-500 whitespace-nowrap ${i >= 4 ? 'text-right' : 'text-left'}`}>{h}</th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-gray-200 bg-white">
                                {d.ventas.map(v => (
                                  <tr key={v.id} className="hover:bg-gray-50">
                                    <td className="px-3 py-2.5 whitespace-nowrap">
                                      <span className="inline-flex items-center gap-1.5">
                                        <IconoPago tipo={v.tipo_pago} />
                                        <span className="font-mono text-xs font-semibold text-brand">{v.codigo}</span>
                                      </span>
                                    </td>
                                    <td className="px-3 py-2.5 text-gray-900">{v.nombre_mascota}</td>
                                    <td className="px-3 py-2.5 text-gray-600 whitespace-nowrap">{v.fecha_retiro ? fmtFecha(v.fecha_retiro) : '—'}</td>
                                    <td className="px-3 py-2.5 text-gray-600 whitespace-nowrap">
                                      {v.fecha_boleta ? fmtFecha(v.fecha_boleta) : '—'}
                                      {v.fecha_estimada && (
                                        <span title="La ficha no tiene fecha de pago: el día se tomó de la boleta"
                                          className="ml-1.5 text-[10px] font-semibold text-amber-700">día estimado</span>
                                      )}
                                    </td>
                                    <td className="px-3 py-2.5 text-right text-gray-900 whitespace-nowrap">{fmtPrecio(v.bruto)}</td>
                                    <td className="px-3 py-2.5 text-right text-gray-600 whitespace-nowrap">{fmtPrecio(v.comision_neta)}</td>
                                    <td className="px-3 py-2.5 text-right text-gray-600 whitespace-nowrap">{fmtPrecio(v.comision_bruta)}</td>
                                    <td className="px-3 py-2.5 text-right font-semibold text-brand whitespace-nowrap">{fmtPrecio(v.liquidado)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </TablaScroll>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </Card>

          {/* ── Abonos esperados ──────────────────────────────────────── */}
          {abonos.length > 0 && (
            <Card className="overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-300">
                <h3 className="text-base font-semibold text-gray-900">Abonos esperados</h3>
                <p className="text-xs text-gray-600 mt-0.5">
                  Haulmer paga al día hábil siguiente, así que viernes, sábado y domingo llegan juntos el lunes.
                </p>
              </div>
              <TablaScroll resumen={[0, 2]}>
                <table className="w-full text-sm min-w-[520px]">
                  <thead className={THEAD_STICKY}>
                    <tr>
                      {['Fecha del abono', 'Días incluidos', 'Monto'].map((h, i) => (
                        <th key={h} className={`px-4 py-2.5 text-[11px] uppercase tracking-wide font-semibold text-gray-500 whitespace-nowrap ${i === 2 ? 'text-right' : 'text-left'}`}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {abonos.map(a => (
                      <tr key={a.fecha} className="hover:bg-gray-50">
                        <td className="px-4 py-2.5 font-semibold text-gray-900 whitespace-nowrap">{fmtFecha(a.fecha)}</td>
                        <td className="px-4 py-2.5 text-gray-600">{a.dias.map(f => fmtFecha(f)).join(' · ')}</td>
                        <td className="px-4 py-2.5 text-right font-bold text-brand whitespace-nowrap">{fmtPrecio(a.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TablaScroll>
            </Card>
          )}
        </>
      )}
    </div>
  )
}
