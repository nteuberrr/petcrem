'use client'
import { useState, useEffect, useCallback, useMemo } from 'react'
import { Toggle } from '@/components/ui/Toggle'
import { Modal } from '@/components/ui/Modal'
import { Badge } from '@/components/ui/Badge'
import ComunaPicker from '@/components/ui/ComunaPicker'
import { fmtPrecio } from '@/lib/format'
import { incluyeCremacion } from '@/lib/eutanasia-cremacion'
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
  tipo_servicio_cremacion?: string
  incluye_cremacion?: string
  cliente_id?: string
  notas: string
  estado: string
  vet_id_asignado: string
  vet_nombre_asignado: string
  vet_email_asignado: string
  precio_snapshot: string
  consulta_vet_snapshot?: string
  estado_pago?: string
  fecha_pago?: string
  fecha_realizacion?: string
  fecha_creacion: string
  /** Derivado: la eutanasia se marcó no realizada pero la ficha de cremación ya estaba ingresada. */
  ficha_ingresada?: string
  ficha_codigo?: string
}

interface ColumnaConfig {
  key: 'enviadas' | 'aceptadas' | 'historico'
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
    header: 'bg-brand/10 text-brand border-brand/30',
    matches: c => c.estado === 'creada' || c.estado === 'enviada',
  },
  {
    key: 'aceptadas',
    titulo: 'Aceptadas / en evaluación',
    descripcion: 'Un veterinario la tomó; coordina, evalúa y marca el resultado',
    header: 'bg-amber-50 text-amber-800 border-amber-200',
    matches: c => c.estado === 'aceptada',
  },
  {
    key: 'historico',
    titulo: 'Histórico',
    descripcion: 'Realizadas, no realizadas o canceladas',
    header: 'bg-emerald-50 text-emerald-800 border-emerald-200',
    matches: c => c.estado === 'realizada' || c.estado === 'no_realizada' || c.estado === 'cancelada',
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
    case 'realizada': return 'bg-green-200 text-green-800'
    case 'no_realizada': return 'bg-slate-200 text-slate-700'
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
  // Datos de transferencia (los carga el vet por el link datos-pago, consumo único).
  banco?: string
  tipo_cuenta?: string
  numero_cuenta?: string
  datos_pago_completos?: string
  fecha_datos_pago?: string
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
  // ¿La cotización manual incluye cremación? Por defecto SÍ (servicio integral
  // recomendado: coordinamos eutanasia + cremación con el vet de punta a punta).
  const [nuevaConCremacion, setNuevaConCremacion] = useState(true)
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
    setTramos(Array.isArray(d?.tramos) ? d.tramos : Array.isArray(d) ? d : [])
  }, [])

  // Cargo fijo del cliente (precio al cliente = precio del vet + fijo). Ya no se
  // edita desde la UI: la tabla de tramos muestra el total "Al cliente"; el valor
  // se mantiene en config y se usa para calcular esa columna.
  const [fijo, setFijo] = useState<number>(0)

  // Consulta cuando la eutanasia NO se realiza: total al cliente = fijo vet + spread Alma.
  const [consultaVetInput, setConsultaVetInput] = useState('')
  const [consultaAlmaInput, setConsultaAlmaInput] = useState('')
  const [savingConsulta, setSavingConsulta] = useState(false)
  const [consultaMsg, setConsultaMsg] = useState('')

  // Recargo fuera de horario (finde/feriado/≥19:00 L-V): se suma al valor de la
  // eutanasia (aparte de la boleta) y se cobra una sola vez aunque haya cremación.
  const [recargoInput, setRecargoInput] = useState('')
  const [savingRecargo, setSavingRecargo] = useState(false)
  const [recargoMsg, setRecargoMsg] = useState('')

  const cargarFijo = useCallback(async () => {
    const r = await fetch('/api/eutanasias/config', { cache: 'no-store' })
    if (!r.ok) return
    const d = await r.json().catch(() => null)
    if (d && typeof d.fijo === 'number') setFijo(d.fijo)
    if (d && typeof d.consulta_vet === 'number') setConsultaVetInput(String(d.consulta_vet))
    if (d && typeof d.consulta_alma === 'number') setConsultaAlmaInput(String(d.consulta_alma))
    if (d && typeof d.recargo_fuera_horario === 'number') setRecargoInput(String(d.recargo_fuera_horario))
  }, [])

  const consultaTotal = (parseInt(consultaVetInput, 10) || 0) + (parseInt(consultaAlmaInput, 10) || 0)

  async function guardarConsulta() {
    setSavingConsulta(true)
    setConsultaMsg('')
    try {
      const vet = parseInt(consultaVetInput, 10)
      const alma = parseInt(consultaAlmaInput, 10)
      if (isNaN(vet) || vet < 0 || isNaN(alma) || alma < 0) { setConsultaMsg('Valores inválidos'); return }
      const r = await fetch('/api/eutanasias/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ consulta_vet: vet, consulta_alma: alma }),
      })
      const d = await r.json().catch(() => ({}))
      if (r.ok) {
        setConsultaVetInput(String(d.consulta_vet ?? vet))
        setConsultaAlmaInput(String(d.consulta_alma ?? alma))
        setConsultaMsg('Guardado ✓')
        setTimeout(() => setConsultaMsg(''), 2500)
      } else {
        setConsultaMsg(d.error || 'Error al guardar')
      }
    } finally {
      setSavingConsulta(false)
    }
  }

  async function guardarRecargo() {
    setSavingRecargo(true)
    setRecargoMsg('')
    try {
      const monto = parseInt(recargoInput, 10)
      if (isNaN(monto) || monto < 0) { setRecargoMsg('Valor inválido'); return }
      const r = await fetch('/api/eutanasias/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recargo_fuera_horario: monto }),
      })
      const d = await r.json().catch(() => ({}))
      if (r.ok) {
        setRecargoInput(String(d.recargo_fuera_horario ?? monto))
        setRecargoMsg('Guardado ✓')
        setTimeout(() => setRecargoMsg(''), 2500)
      } else {
        setRecargoMsg(d.error || 'Error al guardar')
      }
    } finally {
      setSavingRecargo(false)
    }
  }

  useEffect(() => {
    cargarVets()
    cargarTramos()
    cargarFijo()
    cargarCotis()
  }, [cargarVets, cargarTramos, cargarFijo, cargarCotis])

  // ─── Cotizaciones handlers ────────────────────────────────────────────────
  function abrirNuevaCotizacion() {
    setCotiForm(cotizacionFormDefault())
    setNuevaConCremacion(true)
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
          incluye_cremacion: nuevaConCremacion,
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
    if (!confirm('¿Marcar como realizada? Se le enviará al tutor el agradecimiento con la reseña.')) return
    await fetch(`/api/eutanasias/cotizaciones/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ estado: 'realizada' }),
    })
    await cargarCotis()
  }

  async function marcarNoRealizada(id: string) {
    if (!confirm('¿Marcar como NO realizada? Se paga la consulta al veterinario y se elimina el borrador de cremación.')) return
    await fetch(`/api/eutanasias/cotizaciones/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ estado: 'no_realizada' }),
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
      enviadas: [], aceptadas: [], historico: [],
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

  // Prende/apaga "incluye cremación" en la cotización. Con cremación: el chofer
  // retira → aparece en el dashboard, ocupa la agenda y tiene ficha de cremación.
  // Sin cremación: solo recordatorio gris en el calendario.
  const [guardandoCrem, setGuardandoCrem] = useState(false)
  async function cambiarIncluyeCremacion(id: string, incluir: boolean) {
    setGuardandoCrem(true)
    try {
      const r = await fetch(`/api/eutanasias/cotizaciones/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ incluye_cremacion: incluir }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) { alert(d?.error || 'No se pudo actualizar.'); return }
      if (d?.aviso) alert(d.aviso)
      // Reflejar en el modal abierto + refrescar la lista.
      setDetalleCoti(prev => prev && prev.id === id
        ? { ...prev, incluye_cremacion: incluir ? 'TRUE' : 'FALSE', cliente_id: typeof d.cliente_id === 'string' ? d.cliente_id : prev.cliente_id }
        : prev)
      await cargarCotis()
    } finally {
      setGuardandoCrem(false)
    }
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
        <h1 className="text-xl sm:text-2xl font-extrabold text-brand tracking-tight mt-1">Eutanasias</h1>
        <p className="text-gray-500 text-xs sm:text-sm mt-1">Convenio de eutanasias a domicilio: cotizaciones, veterinarios participantes y precios.</p>
      </header>

      {/* Selector de sub-módulo (por ahora único, preparado para más en el futuro). */}
      <div className="flex gap-2 mb-5">
        <button
          className="text-xs font-semibold px-3 py-1.5 rounded-full bg-brand text-white cursor-default"
          disabled
        >
          Eutanasias
        </button>
      </div>

      <div className="flex gap-2 flex-wrap mb-6">
        {TABS.map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              tab === t ? 'bg-brand text-white' : 'bg-white border border-gray-300 text-gray-600 hover:bg-gray-50'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'Cotizaciones' && (
        <section>
          <div className="flex flex-col md:flex-row gap-3 md:items-end justify-between mb-5">
            <div>
              <p className="text-sm text-gray-600">Cada cotización avanza por las columnas a medida que el veterinario va respondiendo los correos.</p>
            </div>
            <button
              onClick={abrirNuevaCotizacion}
              className="w-full md:w-auto px-4 py-2 bg-brand hover:bg-brand-dark text-white text-sm font-medium rounded-lg shadow-md"
            >
              + Nueva cotización
            </button>
          </div>

          {loadingCotis && cotis.length === 0 ? (
            <div className="bg-white rounded-xl shadow-md border border-gray-300 p-8 text-center text-gray-500">Cargando…</div>
          ) : (
            <div className="grid gap-3 sm:gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 items-start">
              {COLUMNAS_COTI.map(col => {
                const items = cotisPorColumna[col.key]
                return (
                  <div key={col.key} className="bg-gray-50/80 rounded-xl border border-gray-300/70 flex flex-col min-h-[120px]">
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
              className="w-full md:w-auto px-4 py-2 bg-brand hover:bg-brand-dark text-white text-sm font-medium rounded-lg"
            >
              + Agregar veterinario
            </button>
          </div>

          <div className="bg-white rounded-xl shadow-md border border-gray-300 overflow-hidden">
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
                            <div className={`text-[10px] font-medium mt-0.5 ${(v.datos_pago_completos || '').toUpperCase() === 'TRUE' ? 'text-emerald-600' : 'text-amber-600'}`}>
                              {(v.datos_pago_completos || '').toUpperCase() === 'TRUE' ? '💳 Datos de pago ✓' : '⏳ Sin datos de pago'}
                            </div>
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
                                  <span key={d.key} className="text-[10px] bg-brand/10 text-brand px-1.5 py-0.5 rounded">
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
                              className="text-brand hover:text-brand text-xs font-medium mr-2"
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
            Total: {vetsFiltrados.length} de {vets.length} · Link público de inscripción: <a className="text-brand hover:underline" href="/convenio-eutanasias" target="_blank">/convenio-eutanasias</a>
          </p>
        </section>
      )}

      {tab === 'Precios' && (
        <section>
          {/* Consulta cuando la eutanasia NO se realiza (evaluación a domicilio) */}
          <div className="bg-white rounded-xl shadow-md border border-gray-300 p-4 sm:p-5 mb-5 max-w-2xl">
            <h3 className="text-sm font-semibold text-gray-900">Consulta <span className="text-gray-400 font-normal">(si la eutanasia NO se realiza)</span></h3>
            <p className="text-xs text-gray-500 mt-1">
              El veterinario va, <strong>evalúa</strong> y, si no corresponde realizar la eutanasia, se cobra el valor de la <strong>consulta</strong>.
              El total al cliente es la suma de la comisión del veterinario y el spread de Alma Animal.
              <br />
              <span className="text-gray-400">Total al cliente = fijo veterinario + spread Alma Animal.</span>
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Fijo veterinario</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
                  <input type="number" min="0" step="1000" value={consultaVetInput}
                    onChange={e => setConsultaVetInput(e.target.value)}
                    className="w-full pl-7 pr-3 py-2 border border-gray-300 rounded-lg text-base sm:text-sm" placeholder="30000" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Spread Alma Animal</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
                  <input type="number" min="0" step="1000" value={consultaAlmaInput}
                    onChange={e => setConsultaAlmaInput(e.target.value)}
                    className="w-full pl-7 pr-3 py-2 border border-gray-300 rounded-lg text-base sm:text-sm" placeholder="10000" />
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3 mt-3">
              <div className="text-sm">
                <span className="text-gray-500">Total al cliente:</span>{' '}
                <span className="font-semibold text-brand">{fmtPrecio(consultaTotal)}</span>
              </div>
              <button
                onClick={guardarConsulta}
                disabled={savingConsulta}
                className="ml-auto px-4 py-2 bg-brand hover:bg-brand-dark disabled:bg-brand/40 text-white text-sm font-medium rounded-lg"
              >
                {savingConsulta ? 'Guardando…' : 'Guardar'}
              </button>
              {consultaMsg && <span className={`text-xs font-medium ${consultaMsg.includes('✓') ? 'text-emerald-600' : 'text-red-600'}`}>{consultaMsg}</span>}
            </div>
          </div>

          {/* Recargo fuera de horario del servicio de eutanasia a domicilio */}
          <div className="bg-white rounded-xl shadow-md border border-gray-300 p-4 sm:p-5 mb-5 max-w-2xl">
            <h3 className="text-sm font-semibold text-gray-900">Recargo fuera de horario <span className="text-gray-400 font-normal">(fin de semana, feriado o desde las 19:00)</span></h3>
            <p className="text-xs text-gray-500 mt-1">
              Se le suma al valor de la eutanasia cuando el servicio es fuera de horario. Se cobra <strong>junto con la eutanasia</strong> (aparte de la boleta) y <strong>una sola vez</strong>: si además hay cremación, el retiro no vuelve a sumar su propio recargo. Aplica se realice o no la eutanasia.
            </p>
            <div className="flex items-end gap-3 mt-3">
              <div className="w-40">
                <label className="block text-xs font-medium text-gray-700 mb-1">Monto</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
                  <input type="number" min="0" step="1000" value={recargoInput}
                    onChange={e => setRecargoInput(e.target.value)}
                    className="w-full pl-7 pr-3 py-2 border border-gray-300 rounded-lg text-base sm:text-sm" placeholder="10000" />
                </div>
              </div>
              <button
                onClick={guardarRecargo}
                disabled={savingRecargo}
                className="ml-auto px-4 py-2 bg-brand hover:bg-brand-dark disabled:bg-brand/40 text-white text-sm font-medium rounded-lg"
              >
                {savingRecargo ? 'Guardando…' : 'Guardar'}
              </button>
              {recargoMsg && <span className={`text-xs font-medium ${recargoMsg.includes('✓') ? 'text-emerald-600' : 'text-red-600'}`}>{recargoMsg}</span>}
            </div>
          </div>

          <div className="flex flex-col md:flex-row md:items-end justify-between gap-3 mb-4 max-w-2xl">
            <div>
              <p className="text-sm text-gray-600">Precio que <strong>se paga al veterinario</strong> por servicio de eutanasia, según peso de la mascota.</p>
              <p className="text-xs text-gray-500 mt-1">Este es el precio que verán los vets en el landing del convenio. La columna <strong>“Al cliente”</strong> ya incluye el cargo fijo de {fmtPrecio(fijo)}.</p>
            </div>
            <button
              onClick={abrirNuevoTramo}
              className="w-full md:w-auto md:shrink-0 px-4 py-2 bg-brand hover:bg-brand-dark text-white text-sm font-medium rounded-lg"
            >
              + Agregar tramo
            </button>
          </div>

          <div className="bg-white rounded-xl shadow-md border border-gray-300 overflow-hidden max-w-2xl">
            {tramos.length === 0 ? (
              <div className="p-8 text-center text-gray-500">No hay tramos de precio definidos.</div>
            ) : (
              <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[480px]">
                <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                  <tr>
                    <th className="px-4 py-2 text-left">Peso (kg)</th>
                    <th className="px-4 py-2 text-right">Pago al vet</th>
                    <th className="px-4 py-2 text-right">Al cliente</th>
                    <th className="px-4 py-2 text-right w-32">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {tramos.map(t => {
                    const precioVet = parseInt(t.precio, 10) || 0
                    return (
                    <tr key={t.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-gray-900">
                        {t.peso_min} – {t.peso_max} kg
                      </td>
                      <td className="px-4 py-3 text-right font-medium text-gray-900">
                        {fmtPrecio(precioVet)}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-brand">
                        {fmtPrecio(precioVet + fijo)}
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <button onClick={() => abrirEditarTramo(t)} className="text-brand hover:text-brand text-xs font-medium mr-3">
                          Editar
                        </button>
                        <button onClick={() => eliminarTramo(t.id)} className="text-red-600 hover:text-red-800 text-xs font-medium">
                          Eliminar
                        </button>
                      </td>
                    </tr>
                  )})}
                </tbody>
              </table>
              </div>
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

          {/* ¿Incluye cremación? — segmentado compacto, por defecto CON cremación */}
          <Field label="¿Incluye cremación?">
            <div className="inline-flex rounded-lg border border-gray-300 overflow-hidden text-xs font-medium">
              <button type="button" onClick={() => setNuevaConCremacion(true)}
                className={`px-3 py-1.5 transition-colors ${nuevaConCremacion ? 'bg-brand text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
                Con cremación
              </button>
              <button type="button" onClick={() => setNuevaConCremacion(false)}
                className={`px-3 py-1.5 border-l border-gray-300 transition-colors ${!nuevaConCremacion ? 'bg-brand text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
                Solo eutanasia
              </button>
            </div>
          </Field>

          {/* Asignar vet manualmente (opcional) */}
          <div className="bg-gray-50 border border-gray-300 rounded-lg p-3">
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
              Si eliges uno, se envía al veterinario el correo de <strong>coordinación con la familia</strong> y al cliente el aviso de que un vet tomó el caso. La cotización queda <strong>aceptada</strong> y sigue el flujo hasta realizarse.
            </p>
          </div>

          {cotiError && <p className="text-sm text-red-600">{cotiError}</p>}
          <div className="flex gap-2 justify-end pt-2">
            <button type="button" onClick={() => setShowCotiModal(false)} className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">Cancelar</button>
            <button type="submit" disabled={savingCoti} className="px-4 py-2 text-sm bg-brand hover:bg-brand-dark disabled:bg-brand/40 text-white font-medium rounded-lg">
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

            <div className="bg-gray-50 border border-gray-300 rounded-lg p-3">
              <label className="block text-xs font-medium text-gray-700 mb-1.5">Veterinario asignado</label>
              <select value={editVetManualId} onChange={e => setEditVetManualId(e.target.value)} className={inputCls}>
                <option value="">— Ninguno (esperando que un vet acepte) —</option>
                {vetsActivos.map(v => (
                  <option key={v.id} value={v.id}>{`${v.nombre} ${v.apellido}`.trim()} ({v.email})</option>
                ))}
              </select>
              {editVetManualId && editVetManualId !== editCoti.vet_id_asignado && (
                <p className="text-xs text-amber-700 mt-1">Al guardar, la cotización pasará a <strong>aceptada</strong> con este vet asignado y se le enviará el correo de coordinación con la familia (más el aviso al cliente).</p>
              )}
              {!editVetManualId && editCoti.vet_id_asignado && (
                <p className="text-xs text-amber-700 mt-1">Al guardar, se quitará el vet actualmente asignado y la cotización vuelve a estado <strong>enviada</strong>.</p>
              )}
            </div>

            {editError && <p className="text-sm text-red-600">{editError}</p>}
            <div className="flex gap-2 justify-end pt-2">
              <button type="button" onClick={() => setEditCoti(null)} className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">Cancelar</button>
              <button type="submit" disabled={savingEdit} className="px-4 py-2 text-sm bg-brand hover:bg-brand-dark disabled:bg-brand/40 text-white font-medium rounded-lg">
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
                  className="text-brand hover:underline"
                >
                  {detalleCoti.direccion}, {detalleCoti.comuna}
                </a>
              } />
              <FichaRow label="Pago al vet" value={<span className="font-semibold">{fmtPrecio(parseInt(detalleCoti.precio_snapshot, 10) || 0)}</span>} />
              {detalleCoti.notas && <FichaRow label="Notas" value={detalleCoti.notas} />}
            </FichaBloque>

            {/* Bloque: ¿Incluye cremación? — controla dashboard, agenda y etiqueta del calendario */}
            <FichaBloque titulo="Servicio">
              {(() => {
                const conCrem = incluyeCremacion(detalleCoti)
                return (
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900">¿Incluye cremación?</p>
                      <p className="text-xs text-gray-500 mt-0.5 leading-snug">
                        {conCrem
                          ? 'Con cremación: nuestro chofer pasa a retirar. Aparece en las notificaciones del dashboard, ocupa la agenda (verde) y tiene ficha de cremación.'
                          : 'Sin cremación: solo la eutanasia. Queda como recordatorio gris en el calendario, sin retiro: no notifica en el dashboard ni bloquea la agenda del chofer.'}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 pt-0.5">
                      <span className={`text-xs font-semibold ${conCrem ? 'text-brand' : 'text-gray-400'}`}>{conCrem ? 'Sí' : 'No'}</span>
                      <Toggle checked={conCrem} disabled={guardandoCrem} onChange={v => cambiarIncluyeCremacion(detalleCoti.id, v)} />
                    </div>
                  </div>
                )
              })()}
            </FichaBloque>

            {/* Bloque: Cliente */}
            <FichaBloque titulo="Cliente">
              <FichaRow label="Nombre" value={detalleCoti.cliente_nombre} />
              <FichaRow label="Teléfono" value={
                <a href={`tel:+56${detalleCoti.cliente_telefono}`} className="text-brand hover:underline">+56 {detalleCoti.cliente_telefono}</a>
              } />
              {detalleCoti.cliente_email && (
                <FichaRow label="Email" value={
                  <a href={`mailto:${detalleCoti.cliente_email}`} className="text-brand hover:underline break-all">{detalleCoti.cliente_email}</a>
                } />
              )}
            </FichaBloque>

            {/* Bloque: Veterinario asignado */}
            {detalleCoti.vet_nombre_asignado && (
              <FichaBloque titulo="Veterinario asignado">
                <FichaRow label="Nombre" value={detalleCoti.vet_nombre_asignado} />
                <FichaRow label="Email" value={
                  <a href={`mailto:${detalleCoti.vet_email_asignado}`} className="text-brand hover:underline break-all">{detalleCoti.vet_email_asignado}</a>
                } />
                {detalleCoti.estado === 'aceptada' && <p className="text-xs text-amber-700 mt-1">⏳ Coordina con la familia, evalúa y marca el resultado (realizada / no realizada).</p>}
                {detalleCoti.estado === 'realizada' && <p className="text-xs text-emerald-700 mt-1">✓ Eutanasia realizada.</p>}
                {detalleCoti.estado === 'no_realizada' && <p className="text-xs text-slate-600 mt-1">✗ Evaluada: no correspondía realizarla (se paga la consulta).</p>}
                {detalleCoti.estado === 'no_realizada' && detalleCoti.ficha_ingresada === 'TRUE' && (
                  <div className="mt-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 leading-snug">
                    ⚠️ El veterinario indicó que la eutanasia <strong>no se realizó</strong>, pero la ficha de cremación{detalleCoti.ficha_codigo ? <> <strong>{detalleCoti.ficha_codigo}</strong></> : ''} <strong>ya está ingresada</strong> (no se eliminó automáticamente). Revisa la ficha y decide si corresponde eliminarla.
                  </div>
                )}
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
                      <details className="bg-gray-50 border border-gray-300 rounded-lg p-2.5 text-xs">
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
                    <div className="border border-gray-300 rounded-lg divide-y max-h-60 overflow-y-auto">
                      {matchingVets.map(v => {
                        const sel = vetsSeleccionados.has(v.id)
                        return (
                          <label key={v.id} className={`flex items-center gap-3 p-2.5 cursor-pointer hover:bg-gray-50 ${sel ? 'bg-brand/10' : ''}`}>
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
                        className="px-4 py-2 text-sm bg-brand hover:bg-brand-dark disabled:bg-brand/40 text-white font-medium rounded-lg"
                      >
                        {enviando ? 'Enviando…' : `Enviar a ${vetsSeleccionados.size}`}
                      </button>
                    </div>
                  </>
                )}
              </FichaBloque>
            )}

            {/* Acciones administrativas */}
            <div className="flex flex-wrap gap-2 justify-end pt-2 border-t border-gray-300">
              <button onClick={() => { abrirEditarCotizacion(detalleCoti); setDetalleCoti(null) }} className="px-3 py-1.5 text-xs border border-gray-300 rounded-lg hover:bg-gray-50 font-medium">
                Editar
              </button>
              {detalleCoti.estado === 'aceptada' && (
                <>
                  <button onClick={() => { marcarRealizada(detalleCoti.id); setDetalleCoti(null) }} className="px-3 py-1.5 text-xs bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-medium">
                    Marcar realizada
                  </button>
                  <button onClick={() => { marcarNoRealizada(detalleCoti.id); setDetalleCoti(null) }} className="px-3 py-1.5 text-xs bg-slate-600 hover:bg-slate-700 text-white rounded-lg font-medium">
                    Marcar no realizada
                  </button>
                </>
              )}
              {!['realizada', 'no_realizada', 'cancelada'].includes(detalleCoti.estado) && (
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

          {/* Datos de transferencia (los carga el vet por su link; solo lectura acá) */}
          {editingVet && (
            <div className="rounded-lg border border-gray-300 bg-gray-50 p-3">
              <div className="flex items-center justify-between gap-2 mb-2">
                <p className="text-xs font-bold text-gray-700 uppercase tracking-wide">Datos de transferencia</p>
                {(editingVet.datos_pago_completos || '').toUpperCase() === 'TRUE' ? (
                  <span className="text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded">
                    ✓ Recibidos{editingVet.fecha_datos_pago ? ` · ${formatDate(editingVet.fecha_datos_pago)}` : ''}
                  </span>
                ) : (
                  <span className="text-[11px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded">⏳ Pendientes</span>
                )}
              </div>
              {(editingVet.datos_pago_completos || '').toUpperCase() === 'TRUE' ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-sm">
                  <p><span className="text-gray-500">Titular:</span> <span className="font-medium text-gray-900">{`${editingVet.nombre || ''} ${editingVet.apellido || ''}`.trim() || '—'}</span></p>
                  <p><span className="text-gray-500">RUT:</span> <span className="font-medium text-gray-900">{editingVet.rut || '—'}</span></p>
                  <p><span className="text-gray-500">Banco:</span> <span className="font-medium text-gray-900">{editingVet.banco || '—'}</span></p>
                  <p><span className="text-gray-500">Tipo de cuenta:</span> <span className="font-medium text-gray-900">{editingVet.tipo_cuenta || '—'}</span></p>
                  <p className="sm:col-span-2"><span className="text-gray-500">N° de cuenta:</span> <span className="font-mono font-semibold text-gray-900">{editingVet.numero_cuenta || '—'}</span></p>
                </div>
              ) : (
                <p className="text-xs text-gray-500">El veterinario todavía no cargó sus datos bancarios (los completa con el link que recibe por correo). Aparecerán acá apenas los envíe.</p>
              )}
            </div>
          )}

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
                className="text-xs text-brand hover:text-brand font-medium"
              >
                Marcar toda la semana
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="text-xs border border-gray-300 rounded-lg w-full">
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
            <button type="submit" disabled={savingVet} className="px-4 py-2 text-sm bg-brand hover:bg-brand-dark disabled:bg-brand/40 text-white font-medium rounded-lg">
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
            <button type="submit" disabled={savingTramo} className="px-4 py-2 text-sm bg-brand hover:bg-brand-dark disabled:bg-brand/40 text-white font-medium rounded-lg">
              {savingTramo ? 'Guardando…' : (editingTramo ? 'Guardar cambios' : 'Crear tramo')}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  )
}

const inputCls = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-brand focus:border-brand outline-none'

/** Sección agrupada dentro de la ficha completa de cotización. */
function FichaBloque({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="bg-gray-50/70 border border-gray-300 rounded-xl p-3">
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
      className={`bg-white rounded-lg border shadow-md hover:shadow-md hover:border-brand/40 transition-all cursor-pointer p-3 ${
        cancelada ? 'border-gray-300 opacity-70' : 'border-gray-300'
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

      {/* Sin cremación: solo eutanasia (recordatorio gris, sin retiro del chofer) */}
      {!incluyeCremacion(c) && (
        <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-gray-600 bg-gray-100 border border-gray-300 px-1.5 py-0.5 rounded mb-0.5">
          🚫 Sin cremación
        </span>
      )}

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

      {/* Alerta: el vet marcó "no realizada" pero la ficha de cremación ya estaba ingresada. */}
      {c.estado === 'no_realizada' && c.ficha_ingresada === 'TRUE' && (
        <div className="mt-2 rounded-md border border-amber-300 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-900 leading-tight">
          ⚠️ El veterinario indicó que <strong>no se realizó</strong>, pero la ficha de cremación{c.ficha_codigo ? <> <strong>{c.ficha_codigo}</strong></> : ''} ya está ingresada. Revísala.
        </div>
      )}

      {/* Footer histórico: resultado + valor a pagar al vet + estado de pago */}
      {showPago && (c.estado === 'realizada' || c.estado === 'no_realizada') && (() => {
        const realizada = c.estado === 'realizada'
        const pagoVet = realizada
          ? (parseInt(c.precio_snapshot || '0', 10) || 0)
          : (parseInt(c.consulta_vet_snapshot || '0', 10) || 0)
        return (
          <div className="mt-2 pt-2 border-t border-gray-300 space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className={`inline-flex items-center gap-1 text-[10px] font-semibold uppercase px-2 py-1 rounded ${realizada ? 'bg-green-100 text-green-800' : 'bg-slate-200 text-slate-700'}`}>
                {realizada ? '✓ Realizada' : '✗ No realizada'}
              </span>
              <span className="text-[11px] text-gray-700 whitespace-nowrap">
                Pago vet: <strong>{fmtPrecio(pagoVet)}</strong>
              </span>
            </div>
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
        )
      })()}
      {showPago && c.estado === 'cancelada' && (
        <div className="mt-2 pt-2 border-t border-gray-300">
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
