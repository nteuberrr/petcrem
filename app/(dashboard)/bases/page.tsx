'use client'
import { useState, useEffect, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import Link from 'next/link'
import { Toggle } from '@/components/ui/Toggle'
import { Modal } from '@/components/ui/Modal'
import { Badge } from '@/components/ui/Badge'

type Vet = { id: string; nombre: string; comuna: string; nombre_contacto: string; cargo_contacto: string; tipo_precios: string; activo: string; direccion: string; telefono: string; correo: string; rut: string; razon_social: string; giro: string }

const emptyVet = { nombre: '', direccion: '', telefono: '', correo: '', nombre_contacto: '', cargo_contacto: '', comuna: '', rut: '', razon_social: '', giro: '', tipo_precios: 'precios_convenio' }

export default function BasesPage() {
  const { data: session, status } = useSession()
  const isAdmin = status === 'authenticated' && (session?.user?.role === 'admin' || session?.user?.role === undefined)

  const [vets, setVets] = useState<Vet[]>([])

  const [showVetModal, setShowVetModal] = useState(false)
  const [editingVet, setEditingVet] = useState<Vet | null>(null)

  const [vetForm, setVetForm] = useState(emptyVet)

  const fetchAll = useCallback(async () => {
    const v = await fetch('/api/veterinarios').then(r => r.json())
    setVets(Array.isArray(v) ? v : [])
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll])

  const patch = async (url: string, body: object) => {
    await fetch(url, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    await fetchAll()
  }
  const post = async (url: string, body: object) => {
    await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    await fetchAll()
  }
  const del = async (url: string) => {
    await fetch(url, { method: 'DELETE' })
    await fetchAll()
  }

  if (status === 'loading') return <div className="p-8 text-gray-400 text-sm">Cargando...</div>
  if (!isAdmin) return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <p className="text-4xl mb-4">🔒</p>
      <h2 className="text-xl font-bold text-gray-900 mb-2">Acceso restringido</h2>
      <p className="text-gray-500 text-sm">Esta sección está disponible solo para administradores.</p>
    </div>
  )

  return (
    <div className="max-w-5xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Bases de datos</h1>
        <p className="text-gray-500 text-sm mt-0.5">Fichas de veterinarios</p>
      </div>

      {/* ─── VETERINARIOS ─── */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
            <h2 className="font-semibold text-gray-900">Veterinarios</h2>
            <button onClick={() => { setEditingVet(null); setVetForm(emptyVet); setShowVetModal(true) }}
              className="bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded-lg text-xs font-medium transition-colors">
              + Agregar
            </button>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>{['Nombre', 'Comuna', 'Contacto', 'Precios', 'Estado', ''].map(h => (
                <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-gray-500">{h}</th>
              ))}</tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {vets.map(v => (
                <tr key={v.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">{v.nombre}</td>
                  <td className="px-4 py-3 text-gray-600">{v.comuna}</td>
                  <td className="px-4 py-3 text-gray-600">{v.nombre_contacto}</td>
                  <td className="px-4 py-3">
                    <Badge variant={v.tipo_precios === 'precios_especiales' ? 'purple' : 'blue'}>
                      {v.tipo_precios === 'precios_convenio' ? 'Convenio' : 'Especial'}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    <Toggle checked={v.activo === 'TRUE'} onChange={val => patch('/api/veterinarios', { id: v.id, activo: val ? 'TRUE' : 'FALSE' })} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Link href={`/bases/veterinarios/${v.id}`}
                        className="bg-indigo-500 hover:bg-indigo-600 text-white px-3 py-1 rounded-md text-xs font-medium transition-colors">
                        Ver
                      </Link>
                      <button
                        onClick={() => { setEditingVet(v); setVetForm({ nombre: v.nombre, direccion: v.direccion, telefono: v.telefono, correo: v.correo, nombre_contacto: v.nombre_contacto, cargo_contacto: v.cargo_contacto, comuna: v.comuna, rut: v.rut, razon_social: v.razon_social, giro: v.giro, tipo_precios: v.tipo_precios }); setShowVetModal(true) }}
                        className="bg-emerald-500 hover:bg-emerald-600 text-white px-3 py-1 rounded-md text-xs font-medium transition-colors">
                        Editar
                      </button>
                      {isAdmin && (
                        <button
                          onClick={() => { if (confirm(`¿Eliminar "${v.nombre}"?`)) del(`/api/veterinarios?id=${v.id}`) }}
                          className="bg-red-500 hover:bg-red-600 text-white px-3 py-1 rounded-md text-xs font-medium transition-colors">
                          Eliminar
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {vets.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400 text-sm">Sin veterinarios registrados</td></tr>
              )}
            </tbody>
          </table>
        </div>

      {/* ─── MODALES ─── */}
      <Modal open={showVetModal} onClose={() => { setShowVetModal(false); setEditingVet(null); setVetForm(emptyVet) }}
        title={editingVet ? 'Editar veterinario' : 'Agregar veterinario'}>
        <form onSubmit={async e => {
          e.preventDefault()
          if (editingVet) {
            await patch('/api/veterinarios', { id: editingVet.id, ...vetForm })
          } else {
            await post('/api/veterinarios', vetForm)
          }
          setShowVetModal(false)
          setEditingVet(null)
          setVetForm(emptyVet)
        }} className="space-y-3">
          {([['Nombre', 'nombre'], ['RUT', 'rut'], ['Razón social', 'razon_social'], ['Giro', 'giro'], ['Dirección', 'direccion'], ['Comuna', 'comuna'], ['Teléfono', 'telefono'], ['Correo', 'correo'], ['Nombre contacto', 'nombre_contacto'], ['Cargo contacto', 'cargo_contacto']] as [string, string][]).map(([label, key]) => (
            <div key={key}>
              <label className="text-xs font-medium text-gray-700">{label}</label>
              <input value={(vetForm as Record<string, string>)[key]}
                onChange={e => setVetForm(f => ({ ...f, [key]: e.target.value }))}
                className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
          ))}
          <div>
            <label className="text-xs font-medium text-gray-700">Tipo de precios</label>
            <select value={vetForm.tipo_precios} onChange={e => setVetForm(f => ({ ...f, tipo_precios: e.target.value }))}
              className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
              <option value="precios_convenio">Precios convenio</option>
              <option value="precios_especiales">Precios especiales</option>
            </select>
          </div>
          <button type="submit" className="w-full bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg py-2 text-sm font-medium transition-colors">
            {editingVet ? 'Guardar cambios' : 'Guardar'}
          </button>
        </form>
      </Modal>

    </div>
  )
}
