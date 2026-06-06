'use client'
import { useState, useEffect, useCallback, useMemo } from 'react'
import { Toggle } from '@/components/ui/Toggle'
import { Modal } from '@/components/ui/Modal'
import { Badge } from '@/components/ui/Badge'
import ComunaPicker from '@/components/ui/ComunaPicker'
import { fmtPrecio } from '@/lib/format'
import { formatDate, formatHoraDia, todayISO } from '@/lib/dates'
import AddressAutocomplete from '@/components/ui/AddressAutocomplete'
import { COMUNAS } from '@/lib/comunas'

const TABS = ['Cotizaciones', 'Veterinarios', 'Precios'] as const
type Tab = typeof TABS[number]

type Cotizacion = {
  id: string
  mascota_nombre: string
  especie: string
  peso: string
  cliente_nombre: string
  cliente_telefono: string
  cliente_email: string
  direccion: string
  comuna: string
  fecha_servicio: string
  hora_servicio: string
  notas: string
  estado: string
  vet_id_asignado: string
  vet_nombre_asignado: string
  vet_email_asignado: string
  precio_snapshot: string
  estado_pago?: string
  fecha_pago?: string
  fecha_realizacion?: string
  fecha_creacion: string
}

interface ColumnaConfig {
  key: 'enviadas' | 'por_confirmar' | 'por_realizar' | 'historico'
  titulo: string
  descripcion: string
  /** Color del header (Tailwind class). */
  header: string
  /** Acepta una cotización si pertenece a esta columna. */
  matches: (c: Cotizacion) => boolean
}

const COLUMNAS_COTI: ColumnaConfig[] = [
  {
    key: 'enviadas',
    titulo: 'Enviadas',
    descripcion: 'Esperando que un veterinario acepte',
    header: 'bg-indigo-50 text-indigo-800 border-indigo-200',
    matches: c => c.estado === 'creada' || c.estado === 'enviada',
  },
  {
    key: 'por_confirmar',
    titulo: 'Por confirmar con cliente',
    descripcion: 'Veterinario aceptó, debe llamar a la familia',
    header: 'bg-amber-50 text-amber-800 border-amber-200',
    matches: c => c.estado === 'aceptada',
  },
  {
    key: 'por_realizar',
    titulo: 'Por realizar',
    descripcion: 'Cita coordinada, servicio agendado',
    header: 'bg-blue-50 text-blue-800 border-blue-200',
    matches: c => c.estado === 'confirmada',
  },
  {
    key: 'historico',
    titulo: 'Histórico',
    descripcion: 'Servicios realizados o cancelados',
    header: 'bg-emerald-50 text-emerald-800 border-emerald-200',
    matches: c => c.estado === 'realizada' || c.estado === 'cancelada',
  },
]

type VetMatch = {
  id: string
  nombre: string
  apellido: string
  email: string
  telefono: string
  comunas: string[]
}

function estadoColor(estado: string): string {
  switch (estado) {
    case 'creada': return 'bg-gray-100 text-gray-700'
    case 'enviada': return 'bg-blue-100 text-blue-700'
    case 'aceptada': return 'bg-amber-100 text-amber-700'
    case 'confirmada': return 'bg-emerald-100 text-emerald-700'
    case 'realizada': return 'bg-green-200 text-green-800'
    case 'cancelada': return 'bg-red-100 text-red-700'
    default: return 'bg-gray-100 text-gray-700'
  }
}

type Vet = {
  id: string
  nombre: string
  apellido: string
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
    apellido: '',
    email: '',
    telefono: '',
    rut: '',
    comunas: [] as string[],
    horarios: horariosVacios(),
    notas: '',
    activo: true,
  }
}

/** Marca todos los días con AM y PM. Usado por el botón "Toda la semana". */
function horariosTodos(): Horarios {
  return {
    lun: { am: true, pm: true },
    mar: { am: true, pm: true },
    mie: { am: true, pm: true },
    jue: { am: true, pm: true },
    vie: { am: true, pm: true },
    sab: { am: true, pm: true },
    dom: { am: true, pm: true },
  }
}

function cotizacionFormDefault() {
  return {
    mascota_nombre: '',
    especie: 'Perro',
    peso: '',
    cliente_nombre: '',
    cliente_telefono: '',
    cliente_email: '',
    direccion: '',
    comuna: '',
    fecha_servicio: todayISO(),
    hora_servicio: '',
    notas: '',
  }
}

export default function ServiciosEutanasiasPage() {
  const [tab, setTab] = useState<Tab>('Cotizaciones')

  // Cotizaciones
  const [cotis, setCotis] = useState<Cotizacion[]>([])
  const [loadingCotis, setLoadingCotis] = useState(false)
  const [showCotiModal, setShowCotiModal] = useState(false)
  const [cotiForm, setCotiForm] = useState(cotizacionFormDefault())
  const [savingCoti, setSavingCoti] = useState(false)
  const [cotiError, setCotiError] = useState('')
  // Estado paralelo al form: si el admin elige asignar vet manualmente al crear.
  const [vetManualId, setVetManualId] = useState('')
  // Cuando se detecta automáticamente la comuna desde la dirección, marcamos
  // el campo como "auto" para mostrar un badge visual.
  const [comunaAuto, setComunaAuto] = useState(false)
  const [comunaWarn, setComunaWarn] = useState('')

  // Edición de cotización existente
  const [editCoti, setEditCoti] = useState<Cotizacion | null>(null)
  const [editForm, setEditForm] = useState(cotizacionFormDefault())
  const [editVetManualId, setEditVetManualId] = useState('')
  const [savingEdit, setSavingEdit] = useState(false)
  const [editError, setEditError] = useState('')

  // Detalle cotización + matching
  type Excluido = { id: string; nombre_completo: string; email: string; razon: string; detalle: string }
  type Diagnostico = { comuna_canonica: string; dia_resuelto: string | null; slot_resuelto: string | null }
  const [detalleCoti, setDetalleCoti] = useState<Cotizacion | null>(null)
  const [matchingVets, setMatchingVets] = useState<VetMatch[]>([])
  const [matchingExcluidos, setMatchingExcluidos] = useState<Excluido[]>([])
  const [matchingDiag, setMatchingDiag] = useState<Diagnostico | null>(null)
  const [matchingLoading, setMatchingLoading] = useState(false)
  const [vetsSeleccionados, setVetsSeleccionados] = useState<Set<string>>(new Set())
  const [enviando, setEnviando] = useState(false)
  const [resultEnvio, setResultEnvio] = useState<{ tipo: 'ok' | 'error'; mensaje: string } | null>(null)

  const cargarCotis = useCallback(async () => {
    setLoadingCotis(true)
    try {
      const r = await fetch('/api/eutanasias/cotizaciones', { cache: 'no-store' })
      const d = await r.json()
      setCotis(Array.isArray(d) ? d : [])
    } finally {
      setLoadingCotis(false)
    }
  }, [])

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
    cargarCotis()
  }, [cargarVets, cargarTramos, cargarCotis])

  // ─── Cotizaciones handlers ────────────────────────────────────────────────
  function abrirNuevaCotizacion() {
    setCotiForm(cotizacionFormDefault())
    setVetManualId('')
    setComunaAuto(false)
    setComunaWarn('')
    setCotiError('')
    setShowCotiModal(true)
  }

  /**
   * Cuando el admin selecciona una dirección del autocomplete, le pedimos a
   * Google los detalles del lugar (que incluye sus address_components) y
   * extraemos la comuna canónica. Eso permite garantizar que la comuna de la
   * cotización es la MISMA forma canónica que la que cargó el vet al
   * registrarse — sin esto, el matcher fallaba por diferencias de tildes /
   * mayúsculas / abreviaturas entre "Las Condes" y "las condes" etc.
   */
  async function onSelectDireccion(place: { text: string; placeId: string }) {
    if (!place.placeId) return
    try {
      const r = await fetch(`/api/eutanasias/place-details?placeId=${encodeURIComponent(place.placeId)}`)
      const j = await r.json()
      if (j.ok && j.comuna) {
        setCotiForm(f => ({ ...f, comuna: j.comuna }))
        setComunaAuto(true)
        setComunaWarn(j.comuna_canonica ? '' : 'Comuna detectada pero no aparece en nuestra lista oficial; verifica que coincida con la registrada por los vets.')
      } else {
        setComunaWarn('No pudimos detectar la comuna desde la dirección. Ingresala manualmente.')
      }
    } catch {
      setComunaWarn('No pudimos detectar la comuna. Ingresala manualmente.')
    }
  }

  async function guardarCotizacion(e: React.FormEvent) {
    e.preventDefault()
    setCotiError('')
    setSavingCoti(true)
    try {
      const r = await fetch('/api/eutanasias/cotizaciones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...cotiForm,
          peso: parseFloat(cotiForm.peso),
          vet_id_asignado: vetManualId || undefined,
        }),
      })
      const j = await r.json()
      if (!r.ok) {
        setCotiError(j.error || 'Error al crear la cotización')
        return
      }
      setShowCotiModal(false)
      await cargarCotis()
      // Si se asignó vet manualmente, no abrimos el detalle de matching;
      // el vet ya está fijo. Solo refrescamos la lista.
      if (!vetManualId) {
        await abrirDetalleCotizacion(j as Cotizacion)
      }
    } finally {
      setSavingCoti(false)
    }
  }

  function abrirEditarCotizacion(c: Cotizacion) {
    setEditCoti(c)
    setEditForm({
      mascota_nombre: c.mascota_nombre,
      especie: c.especie,
      peso: c.peso,
      cliente_nombre: c.cliente_nombre,
      cliente_telefono: c.cliente_telefono,
      cliente_email: c.cliente_email,
      direccion: c.direccion,
      comuna: c.comuna,
      fecha_servicio: c.fecha_servicio,
      hora_servicio: formatHoraDia(c.hora_servicio),
      notas: c.notas,
    })
    setEditVetManualId(c.vet_id_asignado || '')
    setEditError('')
  }

  async function guardarEdicion(e: React.FormEvent) {
    e.preventDefault()
    if (!editCoti) return
    setEditError('')
    setSavingEdit(true)
    try {
      const payload: Record<string, unknown> = { ...editForm, peso: parseFloat(editForm.peso) }
      // Si cambia el vet asignado, lo enviamos como override (el endpoint lo procesa).
      if (editVetManualId && editVetManualId !== editCoti.vet_id_asignado) {
        payload.vet_id_asignado = editVetManualId
      } else if (!editVetManualId && editCoti.vet_id_asignado) {
        // Quitarle el vet asignado
        payload.vet_id_asignado = ''
      }
      const r = await fetch(`/api/eutanasias/cotizaciones/${editCoti.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const j = await r.json()
      if (!r.ok) {
        setEditError(j.error || 'Error al guardar')
        return
      }
      setEditCoti(null)
      await cargarCotis()
    } finally {
      setSavingEdit(false)
    }
  }

  async function abrirDetalleCotizacion(c: Cotizacion) {
    setDetalleCoti(c)
    setMatchingVets([])
    setMatchingExcluidos([])
    setMatchingDiag(null)
    setVetsSeleccionados(new Set())
    setResultEnvio(null)
    setMatchingLoading(true)
    try {
      const r = await fetch(`/api/eutanasias/cotizaciones/${c.id}/buscar-vets`, { method: 'POST' })
      const j = await r.json()
      const vetsRes: VetMatch[] = Array.isArray(j.vets) ? j.vets : []
      setMatchingVets(vetsRes)
      setVetsSeleccionados(new Set(vetsRes.map(v => v.id)))
      setMatchingExcluidos(Array.isArray(j.excluidos) ? j.excluidos : [])
      setMatchingDiag(j.diagnostico ?? null)
    } finally {
      setMatchingLoading(false)
    }
  }

  function toggleVetSeleccionado(id: string) {
    setVetsSeleccionados(prev => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id); else n.add(id)
      return n
    })
  }

  async function enviarCotizacionAVets() {
    if (!detalleCoti) return
    if (vetsSeleccionados.size === 0) {
      setResultEnvio({ tipo: 'error', mensaje: 'Selecciona al menos un veterinario.' })
      return
    }
    setEnviando(true)
    setResultEnvio(null)
    try {
      const r = await fetch(`/api/eutanasias/cotizaciones/${detalleCoti.id}/enviar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vet_ids: Array.from(vetsSeleccionados) }),
      })
      const j = await r.json()
      if (!r.ok) {
        setResultEnvio({ tipo: 'error', mensaje: j.error || 'Error al enviar' })
        return
      }
      setResultEnvio({ tipo: 'ok', mensaje: `Enviada a ${j.enviados} veterinario${j.enviados === 1 ? '' : 's'}.` })
      await cargarCotis()
    } finally {
      setEnviando(false)
    }
  }

  async function cancelarCotizacion(id: string) {
    if (!confirm('¿Cancelar esta cotización? No se reenviará a los vets ya notificados.')) return
    await fetch(`/api/eutanasias/cotizaciones/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ estado: 'cancelada' }),
    })
    await cargarCotis()
  }

  async function marcarRealizada(id: string) {
    if (!confirm('¿Marcar como realizada?')) return
    await fetch(`/api/eutanasias/cotizaciones/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ estado: 'realizada' }),
    })
    await cargarCotis()
  }

  async function eliminarCotizacion(id: string) {
    if (!confirm('¿Eliminar esta cotización? Los emails ya enviados no se podrán deshacer.')) return
    await fetch(`/api/eutanasias/cotizaciones/${id}`, { method: 'DELETE' })
    await cargarCotis()
  }

  // Cotizaciones agrupadas por columna (Kanban).
  const cotisPorColumna = useMemo(() => {
    const sorted = [...cotis].sort((a, b) => (b.fecha_creacion || '').localeCompare(a.fecha_creacion || ''))
    const r: Record<ColumnaConfig['key'], Cotizacion[]> = {
      enviadas: [], por_confirmar: [], por_realizar: [], historico: [],
    }
    for (const c of sorted) {
      const col = COLUMNAS_COTI.find(col => col.matches(c))
      if (col) r[col.key].push(c)
    }
    return r
  }, [cotis])

  async function cambiarEstadoPago(id: string, nuevoEstadoPago: 'pendiente_pago' | 'pago_confirmado') {
    await fetch(`/api/eutanasias/cotizaciones/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ estado_pago: nuevoEstadoPago }),
    })
    await cargarCotis()
  }

  // Vets activos disponibles para asignación manual.
  const vetsActivos = useMemo(() => vets.filter(v => v.activo !== 'FALSE'), [vets])

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
      apellido: v.apellido || '',
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

  function setComunasForm(nuevo: string[]) {
    setVetForm(f => ({ ...f, comunas: nuevo }))
  }

  async function guardarVet(e: React.FormEvent) {
    e.preventDefault()
    setVetError('')
    if (!vetForm.nombre.trim()) return setVetError('Nombre obligatorio')
    if (!vetForm.apellido.trim()) return setVetError('Apellido obligatorio')
    if (!vetForm.email.trim()) return setVetError('Email obligatorio')
    if (!vetForm.telefono.trim() || vetForm.telefono.length !== 9) return setVetError('Teléfono obligatorio (9 dígitos)')
    if (!vetForm.rut.trim()) return setVetError('RUT obligatorio')
    if (vetForm.comunas.length === 0) return setVetError('Agrega al menos una comuna')
    if (Object.keys(vetForm.horarios).length === 0) return setVetError('Selecciona al menos un día/horario')

    setSavingVet(true)
    const payload = {
      nombre: vetForm.nombre,
      apellido: vetForm.apellido,
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
      if (q && !(`${v.nombre} ${v.apellido} ${v.email} ${v.telefono}`).toLowerCase().includes(q)) return false
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
    <div className="p-4 sm:p-6 md:p-8 max-w-7xl mx-auto">
      <header className="mb-4 pl-14 md:pl-0">
        <p className="text-xs uppercase tracking-wider text-gray-400">Servicios</p>
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900 mt-1">Eutanasias</h1>
        <p className="text-gray-500 text-xs sm:text-sm mt-1">Convenio de eutanasias a domicilio: cotizaciones, veterinarios participantes y precios.</p>
      </header>

      {/* Selector de sub-módulo (por ahora único, preparado para más en el futuro). */}
      <div className="flex gap-2 mb-5">
        <button
          className="text-xs font-semibold px-3 py-1.5 rounded-full bg-indigo-600 text-white cursor-default"
          disabled
        >
          Eutanasias
        </button>
      </div>

      <div className="border-b border-gray-200 mb-6 overflow-x-auto">
        <nav className="-mb-px flex gap-4 sm:gap-6 min-w-max">
          {TABS.map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`pb-3 px-1 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                tab === t ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-gray-500 hover:text-gray-800'
              }`}
            >
              {t}
            </button>
          ))}
        </nav>
      </div>

      {tab === 'Cotizaciones' && (
        <section>
          <div className="flex flex-col md:flex-row gap-3 md:items-end justify-between mb-5">
            <div>
              <p className="text-sm text-gray-600">Cada cotización avanza por las 4 columnas a medida que el veterinario va respondiendo los correos.</p>
            </div>
            <button
              onClick={abrirNuevaCotizacion}
              className="w-full md:w-auto px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg shadow-sm"
            >
              + Nueva cotización
            </button>
          </div>

          {loadingCotis && cotis.length === 0 ? (
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 text-center text-gray-500">Cargando…</div>
          ) : (
            <div className="grid gap-3 sm:gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
              {COLUMNAS_COTI.map(col => {
                const items = cotisPorColumna[col.key]
                return (
                  <div key={col.key} className="bg-gray-50/80 rounded-xl border border-gray-200/70 flex flex-col min-h-[200px]">
                    <div className={`px-4 py-3 rounded-t-xl border-b ${col.header}`}>
                      <div className="flex items-center justify-between">
                        <h3 className="text-sm font-semibold leading-tight">{col.titulo}</h3>
                        <span className="text-[11px] font-bold bg-white/70 px-2 py-0.5 rounded-full">{items.length}</span>
                      </div>
                      <p className="text-[11px] opacity-80 mt-0.5">{col.descripcion}</p>
                    </div>
                    <div className="p-2 sm:p-3 space-y-2 sm:space-y-3 flex-1 max-h-[70vh] overflow-y-auto">
                      {items.length === 0 ? (
                        <p className="text-[11px] text-gray-400 text-center py-4">Sin cotizaciones</p>
                      ) : items.map(c => (
                        <CotizacionCard
                          key={c.id}
                          c={c}
                          showPago={col.key === 'historico'}
                          onOpen={() => abrirDetalleCotizacion(c)}
                          onMarcarPagado={() => cambiarEstadoPago(c.id, 'pago_confirmado')}
                        />
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </section>
      )}

      {tab === 'Veterinarios' && (
        <section>
          <div className="flex flex-col md:flex-row gap-3 md:items-center justify-between mb-4">
            <div className="flex flex-col sm:flex-row gap-2 flex-1">
              <input
                type="text"
                value={busqueda}
                onChange={e => setBusqueda(e.target.value)}
                placeholder="Buscar nombre / email / teléfono…"
                className="w-full sm:flex-1 sm:max-w-md px-3 py-2 border border-gray-300 rounded-lg text-base sm:text-sm"
              />
              <select
                value={filtroComuna}
                onChange={e => setFiltroComuna(e.target.value)}
                className="w-full sm:w-auto px-3 py-2 border border-gray-300 rounded-lg text-base sm:text-sm"
              >
                <option value="">Todas las comunas</option>
                {COMUNAS.map(c => (
                  <option key={c.nombre + c.region} value={c.nombre}>{c.nombre}</option>
                ))}
              </select>
            </div>
            <button
              onClick={abrirNuevoVet}
              className="w-full md:w-auto px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg"
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
                          <td className="px-3 py-2 font-medium text-gray-900">{`${v.nombre || ''} ${v.apellido || ''}`.trim()}</td>
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
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-4">
            <div>
              <p className="text-sm text-gray-600">Precio que <strong>se paga al veterinario</strong> por servicio de eutanasia, según peso de la mascota.</p>
              <p className="text-xs text-gray-500 mt-1">Este es el precio que verán los vets en el landing del convenio.</p>
            </div>
            <button
              onClick={abrirNuevoTramo}
              className="w-full md:w-auto md:shrink-0 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg"
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

      {/* Modal Nueva cotización */}
      <Modal open={showCotiModal} onClose={() => setShowCotiModal(false)} title="Nueva cotización de eutanasia">
        <form onSubmit={guardarCotizacion} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Nombre de la mascota" required>
              <input type="text" required value={cotiForm.mascota_nombre} onChange={e => setCotiForm({ ...cotiForm, mascota_nombre: e.target.value })} className={inputCls} />
            </Field>
            <Field label="Especie" required>
              <select required value={cotiForm.especie} onChange={e => setCotiForm({ ...cotiForm, especie: e.target.value })} className={inputCls}>
                <option>Perro</option>
                <option>Gato</option>
                <option>Conejo</option>
                <option>Hamster</option>
                <option>Hurón</option>
                <option>Ave</option>
                <option>Otro</option>
              </select>
            </Field>
            <Field label="Peso (kg)" required>
              <input type="number" step="0.1" required value={cotiForm.peso} onChange={e => setCotiForm({ ...cotiForm, peso: e.target.value })} className={inputCls} />
            </Field>
            <Field label="Fecha" required>
              <input type="date" required value={cotiForm.fecha_servicio} onChange={e => setCotiForm({ ...cotiForm, fecha_servicio: e.target.value })} className={inputCls} />
            </Field>
            <Field label="Hora" required>
              <input type="time" required value={cotiForm.hora_servicio} onChange={e => setCotiForm({ ...cotiForm, hora_servicio: e.target.value })} className={inputCls} />
            </Field>
          </div>

          <Field label="Dirección" required>
            <AddressAutocomplete
              value={cotiForm.direccion}
              onChange={v => { setCotiForm(f => ({ ...f, direccion: v })); if (comunaAuto) { setComunaAuto(false); setComunaWarn('') } }}
              onSelectPlace={onSelectDireccion}
              required
              placeholder="Calle, número, comuna…"
              className={inputCls}
            />
            <p className="text-xs text-gray-500 mt-1">La comuna se detecta automáticamente al elegir una sugerencia de Google.</p>
          </Field>

          <Field label="Comuna" required>
            <div className="flex gap-2 items-center">
              <input
                type="text" required
                value={cotiForm.comuna}
                onChange={e => { setCotiForm({ ...cotiForm, comuna: e.target.value }); setComunaAuto(false) }}
                placeholder="Detectada de la dirección"
                className={`flex-1 ${inputCls}`}
              />
              {comunaAuto && <span className="text-[10px] font-semibold uppercase px-2 py-1 rounded bg-emerald-100 text-emerald-700 whitespace-nowrap">Auto</span>}
            </div>
            {comunaWarn && <p className="text-xs text-amber-700 mt-1">{comunaWarn}</p>}
          </Field>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Nombre del cliente" required>
              <input type="text" required value={cotiForm.cliente_nombre} onChange={e => setCotiForm({ ...cotiForm, cliente_nombre: e.target.value })} className={inputCls} />
            </Field>
            <Field label="Teléfono cliente (9 dígitos)" required>
              <input type="tel" required value={cotiForm.cliente_telefono} onChange={e => setCotiForm({ ...cotiForm, cliente_telefono: e.target.value.replace(/\D/g, '').slice(0, 9) })} className={inputCls} />
            </Field>
            <Field label="Email cliente">
              <input type="email" value={cotiForm.cliente_email} onChange={e => setCotiForm({ ...cotiForm, cliente_email: e.target.value })} className={inputCls} />
            </Field>
          </div>

          <Field label="Notas internas">
            <textarea value={cotiForm.notas} onChange={e => setCotiForm({ ...cotiForm, notas: e.target.value })} rows={2} className={inputCls} placeholder="Información adicional que ayude al vet" />
          </Field>

          {/* Asignar vet manualmente (opcional) */}
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
            <label className="block text-xs font-medium text-gray-700 mb-1.5">
              Asignar veterinario manualmente <span className="text-gray-400">(opcional)</span>
            </label>
            <select
              value={vetManualId}
              onChange={e => setVetManualId(e.target.value)}
              className={inputCls}
            >
              <option value="">— Buscar vets disponibles al crear —</option>
              {vetsActivos.map(v => (
                <option key={v.id} value={v.id}>
                  {`${v.nombre} ${v.apellido}`.trim()} ({v.email})
                </option>
              ))}
            </select>
            <p className="text-xs text-gray-500 mt-1">
              Si eliges uno, la cotización queda <strong>confirmada</strong> directamente, sin enviar correos automáticos.
            </p>
          </div>

          {cotiError && <p className="text-sm text-red-600">{cotiError}</p>}
          <div className="flex gap-2 justify-end pt-2">
            <button type="button" onClick={() => setShowCotiModal(false)} className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">Cancelar</button>
            <button type="submit" disabled={savingCoti} className="px-4 py-2 text-sm bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white font-medium rounded-lg">
              {savingCoti ? 'Creando…' : (vetManualId ? 'Crear y asignar' : 'Crear y buscar vets')}
            </button>
          </div>
        </form>
      </Modal>

      {/* Modal Editar cotización */}
      <Modal open={!!editCoti} onClose={() => setEditCoti(null)} title={editCoti ? `Editar cotización N° ${editCoti.id}` : ''}>
        {editCoti && (
          <form onSubmit={guardarEdicion} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Mascota" required>
                <input type="text" required value={editForm.mascota_nombre} onChange={e => setEditForm({ ...editForm, mascota_nombre: e.target.value })} className={inputCls} />
              </Field>
              <Field label="Especie" required>
                <select required value={editForm.especie} onChange={e => setEditForm({ ...editForm, especie: e.target.value })} className={inputCls}>
                  <option>Perro</option><option>Gato</option><option>Conejo</option><option>Hamster</option><option>Hurón</option><option>Ave</option><option>Otro</option>
                </select>
              </Field>
              <Field label="Peso (kg)" required>
                <input type="number" step="0.1" required value={editForm.peso} onChange={e => setEditForm({ ...editForm, peso: e.target.value })} className={inputCls} />
              </Field>
              <Field label="Fecha" required>
                <input type="date" required value={editForm.fecha_servicio} onChange={e => setEditForm({ ...editForm, fecha_servicio: e.target.value })} className={inputCls} />
              </Field>
              <Field label="Hora" required>
                <input type="time" required value={editForm.hora_servicio} onChange={e => setEditForm({ ...editForm, hora_servicio: e.target.value })} className={inputCls} />
              </Field>
              <Field label="Comuna" required>
                <input type="text" required value={editForm.comuna} onChange={e => setEditForm({ ...editForm, comuna: e.target.value })} className={inputCls} />
              </Field>
            </div>
            <Field label="Dirección" required>
              <input type="text" required value={editForm.direccion} onChange={e => setEditForm({ ...editForm, direccion: e.target.value })} className={inputCls} />
            </Field>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Nombre cliente" required>
                <input type="text" required value={editForm.cliente_nombre} onChange={e => setEditForm({ ...editForm, cliente_nombre: e.target.value })} className={inputCls} />
              </Field>
              <Field label="Teléfono cliente" required>
                <input type="tel" required value={editForm.cliente_telefono} onChange={e => setEditForm({ ...editForm, cliente_telefono: e.target.value.replace(/\D/g, '').slice(0, 9) })} className={inputCls} />
              </Field>
              <Field label="Email cliente">
                <input type="email" value={editForm.cliente_email} onChange={e => setEditForm({ ...editForm, cliente_email: e.target.value })} className={inputCls} />
              </Field>
            </div>
            <Field label="Notas internas">
              <textarea value={editForm.notas} onChange={e => setEditForm({ ...editForm, notas: e.target.value })} rows={2} className={inputCls} />
            </Field>

            <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
              <label className="block text-xs font-medium text-gray-700 mb-1.5">Veterinario asignado</label>
              <select value={editVetManualId} onChange={e => setEditVetManualId(e.target.value)} className={inputCls}>
                <option value="">— Ninguno (esperando que un vet acepte) —</option>
                {vetsActivos.map(v => (
                  <option key={v.id} value={v.id}>{`${v.nombre} ${v.apellido}`.trim()} ({v.email})</option>
                ))}
              </select>
              {editVetManualId && editVetManualId !== editCoti.vet_id_asignado && (
                <p className="text-xs text-amber-700 mt-1">Al guardar, la cotización pasará a <strong>confirmada</strong> con este vet asignado.</p>
              )}
              {!editVetManualId && editCoti.vet_id_asignado && (
                <p className="text-xs text-amber-700 mt-1">Al guardar, se quitará el vet actualmente asignado y la cotización vuelve a estado <strong>enviada</strong>.</p>
              )}
            </div>

            {editError && <p className="text-sm text-red-600">{editError}</p>}
            <div className="flex gap-2 justify-end pt-2">
              <button type="button" onClick={() => setEditCoti(null)} className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">Cancelar</button>
              <button type="submit" disabled={savingEdit} className="px-4 py-2 text-sm bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white font-medium rounded-lg">
                {savingEdit ? 'Guardando…' : 'Guardar cambios'}
              </button>
            </div>
          </form>
        )}
      </Modal>

      {/* Modal ficha completa de cotización */}
      <Modal
        open={!!detalleCoti}
        onClose={() => { setDetalleCoti(null); setResultEnvio(null) }}
        title={detalleCoti ? `Cotización N° ${detalleCoti.id}` : ''}
      >
        {detalleCoti && (
          <div className="space-y-4">
            {/* Hero: mascota + estado + acciones rápidas */}
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold text-gray-900">{detalleCoti.mascota_nombre}</h2>
                <p className="text-xs text-gray-500 mt-0.5">{detalleCoti.especie} · {detalleCoti.peso} kg</p>
              </div>
              <span className={`text-[10px] font-semibold uppercase px-2 py-1 rounded ${estadoColor(detalleCoti.estado)}`}>
                {detalleCoti.estado}
              </span>
            </div>

            {/* Bloque: Servicio */}
            <FichaBloque titulo="Servicio">
              <FichaRow label="Fecha y hora" value={`${formatDate(detalleCoti.fecha_servicio)} · ${formatHoraDia(detalleCoti.hora_servicio)}`} />
              <FichaRow label="Dirección" value={
                <a
                  href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${detalleCoti.direccion}, ${detalleCoti.comuna}, Chile`)}`}
                  target="_blank" rel="noreferrer"
                  className="text-indigo-600 hover:underline"
                >
                  {detalleCoti.direccion}, {detalleCoti.comuna}
                </a>
              } />
              <FichaRow label="Pago al vet" value={<span className="font-semibold">{fmtPrecio(parseInt(detalleCoti.precio_snapshot, 10) || 0)}</span>} />
              {detalleCoti.notas && <FichaRow label="Notas" value={detalleCoti.notas} />}
            </FichaBloque>

            {/* Bloque: Cliente */}
            <FichaBloque titulo="Cliente">
              <FichaRow label="Nombre" value={detalleCoti.cliente_nombre} />
              <FichaRow label="Teléfono" value={
                <a href={`tel:+56${detalleCoti.cliente_telefono}`} className="text-indigo-600 hover:underline">+56 {detalleCoti.cliente_telefono}</a>
              } />
              {detalleCoti.cliente_email && (
                <FichaRow label="Email" value={
                  <a href={`mailto:${detalleCoti.cliente_email}`} className="text-indigo-600 hover:underline break-all">{detalleCoti.cliente_email}</a>
                } />
              )}
            </FichaBloque>

            {/* Bloque: Veterinario asignado */}
            {detalleCoti.vet_nombre_asignado && (
              <FichaBloque titulo="Veterinario asignado">
                <FichaRow label="Nombre" value={detalleCoti.vet_nombre_asignado} />
                <FichaRow label="Email" value={
                  <a href={`mailto:${detalleCoti.vet_email_asignado}`} className="text-indigo-600 hover:underline break-all">{detalleCoti.vet_email_asignado}</a>
                } />
                {detalleCoti.estado === 'aceptada' && <p className="text-xs text-amber-700 mt-1">⏳ Esperando que llame al cliente y confirme.</p>}
                {detalleCoti.estado === 'confirmada' && <p className="text-xs text-blue-700 mt-1">📅 Cita coordinada con la familia. Esperando que marque el servicio como realizado.</p>}
                {detalleCoti.estado === 'realizada' && <p className="text-xs text-emerald-700 mt-1">✓ Servicio realizado.</p>}
              </FichaBloque>
            )}

            {/* Bloque: Pago (solo histórico) */}
            {detalleCoti.estado === 'realizada' && (
              <FichaBloque titulo="Pago">
                <div className="flex items-center justify-between gap-3">
                  {detalleCoti.estado_pago === 'pago_confirmado' ? (
                    <>
                      <span className="inline-flex items-center gap-1 text-xs font-semibold uppercase px-3 py-1.5 rounded bg-emerald-100 text-emerald-700">
                        ✓ Pago confirmado
                      </span>
                      <button
                        onClick={() => { cambiarEstadoPago(detalleCoti.id, 'pendiente_pago') }}
                        className="text-xs text-amber-600 hover:text-amber-800 font-medium"
                      >
                        Revertir
                      </button>
                    </>
                  ) : (
                    <>
                      <span className="inline-flex items-center gap-1 text-xs font-semibold uppercase px-3 py-1.5 rounded bg-amber-100 text-amber-700">
                        ⏱ Pendiente de pago
                      </span>
                      <button
                        onClick={() => { cambiarEstadoPago(detalleCoti.id, 'pago_confirmado') }}
                        className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-lg"
                      >
                        Marcar como pagado
                      </button>
                    </>
                  )}
                </div>
              </FichaBloque>
            )}

            {/* Bloque: matching y envío (solo si está sin asignar) */}
            {(detalleCoti.estado === 'creada' || detalleCoti.estado === 'enviada') && (
              <FichaBloque titulo={`Veterinarios disponibles${matchingLoading ? '…' : ` (${matchingVets.length})`}`}>
                {matchingLoading ? (
                  <p className="text-sm text-gray-500">Buscando coincidencias…</p>
                ) : matchingVets.length === 0 ? (
                  <div className="space-y-2">
                    <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2.5">
                      <p className="font-medium">Ningún veterinario cumple los criterios.</p>
                      {matchingDiag && (
                        <p className="mt-1">
                          Buscando para <strong>{matchingDiag.comuna_canonica}</strong>{' '}
                          {matchingDiag.dia_resuelto && <>el <strong>{matchingDiag.dia_resuelto}</strong> </>}
                          {matchingDiag.slot_resuelto && <>en <strong>{matchingDiag.slot_resuelto.toUpperCase()}</strong></>}
                        </p>
                      )}
                    </div>
                    {matchingExcluidos.length > 0 && (
                      <details className="bg-gray-50 border border-gray-200 rounded-lg p-2.5 text-xs">
                        <summary className="cursor-pointer font-medium text-gray-700">
                          Por qué se excluyeron los {matchingExcluidos.length} veterinario{matchingExcluidos.length === 1 ? '' : 's'}
                        </summary>
                        <ul className="mt-2 space-y-1.5">
                          {matchingExcluidos.map(e => (
                            <li key={e.id} className="flex gap-2">
                              <span className="text-gray-500 shrink-0">·</span>
                              <span>
                                <span className="font-medium text-gray-800">{e.nombre_completo}</span>
                                <span className="text-gray-600"> — {e.detalle}</span>
                              </span>
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </div>
                ) : (
                  <>
                    <div className="border border-gray-200 rounded-lg divide-y max-h-60 overflow-y-auto">
                      {matchingVets.map(v => {
                        const sel = vetsSeleccionados.has(v.id)
                        return (
                          <label key={v.id} className={`flex items-center gap-3 p-2.5 cursor-pointer hover:bg-gray-50 ${sel ? 'bg-indigo-50' : ''}`}>
                            <input type="checkbox" checked={sel} onChange={() => toggleVetSeleccionado(v.id)} className="w-4 h-4 shrink-0" />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-gray-900 truncate">{`${v.nombre} ${v.apellido}`.trim()}</p>
                              <p className="text-xs text-gray-500 truncate">{v.email} · {v.telefono}</p>
                            </div>
                          </label>
                        )
                      })}
                    </div>

                    {resultEnvio && (
                      <div className={`text-xs p-2.5 rounded-lg mt-2 ${resultEnvio.tipo === 'ok' ? 'bg-emerald-50 border border-emerald-200 text-emerald-800' : 'bg-red-50 border border-red-200 text-red-800'}`}>
                        {resultEnvio.mensaje}
                      </div>
                    )}

                    <div className="flex justify-between items-center mt-3">
                      <p className="text-xs text-gray-500">{vetsSeleccionados.size}/{matchingVets.length} seleccionados</p>
                      <button
                        onClick={enviarCotizacionAVets}
                        disabled={enviando || vetsSeleccionados.size === 0}
                        className="px-4 py-2 text-sm bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white font-medium rounded-lg"
                      >
                        {enviando ? 'Enviando…' : `Enviar a ${vetsSeleccionados.size}`}
                      </button>
                    </div>
                  </>
                )}
              </FichaBloque>
            )}

            {/* Acciones administrativas */}
            <div className="flex flex-wrap gap-2 justify-end pt-2 border-t border-gray-100">
              <button onClick={() => { abrirEditarCotizacion(detalleCoti); setDetalleCoti(null) }} className="px-3 py-1.5 text-xs border border-gray-300 rounded-lg hover:bg-gray-50 font-medium">
                Editar
              </button>
              {detalleCoti.estado === 'confirmada' && (
                <button onClick={() => { marcarRealizada(detalleCoti.id); setDetalleCoti(null) }} className="px-3 py-1.5 text-xs bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-medium">
                  Marcar realizada
                </button>
              )}
              {!['realizada', 'cancelada'].includes(detalleCoti.estado) && (
                <button onClick={() => { cancelarCotizacion(detalleCoti.id); setDetalleCoti(null) }} className="px-3 py-1.5 text-xs text-amber-700 hover:bg-amber-50 border border-amber-200 rounded-lg font-medium">
                  Cancelar
                </button>
              )}
              <button onClick={() => { eliminarCotizacion(detalleCoti.id); setDetalleCoti(null) }} className="px-3 py-1.5 text-xs text-red-600 hover:bg-red-50 border border-red-200 rounded-lg font-medium">
                Eliminar
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Modal vet */}
      <Modal open={showVetModal} onClose={() => setShowVetModal(false)} title={editingVet ? 'Editar veterinario' : 'Nuevo veterinario'}>
        <form onSubmit={guardarVet} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Nombre" required>
              <input type="text" required value={vetForm.nombre} onChange={e => setVetForm({ ...vetForm, nombre: e.target.value })} className={inputCls} />
            </Field>
            <Field label="Apellido" required>
              <input type="text" required value={vetForm.apellido} onChange={e => setVetForm({ ...vetForm, apellido: e.target.value })} className={inputCls} />
            </Field>
            <Field label="Email" required>
              <input type="email" required value={vetForm.email} onChange={e => setVetForm({ ...vetForm, email: e.target.value })} className={inputCls} />
            </Field>
            <Field label="Teléfono (9 dígitos)" required>
              <input type="tel" required value={vetForm.telefono} onChange={e => setVetForm({ ...vetForm, telefono: e.target.value.replace(/\D/g, '').slice(0, 9) })} className={inputCls} />
            </Field>
            <Field label="RUT" required>
              <input type="text" required value={vetForm.rut} onChange={e => setVetForm({ ...vetForm, rut: e.target.value })} className={inputCls} placeholder="12345678-9" />
            </Field>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1.5">
              Comunas donde atiende <span className="text-red-500">*</span>
            </label>
            <ComunaPicker value={vetForm.comunas} onChange={setComunasForm} />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-xs font-medium text-gray-700">Días y horarios de disponibilidad <span className="text-red-500">*</span></label>
              <button
                type="button"
                onClick={() => setVetForm(f => ({ ...f, horarios: horariosTodos() }))}
                className="text-xs text-indigo-600 hover:text-indigo-800 font-medium"
              >
                Marcar toda la semana
              </button>
            </div>
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
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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

/** Sección agrupada dentro de la ficha completa de cotización. */
function FichaBloque({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="bg-gray-50/70 border border-gray-200 rounded-xl p-3">
      <h3 className="text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-2">{titulo}</h3>
      <div className="space-y-1.5">{children}</div>
    </div>
  )
}

/** Fila label-valor dentro de un FichaBloque. */
function FichaRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3 text-xs">
      <span className="text-gray-500 shrink-0">{label}</span>
      <span className="text-gray-900 text-right min-w-0">{value}</span>
    </div>
  )
}

/**
 * Tarjeta compacta de cotización para el Kanban. Muestra el resumen
 * pedido por el usuario (mascota, vet, fecha+hora, dirección+comuna) y
 * abre la ficha completa al hacer clic. En histórico además se ve el
 * estado de pago con un botón inline para marcar pagado.
 */
function CotizacionCard({
  c, showPago, onOpen, onMarcarPagado,
}: {
  c: Cotizacion
  showPago: boolean
  onOpen: () => void
  onMarcarPagado: () => void
}) {
  const cancelada = c.estado === 'cancelada'
  return (
    <div
      onClick={onOpen}
      className={`bg-white rounded-lg border shadow-sm hover:shadow-md hover:border-indigo-300 transition-all cursor-pointer p-3 ${
        cancelada ? 'border-gray-200 opacity-70' : 'border-gray-200'
      }`}
    >
      {/* Header: mascota + N° */}
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-gray-900 truncate leading-tight">
            {c.mascota_nombre || '(sin nombre)'}
          </p>
          <p className="text-[11px] text-gray-500 mt-0.5">
            {c.especie} · {c.peso} kg
          </p>
        </div>
        <span className="text-[10px] text-gray-400 font-medium shrink-0">N° {c.id}</span>
      </div>

      {/* Vet asignado */}
      {c.vet_nombre_asignado && (
        <p className="text-xs text-gray-700 mt-1 flex items-center gap-1">
          <span className="text-gray-400">🩺</span>
          <span className="truncate">{c.vet_nombre_asignado}</span>
        </p>
      )}

      {/* Fecha y hora */}
      <p className="text-xs text-gray-600 mt-1 flex items-center gap-1">
        <span className="text-gray-400">📅</span>
        {formatDate(c.fecha_servicio)} · {formatHoraDia(c.hora_servicio)}
      </p>

      {/* Dirección + comuna */}
      <p className="text-xs text-gray-600 mt-1 flex items-start gap-1">
        <span className="text-gray-400 shrink-0">📍</span>
        <span className="truncate">{c.direccion}, {c.comuna}</span>
      </p>

      {/* Footer: estado de pago (solo histórico) */}
      {showPago && c.estado === 'realizada' && (
        <div className="mt-2 pt-2 border-t border-gray-100">
          {c.estado_pago === 'pago_confirmado' ? (
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase px-2 py-1 rounded bg-emerald-100 text-emerald-700">
              ✓ Pago confirmado
            </span>
          ) : (
            <button
              onClick={e => { e.stopPropagation(); onMarcarPagado() }}
              className="w-full text-[11px] font-semibold uppercase px-2 py-1 rounded bg-amber-100 text-amber-700 hover:bg-amber-200 transition-colors"
            >
              ⏱ Pendiente · marcar pagado
            </button>
          )}
        </div>
      )}
      {showPago && c.estado === 'cancelada' && (
        <div className="mt-2 pt-2 border-t border-gray-100">
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase px-2 py-1 rounded bg-red-50 text-red-600">
            Cancelada
          </span>
        </div>
      )}
    </div>
  )
}

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
