'use client'
import { useCallback, useEffect, useState } from 'react'
import { formatDate, daysSince } from '@/lib/dates'
import { Modal } from '@/components/ui/Modal'

type Cliente = {
  id: string; codigo: string; nombre_mascota: string; nombre_tutor: string
  especie: string; estado: string
  fecha_retiro?: string; fecha_creacion?: string; fecha_defuncion?: string
  ciclo_id?: string; despacho_id?: string
  peso_declarado?: string; peso_ingreso?: string
  direccion_retiro?: string; direccion_despacho?: string; comuna?: string
  telefono?: string; tipo_servicio?: string; codigo_servicio?: string
}

type Ciclo = { id: string; fecha: string; numero_ciclo: string }

export default function TimelineStatus() {
  const [clientes, setClientes] = useState<Cliente[]>([])
  const [ciclos, setCiclos] = useState<Record<string, Ciclo>>({})
  const [buscar, setBuscar] = useState('')
  const [seleccionado, setSeleccionado] = useState<Cliente | null>(null)

  const fetchAll = useCallback(async () => {
    const [c, cic] = await Promise.all([
      fetch('/api/clientes').then(r => r.json()),
      fetch('/api/ciclos').then(r => r.json()),
    ])
    setClientes(Array.isArray(c) ? c : [])
    const cicMap: Record<string, Ciclo> = {}
    if (Array.isArray(cic)) cic.forEach((x: Ciclo) => { cicMap[x.id] = x })
    setCiclos(cicMap)
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll])

  const q = buscar.trim().toLowerCase()
  function match(c: Cliente): boolean {
    if (!q) return true
    return (
      c.nombre_mascota?.toLowerCase().includes(q) ||
      c.nombre_tutor?.toLowerCase().includes(q) ||
      c.codigo?.toLowerCase().includes(q) ||
      c.especie?.toLowerCase().includes(q)
    )
  }

  // Estado vacío también cuenta como "en cámara" (mascotas viejas sin estado).
  const enCamara = clientes.filter(c => (c.estado === 'pendiente' || !c.estado) && match(c))
  // "Cremadas" = pendientes de despacho. Excluimos SD (Sin Devolución) — esas terminan
  // su flujo en cremado, no van a recorrido de despacho.
  const cremadas = clientes.filter(c =>
    c.estado === 'cremado' && c.codigo_servicio !== 'SD' && match(c)
  )

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-gray-900">Timeline Status</h2>
        <input
          type="text"
          placeholder="Buscar en todas las columnas..."
          value={buscar}
          onChange={e => setBuscar(e.target.value)}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 w-64"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Columna
          title="En cámara" count={enCamara.length} accent="amber"
          renderCard={c => {
            const fecha = c.fecha_retiro || c.fecha_creacion
            const dias = daysSince(fecha)
            return (
              <Card key={c.id} onClick={() => setSeleccionado(c)}>
                <p className="font-mono text-xs text-amber-700 font-semibold">{c.codigo}</p>
                <p className="text-sm font-medium text-gray-900 truncate mt-0.5">{c.nombre_mascota}</p>
                <p className="text-xs text-gray-500 truncate">{c.especie}</p>
                <p className="text-xs text-gray-400 mt-1">
                  Retiro: {formatDate(fecha)}
                  {dias !== null && dias >= 0 && <span> · hace {dias} {dias === 1 ? 'día' : 'días'}</span>}
                </p>
              </Card>
            )
          }}
          items={enCamara}
        />

        <Columna
          title="Cremadas" count={cremadas.length} accent="emerald"
          renderCard={c => {
            const ciclo = c.ciclo_id ? ciclos[c.ciclo_id] : null
            const fecha = ciclo?.fecha
            const dias = fecha ? daysSince(fecha) : null
            return (
              <Card key={c.id} onClick={() => setSeleccionado(c)}>
                <p className="font-mono text-xs text-emerald-700 font-semibold">{c.codigo}</p>
                <p className="text-sm font-medium text-gray-900 truncate mt-0.5">{c.nombre_mascota}</p>
                <p className="text-xs text-gray-500 truncate">{c.especie}</p>
                <p className="text-xs text-gray-400 mt-1">
                  {fecha ? `Cremada: ${formatDate(fecha)}` : 'Sin fecha de ciclo'}
                  {dias !== null && dias >= 0 && <span> · hace {dias} {dias === 1 ? 'día' : 'días'}</span>}
                </p>
              </Card>
            )
          }}
          items={cremadas}
        />

      </div>

      <Modal open={!!seleccionado} onClose={() => setSeleccionado(null)} title={`Ficha — ${seleccionado?.nombre_mascota ?? ''}`}>
        {seleccionado && (
          <div className="space-y-3 text-sm">
            <FichaRow label="Código" value={seleccionado.codigo} />
            <FichaRow label="Mascota" value={seleccionado.nombre_mascota} />
            <FichaRow label="Especie" value={seleccionado.especie} />
            <FichaRow label="Tutor" value={seleccionado.nombre_tutor} />
            <FichaRow label="Teléfono" value={seleccionado.telefono ?? '—'} />
            <FichaRow label="Servicio" value={`${seleccionado.tipo_servicio ?? ''} (${seleccionado.codigo_servicio ?? ''})`} />
            <FichaRow label="Peso declarado" value={seleccionado.peso_declarado || '—'} />
            <FichaRow label="Peso ingreso" value={seleccionado.peso_ingreso || '—'} />
            <FichaRow label="Fecha retiro" value={formatDate(seleccionado.fecha_retiro)} />
            <FichaRow label="Dirección retiro" value={seleccionado.direccion_retiro ?? '—'} />
            <FichaRow label="Dirección despacho" value={seleccionado.direccion_despacho ?? '—'} />
            <FichaRow label="Comuna" value={seleccionado.comuna ?? '—'} />
            <FichaRow label="Estado" value={seleccionado.estado} />
          </div>
        )}
      </Modal>
    </div>
  )
}

function Columna({ title, count, accent, items, renderCard }: {
  title: string; count: number; accent: 'amber' | 'emerald'
  items: Cliente[]
  renderCard: (c: Cliente) => React.ReactNode
}) {
  const accentHeader = accent === 'amber'
    ? 'bg-amber-50 border-amber-200 text-amber-900'
    : 'bg-emerald-50 border-emerald-200 text-emerald-900'
  const badge = accent === 'amber' ? 'bg-amber-500' : 'bg-emerald-500'
  return (
    <div className="bg-white rounded-xl border border-gray-100 overflow-hidden flex flex-col">
      <div className={`px-4 py-3 border-b ${accentHeader} flex items-center justify-between`}>
        <h3 className="text-sm font-semibold">{title}</h3>
        <span className={`${badge} text-white text-xs font-bold px-2 py-0.5 rounded-full`}>{count}</span>
      </div>
      <div className="p-3 space-y-2 max-h-64 overflow-y-auto">
        {items.length === 0 ? (
          <p className="text-xs text-gray-400 text-center py-4">Sin registros</p>
        ) : items.map(renderCard)}
      </div>
    </div>
  )
}

function Card({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left bg-gray-50 hover:bg-gray-100 border border-gray-100 rounded-lg p-3 transition-colors"
    >
      {children}
    </button>
  )
}

function FichaRow({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex justify-between border-b border-gray-100 pb-1.5">
      <span className="text-xs text-gray-500">{label}</span>
      <span className="text-sm text-gray-900 font-medium">{value}</span>
    </div>
  )
}
