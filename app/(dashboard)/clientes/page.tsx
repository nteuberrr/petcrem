'use client'
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import Link from 'next/link'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import AddressAutocomplete from '@/components/ui/AddressAutocomplete'
import { fmtKg, fmtPrecio, fmtFecha } from '@/lib/format'
import { todayISO, formatDateForSheet } from '@/lib/dates'
import { parseDecimal, parsePeso } from '@/lib/numbers'
import { findTramo } from '@/lib/tramos'
import { anforaPremiumIncluida, servicioIncluyeAnforaPremium } from '@/lib/anforas-premium'
import { aplicaReglaAuto, etiquetaRegla } from '@/lib/adicionales-auto'

type Cliente = {
  id: string; codigo: string; nombre_mascota: string; nombre_tutor: string
  email?: string; telefono?: string
  especie: string; peso_declarado?: string; peso_ingreso?: string
  tipo_servicio: string; codigo_servicio: string
  estado: string; estado_pago?: string; tipo_pago?: string
  fecha_retiro: string; hora_retiro?: string; fecha_creacion: string; ciclo_id: string
  direccion_retiro?: string; direccion_despacho?: string; comuna?: string
  adicionales?: string
  veterinaria_id?: string; notas?: string
  fotos_cuadro?: string; videos_servicio?: string
  correo_diferencia_fecha?: string
  precio_servicio?: string; precio_adicionales?: string; precio_total?: string
  descuento_monto?: string; descuento_nombre?: string
}
type Especie = { id: string; nombre: string; letra: string; activo: string }
type Veterinario = { id: string; nombre: string; activo: string; tipo_precios?: string }
type Producto = { id: string; nombre: string; precio: string; stock: string; categoria?: string; activo: string }
type OtroServicio = { id: string; nombre: string; precio: string; activo: string; auto_regla?: string; comunas?: string }
type AdicionalItem = { tipo: 'producto' | 'servicio'; id: string; nombre: string; precio: number; qty: number }
type Descuento = { id: string; nombre: string; tipo: string; valor: string; activo: string }

const NOMBRE_MODALIDAD: Record<string, string> = { CI: 'Cremación Individual', CP: 'Cremación Premium', SD: 'Cremación Sin Devolución' }
const intCLP = (v: unknown) => parseInt(String(v ?? '').replace(/[^\d-]/g, ''), 10) || 0
type Tramo = { id: string; peso_min: string; peso_max: string; precio_ci: string; precio_cp: string; precio_sd: string }
type TramoEspecial = Tramo & { veterinaria_id: string }
type FichaCreada = {
  codigo: string
  nombre_mascota: string
  nombre_tutor: string
  codigo_servicio: string
  precio_servicio: number
  precio_normal: number
  mostrar_precio_normal: boolean
  tabla_nombre: string
  rango_tramo: string | null
  peso_kg: number
  adicionales: AdicionalItem[]
  total_adicionales: number
  descuento_nombre: string
  descuento_etiqueta: string
  descuento_monto: number
  total: number
}

const FORM_DEFAULT = {
  nombre_mascota: '',
  nombre_tutor: '',
  email: '',
  telefono: '',
  direccion_retiro: '',
  direccion_despacho: '',
  misma_direccion: false,
  comuna: '',
  fecha_retiro: '',
  hora_retiro: '',
  fecha_defuncion: '',
  especie: '',
  letra_especie: '',
  peso_declarado: '',
  tipo_servicio: 'Cremación Individual',
  codigo_servicio: 'CI',
  veterinaria_id: '',
  tipo_pago: '',
  estado_pago: 'pendiente',
}

const SERVICIOS = [
  { nombre: 'Cremación Individual', codigo: 'CI' },
  { nombre: 'Cremación Premium', codigo: 'CP' },
  { nombre: 'Cremación Sin Devolución', codigo: 'SD' },
]

export default function ClientesPage() {
  const [clientes, setClientes] = useState<Cliente[]>([])
  const [buscar, setBuscar] = useState('')
  const [filtro, setFiltro] = useState<'todos' | 'borrador' | 'pendiente' | 'cremado' | 'despachado' | 'pago_pendiente' | 'este_mes' | 'esta_semana' | 'datos_pendientes' | 'falta_peso' | 'diferencia' | 'pendiente_cobro'>('todos')
  const [filtroVet, setFiltroVet] = useState('') // '' = todas · '__general__' = sin vet · id de vet
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  // Agendamiento manual (retiro registrado a mano → ficha borrador + confirmación WhatsApp)
  const AGENDA_DEFAULT = { cliente_nombre: '', telefono: '', nombre_mascota: '', direccion: '', comuna: '', codigo_servicio: 'CI', fecha_retiro: '', hora_retiro: '', peso: '' }
  const [showAgenda, setShowAgenda] = useState(false)
  const [agendaForm, setAgendaForm] = useState(AGENDA_DEFAULT)
  const [agendaSaving, setAgendaSaving] = useState(false)
  const agendaSavingRef = useRef(false)
  const [agendaError, setAgendaError] = useState('')
  const [selected, setSelected] = useState<Cliente | null>(null)
  const [especies, setEspecies] = useState<Especie[]>([])
  const [veterinarias, setVeterinarias] = useState<Veterinario[]>([])
  const [productosDisp, setProductosDisp] = useState<Producto[]>([])
  const [otrosServicios, setOtrosServicios] = useState<OtroServicio[]>([])
  // Lógica invertida: por defecto es General (sin veterinaria). El checkbox
  // dice "Cliente de Veterinaria" — al marcarlo aparece el selector.
  const [esClienteVet, setEsClienteVet] = useState(false)
  const noEsVeterinaria = !esClienteVet
  const [adicionales, setAdicionales] = useState<AdicionalItem[]>([])
  const [showAdicionales, setShowAdicionales] = useState(false)
  const [descuentosDisp, setDescuentosDisp] = useState<Descuento[]>([])
  const [aplicarDescuento, setAplicarDescuento] = useState(false)
  const [descuentoId, setDescuentoId] = useState('')
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)  // guard anti doble-click al crear ficha (ver handleSubmit)
  const [form, setForm] = useState(FORM_DEFAULT)
  // Pago parcial en el alta manual: monto abonado (el resto queda como saldo pendiente).
  const [abonoNueva, setAbonoNueva] = useState('')
  const [formError, setFormError] = useState('')
  const [preciosGenerales, setPreciosGenerales] = useState<Tramo[]>([])
  const [preciosConvenio, setPreciosConvenio] = useState<Tramo[]>([])
  const [tramosEspeciales, setTramosEspeciales] = useState<TramoEspecial[]>([])
  const [fichaCreada, setFichaCreada] = useState<FichaCreada | null>(null)

  // Declarados ANTES que los useMemo/funciones que los usan (kpis, tieneDiferenciaPorCobrar):
  // encontrarTramo es un const (no hoisteable) — declararlo más abajo rompía la página con
  // "Cannot access 'encontrarTramo' before initialization" apenas hubiera un cliente con
  // peso_ingreso > peso_declarado. Regla de borde canónica (única fuente): lib/tramos.ts
  // findTramo — intervalos (min, max], en el límite gana el MENOR.
  const encontrarTramo = (tabla: Tramo[], peso: number): Tramo | null => findTramo(tabla, peso)
  function precioDelTramo(t: Tramo | null, codigo: string): number {
    if (!t) return 0
    const raw = codigo === 'CP' ? t.precio_cp : codigo === 'SD' ? t.precio_sd : t.precio_ci
    return parseFloat(raw) || 0
  }
  // Cobros NO pagados (tabla `cobros`): diferencia de peso o producto adicional que
  // ya se cobró al tutor pero todavía no se marca como pagado. Alimenta el chip
  // "pendiente de cobro" (distinto de la diferencia SUGERIDA, que es pre-cobro).
  const [cobrosPend, setCobrosPend] = useState<{ cliente_id: string; monto: string; detalle: string; tipo: string }[]>([])

  const fetchClientes = useCallback(async () => {
    setLoading(true)
    const res = await fetch('/api/clientes')
    const data = await res.json()
    setClientes(Array.isArray(data) ? data : [])
    setLoading(false)
  }, [])

  useEffect(() => { fetchClientes() }, [fetchClientes])

  const fetchCobros = useCallback(async () => {
    try {
      const r = await fetch('/api/cobros')
      const d = await r.json()
      setCobrosPend(Array.isArray(d.cobros) ? d.cobros : [])
    } catch { setCobrosPend([]) }
  }, [])
  useEffect(() => { fetchCobros() }, [fetchCobros])

  useEffect(() => {
    fetch('/api/especies').then(r => r.json()).then(d => setEspecies(Array.isArray(d) ? d.filter((e: Especie) => e.activo === 'TRUE') : []))
    fetch('/api/veterinarios?activo=true').then(r => r.json()).then(d => setVeterinarias(Array.isArray(d) ? d : []))
    fetch('/api/productos').then(r => r.json()).then(d => {
      if (!Array.isArray(d)) return setProductosDisp([])
      const vistos = new Set<string>()
      setProductosDisp(d.filter((p: Producto) => p.activo === 'TRUE' && !vistos.has(p.id) && (vistos.add(p.id), true)))
    })
    fetch('/api/servicios?tipo=otros').then(r => r.json()).then(d => {
      if (!Array.isArray(d)) return setOtrosServicios([])
      const vistos = new Set<string>()
      setOtrosServicios(d.filter((s: OtroServicio) => s.activo === 'TRUE' && !vistos.has(s.id) && (vistos.add(s.id), true)))
    })
    fetch('/api/precios?tipo=general').then(r => r.json()).then(d => setPreciosGenerales(Array.isArray(d) ? d : []))
    fetch('/api/precios?tipo=convenio').then(r => r.json()).then(d => setPreciosConvenio(Array.isArray(d) ? d : []))
    fetch('/api/descuentos').then(r => r.json()).then(d => setDescuentosDisp(Array.isArray(d) ? d.filter((x: Descuento) => x.activo === 'TRUE') : []))
  }, [])

  // Cargar precios especiales cuando se selecciona una veterinaria con esa modalidad.
  useEffect(() => {
    const vetId = form.veterinaria_id
    if (!vetId || noEsVeterinaria) { setTramosEspeciales([]); return }
    const vet = veterinarias.find(v => v.id === vetId)
    if (vet?.tipo_precios === 'precios_especiales') {
      fetch(`/api/precios/especiales?veterinaria_id=${vetId}`)
        .then(r => r.json())
        .then(d => setTramosEspeciales(Array.isArray(d) ? d : []))
    } else {
      setTramosEspeciales([])
    }
  }, [form.veterinaria_id, noEsVeterinaria, veterinarias])

  // KPIs derivados
  const kpis = useMemo(() => {
    const total = clientes.length
    const hoy = new Date()
    const startMes = new Date(hoy.getFullYear(), hoy.getMonth(), 1)
    const startSemana = new Date(hoy)
    startSemana.setDate(hoy.getDate() - 6)
    startSemana.setHours(0, 0, 0, 0)

    const parseFecha = (s?: string) => {
      if (!s) return null
      const iso = formatDateForSheet(s)
      if (!iso) return null
      const d = new Date(`${iso}T12:00:00`)
      return isNaN(d.getTime()) ? null : d
    }

    // Keys para agrupar por mes (YYYY-MM) y semana (YYYY-WW) — usadas en el promedio histórico
    const mesKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const semanaKey = (d: Date) => {
      const yearStart = new Date(d.getFullYear(), 0, 1)
      const diffDays = Math.floor((d.getTime() - yearStart.getTime()) / 86400000)
      const wk = Math.floor(diffDays / 7) + 1
      return `${d.getFullYear()}-W${String(wk).padStart(2, '0')}`
    }
    const mesActualKey = mesKey(hoy)
    const semanaActualKey = semanaKey(hoy)

    let delMes = 0, delaSemana = 0
    let sumaPeso = 0
    const porEspecie: Record<string, number> = {}
    const porServicio: Record<string, number> = {}
    const clientesPendientesPago: Cliente[] = []
    // Histórico: buckets por mes/semana SOLO de periodos cerrados (excluye el actual)
    const bucketsMes: Record<string, number> = {}
    const bucketsSemana: Record<string, number> = {}

    for (const c of clientes) {
      // Driver: fecha_retiro (solo esa, no fallback)
      const fecha = parseFecha(c.fecha_retiro)
      if (fecha) {
        if (fecha >= startMes) delMes++
        if (fecha >= startSemana) delaSemana++
        const mk = mesKey(fecha)
        if (mk !== mesActualKey) bucketsMes[mk] = (bucketsMes[mk] || 0) + 1
        const wk = semanaKey(fecha)
        if (wk !== semanaActualKey) bucketsSemana[wk] = (bucketsSemana[wk] || 0) + 1
      }
      // Peso real: ingreso primero, declarado fallback. Normaliza escalamiento heredado.
      const peso = parsePeso(c.peso_ingreso) || parsePeso(c.peso_declarado)
      if (peso > 0) sumaPeso += peso
      const esp = c.especie || 'Sin especie'
      porEspecie[esp] = (porEspecie[esp] || 0) + 1
      const srv = c.codigo_servicio || 'CI'
      porServicio[srv] = (porServicio[srv] || 0) + 1
      // Borradores fuera: aún no son fichas reales (tienen su propia alerta).
      if (c.estado !== 'borrador' && c.estado_pago !== 'pagado') {
        clientesPendientesPago.push(c)
      }
    }

    // Peso promedio: total kilos / total mascotas ingresadas (todas)
    const pesoProm = total > 0 ? sumaPeso / total : 0
    const topEspecie = Object.entries(porEspecie).sort((a, b) => b[1] - a[1])[0]
    const topServicio = Object.entries(porServicio).sort((a, b) => b[1] - a[1])[0]
    const mesesCerrados = Object.keys(bucketsMes).length
    const semanasCerradas = Object.keys(bucketsSemana).length
    const promMesHist = mesesCerrados > 0
      ? Object.values(bucketsMes).reduce((s, v) => s + v, 0) / mesesCerrados
      : null
    const promSemanaHist = semanasCerradas > 0
      ? Object.values(bucketsSemana).reduce((s, v) => s + v, 0) / semanasCerradas
      : null

    return {
      total, delMes, delaSemana, pesoProm,
      topEspecie: topEspecie ? { nombre: topEspecie[0], count: topEspecie[1] } : null,
      topServicio: topServicio ? { codigo: topServicio[0], count: topServicio[1] } : null,
      porEspecie, porServicio,
      pendientesPago: clientesPendientesPago.length,
      clientesPendientesPago,
      promMesHist, mesesCerrados,
      promSemanaHist, semanasCerradas,
    }
  }, [clientes])

  // Detecta si un cliente tiene campos obligatorios sin completar.
  // Estos son los mismos campos marcados como `required` en el form de nueva ficha.
  function tieneDatosPendientes(c: Cliente): boolean {
    const vacio = (v?: string) => !v || !String(v).trim()
    if (vacio(c.nombre_mascota)) return true
    if (vacio(c.nombre_tutor)) return true
    if (vacio(c.email)) return true
    if (vacio(c.telefono)) return true
    if (vacio(c.direccion_retiro)) return true
    if (vacio(c.direccion_despacho)) return true
    if (vacio(c.comuna)) return true
    if (vacio(c.fecha_retiro)) return true
    if (vacio(c.especie)) return true
    if (!c.peso_declarado || (parseFloat(c.peso_declarado) || 0) <= 0) return true
    if (vacio(c.codigo_servicio)) return true
    if (vacio(c.tipo_pago)) return true
    if (vacio(c.estado_pago)) return true
    return false
  }

  // Falta el PESO DE INGRESO: ficha ya en proceso (retirada, no despachada) sin
  // peso real registrado (el operador debe pesarla al recibirla).
  function faltaPesoIngreso(c: Cliente): boolean {
    return c.estado !== 'borrador' && c.estado !== 'despachado' && (!c.peso_ingreso || !c.peso_ingreso.trim())
  }

  // Hay DIFERENCIA DE PRECIO POR COBRAR: el peso de ingreso cae en un tramo más
  // caro que el declarado y todavía no se envió el cobro de diferencia.
  function tieneDiferenciaPorCobrar(c: Cliente): boolean {
    // Solo fichas EN PROCESO: una vez despachada (entregada) la ventana de cobro
    // ya pasó y sumaría ruido de fichas viejas.
    if (c.estado === 'borrador' || c.estado === 'despachado') return false
    if (c.correo_diferencia_fecha && c.correo_diferencia_fecha.trim()) return false
    const pd = parsePeso(c.peso_declarado)
    const pi = parsePeso(c.peso_ingreso)
    if (!(pi > pd)) return false
    const tabla = c.veterinaria_id ? preciosConvenio : preciosGenerales
    if (!tabla.length) return false
    const cod = c.codigo_servicio || 'CI'
    const precioPd = precioDelTramo(encontrarTramo(tabla, pd), cod)
    const precioPi = precioDelTramo(encontrarTramo(tabla, pi), cod)
    return precioPi > precioPd
  }

  // Íconos de estado para las tarjetas.
  const jsonTieneItems = (s?: string) => { try { const a = JSON.parse(s || '[]'); return Array.isArray(a) && a.length > 0 } catch { return false } }
  const esPremiumCuadro = (c: Cliente) => (c.codigo_servicio || '').toUpperCase() === 'CP'
  const solicitoVideo = (c: Cliente) => (c.notas || '').includes('El tutor solicitó el video')

  // Ids de fichas con al menos un cobro NO pagado (de la tabla `cobros`).
  const idsConCobroPendiente = useMemo(() => new Set(cobrosPend.map(c => String(c.cliente_id))), [cobrosPend])

  // Resultados filtrados por buscador + filtro
  const resultados = useMemo(() => {
    const q = buscar.trim().toLowerCase()
    const hoy = new Date()
    const startMes = new Date(hoy.getFullYear(), hoy.getMonth(), 1)
    const startSemana = new Date(hoy); startSemana.setDate(hoy.getDate() - 6); startSemana.setHours(0, 0, 0, 0)

    const parseFecha = (s?: string) => {
      if (!s) return null
      const iso = formatDateForSheet(s)
      if (!iso) return null
      const d = new Date(`${iso}T12:00:00`)
      return isNaN(d.getTime()) ? null : d
    }

    // Últimos primero (reversa)
    const ordenados = [...clientes].reverse()

    return ordenados.filter(c => {
      // Borradores (creados por el bot, sin código aún): solo bajo "Por ingresar".
      // En el resto de vistas se ocultan porque todavía no son fichas reales.
      if (filtro === 'borrador') { if (c.estado !== 'borrador') return false }
      else if (c.estado === 'borrador') return false
      // Filtro por categoría
      if (filtro === 'pendiente' && !(c.estado === 'pendiente' || !c.estado)) return false
      if (filtro === 'cremado' && c.estado !== 'cremado') return false
      if (filtro === 'despachado' && c.estado !== 'despachado') return false
      // "Pago pendiente" = servicio no pagado O ficha con un cobro pendiente
      // (incluye el saldo de un pago parcial). Un solo filtro que las muestra todas.
      if (filtro === 'pago_pendiente' && c.estado_pago === 'pagado' && !idsConCobroPendiente.has(String(c.id))) return false
      if (filtro === 'datos_pendientes' && !tieneDatosPendientes(c)) return false
      if (filtro === 'falta_peso' && !faltaPesoIngreso(c)) return false
      if (filtro === 'diferencia' && !tieneDiferenciaPorCobrar(c)) return false
      if (filtro === 'pendiente_cobro' && !idsConCobroPendiente.has(String(c.id))) return false
      // Filtro por veterinaria (independiente del filtro de estado)
      if (filtroVet === '__general__' && (c.veterinaria_id || '').trim()) return false
      if (filtroVet && filtroVet !== '__general__' && c.veterinaria_id !== filtroVet) return false
      if (filtro === 'este_mes') {
        const f = parseFecha(c.fecha_retiro)
        if (!f || f < startMes) return false
      }
      if (filtro === 'esta_semana') {
        const f = parseFecha(c.fecha_retiro)
        if (!f || f < startSemana) return false
      }
      // Filtro por buscador
      if (q) {
        return (
          c.nombre_mascota?.toLowerCase().includes(q) ||
          c.nombre_tutor?.toLowerCase().includes(q) ||
          c.codigo?.toLowerCase().includes(q) ||
          c.email?.toLowerCase().includes(q) ||
          c.telefono?.toLowerCase().includes(q)
        )
      }
      return true
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buscar, filtro, filtroVet, clientes, preciosGenerales, preciosConvenio, cobrosPend])

  const nBorradores = useMemo(() => clientes.filter(c => c.estado === 'borrador').length, [clientes])

  // Conteos para las notificaciones compactas de arriba. Excluyen borradores
  // (esos tienen su propia alerta de "nueva reserva del agente").
  const alertas = useMemo(() => {
    const reales = clientes.filter(c => c.estado !== 'borrador')
    return {
      // "Pago pendiente" unifica en UNA sola notificación TODO lo cobrable:
      // servicios no pagados + fichas con un cobro pendiente (adicional / diferencia
      // de peso / saldo de pago parcial). Antes eran dos chips separados.
      pagoPendiente: reales.filter(c => c.estado_pago !== 'pagado' || idsConCobroPendiente.has(String(c.id))).length,
      enCamara: reales.filter(c => c.estado === 'pendiente' || !c.estado).length,
      // Los Sin Devolución (SD) NO se despachan (su flujo termina en "cremado"),
      // así que no cuentan como pendientes de despacho.
      porDespachar: reales.filter(c => c.estado === 'cremado' && (c.codigo_servicio || 'CI').toUpperCase() !== 'SD').length,
      datosPendientes: reales.filter(c => tieneDatosPendientes(c)).length,
      faltaPeso: reales.filter(c => faltaPesoIngreso(c)).length,
      diferencia: reales.filter(c => tieneDiferenciaPorCobrar(c)).length,
      // Fichas con un cobro emitido y aún NO pagado (tabla `cobros`).
      pendienteCobro: reales.filter(c => idsConCobroPendiente.has(String(c.id))).length,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientes, preciosGenerales, preciosConvenio, idsConCobroPendiente])

  // Permite llegar con un filtro preseleccionado por URL (ej. desde la alerta
  // del dashboard: /clientes?filtro=borrador). Se lee una vez al montar.
  useEffect(() => {
    const f = new URLSearchParams(window.location.search).get('filtro')
    const validos = ['todos', 'borrador', 'pendiente', 'cremado', 'despachado', 'pago_pendiente', 'este_mes', 'esta_semana', 'datos_pendientes', 'falta_peso', 'diferencia']
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (f && validos.includes(f)) setFiltro(f as typeof filtro)
  }, [])

  // Cargo AUTOMÁTICO de otros servicios (fuera de horario / distancia): según
  // fecha/hora/comuna del retiro se pre-cargan solos en los adicionales, siempre
  // deseleccionables. autoAgregados = los puso el efecto (puede sacarlos si la
  // regla deja de aplicar); autoQuitados = el usuario los desmarcó (no re-agregar).
  const autoAgregadosRef = useRef<Set<string>>(new Set())
  const autoQuitadosRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    if (!showModal) return
    const ctx = { fecha: form.fecha_retiro, hora: form.hora_retiro, comuna: form.comuna }
    setAdicionales(prev => {
      let next = prev
      for (const s of otrosServicios) {
        if (!(s.auto_regla || '').trim()) continue
        const aplica = aplicaReglaAuto(s, ctx)
        const presente = next.some(a => a.tipo === 'servicio' && a.id === s.id)
        if (aplica && !presente && !autoQuitadosRef.current.has(s.id)) {
          autoAgregadosRef.current.add(s.id)
          next = [...next, { tipo: 'servicio' as const, id: s.id, nombre: s.nombre, precio: parseFloat(s.precio) || 0, qty: 1 }]
        } else if (!aplica && presente && autoAgregadosRef.current.has(s.id)) {
          autoAgregadosRef.current.delete(s.id)
          next = next.filter(a => !(a.tipo === 'servicio' && a.id === s.id))
        }
      }
      return next
    })
  }, [showModal, form.fecha_retiro, form.hora_retiro, form.comuna, otrosServicios])

  function toggleAdicional(tipo: 'producto' | 'servicio', item: { id: string; nombre: string; precio: string }) {
    const existing = adicionales.find(a => a.tipo === tipo && a.id === item.id)
    if (existing) {
      // Al desmarcar un servicio auto-cargado, recordarlo para no re-agregarlo solo.
      if (tipo === 'servicio') { autoQuitadosRef.current.add(item.id); autoAgregadosRef.current.delete(item.id) }
      setAdicionales(prev => prev.filter(a => !(a.tipo === tipo && a.id === item.id)))
    } else {
      if (tipo === 'servicio') autoQuitadosRef.current.delete(item.id)
      setAdicionales(prev => [...prev, { tipo, id: item.id, nombre: item.nombre, precio: parseFloat(item.precio) || 0, qty: 1 }])
    }
  }

  function updateQty(tipo: 'producto' | 'servicio', itemId: string, qty: number) {
    setAdicionales(prev => prev.map(a => a.tipo === tipo && a.id === itemId ? { ...a, qty: Math.max(1, qty) } : a))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    // Guard anti doble-click (regla general del sitio): un doble-click rápido podía
    // crear la ficha dos veces antes de que `saving` re-renderice. El ref bloquea al toque.
    if (savingRef.current) return
    savingRef.current = true
    setFormError('')
    setSaving(true)
    try {
    const pesoDeclarado = parseDecimal(form.peso_declarado) ?? 0
    const body = {
      ...form,
      peso_declarado: pesoDeclarado,
      misma_direccion: form.misma_direccion,
      direccion_despacho: form.misma_direccion ? form.direccion_retiro : form.direccion_despacho,
      veterinaria_id: noEsVeterinaria ? '' : form.veterinaria_id,
      adicionales: JSON.stringify(adicionales),
      descuento_id: descuentoElegido ? descuentoElegido.id : '',
      descuento_nombre: descuentoElegido ? descuentoElegido.nombre : '',
      descuento_tipo: descuentoElegido ? descuentoElegido.tipo : '',
      descuento_valor: descuentoElegido ? String(descuentoValorNum) : '',
      descuento_monto: descuentoElegido ? String(montoDescuento) : '',
      // Pago parcial: monto abonado (el saldo pendiente lo calcula el backend).
      ...(form.estado_pago === 'parcial' ? { monto_abonado: abonoNueva } : {}),
    }
    const res = await fetch('/api/clientes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (res.ok) {
      const created = await res.json().catch(() => null) as { codigo?: string } | null
      // Snapshot del resumen para mostrarlo en el modal de éxito (el form se resetea acto seguido)
      setFichaCreada({
        codigo: created?.codigo ?? '',
        nombre_mascota: form.nombre_mascota,
        nombre_tutor: form.nombre_tutor,
        codigo_servicio: codigoServForm,
        precio_servicio: precioServicio,
        precio_normal: precioNormal,
        mostrar_precio_normal: mostrarPrecioNormal,
        tabla_nombre: tablaNombre,
        rango_tramo: rangoTramo,
        peso_kg: pesoKgForm,
        adicionales: [...adicionales],
        total_adicionales: totalAdicionales,
        descuento_nombre: descuentoElegido ? descuentoElegido.nombre : '',
        descuento_etiqueta: descuentoEtiqueta,
        descuento_monto: montoDescuento,
        total: totalServicio,
      })
      setShowModal(false)
      setForm(FORM_DEFAULT)
      setAbonoNueva('')
      setEsClienteVet(false)
      setAdicionales([])
      autoAgregadosRef.current = new Set()
      autoQuitadosRef.current = new Set()
      setShowAdicionales(false)
      setAplicarDescuento(false)
      setDescuentoId('')
      await fetchClientes()
    } else {
      const err = await res.json().catch(() => ({}))
      setFormError(err?.error ?? 'Error al guardar la ficha. Revisa que todos los campos obligatorios estén completos.')
    }
    } finally {
      setSaving(false)
      savingRef.current = false
    }
  }

  // Cremación Premium (CP) incluye sin costo cualquier ánfora premium: su línea
  // suma $0 (igual descuenta stock). Se resuelve por la categoría del producto.
  const adicionalIncluido = (a: AdicionalItem) =>
    a.tipo === 'producto' &&
    anforaPremiumIncluida(form.codigo_servicio, productosDisp.find(p => p.id === a.id)?.categoria)
  const totalAdicionales = adicionales.reduce((sum, a) => sum + (adicionalIncluido(a) ? 0 : a.precio * a.qty), 0)

  // Resumen del servicio para la tarjeta de la lista: servicio + adicionales
  // (con "Incluido" para el ánfora premium de una Cremación Premium) + total.
  // null si la ficha no tiene snapshot de precio (borrador/legacy).
  function resumenServicio(c: Cliente): { lineas: { nombre: string; valor: string; verde?: boolean }[]; total: number } | null {
    const servicioPrecio = intCLP(c.precio_servicio)
    const total = intCLP(c.precio_total)
    if (servicioPrecio <= 0 && total <= 0) return null
    const cs = (c.codigo_servicio || 'CI').toUpperCase()
    const lineas: { nombre: string; valor: string; verde?: boolean }[] = [
      { nombre: NOMBRE_MODALIDAD[cs] || 'Cremación', valor: fmtPrecio(servicioPrecio) },
    ]
    let items: AdicionalItem[] = []
    try { const arr = JSON.parse(c.adicionales || '[]'); if (Array.isArray(arr)) items = arr } catch { /* sin adicionales */ }
    for (const a of items) {
      const incluido = a.tipo === 'producto' && anforaPremiumIncluida(cs, productosDisp.find(p => p.id === a.id)?.categoria)
      lineas.push({ nombre: `${a.nombre}${a.qty > 1 ? ` ×${a.qty}` : ''}`, valor: incluido ? 'Incluido' : fmtPrecio(a.precio * a.qty) })
    }
    const desc = intCLP(c.descuento_monto)
    if (desc > 0) lineas.push({ nombre: `Descuento${c.descuento_nombre ? ` (${c.descuento_nombre})` : ''}`, valor: `−${fmtPrecio(desc)}`, verde: true })
    return { lineas, total }
  }

  const vetSeleccionada = !noEsVeterinaria ? veterinarias.find(v => v.id === form.veterinaria_id) : undefined
  const tipoPrecios: 'general' | 'convenio' | 'especial' = !vetSeleccionada
    ? 'general'
    : vetSeleccionada.tipo_precios === 'precios_especiales' ? 'especial' : 'convenio'
  const tablaPrecios: Tramo[] = tipoPrecios === 'especial' ? tramosEspeciales : tipoPrecios === 'convenio' ? preciosConvenio : preciosGenerales
  const tablaNombre = tipoPrecios === 'especial' ? 'Precios especiales' : tipoPrecios === 'convenio' ? 'Precios convenio' : 'Precios generales'
  const pesoKgForm = parsePeso(form.peso_declarado)
  const tramoAplicable = encontrarTramo(tablaPrecios, pesoKgForm)
  const codigoServForm = form.codigo_servicio || 'CI'
  const precioServicio = precioDelTramo(tramoAplicable, codigoServForm)
  const tramoNormal = encontrarTramo(preciosGenerales, pesoKgForm)
  const precioNormal = precioDelTramo(tramoNormal, codigoServForm)
  const mostrarPrecioNormal = tipoPrecios !== 'general' && precioNormal > 0
  const subtotalServicio = precioServicio + totalAdicionales
  const descuentoElegido = aplicarDescuento && descuentoId
    ? descuentosDisp.find(d => d.id === descuentoId) ?? null
    : null
  const descuentoValorNum = descuentoElegido ? parseFloat(descuentoElegido.valor) || 0 : 0
  // El descuento aplica SOLO al precio de la cremación, nunca a los adicionales
  // (fuera de horario, distancia, ánfora premium, etc. se pagan completos).
  const montoDescuento = !descuentoElegido
    ? 0
    : descuentoElegido.tipo === 'fijo'
      ? Math.min(descuentoValorNum, precioServicio)
      : Math.round((precioServicio * descuentoValorNum) / 100)
  const totalServicio = Math.max(0, subtotalServicio - montoDescuento)
  const descuentoEtiqueta = descuentoElegido
    ? descuentoElegido.tipo === 'fijo' ? fmtPrecio(descuentoValorNum) : `${descuentoValorNum}%`
    : ''
  const rangoTramo = tramoAplicable ? (() => {
    const maxPesoMin = Math.max(...tablaPrecios.map(t => parseFloat(t.peso_min) || 0))
    const min = parseFloat(tramoAplicable.peso_min) || 0
    return min === maxPesoMin ? `${min} kg o más` : `${tramoAplicable.peso_min} – ${tramoAplicable.peso_max} kg`
  })() : null

  function abrirAgenda() {
    setAgendaForm({ ...AGENDA_DEFAULT, fecha_retiro: todayISO() })
    setAgendaError('')
    setShowAgenda(true)
  }

  async function submitAgenda(e: React.FormEvent) {
    e.preventDefault()
    if (agendaSavingRef.current) return
    agendaSavingRef.current = true
    setAgendaSaving(true); setAgendaError('')
    try {
      const res = await fetch('/api/clientes/agendamiento-manual', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(agendaForm),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setAgendaError(data?.error || 'No se pudo registrar el agendamiento.'); return }
      const mascota = agendaForm.nombre_mascota
      setShowAgenda(false)
      setAgendaForm(AGENDA_DEFAULT)
      await fetchClientes()
      alert(`✅ Agendamiento registrado. Se creó la ficha "Por ingresar" de ${mascota} y se le envió la confirmación por WhatsApp al tutor.`)
    } catch { setAgendaError('Error de red. Intenta de nuevo.') }
    finally { agendaSavingRef.current = false; setAgendaSaving(false) }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-extrabold text-brand tracking-tight">Clientes</h1>
          <p className="text-gray-600 text-sm mt-0.5">Fichas de mascotas</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={abrirAgenda}
            title="Registrar a mano un retiro y avisarle al tutor por WhatsApp"
            className="border-2 border-brand text-brand hover:bg-brand/5 px-4 py-2.5 rounded-lg text-sm font-semibold transition-colors"
          >
            📅 Agendamiento manual
          </button>
          <button
            onClick={() => { setForm({ ...FORM_DEFAULT, fecha_retiro: todayISO() }); autoAgregadosRef.current = new Set(); autoQuitadosRef.current = new Set(); setShowModal(true) }}
            className="bg-brand hover:bg-brand-dark text-white px-5 py-2.5 rounded-lg text-sm font-semibold shadow-md transition-colors"
          >
            + Nueva ficha
          </button>
        </div>
      </div>

      {/* Notificaciones compactas: una fila de chips clickeables que aplican el
          filtro correspondiente. Reemplaza al banner grande de pago pendiente. */}
      {(nBorradores > 0 || alertas.pagoPendiente > 0 || alertas.enCamara > 0 || alertas.porDespachar > 0 || alertas.datosPendientes > 0 || alertas.faltaPeso > 0 || alertas.diferencia > 0) && (
        <div className="mb-5 flex flex-wrap items-center gap-2">
          {nBorradores > 0 && (
            <button onClick={() => setFiltro('borrador')}
              className="inline-flex items-center gap-1.5 rounded-lg border-2 border-red-300 bg-red-50 hover:bg-red-100 px-3 py-1.5 text-xs font-bold text-red-800 shadow-md transition-colors">
              🔔 {nBorradores} nueva{nBorradores === 1 ? '' : 's'} reserva{nBorradores === 1 ? '' : 's'} del agente
            </button>
          )}
          {alertas.pagoPendiente > 0 && (
            <button onClick={() => setFiltro('pago_pendiente')}
              className="inline-flex items-center gap-1.5 rounded-lg border-2 border-amber-400 bg-amber-50 hover:bg-amber-100 px-3 py-1.5 text-xs font-bold text-amber-900 shadow-md transition-colors">
              💳 {alertas.pagoPendiente} con pago pendiente
            </button>
          )}
          {alertas.enCamara > 0 && (
            <button onClick={() => setFiltro('pendiente')}
              className="inline-flex items-center gap-1.5 rounded-lg border-2 border-sky-300 bg-sky-50 hover:bg-sky-100 px-3 py-1.5 text-xs font-bold text-sky-800 shadow-md transition-colors">
              📥 {alertas.enCamara} en cámara por cremar
            </button>
          )}
          {alertas.porDespachar > 0 && (
            <button onClick={() => setFiltro('cremado')}
              className="inline-flex items-center gap-1.5 rounded-lg border-2 border-emerald-300 bg-emerald-50 hover:bg-emerald-100 px-3 py-1.5 text-xs font-bold text-emerald-800 shadow-md transition-colors">
              📦 {alertas.porDespachar} cremado{alertas.porDespachar === 1 ? '' : 's'} por despachar
            </button>
          )}
          {alertas.datosPendientes > 0 && (
            <button onClick={() => setFiltro('datos_pendientes')}
              className="inline-flex items-center gap-1.5 rounded-lg border-2 border-orange-300 bg-orange-50 hover:bg-orange-100 px-3 py-1.5 text-xs font-bold text-orange-800 shadow-md transition-colors">
              📝 {alertas.datosPendientes} con datos pendientes
            </button>
          )}
          {alertas.faltaPeso > 0 && (
            <button onClick={() => setFiltro('falta_peso')}
              className="inline-flex items-center gap-1.5 rounded-lg border-2 border-rose-300 bg-rose-50 hover:bg-rose-100 px-3 py-1.5 text-xs font-bold text-rose-800 shadow-md transition-colors">
              <span className="font-mono font-extrabold bg-rose-200 text-rose-900 px-1 rounded">KG</span> {alertas.faltaPeso} sin peso de ingreso
            </button>
          )}
          {alertas.diferencia > 0 && (
            <button onClick={() => setFiltro('diferencia')}
              className="inline-flex items-center gap-1.5 rounded-lg border-2 border-fuchsia-300 bg-fuchsia-50 hover:bg-fuchsia-100 px-3 py-1.5 text-xs font-bold text-fuchsia-800 shadow-md transition-colors">
              💰 {alertas.diferencia} con diferencia por cobrar
            </button>
          )}
        </div>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
        <KpiCard icon="👥" color="indigo" value={kpis.total.toString()} label="Total clientes" />
        <KpiCard icon="👥" color="emerald" value={kpis.delMes.toString()} label="Clientes del mes"
          hint={kpis.promMesHist !== null ? `Promedio histórico: ${kpis.promMesHist.toFixed(1)} (${kpis.mesesCerrados} mes${kpis.mesesCerrados !== 1 ? 'es' : ''})` : 'Sin histórico aún'} />
      </div>

      {/* Buscador + filtros */}
      <div className="bg-white rounded-xl shadow-md border-2 border-gray-300 p-4 mb-6">
        <input
          type="text"
          placeholder="🔍 Buscar por nombre, tutor, código, email o teléfono..."
          value={buscar}
          onChange={(e) => setBuscar(e.target.value)}
          className="w-full border-2 border-gray-300 rounded-lg px-4 py-3 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-brand focus:border-brand"
        />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-gray-600 mr-1">Filtrar:</span>
          {([
            { id: 'todos', label: 'Todos' },
            { id: 'borrador', label: '🗂 Por ingresar' },
            { id: 'pendiente', label: '📥 Retirados (en cámara)' },
            { id: 'cremado', label: '✓ Cremados' },
            { id: 'despachado', label: '📦 Despachados' },
            { id: 'pago_pendiente', label: '⚠ Pago pendiente' },
            { id: 'este_mes', label: 'Este mes' },
            { id: 'esta_semana', label: 'Esta semana' },
            { id: 'datos_pendientes', label: '📝 Datos pendientes' },
          ] as const).map(opt => {
            const active = filtro === opt.id
            const esBorr = opt.id === 'borrador'
            return (
              <button
                key={opt.id}
                onClick={() => setFiltro(opt.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold border-2 transition-colors ${
                  active
                    ? 'bg-brand border-brand text-white shadow-md'
                    : esBorr && nBorradores > 0
                      ? 'bg-amber-50 border-amber-300 text-amber-800 hover:bg-amber-100'
                      : 'bg-white border-gray-300 text-gray-700 hover:border-brand hover:bg-brand/10'
                }`}
              >
                {opt.label}{esBorr && nBorradores > 0 ? ` (${nBorradores})` : ''}
              </button>
            )
          })}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-gray-600 mr-1">Veterinaria:</span>
          <select value={filtroVet} onChange={e => setFiltroVet(e.target.value)}
            className="border-2 border-gray-300 rounded-lg px-3 py-1.5 text-xs font-semibold text-gray-700 focus:outline-none focus:ring-2 focus:ring-brand">
            <option value="">Todas</option>
            <option value="__general__">General (sin veterinaria)</option>
            {veterinarias.map(v => <option key={v.id} value={v.id}>{v.nombre}</option>)}
          </select>
          {filtroVet && (
            <button onClick={() => setFiltroVet('')} className="text-xs text-brand-soft hover:underline">Quitar filtro</button>
          )}
        </div>
        <p className="text-xs text-gray-500 mt-3">
          {resultados.length} resultado{resultados.length !== 1 ? 's' : ''} · {clientes.length} en total
        </p>
      </div>

      {/* Cards de resultados */}
      {loading ? (
        <div className="bg-white rounded-xl shadow-md border-2 border-gray-300 p-12 text-center text-gray-500 text-sm">Cargando...</div>
      ) : resultados.length === 0 ? (
        <div className="bg-white rounded-xl shadow-md border-2 border-gray-300 p-12 text-center text-gray-500 text-sm">
          Sin resultados para tu búsqueda o filtro.
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-md border-2 border-gray-300 p-4 max-h-[640px] overflow-y-auto">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 pr-1">
          {resultados.map(c => {
            const resumen = resumenServicio(c)
            return (
            <button
              key={c.id}
              onClick={() => setSelected(c)}
              className="text-left bg-white rounded-xl shadow-md border-2 border-gray-300 hover:border-brand hover:shadow-lg p-4 transition-all"
            >
              <div className="flex items-start justify-between mb-2">
                <span className={`font-mono text-xs font-bold px-2 py-0.5 rounded ${c.codigo ? 'text-brand bg-brand/10' : 'text-gray-400 bg-gray-100'}`}>{c.codigo || 'sin código'}</span>
                <Badge variant={c.estado === 'cremado' ? 'green' : c.estado === 'despachado' ? 'blue' : 'yellow'}>{c.estado === 'borrador' ? 'Por ingresar' : c.estado && c.estado !== 'pendiente' ? c.estado : 'retirado'}</Badge>
              </div>
              <div className="flex gap-3">
                <div className="flex-1 min-w-0">
              <p className="font-bold text-gray-900 text-base">{c.nombre_mascota || <span className="text-gray-400 italic">Sin nombre</span>}</p>
              <p className="text-sm text-gray-600">{c.nombre_tutor}</p>
              <div className="mt-3 flex items-center gap-2 flex-wrap">
                <span className="text-xs text-gray-500">{c.especie || (c.estado === 'borrador' ? 'falta especie' : '')}</span>
                <span className="text-gray-300">·</span>
                <span className="text-xs font-semibold text-gray-700">{c.codigo_servicio}</span>
              </div>
              <div className="mt-2 flex items-center gap-3 flex-wrap text-xs text-gray-500">
                <span>
                  <span className="font-semibold text-gray-600">Retiro:</span>{' '}
                  {c.fecha_retiro ? fmtFecha(c.fecha_retiro) : <span className="text-gray-400 italic">sin fecha</span>}
                </span>
                <span>
                  <span className="font-semibold text-gray-600">Peso:</span>{' '}
                  {fmtKg(parsePeso(c.peso_ingreso) || parsePeso(c.peso_declarado))}
                </span>
              </div>
              {(esPremiumCuadro(c) || solicitoVideo(c)) && (
                <div className="mt-2 flex items-center gap-1.5">
                  {esPremiumCuadro(c) && (
                    <span title={jsonTieneItems(c.fotos_cuadro) ? 'Cuadro conmemorativo · foto recibida' : 'Cuadro conmemorativo (Premium) · falta la foto del tutor'}
                      className={`inline-flex items-center gap-1 text-[11px] font-semibold px-1.5 py-0.5 rounded border ${jsonTieneItems(c.fotos_cuadro) ? 'text-emerald-700 bg-emerald-50 border-emerald-200' : 'text-amber-700 bg-amber-50 border-amber-200'}`}>
                      🖼️ cuadro
                    </span>
                  )}
                  {solicitoVideo(c) && (
                    <span title={jsonTieneItems(c.videos_servicio) ? 'Video del proceso solicitado · ya cargado' : 'Video del proceso solicitado · pendiente de cargar'}
                      className={`inline-flex items-center gap-1 text-[11px] font-semibold px-1.5 py-0.5 rounded border ${jsonTieneItems(c.videos_servicio) ? 'text-emerald-700 bg-emerald-50 border-emerald-200' : 'text-sky-700 bg-sky-50 border-sky-200'}`}>
                      🎥 video
                    </span>
                  )}
                </div>
              )}
              {c.estado === 'borrador' && (
                <p className="mt-2 text-xs font-semibold text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                  🗂 Completa la ficha para registrarla
                </p>
              )}
              {c.estado !== 'borrador' && c.estado_pago !== 'pagado' && (
                <p className="mt-2 text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                  ⚠ Pago pendiente
                </p>
              )}
                </div>
                {resumen && (
                  <div className="w-40 shrink-0 border-l border-gray-200 pl-3">
                    <p className="text-[10px] uppercase tracking-wide font-bold text-gray-500 mb-1.5">Resumen del servicio</p>
                    <div className="space-y-1">
                      {resumen.lineas.map((l, i) => (
                        <div key={i} className="flex justify-between gap-2 text-[11px] leading-tight">
                          <span className={`truncate ${l.verde ? 'text-emerald-700' : 'text-gray-600'}`} title={l.nombre}>{l.nombre}</span>
                          <span className={`shrink-0 font-semibold ${l.verde ? 'text-emerald-700' : 'text-gray-800'}`}>{l.valor}</span>
                        </div>
                      ))}
                      <div className="flex justify-between gap-2 text-xs pt-1 mt-1 border-t border-gray-200">
                        <span className="font-bold text-gray-700">Total</span>
                        <span className="font-bold text-brand">{fmtPrecio(resumen.total)}</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </button>
            )
          })}
        </div>
        </div>
      )}

      {/* Modal preview de cliente seleccionado */}
      <Modal open={!!selected} onClose={() => setSelected(null)} title={selected?.nombre_mascota ?? ''}>
        {selected && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono text-xs text-brand font-bold bg-brand/10 px-2 py-0.5 rounded">{selected.codigo}</span>
              <Badge variant={selected.estado === 'cremado' ? 'green' : selected.estado === 'despachado' ? 'blue' : 'yellow'}>{selected.estado && selected.estado !== 'pendiente' ? selected.estado : 'retirado'}</Badge>
              {selected.estado_pago === 'pagado' ? (
                <Badge variant="green">Pagado</Badge>
              ) : (
                <Badge variant="yellow">Pago pendiente</Badge>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
              <PreviewField label="Tutor" value={selected.nombre_tutor} />
              <PreviewField label="Especie" value={selected.especie} />
              <PreviewField label="Email" value={selected.email || '—'} />
              <PreviewField label="Teléfono" value={selected.telefono || '—'} />
              <PreviewField label="Peso" value={fmtKg(parsePeso(selected.peso_ingreso) || parsePeso(selected.peso_declarado))} />
              <PreviewField label="Servicio" value={`${selected.tipo_servicio} (${selected.codigo_servicio})`} />
              <PreviewField label="Fecha de retiro" value={fmtFecha(selected.fecha_retiro)} />
              <PreviewField label="Comuna" value={selected.comuna || '—'} />
              <PreviewField label="Tipo de pago" value={selected.tipo_pago || '—'} />
              <PreviewField label="Estado de pago" value={selected.estado_pago || 'pendiente'} />
              <div className="sm:col-span-2">
                <PreviewField label="Dirección de retiro" value={selected.direccion_retiro || '—'} />
              </div>
              {selected.direccion_despacho && selected.direccion_despacho !== selected.direccion_retiro && (
                <div className="sm:col-span-2">
                  <PreviewField label="Dirección de despacho" value={selected.direccion_despacho} />
                </div>
              )}
            </div>

            {(() => {
              let items: AdicionalItem[] = []
              try { items = JSON.parse(selected.adicionales || '[]') } catch {}
              if (!Array.isArray(items) || items.length === 0) return null
              // Ánforas premium incluidas (Cremación Premium) → su línea vale $0.
              const incluido = (a: AdicionalItem) =>
                a.tipo === 'producto' &&
                anforaPremiumIncluida(selected.codigo_servicio, productosDisp.find(p => p.id === a.id)?.categoria)
              const total = items.reduce((s, a) => s + (incluido(a) ? 0 : (a.precio || 0) * (a.qty || 1)), 0)
              const productos = items.filter(a => a.tipo === 'producto')
              const servicios = items.filter(a => a.tipo === 'servicio')
              return (
                <div className="border-t-2 border-gray-300 pt-3">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Adicionales</p>
                    <span className="bg-brand/10 text-brand text-xs font-semibold px-2 py-0.5 rounded-full">
                      {items.length} ítem(s) · {fmtPrecio(total)}
                    </span>
                  </div>
                  {productos.length > 0 && (
                    <div className="mb-2">
                      <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-1">Productos</p>
                      <div className="space-y-1">
                        {productos.map(a => (
                          <div key={`p-${a.id}`} className="flex items-center justify-between text-sm">
                            <span className="text-gray-800">
                              {a.nombre}{a.qty > 1 && <span className="text-gray-400"> × {a.qty}</span>}
                            </span>
                            {incluido(a)
                              ? <span className="font-medium text-emerald-600">Incluida</span>
                              : <span className="text-gray-700">{fmtPrecio(a.precio * (a.qty || 1))}</span>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {servicios.length > 0 && (
                    <div>
                      <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-1">Otros servicios</p>
                      <div className="space-y-1">
                        {servicios.map(a => (
                          <div key={`s-${a.id}`} className="flex items-center justify-between text-sm">
                            <span className="text-gray-800">
                              {a.nombre}{a.qty > 1 && <span className="text-gray-400"> × {a.qty}</span>}
                            </span>
                            <span className="text-gray-700">{fmtPrecio(a.precio * (a.qty || 1))}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )
            })()}

            <div className="flex gap-3 pt-2">
              <button
                onClick={() => setSelected(null)}
                className="flex-1 border-2 border-gray-300 text-gray-700 rounded-lg py-2 text-sm font-semibold hover:bg-gray-50 transition-colors"
              >
                Cerrar
              </button>
              <Link
                href={`/clientes/${selected.id}`}
                className="flex-1 bg-brand hover:bg-brand-dark text-white rounded-lg py-2 text-sm font-semibold text-center shadow-md transition-colors"
              >
                Abrir ficha completa
              </Link>
            </div>
          </div>
        )}
      </Modal>

      {/* Modal "Agendamiento manual" */}
      <Modal open={showAgenda} onClose={() => { setShowAgenda(false); setAgendaError('') }} title="Agendamiento manual">
        <form onSubmit={submitAgenda} className="space-y-4">
          <p className="text-xs text-gray-600 -mt-1">
            Registra un retiro a mano. Se crea la ficha <strong>&laquo;Por ingresar&raquo;</strong> y se le envía la <strong>confirmación por WhatsApp</strong> al tutor (con el link para adelantar los datos de su mascota).
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-gray-700">Tutor <span className="text-red-500">*</span></label>
              <input required value={agendaForm.cliente_nombre} onChange={e => setAgendaForm(f => ({ ...f, cliente_nombre: e.target.value }))}
                className="mt-1 w-full border-2 border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand" />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-700">WhatsApp <span className="text-red-500">*</span></label>
              <input required inputMode="numeric" placeholder="56961217925" value={agendaForm.telefono} onChange={e => setAgendaForm(f => ({ ...f, telefono: e.target.value }))}
                className="mt-1 w-full border-2 border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand" />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-700">Mascota <span className="text-red-500">*</span></label>
              <input required value={agendaForm.nombre_mascota} onChange={e => setAgendaForm(f => ({ ...f, nombre_mascota: e.target.value }))}
                className="mt-1 w-full border-2 border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand" />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-700">Servicio <span className="text-red-500">*</span></label>
              <select required value={agendaForm.codigo_servicio} onChange={e => setAgendaForm(f => ({ ...f, codigo_servicio: e.target.value }))}
                className="mt-1 w-full border-2 border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand">
                <option value="CI">Cremación Individual</option>
                <option value="CP">Cremación Premium</option>
                <option value="SD">Cremación Sin Devolución</option>
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="text-xs font-semibold text-gray-700">Dirección de retiro <span className="text-red-500">*</span></label>
              <input required value={agendaForm.direccion} onChange={e => setAgendaForm(f => ({ ...f, direccion: e.target.value }))}
                className="mt-1 w-full border-2 border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand" />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-700">Comuna <span className="text-red-500">*</span></label>
              <input required value={agendaForm.comuna} onChange={e => setAgendaForm(f => ({ ...f, comuna: e.target.value }))}
                className="mt-1 w-full border-2 border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand" />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-700">Peso (kg)</label>
              <input inputMode="decimal" value={agendaForm.peso} onChange={e => setAgendaForm(f => ({ ...f, peso: e.target.value }))}
                className="mt-1 w-full border-2 border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand" />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-700">Fecha de retiro <span className="text-red-500">*</span></label>
              <input required type="date" value={agendaForm.fecha_retiro} onChange={e => setAgendaForm(f => ({ ...f, fecha_retiro: e.target.value }))}
                className="mt-1 w-full border-2 border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand" />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-700">Hora de retiro <span className="text-red-500">*</span></label>
              <input required type="time" value={agendaForm.hora_retiro} onChange={e => setAgendaForm(f => ({ ...f, hora_retiro: e.target.value }))}
                className="mt-1 w-full border-2 border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand" />
            </div>
          </div>
          {agendaError && <p className="text-sm text-red-600">{agendaError}</p>}
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={() => { setShowAgenda(false); setAgendaError('') }}
              className="flex-1 border-2 border-gray-300 text-gray-700 rounded-lg py-2 text-sm font-semibold hover:bg-gray-50 transition-colors">Cancelar</button>
            <button type="submit" disabled={agendaSaving}
              className="flex-1 bg-brand hover:bg-brand-dark text-white rounded-lg py-2 text-sm font-semibold disabled:opacity-50 transition-colors">
              {agendaSaving ? 'Registrando…' : 'Registrar y avisar al tutor'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Modal "Nueva ficha" */}
      <Modal open={showModal} onClose={() => { setShowModal(false); setAdicionales([]); setShowAdicionales(false); setFormError('') }} title="Nueva ficha de mascota">
        <form onSubmit={handleSubmit} className="space-y-4">
          {formError && (
            <div className="rounded-lg border-2 border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800 font-medium">
              {formError}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <ModalField required label="Nombre mascota" value={form.nombre_mascota} onChange={v => setForm(f => ({ ...f, nombre_mascota: v }))} />
            <ModalField required label="Nombre tutor" value={form.nombre_tutor} onChange={v => setForm(f => ({ ...f, nombre_tutor: v }))} />
            <ModalField required type="email" label="Email" value={form.email} onChange={v => setForm(f => ({ ...f, email: v }))} placeholder="ejemplo@correo.cl" />
            <ModalField required type="tel" label="Teléfono" value={form.telefono} onChange={v => setForm(f => ({ ...f, telefono: v.replace(/\D/g, '').slice(0, 9) }))} placeholder="9 dígitos · ej: 912345678" />
          </div>

          <ModalAddressField required label="Dirección de retiro" value={form.direccion_retiro}
            onChange={v => setForm(f => ({ ...f, direccion_retiro: v, direccion_despacho: f.misma_direccion ? v : f.direccion_despacho }))} />

          <div className="flex items-center gap-2">
            <input type="checkbox" id="misma" checked={form.misma_direccion}
              onChange={e => setForm(f => ({ ...f, misma_direccion: e.target.checked, direccion_despacho: e.target.checked ? f.direccion_retiro : '' }))}
              className="w-4 h-4 rounded border-gray-400 text-brand focus:ring-brand" />
            <label htmlFor="misma" className="text-xs font-medium text-gray-700">Misma dirección para despacho</label>
          </div>

          {!form.misma_direccion && (
            <ModalAddressField required label="Dirección de despacho" value={form.direccion_despacho} onChange={v => setForm(f => ({ ...f, direccion_despacho: v }))} />
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <ModalField required label="Comuna" value={form.comuna} onChange={v => setForm(f => ({ ...f, comuna: v }))} />
            <ModalField required type="date" label="Fecha de defunción" value={form.fecha_defuncion} onChange={v => setForm(f => ({ ...f, fecha_defuncion: v }))} />
            <ModalField required type="date" label="Fecha de retiro" value={form.fecha_retiro} onChange={v => setForm(f => ({ ...f, fecha_retiro: v }))} />
            <ModalField type="time" label="Hora de retiro" value={form.hora_retiro} onChange={v => setForm(f => ({ ...f, hora_retiro: v }))} />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-gray-700">
                Especie <span className="text-red-500">*</span>
              </label>
              <select required value={form.especie} onChange={e => {
                const esp = especies.find(es => es.nombre === e.target.value)
                setForm(f => ({ ...f, especie: e.target.value, letra_especie: esp?.letra ?? '' }))
              }} className={`mt-1 w-full border-2 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand ${!form.especie ? 'border-red-300 bg-red-50' : 'border-gray-300'}`}>
                <option value="">Seleccionar...</option>
                {especies.map(e => <option key={e.id} value={e.nombre}>{e.nombre}</option>)}
              </select>
            </div>
            <ModalField required type="number" step="0.1" min="0" label="Peso declarado (kg)" value={form.peso_declarado} onChange={v => setForm(f => ({ ...f, peso_declarado: v }))} />
          </div>

          <div>
            <label className="text-xs font-semibold text-gray-700">
              Tipo de servicio <span className="text-red-500">*</span>
            </label>
            <select required value={form.codigo_servicio} onChange={e => {
              const codigo = e.target.value
              const svc = SERVICIOS.find(s => s.codigo === codigo)
              // En Sin Devolución no hay despacho posterior, así que la dirección de
              // despacho equivale a la de retiro: auto-marcamos misma_direccion para
              // ahorrar el segundo campo.
              const esSinDev = codigo === 'SD'
              setForm(f => ({
                ...f,
                codigo_servicio: codigo,
                tipo_servicio: svc?.nombre ?? '',
                misma_direccion: esSinDev ? true : f.misma_direccion,
                direccion_despacho: esSinDev ? f.direccion_retiro : f.direccion_despacho,
              }))
            }} className="mt-1 w-full border-2 border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand">
              {SERVICIOS.map(s => <option key={s.codigo} value={s.codigo}>{s.nombre} ({s.codigo})</option>)}
            </select>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t-2 border-gray-300">
            <div>
              <label className="text-xs font-semibold text-gray-700">
                Tipo de pago <span className="text-red-500">*</span>
              </label>
              <select required value={form.tipo_pago} onChange={e => setForm(f => ({ ...f, tipo_pago: e.target.value }))}
                className={`mt-1 w-full border-2 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand ${!form.tipo_pago ? 'border-red-300 bg-red-50' : 'border-gray-300'}`}>
                <option value="">Seleccionar...</option>
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
              <select required value={form.estado_pago} onChange={e => setForm(f => ({ ...f, estado_pago: e.target.value }))}
                className="mt-1 w-full border-2 border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand">
                <option value="pendiente">Pendiente de pago</option>
                <option value="parcial">Pago parcial</option>
                <option value="pagado">Pagado</option>
              </select>
            </div>
          </div>

          {/* Pago parcial: box para indicar cuánto abonó → queda un saldo pendiente. */}
          {form.estado_pago === 'parcial' && (() => {
            const abonoNum = parseInt((abonoNueva || '').replace(/\D/g, ''), 10) || 0
            const pendiente = Math.max(0, Math.round(totalServicio) - abonoNum)
            return (
              <div className="mt-3 rounded-xl border-2 border-amber-300 bg-amber-50 px-4 py-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-end">
                  <div>
                    <label className="text-xs font-semibold text-gray-700">¿Cuánto pagó? (abono)</label>
                    <input
                      type="number" min={0} inputMode="numeric" value={abonoNueva}
                      onChange={e => setAbonoNueva(e.target.value)}
                      placeholder="0"
                      className="mt-1 w-full border-2 border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
                    />
                  </div>
                  <div className="text-sm">
                    <p className="text-xs text-gray-600">Total del servicio: <span className="font-semibold text-gray-900">{fmtPrecio(Math.round(totalServicio))}</span></p>
                    <p className="mt-0.5 text-amber-900 font-bold">Pendiente por pagar: {fmtPrecio(pendiente)}</p>
                  </div>
                </div>
                <p className="mt-2 text-[11px] text-amber-800">
                  Al crear la ficha queda un <strong>saldo pendiente</strong> por la diferencia (aparece en «pago pendiente»). La boleta se emite recién cuando confirmes el pago total.
                </p>
              </div>
            )
          })()}

          {/* Veterinaria derivante (lógica invertida) */}
          <div className="border-t-2 border-gray-300 pt-4">
            <label className="flex items-center gap-2 cursor-pointer select-none mb-2">
              <input
                type="checkbox"
                checked={esClienteVet}
                onChange={e => {
                  setEsClienteVet(e.target.checked)
                  if (!e.target.checked) setForm(f => ({ ...f, veterinaria_id: '' }))
                }}
                className="w-4 h-4 rounded border-gray-400 text-brand focus:ring-brand"
              />
              <span className="text-xs font-semibold text-gray-700">Cliente de veterinaria</span>
            </label>
            {esClienteVet && (
              <select value={form.veterinaria_id} onChange={e => setForm(f => ({ ...f, veterinaria_id: e.target.value }))}
                className="w-full border-2 border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand">
                <option value="">Seleccionar veterinaria...</option>
                {veterinarias.map(v => <option key={v.id} value={v.id}>{v.nombre}</option>)}
              </select>
            )}
          </div>

          {/* Adicionales */}
          {(productosDisp.length > 0 || otrosServicios.length > 0) && (
            <div className="border-t-2 border-gray-300">
              <button
                type="button"
                onClick={() => setShowAdicionales(v => !v)}
                className="w-full flex items-center justify-between py-3 text-left hover:bg-gray-50 px-1 rounded transition-colors"
              >
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-gray-700">Adicionales</span>
                  {adicionales.length > 0 && (
                    <span className="bg-brand/10 text-brand text-xs font-semibold px-2 py-0.5 rounded-full">
                      {adicionales.length} ítem(s) · {fmtPrecio(totalAdicionales)}
                    </span>
                  )}
                </div>
                <span className="text-gray-400 text-xs">{showAdicionales ? '▲' : '▼'}</span>
              </button>

              {showAdicionales && (
                <div className="pb-3">
                  {productosDisp.length > 0 && (() => {
                    // Agrupados por categoría (mismo orden que en Configuración).
                    const grupos = new Map<string, Producto[]>()
                    for (const p of productosDisp) {
                      const cat = (p.categoria ?? '').trim() || 'Sin categoría'
                      const arr = grupos.get(cat) ?? []
                      arr.push(p)
                      grupos.set(cat, arr)
                    }
                    const orden = Array.from(grupos.keys()).sort((a, b) => {
                      if (a === 'Sin categoría') return 1
                      if (b === 'Sin categoría') return -1
                      return a.localeCompare(b)
                    })
                    return (
                      <div className="mb-3">
                        <p className="text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wide">Productos</p>
                        {servicioIncluyeAnforaPremium(form.codigo_servicio) && (
                          <p className="mb-2 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md px-2.5 py-1.5">
                            Cremación Premium incluye un ánfora premium sin costo: al elegirla queda en $0 y se descuenta del stock igual.
                          </p>
                        )}
                        <div className="space-y-3">
                          {orden.map(cat => (
                            <div key={cat}>
                              <p className="text-[11px] font-bold text-brand uppercase tracking-wide mb-1.5 border-b border-brand/20 pb-1">{cat}</p>
                              <div className="space-y-1.5 pl-1">
                                {grupos.get(cat)!.map(p => {
                                  const item = adicionales.find(a => a.tipo === 'producto' && a.id === p.id)
                                  const stockNum = parseInt(p.stock || '0')
                                  const sinStock = stockNum <= 0
                                  const incluido = anforaPremiumIncluida(form.codigo_servicio, p.categoria)
                                  return (
                                    <div key={p.id} className={`flex items-center gap-2 ${sinStock ? 'opacity-50' : ''}`}>
                                      <input type="checkbox" checked={!!item} disabled={sinStock && !item}
                                        onChange={() => toggleAdicional('producto', p)}
                                        className="w-3.5 h-3.5 rounded border-gray-400 text-brand focus:ring-brand disabled:cursor-not-allowed" />
                                      <span className={`flex-1 text-sm ${sinStock ? 'text-gray-400 line-through' : 'text-gray-800'}`}>{p.nombre}</span>
                                      {incluido ? (
                                        <span className="text-xs font-semibold text-emerald-600">Incluida{p.precio && parseFloat(p.precio) > 0 ? <span className="ml-1 text-gray-400 font-normal line-through">{fmtPrecio(p.precio)}</span> : null}</span>
                                      ) : (
                                        <span className={`text-xs ${sinStock ? 'text-gray-400 line-through' : 'text-gray-500'}`}>{fmtPrecio(p.precio)}</span>
                                      )}
                                      {sinStock && <span className="text-[10px] text-red-600 font-semibold">sin stock</span>}
                                      {item && !sinStock && (
                                        <input type="number" min={1} value={item.qty} onChange={e => updateQty('producto', p.id, parseInt(e.target.value) || 1)}
                                          className="w-14 border-2 border-gray-300 rounded px-1.5 py-0.5 text-xs text-center focus:outline-none focus:ring-1 focus:ring-brand" />
                                      )}
                                    </div>
                                  )
                                })}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )
                  })()}

                  {otrosServicios.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wide">Otros servicios</p>
                      <div className="space-y-1.5">
                        {otrosServicios.map(s => {
                          const item = adicionales.find(a => a.tipo === 'servicio' && a.id === s.id)
                          return (
                            <div key={s.id} className="flex items-center gap-2">
                              <input type="checkbox" checked={!!item} onChange={() => toggleAdicional('servicio', s)} className="w-3.5 h-3.5 rounded border-gray-400 text-brand focus:ring-brand" />
                              <span className="flex-1 text-sm text-gray-800">{s.nombre}</span>
                              {!!item && autoAgregadosRef.current.has(s.id) && (
                                <span title={etiquetaRegla(s.auto_regla)} className="text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">auto</span>
                              )}
                              <span className="text-xs text-gray-500">{fmtPrecio(s.precio)}</span>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Resumen del servicio en vivo: se actualiza con peso, servicio, veterinaria y adicionales */}
          <div className="border-t-2 border-gray-300 pt-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-bold text-gray-900">Resumen del servicio</p>
              <span className="text-[11px] text-gray-400">{tablaNombre}</span>
            </div>
            <div className="bg-gray-50 rounded-lg border border-gray-300 p-3 space-y-2">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <p className="text-sm font-medium text-gray-900">
                    Cremación {codigoServForm}
                    {rangoTramo && <span className="text-gray-500 font-normal"> · {rangoTramo}</span>}
                  </p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {pesoKgForm > 0 ? `${pesoKgForm} kg` : 'Ingresa el peso para calcular'}
                    {pesoKgForm > 0 && !tramoAplicable && (
                      <span className="text-red-500 ml-2">⚠ Sin tramo de precio aplicable</span>
                    )}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold text-gray-900">{fmtPrecio(precioServicio)}</p>
                  {mostrarPrecioNormal && (
                    <p className="text-xs text-gray-500 mt-0.5">(precio normal: {fmtPrecio(precioNormal)})</p>
                  )}
                </div>
              </div>

              {adicionales.length > 0 && (
                <div className="border-t border-gray-300 pt-2 space-y-1">
                  <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Adicionales</p>
                  {adicionales.map(a => (
                    <div key={`${a.tipo}-${a.id}`} className="flex items-center justify-between text-sm">
                      <span className="text-gray-700">
                        {a.nombre}{a.qty > 1 && <span className="text-gray-400"> × {a.qty}</span>}
                      </span>
                      {adicionalIncluido(a)
                        ? <span className="font-medium text-emerald-600">Incluida</span>
                        : <span className="text-gray-700">{fmtPrecio(a.precio * a.qty)}</span>}
                    </div>
                  ))}
                  <div className="flex items-center justify-between pt-1 border-t border-gray-300">
                    <span className="text-xs text-gray-500">Subtotal adicionales</span>
                    <span className="text-sm font-medium text-gray-700">{fmtPrecio(totalAdicionales)}</span>
                  </div>
                </div>
              )}

              <div className="border-t border-gray-300 pt-2">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={aplicarDescuento}
                    onChange={e => {
                      setAplicarDescuento(e.target.checked)
                      if (!e.target.checked) setDescuentoId('')
                    }}
                    className="w-4 h-4 rounded border-gray-400 text-brand focus:ring-brand"
                  />
                  <span className="text-sm font-medium text-gray-700">Aplicar descuento</span>
                </label>
                {aplicarDescuento && (
                  <div className="mt-2 space-y-2">
                    <select
                      value={descuentoId}
                      onChange={e => setDescuentoId(e.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
                    >
                      <option value="">— Seleccionar descuento —</option>
                      {descuentosDisp.map(d => {
                        const v = parseFloat(d.valor) || 0
                        const etiqueta = d.tipo === 'fijo' ? fmtPrecio(v) : `${v}%`
                        return (
                          <option key={d.id} value={d.id}>{d.nombre} — {etiqueta}</option>
                        )
                      })}
                    </select>
                    {descuentoElegido && montoDescuento > 0 && (
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-gray-700">
                          {descuentoElegido.nombre}
                          <span className="text-gray-400 ml-1">({descuentoEtiqueta})</span>
                        </span>
                        <span className="font-semibold text-red-600">− {fmtPrecio(montoDescuento)}</span>
                      </div>
                    )}
                    {descuentosDisp.length === 0 && (
                      <p className="text-xs text-gray-400">No hay descuentos activos. Ve a Configuración → Descuentos para crear uno.</p>
                    )}
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between border-t-2 border-gray-300 pt-2 mt-1">
                <span className="text-base font-bold text-gray-900">Total</span>
                <span className="text-lg font-bold text-brand">{fmtPrecio(totalServicio)}</span>
              </div>
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={() => { setShowModal(false); setAdicionales([]); setShowAdicionales(false); setAplicarDescuento(false); setDescuentoId(''); setFormError('') }} className="flex-1 border-2 border-gray-300 text-gray-700 rounded-lg py-2 text-sm font-semibold hover:bg-gray-50 transition-colors">
              Cancelar
            </button>
            <button type="submit" disabled={saving} className="flex-1 bg-brand hover:bg-brand-dark text-white rounded-lg py-2 text-sm font-semibold shadow-md transition-colors disabled:opacity-50">
              {saving ? 'Guardando...' : 'Guardar ficha'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Modal de éxito post-guardar: muestra código generado + resumen para el operador */}
      <Modal open={!!fichaCreada} onClose={() => setFichaCreada(null)} title="Ficha creada ✓">
        {fichaCreada && (
          <div className="space-y-4">
            <div className="rounded-xl border-2 border-emerald-200 bg-emerald-50 p-4">
              <p className="text-xs font-semibold text-emerald-700 uppercase tracking-wide">Código generado</p>
              <p className="font-mono text-2xl font-bold text-emerald-900 mt-1">{fichaCreada.codigo}</p>
              <p className="text-sm text-emerald-800 mt-2">{fichaCreada.nombre_mascota} · {fichaCreada.nombre_tutor}</p>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-bold text-gray-900">Resumen del servicio</p>
                <span className="text-[11px] text-gray-400">{fichaCreada.tabla_nombre}</span>
              </div>
              <div className="bg-gray-50 rounded-lg border border-gray-300 p-3 space-y-2">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <p className="text-sm font-medium text-gray-900">
                      Cremación {fichaCreada.codigo_servicio}
                      {fichaCreada.rango_tramo && <span className="text-gray-500 font-normal"> · {fichaCreada.rango_tramo}</span>}
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5">{fichaCreada.peso_kg} kg</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold text-gray-900">{fmtPrecio(fichaCreada.precio_servicio)}</p>
                    {fichaCreada.mostrar_precio_normal && (
                      <p className="text-xs text-gray-500 mt-0.5">(precio normal: {fmtPrecio(fichaCreada.precio_normal)})</p>
                    )}
                  </div>
                </div>

                {fichaCreada.adicionales.length > 0 && (
                  <div className="border-t border-gray-300 pt-2 space-y-1">
                    <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Adicionales</p>
                    {fichaCreada.adicionales.map(a => {
                      const incl = a.tipo === 'producto' && anforaPremiumIncluida(fichaCreada.codigo_servicio, productosDisp.find(p => p.id === a.id)?.categoria)
                      return (
                        <div key={`${a.tipo}-${a.id}`} className="flex items-center justify-between text-sm">
                          <span className="text-gray-700">
                            {a.nombre}{a.qty > 1 && <span className="text-gray-400"> × {a.qty}</span>}
                          </span>
                          {incl
                            ? <span className="font-medium text-emerald-600">Incluida</span>
                            : <span className="text-gray-700">{fmtPrecio(a.precio * a.qty)}</span>}
                        </div>
                      )
                    })}
                    <div className="flex items-center justify-between pt-1 border-t border-gray-300">
                      <span className="text-xs text-gray-500">Subtotal adicionales</span>
                      <span className="text-sm font-medium text-gray-700">{fmtPrecio(fichaCreada.total_adicionales)}</span>
                    </div>
                  </div>
                )}

                {fichaCreada.descuento_monto > 0 && (
                  <div className="flex items-center justify-between border-t border-gray-300 pt-2 text-sm">
                    <span className="text-gray-700">
                      {fichaCreada.descuento_nombre}
                      <span className="text-gray-400 ml-1">({fichaCreada.descuento_etiqueta})</span>
                    </span>
                    <span className="font-semibold text-red-600">− {fmtPrecio(fichaCreada.descuento_monto)}</span>
                  </div>
                )}

                <div className="flex items-center justify-between border-t-2 border-gray-300 pt-2 mt-1">
                  <span className="text-base font-bold text-gray-900">Total a cobrar</span>
                  <span className="text-xl font-bold text-brand">{fmtPrecio(fichaCreada.total)}</span>
                </div>
              </div>
            </div>

            <button
              onClick={() => setFichaCreada(null)}
              className="w-full bg-brand hover:bg-brand-dark text-white rounded-lg py-2.5 text-sm font-semibold shadow-md transition-colors"
            >
              Listo
            </button>
          </div>
        )}
      </Modal>
    </div>
  )
}

function KpiCard({ icon, color, value, label, hint }: { icon: string; color: string; value: string; label: string; hint?: string }) {
  const colorMap: Record<string, string> = {
    indigo: 'bg-brand/10 text-brand',
    emerald: 'bg-emerald-100 text-emerald-600',
    blue: 'bg-blue-100 text-blue-600',
    purple: 'bg-purple-100 text-purple-600',
  }
  return (
    <div className="bg-white rounded-xl shadow-md border-2 border-gray-300 p-5 flex items-center gap-4">
      <div className={`shrink-0 inline-flex w-12 h-12 rounded-xl items-center justify-center text-2xl ${colorMap[color] ?? 'bg-gray-100'}`}>
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xl font-bold text-gray-900">{value}</p>
        <p className="text-xs text-gray-600 mt-0.5 font-medium">{label}</p>
        {hint && <p className="text-[11px] text-gray-500 mt-1 italic">{hint}</p>}
      </div>
    </div>
  )
}

function PreviewField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{label}</p>
      <p className="text-sm text-gray-900 font-medium mt-0.5 break-words">{value || '—'}</p>
    </div>
  )
}

function ModalField({ label, value, onChange, type = 'text', step, min, required, placeholder }: {
  label: string; value: string; onChange: (v: string) => void
  type?: string; step?: string; min?: string; required?: boolean; placeholder?: string
}) {
  const faltante = required && !value.trim()
  return (
    <div>
      <label className="text-xs font-semibold text-gray-700">
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      <input
        type={type}
        step={step}
        min={min}
        required={required}
        placeholder={placeholder}
        value={value}
        onChange={e => onChange(e.target.value)}
        className={`mt-1 w-full border-2 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand ${
          faltante ? 'border-red-300 bg-red-50' : 'border-gray-300'
        }`}
      />
    </div>
  )
}

function ModalAddressField({ label, value, onChange, required, placeholder }: {
  label: string; value: string; onChange: (v: string) => void
  required?: boolean; placeholder?: string
}) {
  const faltante = required && !value.trim()
  return (
    <div>
      <label className="text-xs font-semibold text-gray-700">
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      <div className="mt-1">
        <AddressAutocomplete
          value={value}
          onChange={onChange}
          required={required}
          placeholder={placeholder ?? 'Empieza a escribir la dirección…'}
          className={`w-full border-2 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand ${
            faltante ? 'border-red-300 bg-red-50' : 'border-gray-300'
          }`}
        />
      </div>
    </div>
  )
}
