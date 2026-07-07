'use client'
import { useState, useMemo } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/kit'
import { fmtPrecio } from '@/lib/format'

type Tipo = 39 | 33
type Linea = { nombre: string; cantidad: string; montoBruto: string; descripcion: string }

const LINEA_VACIA: Linea = { nombre: '', cantidad: '1', montoBruto: '', descripcion: '' }

interface Props {
  onClose: () => void
  onEmitido: () => void
}

export default function ManualModal({ onClose, onEmitido }: Props) {
  const [tipo, setTipo] = useState<Tipo>(39)
  const [nombre, setNombre] = useState('')
  const [rut, setRut] = useState('')
  const [giro, setGiro] = useState('')
  const [direccion, setDireccion] = useState('')
  const [comuna, setComuna] = useState('')
  const [correo, setCorreo] = useState('')
  const [lineas, setLineas] = useState<Linea[]>([{ ...LINEA_VACIA }])
  const [enviando, setEnviando] = useState(false)
  const [err, setErr] = useState('')
  const [ok, setOk] = useState<{ folio?: string; pdf_url?: string; openfactura_url?: string } | null>(null)

  function actualizarLinea(i: number, campo: keyof Linea, valor: string) {
    setLineas(prev => prev.map((l, idx) => idx === i ? { ...l, [campo]: valor } : l))
  }
  function agregarLinea() { setLineas(prev => [...prev, { ...LINEA_VACIA }]) }
  function quitarLinea(i: number) { setLineas(prev => prev.length > 1 ? prev.filter((_, idx) => idx !== i) : prev) }

  const totales = useMemo(() => {
    const bruto = lineas.reduce((s, l) => {
      const cant = parseFloat(l.cantidad) || 1
      const monto = parseFloat(l.montoBruto) || 0
      return s + Math.round(monto * cant)
    }, 0)
    const neto = Math.round(bruto / 1.19)
    const iva = bruto - neto
    return { bruto, neto, iva }
  }, [lineas])

  async function emitir() {
    setErr('')
    if (!nombre.trim()) { setErr('Falta el nombre del receptor.'); return }
    if (tipo === 33 && !rut.trim()) { setErr('La factura requiere el RUT del receptor.'); return }
    const lineasValidas = lineas.filter(l => l.nombre.trim() && parseFloat(l.montoBruto) > 0)
    if (lineasValidas.length === 0) { setErr('Agrega al menos un ítem con nombre y monto.'); return }

    setEnviando(true)
    try {
      const r = await fetch('/api/facturacion/manual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tipo,
          receptor: { nombre, rut, giro, direccion, comuna, correo },
          lineas: lineasValidas.map(l => ({
            nombre: l.nombre, cantidad: parseFloat(l.cantidad) || 1, montoBruto: parseFloat(l.montoBruto) || 0, descripcion: l.descripcion,
          })),
        }),
      })
      const d = await r.json()
      if (!r.ok) setErr(d.error || 'No se pudo emitir el documento.')
      else setOk({ folio: d.documento?.folio, pdf_url: d.documento?.pdf_url, openfactura_url: d.documento?.openfactura_url })
    } catch { setErr('Error de red') }
    setEnviando(false)
  }

  return (
    <Modal open onClose={onClose} title="Facturar manualmente" size="2xl">
      {ok ? (
        <div className="text-center py-4">
          <div className="text-4xl mb-2">✅</div>
          <p className="text-gray-800 font-semibold">Documento emitido {ok.folio ? `— folio ${ok.folio}` : ''}</p>
          <div className="flex justify-center gap-4 mt-3">
            {ok.pdf_url && <a href={ok.pdf_url} target="_blank" rel="noopener noreferrer" className="text-sm text-brand-soft hover:underline">Ver PDF</a>}
            {ok.openfactura_url && <a href={ok.openfactura_url} target="_blank" rel="noopener noreferrer" className="text-sm text-brand-soft hover:underline">Ver en OpenFactura</a>}
          </div>
          <Button className="mt-5" onClick={onEmitido}>Listo</Button>
        </div>
      ) : (
        <div className="space-y-5">
          <div className="flex gap-2">
            <button onClick={() => setTipo(39)} className={`flex-1 rounded-xl border-2 px-4 py-2.5 text-sm font-semibold ${tipo === 39 ? 'border-brand bg-brand/10 text-brand' : 'border-gray-300 text-gray-600'}`}>🧾 Boleta</button>
            <button onClick={() => setTipo(33)} className={`flex-1 rounded-xl border-2 px-4 py-2.5 text-sm font-semibold ${tipo === 33 ? 'border-brand bg-brand/10 text-brand' : 'border-gray-300 text-gray-600'}`}>📄 Factura</button>
          </div>

          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Datos del receptor</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-gray-700 mb-1">Nombre / Razón social <span className="text-red-500">*</span></label>
                <input value={nombre} onChange={e => setNombre(e.target.value)} className="w-full border-2 border-gray-300 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">RUT {tipo === 33 && <span className="text-red-500">*</span>}</label>
                <input value={rut} onChange={e => setRut(e.target.value)} placeholder={tipo === 39 ? '66666666-6 (consumidor final)' : '76123456-7'} className="w-full border-2 border-gray-300 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Correo</label>
                <input type="email" value={correo} onChange={e => setCorreo(e.target.value)} className="w-full border-2 border-gray-300 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Giro</label>
                <input value={giro} onChange={e => setGiro(e.target.value)} className="w-full border-2 border-gray-300 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Comuna</label>
                <input value={comuna} onChange={e => setComuna(e.target.value)} className="w-full border-2 border-gray-300 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-gray-700 mb-1">Dirección</label>
                <input value={direccion} onChange={e => setDireccion(e.target.value)} className="w-full border-2 border-gray-300 rounded-lg px-3 py-2 text-sm" />
              </div>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Ítems de la glosa</p>
              <button onClick={agregarLinea} className="text-xs font-semibold text-brand-soft hover:underline">+ Agregar ítem</button>
            </div>
            <div className="space-y-2">
              {lineas.map((l, i) => (
                <div key={i} className="flex gap-2 items-start">
                  <input value={l.nombre} onChange={e => actualizarLinea(i, 'nombre', e.target.value)} placeholder="Descripción del servicio"
                    className="flex-1 border-2 border-gray-300 rounded-lg px-3 py-2 text-sm" />
                  <input value={l.cantidad} onChange={e => actualizarLinea(i, 'cantidad', e.target.value.replace(/[^\d]/g, ''))} placeholder="Cant."
                    className="w-16 border-2 border-gray-300 rounded-lg px-2 py-2 text-sm text-center" />
                  <input value={l.montoBruto} onChange={e => actualizarLinea(i, 'montoBruto', e.target.value.replace(/[^\d]/g, ''))} placeholder="Monto (IVA incl.)"
                    className="w-32 border-2 border-gray-300 rounded-lg px-2 py-2 text-sm text-right" />
                  <button onClick={() => quitarLinea(i)} disabled={lineas.length === 1} className="text-gray-400 hover:text-red-600 disabled:opacity-30 px-1">✕</button>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-xl bg-gray-50 border border-gray-200 p-3 flex justify-between text-sm">
            <div className="text-gray-500 space-y-0.5">
              <p>Neto: {fmtPrecio(totales.neto)}</p>
              <p>IVA (19%): {fmtPrecio(totales.iva)}</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-gray-500">Total</p>
              <p className="text-lg font-bold text-gray-900">{fmtPrecio(totales.bruto)}</p>
            </div>
          </div>

          {err && <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{err}</p>}

          <div className="flex gap-2 justify-end pt-2 border-t border-gray-200">
            <Button variant="secondary" onClick={onClose} disabled={enviando}>Cancelar</Button>
            <Button variant="primary" onClick={emitir} disabled={enviando}>{enviando ? 'Emitiendo…' : `Emitir ${tipo === 39 ? 'boleta' : 'factura'}`}</Button>
          </div>
        </div>
      )}
    </Modal>
  )
}
