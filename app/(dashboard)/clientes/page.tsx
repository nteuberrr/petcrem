'use client'
import { useState, useEffect, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import Link from 'next/link'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { fmtKg, fmtPrecio, fmtFecha } from '@/lib/format'

type Cliente = {
  id: string; codigo: string; nombre_mascota: string; nombre_tutor: string
  especie: string; peso_kg: string; tipo_servicio: string; codigo_servicio: string
  estado: string; fecha_retiro: string; fecha_creacion: string; ciclo_id: string
}
type Especie = { id: string; nombre: string; letra: string; activo: string }
type Veterinario = { id: string; nombre: string; activo: string }
type Producto = { id: string; nombre: string; precio: string; stock: string; activo: string }
type OtroServicio = { id: string; nombre: string; precio: string; activo: string }
type AdicionalItem = { tipo: 'producto' | 'servicio'; id: string; nombre: string; precio: number; qty: number }

const FORM_DEFAULT = {
  nombre_mascota: '',
  nombre_tutor: '',
  direccion_retiro: '',
  direccion_despacho: '',
  misma_direccion: false,
  comuna: '',
  fecha_retiro: '',
  especie: '',
  letra_especie: '',
  peso_kg: '',
  tipo_servicio: 'Cremación Individual',
  codigo_servicio: 'CI',
  veterinaria_id: '',
}

const SERVICIOS = [
  { nombre: 'Cremación Individual', codigo: 'CI' },
  { nombre: 'Cremación Premium', codigo: 'CP' },
  { nombre: 'Cremación Sin Devolución', codigo: 'SD' },
]

export default function ClientesPage() {
  const { data: session, status } = useSession()
  const isAdmin = status === 'authenticated' && (session?.user?.role === 'admin' || session?.user?.role === undefined)
  const [clientes, setClientes] = useState<Cliente[]>([])
  const [buscar, setBuscar] = useState('')
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [especies, setEspecies] = useState<Especie[]>([])
  const [veterinarias, setVeterinarias] = useState<Veterinario[]>([])
  const [productosDisp, setProductosDisp] = useState<Producto[]>([])
  const [otrosServicios, setOtrosServicios] = useState<OtroServicio[]>([])
  const [noEsVeterinaria, setNoEsVeterinaria] = useState(false)
  const [adicionales, setAdicionales] = useState<AdicionalItem[]>([])
  const [showAdicionales, setShowAdicionales] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState(FORM_DEFAULT)

  const fetchClientes = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams()
    if (buscar) params.set('buscar', buscar)
    const res = await fetch(`/api/clientes?${params}`)
    const data = await res.json()
    setClientes(Array.isArray(data) ? data : [])
    setLoading(false)
  }, [buscar])

  useEffect(() => { fetchClientes() }, [fetchClientes])

  useEffect(() => {
    fetch('/api/especies').then(r => r.json()).then(d => setEspecies(Array.isArray(d) ? d.filter((e: Especie) => e.activo === 'TRUE') : []))
    fetch('/api/veterinarios?activo=true').then(r => r.json()).then(d => setVeterinarias(Array.isArray(d) ? d : []))
    fetch('/api/productos').then(r => r.json()).then(d => setProductosDisp(Array.isArray(d) ? d.filter((p: Producto) => p.activo === 'TRUE') : []))
    fetch('/api/servicios?tipo=otros').then(r => r.json()).then(d => setOtrosServicios(Array.isArray(d) ? d.filter((s: OtroServicio) => s.activo === 'TRUE') : []))
  }, [])

  function toggleAdicional(tipo: 'producto' | 'servicio', item: { id: string; nombre: string; precio: string }) {
    const existing = adicionales.find(a => a.tipo === tipo && a.id === item.id)
    if (existing) {
      setAdicionales(prev => prev.filter(a => !(a.tipo === tipo && a.id === item.id)))
    } else {
      setAdicionales(prev => [...prev, { tipo, id: item.id, nombre: item.nombre, precio: parseFloat(item.precio) || 0, qty: 1 }])
    }
  }

  function updateQty(tipo: 'producto' | 'servicio', itemId: string, qty: number) {
    setAdicionales(prev => prev.map(a => a.tipo === tipo && a.id === itemId ? { ...a, qty: Math.max(1, qty) } : a))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    const pesoDeclarado = parseFloat(form.peso_kg)
    const body = {
      ...form,
      peso_kg: pesoDeclarado, // legacy
      peso_declarado: pesoDeclarado,
      misma_direccion: form.misma_direccion,
      veterinaria_id: noEsVeterinaria ? '' : form.veterinaria_id,
      adicionales: JSON.stringify(adicionales),
    }
    const res = await fetch('/api/clientes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (res.ok) {
      setShowModal(false)
      setForm(FORM_DEFAULT)
      setNoEsVeterinaria(false)
      setAdicionales([])
      setShowAdicionales(false)
      await fetchClientes()
    }
    setSaving(false)
  }

  const totalAdicionales = adicionales.reduce((sum, a) => sum + a.precio * a.qty, 0)

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Clientes</h1>
          <p className="text-gray-500 text-sm mt-0.5">Fichas de mascotas</p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          + Nueva ficha
        </button>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 mb-6">
        <input
          type="text"
          placeholder="Buscar por nombre, tutor o código..."
          value={buscar}
          onChange={(e) => setBuscar(e.target.value)}
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-gray-400 text-sm">Cargando...</div>
        ) : clientes.length === 0 ? (
          <div className="p-8 text-center text-gray-400 text-sm">No hay registros</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                {['Código', 'Mascota', 'Tutor', 'Especie', 'Peso', 'Servicio', 'Estado', 'Fecha retiro', ''].map((h) => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {clientes.map((c) => (
                <tr key={c.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 font-mono text-xs font-semibold text-indigo-700">{c.codigo}</td>
                  <td className="px-4 py-3 font-medium text-gray-900">{c.nombre_mascota}</td>
                  <td className="px-4 py-3 text-gray-600">{c.nombre_tutor}</td>
                  <td className="px-4 py-3 text-gray-600">{c.especie}</td>
                  <td className="px-4 py-3 text-gray-600">{fmtKg(c.peso_kg || '0')}</td>
                  <td className="px-4 py-3 text-gray-600">{c.codigo_servicio}</td>
                  <td className="px-4 py-3">
                    <Badge variant={c.estado === 'cremado' ? 'green' : 'yellow'}>{c.estado}</Badge>
                  </td>
                  <td className="px-4 py-3 text-gray-500">{fmtFecha(c.fecha_retiro)}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Link href={`/clientes/${c.id}`} className="bg-emerald-500 hover:bg-emerald-600 text-white px-3 py-1 rounded-md text-xs font-medium transition-colors">
                        Editar
                      </Link>
                      {isAdmin && (
                        <button
                          onClick={async () => {
                            if (!confirm(`¿Eliminar la ficha de "${c.nombre_mascota}"? Esta acción no se puede deshacer.`)) return
                            await fetch(`/api/clientes/${c.id}`, { method: 'DELETE' })
                            await fetchClientes()
                          }}
                          className="bg-red-500 hover:bg-red-600 text-white px-3 py-1 rounded-md text-xs font-medium transition-colors"
                        >Eliminar</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <Modal open={showModal} onClose={() => { setShowModal(false); setAdicionales([]); setShowAdicionales(false) }} title="Nueva ficha de mascota">
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Datos principales */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-gray-700">Nombre mascota *</label>
              <input required value={form.nombre_mascota} onChange={e => setForm(f => ({ ...f, nombre_mascota: e.target.value }))} className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-700">Nombre tutor *</label>
              <input required value={form.nombre_tutor} onChange={e => setForm(f => ({ ...f, nombre_tutor: e.target.value }))} className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-700">Dirección de retiro *</label>
            <input required value={form.direccion_retiro} onChange={e => setForm(f => ({ ...f, direccion_retiro: e.target.value, direccion_despacho: f.misma_direccion ? e.target.value : f.direccion_despacho }))} className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
          <div className="flex items-center gap-2">
            <input type="checkbox" id="misma" checked={form.misma_direccion} onChange={e => setForm(f => ({ ...f, misma_direccion: e.target.checked, direccion_despacho: e.target.checked ? f.direccion_retiro : '' }))} />
            <label htmlFor="misma" className="text-xs text-gray-600">Misma dirección para despacho</label>
          </div>
          {!form.misma_direccion && (
            <div>
              <label className="text-xs font-medium text-gray-700">Dirección de despacho</label>
              <input value={form.direccion_despacho} onChange={e => setForm(f => ({ ...f, direccion_despacho: e.target.value }))} className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-gray-700">Comuna *</label>
              <input required value={form.comuna} onChange={e => setForm(f => ({ ...f, comuna: e.target.value }))} className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-700">Fecha de retiro *</label>
              <input required type="date" value={form.fecha_retiro} onChange={e => setForm(f => ({ ...f, fecha_retiro: e.target.value }))} className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-gray-700">Especie *</label>
              <select required value={form.especie} onChange={e => {
                const esp = especies.find(es => es.nombre === e.target.value)
                setForm(f => ({ ...f, especie: e.target.value, letra_especie: esp?.letra ?? '' }))
              }} className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                <option value="">Seleccionar...</option>
                {especies.map(e => <option key={e.id} value={e.nombre}>{e.nombre}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-700">Peso (kg) *</label>
              <input required type="number" step="0.1" min="0" value={form.peso_kg} onChange={e => setForm(f => ({ ...f, peso_kg: e.target.value }))} className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-700">Tipo de servicio *</label>
            <select required value={form.codigo_servicio} onChange={e => {
              const svc = SERVICIOS.find(s => s.codigo === e.target.value)
              setForm(f => ({ ...f, codigo_servicio: e.target.value, tipo_servicio: svc?.nombre ?? '' }))
            }} className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
              {SERVICIOS.map(s => <option key={s.codigo} value={s.codigo}>{s.nombre} ({s.codigo})</option>)}
            </select>
          </div>

          {/* Veterinaria */}
          <div className="border-t border-gray-100 pt-4">
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-medium text-gray-700">Veterinaria derivante</label>
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input type="checkbox" checked={noEsVeterinaria} onChange={e => { setNoEsVeterinaria(e.target.checked); if (e.target.checked) setForm(f => ({ ...f, veterinaria_id: '' })) }} className="w-3.5 h-3.5 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500" />
                <span className="text-xs text-gray-500">No es veterinaria</span>
              </label>
            </div>
            {!noEsVeterinaria && (
              <select value={form.veterinaria_id} onChange={e => setForm(f => ({ ...f, veterinaria_id: e.target.value }))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                <option value="">Seleccionar veterinaria...</option>
                {veterinarias.map(v => <option key={v.id} value={v.id}>{v.nombre}</option>)}
              </select>
            )}
          </div>

          {/* Adicionales */}
          {(productosDisp.length > 0 || otrosServicios.length > 0) && (
            <div className="border-t border-gray-100">
              <button
                type="button"
                onClick={() => setShowAdicionales(v => !v)}
                className="w-full flex items-center justify-between py-3 text-left hover:bg-gray-50 px-1 rounded transition-colors"
              >
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-gray-700">Adicionales</span>
                  {adicionales.length > 0 && (
                    <span className="bg-indigo-100 text-indigo-700 text-xs font-semibold px-2 py-0.5 rounded-full">
                      {adicionales.length} ítem(s) · {fmtPrecio(totalAdicionales)}
                    </span>
                  )}
                </div>
                <span className="text-gray-400 text-xs">{showAdicionales ? '▲' : '▼'}</span>
              </button>

              {showAdicionales && (
                <div className="pb-3">
                  {productosDisp.length > 0 && (
                    <div className="mb-3">
                      <p className="text-xs text-gray-400 mb-2 uppercase tracking-wide">Productos</p>
                      <div className="space-y-1.5">
                        {productosDisp.map(p => {
                          const item = adicionales.find(a => a.tipo === 'producto' && a.id === p.id)
                          const stockNum = parseInt(p.stock || '0')
                          return (
                            <div key={p.id} className="flex items-center gap-2">
                              <input type="checkbox" checked={!!item} onChange={() => toggleAdicional('producto', p)} className="w-3.5 h-3.5 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500" />
                              <span className="flex-1 text-sm text-gray-800">{p.nombre}</span>
                              <span className="text-xs text-gray-400">{fmtPrecio(p.precio)}</span>
                              {stockNum < 50 && <span className="text-xs text-red-400">⚠{stockNum}</span>}
                              {item && (
                                <input type="number" min={1} value={item.qty} onChange={e => updateQty('producto', p.id, parseInt(e.target.value) || 1)}
                                  className="w-14 border border-gray-200 rounded px-1.5 py-0.5 text-xs text-center focus:outline-none focus:ring-1 focus:ring-indigo-500" />
                              )}
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )}

                  {otrosServicios.length > 0 && (
                    <div>
                      <p className="text-xs text-gray-400 mb-2 uppercase tracking-wide">Otros servicios</p>
                      <div className="space-y-1.5">
                        {otrosServicios.map(s => {
                          const item = adicionales.find(a => a.tipo === 'servicio' && a.id === s.id)
                          return (
                            <div key={s.id} className="flex items-center gap-2">
                              <input type="checkbox" checked={!!item} onChange={() => toggleAdicional('servicio', s)} className="w-3.5 h-3.5 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500" />
                              <span className="flex-1 text-sm text-gray-800">{s.nombre}</span>
                              <span className="text-xs text-gray-400">{fmtPrecio(s.precio)}</span>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={() => { setShowModal(false); setAdicionales([]); setShowAdicionales(false) }} className="flex-1 border border-gray-200 text-gray-700 rounded-lg py-2 text-sm font-medium hover:bg-gray-50 transition-colors">
              Cancelar
            </button>
            <button type="submit" disabled={saving} className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg py-2 text-sm font-medium transition-colors disabled:opacity-50">
              {saving ? 'Guardando...' : 'Guardar ficha'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
