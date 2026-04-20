'use client'
import { useState, useEffect, use } from 'react'
import { useRouter } from 'next/navigation'
import { Badge } from '@/components/ui/Badge'
import { fmtPrecio, fmtFecha } from '@/lib/format'

type Cliente = {
  id: string; codigo: string; nombre_mascota: string; nombre_tutor: string
  especie: string; peso_kg: string; codigo_servicio: string; estado: string; fecha_creacion: string
}

type Tramo = { id: string; peso_min: string; peso_max: string; precio_ci: string; precio_cp: string; precio_sd: string }

type VetDetalle = {
  id: string; nombre: string; rut: string; razon_social: string; giro: string
  direccion: string; telefono: string; correo: string
  nombre_contacto: string; cargo_contacto: string; comuna: string
  tipo_precios: string; activo: string
  clientes: Cliente[]
  tramos_especiales: Tramo[]
}

export default function VetDetallePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const [vet, setVet] = useState<VetDetalle | null>(null)
  const [loading, setLoading] = useState(true)
  const [generando, setGenerando] = useState(false)

  useEffect(() => {
    fetch(`/api/veterinarios/${id}`)
      .then(r => r.json())
      .then(d => { setVet(d); setLoading(false) })
  }, [id])

  async function descargarInforme() {
    if (!vet) return
    setGenerando(true)
    const XLSX = await import('xlsx-js-style')
    const wb = XLSX.utils.book_new()

    // Datos generales
    const info = [
      ['INFORME DE VETERINARIA', ''],
      ['Nombre', vet.nombre],
      ['RUT', vet.rut],
      ['Razón social', vet.razon_social],
      ['Dirección', vet.direccion],
      ['Teléfono', vet.telefono],
      ['Correo', vet.correo],
      ['Contacto', vet.nombre_contacto],
      ['Tipo precios', vet.tipo_precios === 'precios_especiales' ? 'Especiales' : 'Convenio'],
    ]
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(info), 'Info')

    // Clientes
    const headers = ['Código', 'Mascota', 'Tutor', 'Especie', 'Peso (kg)', 'Servicio', 'Estado', 'Fecha ingreso']
    const rows = [
      headers,
      ...vet.clientes.map(c => [c.codigo, c.nombre_mascota, c.nombre_tutor, c.especie, c.peso_kg, c.codigo_servicio, c.estado, c.fecha_creacion]),
    ]
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Mascotas')

    XLSX.writeFile(wb, `informe-${vet.nombre.replace(/\s+/g, '-')}.xlsx`)
    setGenerando(false)
  }

  function copiarEmail() {
    if (vet?.correo) {
      navigator.clipboard.writeText(vet.correo)
      alert(`Email copiado: ${vet.correo}`)
    }
  }

  function abrirMailto() {
    if (!vet) return
    const subject = encodeURIComponent(`Informe de servicios — ${vet.nombre}`)
    const body = encodeURIComponent(
      `Estimado/a ${vet.nombre_contacto || vet.nombre},\n\n` +
      `Adjuntamos el detalle de mascotas ingresadas a través de su clínica.\n\n` +
      `Total de mascotas: ${vet.clientes.length}\n` +
      `Cremadas: ${vet.clientes.filter(c => c.estado === 'cremado').length}\n` +
      `Pendientes: ${vet.clientes.filter(c => c.estado === 'pendiente').length}\n\n` +
      `Saludos,\nAlma Animal`
    )
    window.open(`mailto:${vet.correo}?subject=${subject}&body=${body}`)
  }

  if (loading) return <div className="p-8 text-gray-400 text-sm">Cargando...</div>
  if (!vet) return <div className="p-8 text-gray-400 text-sm">Veterinaria no encontrada</div>

  const cremadas = vet.clientes.filter(c => c.estado === 'cremado').length
  const pendientes = vet.clientes.filter(c => c.estado === 'pendiente').length

  return (
    <div className="max-w-4xl">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => router.back()} className="text-gray-400 hover:text-gray-600">←</button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-gray-900">{vet.nombre}</h1>
          <div className="flex items-center gap-2 mt-1">
            <Badge variant={vet.tipo_precios === 'precios_especiales' ? 'purple' : 'blue'}>
              {vet.tipo_precios === 'precios_especiales' ? 'Convenio especial' : 'Convenio estándar'}
            </Badge>
            <Badge variant={vet.activo === 'TRUE' ? 'green' : 'yellow'}>
              {vet.activo === 'TRUE' ? 'Activa' : 'Inactiva'}
            </Badge>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={copiarEmail} className="border border-gray-200 text-gray-600 px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-50">
            📋 Copiar email
          </button>
          <button onClick={abrirMailto} disabled={!vet.correo} className="border border-indigo-200 text-indigo-600 px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-50 disabled:opacity-40">
            ✉ Enviar detalle
          </button>
          <button onClick={descargarInforme} disabled={generando} className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50">
            {generando ? 'Generando...' : '↓ Descargar Excel'}
          </button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 text-center">
          <p className="text-3xl font-bold text-indigo-700">{vet.clientes.length}</p>
          <p className="text-xs text-gray-500 mt-1">Total mascotas</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 text-center">
          <p className="text-3xl font-bold text-green-600">{cremadas}</p>
          <p className="text-xs text-gray-500 mt-1">Cremadas</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 text-center">
          <p className="text-3xl font-bold text-yellow-600">{pendientes}</p>
          <p className="text-xs text-gray-500 mt-1">Pendientes</p>
        </div>
      </div>

      {/* Datos */}
      <div className="grid grid-cols-2 gap-6 mb-6">
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <h2 className="font-semibold text-gray-900 mb-4">Datos generales</h2>
          <div className="space-y-3 text-sm">
            {[
              ['RUT', vet.rut],
              ['Razón social', vet.razon_social],
              ['Giro', vet.giro],
              ['Dirección', vet.direccion],
              ['Comuna', vet.comuna],
            ].map(([label, val]) => val ? (
              <div key={label} className="flex justify-between gap-2">
                <span className="text-gray-500">{label}</span>
                <span className="text-gray-900 text-right">{val}</span>
              </div>
            ) : null)}
          </div>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <h2 className="font-semibold text-gray-900 mb-4">Contacto</h2>
          <div className="space-y-3 text-sm">
            {[
              ['Teléfono', vet.telefono],
              ['Email', vet.correo],
              ['Contacto', vet.nombre_contacto],
              ['Cargo', vet.cargo_contacto],
            ].map(([label, val]) => val ? (
              <div key={label} className="flex justify-between gap-2">
                <span className="text-gray-500">{label}</span>
                <span className="text-gray-900 text-right">{val}</span>
              </div>
            ) : null)}
          </div>
        </div>
      </div>

      {/* Precios especiales */}
      {vet.tramos_especiales.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden mb-6">
          <div className="px-6 py-4 border-b border-gray-100">
            <h2 className="font-semibold text-gray-900">Tramos de precio especial</h2>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-gray-50"><tr>{['Peso mín', 'Peso máx', 'CI', 'CP', 'SD'].map(h => <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-gray-500">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-gray-50">
              {vet.tramos_especiales.map(t => (
                <tr key={t.id}>
                  <td className="px-4 py-2 text-gray-600">{t.peso_min} kg</td>
                  <td className="px-4 py-2 text-gray-600">{t.peso_max} kg</td>
                  <td className="px-4 py-2 font-medium">{fmtPrecio(t.precio_ci)}</td>
                  <td className="px-4 py-2 font-medium">{fmtPrecio(t.precio_cp)}</td>
                  <td className="px-4 py-2 font-medium">{fmtPrecio(t.precio_sd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Lista de mascotas */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900">Mascotas ingresadas</h2>
        </div>
        {vet.clientes.length === 0 ? (
          <div className="p-8 text-center text-gray-400 text-sm">Sin mascotas registradas para esta veterinaria</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>{['Código', 'Mascota', 'Tutor', 'Especie', 'Servicio', 'Estado', 'Fecha'].map(h => <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-gray-500">{h}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {vet.clientes.map(c => (
                <tr key={c.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-mono text-xs text-indigo-700 font-semibold">{c.codigo}</td>
                  <td className="px-4 py-3 font-medium text-gray-900">{c.nombre_mascota}</td>
                  <td className="px-4 py-3 text-gray-600">{c.nombre_tutor}</td>
                  <td className="px-4 py-3 text-gray-600">{c.especie}</td>
                  <td className="px-4 py-3"><span className="font-mono font-semibold text-xs text-gray-700">{c.codigo_servicio}</span></td>
                  <td className="px-4 py-3"><Badge variant={c.estado === 'cremado' ? 'green' : 'yellow'}>{c.estado}</Badge></td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{fmtFecha(c.fecha_creacion)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
