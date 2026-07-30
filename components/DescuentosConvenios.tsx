'use client'
import { useState, useEffect, useCallback, Fragment } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Badge } from '@/components/ui/Badge'
import { Card, Button } from '@/components/ui/kit'
import { fmtPrecio, fmtFecha } from '@/lib/format'
import { todayISO } from '@/lib/dates'
import { useAccionUnica } from '@/lib/use-accion-unica'

/**
 * Configuración → Descuentos Convenios.
 *
 * Veterinarios a los que NO se les factura el servicio: la boleta se le emite al
 * TUTOR por el precio completo (por eso su tabla de precios especiales se deja
 * igual a la general, con el botón "Duplicar" de la pestaña Precios) y al vet le
 * queda una COMISIÓN por la derivación.
 *
 * La comisión se acumula como saldo y NO toca el Estado de Resultados hasta que se
 * le paga: al "Ajustar saldo", ese monto se registra como COSTO DE VENTA.
 *
 * Pestaña SOLO del dueño: define plata que se paga y escribe en el EERR.
 */

type Vet = { id: string; nombre: string; activo: string }

interface Regla { id: string; veterinaria_id: string; tipo: 'fijo' | 'variable'; valor: number; activo: boolean }
interface SaldoVet {
  veterinaria_id: string
  nombre: string
  regla: Regla | null
  /** Su tarifa sigue a los precios generales (se re-copian solas al cambiarlos). */
  indexado: boolean
  cantidad_devengos: number
  devengado: number
  ajustado: number
  saldo: number
}
interface Devengo {
  id: string; cliente_id: string; codigo: string; nombre_mascota: string
  base_monto: number; tipo: string; valor: number; monto: number
  estado: string; fecha_devengo: string
}
interface Ajuste { id: string; monto: number; detalle: string; fecha: string; creado_por_nombre: string }

export default function DescuentosConvenios() {
  const [saldos, setSaldos] = useState<SaldoVet[]>([])
  const [vets, setVets] = useState<Vet[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [showRegla, setShowRegla] = useState(false)
  const [reglaForm, setReglaForm] = useState({ veterinaria_id: '', tipo: 'fijo' as 'fijo' | 'variable', valor: '', indexar: true })
  const [reglaError, setReglaError] = useState('')

  const [ajuste, setAjuste] = useState<SaldoVet | null>(null)
  const [ajusteForm, setAjusteForm] = useState({ monto: '', detalle: '', fecha: todayISO() })
  const [ajusteError, setAjusteError] = useState('')

  const [expandido, setExpandido] = useState<string | null>(null)
  const [detalle, setDetalle] = useState<{ devengos: Devengo[]; ajustes: Ajuste[] } | null>(null)
  const [cargandoDetalle, setCargandoDetalle] = useState(false)

  const { ejecutar, procesando } = useAccionUnica()

  const cargar = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const [rs, rv] = await Promise.all([
        fetch('/api/comisiones', { cache: 'no-store' }),
        fetch('/api/veterinarios?activo=true', { cache: 'no-store' }),
      ])
      const ds = await rs.json()
      if (!rs.ok) { setError(ds.error || 'No se pudo cargar'); setSaldos([]) }
      else setSaldos(Array.isArray(ds) ? ds : [])
      const dv = await rv.json()
      setVets(Array.isArray(dv) ? dv : [])
    } catch { setError('Error de red') }
    setLoading(false)
  }, [])

  useEffect(() => { cargar() }, [cargar])

  async function abrirDetalle(vetId: string) {
    if (expandido === vetId) { setExpandido(null); setDetalle(null); return }
    setExpandido(vetId); setDetalle(null); setCargandoDetalle(true)
    try {
      const r = await fetch(`/api/comisiones?veterinaria_id=${vetId}`, { cache: 'no-store' })
      const d = await r.json()
      if (r.ok) setDetalle(d)
    } catch { /* el detalle simplemente no se muestra */ }
    setCargandoDetalle(false)
  }

  const guardarRegla = () => ejecutar(async () => {
    setReglaError('')
    const valor = parseInt(reglaForm.valor, 10)
    if (!reglaForm.veterinaria_id) { setReglaError('Elegí una veterinaria.'); return }
    if (!valor || valor <= 0) { setReglaError('Ingresá un valor mayor a 0.'); return }
    if (reglaForm.tipo === 'variable' && valor > 100) { setReglaError('Un porcentaje no puede superar 100.'); return }
    const r = await fetch('/api/comisiones', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accion: 'regla', veterinaria_id: reglaForm.veterinaria_id, tipo: reglaForm.tipo, valor }),
    })
    const d = await r.json()
    if (!r.ok) { setReglaError(d.error || 'No se pudo guardar.'); return }
    if (reglaForm.indexar) {
      const ri = await fetch('/api/comisiones', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accion: 'indexar', veterinaria_id: reglaForm.veterinaria_id }),
      })
      if (!ri.ok) {
        const di = await ri.json().catch(() => ({}))
        setReglaError(`La comisión quedó guardada, pero no se pudieron indexar los precios: ${di.error || ri.status}`)
        await cargar()
        return
      }
    }
    setShowRegla(false)
    setReglaForm({ veterinaria_id: '', tipo: 'fijo', valor: '', indexar: true })
    await cargar()
  })

  const quitarRegla = (s: SaldoVet) => ejecutar(async () => {
    if (!s.regla) return
    if (!confirm(`Quitar la comisión de ${s.nombre}?\n\nLas comisiones ya devengadas y su saldo se conservan; solo dejan de generarse nuevas.`)) return
    const r = await fetch(`/api/comisiones?id=${s.regla.id}`, { method: 'DELETE' })
    if (r.ok) await cargar()
  })

  const indexarPrecios = (s: SaldoVet) => ejecutar(async () => {
    if (!confirm(`Indexar los precios de ${s.nombre} a los PRECIOS GENERALES?

Se copian los tramos generales a su tabla de precios especiales y quedan siguiéndolos: si cambian los generales, cambian los suyos. Las fichas ya creadas no se modifican.`)) return
    const r = await fetch('/api/comisiones', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accion: 'indexar', veterinaria_id: s.veterinaria_id }),
    })
    if (!r.ok) { const d = await r.json().catch(() => ({})); alert(d.error || 'No se pudo indexar.'); return }
    await cargar()
  })

  const guardarAjuste = () => ejecutar(async () => {
    if (!ajuste) return
    setAjusteError('')
    const monto = parseInt(ajusteForm.monto, 10)
    if (!monto || monto <= 0) { setAjusteError('Ingresá un monto mayor a 0.'); return }
    const r = await fetch('/api/comisiones', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accion: 'ajuste', veterinaria_id: ajuste.veterinaria_id, monto, detalle: ajusteForm.detalle, fecha: ajusteForm.fecha }),
    })
    const d = await r.json()
    if (!r.ok) { setAjusteError(d.error || 'No se pudo registrar.'); return }
    setAjuste(null)
    setAjusteForm({ monto: '', detalle: '', fecha: todayISO() })
    if (expandido) { setExpandido(null); setDetalle(null) }
    await cargar()
  })

  const totalSaldo = saldos.reduce((s, v) => s + v.saldo, 0)
  const etiquetaRegla = (r: Regla | null) =>
    !r ? '—' : r.tipo === 'variable' ? `${r.valor}% de la cremación` : fmtPrecio(r.valor)

  return (
    <div className="space-y-5">
      <Card className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="max-w-2xl">
            <h2 className="text-base font-bold text-brand">Comisiones por derivación</h2>
            <p className="text-sm text-gray-600 mt-1">
              A estos veterinarios no se les factura el servicio: la boleta se le emite al tutor por el
              precio completo (desde Facturación → Facturas → <strong>Boleta al tutor</strong>) y acá se
              les acumula la comisión. El saldo se convierte en <strong>costo de venta</strong> recién
              cuando lo ajustás.
            </p>
            <p className="text-xs text-gray-500 mt-2">
              Al tutor se le cobra el precio de lista: la tarifa de estos veterinarios queda
              <strong> indexada a los precios generales</strong> y los sigue sola cuando cambian.
            </p>
          </div>
          <Button variant="primary" onClick={() => { setReglaError(''); setShowRegla(true) }}>+ Nueva comisión</Button>
        </div>
      </Card>

      <Card className="p-0 overflow-hidden">
        {loading ? <p className="p-8 text-center text-sm text-gray-400">Cargando…</p>
        : error ? <p className="p-4 text-sm text-red-700 bg-red-50">{error}</p>
        : saldos.length === 0 ? <p className="p-8 text-center text-sm text-gray-400">Todavía no hay veterinarias con comisión.</p>
        : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full md:min-w-[820px] text-sm">
                <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
                  <tr>
                    <th className="text-left px-2 md:px-4 py-2.5">Veterinaria</th>
                    <th className="text-left px-4 py-2.5 hidden md:table-cell">Comisión</th>
                    <th className="text-right px-4 py-2.5 hidden md:table-cell">Derivaciones</th>
                    <th className="text-right px-2 md:px-4 py-2.5">Acumulado</th>
                    <th className="text-right px-4 py-2.5 hidden md:table-cell">Pagado</th>
                    <th className="text-right px-2 md:px-4 py-2.5">Saldo</th>
                    <th className="text-right px-2 md:px-4 py-2.5">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {saldos.map(s => (
                    <Fragment key={s.veterinaria_id}>
                      <tr className="hover:bg-gray-50">
                        <td className="px-2 md:px-4 py-2.5">
                          <button onClick={() => abrirDetalle(s.veterinaria_id)} className="text-left">
                            <span className="font-medium text-gray-900 hover:text-brand">{s.nombre}</span>
                          </button>
                          <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                            {!s.regla && <Badge variant="gray">Sin regla vigente</Badge>}
                            {s.indexado
                              ? <Badge variant="green">Precios = generales</Badge>
                              : (
                                <button onClick={() => indexarPrecios(s)} disabled={procesando}
                                  className="text-[11px] font-semibold text-amber-800 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5 hover:bg-amber-100 disabled:opacity-50">
                                  Precios sin indexar — indexar a generales
                                </button>
                              )}
                          </div>
                          <div className="md:hidden mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                            <span>{etiquetaRegla(s.regla)}</span>
                            <span>· {s.cantidad_devengos} derivación{s.cantidad_devengos === 1 ? '' : 'es'}</span>
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-gray-700 hidden md:table-cell">{etiquetaRegla(s.regla)}</td>
                        <td className="px-4 py-2.5 text-right text-gray-600 hidden md:table-cell">{s.cantidad_devengos}</td>
                        <td className="px-2 md:px-4 py-2.5 text-right text-gray-700 whitespace-nowrap">{fmtPrecio(s.devengado)}</td>
                        <td className="px-4 py-2.5 text-right text-gray-500 hidden md:table-cell whitespace-nowrap">{fmtPrecio(s.ajustado)}</td>
                        <td className={`px-2 md:px-4 py-2.5 text-right font-bold whitespace-nowrap ${s.saldo < 0 ? 'text-red-600' : 'text-gray-900'}`}>
                          {fmtPrecio(s.saldo)}
                        </td>
                        <td className="px-2 md:px-4 py-2.5">
                          <div className="flex items-center justify-end gap-2">
                            <button onClick={() => { setAjusteError(''); setAjusteForm({ monto: '', detalle: '', fecha: todayISO() }); setAjuste(s) }}
                              className="text-xs font-semibold text-white bg-brand rounded-lg px-3 py-1.5 hover:bg-brand-dark">
                              Ajustar saldo
                            </button>
                            {s.regla && (
                              <button onClick={() => { setReglaError(''); setReglaForm({ veterinaria_id: s.veterinaria_id, tipo: s.regla!.tipo, valor: String(s.regla!.valor), indexar: !s.indexado }); setShowRegla(true) }}
                                className="text-xs font-semibold text-brand border border-brand/40 rounded-lg px-2 py-1 hover:bg-brand/5">
                                Editar
                              </button>
                            )}
                            {s.regla && (
                              <button onClick={() => quitarRegla(s)} disabled={procesando}
                                className="text-xs font-semibold text-red-600 border border-red-200 rounded-lg px-2 py-1 hover:bg-red-50 disabled:opacity-50">
                                Quitar
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                      {expandido === s.veterinaria_id && (
                        <tr>
                          <td colSpan={7} className="bg-gray-50 px-2 md:px-4 py-3">
                            {cargandoDetalle ? <p className="text-xs text-gray-400">Cargando detalle…</p>
                            : !detalle ? <p className="text-xs text-gray-400">Sin detalle.</p>
                            : (
                              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                                <div>
                                  <h4 className="text-xs font-bold uppercase text-gray-500 mb-1.5">Comisiones devengadas</h4>
                                  {detalle.devengos.length === 0 ? <p className="text-xs text-gray-400">Todavía no hay derivaciones boleteadas.</p> : (
                                    <div className="overflow-x-auto">
                                      <table className="w-full text-xs">
                                        <tbody className="divide-y divide-gray-200">
                                          {detalle.devengos.map(d => (
                                            <tr key={d.id} className={d.estado !== 'devengada' ? 'opacity-50' : ''}>
                                              <td className="py-1.5 pr-2 font-mono font-bold text-brand">{d.codigo || `#${d.cliente_id}`}</td>
                                              <td className="py-1.5 pr-2 text-gray-700">{d.nombre_mascota}</td>
                                              <td className="py-1.5 pr-2 text-gray-500 whitespace-nowrap">{d.fecha_devengo ? fmtFecha(d.fecha_devengo) : '—'}</td>
                                              <td className="py-1.5 text-right font-semibold text-gray-900 whitespace-nowrap">
                                                {fmtPrecio(d.monto)}
                                                {d.estado !== 'devengada' && <span className="ml-1 text-red-600">(anulada)</span>}
                                              </td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    </div>
                                  )}
                                </div>
                                <div>
                                  <h4 className="text-xs font-bold uppercase text-gray-500 mb-1.5">Ajustes de saldo (costo de venta)</h4>
                                  {detalle.ajustes.length === 0 ? <p className="text-xs text-gray-400">Todavía no se le pagó nada.</p> : (
                                    <div className="overflow-x-auto">
                                      <table className="w-full text-xs">
                                        <tbody className="divide-y divide-gray-200">
                                          {detalle.ajustes.map(a => (
                                            <tr key={a.id}>
                                              <td className="py-1.5 pr-2 text-gray-500 whitespace-nowrap">{a.fecha ? fmtFecha(a.fecha) : '—'}</td>
                                              <td className="py-1.5 pr-2 text-gray-700">{a.detalle || '—'}</td>
                                              <td className="py-1.5 text-right font-semibold text-gray-900 whitespace-nowrap">{fmtPrecio(a.monto)}</td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    </div>
                                  )}
                                </div>
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex justify-between items-center px-4 py-3 bg-gray-50 border-t border-gray-200 text-sm">
              <span className="text-gray-500 text-xs">{saldos.length} veterinaria{saldos.length === 1 ? '' : 's'}</span>
              <span className="font-bold text-gray-900">Saldo total por pagar: {fmtPrecio(totalSaldo)}</span>
            </div>
          </>
        )}
      </Card>

      {/* Alta / edición de la regla */}
      <Modal open={showRegla} onClose={() => setShowRegla(false)} title="Comisión por derivación">
        <form onSubmit={e => { e.preventDefault(); guardarRegla() }} className="space-y-4">
          <div>
            <label className="text-xs font-medium text-gray-700">Veterinaria</label>
            <select required value={reglaForm.veterinaria_id}
              onChange={e => setReglaForm(f => ({ ...f, veterinaria_id: e.target.value }))}
              className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand">
              <option value="">Seleccionar…</option>
              {vets.map(v => <option key={v.id} value={v.id}>{v.nombre}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-gray-700">Tipo</label>
              <select value={reglaForm.tipo}
                onChange={e => setReglaForm(f => ({ ...f, tipo: e.target.value as 'fijo' | 'variable' }))}
                className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand">
                <option value="fijo">Monto fijo (CLP)</option>
                <option value="variable">Porcentaje (%)</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-700">{reglaForm.tipo === 'variable' ? 'Porcentaje' : 'Monto'}</label>
              <input type="number" required min={1} value={reglaForm.valor}
                onChange={e => setReglaForm(f => ({ ...f, valor: e.target.value }))}
                placeholder={reglaForm.tipo === 'variable' ? '10' : '20000'}
                className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand" />
            </div>
          </div>
          <p className="text-xs text-gray-500">
            El porcentaje se calcula sobre el precio de la <strong>cremación</strong> (sin adicionales y
            ya con descuento aplicado). La comisión se devenga al emitirle la boleta al tutor.
          </p>
          <label className="flex items-start gap-2 text-sm text-gray-700 bg-cream border border-gold-soft/40 rounded-lg px-3 py-2 cursor-pointer">
            <input type="checkbox" checked={reglaForm.indexar}
              onChange={e => setReglaForm(f => ({ ...f, indexar: e.target.checked }))}
              className="w-4 h-4 mt-0.5" />
            <span>
              <strong>Indexar sus precios a los generales</strong>
              <span className="block text-xs text-gray-500 mt-0.5">
                Al tutor se le cobra el precio de lista, así que la tarifa del vet pasa a ser la general
                y queda siguiéndola: si mañana cambian los precios generales, los suyos cambian solos.
              </span>
            </span>
          </label>
          {reglaError && <p className="text-xs text-red-600">{reglaError}</p>}
          <button type="submit" disabled={procesando}
            className="w-full bg-brand hover:bg-brand-dark text-white rounded-lg py-2 text-sm font-medium transition-colors disabled:opacity-50">
            {procesando ? 'Guardando…' : 'Guardar'}
          </button>
        </form>
      </Modal>

      {/* Ajuste de saldo → costo de venta */}
      <Modal open={!!ajuste} onClose={() => setAjuste(null)} title={`Ajustar saldo — ${ajuste?.nombre ?? ''}`}>
        <form onSubmit={e => { e.preventDefault(); guardarAjuste() }} className="space-y-4">
          <div className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm">
            <div className="flex justify-between"><span className="text-gray-600">Saldo actual</span>
              <span className="font-bold text-gray-900">{fmtPrecio(ajuste?.saldo ?? 0)}</span></div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-gray-700">Monto pagado</label>
              <input type="number" required min={1} value={ajusteForm.monto}
                onChange={e => setAjusteForm(f => ({ ...f, monto: e.target.value }))}
                className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-700">Fecha</label>
              <input type="date" value={ajusteForm.fecha}
                onChange={e => setAjusteForm(f => ({ ...f, fecha: e.target.value }))}
                className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand" />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-700">Detalle (opcional)</label>
            <input type="text" value={ajusteForm.detalle}
              onChange={e => setAjusteForm(f => ({ ...f, detalle: e.target.value }))}
              placeholder="N° de transferencia, período pagado…"
              className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand" />
          </div>
          <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            Este monto se registra como <strong>costo de venta</strong> en el Estado de Resultados
            (partida “Comisiones convenios”), con la fecha indicada.
          </p>
          {ajusteError && <p className="text-xs text-red-600">{ajusteError}</p>}
          <button type="submit" disabled={procesando}
            className="w-full bg-brand hover:bg-brand-dark text-white rounded-lg py-2 text-sm font-medium transition-colors disabled:opacity-50">
            {procesando ? 'Registrando…' : 'Registrar pago'}
          </button>
        </form>
      </Modal>
    </div>
  )
}
