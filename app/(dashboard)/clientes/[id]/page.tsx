'use client'
import { useState, useEffect, use, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { fmtLitros, fmtPrecio, fmtFecha } from '@/lib/format'
import { formatDateForSheet } from '@/lib/dates'

type AdicionalItem = { tipo: 'producto' | 'servicio'; id: string; nombre: string; precio: number; qty: number }

type ClienteDetalle = {
  id: string
  codigo: string
  nombre_mascota: string
  nombre_tutor: string
  email: string
  telefono: string
  direccion_retiro: string
  direccion_despacho: string
  misma_direccion: string
  comuna: string
  fecha_retiro: string
  especie: string
  letra_especie: string
  peso_declarado: string
  peso_ingreso: string
  despacho_id: string
  tipo_servicio: string
  codigo_servicio: string
  estado: string
  ciclo_id: string
  veterinaria_id: string
  tipo_precios: string
  adicionales: string
  fecha_creacion: string
  fecha_defuncion: string
  notas: string
  tipo_pago: string
  estado_pago: string
  ciclo?: {
    id: string
    fecha: string
    numero_ciclo: string
    litros_inicio: string
    litros_fin: string
    comentarios: string
  } | null
}

type Veterinario = { id: string; nombre: string; activo: string; tipo_precios: string }
type Producto = { id: string; nombre: string; precio: string; stock: string; activo: string }
type OtroServicio = { id: string; nombre: string; precio: string; activo: string }
type Tramo = { id: string; peso_min: string; peso_max: string; precio_ci: string; precio_cp: string; precio_sd: string }
type TramoEspecial = Tramo & { veterinaria_id: string }

export default function ClienteDetallePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const [cliente, setCliente] = useState<ClienteDetalle | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [descargandoCert, setDescargandoCert] = useState(false)
  const [showCertModal, setShowCertModal] = useState(false)
  const [certFoto, setCertFoto] = useState<File | null>(null)
  const [certSinFoto, setCertSinFoto] = useState(false)
  const [certError, setCertError] = useState('')
  const certInputRef = useRef<HTMLInputElement>(null)
  const [form, setForm] = useState<Partial<ClienteDetalle>>({})
  const [veterinarias, setVeterinarias] = useState<Veterinario[]>([])
  const [esVeterinaria, setEsVeterinaria] = useState(false)
  const [tramosEspeciales, setTramosEspeciales] = useState<TramoEspecial[]>([])
  const [preciosGenerales, setPreciosGenerales] = useState<Tramo[]>([])
  const [preciosConvenio, setPreciosConvenio] = useState<Tramo[]>([])

  // Adicionales
  const [showAdicionales, setShowAdicionales] = useState(false)
  const [adicionales, setAdicionales] = useState<AdicionalItem[]>([])
  const [productosDisp, setProductosDisp] = useState<Producto[]>([])
  const [otrosServicios, setOtrosServicios] = useState<OtroServicio[]>([])

  useEffect(() => {
    fetch(`/api/clientes/${id}`)
      .then(r => r.json())
      .then(d => {
        // Normalizar fechas: el sheet las devuelve como serial Excel (ej. "46141"),
        // pero los <input type="date"> requieren formato "YYYY-MM-DD" para mostrarlas.
        const normalized = {
          ...d,
          fecha_retiro: formatDateForSheet(d.fecha_retiro) || d.fecha_retiro || '',
          fecha_defuncion: formatDateForSheet(d.fecha_defuncion) || d.fecha_defuncion || '',
          fecha_creacion: formatDateForSheet(d.fecha_creacion) || d.fecha_creacion || '',
        }
        setCliente(normalized)
        setForm(normalized)
        if (d.veterinaria_id) setEsVeterinaria(true)
        if (d.adicionales) {
          try { setAdicionales(JSON.parse(d.adicionales)) } catch {}
        }
        setLoading(false)
      })
    fetch('/api/veterinarios?activo=true')
      .then(r => r.json())
      .then(d => setVeterinarias(Array.isArray(d) ? d : []))
    fetch('/api/productos')
      .then(r => r.json())
      .then(d => {
        if (!Array.isArray(d)) return setProductosDisp([])
        // Deduplicar por id: si hay duplicados en la planilla, el toggle se "contagia"
        // a los hermanos y los activa/desactiva todos juntos. Nos quedamos con el primero.
        const vistos = new Set<string>()
        const unicos = d.filter((p: Producto) => p.activo === 'TRUE' && !vistos.has(p.id) && (vistos.add(p.id), true))
        setProductosDisp(unicos)
      })
    fetch('/api/servicios?tipo=otros')
      .then(r => r.json())
      .then(d => {
        if (!Array.isArray(d)) return setOtrosServicios([])
        const vistos = new Set<string>()
        const unicos = d.filter((s: OtroServicio) => s.activo === 'TRUE' && !vistos.has(s.id) && (vistos.add(s.id), true))
        setOtrosServicios(unicos)
      })
    fetch('/api/precios?tipo=general')
      .then(r => r.json())
      .then(d => setPreciosGenerales(Array.isArray(d) ? d : []))
    fetch('/api/precios?tipo=convenio')
      .then(r => r.json())
      .then(d => setPreciosConvenio(Array.isArray(d) ? d : []))
  }, [id])

  // Load special pricing when vet changes
  useEffect(() => {
    const vetId = form.veterinaria_id
    if (!vetId) { setTramosEspeciales([]); return }
    const vet = veterinarias.find(v => v.id === vetId)
    if (vet?.tipo_precios === 'precios_especiales') {
      fetch(`/api/precios/especiales?veterinaria_id=${vetId}`)
        .then(r => r.json())
        .then(d => setTramosEspeciales(Array.isArray(d) ? d : []))
    } else {
      setTramosEspeciales([])
    }
  }, [form.veterinaria_id, veterinarias])

  // Auto-set tipo_precios when vet is selected
  useEffect(() => {
    if (!form.veterinaria_id) {
      setForm(f => ({ ...f, tipo_precios: 'general' }))
      return
    }
    const vet = veterinarias.find(v => v.id === form.veterinaria_id)
    if (vet) {
      setForm(f => ({ ...f, tipo_precios: vet.tipo_precios === 'precios_especiales' ? 'especial' : 'convenio' }))
    }
  }, [form.veterinaria_id, veterinarias])

  function abrirModalCertificado() {
    setCertFoto(null)
    setCertSinFoto(false)
    setCertError('')
    setShowCertModal(true)
  }

  async function generarCertificado(e: React.FormEvent) {
    e.preventDefault()
    setCertError('')
    if (!certSinFoto && !certFoto) {
      setCertError('Subí una foto o tildá "Generar sin foto"')
      return
    }
    setDescargandoCert(true)
    try {
      const fd = new FormData()
      fd.append('sin_foto', certSinFoto ? 'true' : 'false')
      if (!certSinFoto && certFoto) fd.append('foto', certFoto)

      const res = await fetch(`/api/clientes/${id}/certificado`, { method: 'POST', body: fd })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        setCertError(err.error ?? 'Error generando el certificado')
        return
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `Certificado_${cliente?.nombre_mascota ?? id}_${cliente?.codigo ?? id}.pdf`
      a.click()
      URL.revokeObjectURL(url)
      setShowCertModal(false)
    } finally {
      setDescargandoCert(false)
    }
  }

  async function handleSave() {
    setSaving(true)
    const payload = {
      ...form,
      veterinaria_id: esVeterinaria ? (form.veterinaria_id ?? '') : '',
      tipo_precios: esVeterinaria ? form.tipo_precios : 'general',
      adicionales: JSON.stringify(adicionales),
    }
    const res = await fetch(`/api/clientes/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (res.ok) {
      const updated = await res.json()
      setCliente(updated)
    }
    setSaving(false)
  }

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

  if (loading) return <div className="p-8 text-gray-400 text-sm">Cargando...</div>
  if (!cliente) return <div className="p-8 text-gray-400 text-sm">Cliente no encontrado</div>

  const litrosUsados = cliente.ciclo
    ? Math.abs(parseFloat(cliente.ciclo.litros_fin) - parseFloat(cliente.ciclo.litros_inicio))
    : null

  const vetSeleccionada = veterinarias.find(v => v.id === cliente.veterinaria_id)
  const totalAdicionales = adicionales.reduce((sum, a) => sum + a.precio * a.qty, 0)

  // Resolver tabla de precios según tipo_precios del formulario
  const tablaPrecios: Tramo[] = form.tipo_precios === 'especial'
    ? tramosEspeciales
    : form.tipo_precios === 'convenio'
      ? preciosConvenio
      : preciosGenerales
  const tablaNombre = form.tipo_precios === 'especial'
    ? 'Precios especiales'
    : form.tipo_precios === 'convenio'
      ? 'Precios convenio'
      : 'Precios generales'

  // Encontrar tramo para el peso dado
  function encontrarTramo(tabla: Tramo[], pesoKg: number): Tramo | null {
    if (!tabla.length || !isFinite(pesoKg) || pesoKg <= 0) return null
    const maxPesoMin = Math.max(...tabla.map(t => parseFloat(t.peso_min) || 0))
    const tramoTope = tabla.find(t => (parseFloat(t.peso_min) || 0) === maxPesoMin)
    if (tramoTope && pesoKg >= maxPesoMin) return tramoTope
    return tabla.find(t => {
      const min = parseFloat(t.peso_min) || 0
      const max = parseFloat(t.peso_max) || 0
      return pesoKg >= min && pesoKg <= max
    }) ?? null
  }

  // Preferir peso_ingreso (real) sobre peso_declarado para el cálculo del servicio
  const pesoIngreso = parseFloat(form.peso_ingreso || '') || 0
  const pesoDeclarado = parseFloat(form.peso_declarado || '') || 0
  const pesoKg = pesoIngreso > 0 ? pesoIngreso : pesoDeclarado
  const tramoAplicable = encontrarTramo(tablaPrecios, pesoKg)
  const codigoServ = form.codigo_servicio ?? 'CI'
  const precioServicio = tramoAplicable
    ? parseFloat(
        codigoServ === 'CI' ? tramoAplicable.precio_ci :
        codigoServ === 'CP' ? tramoAplicable.precio_cp :
        tramoAplicable.precio_sd
      ) || 0
    : 0
  const totalServicio = precioServicio + totalAdicionales

  const rangoTramo = tramoAplicable
    ? (() => {
        const maxPesoMin = Math.max(...tablaPrecios.map(t => parseFloat(t.peso_min) || 0))
        const min = parseFloat(tramoAplicable.peso_min) || 0
        return min === maxPesoMin ? `${min} kg o más` : `${tramoAplicable.peso_min} – ${tramoAplicable.peso_max} kg`
      })()
    : null

  // Price type options based on selected vet
  const precioOptions = (() => {
    if (!esVeterinaria || !form.veterinaria_id) return [{ value: 'general', label: 'Precios generales' }]
    const vet = veterinarias.find(v => v.id === form.veterinaria_id)
    const opts = [
      { value: 'general', label: 'Precios generales' },
      { value: 'convenio', label: 'Precios convenio' },
    ]
    if (vet?.tipo_precios === 'precios_especiales') {
      opts.push({ value: 'especial', label: 'Precios especiales' })
    }
    return opts
  })()

  return (
    <div className="max-w-3xl">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => router.back()}
          className="bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-1"
          title="Volver">
          <span className="text-base">←</span>
          <span>Volver</span>
        </button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-gray-900">{cliente.nombre_mascota}</h1>
          <div className="flex items-center gap-2 mt-1">
            <span className="font-mono text-xs text-indigo-700 font-semibold bg-indigo-50 px-2 py-0.5 rounded">{cliente.codigo}</span>
            <Badge variant={cliente.estado === 'cremado' ? 'green' : 'yellow'}>{cliente.estado}</Badge>
            {vetSeleccionada && <Badge variant="blue">{vetSeleccionada.nombre}</Badge>}
          </div>
        </div>
        {cliente.estado === 'cremado' && (
          <button
            onClick={abrirModalCertificado}
            disabled={descargandoCert}
            className="flex items-center gap-2 bg-amber-600 hover:bg-amber-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
          >
            📄 Certificado PDF
          </button>
        )}
      </div>

      {/* Proceso de cremación — al principio para ver estado primero */}
      <div className="bg-white rounded-xl shadow-md border-2 border-gray-200 p-6 mb-6">
        <h2 className="text-base font-bold text-gray-900 mb-4">Proceso de cremación</h2>
        {cliente.ciclo ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <InfoField label="Fecha del ciclo" value={fmtFecha(cliente.ciclo.fecha)} />
            <InfoField label="Número de ciclo" value={`N° ${cliente.ciclo.numero_ciclo}`} />
            <InfoField label="Litros utilizados" value={litrosUsados !== null ? fmtLitros(litrosUsados) : '—'} />
            <InfoField label="Comentarios" value={cliente.ciclo.comentarios || '—'} />
          </div>
        ) : (
          <div className="flex items-center gap-3 text-yellow-800 bg-yellow-50 border-2 border-yellow-300 rounded-lg px-4 py-3 text-sm font-medium">
            <span>⏳</span>
            <span>Pendiente de cremación — aún no asignada a ningún ciclo.</span>
          </div>
        )}
      </div>

      {/* Datos de ingreso */}
      <div className="bg-white rounded-xl shadow-md border-2 border-gray-200 p-6 mb-6">
        <h2 className="text-base font-bold text-gray-900 mb-4">Datos de ingreso</h2>
        <div className="grid grid-cols-2 gap-4">
          <Field required label="Nombre mascota" value={form.nombre_mascota} onChange={v => setForm(f => ({ ...f, nombre_mascota: v }))} />
          <Field required label="Nombre tutor" value={form.nombre_tutor} onChange={v => setForm(f => ({ ...f, nombre_tutor: v }))} />
          <Field required type="email" label="Email" value={form.email} onChange={v => setForm(f => ({ ...f, email: v }))} />
          <Field required type="tel" label="Teléfono" value={form.telefono} onChange={v => setForm(f => ({ ...f, telefono: v }))} />
          <Field required label="Dirección de retiro" value={form.direccion_retiro} onChange={v => setForm(f => ({ ...f, direccion_retiro: v }))} />
          <Field required label="Dirección de despacho" value={form.direccion_despacho} onChange={v => setForm(f => ({ ...f, direccion_despacho: v }))} />
          <Field required label="Comuna" value={form.comuna} onChange={v => setForm(f => ({ ...f, comuna: v }))} />
          <Field required label="Fecha de retiro" type="date" value={form.fecha_retiro} onChange={v => setForm(f => ({ ...f, fecha_retiro: v }))} />
          <Field label="Fecha de defunción" type="date" value={form.fecha_defuncion} onChange={v => setForm(f => ({ ...f, fecha_defuncion: v }))} />
          <Field required label="Especie" value={form.especie} onChange={v => setForm(f => ({ ...f, especie: v }))} />
          <Field required label="Peso declarado (kg)" type="number" step="0.1" value={form.peso_declarado} onChange={v => setForm(f => ({ ...f, peso_declarado: v }))} />
          <PesoIngresoField
            value={form.peso_ingreso ?? ''}
            onChange={v => setForm(f => ({ ...f, peso_ingreso: v }))}
            pesoDeclarado={parseFloat(form.peso_declarado || '0') || 0}
            tabla={tablaPrecios}
            codigoServ={form.codigo_servicio ?? 'CI'}
          />
          <div className="col-span-2">
            <label className="text-xs font-semibold text-gray-700">
              Tipo de servicio <span className="text-red-500">*</span>
            </label>
            <select
              value={form.codigo_servicio}
              required
              onChange={e => setForm(f => ({ ...f, codigo_servicio: e.target.value }))}
              className="mt-1 w-full border-2 border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="CI">Cremación Individual (CI)</option>
              <option value="CP">Cremación Premium (CP)</option>
              <option value="SD">Cremación Sin Devolución (SD)</option>
            </select>
          </div>
        </div>

        {/* Veterinaria */}
        <div className="mt-5 pt-5 border-t border-gray-100">
          <label className="flex items-center gap-3 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={esVeterinaria}
              onChange={e => {
                setEsVeterinaria(e.target.checked)
                if (!e.target.checked) setForm(f => ({ ...f, veterinaria_id: '', tipo_precios: 'general' }))
              }}
              className="w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
            />
            <span className="text-sm font-medium text-gray-700">Cliente Veterinaria</span>
          </label>

          {esVeterinaria && (
            <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-gray-500">Veterinaria</label>
                <select
                  value={form.veterinaria_id ?? ''}
                  onChange={e => setForm(f => ({ ...f, veterinaria_id: e.target.value }))}
                  className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="">Seleccionar veterinaria...</option>
                  {veterinarias.map(v => (
                    <option key={v.id} value={v.id}>{v.nombre}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500">Tipo de precios</label>
                <select
                  value={form.tipo_precios ?? 'general'}
                  onChange={e => setForm(f => ({ ...f, tipo_precios: e.target.value }))}
                  className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  {precioOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                {tramosEspeciales.length > 0 && (
                  <p className="text-xs text-purple-600 mt-1">{tramosEspeciales.length} tramo(s) especiales cargados</p>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Pago */}
        <div className="mt-5 pt-5 border-t-2 border-gray-200">
          <p className="text-sm font-bold text-gray-900 mb-3">Pago</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-gray-700">
                Tipo de pago <span className="text-red-500">*</span>
              </label>
              <select
                value={form.tipo_pago ?? ''}
                required
                onChange={e => setForm(f => ({ ...f, tipo_pago: e.target.value }))}
                className={`mt-1 w-full border-2 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 ${
                  !form.tipo_pago ? 'border-red-300 bg-red-50' : 'border-gray-300'
                }`}
              >
                <option value="">—</option>
                <option value="transferencia">Transferencia</option>
                <option value="pos">POS</option>
                <option value="efectivo">Efectivo</option>
                <option value="link">Link de pago</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-700">
                Estado de pago <span className="text-red-500">*</span>
              </label>
              <select
                value={form.estado_pago ?? 'pendiente'}
                required
                onChange={e => setForm(f => ({ ...f, estado_pago: e.target.value }))}
                className="mt-1 w-full border-2 border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="pendiente">Pendiente de pago</option>
                <option value="pagado">Pagado</option>
              </select>
            </div>
          </div>
        </div>

        {/* Notas */}
        <div className="mt-5 pt-5 border-t border-gray-100">
          <label className="text-sm font-semibold text-gray-900">Notas</label>
          <textarea
            value={form.notas ?? ''}
            onChange={e => setForm(f => ({ ...f, notas: e.target.value }))}
            rows={3}
            placeholder="Comentarios sobre el servicio, la mascota o el tutor..."
            className="mt-2 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
          />
        </div>

        <div className="flex justify-end mt-5">
          <button
            onClick={handleSave}
            disabled={saving}
            className="bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
          >
            {saving ? 'Guardando...' : 'Guardar cambios'}
          </button>
        </div>
      </div>

      {/* Adicionales */}
      <div className="bg-white rounded-xl shadow-md border-2 border-gray-200 mb-6 overflow-hidden">
        <button
          onClick={() => setShowAdicionales(!showAdicionales)}
          className="w-full flex items-center justify-between px-6 py-4 hover:bg-gray-50 transition-colors"
        >
          <div className="flex items-center gap-3">
            <h2 className="text-base font-semibold text-gray-900">Adicionales</h2>
            {adicionales.length > 0 && (
              <span className="bg-indigo-100 text-indigo-700 text-xs font-semibold px-2 py-0.5 rounded-full">
                {adicionales.length} ítem(s) · {fmtPrecio(totalAdicionales)}
              </span>
            )}
          </div>
          <span className="text-gray-400 text-sm">{showAdicionales ? '▲' : '▼'}</span>
        </button>

        {showAdicionales && (
          <div className="border-t border-gray-100 px-6 pb-6 pt-4">
            {/* Productos */}
            {productosDisp.length > 0 && (
              <div className="mb-6">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Productos y ánforas</p>
                <div className="space-y-2">
                  {productosDisp.map(p => {
                    const item = adicionales.find(a => a.tipo === 'producto' && a.id === p.id)
                    const stockNum = parseInt(p.stock || '0')
                    return (
                      <div key={p.id} className="flex items-center gap-3 py-1.5">
                        <input
                          type="checkbox"
                          checked={!!item}
                          onChange={() => toggleAdicional('producto', p)}
                          className="w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                        />
                        <span className="flex-1 text-sm text-gray-900">{p.nombre}</span>
                        <span className="text-xs text-gray-500">{fmtPrecio(p.precio)}</span>
                        {stockNum < 50 && <span className="text-xs text-red-500 font-medium">⚠ stock: {stockNum}</span>}
                        {item && (
                          <input
                            type="number"
                            min={1}
                            value={item.qty}
                            onChange={e => updateQty('producto', p.id, parseInt(e.target.value) || 1)}
                            className="w-16 border border-gray-200 rounded px-2 py-1 text-sm text-center focus:outline-none focus:ring-2 focus:ring-indigo-500"
                          />
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Otros servicios */}
            {otrosServicios.length > 0 && (
              <div className="mb-4">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Otros servicios</p>
                <div className="space-y-2">
                  {otrosServicios.map(s => {
                    const item = adicionales.find(a => a.tipo === 'servicio' && a.id === s.id)
                    return (
                      <div key={s.id} className="flex items-center gap-3 py-1.5">
                        <input
                          type="checkbox"
                          checked={!!item}
                          onChange={() => toggleAdicional('servicio', s)}
                          className="w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                        />
                        <span className="flex-1 text-sm text-gray-900">{s.nombre}</span>
                        <span className="text-xs text-gray-500">{fmtPrecio(s.precio)}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {adicionales.length > 0 && (
              <div className="mt-4 pt-4 border-t border-gray-100 flex justify-between items-center">
                <span className="text-sm text-gray-600">{adicionales.length} ítem(s) seleccionado(s)</span>
                <span className="font-semibold text-gray-900">{fmtPrecio(totalAdicionales)}</span>
              </div>
            )}

            {productosDisp.length === 0 && otrosServicios.length === 0 && (
              <p className="text-sm text-gray-400 text-center py-4">Sin productos ni servicios adicionales activos</p>
            )}

            <div className="flex justify-end mt-4">
              <button
                onClick={handleSave}
                disabled={saving}
                className="bg-indigo-600 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
              >
                {saving ? 'Guardando...' : 'Guardar adicionales'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Resumen del servicio */}
      <div className="bg-white rounded-xl shadow-md border-2 border-gray-200 p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-gray-900">Resumen del servicio</h2>
          <span className="text-xs text-gray-400">{tablaNombre}</span>
        </div>

        <div className="space-y-2.5">
          <div className="flex items-start justify-between py-2 border-b border-gray-100">
            <div className="flex-1">
              <p className="text-sm font-medium text-gray-900">
                Cremación {codigoServ}
                {rangoTramo && <span className="text-gray-500 font-normal"> · {rangoTramo}</span>}
              </p>
              <p className="text-xs text-gray-500 mt-0.5">
                {pesoKg > 0 ? `${pesoKg} kg` : 'Ingresa el peso para calcular'}
                {pesoKg > 0 && !tramoAplicable && (
                  <span className="text-red-500 ml-2">⚠ Sin tramo de precio aplicable</span>
                )}
              </p>
            </div>
            <p className="text-sm font-semibold text-gray-900">{fmtPrecio(precioServicio)}</p>
          </div>

          {adicionales.length > 0 && (
            <>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide pt-2">Adicionales</p>
              {adicionales.map(a => (
                <div key={`${a.tipo}-${a.id}`} className="flex items-center justify-between py-1">
                  <p className="text-sm text-gray-700">
                    {a.nombre}
                    {a.qty > 1 && <span className="text-gray-400"> × {a.qty}</span>}
                  </p>
                  <p className="text-sm text-gray-700">{fmtPrecio(a.precio * a.qty)}</p>
                </div>
              ))}
              <div className="flex items-center justify-between py-1 border-t border-gray-100 pt-2">
                <p className="text-xs text-gray-500">Subtotal adicionales</p>
                <p className="text-sm font-medium text-gray-700">{fmtPrecio(totalAdicionales)}</p>
              </div>
            </>
          )}

          <div className="flex items-center justify-between pt-3 mt-2 border-t-2 border-gray-200">
            <p className="text-base font-bold text-gray-900">Total</p>
            <p className="text-lg font-bold text-indigo-700">{fmtPrecio(totalServicio)}</p>
          </div>
        </div>
      </div>

      {/* Modal generar certificado */}
      <Modal open={showCertModal} onClose={() => setShowCertModal(false)} title="Generar certificado de cremación">
        <form onSubmit={generarCertificado} className="space-y-4">
          <div className="text-sm text-gray-600">
            Mascota: <b>{cliente.nombre_mascota}</b> · {cliente.codigo}
          </div>

          {!certSinFoto && (
            <div>
              <label className="text-xs font-semibold text-gray-700">Foto de la mascota (jpg/png)</label>
              <div className="mt-1 flex items-center gap-3">
                <input
                  ref={certInputRef}
                  type="file"
                  accept="image/jpeg,image/jpg,image/png"
                  onChange={e => setCertFoto(e.target.files?.[0] ?? null)}
                  className="hidden"
                />
                <button type="button" onClick={() => certInputRef.current?.click()}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-semibold shadow-md transition-colors">
                  📷 Subir foto
                </button>
                {certFoto ? (
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <span className="text-xs text-gray-700 truncate">{certFoto.name}</span>
                    <button type="button" onClick={() => setCertFoto(null)}
                      className="text-xs text-red-600 hover:text-red-800 font-semibold">Quitar</button>
                  </div>
                ) : (
                  <span className="text-xs text-gray-400">Ninguna foto seleccionada</span>
                )}
              </div>
            </div>
          )}

          <div className="flex items-center gap-2 pt-1 border-t-2 border-gray-100">
            <input
              type="checkbox"
              id="cert-sin-foto"
              checked={certSinFoto}
              onChange={e => { setCertSinFoto(e.target.checked); if (e.target.checked) setCertFoto(null) }}
              className="w-4 h-4 rounded border-gray-400 text-indigo-600 focus:ring-indigo-500"
            />
            <label htmlFor="cert-sin-foto" className="text-sm font-medium text-gray-700">
              Generar sin foto
            </label>
          </div>

          {certError && (
            <p className="text-xs text-red-700 bg-red-50 border-2 border-red-200 rounded-lg p-2">{certError}</p>
          )}

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={() => setShowCertModal(false)}
              className="flex-1 border-2 border-gray-300 text-gray-700 rounded-lg py-2 text-sm font-semibold hover:bg-gray-50 transition-colors">
              Cancelar
            </button>
            <button type="submit" disabled={descargandoCert}
              className="flex-1 bg-amber-600 hover:bg-amber-700 text-white rounded-lg py-2 text-sm font-semibold shadow-md transition-colors disabled:opacity-50">
              {descargandoCert ? '⏳ Generando...' : '📄 Generar PDF'}
            </button>
          </div>
        </form>
      </Modal>

    </div>
  )
}

function Field({ label, value, onChange, type = 'text', step, required, placeholder }: {
  label: string; value?: string; onChange: (v: string) => void
  type?: string; step?: string; required?: boolean; placeholder?: string
}) {
  const faltante = required && !String(value ?? '').trim()
  return (
    <div>
      <label className="text-xs font-semibold text-gray-700">
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      <input
        type={type}
        step={step}
        value={value ?? ''}
        required={required}
        placeholder={placeholder}
        onChange={e => onChange(e.target.value)}
        className={`mt-1 w-full border-2 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 ${
          faltante ? 'border-red-300 bg-red-50' : 'border-gray-300'
        }`}
      />
    </div>
  )
}

function PesoIngresoField({ value, onChange, pesoDeclarado, tabla, codigoServ }: {
  value: string
  onChange: (v: string) => void
  pesoDeclarado: number
  tabla: Tramo[]
  codigoServ: string
}) {
  const pesoIngreso = parseFloat(value) || 0

  function findTramo(peso: number): Tramo | null {
    if (!tabla.length || peso <= 0) return null
    const maxMin = Math.max(...tabla.map(t => parseFloat(t.peso_min) || 0))
    const top = tabla.find(t => (parseFloat(t.peso_min) || 0) === maxMin)
    if (top && peso >= maxMin) return top
    return tabla.find(t => {
      const min = parseFloat(t.peso_min) || 0
      const max = parseFloat(t.peso_max) || 0
      return peso >= min && peso <= max
    }) ?? null
  }

  function precioTramo(tr: Tramo | null): number {
    if (!tr) return 0
    const raw = codigoServ === 'CP' ? tr.precio_cp : codigoServ === 'SD' ? tr.precio_sd : tr.precio_ci
    return parseFloat(raw) || 0
  }

  type Feedback =
    | { kind: 'alerta'; diff: number }
    | { kind: 'igual' }
    | { kind: 'menor'; diff: number }
    | null

  let feedback: Feedback = null
  if (pesoIngreso > 0 && pesoDeclarado > 0 && tabla.length > 0) {
    const tramoDecl = findTramo(pesoDeclarado)
    const tramoIng = findTramo(pesoIngreso)
    if (tramoDecl && tramoIng) {
      const pDecl = precioTramo(tramoDecl)
      const pIng = precioTramo(tramoIng)
      if (tramoIng.id === tramoDecl.id) {
        feedback = { kind: 'igual' }
      } else if (pIng > pDecl) {
        feedback = { kind: 'alerta', diff: pIng - pDecl }
      } else if (pIng < pDecl) {
        feedback = { kind: 'menor', diff: pDecl - pIng }
      }
    }
  }

  const isAlerta = feedback?.kind === 'alerta'

  return (
    <div>
      <label className="text-xs font-medium text-gray-500">Peso ingreso (kg)</label>
      <div className="relative">
        <input
          type="number"
          step="0.1"
          value={value}
          onChange={e => onChange(e.target.value)}
          className={`mt-1 w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 ${
            isAlerta ? 'border-amber-400 bg-amber-50 focus:ring-amber-500' : 'border-gray-200 focus:ring-indigo-500'
          }`}
        />
        {isAlerta && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-amber-600 text-lg leading-none pointer-events-none">⚠</span>
        )}
      </div>
      {feedback?.kind === 'alerta' && (
        <div className="mt-2 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <span className="text-amber-600 shrink-0">⚠</span>
          <div>
            <p className="font-medium">Cobro adicional pendiente: el peso real supera el tramo declarado.</p>
            <p className="mt-0.5">Diferencia a cobrar: <span className="font-bold">{fmtPrecio(feedback.diff)}</span></p>
          </div>
        </div>
      )}
      {feedback?.kind === 'igual' && (
        <p className="mt-1 text-xs text-gray-500">✓ Mismo tramo que el peso declarado — no hay cobro adicional.</p>
      )}
      {feedback?.kind === 'menor' && (
        <p className="mt-1 text-xs text-emerald-600">Tramo inferior — ahorro potencial de {fmtPrecio(feedback.diff)}</p>
      )}
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
