'use client'
import { useEffect, useState } from 'react'
import { AlertTriangle, Check, RefreshCw, X } from 'lucide-react'
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
 * El estado se lee EN VIVO de OpenFactura en cada apertura: guardarlo mentiría a
 * los pocos días, porque vence solo.
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
}

/** Mismo catálogo que lib/openfactura-acuse, en el orden en que se le ofrece al usuario. */
const OPCIONES = [
  { id: 'ACD', label: 'Acepto el contenido', desc: 'La factura está correcta.', reclamo: false },
  { id: 'ERM', label: 'Otorgo recibo de mercaderías', desc: 'Confirmo que recibí los bienes o servicios.', reclamo: false },
  { id: 'RCD', label: 'Reclamo el contenido', desc: 'El monto, el detalle o los datos están equivocados.', reclamo: true },
  { id: 'RFP', label: 'Reclamo por falta parcial', desc: 'Llegó solo una parte de lo facturado.', reclamo: true },
  { id: 'RFT', label: 'Reclamo por falta total', desc: 'Nunca recibí lo facturado.', reclamo: true },
] as const

const TIPO_DTE: Record<number, string> = { 33: 'Factura', 34: 'Factura exenta', 46: 'Factura de compra', 56: 'Nota de débito', 61: 'Nota de crédito' }

function Plazo({ p }: { p: Pendiente }) {
  if (p.vencido) {
    return <span className="inline-flex items-center gap-1 text-xs font-medium text-red-700 bg-red-50 border border-red-200 rounded-full px-2 py-0.5">Plazo vencido</span>
  }
  const urgente = p.dias_restantes <= 3
  const cls = urgente
    ? 'text-amber-800 bg-amber-50 border-amber-300'
    : 'text-emerald-800 bg-emerald-50 border-emerald-200'
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium border rounded-full px-2 py-0.5 ${cls}`}>
      {p.dias_restantes === 1 ? 'Queda 1 día' : `Quedan ${p.dias_restantes} días`}
    </span>
  )
}

export default function AcusePendientes({ onCambio }: { onCambio?: () => void }) {
  const [pendientes, setPendientes] = useState<Pendiente[]>([])
  const [cargando, setCargando] = useState(true)
  const [disponible, setDisponible] = useState(true)
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')
  const [tick, setTick] = useState(0)
  const [abierto, setAbierto] = useState<Pendiente | null>(null)
  const [eleccion, setEleccion] = useState<string>('ACD')
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
        setError('')
      } catch {
        if (vivo) setError('Error de red')
      } finally {
        if (vivo) setCargando(false)
      }
    })()
    return () => { vivo = false }
  }, [tick])

  function abrir(p: Pendiente, opcion: string) {
    setMsg('')
    setEleccion(opcion)
    setAbierto(p)
  }

  async function confirmar() {
    if (!abierto) return
    const p = abierto
    const r = await fetch('/api/eerr/gastos-sii/acuse', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rut: p.rut, dte: p.tipo_doc, folio: p.folio, acuse: eleccion }),
    })
    const d = await r.json().catch(() => ({}))
    if (!r.ok) { setMsg(`⚠ ${p.razon_social} (folio ${p.folio}): ${d?.error || 'no se pudo registrar el acuse'}`); return }
    const verbo = OPCIONES.find(o => o.id === eleccion)?.reclamo ? 'Reclamada' : 'Aceptada'
    setMsg(`✓ ${verbo} la factura ${p.folio} de ${p.razon_social} ante el SII.`)
    setAbierto(null)
    // Se relee el estado en vivo en vez de sacarla de la lista a mano: si el SII
    // no la movió, tiene que seguir apareciendo.
    setTick(t => t + 1)
    onCambio?.()
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

  const vigentes = pendientes.filter(p => !p.vencido)
  const vencidas = pendientes.filter(p => p.vencido)

  if (pendientes.length === 0) {
    return (
      <p className="text-sm text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-2.5">
        ✓ No hay facturas de compra pendientes de acuse ante el SII.
      </p>
    )
  }

  const fila = (p: Pendiente) => (
    <tr key={`${p.rut}-${p.tipo_doc}-${p.folio}`} className="border-t border-gray-200 hover:bg-gray-50">
      <td className="px-3 py-2">
        <div className="font-medium text-gray-800">{p.razon_social || p.rut}</div>
        <div className="text-gray-500">{p.rut}</div>
      </td>
      <td className="px-3 py-2 whitespace-nowrap text-gray-600">{TIPO_DTE[p.tipo_doc] || `Tipo ${p.tipo_doc}`} <span className="text-gray-400">#{p.folio}</span></td>
      <td className="px-3 py-2 whitespace-nowrap text-gray-600">{formatDate(p.fecha_emision)}</td>
      <td className="px-3 py-2 whitespace-nowrap text-gray-600">{formatDate(p.fecha_recepcion)}</td>
      <td className="px-3 py-2 whitespace-nowrap text-right font-medium text-gray-800">{fmtPrecio(p.monto_total)}</td>
      <td className="px-3 py-2 whitespace-nowrap"><Plazo p={p} /></td>
      <td className="px-3 py-2 whitespace-nowrap text-right">
        <div className="inline-flex gap-1.5">
          <button
            onClick={() => abrir(p, 'ACD')}
            className="inline-flex items-center gap-1 bg-brand text-white px-2.5 py-1 rounded-lg text-xs font-medium hover:bg-brand-dark"
          >
            <Check size={13} /> Aceptar
          </button>
          <button
            onClick={() => abrir(p, 'RCD')}
            disabled={p.vencido}
            title={p.vencido ? 'El plazo de 8 días para reclamar ya venció' : 'Reclamar ante el SII'}
            className="inline-flex items-center gap-1 border border-gray-300 text-gray-700 px-2.5 py-1 rounded-lg text-xs font-medium hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <X size={13} /> Reclamar
          </button>
        </div>
      </td>
    </tr>
  )

  const cabecera = (
    <thead className="bg-gray-50 text-gray-500 uppercase text-[11px]">
      <tr>
        <th className="px-3 py-2 text-left font-medium">Proveedor</th>
        <th className="px-3 py-2 text-left font-medium">Documento</th>
        <th className="px-3 py-2 text-left font-medium">Emisión</th>
        <th className="px-3 py-2 text-left font-medium">Recibida SII</th>
        <th className="px-3 py-2 text-right font-medium">Total</th>
        <th className="px-3 py-2 text-left font-medium">Plazo</th>
        <th className="px-3 py-2 text-right font-medium">Acción</th>
      </tr>
    </thead>
  )

  return (
    <div className="space-y-3">
      <div className="bg-white rounded-2xl border border-gray-300 shadow-md overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-gray-200">
          <AlertTriangle size={16} className="text-amber-500" />
          <h3 className="font-semibold text-brand">Facturas por aceptar</h3>
          <span className="text-xs bg-brand/10 text-brand rounded-full px-2 py-0.5 font-medium">{vigentes.length} dentro de plazo</span>
          <button onClick={() => setTick(t => t + 1)} className="ml-auto text-xs text-gray-500 hover:text-brand inline-flex items-center gap-1">
            <RefreshCw size={12} /> Actualizar
          </button>
        </div>
        <p className="px-4 py-2 text-xs text-gray-600 bg-cream border-b border-gray-200">
          Tienes <strong>8 días corridos</strong> desde que el SII recibe cada factura para reclamarla. Pasado ese plazo queda aceptada automáticamente y ya no se puede objetar.
        </p>

        {vigentes.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs min-w-[820px]">{cabecera}<tbody>{vigentes.map(fila)}</tbody></table>
          </div>
        )}

        {vencidas.length > 0 && (
          <details className="border-t border-gray-200">
            <summary className="px-4 py-2.5 text-xs text-gray-600 cursor-pointer hover:bg-gray-50">
              {vencidas.length} factura(s) con el plazo vencido — ya aceptadas tácitamente ({fmtPrecio(vencidas.reduce((s, p) => s + p.monto_total, 0))})
            </summary>
            <div className="overflow-x-auto opacity-70">
              <table className="w-full text-xs min-w-[820px]">{cabecera}<tbody>{vencidas.map(fila)}</tbody></table>
            </div>
          </details>
        )}
      </div>

      {msg && <p className="text-sm text-gray-700 bg-amber-50 border border-amber-200 rounded-lg p-2.5">{msg}</p>}

      <Modal open={!!abierto} onClose={() => setAbierto(null)} title="Dar acuse ante el SII">
        {abierto && (
          <div className="space-y-4">
            <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 text-sm">
              <div className="font-medium text-gray-800">{abierto.razon_social || abierto.rut}</div>
              <div className="text-gray-600">
                {TIPO_DTE[abierto.tipo_doc] || `Tipo ${abierto.tipo_doc}`} #{abierto.folio} · {fmtPrecio(abierto.monto_total)} · recibida el {formatDate(abierto.fecha_recepcion)}
              </div>
            </div>

            <div className="space-y-1.5">
              {OPCIONES.map(o => {
                const bloqueada = o.reclamo && abierto.vencido
                return (
                  <label
                    key={o.id}
                    className={`flex gap-2.5 items-start border rounded-xl p-2.5 ${bloqueada ? 'opacity-40 cursor-not-allowed border-gray-200' : 'cursor-pointer hover:bg-gray-50 ' + (eleccion === o.id ? 'border-brand ring-1 ring-brand' : 'border-gray-300')}`}
                  >
                    <input
                      type="radio" name="acuse" value={o.id} checked={eleccion === o.id} disabled={bloqueada}
                      onChange={() => setEleccion(o.id)} className="mt-0.5 accent-brand"
                    />
                    <span className="text-sm">
                      <span className="font-medium text-gray-800">{o.label}</span>
                      <span className="block text-xs text-gray-500">
                        {bloqueada ? 'No disponible: el plazo de 8 días ya venció.' : o.desc}
                      </span>
                    </span>
                  </label>
                )
              })}
            </div>

            <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-2.5">
              Esto se registra en el SII y <strong>no se puede deshacer</strong>.
            </p>

            <div className="flex justify-end gap-2">
              <button onClick={() => setAbierto(null)} className="px-4 py-2 rounded-xl text-sm border border-gray-300 text-gray-700 hover:bg-gray-100">Cancelar</button>
              <button
                onClick={() => ejecutar(confirmar)}
                disabled={procesando}
                className="px-4 py-2 rounded-xl text-sm font-medium bg-brand text-white hover:bg-brand-dark disabled:opacity-50"
              >
                {procesando ? 'Registrando…' : 'Confirmar y enviar al SII'}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
