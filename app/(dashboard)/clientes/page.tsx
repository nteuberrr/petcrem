'use client'
import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'

type Cliente = {
  id: string
  codigo: string
  nombre_mascota: string
  nombre_tutor: string
  especie: string
  peso_kg: string
  tipo_servicio: string
  codigo_servicio: string
  estado: string
  fecha_retiro: string
  fecha_creacion: string
  ciclo_id: string
}

type Especie = { id: string; nombre: string; letra: string; activo: string }

export default function ClientesPage() {
  const [clientes, setClientes] = useState<Cliente[]>([])
  const [buscar, setBuscar] = useState('')
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [especies, setEspecies] = useState<Especie[]>([])
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
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
  })

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
  }, [])

  const SERVICIOS = [
    { nombre: 'Cremación Individual', codigo: 'CI' },
    { nombre: 'Cremación Premium', codigo: 'CP' },
    { nombre: 'Cremación Sin Devolución', codigo: 'SD' },
  ]

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    const body = {
      ...form,
      peso_kg: parseFloat(form.peso_kg),
      misma_direccion: form.misma_direccion,
    }
    const res = await fetch('/api/clientes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (res.ok) {
      setShowModal(false)
      setForm({ nombre_mascota: '', nombre_tutor: '', direccion_retiro: '', direccion_despacho: '', misma_direccion: false, comuna: '', fecha_retiro: '', especie: '', letra_especie: '', peso_kg: '', tipo_servicio: 'Cremación Individual', codigo_servicio: 'CI' })
      await fetchClientes()
    }
    setSaving(false)
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Clientes</h1>
          <p className="text-gray-500 text-sm mt-0.5">Fichas de mascotas</p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors"
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
                  <td className="px-4 py-3 text-gray-600">{c.peso_kg} kg</td>
                  <td className="px-4 py-3 text-gray-600">{c.codigo_servicio}</td>
                  <td className="px-4 py-3">
                    <Badge variant={c.estado === 'cremado' ? 'green' : 'yellow'}>
                      {c.estado}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-gray-500">{c.fecha_retiro}</td>
                  <td className="px-4 py-3">
                    <Link href={`/clientes/${c.id}`} className="text-indigo-600 hover:text-indigo-800 font-medium">
                      Ver →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <Modal open={showModal} onClose={() => setShowModal(false)} title="Nueva ficha de mascota">
        <form onSubmit={handleSubmit} className="space-y-4">
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
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={() => setShowModal(false)} className="flex-1 border border-gray-200 text-gray-700 rounded-lg py-2 text-sm font-medium hover:bg-gray-50">
              Cancelar
            </button>
            <button type="submit" disabled={saving} className="flex-1 bg-indigo-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-indigo-700 disabled:opacity-50">
              {saving ? 'Guardando...' : 'Guardar ficha'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
