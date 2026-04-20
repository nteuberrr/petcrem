'use client'
import { useState, useEffect, useCallback } from 'react'
import { fmtLitros, fmtNumero, fmtKg, fmtFecha, fmtPrecio } from '@/lib/format'
import { Modal } from '@/components/ui/Modal'

type Cliente = {
  id: string; codigo: string; nombre_mascota: string; nombre_tutor: string
  especie: string; peso_kg: string; estado: string
}

type Ciclo = {
  id: string; fecha: string; numero_ciclo: string
  litros_inicio: string; litros_fin: string
  mascotas_ids: string[]; comentarios: string
  hora_inicio?: string; hora_fin?: string
}

type CargaPetroleo = {
  id: string; fecha: string; litros: string
  precio_neto: string; iva: string; especifico: string; total_bruto: string
  notas: string; fecha_creacion: string
}

type ResumenPetroleo = { total_cargado: number; total_consumido: number; stock_actual: number; ciclos_count: number }

function calcMinutos(ini: string, fin: string): number | null {
  if (!ini || !fin) return null
  const [h1, m1] = ini.split(':').map(Number)
  const [h2, m2] = fin.split(':').map(Number)
  const total = (h2 * 60 + m2) - (h1 * 60 + m1)
  return total > 0 ? total : null
}

export default function OperacionesPage() {
  const [operTab, setOperTab] = useState<'ciclos' | 'petroleo'>('ciclos')
  const [fecha, setFecha] = useState(() => new Date().toISOString().split('T')[0])
  const [litrosInicio, setLitrosInicio] = useState('')
  const [litrosFin, setLitrosFin] = useState('')
  const [comentarios, setComentarios] = useState('')
  const [horaInicio, setHoraInicio] = useState('')
  const [horaFin, setHoraFin] = useState('')
  const [buscarMascota, setBuscarMascota] = useState('')
  const [seleccionadas, setSeleccionadas] = useState<Cliente[]>([])
  const [ciclos, setCiclos] = useState<Ciclo[]>([])
  const [saving, setSaving] = useState(false)
  const [expandido, setExpandido] = useState<string | null>(null)
  const [clientesMap, setClientesMap] = useState<Record<string, Cliente>>({})

  // Modal de selección de mascotas
  const [showModal, setShowModal] = useState(false)
  const [pendientes, setPendientes] = useState<Cliente[]>([])
  const [loadingPendientes, setLoadingPendientes] = useState(false)
  const [buscarModal, setBuscarModal] = useState('')

  // Petróleo
  const [cargas, setCargas] = useState<CargaPetroleo[]>([])
  const [resumenPet, setResumenPet] = useState<ResumenPetroleo>({ total_cargado: 0, total_consumido: 0, stock_actual: 0, ciclos_count: 0 })
  const [petForm, setPetForm] = useState({ fecha: new Date().toISOString().split('T')[0], litros: '', precio_neto: '', iva: '', especifico: '', notas: '' })
  const [savingPet, setSavingPet] = useState(false)

  const fetchCiclos = useCallback(async () => {
    const res = await fetch('/api/ciclos')
    const data = await res.json()
    setCiclos(Array.isArray(data) ? data : [])
  }, [])

  const fetchPetroleo = useCallback(async () => {
    const res = await fetch('/api/petroleo')
    const data = await res.json()
    setCargas(Array.isArray(data.cargas) ? data.cargas : [])
    setResumenPet(data.resumen ?? { total_cargado: 0, total_consumido: 0, stock_actual: 0, ciclos_count: 0 })
  }, [])

  useEffect(() => { fetchCiclos() }, [fetchCiclos])
  useEffect(() => { fetchPetroleo() }, [fetchPetroleo])

  async function guardarCarga(e: React.FormEvent) {
    e.preventDefault()
    if (!petForm.litros) return alert('Ingresa los litros')
    setSavingPet(true)
    const res = await fetch('/api/petroleo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fecha: petForm.fecha,
        litros: parseFloat(petForm.litros),
        precio_neto: parseFloat(petForm.precio_neto) || 0,
        iva: parseFloat(petForm.iva) || 0,
        especifico: parseFloat(petForm.especifico) || 0,
        notas: petForm.notas,
      }),
    })
    if (res.ok) {
      setPetForm({ fecha: new Date().toISOString().split('T')[0], litros: '', precio_neto: '', iva: '', especifico: '', notas: '' })
      await fetchPetroleo()
    } else {
      const err = await res.json().catch(() => ({}))
      alert(`Error: ${err.error ?? res.status}`)
    }
    setSavingPet(false)
  }

  async function eliminarCarga(id: string) {
    if (!confirm('¿Eliminar esta carga?')) return
    const res = await fetch(`/api/petroleo?id=${id}`, { method: 'DELETE' })
    if (res.ok) await fetchPetroleo()
  }

  const totalBrutoPet = (parseFloat(petForm.precio_neto) || 0) + (parseFloat(petForm.iva) || 0) + (parseFloat(petForm.especifico) || 0)

  async function abrirModal() {
    setShowModal(true)
    setBuscarModal('')
    setLoadingPendientes(true)
    const res = await fetch('/api/clientes?estado=pendiente')
    const data = await res.json()
    const selIds = seleccionadas.map(s => s.id)
    setPendientes(Array.isArray(data) ? data.filter((c: Cliente) => !selIds.includes(c.id)) : [])
    setLoadingPendientes(false)
  }

  function togglePendiente(c: Cliente) {
    setPendientes(prev => {
      const isIn = prev.some(p => p.id === c.id)
      // visual toggle in modal — not actual selection yet
      return isIn ? prev : prev
    })
    setSeleccionadas(prev => {
      const isIn = prev.some(p => p.id === c.id)
      if (isIn) return prev.filter(p => p.id !== c.id)
      return [...prev, c]
    })
  }

  const pendientesFiltrados = pendientes.filter(p => {
    if (!buscarModal) return true
    const q = buscarModal.toLowerCase()
    return p.nombre_mascota.toLowerCase().includes(q) ||
      p.nombre_tutor.toLowerCase().includes(q) ||
      p.codigo.toLowerCase().includes(q)
  })

  function quitar(id: string) {
    setSeleccionadas(s => s.filter(x => x.id !== id))
    setPendientes(prev => {
      const found = seleccionadas.find(s => s.id === id)
      if (found && !prev.some(p => p.id === id)) return [...prev, found]
      return prev
    })
  }

  async function guardarCiclo(e: React.FormEvent) {
    e.preventDefault()
    if (seleccionadas.length === 0) return alert('Agrega al menos una mascota')
    setSaving(true)
    const res = await fetch('/api/ciclos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fecha,
        litros_inicio: parseFloat(litrosInicio),
        litros_fin: parseFloat(litrosFin),
        mascotas_ids: seleccionadas.map(s => s.id),
        comentarios,
        hora_inicio: horaInicio,
        hora_fin: horaFin,
      }),
    })
    if (res.ok) {
      setSeleccionadas([])
      setLitrosInicio('')
      setLitrosFin('')
      setComentarios('')
      setHoraInicio('')
      setHoraFin('')
      await fetchCiclos()
    }
    setSaving(false)
  }

  async function toggleExpandir(ciclo: Ciclo) {
    if (expandido === ciclo.id) { setExpandido(null); return }
    setExpandido(ciclo.id)
    const ids = ciclo.mascotas_ids
    const missing = ids.filter(id => !clientesMap[id])
    if (missing.length > 0) {
      const all = await fetch('/api/clientes').then(r => r.json())
      const map: Record<string, Cliente> = {}
      if (Array.isArray(all)) all.forEach((c: Cliente) => { map[c.id] = c })
      setClientesMap(m => ({ ...m, ...map }))
    }
  }

  const pesoTotal = seleccionadas.reduce((sum, c) => sum + (parseFloat(c.peso_kg) || 0), 0)
  const minutos = calcMinutos(horaInicio, horaFin)

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Operaciones</h1>
        <p className="text-gray-500 text-sm mt-0.5">Ciclos de cremación y control de petróleo</p>
      </div>

      {/* Sub-tabs */}
      <div className="flex gap-2">
        {(['ciclos', 'petroleo'] as const).map(t => (
          <button key={t} onClick={() => setOperTab(t)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${operTab === t ? 'bg-indigo-600 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
            {t === 'ciclos' ? '🔥 Ciclos de cremación' : '⛽ Carga de Petróleo'}
          </button>
        ))}
      </div>

      {operTab === 'ciclos' && (
        <>
      {/* Formulario nuevo ciclo */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        <h2 className="text-base font-semibold text-gray-900 mb-5">Nuevo ciclo</h2>
        <form onSubmit={guardarCiclo} className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="text-xs font-medium text-gray-700">Fecha</label>
              <input type="date" required value={fecha} onChange={e => setFecha(e.target.value)}
                className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-700">Litros inicio</label>
              <input type="number" step="0.1" required value={litrosInicio} onChange={e => setLitrosInicio(e.target.value)}
                className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-700">Litros fin</label>
              <input type="number" step="0.1" required value={litrosFin} onChange={e => setLitrosFin(e.target.value)}
                className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
          </div>

          {/* Horario */}
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="text-xs font-medium text-gray-700">Hora inicio</label>
              <input type="time" value={horaInicio} onChange={e => setHoraInicio(e.target.value)}
                className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-700">Hora término</label>
              <input type="time" value={horaFin} onChange={e => setHoraFin(e.target.value)}
                className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-700">Duración</label>
              <div className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-gray-50 text-gray-700 font-medium">
                {minutos !== null ? `${minutos} minutos` : '—'}
              </div>
            </div>
          </div>

          {/* Buscador mascotas */}
          <div>
            <label className="text-xs font-medium text-gray-700">Mascotas del ciclo</label>
            <div className="relative mt-1 flex gap-2">
              <input
                type="text"
                placeholder="Buscar por nombre, código o tutor..."
                value={buscarMascota}
                onChange={e => setBuscarMascota(e.target.value)}
                className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <button
                type="button"
                onClick={abrirModal}
                title="Ver todas las mascotas pendientes"
                className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5"
              >
                🔍 <span className="text-xs">Todas</span>
              </button>
            </div>
            {/* Dropdown búsqueda inline */}
            {buscarMascota.trim().length > 0 && (
              <InlineSearch
                buscar={buscarMascota}
                excluir={seleccionadas.map(s => s.id)}
                onSelect={c => { setSeleccionadas(s => [...s, c]); setBuscarMascota(''); setClientesMap(m => ({ ...m, [c.id]: c })) }}
              />
            )}
          </div>

          {/* Lista seleccionadas */}
          {seleccionadas.length > 0 && (
            <div className="border border-gray-200 rounded-xl overflow-hidden">
              <div className="divide-y divide-gray-100">
                {seleccionadas.map(c => (
                  <div key={c.id} className="flex items-center justify-between px-4 py-3">
                    <div>
                      <span className="font-mono text-xs text-indigo-700 font-semibold">{c.codigo}</span>
                      <span className="ml-2 text-sm text-gray-900 font-medium">{c.nombre_mascota}</span>
                      <span className="ml-2 text-xs text-gray-500">· {c.especie} · {fmtKg(c.peso_kg)}</span>
                    </div>
                    <button type="button" onClick={() => quitar(c.id)}
                      className="text-red-400 hover:text-red-600 text-xl leading-none w-6 h-6 flex items-center justify-center">×</button>
                  </div>
                ))}
              </div>
              <div className="px-4 py-2.5 bg-gray-50 border-t border-gray-100 flex items-center justify-between text-xs text-gray-600">
                <span className="font-medium">{seleccionadas.length} mascota(s)</span>
                <span className="font-semibold text-gray-800">Peso total: {pesoTotal.toFixed(1)} kg</span>
              </div>
            </div>
          )}

          <div>
            <label className="text-xs font-medium text-gray-700">Comentarios</label>
            <textarea value={comentarios} onChange={e => setComentarios(e.target.value)} rows={2}
              className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>

          <button type="submit" disabled={saving}
            className="bg-indigo-600 text-white px-6 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors">
            {saving ? 'Guardando...' : 'Guardar ciclo'}
          </button>
        </form>
      </div>

      {/* Historial */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">Historial de ciclos</h2>
        </div>
        {ciclos.length === 0 ? (
          <div className="p-8 text-center text-gray-400 text-sm">Sin ciclos registrados</div>
        ) : (
          <div className="divide-y divide-gray-100">
            {ciclos.map(ciclo => {
              const litros = parseFloat(ciclo.litros_fin) - parseFloat(ciclo.litros_inicio)
              const mins = calcMinutos(ciclo.hora_inicio ?? '', ciclo.hora_fin ?? '')
              return (
                <div key={ciclo.id}>
                  <button type="button" onClick={() => toggleExpandir(ciclo)}
                    className="w-full text-left px-6 py-4 hover:bg-gray-50 transition-colors flex items-center justify-between">
                    <div className="flex items-center gap-4 flex-wrap">
                      <span className="text-sm font-semibold text-gray-900">Ciclo #{ciclo.numero_ciclo}</span>
                      <span className="text-xs text-gray-500">{fmtFecha(ciclo.fecha)}</span>
                      <span className="text-xs text-gray-700 bg-gray-100 px-2 py-0.5 rounded-full">{fmtNumero(ciclo.mascotas_ids.length)} mascotas</span>
                      <span className="text-xs text-gray-600">{fmtLitros(litros)} petróleo</span>
                      {ciclo.hora_inicio && ciclo.hora_fin && (
                        <span className="text-xs text-indigo-600">{ciclo.hora_inicio}–{ciclo.hora_fin}{mins ? ` (${mins} min)` : ''}</span>
                      )}
                    </div>
                    <span className="text-gray-400 text-sm">{expandido === ciclo.id ? '▲' : '▼'}</span>
                  </button>
                  {expandido === ciclo.id && (
                    <div className="px-6 pb-5 bg-gray-50 border-t border-gray-100">
                      <div className="divide-y divide-gray-100 mt-2">
                        {ciclo.mascotas_ids.map(mid => {
                          const m = clientesMap[mid]
                          return m ? (
                            <div key={mid} className="py-2 flex gap-4 text-sm">
                              <span className="font-mono text-xs text-indigo-700 font-semibold">{m.codigo}</span>
                              <span className="text-gray-900">{m.nombre_mascota}</span>
                              <span className="text-gray-500">{m.especie} · {fmtKg(m.peso_kg)}</span>
                            </div>
                          ) : (
                            <div key={mid} className="py-2 text-xs text-gray-400">ID: {mid}</div>
                          )
                        })}
                      </div>
                      {ciclo.comentarios && <p className="text-xs text-gray-500 mt-3 italic">{ciclo.comentarios}</p>}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

        </>
      )}

      {operTab === 'petroleo' && (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Stock actual</p>
              <p className={`text-2xl font-bold mt-1 ${resumenPet.stock_actual < 100 ? 'text-red-600' : 'text-gray-900'}`}>{fmtLitros(resumenPet.stock_actual)}</p>
              {resumenPet.stock_actual < 100 && <p className="text-xs text-red-500 mt-1">⚠ Stock bajo</p>}
            </div>
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Total cargado</p>
              <p className="text-2xl font-bold text-emerald-600 mt-1">{fmtLitros(resumenPet.total_cargado)}</p>
              <p className="text-xs text-gray-400 mt-1">{cargas.length} carga(s)</p>
            </div>
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Total consumido</p>
              <p className="text-2xl font-bold text-amber-600 mt-1">{fmtLitros(resumenPet.total_consumido)}</p>
              <p className="text-xs text-gray-400 mt-1">{resumenPet.ciclos_count} ciclo(s)</p>
            </div>
          </div>

          {/* Formulario nueva carga */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
            <h2 className="text-base font-semibold text-gray-900 mb-5">Registrar carga de petróleo</h2>
            <form onSubmit={guardarCarga} className="space-y-4">
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="text-xs font-medium text-gray-700">Fecha</label>
                  <input type="date" required value={petForm.fecha} onChange={e => setPetForm(f => ({ ...f, fecha: e.target.value }))}
                    className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-700">Litros cargados</label>
                  <input type="number" step="0.1" required value={petForm.litros} onChange={e => setPetForm(f => ({ ...f, litros: e.target.value }))}
                    className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-700">Total bruto (auto)</label>
                  <div className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-gray-50 text-gray-700 font-semibold">
                    {fmtPrecio(totalBrutoPet)}
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="text-xs font-medium text-gray-700">Precio neto (CLP)</label>
                  <input type="number" min="0" value={petForm.precio_neto} onChange={e => setPetForm(f => ({ ...f, precio_neto: e.target.value }))}
                    className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-700">IVA (CLP)</label>
                  <input type="number" min="0" value={petForm.iva} onChange={e => setPetForm(f => ({ ...f, iva: e.target.value }))}
                    className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-700">Impuesto específico (CLP)</label>
                  <input type="number" min="0" value={petForm.especifico} onChange={e => setPetForm(f => ({ ...f, especifico: e.target.value }))}
                    className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-700">Notas</label>
                <input value={petForm.notas} onChange={e => setPetForm(f => ({ ...f, notas: e.target.value }))}
                  className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <button type="submit" disabled={savingPet}
                className="bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50">
                {savingPet ? 'Guardando...' : 'Registrar carga'}
              </button>
            </form>
          </div>

          {/* Historial cargas */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100">
              <h2 className="text-base font-semibold text-gray-900">Historial de cargas</h2>
            </div>
            {cargas.length === 0 ? (
              <div className="p-8 text-center text-gray-400 text-sm">Sin cargas registradas</div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    {['Fecha', 'Litros', 'Neto', 'IVA', 'Específico', 'Total bruto', 'Notas', ''].map(h => (
                      <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-gray-500">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {cargas.map(c => (
                    <tr key={c.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-gray-700">{fmtFecha(c.fecha)}</td>
                      <td className="px-4 py-3 font-medium text-gray-900">{fmtLitros(c.litros)}</td>
                      <td className="px-4 py-3 text-gray-600">{fmtPrecio(c.precio_neto)}</td>
                      <td className="px-4 py-3 text-gray-600">{fmtPrecio(c.iva)}</td>
                      <td className="px-4 py-3 text-gray-600">{fmtPrecio(c.especifico)}</td>
                      <td className="px-4 py-3 font-semibold text-gray-900">{fmtPrecio(c.total_bruto)}</td>
                      <td className="px-4 py-3 text-xs text-gray-500 max-w-xs truncate">{c.notas}</td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => eliminarCarga(c.id)}
                          className="bg-red-500 hover:bg-red-600 text-white px-3 py-1 rounded-md text-xs font-medium transition-colors">
                          Eliminar
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {/* Modal selección mascotas */}
      <Modal open={showModal} onClose={() => setShowModal(false)} title="Mascotas pendientes de cremación">
        <div className="space-y-3">
          <input
            type="text"
            placeholder="Filtrar por nombre, código o tutor..."
            value={buscarModal}
            onChange={e => setBuscarModal(e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          {loadingPendientes ? (
            <p className="text-sm text-gray-400 text-center py-4">Cargando...</p>
          ) : pendientesFiltrados.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-4">Sin mascotas pendientes</p>
          ) : (
            <div className="max-h-80 overflow-y-auto divide-y divide-gray-100 border border-gray-200 rounded-lg">
              {pendientesFiltrados.map(c => {
                const isSelected = seleccionadas.some(s => s.id === c.id)
                return (
                  <label key={c.id} className={`flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-gray-50 transition-colors ${isSelected ? 'bg-indigo-50' : ''}`}>
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => togglePendiente(c)}
                      className="w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    <div className="flex-1 min-w-0">
                      <span className="font-mono text-xs text-indigo-700 font-semibold">{c.codigo}</span>
                      <span className="ml-2 text-sm text-gray-900 font-medium">{c.nombre_mascota}</span>
                      <span className="ml-1 text-xs text-gray-500">({c.nombre_tutor})</span>
                    </div>
                    <span className="text-xs text-gray-400 shrink-0">{c.especie} · {fmtKg(c.peso_kg)}</span>
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
    </div>
  )
}

function InlineSearch({ buscar, excluir, onSelect }: { buscar: string; excluir: string[]; onSelect: (c: Cliente) => void }) {
  const [results, setResults] = useState<Cliente[]>([])

  useEffect(() => {
    if (!buscar.trim()) { setResults([]); return }
    const t = setTimeout(async () => {
      const res = await fetch(`/api/clientes?estado=pendiente&buscar=${encodeURIComponent(buscar)}`)
      const data = await res.json()
      setResults(Array.isArray(data) ? data.filter((c: Cliente) => !excluir.includes(c.id)) : [])
    }, 300)
    return () => clearTimeout(t)
  }, [buscar, excluir])

  if (results.length === 0) return null

  return (
    <div className="absolute z-10 w-full bg-white border border-gray-200 rounded-lg shadow-lg mt-1 divide-y divide-gray-50 left-0 top-full">
      {results.slice(0, 6).map(c => (
        <button key={c.id} type="button" onClick={() => onSelect(c)}
          className="w-full text-left px-4 py-3 hover:bg-indigo-50 transition-colors">
          <span className="font-mono text-xs text-indigo-700 font-semibold">{c.codigo}</span>
          <span className="ml-2 text-sm text-gray-900">{c.nombre_mascota}</span>
          <span className="ml-2 text-xs text-gray-500">({c.nombre_tutor})</span>
          <span className="ml-2 text-xs text-gray-400">{c.especie} · {fmtKg(c.peso_kg)}</span>
        </button>
      ))}
    </div>
  )
}
