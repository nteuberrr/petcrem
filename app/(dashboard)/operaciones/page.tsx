'use client'
import { useState, useEffect, useCallback } from 'react'

type Cliente = {
  id: string; codigo: string; nombre_mascota: string; nombre_tutor: string
  especie: string; peso_kg: string; estado: string
}

type Ciclo = {
  id: string; fecha: string; numero_ciclo: string
  litros_inicio: string; litros_fin: string
  mascotas_ids: string[]; comentarios: string
}

export default function OperacionesPage() {
  const [fecha, setFecha] = useState(() => new Date().toISOString().split('T')[0])
  const [litrosInicio, setLitrosInicio] = useState('')
  const [litrosFin, setLitrosFin] = useState('')
  const [comentarios, setComentarios] = useState('')
  const [buscarMascota, setBuscarMascota] = useState('')
  const [resultados, setResultados] = useState<Cliente[]>([])
  const [seleccionadas, setSeleccionadas] = useState<Cliente[]>([])
  const [ciclos, setCiclos] = useState<Ciclo[]>([])
  const [saving, setSaving] = useState(false)
  const [expandido, setExpandido] = useState<string | null>(null)
  const [clientesMap, setClientesMap] = useState<Record<string, Cliente>>({})

  const fetchCiclos = useCallback(async () => {
    const res = await fetch('/api/ciclos')
    const data = await res.json()
    setCiclos(Array.isArray(data) ? data : [])
  }, [])

  useEffect(() => { fetchCiclos() }, [fetchCiclos])

  useEffect(() => {
    if (!buscarMascota.trim()) { setResultados([]); return }
    const timer = setTimeout(async () => {
      const res = await fetch(`/api/clientes?estado=pendiente&buscar=${encodeURIComponent(buscarMascota)}`)
      const data = await res.json()
      const sel = seleccionadas.map(s => s.id)
      setResultados(Array.isArray(data) ? data.filter((c: Cliente) => !sel.includes(c.id)) : [])
    }, 300)
    return () => clearTimeout(timer)
  }, [buscarMascota, seleccionadas])

  function agregar(c: Cliente) {
    setSeleccionadas(s => [...s, c])
    setResultados(r => r.filter(x => x.id !== c.id))
    setBuscarMascota('')
    setClientesMap(m => ({ ...m, [c.id]: c }))
  }

  function quitar(id: string) {
    setSeleccionadas(s => s.filter(x => x.id !== id))
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
      }),
    })
    if (res.ok) {
      setSeleccionadas([])
      setLitrosInicio('')
      setLitrosFin('')
      setComentarios('')
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

  return (
    <div className="max-w-5xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Operaciones</h1>
        <p className="text-gray-500 text-sm mt-0.5">Registro de ciclos de cremación</p>
      </div>

      {/* Formulario nuevo ciclo */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        <h2 className="text-base font-semibold text-gray-900 mb-5">Nuevo ciclo</h2>
        <form onSubmit={guardarCiclo} className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="text-xs font-medium text-gray-700">Fecha</label>
              <input type="date" required value={fecha} onChange={e => setFecha(e.target.value)} className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-700">Litros inicio</label>
              <input type="number" step="0.1" required value={litrosInicio} onChange={e => setLitrosInicio(e.target.value)} className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-700">Litros fin</label>
              <input type="number" step="0.1" required value={litrosFin} onChange={e => setLitrosFin(e.target.value)} className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
          </div>

          {/* Buscador mascotas */}
          <div>
            <label className="text-xs font-medium text-gray-700">Agregar mascotas pendientes</label>
            <div className="relative mt-1">
              <input
                type="text"
                placeholder="🔍 Buscar por nombre, código o tutor..."
                value={buscarMascota}
                onChange={e => setBuscarMascota(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              {resultados.length > 0 && (
                <div className="absolute z-10 w-full bg-white border border-gray-200 rounded-lg shadow-lg mt-1 divide-y divide-gray-50">
                  {resultados.slice(0, 6).map(c => (
                    <button key={c.id} type="button" onClick={() => agregar(c)} className="w-full text-left px-4 py-3 hover:bg-indigo-50 transition-colors">
                      <span className="font-mono text-xs text-indigo-700 font-semibold">{c.codigo}</span>
                      <span className="ml-2 text-sm text-gray-900">{c.nombre_mascota}</span>
                      <span className="ml-2 text-xs text-gray-500">({c.nombre_tutor})</span>
                      <span className="ml-2 text-xs text-gray-400">{c.especie} · {c.peso_kg} kg</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Lista seleccionadas */}
          {seleccionadas.length > 0 && (
            <div className="border border-gray-100 rounded-xl divide-y divide-gray-50">
              {seleccionadas.map(c => (
                <div key={c.id} className="flex items-center justify-between px-4 py-3">
                  <div>
                    <span className="font-mono text-xs text-indigo-700 font-semibold">{c.codigo}</span>
                    <span className="ml-2 text-sm text-gray-900">{c.nombre_mascota}</span>
                    <span className="ml-2 text-xs text-gray-500">· {c.especie} · {c.peso_kg} kg</span>
                  </div>
                  <button type="button" onClick={() => quitar(c.id)} className="text-red-400 hover:text-red-600 text-lg leading-none">×</button>
                </div>
              ))}
              <div className="px-4 py-2 bg-gray-50 text-xs text-gray-500 rounded-b-xl">
                {seleccionadas.length} mascota(s) seleccionada(s)
              </div>
            </div>
          )}

          <div>
            <label className="text-xs font-medium text-gray-700">Comentarios</label>
            <textarea value={comentarios} onChange={e => setComentarios(e.target.value)} rows={2} className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>

          <button type="submit" disabled={saving} className="bg-indigo-600 text-white px-6 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50">
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
          <div className="divide-y divide-gray-50">
            {ciclos.map(ciclo => {
              const litros = parseFloat(ciclo.litros_fin) - parseFloat(ciclo.litros_inicio)
              return (
                <div key={ciclo.id}>
                  <button
                    type="button"
                    onClick={() => toggleExpandir(ciclo)}
                    className="w-full text-left px-6 py-4 hover:bg-gray-50 transition-colors flex items-center justify-between"
                  >
                    <div className="flex items-center gap-6">
                      <span className="text-sm font-semibold text-gray-900">Ciclo #{ciclo.numero_ciclo}</span>
                      <span className="text-xs text-gray-500">{ciclo.fecha}</span>
                      <span className="text-xs text-gray-600 bg-gray-100 px-2 py-0.5 rounded-full">{ciclo.mascotas_ids.length} mascotas</span>
                      <span className="text-xs text-gray-600">{litros.toFixed(1)} L petróleo</span>
                    </div>
                    <span className="text-gray-400">{expandido === ciclo.id ? '▲' : '▼'}</span>
                  </button>
                  {expandido === ciclo.id && (
                    <div className="px-6 pb-4 bg-gray-50">
                      <div className="divide-y divide-gray-100">
                        {ciclo.mascotas_ids.map(mid => {
                          const m = clientesMap[mid]
                          return m ? (
                            <div key={mid} className="py-2 flex gap-4 text-sm">
                              <span className="font-mono text-xs text-indigo-700 font-semibold">{m.codigo}</span>
                              <span className="text-gray-900">{m.nombre_mascota}</span>
                              <span className="text-gray-500">{m.especie} · {m.peso_kg} kg</span>
                            </div>
                          ) : (
                            <div key={mid} className="py-2 text-xs text-gray-400">ID: {mid}</div>
                          )
                        })}
                      </div>
                      {ciclo.comentarios && <p className="text-xs text-gray-500 mt-2 italic">{ciclo.comentarios}</p>}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
