'use client'
import { PageHeader } from '@/components/ui/kit'
import { Lock } from 'lucide-react'
import { useState, useEffect, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import Link from 'next/link'
import { esAdmin } from '@/lib/roles'
import { Toggle } from '@/components/ui/Toggle'
import AddressAutocomplete from '@/components/ui/AddressAutocomplete'
import { Modal } from '@/components/ui/Modal'
import { Badge } from '@/components/ui/Badge'

type Vet = { id: string; nombre: string; comuna: string; nombre_contacto: string; cargo_contacto: string; tipo_precios: string; activo: string; direccion: string; telefono: string; telefonos_adicionales: string; correo: string; rut: string; razon_social: string; giro: string }

const emptyVet = { nombre: '', direccion: '', telefono: '', telefonos_adicionales: '', correo: '', nombre_contacto: '', cargo_contacto: '', comuna: '', rut: '', razon_social: '', giro: '', tipo_precios: 'precios_convenio' }

export default function BasesPage() {
  const { data: session, status } = useSession()

  // Acceso según los PERMISOS DINÁMICOS (Configuración → Permisos por rol), no un
  // esAdmin hardcodeado: admin/admin2 siempre, y cualquier rol (ej. Operario Nivel 2)
  // al que el dueño le habilite el módulo "bases". El proxy ya gatea el acceso real;
  // esto solo evita mostrar "Acceso restringido" a quien SÍ tiene el permiso.
  const [allowed, setAllowed] = useState<Set<string> | null>(null)
  useEffect(() => {
    let cancel = false
    fetch('/api/mis-modulos')
      .then(r => (r.ok ? r.json() : { modulos: [] }))
      .then(d => { if (!cancel) setAllowed(new Set<string>(Array.isArray(d.modulos) ? d.modulos : [])) })
      .catch(() => { if (!cancel) setAllowed(new Set()) })
    return () => { cancel = true }
  }, [])
  const rol = session?.user?.role
  const isAdmin = status === 'authenticated' &&
    (esAdmin(rol) || rol === undefined || (allowed?.has('bases') ?? false))

  const [vets, setVets] = useState<Vet[]>([])

  const [showVetModal, setShowVetModal] = useState(false)
  const [editingVet, setEditingVet] = useState<Vet | null>(null)

  const [vetForm, setVetForm] = useState(emptyVet)
  const [vetError, setVetError] = useState('')

  const fetchAll = useCallback(async () => {
    const v = await fetch('/api/veterinarios').then(r => r.json())
    setVets(Array.isArray(v) ? v : [])
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll])

  // Devuelven el mensaje de error de la API, o '' si salió bien. El formulario de
  // veterinario lo NECESITA: rechaza un celular que ya es de otra clínica, y sin
  // esto el modal se cerraba igual y el cambio se perdía sin decir nada.
  const enviar = async (url: string, method: 'PATCH' | 'POST', body: object): Promise<string> => {
    const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .catch(() => null)
    if (!r || !r.ok) {
      const d = r ? await r.json().catch(() => ({})) : {}
      return String(d?.error || 'No se pudo guardar. Volvé a intentarlo.')
    }
    await fetchAll()
    return ''
  }
  const patch = async (url: string, body: object) => { await enviar(url, 'PATCH', body) }
  const del = async (url: string) => {
    await fetch(url, { method: 'DELETE' })
    await fetchAll()
  }

  if (status === 'loading' || allowed === null) return <div className="p-8 text-gray-400 text-sm">Cargando...</div>
  if (!isAdmin) return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <Lock className="w-10 h-10 mx-auto mb-4 text-gray-400" aria-hidden="true" />
      <h2 className="text-xl font-bold text-gray-900 mb-2">Acceso restringido</h2>
      <p className="text-gray-500 text-sm">Esta sección está disponible solo para administradores.</p>
    </div>
  )

  return (
    <div className="max-w-5xl">
      <div className="mb-6">
        <PageHeader title="Veterinarios" subtitle="Fichas de veterinarias derivantes" />
      </div>

      {/* ─── VETERINARIOS ─── */}
      <div className="bg-white rounded-xl shadow-md border border-gray-300 overflow-hidden">
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-300">
            <h2 className="font-semibold text-gray-900">Veterinarios</h2>
            <button onClick={() => { setEditingVet(null); setVetForm(emptyVet); setVetError(''); setShowVetModal(true) }}
              className="bg-brand hover:bg-brand-dark text-white px-3 py-1.5 rounded-lg text-xs font-medium transition-colors">
              + Agregar
            </button>
          </div>
          <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
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
                        className="bg-brand hover:bg-brand-dark text-white px-3 py-1.5 min-h-9 inline-flex items-center rounded-xl text-xs font-medium transition-colors">
                        Ver
                      </Link>
                      <button
                        onClick={() => { setEditingVet(v); setVetError(''); setVetForm({ nombre: v.nombre, direccion: v.direccion, telefono: v.telefono, telefonos_adicionales: v.telefonos_adicionales || '', correo: v.correo, nombre_contacto: v.nombre_contacto, cargo_contacto: v.cargo_contacto, comuna: v.comuna, rut: v.rut, razon_social: v.razon_social, giro: v.giro, tipo_precios: v.tipo_precios }); setShowVetModal(true) }}
                        className="border border-gray-300 text-gray-700 bg-white hover:bg-gray-50 px-3 py-1.5 min-h-9 rounded-xl text-xs font-medium transition-colors">
                        Editar
                      </button>
                      {isAdmin && (
                        <button
                          onClick={() => { if (confirm(`¿Eliminar "${v.nombre}"?`)) del(`/api/veterinarios?id=${v.id}`) }}
                          className="border border-red-200 text-red-600 bg-white hover:bg-red-50 px-3 py-1.5 min-h-9 rounded-xl text-xs font-medium transition-colors">
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
        </div>

      {/* ─── MODALES ─── */}
      <Modal open={showVetModal} onClose={() => { setShowVetModal(false); setEditingVet(null); setVetForm(emptyVet) }}
        title={editingVet ? 'Editar veterinario' : 'Agregar veterinario'}>
        <form onSubmit={async e => {
          e.preventDefault()
          setVetError('')
          const err = editingVet
            ? await enviar('/api/veterinarios', 'PATCH', { id: editingVet.id, ...vetForm })
            : await enviar('/api/veterinarios', 'POST', vetForm)
          // Si falló, el modal SE QUEDA ABIERTO con lo escrito y el motivo a la
          // vista: cerrarlo perdería el formulario sin explicar por qué.
          if (err) { setVetError(err); return }
          setShowVetModal(false)
          setEditingVet(null)
          setVetForm(emptyVet)
        }} className="space-y-3">
          {([['Nombre', 'nombre'], ['RUT', 'rut'], ['Razón social', 'razon_social'], ['Giro', 'giro'], ['Dirección', 'direccion'], ['Comuna', 'comuna'], ['Teléfono', 'telefono'], ['Otros celulares', 'telefonos_adicionales'], ['Correo', 'correo'], ['Nombre contacto', 'nombre_contacto'], ['Cargo contacto', 'cargo_contacto']] as [string, string][]).map(([label, key]) => (
            <div key={key}>
              <label className="text-xs font-medium text-gray-700">{label}</label>
              {key === 'direccion' ? (
                <AddressAutocomplete
                  value={(vetForm as Record<string, string>)[key]}
                  onChange={v => setVetForm(f => ({ ...f, [key]: v }))}
                  placeholder="Empieza a escribir la dirección…"
                  className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
                />
              ) : (
                <input value={(vetForm as Record<string, string>)[key]}
                  onChange={e => setVetForm(f => ({ ...f, [key]: e.target.value }))}
                  placeholder={key === 'telefonos_adicionales' ? '912345678, 987654321' : undefined}
                  className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand" />
              )}
              {/* Se explica para qué sirve: no es un dato de contacto más, es lo
                  que hace que el agente reconozca a la clínica escriba quien
                  escriba. Los envíos siguen yendo al teléfono principal. */}
              {key === 'telefonos_adicionales' && (
                <p className="mt-1 text-[11px] text-gray-500">
                  Separados por coma. Si escriben desde cualquiera de estos números, el agente sabe que es esta veterinaria.
                  Los mensajes que enviamos nosotros siguen yendo al teléfono de arriba.
                </p>
              )}
            </div>
          ))}
          <div>
            <label className="text-xs font-medium text-gray-700">Tipo de precios</label>
            <div className="mt-1">
              <span className={`text-sm font-medium px-2.5 py-1 rounded-lg ${vetForm.tipo_precios === 'precios_especiales' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>
                {vetForm.tipo_precios === 'precios_especiales' ? 'Precios especiales' : 'Precios convenio'}
              </span>
            </div>
            <p className="mt-1.5 text-[11px] text-gray-500 leading-snug">
              Se define <strong>automáticamente</strong>: <strong>Especial</strong> si la clínica tiene precios especiales configurados (Configuración → Precios → Especiales); si no tiene ninguno, <strong>Convenio</strong>.
            </p>
          </div>
          {vetError && (
            <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{vetError}</p>
          )}
          <button type="submit" className="w-full bg-brand hover:bg-brand-dark text-white rounded-lg py-2 text-sm font-medium transition-colors">
            {editingVet ? 'Guardar cambios' : 'Guardar'}
          </button>
        </form>
      </Modal>

    </div>
  )
}
