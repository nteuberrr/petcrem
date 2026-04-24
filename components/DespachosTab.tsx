'use client'
import { Fragment, useCallback, useEffect, useState } from 'react'
import { fmtNumero } from '@/lib/format'
import { formatDate, todayISO } from '@/lib/dates'
import { Modal } from '@/components/ui/Modal'

type Cliente = {
  id: string; codigo: string; nombre_mascota: string; nombre_tutor: string
  especie: string; estado: string
  direccion_despacho?: string; comuna?: string; telefono?: string
}

type Despacho = {
  id: string; fecha: string; numero_recorrido: string
  mascotas_ids: string[]; nota: string; fecha_creacion: string
}

export default function DespachosTab() {
  const [despachos, setDespachos] = useState<Despacho[]>([])
  const [clientesMap, setClientesMap] = useState<Record<string, Cliente>>({})
  const [expandido, setExpandido] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const [fecha, setFecha] = useState(() => todayISO())
  const [nota, setNota] = useState('')
  const [seleccionadas, setSeleccionadas] = useState<Cliente[]>([])

  // Modal selección
  const [showModal, setShowModal] = useState(false)
  const [disponibles, setDisponibles] = useState<Cliente[]>([])
  const [cargando, setCargando] = useState(false)
  const [buscar, setBuscar] = useState('')

  const fetchDespachos = useCallback(async () => {
    const res = await fetch('/api/despachos')
    const data = await res.json()
    setDespachos(Array.isArray(data) ? data : [])
  }, [])

  useEffect(() => { fetchDespachos() }, [fetchDespachos])

  async function abrirModal() {
    setShowModal(true)
    setBuscar('')
    setCargando(true)
    // Disponibles: mascotas cremadas aún no despachadas
    const all = await fetch('/api/clientes?estado=cremado').then(r => r.json())
    const seleIds = seleccionadas.map(s => s.id)
    setDisponibles(Array.isArray(all) ? all.filter((c: Cliente) => !seleIds.includes(c.id)) : [])
    setCargando(false)
  }

  function toggle(c: Cliente) {
    setSeleccionadas(prev => {
      const isIn = prev.some(p => p.id === c.id)
      return isIn ? prev.filter(p => p.id !== c.id) : [...prev, c]
    })
  }

  function quitar(id: string) {
    setSeleccionadas(s => s.filter(x => x.id !== id))
  }

  async function guardar(e: React.FormEvent) {
    e.preventDefault()
    if (seleccionadas.length === 0) return alert('Selecciona al menos una mascota')
    setSaving(true)
    const res = await fetch('/api/despachos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fecha,
        mascotas_ids: seleccionadas.map(s => s.id),
        nota,
      }),
    })
    if (res.ok) {
      setSeleccionadas([])
      setNota('')
      await fetchDespachos()
    } else {
      const err = await res.json().catch(() => ({}))
      alert(`Error: ${err.error ?? res.status}`)
    }
    setSaving(false)
  }

  async function toggleExpandir(d: Despacho) {
    if (expandido === d.id) { setExpandido(null); return }
    setExpandido(d.id)
    const faltantes = d.mascotas_ids.filter(id => !clientesMap[id])
    if (faltantes.length > 0) {
      const all = await fetch('/api/clientes').then(r => r.json())
      const map: Record<string, Cliente> = {}
      if (Array.isArray(all)) all.forEach((c: Cliente) => { map[c.id] = c })
      setClientesMap(m => ({ ...m, ...map }))
    }
  }

  const disponiblesFiltradas = disponibles.filter(p => {
    if (!buscar) return true
    const q = buscar.toLowerCase()
    return p.nombre_mascota.toLowerCase().includes(q) ||
      p.nombre_tutor.toLowerCase().includes(q) ||
      p.codigo.toLowerCase().includes(q) ||
      (p.direccion_despacho ?? '').toLowerCase().includes(q) ||
      (p.comuna ?? '').toLowerCase().includes(q)
  })

  return (
    <>
      {/* Form */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        <h2 className="text-base font-semibold text-gray-900 mb-5">Nuevo recorrido</h2>
        <form onSubmit={guardar} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium text-gray-700">Fecha</label>
              <input type="date" required value={fecha} onChange={e => setFecha(e.target.value)}
                className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
            <div className="flex items-end">
              <button type="button" onClick={abrirModal}
                className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
                🔍 Seleccionar mascotas
              </button>
            </div>
          </div>

          {seleccionadas.length > 0 && (
            <div className="border border-gray-200 rounded-xl overflow-hidden">
              <div className="divide-y divide-gray-100">
                {seleccionadas.map(c => (
                  <div key={c.id} className="flex items-center justify-between px-4 py-3">
                    <div className="flex-1 min-w-0">
                      <span className="font-mono text-xs text-indigo-700 font-semibold">{c.codigo}</span>
                      <span className="ml-2 text-sm text-gray-900 font-medium">{c.nombre_mascota}</span>
                      <span className="ml-2 text-xs text-gray-500">· {c.nombre_tutor}</span>
                      {c.direccion_despacho && <div className="text-xs text-gray-500 mt-0.5">{c.direccion_despacho}{c.comuna ? ` · ${c.comuna}` : ''}</div>}
                    </div>
                    <button type="button" onClick={() => quitar(c.id)}
                      className="text-red-400 hover:text-red-600 text-xl leading-none w-6 h-6 flex items-center justify-center">×</button>
                  </div>
                ))}
              </div>
              <div className="px-4 py-2.5 bg-gray-50 border-t border-gray-100 text-xs text-gray-600 font-medium">
                {seleccionadas.length} mascota(s)
              </div>
            </div>
          )}

          <div>
            <label className="text-xs font-medium text-gray-700">Nota</label>
            <textarea value={nota} onChange={e => setNota(e.target.value)} rows={2}
              className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none" />
          </div>

          <button type="submit" disabled={saving}
            className="bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50">
            {saving ? 'Guardando...' : 'Guardar recorrido'}
          </button>
        </form>
      </div>

      {/* Historial */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">Historial de recorridos</h2>
        </div>
        {despachos.length === 0 ? (
          <div className="p-8 text-center text-gray-400 text-sm">Sin recorridos registrados</div>
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[600px]">
            <thead className="bg-gray-50">
              <tr>
                {['N° Recorrido', 'Fecha', 'Mascotas', 'Nota', ''].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-gray-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {despachos.map(d => (
                <Fragment key={d.id}>
                  <tr className="hover:bg-gray-50 cursor-pointer" onClick={() => toggleExpandir(d)}>
                    <td className="px-4 py-3 font-semibold text-gray-900">N° {d.numero_recorrido}</td>
                    <td className="px-4 py-3 text-gray-700">{formatDate(d.fecha)}</td>
                    <td className="px-4 py-3 text-gray-700">{fmtNumero(d.mascotas_ids.length)}</td>
                    <td className="px-4 py-3 text-xs text-gray-500 max-w-xs truncate">{d.nota || '—'}</td>
                    <td className="px-4 py-3 text-gray-400">{expandido === d.id ? '▲' : '▼'}</td>
                  </tr>
                  {expandido === d.id && (
                    <tr>
                      <td colSpan={5} className="px-6 py-4 bg-gray-50">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-gray-500">
                              {['Código', 'Mascota', 'Tutor', 'Teléfono', 'Dirección entrega', 'Comuna'].map(h => (
                                <th key={h} className="text-left py-2 font-semibold">{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {d.mascotas_ids.map(mid => {
                              const m = clientesMap[mid]
                              return (
                                <tr key={mid}>
                                  <td className="py-1.5 font-mono text-indigo-700 font-semibold">{m?.codigo ?? mid}</td>
                                  <td className="py-1.5 text-gray-900">{m?.nombre_mascota ?? '—'}</td>
                                  <td className="py-1.5 text-gray-700">{m?.nombre_tutor ?? '—'}</td>
                                  <td className="py-1.5 text-gray-700">{m?.telefono ?? '—'}</td>
                                  <td className="py-1.5 text-gray-700">{m?.direccion_despacho ?? '—'}</td>
                                  <td className="py-1.5 text-gray-700">{m?.comuna ?? '—'}</td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </div>

      {/* Modal selección */}
      <Modal open={showModal} onClose={() => setShowModal(false)} title="Mascotas cremadas disponibles para despacho">
        <div className="space-y-3">
          <input
            type="text"
            placeholder="Filtrar por nombre, código, tutor, dirección o comuna..."
            value={buscar}
            onChange={e => setBuscar(e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          {cargando ? (
            <p className="text-sm text-gray-400 text-center py-4">Cargando...</p>
          ) : disponiblesFiltradas.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-4">Sin mascotas disponibles para despacho</p>
          ) : (
            <div className="max-h-80 overflow-y-auto divide-y divide-gray-100 border border-gray-200 rounded-lg">
              {disponiblesFiltradas.map(c => {
                const isSelected = seleccionadas.some(s => s.id === c.id)
                return (
                  <label key={c.id} className={`flex items-start gap-3 px-4 py-3 cursor-pointer hover:bg-gray-50 transition-colors ${isSelected ? 'bg-indigo-50' : ''}`}>
                    <input type="checkbox" checked={isSelected} onChange={() => toggle(c)}
                      className="w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <div>
                        <span className="font-mono text-xs text-indigo-700 font-semibold">{c.codigo}</span>
                        <span className="ml-2 text-sm text-gray-900 font-medium">{c.nombre_mascota}</span>
                        <span className="ml-1 text-xs text-gray-500">({c.nombre_tutor})</span>
                      </div>
                      {c.direccion_despacho && (
                        <div className="text-xs text-gray-500 mt-0.5">{c.direccion_despacho}{c.comuna ? ` · ${c.comuna}` : ''}</div>
                      )}
                    </div>
                  </label>
                )
              })}
            </div>
          )}
          <div className="flex items-center justify-between pt-2 border-t border-gray-100">
            <span className="text-xs text-gray-500">{seleccionadas.length} seleccionada(s)</span>
            <button
              onClick={() => setShowModal(false)}
              className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
            >
              Confirmar selección
            </button>
          </div>
        </div>
      </Modal>
    </>
  )
}
