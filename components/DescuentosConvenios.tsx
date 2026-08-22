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
interface Ajuste {
  id: string; monto: number; detalle: string; fecha: string; creado_por_nombre: string
  /** Ficha contra la que se canjeo el saldo ('' = transferencia). */
  cliente_id: string; codigo: string; nombre_mascota: string
}
/** Ficha ofrecible para canjear: servicio prestado que no se le cobro a nadie. */
interface Canjeable {
  id: string; codigo: string; nombre_mascota: string; fecha: string
  veterinaria_id: string; monto: number; sin_boleta: boolean
}

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
  const [ajusteForm, setAjusteForm] = useState({ monto: '', detalle: '', fecha: todayISO(), cliente_id: '' })
  const [canjeables, setCanjeables] = useState<Canjeable[]>([])
  // Por defecto solo las MARCADAS "no emitir boleta": son las que de verdad no se
  // le cobraron a nadie. El resto todavia puede entrar en la factura del mes de
  // su veterinario, y canjear una de esas cobraria el servicio dos veces.
  const [verTodasCanjeables, setVerTodasCanjeables] = useState(false)
  const [ajusteError, setAjusteError] = useState('')
  /** Pago que se está CORRIGIENDO (null = se está registrando uno nuevo). */
  const [editando, setEditando] = useState<Ajuste | null>(null)

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

  // Las fichas canjeables se piden al ABRIR el modal (y al cambiar el filtro), no
  // al montar: son una consulta sobre todas las fichas y la mayoria de las veces
  // esta pestana se usa sin registrar ningun pago.
  useEffect(() => {
    if (!ajuste) return
    let cancel = false
    fetch(`/api/comisiones?canjeables=1${verTodasCanjeables ? '&todas=1' : ''}`, { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : []))
      .then(d => { if (!cancel) setCanjeables(Array.isArray(d) ? d : []) })
      .catch(() => { if (!cancel) setCanjeables([]) })
    return () => { cancel = true }
  }, [ajuste, verTodasCanjeables])

  /** `forzar` = recargar el detalle sin plegarlo (después de editar un pago). */
  async function abrirDetalle(vetId: string, opts: { forzar?: boolean } = {}) {
    if (expandido === vetId && !opts.forzar) { setExpandido(null); setDetalle(null); return }
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

  /** Cierra el modal y refresca saldo + libro mayor de la vet abierta. */
  const cerrarAjuste = async () => {
    setAjuste(null)
    setEditando(null)
    setAjusteForm({ monto: '', detalle: '', fecha: todayISO(), cliente_id: '' })
    const vid = expandido
    await cargar()
    // Se vuelve a pedir el detalle en vez de cerrarlo: después de corregir un
    // pago lo que uno quiere es VER cómo quedó la cuenta, no que se pliegue.
    if (vid) await abrirDetalle(vid, { forzar: true })
  }

  const guardarAjuste = () => ejecutar(async () => {
    if (!ajuste) return
    setAjusteError('')
    const monto = parseInt(ajusteForm.monto, 10)
    if (!monto || monto <= 0) { setAjusteError('Ingresa un monto mayor a 0.'); return }
    // Editar mueve TAMBIÉN el gasto en el EERR (lo resuelve el servidor): el
    // saldo y el Estado de Resultados no pueden quedar con números distintos.
    const r = editando
      ? await fetch('/api/comisiones', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accion: 'ajuste', id: editando.id, monto, detalle: ajusteForm.detalle, fecha: ajusteForm.fecha, cliente_id: ajusteForm.cliente_id }),
      })
      : await fetch('/api/comisiones', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accion: 'ajuste', veterinaria_id: ajuste.veterinaria_id, monto, detalle: ajusteForm.detalle, fecha: ajusteForm.fecha, cliente_id: ajusteForm.cliente_id }),
      })
    const d = await r.json()
    if (!r.ok) { setAjusteError(d.error || 'No se pudo guardar.'); return }
    await cerrarAjuste()
  })

  const borrarAjuste = () => ejecutar(async () => {
    if (!editando) return
    setAjusteError('')
    if (!confirm(
      `¿Borrar este pago de ${fmtPrecio(editando.monto)}?\n\n`
      + 'Se elimina también su costo en el Estado de Resultados, y el saldo del veterinario vuelve a subir.',
    )) return
    const r = await fetch(`/api/comisiones?ajuste_id=${encodeURIComponent(editando.id)}`, { method: 'DELETE' })
    if (!r.ok) {
      const d = await r.json().catch(() => ({}))
      setAjusteError(d.error || 'No se pudo borrar.')
      return
    }
    await cerrarAjuste()
  })

  /** Abre el modal cargado con un pago ya registrado, para corregirlo. */
  function editarAjuste(vet: SaldoVet, a: Ajuste) {
    setAjusteError('')
    setEditando(a)
    setAjuste(vet)
    setAjusteForm({ monto: String(a.monto), detalle: a.detalle || '', fecha: a.fecha || todayISO(), cliente_id: a.cliente_id || '' })
  }

  /** La ficha elegida para canjear, si hay alguna. */
  const fichaElegida = canjeables.find(c => c.id === ajusteForm.cliente_id) || null

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
                            <button onClick={() => { setAjusteError(''); setAjusteForm({ monto: '', detalle: '', fecha: todayISO(), cliente_id: '' }); setAjuste(s) }}
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
                              <LibroMayor detalle={detalle} onEditarAjuste={a => editarAjuste(s, a)} />
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

      {/* Ajuste de saldo → costo de venta. El MISMO modal registra y corrige: si
          fueran dos, el día que cambie un campo hay que acordarse de los dos. */}
      <Modal open={!!ajuste} onClose={() => { setAjuste(null); setEditando(null) }}
        title={`${editando ? 'Editar pago' : 'Ajustar saldo'} — ${ajuste?.nombre ?? ''}`}>
        <form onSubmit={e => { e.preventDefault(); guardarAjuste() }} className="space-y-4">
          <div className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm">
            <div className="flex justify-between"><span className="text-gray-600">Saldo actual</span>
              <span className="font-bold text-gray-900">{fmtPrecio(ajuste?.saldo ?? 0)}</span></div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-gray-700">
                {ajusteForm.cliente_id ? 'Monto canjeado' : 'Monto pagado'}
              </label>
              <input type="number" required min={1} value={ajusteForm.monto}
                onChange={e => setAjusteForm(f => ({ ...f, monto: e.target.value }))}
                className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand" />
              {/* Si se tocó a mano y ya no calza con el precio del servicio, se
                  dice: un canje por un monto distinto al del servicio suele ser
                  un error de tipeo, no una decisión. */}
              {fichaElegida && fichaElegida.monto > 0 && parseInt(ajusteForm.monto, 10) !== fichaElegida.monto && (
                <p className="mt-1 text-[11px] text-amber-700">
                  El servicio de {fichaElegida.nombre_mascota} vale {fmtPrecio(fichaElegida.monto)}.
                </p>
              )}
            </div>
            <div>
              <label className="text-xs font-medium text-gray-700">Fecha</label>
              <input type="date" value={ajusteForm.fecha}
                onChange={e => setAjusteForm(f => ({ ...f, fecha: e.target.value }))}
                className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand" />
              {/* Se dice de dónde salió la fecha: cambia sola al elegir la
                  mascota y es la que decide en QUÉ MES cae el costo de venta. */}
              {fichaElegida && fichaElegida.fecha && (
                fichaElegida.fecha === ajusteForm.fecha
                  ? <p className="mt-1 text-[11px] text-gray-500">Es la fecha de retiro de {fichaElegida.nombre_mascota}.</p>
                  : <p className="mt-1 text-[11px] text-amber-700">{fichaElegida.nombre_mascota} se retiró el {fmtFecha(fichaElegida.fecha)}.</p>
              )}
            </div>
          </div>
          {/* CANJE: contra qué servicio se aplicó el saldo. Es opcional — un pago
              por transferencia no tiene ficha —, pero cuando la hay el libro
              mayor muestra el código en vez de un comentario escrito a mano. */}
          <div>
            <label className="text-xs font-medium text-gray-700">Mascota canjeada (opcional)</label>
            <select value={ajusteForm.cliente_id}
              onChange={e => {
                // Al elegir la mascota, el ajuste toma el PRECIO y la FECHA DE
                // RETIRO de ese servicio: eso es lo que se está canjeando. Los
                // dos quedan editables por si se acordó otra cosa, pero el
                // default son los datos reales y no algo escrito a mano.
                // Ojo con la fecha: es la que le pone el mes al costo de venta
                // en el Estado de Resultados, así que el canje queda imputado
                // al mes en que se prestó el servicio, no al de la carga.
                const cid = e.target.value
                const f2 = canjeables.find(c => c.id === cid)
                setAjusteForm(f => ({
                  ...f,
                  cliente_id: cid,
                  monto: f2 && f2.monto > 0 ? String(f2.monto) : f.monto,
                  fecha: f2?.fecha || f.fecha,
                }))
              }}
              className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand">
              <option value="">Sin canje (fue una transferencia)</option>
              {canjeables.map(c => (
                <option key={c.id} value={c.id}>
                  {c.codigo} · {c.nombre_mascota}{c.fecha ? ` · ${fmtFecha(c.fecha)}` : ''}{c.monto > 0 ? ` · ${fmtPrecio(c.monto)}` : ''}
                </option>
              ))}
            </select>
            <label className="mt-1.5 flex items-center gap-1.5 text-[11px] text-gray-500 cursor-pointer">
              <input type="checkbox" checked={verTodasCanjeables}
                onChange={e => setVerTodasCanjeables(e.target.checked)} />
              Ver también las que aún no tienen documento pero no están marcadas
            </label>
            <p className="mt-1 text-[11px] text-gray-400">
              {verTodasCanjeables
                ? <>Ojo: acá entran fichas que todavía pueden salir en la factura del mes de su veterinario. Canjear una de esas cobraría el servicio dos veces.</>
                : <>Se ofrecen los servicios de agosto en adelante marcados <strong>«No emitir boleta por este servicio»</strong> y sin factura al veterinario. Si no aparece la que buscas, márcala así en su ficha.</>}
            </p>
          </div>

          <div>
            <label className="text-xs font-medium text-gray-700">Detalle (opcional)</label>
            <input type="text" value={ajusteForm.detalle}
              onChange={e => setAjusteForm(f => ({ ...f, detalle: e.target.value }))}
              placeholder="N° de transferencia, período pagado…"
              className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand" />
          </div>
          <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            {editando
              ? <>Al guardar se corrige también su <strong>costo de venta</strong> en el Estado de Resultados
                  (partida “Comisiones convenios”). Para moverlo a otra veterinaria hay que borrarlo y cargarlo de nuevo.</>
              : <>Este monto se registra como <strong>costo de venta</strong> en el Estado de Resultados
                  (partida “Comisiones convenios”), con la fecha indicada.</>}
          </p>
          {ajusteError && <p className="text-xs text-red-600">{ajusteError}</p>}
          <div className="flex gap-2">
            {editando && (
              <button type="button" onClick={borrarAjuste} disabled={procesando}
                className="border border-red-300 text-red-700 hover:bg-red-50 rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50">
                Borrar
              </button>
            )}
            <button type="submit" disabled={procesando}
              className="flex-1 bg-brand hover:bg-brand-dark text-white rounded-lg py-2 text-sm font-medium transition-colors disabled:opacity-50">
              {procesando ? 'Guardando…' : editando ? 'Guardar cambios' : 'Registrar pago'}
            </button>
          </div>
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
function LibroMayor({ detalle, onEditarAjuste }: {
  detalle: { devengos: Devengo[]; ajustes: Ajuste[] }
  /** Corregir un pago ya registrado. Solo los ABONOS son editables: una comisión
   *  se devenga sola desde la ficha, así que a mano no se toca. */
  onEditarAjuste?: (a: Ajuste) => void
}) {
  const ajustePorId = new Map(detalle.ajustes.map(a => [a.id, a]))
  const filas = [
    ...detalle.devengos.map(d => ({
      key: `c${d.id}`,
      ajusteId: '',
      fecha: d.fecha_devengo,
      codigo: d.codigo || `#${d.cliente_id}`,
      detalle: [d.nombre_mascota, d.peso > 0 ? fmtKg(d.peso) : ''].filter(Boolean).join(' · '),
      comision: d.monto,
      abono: 0,
      anulada: d.estado !== 'devengada',
    })),
    ...detalle.ajustes.map(a => ({
      key: `a${a.id}`,
      ajusteId: a.id,
      fecha: a.fecha,
      // Con canje manda el codigo de la ficha: es lo que dice contra QUE servicio
      // se aplico el saldo. Sin canje fue una transferencia y va la etiqueta.
      codigo: a.codigo || 'ABONO',
      detalle: [
        a.codigo ? `Canje · ${a.nombre_mascota || 'servicio'}` : '',
        a.detalle,
      ].filter(Boolean).join(' — ') || 'Pago al veterinario',
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
              <th className="px-2 py-1.5"></th>
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
                <td className="px-2 py-1.5 text-right whitespace-nowrap">
                  {f.ajusteId && onEditarAjuste && (
                    <button
                      onClick={() => { const a = ajustePorId.get(f.ajusteId); if (a) onEditarAjuste(a) }}
                      className="text-[11px] font-semibold text-brand hover:underline">
                      Editar
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-gray-300 bg-gray-50">
              <td colSpan={3} className="px-3 py-1.5 text-right font-semibold text-gray-600">Totales</td>
              <td className="px-3 py-1.5 text-right font-bold text-emerald-700 whitespace-nowrap">{fmtPrecio(totalComisiones)}</td>
              <td className="px-3 py-1.5 text-right font-bold text-red-600 whitespace-nowrap">{fmtPrecio(totalAbonos)}</td>
              <td className="px-2 py-1.5"></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}
