'use client'
import { useState, useEffect, useCallback, useMemo } from 'react'
import { Toggle } from '@/components/ui/Toggle'
import { Modal } from '@/components/ui/Modal'
import { Badge } from '@/components/ui/Badge'
import { fmtPrecio } from '@/lib/format'
import { COMUNAS, REGIONES } from '@/lib/comunas'

const TABS = ['Veterinarios', 'Precios'] as const
type Tab = typeof TABS[number]

type Vet = {
  id: string
  nombre: string
  email: string
  telefono: string
  rut: string
  comunas: string
  horarios: string
  activo: string
  origen: string
  notas: string
  total_servicios: string
  fecha_inscripcion: string
  comunas_array?: string[]
  horarios_obj?: Record<string, { am?: boolean; pm?: boolean }>
}

type Tramo = { id: string; peso_min: string; peso_max: string; precio: string }

const DIAS = [
  { key: 'lun', label: 'Lun' },
  { key: 'mar', label: 'Mar' },
  { key: 'mie', label: 'Mié' },
  { key: 'jue', label: 'Jue' },
  { key: 'vie', label: 'Vie' },
  { key: 'sab', label: 'Sáb' },
  { key: 'dom', label: 'Dom' },
] as const

type DiaKey = typeof DIAS[number]['key']
type Horarios = Partial<Record<DiaKey, { am: boolean; pm: boolean }>>

const horariosVacios = (): Horarios => ({})

function vetFormDefault() {
  return {
    nombre: '',
    email: '',
    telefono: '',
    rut: '',
    comunas: [] as string[],
    horarios: horariosVacios(),
    notas: '',
    activo: true,
  }
}

export default function ServiciosEutanasiasPage() {
  const [tab, setTab] = useState<Tab>('Veterinarios')

  // Veterinarios
  const [vets, setVets] = useState<Vet[]>([])
  const [loadingVets, setLoadingVets] = useState(false)
  const [busqueda, setBusqueda] = useState('')
  const [filtroComuna, setFiltroComuna] = useState('')
  const [showVetModal, setShowVetModal] = useState(false)
  const [editingVet, setEditingVet] = useState<Vet | null>(null)
  const [vetForm, setVetForm] = useState(vetFormDefault())
  const [savingVet, setSavingVet] = useState(false)
  const [vetError, setVetError] = useState('')

  const cargarVets = useCallback(async () => {
    setLoadingVets(true)
    try {
      const r = await fetch('/api/eutanasias/vets', { cache: 'no-store' })
      const d = await r.json()
      setVets(Array.isArray(d) ? d : [])
    } finally {
      setLoadingVets(false)
    }
  }, [])

  // Precios
  const [tramos, setTramos] = useState<Tramo[]>([])
  const [showTramoModal, setShowTramoModal] = useState(false)
  const [editingTramo, setEditingTramo] = useState<Tramo | null>(null)
  const [tramoForm, setTramoForm] = useState({ peso_min: '', peso_max: '', precio: '' })
  const [savingTramo, setSavingTramo] = useState(false)
  const [tramoError, setTramoError] = useState('')

  const cargarTramos = useCallback(async () => {
    const r = await fetch('/api/eutanasias/precios', { cache: 'no-store' })
    const d = await r.json()
    setTramos(Array.isArray(d) ? d : [])
  }, [])

  useEffect(() => {
    cargarVets()
    cargarTramos()
  }, [cargarVets, cargarTramos])

  // ─── Vets handlers ─────────────────────────────────────────────────────────
  function abrirNuevoVet() {
    setEditingVet(null)
    setVetForm(vetFormDefault())
    setVetError('')
    setShowVetModal(true)
  }

  function abrirEditarVet(v: Vet) {
    setEditingVet(v)
    let comunasArr: string[] = v.comunas_array ?? []
    let horariosObj: Horarios = {}
    try {
      if (!v.comunas_array && v.comunas) comunasArr = JSON.parse(v.comunas)
    } catch { comunasArr = [] }
    try {
      const raw = v.horarios_obj ?? (v.horarios ? JSON.parse(v.horarios) : {})
      for (const d of DIAS) {
        const x = (raw as Record<string, { am?: boolean; pm?: boolean }>)[d.key]
        if (x && (x.am || x.pm)) horariosObj[d.key] = { am: !!x.am, pm: !!x.pm }
      }
    } catch { horariosObj = {} }
    setVetForm({
      nombre: v.nombre || '',
      email: v.email || '',
      telefono: v.telefono || '',
      rut: v.rut || '',
      comunas: comunasArr,
      horarios: horariosObj,
      notas: v.notas || '',
      activo: v.activo !== 'FALSE',
    })
    setVetError('')
    setShowVetModal(true)
  }

  function toggleHorario(dia: DiaKey, slot: 'am' | 'pm') {
    setVetForm(f => {
      const actual = f.horarios[dia] ?? { am: false, pm: false }
      const nuevo: Horarios = { ...f.horarios, [dia]: { ...actual, [slot]: !actual[slot] } }
      // Si quedó vacío el día, lo removemos
      if (!nuevo[dia]?.am && !nuevo[dia]?.pm) delete nuevo[dia]
      return { ...f, horarios: nuevo }
    })
  }

  function toggleComuna(nombre: string) {
    setVetForm(f => {
      if (f.comunas.includes(nombre)) {
        return { ...f, comunas: f.comunas.filter(c => c !== nombre) }
      }
      return { ...f, comunas: [...f.comunas, nombre] }
    })
  }

  async function guardarVet(e: React.FormEvent) {
    e.preventDefault()
    setVetError('')
    if (!vetForm.nombre.trim()) return setVetError('Nombre obligatorio')
    if (!vetForm.email.trim()) return setVetError('Email obligatorio')
    if (vetForm.comunas.length === 0) return setVetError('Selecciona al menos una comuna')
    if (Object.keys(vetForm.horarios).length === 0) return setVetError('Selecciona al menos un día/horario')

    setSavingVet(true)
    const payload = {
      nombre: vetForm.nombre,
      email: vetForm.email,
      telefono: vetForm.telefono,
      rut: vetForm.rut,
      comunas: vetForm.comunas,
      horarios: vetForm.horarios,
      notas: vetForm.notas,
      activo: vetForm.activo,
    }
    const opts = {
      method: editingVet ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(editingVet ? { id: editingVet.id, ...payload } : payload),
    }
    const r = await fetch('/api/eutanasias/vets', opts)
    if (r.ok) {
      setShowVetModal(false)
      await cargarVets()
    } else {
      const j = await r.json().catch(() => ({}))
      setVetError(j.error || 'Error al guardar')
    }
    setSavingVet(false)
  }

  async function eliminarVet(id: string) {
    if (!confirm('¿Eliminar este veterinario del convenio?')) return
    await fetch(`/api/eutanasias/vets?id=${id}`, { method: 'DELETE' })
    await cargarVets()
  }

  async function toggleActivoVet(v: Vet, val: boolean) {
    await fetch('/api/eutanasias/vets', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: v.id, activo: val }),
    })
    await cargarVets()
  }

  const vetsFiltrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    return vets.filter(v => {
      if (q && !(`${v.nombre} ${v.email} ${v.telefono}`).toLowerCase().includes(q)) return false
      if (filtroComuna) {
        const cs = v.comunas_array ?? safeParseArr(v.comunas)
        if (!cs.includes(filtroComuna)) return false
      }
      return true
    })
  }, [vets, busqueda, filtroComuna])

  // ─── Tramos handlers ───────────────────────────────────────────────────────
  function abrirNuevoTramo() {
    setEditingTramo(null)
    setTramoForm({ peso_min: '', peso_max: '', precio: '' })
    setTramoError('')
    setShowTramoModal(true)
  }

  function abrirEditarTramo(t: Tramo) {
    setEditingTramo(t)
    setTramoForm({ peso_min: t.peso_min, peso_max: t.peso_max, precio: t.precio })
    setTramoError('')
    setShowTramoModal(true)
  }

  async function guardarTramo(e: React.FormEvent) {
    e.preventDefault()
    setTramoError('')
    const pmin = parseFloat(tramoForm.peso_min)
    const pmax = parseFloat(tramoForm.peso_max)
    const precio = parseInt(tramoForm.precio, 10)
    if (isNaN(pmin) || isNaN(pmax) || isNaN(precio)) return setTramoError('Valores inválidos')
    if (pmin >= pmax) return setTramoError('peso_max debe ser mayor que peso_min')
    if (precio < 0) return setTramoError('Precio inválido')

    setSavingTramo(true)
    const opts = {
      method: editingTramo ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(editingTramo
        ? { id: editingTramo.id, peso_min: tramoForm.peso_min, peso_max: tramoForm.peso_max, precio: tramoForm.precio }
        : { peso_min: tramoForm.peso_min, peso_max: tramoForm.peso_max, precio: tramoForm.precio }),
    }
    const r = await fetch('/api/eutanasias/precios', opts)
    if (r.ok) {
      setShowTramoModal(false)
      await cargarTramos()
    } else {
      const j = await r.json().catch(() => ({}))
      setTramoError(j.error || 'Error al guardar')
    }
    setSavingTramo(false)
  }

  async function eliminarTramo(id: string) {
    if (!confirm('¿Eliminar este tramo?')) return
    await fetch(`/api/eutanasias/precios?id=${id}`, { method: 'DELETE' })
    await cargarTramos()
  }

  // ─── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Servicios</h1>
        <p className="text-gray-500 text-sm mt-1">Convenio de eutanasias a domicilio: veterinarios participantes y precios.</p>
      </header>

      <div className="border-b border-gray-200 mb-6">
        <nav className="-mb-px flex gap-6">
          {TABS.map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`pb-3 px-1 text-sm font-medium border-b-2 transition-colors ${
                tab === t ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-gray-500 hover:text-gray-800'
              }`}
            >
              {t}
            </button>
          ))}
        </nav>
      </div>

      {tab === 'Veterinarios' && (
        <section>
          <div className="flex flex-col md:flex-row gap-3 md:items-center justify-between mb-4">
            <div className="flex gap-2 flex-1">
              <input
                type="text"
                value={busqueda}
                onChange={e => setBusqueda(e.target.value)}
                placeholder="Buscar nombre / email / teléfono…"
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm flex-1 max-w-md"
              />
              <select
                value={filtroComuna}
                onChange={e => setFiltroComuna(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
              >
                <option value="">Todas las comunas</option>
                {COMUNAS.map(c => (
                  <option key={c.nombre + c.region} value={c.nombre}>{c.nombre}</option>
                ))}
              </select>
            </div>
            <button
              onClick={abrirNuevoVet}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg"
            >
              + Agregar veterinario
            </button>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            {loadingVets ? (
              <div className="p-8 text-center text-gray-500">Cargando…</div>
            ) : vetsFiltrados.length === 0 ? (
              <div className="p-8 text-center text-gray-500">
                {vets.length === 0 ? 'No hay veterinarios cargados todavía.' : 'No hay coincidencias.'}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                    <tr>
                      <th className="px-3 py-2 text-left">Nombre</th>
                      <th className="px-3 py-2 text-left">Contacto</th>
                      <th className="px-3 py-2 text-left">Comunas</th>
                      <th className="px-3 py-2 text-left">Días</th>
                      <th className="px-3 py-2 text-center">Origen</th>
                      <th className="px-3 py-2 text-center">Activo</th>
                      <th className="px-3 py-2 text-right">Acciones</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {vetsFiltrados.map(v => {
                      const cs = v.comunas_array ?? safeParseArr(v.comunas)
                      const hs = v.horarios_obj ?? safeParseObj(v.horarios)
                      return (
                        <tr key={v.id} className="hover:bg-gray-50">
                          <td className="px-3 py-2 font-medium text-gray-900">{v.nombre}</td>
                          <td className="px-3 py-2 text-gray-600">
                            <div className="text-xs">{v.email}</div>
                            <div className="text-xs text-gray-500">{v.telefono}</div>
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex flex-wrap gap-1 max-w-xs">
                              {cs.slice(0, 3).map(c => <Badge key={c}>{c}</Badge>)}
                              {cs.length > 3 && <Badge>+{cs.length - 3}</Badge>}
                            </div>
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex flex-wrap gap-0.5">
                              {DIAS.map(d => {
                                const h = hs[d.key]
                                if (!h || (!h.am && !h.pm)) return null
                                const tag = (h.am && h.pm) ? d.label : `${d.label} ${h.am ? 'AM' : 'PM'}`
                                return (
                                  <span key={d.key} className="text-[10px] bg-indigo-50 text-indigo-700 px-1.5 py-0.5 rounded">
                                    {tag}
                                  </span>
                                )
                              })}
                            </div>
                          </td>
                          <td className="px-3 py-2 text-center text-xs text-gray-500">
                            {v.origen === 'publico' ? '🌐 Web' : '✍ Manual'}
                          </td>
                          <td className="px-3 py-2 text-center">
                            <Toggle checked={v.activo !== 'FALSE'} onChange={val => toggleActivoVet(v, val)} />
                          </td>
                          <td className="px-3 py-2 text-right whitespace-nowrap">
                            <button
                              onClick={() => abrirEditarVet(v)}
                              className="text-indigo-600 hover:text-indigo-800 text-xs font-medium mr-2"
                            >
                              Editar
                            </button>
                            <button
                              onClick={() => eliminarVet(v.id)}
                              className="text-red-600 hover:text-red-800 text-xs font-medium"
                            >
                              Eliminar
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <p className="text-xs text-gray-500 mt-3">
            Total: {vetsFiltrados.length} de {vets.length} · Link público de inscripción: <a className="text-indigo-600 hover:underline" href="/convenio-eutanasias" target="_blank">/convenio-eutanasias</a>
          </p>
        </section>
      )}

      {tab === 'Precios' && (
        <section>
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-sm text-gray-600">Precio que <strong>se paga al veterinario</strong> por servicio de eutanasia, según peso de la mascota.</p>
              <p className="text-xs text-gray-500 mt-1">Este es el precio que verán los vets en el landing del convenio.</p>
            </div>
            <button
              onClick={abrirNuevoTramo}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg"
            >
              + Agregar tramo
            </button>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden max-w-2xl">
            {tramos.length === 0 ? (
              <div className="p-8 text-center text-gray-500">No hay tramos de precio definidos.</div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                  <tr>
                    <th className="px-4 py-2 text-left">Peso (kg)</th>
                    <th className="px-4 py-2 text-right">Precio</th>
                    <th className="px-4 py-2 text-right w-32">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {tramos.map(t => (
                    <tr key={t.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-gray-900">
                        {t.peso_min} – {t.peso_max} kg
                      </td>
                      <td className="px-4 py-3 text-right font-medium text-gray-900">
                        {fmtPrecio(parseInt(t.precio, 10) || 0)}
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <button onClick={() => abrirEditarTramo(t)} className="text-indigo-600 hover:text-indigo-800 text-xs font-medium mr-3">
                          Editar
                        </button>
                        <button onClick={() => eliminarTramo(t.id)} className="text-red-600 hover:text-red-800 text-xs font-medium">
                          Eliminar
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>
      )}

      {/* Modal vet */}
      <Modal open={showVetModal} onClose={() => setShowVetModal(false)} title={editingVet ? 'Editar veterinario' : 'Nuevo veterinario'}>
        <form onSubmit={guardarVet} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Nombre" required>
              <input type="text" required value={vetForm.nombre} onChange={e => setVetForm({ ...vetForm, nombre: e.target.value })} className={inputCls} />
            </Field>
            <Field label="Email" required>
              <input type="email" required value={vetForm.email} onChange={e => setVetForm({ ...vetForm, email: e.target.value })} className={inputCls} />
            </Field>
            <Field label="Teléfono (9 dígitos)">
              <input type="tel" value={vetForm.telefono} onChange={e => setVetForm({ ...vetForm, telefono: e.target.value.replace(/\D/g, '').slice(0, 9) })} className={inputCls} />
            </Field>
            <Field label="RUT">
              <input type="text" value={vetForm.rut} onChange={e => setVetForm({ ...vetForm, rut: e.target.value })} className={inputCls} placeholder="12345678-9" />
            </Field>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1.5">
              Comunas donde atiende <span className="text-red-500">*</span>
              {vetForm.comunas.length > 0 && <span className="ml-2 text-gray-500">({vetForm.comunas.length} seleccionadas)</span>}
            </label>
            <div className="border border-gray-300 rounded-lg max-h-48 overflow-y-auto p-2 bg-gray-50">
              {REGIONES.map(region => {
                const cs = COMUNAS.filter(c => c.region === region)
                return (
                  <details key={region} className="mb-1">
                    <summary className="text-xs font-semibold text-gray-700 cursor-pointer py-1 px-2 hover:bg-gray-100 rounded">
                      {region} ({cs.filter(c => vetForm.comunas.includes(c.nombre)).length}/{cs.length})
                    </summary>
                    <div className="flex flex-wrap gap-1 mt-1 mb-2 px-2">
                      {cs.map(c => {
                        const sel = vetForm.comunas.includes(c.nombre)
                        return (
                          <button
                            key={c.nombre}
                            type="button"
                            onClick={() => toggleComuna(c.nombre)}
                            className={`text-xs px-2 py-1 rounded-full border transition-colors ${
                              sel ? 'bg-indigo-600 border-indigo-600 text-white' : 'bg-white border-gray-300 text-gray-700 hover:border-indigo-400'
                            }`}
                          >
                            {c.nombre}
                          </button>
                        )
                      })}
                    </div>
                  </details>
                )
              })}
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1.5">Días y horarios de disponibilidad <span className="text-red-500">*</span></label>
            <div className="overflow-x-auto">
              <table className="text-xs border border-gray-200 rounded-lg w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-2 py-1.5 text-left text-gray-600">Día</th>
                    <th className="px-2 py-1.5 text-center text-gray-600">AM</th>
                    <th className="px-2 py-1.5 text-center text-gray-600">PM</th>
                  </tr>
                </thead>
                <tbody>
                  {DIAS.map(d => {
                    const h = vetForm.horarios[d.key] ?? { am: false, pm: false }
                    return (
                      <tr key={d.key} className="border-t">
                        <td className="px-2 py-1.5 font-medium">{d.label}</td>
                        <td className="px-2 py-1.5 text-center">
                          <input type="checkbox" checked={h.am} onChange={() => toggleHorario(d.key, 'am')} />
                        </td>
                        <td className="px-2 py-1.5 text-center">
                          <input type="checkbox" checked={h.pm} onChange={() => toggleHorario(d.key, 'pm')} />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <Field label="Notas">
            <textarea value={vetForm.notas} onChange={e => setVetForm({ ...vetForm, notas: e.target.value })} rows={2} className={inputCls} />
          </Field>

          <div className="flex items-center gap-2">
            <Toggle checked={vetForm.activo} onChange={v => setVetForm({ ...vetForm, activo: v })} />
            <span className="text-sm text-gray-700">Activo (recibe cotizaciones)</span>
          </div>

          {vetError && <p className="text-sm text-red-600">{vetError}</p>}

          <div className="flex gap-2 justify-end pt-2">
            <button type="button" onClick={() => setShowVetModal(false)} className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">Cancelar</button>
            <button type="submit" disabled={savingVet} className="px-4 py-2 text-sm bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white font-medium rounded-lg">
              {savingVet ? 'Guardando…' : (editingVet ? 'Guardar cambios' : 'Crear veterinario')}
            </button>
          </div>
        </form>
      </Modal>

      {/* Modal tramo */}
      <Modal open={showTramoModal} onClose={() => setShowTramoModal(false)} title={editingTramo ? 'Editar tramo' : 'Nuevo tramo de precio'}>
        <form onSubmit={guardarTramo} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Peso mínimo (kg)" required>
              <input type="number" step="0.1" required value={tramoForm.peso_min} onChange={e => setTramoForm({ ...tramoForm, peso_min: e.target.value })} className={inputCls} />
            </Field>
            <Field label="Peso máximo (kg)" required>
              <input type="number" step="0.1" required value={tramoForm.peso_max} onChange={e => setTramoForm({ ...tramoForm, peso_max: e.target.value })} className={inputCls} />
            </Field>
          </div>
          <Field label="Precio que se paga al vet (CLP)" required>
            <input type="number" required value={tramoForm.precio} onChange={e => setTramoForm({ ...tramoForm, precio: e.target.value })} className={inputCls} />
          </Field>
          {tramoError && <p className="text-sm text-red-600">{tramoError}</p>}
          <div className="flex gap-2 justify-end pt-2">
            <button type="button" onClick={() => setShowTramoModal(false)} className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">Cancelar</button>
            <button type="submit" disabled={savingTramo} className="px-4 py-2 text-sm bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white font-medium rounded-lg">
              {savingTramo ? 'Guardando…' : (editingTramo ? 'Guardar cambios' : 'Crear tramo')}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  )
}

const inputCls = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none'

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-700 mb-1">
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      {children}
    </div>
  )
}

function safeParseArr(s: string): string[] {
  try { const v = JSON.parse(s); return Array.isArray(v) ? v : [] } catch { return [] }
}
function safeParseObj(s: string): Record<string, { am?: boolean; pm?: boolean }> {
  try { const v = JSON.parse(s); return (v && typeof v === 'object') ? v : {} } catch { return {} }
}
