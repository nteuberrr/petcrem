'use client'
import { useEffect, useState } from 'react'
import { AlertTriangle, Check, Download, ExternalLink, FileText, RefreshCw, X } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { fmtPrecio } from '@/lib/format'
import { formatDate } from '@/lib/dates'
import { useAccionUnica } from '@/lib/use-accion-unica'

/**
 * Facturas de compra que todavía no tienen acuse ante el SII.
 *
 * Existe por el plazo: hay 8 días corridos desde que el SII recibió la factura
 * para reclamarla; pasado eso queda aceptada sola y con mérito ejecutivo (Ley
 * 19.983). Sin este panel, ese reloj corre sin que nadie lo vea — así se nos pasó
 * una factura de medio millón.
 *
 * El estado se lee EN VIVO de OpenFactura al entrar a la sección: guardarlo
 * mentiría a los pocos días, porque vence solo. Después de acusar NO se vuelve a
 * consultar — se sacan de la lista las que el SII aceptó y listo. Releer al
 * instante haría reaparecer filas que sí se acusaron (el estado tarda en
 * propagarse) y gastaría llamadas de más.
 */

interface Pendiente {
  rut: string
  razon_social: string
  tipo_doc: number
  folio: string
  fecha_emision: string
  fecha_recepcion: string
  monto_total: number
  dias_transcurridos: number
  dias_restantes: number
  vencido: boolean
  forma_pago: number
  acusable: boolean
  motivo_sin_acuse: '' | 'contado' | 'plazo'
}

interface Encabezado {
  Emisor?: Record<string, unknown>
  Receptor?: Record<string, unknown>
  Totales?: Record<string, number>
}
/** Una línea del documento (lib/openfactura-acuse → LineaDocumento). */
interface Linea {
  nombre: string; descripcion: string
  cantidad: number | null; unidad: string
  precio: number | null; monto: number
}
interface Detalle {
  estado?: string
  encabezado?: Encabezado | null
  /** Vacío = el emisor no comparte el desglose con OpenFactura. */
  detalle: Linea[]
  fecha_recepcion_sii?: string
}

/** Mismo catálogo que lib/openfactura-acuse, en el orden en que se le ofrece al usuario. */
const OPCIONES = [
  { id: 'ACD', label: 'Acepto el contenido', desc: 'La factura está correcta.', reclamo: false },
  { id: 'ERM', label: 'Otorgo recibo de mercaderías', desc: 'Confirmo que recibí los bienes o servicios.', reclamo: false },
  { id: 'RCD', label: 'Reclamo el contenido', desc: 'El monto, el detalle o los datos están equivocados.', reclamo: true },
  { id: 'RFP', label: 'Reclamo por falta parcial', desc: 'Llegó solo una parte de lo facturado.', reclamo: true },
  { id: 'RFT', label: 'Reclamo por falta total', desc: 'Nunca recibí lo facturado.', reclamo: true },
] as const

const TIPO_DTE: Record<number, string> = { 33: 'Factura', 34: 'Factura exenta', 46: 'Factura de compra', 56: 'Nota de débito' }

const clave = (p: Pendiente) => `${p.rut}|${p.tipo_doc}|${p.folio}`
const nombreDoc = (p: Pendiente) => `${TIPO_DTE[p.tipo_doc] || `Tipo ${p.tipo_doc}`} #${p.folio}`
const urlDoc = (p: Pendiente, extra = '') =>
  `/api/eerr/gastos-sii/documento?rut=${encodeURIComponent(p.rut)}&dte=${p.tipo_doc}&folio=${p.folio}${extra}`

function Plazo({ p }: { p: Pendiente }) {
  const cls = p.dias_restantes <= 3
    ? 'text-amber-800 bg-amber-50 border-amber-300'
    : 'text-emerald-800 bg-emerald-50 border-emerald-200'
  return (
    <span className={`inline-flex items-center text-xs font-medium border rounded-full px-2 py-0.5 whitespace-nowrap ${cls}`}>
      {p.dias_restantes === 1 ? 'Queda 1 día' : `Quedan ${p.dias_restantes} días`}
    </span>
  )
}

export default function AcusePendientes() {
  const [pendientes, setPendientes] = useState<Pendiente[]>([])
  const [cargando, setCargando] = useState(true)
  const [disponible, setDisponible] = useState(true)
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')
  const [tick, setTick] = useState(0)
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [accionDocs, setAccionDocs] = useState<Pendiente[] | null>(null)
  const [eleccion, setEleccion] = useState<string>('ACD')
  const [verDoc, setVerDoc] = useState<Pendiente | null>(null)
  const [detalle, setDetalle] = useState<Detalle | null>(null)
  const [detalleError, setDetalleError] = useState('')
  const { ejecutar, procesando } = useAccionUnica()

  useEffect(() => {
    let vivo = true
    ;(async () => {
      setCargando(true)
      try {
        const r = await fetch('/api/eerr/gastos-sii/acuse')
        const d = await r.json().catch(() => ({}))
        if (!vivo) return
        if (!r.ok) { setError(d?.error || 'No se pudo consultar el estado de las facturas'); return }
        setDisponible(d.disponible !== false)
        setPendientes(Array.isArray(d.pendientes) ? d.pendientes : [])
        setSel(new Set())
        setError('')
      } catch {
        if (vivo) setError('Error de red')
      } finally {
        if (vivo) setCargando(false)
      }
    })()
    return () => { vivo = false }
  }, [tick])

  function abrirAcuse(docs: Pendiente[], opcion: string) {
    setMsg('')
    setEleccion(opcion)
    setAccionDocs(docs)
  }

  async function confirmar() {
    const docs = accionDocs
    if (!docs || docs.length === 0) return
    const r = await fetch('/api/eerr/gastos-sii/acuse', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        acuse: eleccion,
        documentos: docs.map(p => ({ rut: p.rut, dte: p.tipo_doc, folio: p.folio })),
      }),
    })
    const d = await r.json().catch(() => ({}))
    const resultados = Array.isArray(d?.resultados) ? d.resultados as Array<{ rut: string; dte: number; folio: string | number; ok: boolean; mensaje: string }> : []

    if (!r.ok && resultados.length === 0) {
      setMsg(`⚠ ${d?.error || 'No se pudo registrar el acuse'}`)
      return
    }

    // Solo salen de la lista las que el SII aceptó; las que fallaron se quedan
    // visibles para poder reintentarlas.
    const logradas = new Set(resultados.filter(x => x.ok).map(x => `${x.rut}|${x.dte}|${x.folio}`))
    if (logradas.size > 0) {
      setPendientes(prev => prev.filter(p => !logradas.has(clave(p))))
      setSel(prev => { const n = new Set(prev); logradas.forEach(k => n.delete(k)); return n })
    }

    const verbo = OPCIONES.find(o => o.id === eleccion)?.reclamo ? 'reclamada(s)' : 'aceptada(s)'
    const fallidas = resultados.filter(x => !x.ok)
    setMsg(
      `${logradas.size > 0 ? `✓ ${logradas.size} factura(s) ${verbo} ante el SII.` : ''}` +
      `${fallidas.length > 0 ? ` ⚠ ${fallidas.length} sin registrar: ${fallidas.map(x => `folio ${x.folio} (${x.mensaje})`).join(' · ')}` : ''}`.trim(),
    )
    setAccionDocs(null)
  }

  async function abrirDetalle(p: Pendiente) {
    setVerDoc(p); setDetalle(null); setDetalleError('')
    try {
      const r = await fetch(urlDoc(p))
      const d = await r.json().catch(() => ({}))
      if (!r.ok) { setDetalleError(d?.error || 'No se pudo obtener el documento'); return }
      setDetalle(d)
    } catch { setDetalleError('Error de red') }
  }

  if (!disponible) return null
  if (cargando) {
    return (
      <div className="flex items-center gap-2 text-sm text-gray-500 bg-white rounded-xl border border-gray-300 px-4 py-3">
        <RefreshCw size={14} className="animate-spin" /> Revisando si hay facturas por aceptar…
      </div>
    )
  }
  if (error) {
    return <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-2.5">⚠ Facturas por aceptar: {error}</p>
  }
  if (pendientes.length === 0) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-2.5">
          ✓ No hay facturas de compra pendientes de acuse ante el SII.
        </p>
        {msg && <p className="text-sm text-gray-700 bg-amber-50 border border-amber-200 rounded-lg p-2.5">{msg}</p>}
      </div>
    )
  }

  // Solo se muestran acciones sobre lo que el SII realmente va a aceptar. El
  // resto se lista con el motivo, sin botones: intentar igual devuelve error.
  const accionables = pendientes.filter(p => p.acusable)
  const bloqueadas = pendientes.filter(p => !p.acusable)
  const seleccionadas = accionables.filter(p => sel.has(clave(p)))

  function alternar(p: Pendiente) {
    setSel(s => { const n = new Set(s); const k = clave(p); if (n.has(k)) n.delete(k); else n.add(k); return n })
  }
  function alternarGrupo(grupo: Pendiente[], todas: boolean) {
    setSel(s => {
      const n = new Set(s)
      for (const p of grupo) { if (todas) n.delete(clave(p)); else n.add(clave(p)) }
      return n
    })
  }

  const fila = (p: Pendiente) => (
    <tr key={clave(p)} className={`border-t border-gray-200 hover:bg-gray-50 ${sel.has(clave(p)) ? 'bg-brand/5' : ''}`}>
      <td className="px-3 py-2">
        <input type="checkbox" checked={sel.has(clave(p))} onChange={() => alternar(p)} className="accent-brand" aria-label={`Seleccionar ${nombreDoc(p)}`} />
      </td>
      <td className="px-3 py-2">
        <div className="font-medium text-gray-800">{p.razon_social || p.rut}</div>
        <div className="text-gray-500">{p.rut}</div>
      </td>
      <td className="px-3 py-2 whitespace-nowrap text-gray-600">{TIPO_DTE[p.tipo_doc] || `Tipo ${p.tipo_doc}`} <span className="text-gray-400">#{p.folio}</span></td>
      <td className="px-3 py-2 whitespace-nowrap text-gray-600">{formatDate(p.fecha_emision)}</td>
      <td className="px-3 py-2 whitespace-nowrap text-gray-600">{formatDate(p.fecha_recepcion)}</td>
      <td className="px-3 py-2 whitespace-nowrap text-right font-medium text-gray-800">{fmtPrecio(p.monto_total)}</td>
      <td className="px-3 py-2"><Plazo p={p} /></td>
      <td className="px-3 py-2 whitespace-nowrap text-right">
        <div className="inline-flex gap-1.5">
          <button onClick={() => abrirDetalle(p)} title="Ver el documento" className="inline-flex items-center gap-1 border border-gray-300 text-gray-700 px-2 py-1 rounded-lg text-xs font-medium hover:bg-gray-100">
            <FileText size={13} /> Ver
          </button>
          <button onClick={() => abrirAcuse([p], 'ACD')} className="inline-flex items-center gap-1 bg-brand text-white px-2.5 py-1 rounded-lg text-xs font-medium hover:bg-brand-dark">
            <Check size={13} /> Aceptar
          </button>
          <button onClick={() => abrirAcuse([p], 'RCD')} className="inline-flex items-center gap-1 border border-gray-300 text-gray-700 px-2.5 py-1 rounded-lg text-xs font-medium hover:bg-gray-100">
            <X size={13} /> Reclamar
          </button>
        </div>
      </td>
    </tr>
  )

  const tabla = (grupo: Pendiente[]) => {
    const todas = grupo.every(p => sel.has(clave(p)))
    return (
      <div className="overflow-x-auto">
        <table className="w-full text-xs min-w-[880px]">
          <thead className="bg-gray-50 text-gray-500 uppercase text-[11px]">
            <tr>
              <th className="px-3 py-2 w-8">
                <input type="checkbox" checked={todas} onChange={() => alternarGrupo(grupo, todas)} className="accent-brand" aria-label="Seleccionar todas" />
              </th>
              <th className="px-3 py-2 text-left font-medium">Proveedor</th>
              <th className="px-3 py-2 text-left font-medium">Documento</th>
              <th className="px-3 py-2 text-left font-medium">Emisión</th>
              <th className="px-3 py-2 text-left font-medium">Recibida SII</th>
              <th className="px-3 py-2 text-right font-medium">Total</th>
              <th className="px-3 py-2 text-left font-medium">Estado</th>
              <th className="px-3 py-2 text-right font-medium">Acción</th>
            </tr>
          </thead>
          <tbody>{grupo.map(fila)}</tbody>
        </table>
      </div>
    )
  }

  const totalSel = seleccionadas.reduce((s, p) => s + p.monto_total, 0)
  const alContado = bloqueadas.filter(p => p.motivo_sin_acuse === 'contado').length
  const vencidas = bloqueadas.filter(p => p.motivo_sin_acuse === 'plazo').length

  /**
   * Las que no admiten acuse NO se listan: no hay nada que decidir sobre ellas y
   * llenaban la pantalla como si lo hubiera. Se mencionan en una línea porque
   * explican la diferencia con el número que muestra el SII — y sobre todo que
   * siguen entrando a Compras y al EERR como cualquier otra.
   */
  const pie = bloqueadas.length > 0 && (
    <p className="text-xs text-gray-500 px-1">
      Otras {bloqueadas.length} facturas figuran sin acuse en el SII pero no admiten ninguno
      {alContado > 0 && ` (${alContado} pagada${alContado > 1 ? 's' : ''} al contado`}
      {alContado > 0 && vencidas > 0 && ', '}
      {alContado === 0 && vencidas > 0 && ' ('}
      {vencidas > 0 && `${vencidas} con el plazo vencido`}
      {(alContado > 0 || vencidas > 0) && ')'}
      . Se contabilizan igual: están en la tabla de Compras y entran al EERR.
    </p>
  )

  // Sin nada que resolver el panel se reduce a una línea: un cuadro de alerta
  // vacío entrena a ignorarlo.
  if (accionables.length === 0) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-2.5">
          ✓ No hay facturas de compra esperando tu acuse ante el SII.
        </p>
        {pie}
        {msg && <p className="text-sm text-gray-700 bg-amber-50 border border-amber-200 rounded-lg p-2.5">{msg}</p>}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="bg-white rounded-2xl border border-gray-300 shadow-md overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-gray-200">
          <AlertTriangle size={16} className="text-amber-500" />
          <h3 className="font-semibold text-brand">Facturas por aceptar</h3>
          <span className="text-xs rounded-full px-2 py-0.5 font-medium bg-brand/10 text-brand">
            {accionables.length} por resolver
          </span>
          <button onClick={() => setTick(t => t + 1)} className="ml-auto text-xs text-gray-500 hover:text-brand inline-flex items-center gap-1">
            <RefreshCw size={12} /> Actualizar
          </button>
        </div>
        <p className="px-4 py-2 text-xs text-gray-600 bg-cream border-b border-gray-200">
          Tienes <strong>8 días corridos</strong> desde que el SII recibe cada factura para aceptarla o reclamarla. Pasado ese plazo el SII ya no acepta ningún evento sobre ella. Las facturas <strong>pagadas al contado</strong> tampoco admiten acuse: el SII las registra solo.
        </p>

        {seleccionadas.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 bg-brand/10 border-b border-brand/30">
            <span className="text-sm text-brand font-medium">
              {seleccionadas.length} seleccionada(s) · {fmtPrecio(totalSel)}
            </span>
            <button onClick={() => abrirAcuse(seleccionadas, 'ACD')} className="inline-flex items-center gap-1 bg-brand text-white px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-brand-dark">
              <Check size={14} /> Aceptar todas
            </button>
            <button onClick={() => abrirAcuse(seleccionadas, 'RCD')} className="inline-flex items-center gap-1 border border-gray-300 bg-white text-gray-700 px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-gray-100">
              <X size={14} /> Reclamar todas
            </button>
            <button onClick={() => setSel(new Set())} className="text-sm text-gray-500 hover:text-gray-700">Limpiar selección</button>
          </div>
        )}

        {tabla(accionables)}
      </div>

      {pie}
      {msg && <p className="text-sm text-gray-700 bg-amber-50 border border-amber-200 rounded-lg p-2.5">{msg}</p>}

      {/* ── Acuse (uno o varios) ── */}
      <Modal open={!!accionDocs} onClose={() => setAccionDocs(null)} title={accionDocs && accionDocs.length > 1 ? `Dar acuse a ${accionDocs.length} facturas` : 'Dar acuse ante el SII'}>
        {accionDocs && (
          <div className="space-y-4">
            <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 text-sm max-h-40 overflow-y-auto">
              {accionDocs.map(p => (
                <div key={clave(p)} className="flex justify-between gap-3 py-0.5">
                  <span className="text-gray-700 truncate">{p.razon_social || p.rut} <span className="text-gray-400">· {nombreDoc(p)}</span></span>
                  <span className="text-gray-800 font-medium whitespace-nowrap">{fmtPrecio(p.monto_total)}</span>
                </div>
              ))}
            </div>

            <div className="space-y-1.5">
              {OPCIONES.map(o => (
                <label
                  key={o.id}
                  className={`flex gap-2.5 items-start border rounded-xl p-2.5 cursor-pointer hover:bg-gray-50 ${eleccion === o.id ? 'border-brand ring-1 ring-brand' : 'border-gray-300'}`}
                >
                  <input
                    type="radio" name="acuse" value={o.id} checked={eleccion === o.id}
                    onChange={() => setEleccion(o.id)} className="mt-0.5 accent-brand"
                  />
                  <span className="text-sm">
                    <span className="font-medium text-gray-800">{o.label}</span>
                    <span className="block text-xs text-gray-500">{o.desc}</span>
                  </span>
                </label>
              ))}
            </div>

            <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-2.5">
              Esto se registra en el SII y <strong>no se puede deshacer</strong>.
              {accionDocs.length > 1 && ' Se envían de a una; con muchas puede tardar un minuto.'}
            </p>

            <div className="flex justify-end gap-2">
              <button onClick={() => setAccionDocs(null)} className="px-4 py-2 rounded-xl text-sm border border-gray-300 text-gray-700 hover:bg-gray-100">Cancelar</button>
              <button
                onClick={() => ejecutar(confirmar)} disabled={procesando}
                className="px-4 py-2 rounded-xl text-sm font-medium bg-brand text-white hover:bg-brand-dark disabled:opacity-50"
              >
                {procesando ? 'Registrando…' : 'Confirmar y enviar al SII'}
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* ── Detalle del documento ── */}
      <Modal open={!!verDoc} onClose={() => setVerDoc(null)} title={verDoc ? `${nombreDoc(verDoc)} — ${verDoc.razon_social}` : ''} size="2xl">
        {verDoc && (
          <div className="space-y-4">
            {detalleError && <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-2.5">⚠ {detalleError}</p>}
            {!detalle && !detalleError && (
              <p className="flex items-center gap-2 text-sm text-gray-500"><RefreshCw size={14} className="animate-spin" /> Cargando el documento…</p>
            )}
            {detalle && (
              <>
                <div className="flex flex-wrap gap-2 text-xs">
                  <span className="bg-gray-100 border border-gray-300 rounded-full px-2.5 py-1">
                    Estado en el SII: <strong>{detalle.estado || '—'}</strong>
                  </span>
                  <span className="bg-gray-100 border border-gray-300 rounded-full px-2.5 py-1">
                    Recibida: <strong>{formatDate(verDoc.fecha_recepcion)}</strong>
                  </span>
                  <span className="bg-gray-100 border border-gray-300 rounded-full px-2.5 py-1">
                    Total: <strong>{fmtPrecio(verDoc.monto_total)}</strong>
                  </span>
                </div>

                <div className="grid gap-3 sm:grid-cols-2 text-sm">
                  {(['Emisor', 'Receptor'] as const).map(lado => {
                    const d = detalle.encabezado?.[lado] as Record<string, unknown> | undefined
                    if (!d) return null
                    const campos = lado === 'Emisor'
                      ? [['RUT', d.RUTEmisor], ['Razón social', d.RznSoc], ['Giro', d.GiroEmis], ['Dirección', [d.DirOrigen, d.CmnaOrigen].filter(Boolean).join(', ')], ['Teléfono', d.Telefono]]
                      : [['RUT', d.RUTRecep], ['Razón social', d.RznSocRecep], ['Giro', d.GiroRecep], ['Dirección', [d.DirRecep, d.CmnaRecep].filter(Boolean).join(', ')], ['Contacto', d.Contacto]]
                    return (
                      <div key={lado} className="border border-gray-300 rounded-xl p-3">
                        <div className="font-semibold text-brand mb-1.5">{lado}</div>
                        <dl className="space-y-0.5 text-xs">
                          {campos.filter(([, v]) => v).map(([k, v]) => (
                            <div key={String(k)} className="flex gap-2">
                              <dt className="text-gray-500 shrink-0 w-24">{String(k)}</dt>
                              <dd className="text-gray-800 break-words">{String(v)}</dd>
                            </div>
                          ))}
                        </dl>
                      </div>
                    )
                  })}
                </div>

                {detalle.encabezado?.Totales && (
                  <div className="border border-gray-300 rounded-xl p-3">
                    <div className="font-semibold text-brand mb-1.5 text-sm">Totales</div>
                    <dl className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                      {([['Neto', 'MntNeto'], ['Exento', 'MntExe'], ['IVA', 'IVA'], ['Total', 'MntTotal']] as const).map(([label, k]) => (
                        <div key={k}>
                          <dt className="text-gray-500">{label}</dt>
                          <dd className="text-gray-800 font-medium">{fmtPrecio(Number(detalle.encabezado?.Totales?.[k] ?? 0))}</dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                )}

                {detalle.detalle.length > 0 ? (
                  <div className="border border-gray-300 rounded-xl overflow-hidden">
                    <div className="font-semibold text-brand text-sm px-3 py-2 bg-gray-50 border-b border-gray-300">Detalle</div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs min-w-[420px]">
                        <thead className="bg-gray-50 text-gray-500">
                          <tr>
                            <th className="text-left px-3 py-1.5 font-semibold">Ítem</th>
                            <th className="text-right px-3 py-1.5 font-semibold whitespace-nowrap">Cantidad</th>
                            <th className="text-right px-3 py-1.5 font-semibold whitespace-nowrap">Precio</th>
                            <th className="text-right px-3 py-1.5 font-semibold whitespace-nowrap">Monto</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {detalle.detalle.map((l, i) => (
                            <tr key={i}>
                              <td className="px-3 py-1.5 text-gray-800">
                                {l.nombre || '—'}
                                {l.descripcion && <span className="block text-gray-500">{l.descripcion}</span>}
                              </td>
                              <td className="px-3 py-1.5 text-right text-gray-600 tabular-nums whitespace-nowrap">
                                {l.cantidad ?? '—'}{l.unidad ? ` ${l.unidad}` : ''}
                              </td>
                              <td className="px-3 py-1.5 text-right text-gray-600 tabular-nums whitespace-nowrap">{l.precio != null ? fmtPrecio(l.precio) : '—'}</td>
                              <td className="px-3 py-1.5 text-right text-gray-800 font-medium tabular-nums whitespace-nowrap">{fmtPrecio(l.monto)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : (
                  /* Documento emitido con un proveedor de DTE que no intercambia con
                     Haulmer: solo llegó lo que publica el RCV. Se avisa acá porque el
                     PDF sale con el cuerpo en blanco y parece un error nuestro. */
                  <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                    Este documento llegó sin su desglose: su emisor factura con un proveedor que no comparte
                    el detalle con OpenFactura, así que solo tenemos el encabezado y los totales que publica
                    el SII. El PDF va a salir con el cuerpo en blanco — el documento completo hay que pedírselo
                    al proveedor.
                  </p>
                )}
              </>
            )}

            <div className="flex flex-wrap justify-end gap-2">
              <a
                href={urlDoc(verDoc, '&formato=pdf')} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium border border-gray-300 text-gray-700 hover:bg-gray-100"
              >
                <ExternalLink size={14} /> Abrir PDF
              </a>
              <a
                href={urlDoc(verDoc, '&formato=pdf&descargar=1')}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium bg-brand text-white hover:bg-brand-dark"
              >
                <Download size={14} /> Descargar PDF
              </a>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
