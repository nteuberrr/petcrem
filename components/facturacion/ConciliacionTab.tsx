'use client'
import { useEffect, useRef, useState } from 'react'
import { fmtPrecio } from '@/lib/format'
import { formatDate } from '@/lib/dates'
import { Upload, AlertTriangle, CheckCircle2, FileSpreadsheet } from 'lucide-react'

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
        setD(j); setError('')
      } catch { if (vivo) setError('Error de red') } finally { if (vivo) setCargando(false) }
    })()
    return () => { vivo = false }
  }, [pedido, tick])

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
      {/* Carga de los dos archivos del SII */}
      <div className="bg-white rounded-2xl border border-gray-300 shadow-md p-4">
        <div className="flex flex-wrap items-center gap-3">
          <input ref={fileRef} type="file" accept=".csv,.gz,text/csv,application/gzip" multiple className="hidden"
            onChange={e => { const fs = e.target.files; if (fs?.length) subir(fs) }} />
          <button onClick={() => fileRef.current?.click()} disabled={subiendo}
            className="inline-flex items-center gap-2 bg-brand text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-brand-dark disabled:opacity-50">
            <Upload className="w-4 h-4" aria-hidden="true" />
            {subiendo ? 'Procesando…' : 'Cargar archivos del SII'}
          </button>
          {d && d.periodos_cargados.length > 0 && (
            <select value={periodo} onChange={e => setPedido(e.target.value)}
              className="border border-gray-300 rounded-xl px-3 py-2 text-sm">
              {d.periodos_cargados.map(p => <option key={p} value={p}>{labelPeriodo(p)}</option>)}
            </select>
          )}
          {d?.fecha_carga && <span className="text-xs text-gray-500">Última carga: {formatDate(d.fecha_carga)}</span>}
        </div>
        <p className="text-xs text-gray-500 mt-2">
          Del SII → Registro de Compra y Venta → pestaña <strong>VENTA</strong>: «Descargar Detalles» (facturas y notas de crédito)
          y «Descargar Boletas» (queda pendiente, se refresca y baja un <code>.csv.gz</code>). Puedes subir los dos juntos o uno
          por vez — se combinan en el mismo mes. El período se detecta solo.
        </p>
      </div>

      {msg && <p className="text-sm text-gray-700 bg-emerald-50 border border-emerald-200 rounded-xl p-2.5">{msg}</p>}
      {error && <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl p-2.5">{error}</p>}

      {!sii ? (
        <div className="bg-white rounded-2xl border border-gray-300 shadow-md p-8 text-center">
          <FileSpreadsheet className="w-8 h-8 mx-auto text-gray-300 mb-2" aria-hidden="true" />
          <p className="text-sm text-gray-500">Todavía no cargas ningún archivo del SII para <strong>{labelPeriodo(periodo)}</strong>.</p>
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
              {(Object.keys(LABEL_ING) as Array<keyof Sistema['ingresos']>).map(k => (
                <Fila key={k} label={LABEL_ING[k]} valor={sis!.ingresos[k]}
                  atenuado={!DOCUMENTABLE[k]}
                  sub={!DOCUMENTABLE[k] ? 'Se cobra fuera de boleta — no se busca en el SII' : undefined} />
              ))}
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
