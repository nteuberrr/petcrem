'use client'
import { useState, useEffect, use } from 'react'
import { useRouter } from 'next/navigation'
import { Badge } from '@/components/ui/Badge'

type ClienteDetalle = {
  id: string
  codigo: string
  nombre_mascota: string
  nombre_tutor: string
  direccion_retiro: string
  direccion_despacho: string
  misma_direccion: string
  comuna: string
  fecha_retiro: string
  especie: string
  letra_especie: string
  peso_kg: string
  tipo_servicio: string
  codigo_servicio: string
  estado: string
  ciclo_id: string
  fecha_creacion: string
  ciclo?: {
    id: string
    fecha: string
    numero_ciclo: string
    litros_inicio: string
    litros_fin: string
    comentarios: string
  } | null
}

export default function ClienteDetallePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const [cliente, setCliente] = useState<ClienteDetalle | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState<Partial<ClienteDetalle>>({})

  useEffect(() => {
    fetch(`/api/clientes/${id}`)
      .then(r => r.json())
      .then(d => {
        setCliente(d)
        setForm(d)
        setLoading(false)
      })
  }, [id])

  async function handleSave() {
    setSaving(true)
    const res = await fetch(`/api/clientes/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    if (res.ok) {
      const updated = await res.json()
      setCliente(updated)
    }
    setSaving(false)
  }

  if (loading) return <div className="p-8 text-gray-400 text-sm">Cargando...</div>
  if (!cliente) return <div className="p-8 text-gray-400 text-sm">Cliente no encontrado</div>

  const litrosUsados = cliente.ciclo
    ? parseFloat(cliente.ciclo.litros_fin) - parseFloat(cliente.ciclo.litros_inicio)
    : null

  return (
    <div className="max-w-3xl">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => router.back()} className="text-gray-400 hover:text-gray-600">←</button>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{cliente.nombre_mascota}</h1>
          <div className="flex items-center gap-2 mt-1">
            <span className="font-mono text-xs text-indigo-700 font-semibold bg-indigo-50 px-2 py-0.5 rounded">{cliente.codigo}</span>
            <Badge variant={cliente.estado === 'cremado' ? 'green' : 'yellow'}>{cliente.estado}</Badge>
          </div>
        </div>
      </div>

      {/* Datos de ingreso */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 mb-6">
        <h2 className="text-base font-semibold text-gray-900 mb-4">Datos de ingreso</h2>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Nombre mascota" value={form.nombre_mascota} onChange={v => setForm(f => ({ ...f, nombre_mascota: v }))} />
          <Field label="Nombre tutor" value={form.nombre_tutor} onChange={v => setForm(f => ({ ...f, nombre_tutor: v }))} />
          <Field label="Dirección de retiro" value={form.direccion_retiro} onChange={v => setForm(f => ({ ...f, direccion_retiro: v }))} />
          <Field label="Dirección de despacho" value={form.direccion_despacho} onChange={v => setForm(f => ({ ...f, direccion_despacho: v }))} />
          <Field label="Comuna" value={form.comuna} onChange={v => setForm(f => ({ ...f, comuna: v }))} />
          <Field label="Fecha de retiro" type="date" value={form.fecha_retiro} onChange={v => setForm(f => ({ ...f, fecha_retiro: v }))} />
          <Field label="Especie" value={form.especie} onChange={v => setForm(f => ({ ...f, especie: v }))} />
          <Field label="Peso (kg)" type="number" value={form.peso_kg} onChange={v => setForm(f => ({ ...f, peso_kg: v }))} />
          <div>
            <label className="text-xs font-medium text-gray-500">Tipo de servicio</label>
            <select
              value={form.codigo_servicio}
              onChange={e => setForm(f => ({ ...f, codigo_servicio: e.target.value }))}
              className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="CI">Cremación Individual (CI)</option>
              <option value="CP">Cremación Premium (CP)</option>
              <option value="SD">Cremación Sin Devolución (SD)</option>
            </select>
          </div>
        </div>
        <div className="flex justify-end mt-4">
          <button
            onClick={handleSave}
            disabled={saving}
            className="bg-indigo-600 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
          >
            {saving ? 'Guardando...' : 'Guardar cambios'}
          </button>
        </div>
      </div>

      {/* Proceso de cremación */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        <h2 className="text-base font-semibold text-gray-900 mb-4">Proceso de cremación</h2>
        {cliente.ciclo ? (
          <div className="grid grid-cols-2 gap-4">
            <InfoField label="Fecha del ciclo" value={cliente.ciclo.fecha} />
            <InfoField label="Número de ciclo" value={`#${cliente.ciclo.numero_ciclo}`} />
            <InfoField label="Litros utilizados" value={litrosUsados !== null ? `${litrosUsados} L` : '—'} />
            <InfoField label="Comentarios" value={cliente.ciclo.comentarios || '—'} />
          </div>
        ) : (
          <div className="flex items-center gap-3 text-yellow-700 bg-yellow-50 rounded-lg px-4 py-3 text-sm">
            <span>⏳</span>
            <span>Pendiente de cremación — aún no asignada a ningún ciclo.</span>
          </div>
        )}
      </div>
    </div>
  )
}

function Field({ label, value, onChange, type = 'text' }: {
  label: string; value?: string; onChange: (v: string) => void; type?: string
}) {
  return (
    <div>
      <label className="text-xs font-medium text-gray-500">{label}</label>
      <input
        type={type}
        value={value ?? ''}
        onChange={e => onChange(e.target.value)}
        className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
      />
    </div>
  )
}

function InfoField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-medium text-gray-500">{label}</p>
      <p className="text-sm text-gray-900 mt-0.5">{value}</p>
    </div>
  )
}
