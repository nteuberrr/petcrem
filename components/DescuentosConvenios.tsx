'use client'
import { useState, useEffect, useCallback, Fragment } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Badge } from '@/components/ui/Badge'
import { Card, Button } from '@/components/ui/kit'
import { fmtPrecio, fmtFecha, fmtKg } from '@/lib/format'
import { todayISO } from '@/lib/dates'
import { useAccionUnica } from '@/lib/use-accion-unica'

/**
 * Configuración → Descuentos Convenios.
 *
 * Lo que se le paga a un veterinario por DERIVAR un caso que terminamos cobrando.
 *
 * ⚠️ Acá NO se decide a quién se le cobra: eso es el interruptor "Boleta al cliente"
 * de la ficha del veterinario (Bases). Van de la mano —al que solo deriva se le
 * cobra al tutor y se le paga comisión— pero son dos datos distintos desde el
 * 19-08-2026, así que una comisión sin ese interruptor significa facturarle el
 * servicio Y pagarle por derivarlo. La tabla lo marca en rojo.
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
  boleta_al_cliente: boolean
  cantidad_devengos: number
  devengado: number
  ajustado: number
  saldo: number
}
interface Devengo {
  id: string; cliente_id: string; codigo: string; nombre_mascota: string
  peso: number; codigo_servicio: string
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
  // `indexar` es el estado DESEADO y `indexadoActual` el que tiene hoy la vet: al
  // guardar solo se llama a la API si difieren. Antes el checkbox era una ACCIÓN
  // ("indexar ahora") y al editar una vet YA indexada aparecía DESMARCADO, que se
  // lee como "no está indexada" — reporte del dueño con Manuel Astorga, 19-08-2026.
  const [reglaForm, setReglaForm] = useState({ veterinaria_id: '', tipo: 'fijo' as 'fijo' | 'variable', valor: '', indexar: true, indexadoActual: false })
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
    if (!reglaForm.veterinaria_id) { setReglaError('Selecciona una veterinaria.'); return }
    if (!valor || valor <= 0) { setReglaError('Ingresa un valor mayor a 0.'); return }
    if (reglaForm.tipo === 'variable' && valor > 100) { setReglaError('Un porcentaje no puede superar 100.'); return }
    const r = await fetch('/api/comisiones', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accion: 'regla', veterinaria_id: reglaForm.veterinaria_id, tipo: reglaForm.tipo, valor }),
    })
    const d = await r.json()
    if (!r.ok) { setReglaError(d.error || 'No se pudo guardar.'); return }
    if (reglaForm.indexar !== reglaForm.indexadoActual) {
      const accion = reglaForm.indexar ? 'indexar' : 'desindexar'
      const ri = await fetch('/api/comisiones', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accion, veterinaria_id: reglaForm.veterinaria_id }),
      })
      if (!ri.ok) {
        const di = await ri.json().catch(() => ({}))
        setReglaError(`La comisión quedó guardada, pero no se pudo ${accion} sus precios: ${di.error || ri.status}`)
        await cargar()
        return
      }
    }
    setShowRegla(false)
    setReglaForm({ veterinaria_id: '', tipo: 'fijo', valor: '', indexar: true, indexadoActual: false })
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
    if (!monto || monto <= 0) { setAjusteError('Ingresa un monto mayor a 0.'); return }
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

  const etiquetaRegla = (r: Regla | null) =>
    !r ? '—' : r.tipo === 'variable' ? `${r.valor}% de la cremación` : fmtPrecio(r.valor)

  return (
    <div className="space-y-5">
      <Card className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-bold text-brand">Comisiones por derivación</h2>
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
                    <th className="text-right px-4 py-2.5 hidden md:table-cell">Comisión</th>
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
                      <tr className="hover:bg-gray-50 align-middle">
                        <td className="px-2 md:px-4 py-2.5">
                          {/* La flecha gira al abrir: deja claro que la fila despliega
                              el detalle de la cuenta hacia abajo. */}
                          <button onClick={() => abrirDetalle(s.veterinaria_id)}
                            className="flex items-center gap-1.5 text-left group">
                            <span className={`text-gray-400 group-hover:text-brand transition-transform ${expandido === s.veterinaria_id ? 'rotate-90' : ''}`}>▸</span>
                            <span className="font-medium text-gray-900 group-hover:text-brand">{s.nombre}</span>
                          </button>
                          {/* Solo las EXCEPCIONES bajo el nombre: que los precios estén
                              indexados es lo normal y no necesita confirmarse acá (se ve
                              en Configuración → Precios). Así la fila queda en una línea. */}
                          {(!s.regla || !s.indexado || !s.boleta_al_cliente) && (
                            <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                              {!s.regla && <Badge variant="gray">Sin regla vigente</Badge>}
                              {/* Comisión sin "Boleta al cliente": se le factura el
                                  servicio Y se le paga por derivarlo. Casi nunca es
                                  la intención, y en silencio no se nota. */}
                              {s.regla && !s.boleta_al_cliente && (
                                <span className="text-[11px] font-semibold text-red-800 bg-red-50 border border-red-200 rounded-full px-2 py-0.5">
                                  Se le factura el servicio — enciende &laquo;Boleta al cliente&raquo; en su ficha
                                </span>
                              )}
                              {!s.indexado && (
                                <button onClick={() => indexarPrecios(s)} disabled={procesando}
                                  className="text-[11px] font-semibold text-amber-800 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5 hover:bg-amber-100 disabled:opacity-50">
                                  Precios sin indexar — indexar a generales
                                </button>
                              )}
                            </div>
                          )}
                          <div className="md:hidden mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                            <span>{etiquetaRegla(s.regla)}</span>
                            <span>· {s.cantidad_devengos} derivación{s.cantidad_devengos === 1 ? '' : 'es'}</span>
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-right text-gray-700 hidden md:table-cell whitespace-nowrap tabular-nums">{etiquetaRegla(s.regla)}</td>
                        <td className="px-4 py-2.5 text-right text-gray-600 hidden md:table-cell tabular-nums">{s.cantidad_devengos}</td>
                        <td className="px-2 md:px-4 py-2.5 text-right text-emerald-700 whitespace-nowrap tabular-nums">{fmtPrecio(s.devengado)}</td>
                        <td className="px-4 py-2.5 text-right text-red-600 hidden md:table-cell whitespace-nowrap tabular-nums">{fmtPrecio(s.ajustado)}</td>
                        <td className={`px-2 md:px-4 py-2.5 text-right font-bold whitespace-nowrap tabular-nums ${s.saldo < 0 ? 'text-red-600' : 'text-emerald-700'}`}>
                          {fmtPrecio(s.saldo)}
                        </td>
                        <td className="px-2 md:px-4 py-2.5">
                          <div className="flex items-center justify-end gap-2">
                            <button onClick={() => { setAjusteError(''); setAjusteForm({ monto: '', detalle: '', fecha: todayISO() }); setAjuste(s) }}
                              className="text-xs font-semibold text-white bg-brand rounded-lg px-3 py-1.5 hover:bg-brand-dark">
                              Ajustar saldo
                            </button>
                            {s.regla && (
                              <button onClick={() => { setReglaError(''); setReglaForm({ veterinaria_id: s.veterinaria_id, tipo: s.regla!.tipo, valor: String(s.regla!.valor), indexar: s.indexado, indexadoActual: s.indexado }); setShowRegla(true) }}
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
                              <LibroMayor detalle={detalle} />
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
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
              onChange={e => {
                const vid = e.target.value
                // El estado de indexado es POR VETERINARIA: al cambiar de vet hay que
                // traer el suyo, si no el checkbox muestra el de la anterior.
                const ya = saldos.find(s => s.veterinaria_id === vid)?.indexado ?? false
                setReglaForm(f => ({ ...f, veterinaria_id: vid, indexadoActual: ya, indexar: ya || f.indexar }))
              }}
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
            ya con descuento aplicado). La comisión se devenga cuando la ficha queda pagada.
          </p>
          <label className="flex items-start gap-2 text-sm text-gray-700 bg-cream border border-gold-soft/40 rounded-lg px-3 py-2 cursor-pointer">
            <input type="checkbox" checked={reglaForm.indexar}
              onChange={e => setReglaForm(f => ({ ...f, indexar: e.target.checked }))}
              className="w-4 h-4 mt-0.5" />
            <span>
              <strong>Sus precios siguen a los generales</strong>
              <span className="block text-xs text-gray-500 mt-0.5">
                Al tutor se le cobra el precio de lista, así que la tarifa del vet es la general y queda
                siguiéndola: si mañana cambian los precios generales, los suyos cambian solos.
                {reglaForm.indexadoActual && reglaForm.indexar
                  ? ' Ya está así: desmárcalo solo si quieres darle una tarifa propia.'
                  : ''}
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

/**
 * Libro mayor de la cuenta del veterinario: comisiones y abonos en UNA sola tabla,
 * fila por fila y en orden de fecha, con el monto en la columna que corresponde
 * (comisión suma al saldo, abono lo baja). Arriba, los dos totales con el saldo
 * en el medio. Las comisiones anuladas se muestran tachadas y no suman.
 */
function LibroMayor({ detalle }: { detalle: { devengos: Devengo[]; ajustes: Ajuste[] } }) {
  const filas = [
    ...detalle.devengos.map(d => ({
      key: `c${d.id}`,
      fecha: d.fecha_devengo,
      codigo: d.codigo || `#${d.cliente_id}`,
      detalle: [d.nombre_mascota, d.peso > 0 ? fmtKg(d.peso) : ''].filter(Boolean).join(' · '),
      comision: d.monto,
      abono: 0,
      anulada: d.estado !== 'devengada',
    })),
    ...detalle.ajustes.map(a => ({
      key: `a${a.id}`,
      fecha: a.fecha,
      codigo: 'ABONO',
      detalle: a.detalle || 'Pago al veterinario',
      comision: 0,
      abono: a.monto,
      anulada: false,
    })),
  ].sort((x, y) => (x.fecha || '').localeCompare(y.fecha || '') || x.key.localeCompare(y.key))

  const totalComisiones = filas.filter(f => !f.anulada).reduce((s, f) => s + f.comision, 0)
  const totalAbonos = filas.reduce((s, f) => s + f.abono, 0)
  const saldo = totalComisiones - totalAbonos

  if (filas.length === 0) return <p className="text-xs text-gray-400">Todavía no hay movimientos.</p>

  return (
    <div className="space-y-3">
      {/* Comisiones (suman) en verde · abonos (restan) en rojo · saldo a la derecha,
          con el color del lado al que se inclina. */}
      <div className="grid grid-cols-3 gap-2">
        <div className="bg-white border border-gray-300 rounded-lg px-3 py-2 text-center">
          <div className="text-[10px] uppercase text-gray-400 font-semibold">Comisiones</div>
          <div className="text-sm font-bold text-emerald-700">{fmtPrecio(totalComisiones)}</div>
        </div>
        <div className="bg-white border border-gray-300 rounded-lg px-3 py-2 text-center">
          <div className="text-[10px] uppercase text-gray-400 font-semibold">Abonos</div>
          <div className="text-sm font-bold text-red-600">{fmtPrecio(totalAbonos)}</div>
        </div>
        <div className={`border rounded-lg px-3 py-2 text-center ${saldo < 0 ? 'bg-red-50 border-red-200' : 'bg-emerald-50 border-emerald-200'}`}>
          <div className="text-[10px] uppercase text-gray-500 font-semibold">Saldo</div>
          <div className={`text-sm font-bold ${saldo < 0 ? 'text-red-600' : 'text-emerald-700'}`}>{fmtPrecio(saldo)}</div>
        </div>
      </div>

      <div className="overflow-x-auto bg-white border border-gray-300 rounded-lg">
        <table className="w-full text-xs min-w-[460px]">
          <thead>
            <tr className="text-[10px] uppercase text-gray-400 border-b border-gray-300 bg-gray-50">
              <th className="text-left px-3 py-1.5 font-semibold">Fecha</th>
              <th className="text-left px-3 py-1.5 font-semibold">Código</th>
              <th className="text-left px-3 py-1.5 font-semibold">Detalle</th>
              <th className="text-right px-3 py-1.5 font-semibold">Comisión</th>
              <th className="text-right px-3 py-1.5 font-semibold">Abono</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filas.map(f => (
              <tr key={f.key} className={f.abono > 0 ? 'bg-red-50/60' : ''}>
                <td className="px-3 py-1.5 text-gray-500 whitespace-nowrap">{f.fecha ? fmtFecha(f.fecha) : '—'}</td>
                <td className={`px-3 py-1.5 font-mono font-bold whitespace-nowrap ${f.abono > 0 ? 'text-red-600' : 'text-brand'}`}>{f.codigo}</td>
                <td className={`px-3 py-1.5 text-gray-700 ${f.anulada ? 'line-through text-gray-400' : ''}`}>
                  {f.detalle || '—'}
                  {f.anulada && <span className="ml-1 text-red-600 no-underline">(anulada)</span>}
                </td>
                <td className={`px-3 py-1.5 text-right whitespace-nowrap ${f.anulada ? 'line-through text-gray-400' : 'font-semibold text-emerald-700'}`}>
                  {f.comision > 0 ? fmtPrecio(f.comision) : ''}
                </td>
                <td className="px-3 py-1.5 text-right font-semibold text-red-600 whitespace-nowrap">
                  {f.abono > 0 ? fmtPrecio(f.abono) : ''}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-gray-300 bg-gray-50">
              <td colSpan={3} className="px-3 py-1.5 text-right font-semibold text-gray-600">Totales</td>
              <td className="px-3 py-1.5 text-right font-bold text-emerald-700 whitespace-nowrap">{fmtPrecio(totalComisiones)}</td>
              <td className="px-3 py-1.5 text-right font-bold text-red-600 whitespace-nowrap">{fmtPrecio(totalAbonos)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}
