'use client'
import { useEffect, useRef, useState } from 'react'
import { fmtPrecio } from '@/lib/format'
import { formatDate, todayISO } from '@/lib/dates'
import { Upload, RefreshCw, AlertTriangle, CheckCircle2, FileSpreadsheet, Plus, Minus } from 'lucide-react'

/**
 * Conciliación de ventas: lo declarado al SII (archivos del RCV) contra lo que el
 * sistema dice haber vendido. La gracia es cazar plata vendida que nunca se
 * documentó, así que la diferencia se muestra siempre, aunque sea cero.
 */

type Tot = { docs: number; neto: number; exento: number; iva: number; total: number }
type Sii = {
  boletas: Tot; facturas: Tot; notas_credito: Tot; notas_debito: Tot; otros: Tot
  neto_venta: number; total_venta: number; periodos: string[]
}
type TotDoc = { docs: number; neto: number; total: number }
type Sistema = {
  ingresos: { general: number; convenio: number; adicionales: number; eutanasias: number }
  documentable: number
  emitido: { boletas: TotDoc; facturas: TotDoc; notas_credito: TotDoc; neto_venta: number }
}
type ItemDet = { clave: string; id: string; codigo: string; nombre: string; fecha: string; monto: number; documentado: boolean; documento: string }
type GrupoDet = { clave: string; label: string; se_documenta: boolean; total: number; docs: number; sin_documento: number; monto_sin_documento: number; items: ItemDet[] }

type Historico = { periodo: string; fecha_carga: string; sii: Sii | null; sistema: Sistema }
type Datos = {
  periodo: string; sii: Sii | null; fecha_carga: string; sistema: Sistema
  historico: Historico[]; periodos_cargados: string[]
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
const labelPeriodo = (p: string) => {
  const [y, m] = (p || '').split('-')
  const nombre = MESES[(parseInt(m, 10) || 1) - 1] || ''
  return `${nombre.charAt(0).toUpperCase()}${nombre.slice(1)} ${y || ''}`.trim()
}

// Desde 2024 hasta el año en curso: antes no hay documentos que traer.
const ANIOS = (() => {
  const y = parseInt(todayISO().slice(0, 4), 10)
  return Array.from({ length: y - 2023 }, (_, i) => String(y - i))
})()

/** Umbral bajo el cual una diferencia se considera redondeo y no un descuadre. */
const TOLERANCIA = 1000

const LABEL_ING: Record<keyof Sistema['ingresos'], string> = {
  general: 'Venta general',
  convenio: 'Venta veterinarias',
  adicionales: 'Adicionales',
  eutanasias: 'Comisión eutanasias',
}
/** Las eutanasias se cobran FUERA de la boleta: no deben buscarse en el SII. */
const DOCUMENTABLE: Record<keyof Sistema['ingresos'], boolean> = {
  general: true, convenio: true, adicionales: true, eutanasias: false,
}

function Fila({ label, valor, sub, fuerte, atenuado }: {
  label: string; valor: number; sub?: string; fuerte?: boolean; atenuado?: boolean
}) {
  return (
    <div className={`flex items-baseline justify-between gap-3 py-1.5 ${fuerte ? 'border-t border-gray-300 mt-1 pt-2' : ''}`}>
      <span className={`text-sm ${fuerte ? 'font-semibold text-gray-900' : atenuado ? 'text-gray-400' : 'text-gray-600'}`}>
        {label}
        {sub && <span className="block text-[11px] text-gray-400 leading-tight">{sub}</span>}
      </span>
      <span className={`tabular-nums whitespace-nowrap ${fuerte ? 'text-base font-bold text-gray-900' : atenuado ? 'text-sm text-gray-400' : 'text-sm text-gray-800'}`}>
        {fmtPrecio(valor)}
      </span>
    </div>
  )
}

export default function ConciliacionTab() {
  const [d, setD] = useState<Datos | null>(null)
  const [cargando, setCargando] = useState(true)
  const [subiendo, setSubiendo] = useState(false)
  const [msg, setMsg] = useState('')
  const [error, setError] = useState('')
  // `pedido` = período que el usuario eligió ('' = el último cargado, lo decide el
  // backend). `tick` fuerza recarga tras subir archivos.
  const [pedido, setPedido] = useState('')
  const [tick, setTick] = useState(0)
  const fileRef = useRef<HTMLInputElement>(null)
  // Período a sincronizar: arranca en el mes en curso, que es el caso normal.
  const [mes, setMes] = useState(todayISO().slice(5, 7))
  const [anio, setAnio] = useState(todayISO().slice(0, 4))
  const [sincronizando, setSincronizando] = useState(false)
  // Desglose por tipo de ingreso: se pide una sola vez por período y se cachea.
  const [det, setDet] = useState<GrupoDet[] | null>(null)
  const [abierto, setAbierto] = useState<string | null>(null)

  // La bandera `vivo` descarta respuestas de una consulta anterior: cambiar de mes
  // dos veces rápido puede resolver las peticiones fuera de orden y dejar en
  // pantalla el mes equivocado.
  useEffect(() => {
    let vivo = true
    ;(async () => {
      try {
        const q = pedido ? `?periodo=${encodeURIComponent(pedido)}` : ''
        const r = await fetch(`/api/facturacion/conciliacion${q}`, { cache: 'no-store' })
        const j = await r.json()
        if (!vivo) return
        if (!r.ok) { setError(j?.error || 'No se pudo cargar'); return }
        setD(j); setError(''); setDet(null); setAbierto(null)
      } catch { if (vivo) setError('Error de red') } finally { if (vivo) setCargando(false) }
    })()
    return () => { vivo = false }
  }, [pedido, tick])

  /**
   * Trae las ventas del mes desde OpenFactura. Se verificó contra los archivos
   * reales del SII: no falta ningún documento. Es idempotente (dedupe por
   * tipo+folio), así que sirve para refrescar el mes en curso.
   */
  async function sincronizar() {
    setSincronizando(true); setMsg(''); setError('')
    try {
      const r = await fetch('/api/facturacion/conciliacion', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ periodo: `${anio}-${mes}` }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { setError(j?.error || 'No se pudo sincronizar'); return }
      setMsg(`✓ ${labelPeriodo(j.periodo)}: ${j.agregados} documento(s) nuevo(s), ${j.total_documentos} en total.`)
      setPedido(j.periodo); setTick(t => t + 1)
    } catch { setError('Error de red') } finally { setSincronizando(false) }
  }

  /** Abre/cierra el desglose de una fila; la primera vez trae el detalle del mes. */
  async function alternar(clave: string) {
    setAbierto(a => (a === clave ? null : clave))
    if (det || !periodo) return
    try {
      const r = await fetch(`/api/facturacion/conciliacion/detalle?periodo=${encodeURIComponent(periodo)}`, { cache: 'no-store' })
      const j = await r.json()
      if (r.ok && Array.isArray(j?.grupos)) setDet(j.grupos)
    } catch { /* si falla, la fila queda abierta sin detalle */ }
  }

  async function subir(files: FileList) {
    setSubiendo(true); setMsg(''); setError('')
    try {
      const fd = new FormData()
      for (const f of Array.from(files)) fd.append('archivos', f)
      const r = await fetch('/api/facturacion/conciliacion', { method: 'POST', body: fd })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { setError(j?.error || 'No se pudo procesar'); return }
      setMsg(`✓ ${labelPeriodo(j.periodo)}: ${j.agregados} documento(s) nuevo(s), ${j.total_documentos} en total.`)
      setPedido(j.periodo); setTick(t => t + 1)
    } catch { setError('Error de red') } finally {
      setSubiendo(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  if (cargando) return <p className="text-sm text-gray-500">Cargando…</p>

  const periodo = d?.periodo || pedido
  const sii = d?.sii ?? null
  const sis = d?.sistema
  const diferencia = (sii?.neto_venta ?? 0) - (sis?.documentable ?? 0)
  const cuadra = Math.abs(diferencia) < TOLERANCIA

  return (
    <div className="space-y-4">
      {/* Sincronizar es el camino normal; la carga del archivo queda de respaldo. */}
      <div className="bg-white rounded-2xl border border-gray-300 shadow-md p-4">
        <div className="flex flex-wrap items-center gap-3">
          <select value={mes} onChange={e => setMes(e.target.value)} disabled={sincronizando}
            className="border border-gray-300 rounded-xl px-2 py-2 text-sm disabled:opacity-50">
            {MESES.map((m, i) => <option key={m} value={String(i + 1).padStart(2, '0')}>{m.charAt(0).toUpperCase() + m.slice(1)}</option>)}
          </select>
          <select value={anio} onChange={e => setAnio(e.target.value)} disabled={sincronizando}
            className="border border-gray-300 rounded-xl px-2 py-2 text-sm disabled:opacity-50">
            {ANIOS.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
          <button onClick={sincronizar} disabled={sincronizando || subiendo}
            className="inline-flex items-center gap-2 bg-brand text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-brand-dark disabled:opacity-50">
            <RefreshCw className={`w-4 h-4 ${sincronizando ? 'animate-spin' : ''}`} aria-hidden="true" />
            {sincronizando ? 'Sincronizando…' : 'Sincronizar SII'}
          </button>

          <div className="ml-auto flex items-center gap-3">
            {d && d.periodos_cargados.length > 0 && (
              <select value={periodo} onChange={e => setPedido(e.target.value)}
                title="Ver un período ya conciliado"
                className="border border-gray-300 rounded-xl px-3 py-2 text-sm">
                {d.periodos_cargados.map(p => <option key={p} value={p}>{labelPeriodo(p)}</option>)}
              </select>
            )}
            <input ref={fileRef} type="file" accept=".csv,.gz,text/csv,application/gzip" multiple className="hidden"
              onChange={e => { const fs = e.target.files; if (fs?.length) subir(fs) }} />
            <button onClick={() => fileRef.current?.click()} disabled={subiendo || sincronizando}
              title="Cargar los CSV de venta descargados del SII (detalle y/o boletas)"
              className="inline-flex items-center gap-2 border border-gray-300 text-gray-600 px-3 py-2 rounded-xl text-sm font-medium hover:bg-gray-50 disabled:opacity-50">
              <Upload className="w-4 h-4" aria-hidden="true" />
              {subiendo ? 'Procesando…' : 'Cargar Manual'}
            </button>
          </div>
        </div>
        <p className="text-xs text-gray-500 mt-2">
          Trae las ventas emitidas del mes (boletas, facturas y notas de crédito) sin pasar por el portal del SII.
          {d?.fecha_carga && <> · Última actualización: {formatDate(d.fecha_carga)}</>}
        </p>
      </div>

      {msg && <p className="text-sm text-gray-700 bg-emerald-50 border border-emerald-200 rounded-xl p-2.5">{msg}</p>}
      {error && <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl p-2.5">{error}</p>}

      {!sii ? (
        <div className="bg-white rounded-2xl border border-gray-300 shadow-md p-8 text-center">
          <FileSpreadsheet className="w-8 h-8 mx-auto text-gray-300 mb-2" aria-hidden="true" />
          <p className="text-sm text-gray-500">Todavía no hay ventas conciliadas para <strong>{labelPeriodo(periodo)}</strong>. Elige el mes y usa «Sincronizar SII».</p>
        </div>
      ) : (
        <>
          {/* Veredicto */}
          <div className={`rounded-2xl border shadow-md p-4 flex items-start gap-3 ${cuadra ? 'bg-emerald-50 border-emerald-300' : 'bg-amber-50 border-amber-300'}`}>
            {cuadra
              ? <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" aria-hidden="true" />
              : <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" aria-hidden="true" />}
            <div>
              <p className={`text-sm font-semibold ${cuadra ? 'text-emerald-900' : 'text-amber-900'}`}>
                {cuadra
                  ? `${labelPeriodo(periodo)} cuadra.`
                  : `${labelPeriodo(periodo)}: diferencia de ${fmtPrecio(Math.abs(diferencia))} (neto).`}
              </p>
              {!cuadra && (
                <p className="text-xs text-amber-800 mt-0.5">
                  {diferencia < 0
                    ? 'El sistema registra MÁS venta que el SII: hay servicios vendidos que no se boletearon ni facturaron.'
                    : 'El SII registra MÁS venta que el sistema: hay documentos emitidos sin ficha asociada, o fichas con fecha de retiro en otro mes.'}
                </p>
              )}
            </div>
          </div>

          {/* Los dos cuadros */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* SII */}
            <div className="bg-white rounded-2xl border border-gray-300 shadow-md p-4">
              <h3 className="text-sm font-bold text-brand mb-1">Según el SII</h3>
              <p className="text-[11px] text-gray-500 mb-2">Montos netos del registro de ventas.</p>
              <Fila label="Boletas" valor={sii.boletas.neto + sii.boletas.exento} sub={`${sii.boletas.docs} documento(s)`} />
              <Fila label="Facturas" valor={sii.facturas.neto + sii.facturas.exento} sub={`${sii.facturas.docs} documento(s)`} />
              {sii.notas_debito.docs > 0 && (
                <Fila label="Notas de débito" valor={sii.notas_debito.neto + sii.notas_debito.exento} sub={`${sii.notas_debito.docs} documento(s)`} />
              )}
              <Fila label="Notas de crédito" valor={-(sii.notas_credito.neto + sii.notas_credito.exento)} sub={`${sii.notas_credito.docs} documento(s) · restan`} />
              <Fila label="Venta neta declarada" valor={sii.neto_venta} fuerte />
            </div>

            {/* Sistema */}
            <div className="bg-white rounded-2xl border border-gray-300 shadow-md p-4">
              <h3 className="text-sm font-bold text-brand mb-1">Según el sistema</h3>
              <p className="text-[11px] text-gray-500 mb-2">Lo que va al Estado de Resultados, por tipo de ingreso.</p>
              {(Object.keys(LABEL_ING) as Array<keyof Sistema['ingresos']>).map(k => {
                const g = det?.find(x => x.clave === k)
                const open = abierto === k
                return (
                  <div key={k}>
                    <button onClick={() => alternar(k)}
                      className="w-full flex items-baseline justify-between gap-3 py-1.5 text-left hover:bg-gray-50 rounded-lg px-1 -mx-1">
                      <span className={`text-sm flex items-center gap-1.5 ${DOCUMENTABLE[k] ? 'text-gray-600' : 'text-gray-400'}`}>
                        {open
                          ? <Minus className="w-3.5 h-3.5 shrink-0 text-gray-400" aria-hidden="true" />
                          : <Plus className="w-3.5 h-3.5 shrink-0 text-gray-400" aria-hidden="true" />}
                        <span>
                          {LABEL_ING[k]}
                          {!DOCUMENTABLE[k] && <span className="block text-[11px] text-gray-400 leading-tight ml-5">Se cobra fuera de boleta — no se busca en el SII</span>}
                          {DOCUMENTABLE[k] && g && g.sin_documento > 0 && (
                            <span className="block text-[11px] text-amber-700 leading-tight">
                              {g.sin_documento} sin documento · {fmtPrecio(g.monto_sin_documento)}
                            </span>
                          )}
                        </span>
                      </span>
                      <span className={`tabular-nums whitespace-nowrap text-sm ${DOCUMENTABLE[k] ? 'text-gray-800' : 'text-gray-400'}`}>
                        {fmtPrecio(sis!.ingresos[k])}
                      </span>
                    </button>
                    {open && (
                      <div className="ml-5 mb-2 border-l-2 border-gray-200 pl-3">
                        {!g ? (
                          <p className="text-[11px] text-gray-400 py-1">Cargando detalle…</p>
                        ) : g.items.length === 0 ? (
                          <p className="text-[11px] text-gray-400 py-1">Sin movimientos este mes.</p>
                        ) : (
                          <div className="max-h-64 overflow-y-auto overflow-x-auto">
                            <table className="w-full text-[11px] min-w-[300px]">
                              <tbody className="divide-y divide-gray-100">
                                {g.items.map((it, i) => (
                                  <tr key={`${it.id}-${i}`} className={it.documentado || !g.se_documenta ? '' : 'bg-amber-50'}>
                                    <td className="py-1 pr-2 whitespace-nowrap text-gray-500">{it.fecha ? formatDate(it.fecha) : '—'}</td>
                                    <td className="py-1 pr-2 text-gray-800">
                                      {it.codigo && <span className="text-gray-500">{it.codigo} · </span>}{it.nombre || '—'}
                                    </td>
                                    <td className={`py-1 pr-2 whitespace-nowrap ${it.documentado ? 'text-gray-500' : g.se_documenta ? 'text-amber-700 font-medium' : 'text-gray-400'}`}>
                                      {it.documento}
                                    </td>
                                    <td className="py-1 text-right tabular-nums whitespace-nowrap text-gray-700">{fmtPrecio(it.monto)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
              <Fila label="Venta que debería estar documentada" valor={sis!.documentable} fuerte />
              <div className="mt-3 pt-2 border-t border-dashed border-gray-300">
                <p className="text-[11px] text-gray-500 mb-1">
                  Documentos que registramos haber emitido ({sis!.emitido.boletas.docs} boletas · {sis!.emitido.facturas.docs} facturas · {sis!.emitido.notas_credito.docs} NC)
                </p>
                <Fila label="Venta neta emitida por nosotros" valor={sis!.emitido.neto_venta} />
                {Math.abs(sis!.emitido.neto_venta - sii.neto_venta) >= TOLERANCIA && (
                  <p className="text-[11px] text-amber-700 mt-1">
                    ⚠ No calza con el SII por {fmtPrecio(Math.abs(sis!.emitido.neto_venta - sii.neto_venta))}: revisa documentos rechazados o emitidos fuera del sistema.
                  </p>
                )}
              </div>
            </div>
          </div>
        </>
      )}

      {/* Histórico */}
      {d && d.historico.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-300 shadow-md overflow-x-auto">
          <h3 className="text-sm font-bold text-brand px-4 pt-4 pb-2">Meses anteriores</h3>
          <table className="w-full text-xs min-w-[620px]">
            <thead className="bg-gray-50 text-gray-500 uppercase">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Período</th>
                <th className="px-3 py-2 text-right font-medium">SII (neto)</th>
                <th className="px-3 py-2 text-right font-medium">Sistema (neto)</th>
                <th className="px-3 py-2 text-right font-medium">Diferencia</th>
                <th className="px-3 py-2 text-left font-medium">Cargado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {d.historico.map(h => {
                const dif = (h.sii?.neto_venta ?? 0) - h.sistema.documentable
                const ok = Math.abs(dif) < TOLERANCIA
                return (
                  <tr key={h.periodo} className="hover:bg-gray-50">
                    <td className="px-3 py-2">
                      <button onClick={() => setPedido(h.periodo)}
                        className="font-medium text-brand-soft hover:underline">
                        {labelPeriodo(h.periodo)}
                      </button>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-700">{fmtPrecio(h.sii?.neto_venta ?? 0)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-700">{fmtPrecio(h.sistema.documentable)}</td>
                    <td className={`px-3 py-2 text-right tabular-nums font-semibold ${ok ? 'text-emerald-700' : 'text-amber-700'}`}>
                      {ok ? '—' : fmtPrecio(dif)}
                    </td>
                    <td className="px-3 py-2 text-gray-500">{h.fecha_carga ? formatDate(h.fecha_carga) : '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
