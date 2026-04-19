'use client'
import { useState, useEffect } from 'react'
import { Toggle } from '@/components/ui/Toggle'
import { Modal } from '@/components/ui/Modal'

type PrecioTramo = { id: string; peso_min: string; peso_max: string; precio_ci: string; precio_cp: string; precio_sd: string }
type Producto = { id: string; nombre: string; precio: string; foto_url: string; activo: string }
type OtroServicio = { id: string; nombre: string; precio: string; activo: string }
type Veterinario = { id: string; nombre: string; tipo_precios: string }

export default function ServiciosPage() {
  const [precios, setPrecios] = useState<PrecioTramo[]>([])
  const [productos, setProductos] = useState<Producto[]>([])
  const [otros, setOtros] = useState<OtroServicio[]>([])
  const [vets, setVets] = useState<Veterinario[]>([])
  const [vetSeleccionado, setVetSeleccionado] = useState('')
  const [showVet, setShowVet] = useState(false)
  const [showProductoModal, setShowProductoModal] = useState(false)
  const [showOtroModal, setShowOtroModal] = useState(false)
  const [editPrecio, setEditPrecio] = useState<{ id: string; campo: string } | null>(null)
  const [prodForm, setProdForm] = useState({ nombre: '', precio: '' })
  const [otroForm, setOtroForm] = useState({ nombre: '', precio: '' })

  useEffect(() => {
    fetch('/api/precios?tipo=general').then(r => r.json()).then(d => setPrecios(Array.isArray(d) ? d : []))
    fetch('/api/productos').then(r => r.json()).then(d => setProductos(Array.isArray(d) ? d : []))
    fetch('/api/servicios?tipo=otros').then(r => r.json()).then(d => setOtros(Array.isArray(d) ? d : []))
    fetch('/api/veterinarios?activo=true').then(r => r.json()).then(d => setVets(Array.isArray(d) ? d : []))
  }, [])

  const fmt = (n: string) => `$${parseInt(n || '0').toLocaleString('es-CL')}`

  async function toggleProducto(p: Producto) {
    const res = await fetch('/api/productos', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: p.id, activo: p.activo === 'TRUE' ? 'FALSE' : 'TRUE' }),
    })
    if (res.ok) {
      const updated = await res.json()
      setProductos(ps => ps.map(x => x.id === p.id ? { ...x, activo: updated.activo } : x))
    }
  }

  async function toggleOtro(o: OtroServicio) {
    const res = await fetch('/api/servicios?tipo=otros', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: o.id, activo: o.activo === 'TRUE' ? 'FALSE' : 'TRUE' }),
    })
    if (res.ok) {
      setOtros(os => os.map(x => x.id === o.id ? { ...x, activo: x.activo === 'TRUE' ? 'FALSE' : 'TRUE' } : x))
    }
  }

  async function agregarProducto(e: React.FormEvent) {
    e.preventDefault()
    const res = await fetch('/api/productos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nombre: prodForm.nombre, precio: parseInt(prodForm.precio) }),
    })
    if (res.ok) {
      const nuevo = await res.json()
      setProductos(ps => [...ps, nuevo])
      setShowProductoModal(false)
      setProdForm({ nombre: '', precio: '' })
    }
  }

  async function agregarOtro(e: React.FormEvent) {
    e.preventDefault()
    const res = await fetch('/api/servicios?tipo=otros', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nombre: otroForm.nombre, precio: parseInt(otroForm.precio) }),
    })
    if (res.ok) {
      const nuevo = await res.json()
      setOtros(os => [...os, nuevo])
      setShowOtroModal(false)
      setOtroForm({ nombre: '', precio: '' })
    }
  }

  const vetActual = vets.find(v => v.id === vetSeleccionado)

  return (
    <div className="space-y-8 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Servicios</h1>
        <p className="text-gray-500 text-sm mt-0.5">Precios, productos y servicios adicionales</p>
      </div>

      {/* Tabla de precios */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        <h2 className="text-base font-semibold text-gray-900 mb-4">Tarifas generales</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100">
              {['Peso (kg)', 'Cremación Individual', 'Cremación Premium', 'Sin Devolución'].map(h => (
                <th key={h} className="text-left pb-2 text-xs font-semibold text-gray-500">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {precios.map(p => (
              <tr key={p.id}>
                <td className="py-2 text-gray-600">{p.peso_min}–{p.peso_max} kg</td>
                <td className="py-2 text-gray-900 font-medium">{fmt(p.precio_ci)}</td>
                <td className="py-2 text-gray-900 font-medium">{fmt(p.precio_cp)}</td>
                <td className="py-2 text-gray-900 font-medium">{fmt(p.precio_sd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Veterinaria de origen */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        <div className="flex items-center gap-3 mb-4">
          <Toggle checked={showVet} onChange={setShowVet} />
          <span className="text-sm font-medium text-gray-700">Servicio de veterinaria</span>
        </div>
        {showVet && (
          <div className="space-y-3">
            <select
              value={vetSeleccionado}
              onChange={e => setVetSeleccionado(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="">Seleccionar veterinaria...</option>
              {vets.map(v => <option key={v.id} value={v.id}>{v.nombre}</option>)}
            </select>
            {vetActual && (
              <p className="text-xs text-gray-500 bg-gray-50 px-3 py-2 rounded-lg">
                Precios aplicados: <strong>{vetActual.tipo_precios === 'precios_convenio' ? 'Convenio' : 'Especiales'}</strong>
              </p>
            )}
          </div>
        )}
      </div>

      {/* Productos adicionales */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-gray-900">Productos adicionales</h2>
          <button onClick={() => setShowProductoModal(true)} className="text-indigo-600 text-sm font-medium hover:text-indigo-800">+ Agregar</button>
        </div>
        <div className="grid grid-cols-2 gap-4">
          {productos.map(p => (
            <div key={p.id} className={`border rounded-xl p-4 flex gap-3 ${p.activo !== 'TRUE' ? 'opacity-50' : ''}`}>
              {p.foto_url && <img src={p.foto_url} alt={p.nombre} className="w-12 h-12 object-cover rounded-lg" />}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">{p.nombre}</p>
                <p className="text-xs text-gray-500">{fmt(p.precio)}</p>
              </div>
              <Toggle checked={p.activo === 'TRUE'} onChange={() => toggleProducto(p)} />
            </div>
          ))}
        </div>
      </div>

      {/* Otros servicios */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-gray-900">Otros servicios</h2>
          <button onClick={() => setShowOtroModal(true)} className="text-indigo-600 text-sm font-medium hover:text-indigo-800">+ Agregar</button>
        </div>
        <div className="divide-y divide-gray-50">
          {otros.map(o => (
            <div key={o.id} className={`flex items-center justify-between py-3 ${o.activo !== 'TRUE' ? 'opacity-50' : ''}`}>
              <div>
                <p className="text-sm font-medium text-gray-900">{o.nombre}</p>
                <p className="text-xs text-gray-500">{fmt(o.precio)}</p>
              </div>
              <Toggle checked={o.activo === 'TRUE'} onChange={() => toggleOtro(o)} />
            </div>
          ))}
        </div>
      </div>

      <Modal open={showProductoModal} onClose={() => setShowProductoModal(false)} title="Agregar producto">
        <form onSubmit={agregarProducto} className="space-y-4">
          <div>
            <label className="text-xs font-medium text-gray-700">Nombre</label>
            <input required value={prodForm.nombre} onChange={e => setProdForm(f => ({ ...f, nombre: e.target.value }))} className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-700">Precio (CLP)</label>
            <input required type="number" min="0" value={prodForm.precio} onChange={e => setProdForm(f => ({ ...f, precio: e.target.value }))} className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
          <button type="submit" className="w-full bg-indigo-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-indigo-700">Guardar</button>
        </form>
      </Modal>

      <Modal open={showOtroModal} onClose={() => setShowOtroModal(false)} title="Agregar servicio">
        <form onSubmit={agregarOtro} className="space-y-4">
          <div>
            <label className="text-xs font-medium text-gray-700">Nombre</label>
            <input required value={otroForm.nombre} onChange={e => setOtroForm(f => ({ ...f, nombre: e.target.value }))} className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-700">Precio (CLP)</label>
            <input required type="number" min="0" value={otroForm.precio} onChange={e => setOtroForm(f => ({ ...f, precio: e.target.value }))} className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
          <button type="submit" className="w-full bg-indigo-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-indigo-700">Guardar</button>
        </form>
      </Modal>

      {editPrecio && <div className="hidden">{editPrecio.id}</div>}
    </div>
  )
}
