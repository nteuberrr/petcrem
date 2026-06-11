'use client'
import { useState, useEffect, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import AddressAutocomplete from '@/components/ui/AddressAutocomplete'
import { fmtKg, fmtPrecio, fmtFecha } from '@/lib/format'
import { todayISO, formatDateForSheet } from '@/lib/dates'
import { parseDecimal, parsePeso } from '@/lib/numbers'

type Cliente = {
  id: string; codigo: string; nombre_mascota: string; nombre_tutor: string
  email?: string; telefono?: string
  especie: string; peso_declarado?: string; peso_ingreso?: string
  tipo_servicio: string; codigo_servicio: string
  estado: string; estado_pago?: string; tipo_pago?: string
  fecha_retiro: string; fecha_creacion: string; ciclo_id: string
  direccion_retiro?: string; direccion_despacho?: string; comuna?: string
  adicionales?: string
}
type Especie = { id: string; nombre: string; letra: string; activo: string }
type Veterinario = { id: string; nombre: string; activo: string; tipo_precios?: string }
type Producto = { id: string; nombre: string; precio: string; stock: string; categoria?: string; activo: string }
type OtroServicio = { id: string; nombre: string; precio: string; activo: string }
type AdicionalItem = { tipo: 'producto' | 'servicio'; id: string; nombre: string; precio: number; qty: number }
type Descuento = { id: string; nombre: string; tipo: string; valor: string; activo: string }
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
  const [filtro, setFiltro] = useState<'todos' | 'borrador' | 'pendiente' | 'cremado' | 'despachado' | 'pago_pendiente' | 'este_mes' | 'esta_semana' | 'datos_pendientes'>('todos')
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
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
  const [form, setForm] = useState(FORM_DEFAULT)
  const [formError, setFormError] = useState('')
  const [preciosGenerales, setPreciosGenerales] = useState<Tramo[]>([])
  const [preciosConvenio, setPreciosConvenio] = useState<Tramo[]>([])
  const [tramosEspeciales, setTramosEspeciales] = useState<TramoEspecial[]>([])
  const [fichaCreada, setFichaCreada] = useState<FichaCreada | null>(null)

  const fetchClientes = useCallback(async () => {
    setLoading(true)
    const res = await fetch('/api/clientes')
    const data = await res.json()
    setClientes(Array.isArray(data) ? data : [])
    setLoading(false)
  }, [])

  useEffect(() => { fetchClientes() }, [fetchClientes])

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
      if (c.estado_pago !== 'pagado') {
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
      if (filtro === 'pago_pendiente' && c.estado_pago === 'pagado') return false
      if (filtro === 'datos_pendientes' && !tieneDatosPendientes(c)) return false
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
  }, [buscar, filtro, clientes])

  const nBorradores = useMemo(() => clientes.filter(c => c.estado === 'borrador').length, [clientes])

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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setFormError('')
    setSaving(true)
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
      setEsClienteVet(false)
      setAdicionales([])
      setShowAdicionales(false)
      setAplicarDescuento(false)
      setDescuentoId('')
      await fetchClientes()
    } else {
      const err = await res.json().catch(() => ({}))
      setFormError(err?.error ?? 'Error al guardar la ficha. Revisa que todos los campos obligatorios estén completos.')
    }
    setSaving(false)
  }

  const totalAdicionales = adicionales.reduce((sum, a) => sum + a.precio * a.qty, 0)

  // Resumen del servicio en vivo: tabla aplicable según veterinaria y cálculo del tramo
  function encontrarTramo(tabla: Tramo[], peso: number): Tramo | null {
    if (!tabla.length || !isFinite(peso) || peso <= 0) return null
    const maxPesoMin = Math.max(...tabla.map(t => parseFloat(t.peso_min) || 0))
    const tramoTope = tabla.find(t => (parseFloat(t.peso_min) || 0) === maxPesoMin)
    if (tramoTope && peso >= maxPesoMin) return tramoTope
    // Regla de borde: intervalos [min, max) → en el límite exacto gana el tramo
    // MAYOR (ej. 15 kg entre 10–15 y 15–25 → usa 15–25). Igual que lib/price-calculator.
    return tabla.find(t => {
      const min = parseFloat(t.peso_min) || 0
      const max = parseFloat(t.peso_max) || 0
      return peso >= min && peso < max
    }) ?? null
  }
  function precioDelTramo(t: Tramo | null, codigo: string): number {
    if (!t) return 0
    const raw = codigo === 'CP' ? t.precio_cp : codigo === 'SD' ? t.precio_sd : t.precio_ci
    return parseFloat(raw) || 0
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
  const montoDescuento = !descuentoElegido
    ? 0
    : descuentoElegido.tipo === 'fijo'
      ? Math.min(descuentoValorNum, subtotalServicio)
      : Math.round((subtotalServicio * descuentoValorNum) / 100)
  const totalServicio = Math.max(0, subtotalServicio - montoDescuento)
  const descuentoEtiqueta = descuentoElegido
    ? descuentoElegido.tipo === 'fijo' ? fmtPrecio(descuentoValorNum) : `${descuentoValorNum}%`
    : ''
  const rangoTramo = tramoAplicable ? (() => {
    const maxPesoMin = Math.max(...tablaPrecios.map(t => parseFloat(t.peso_min) || 0))
    const min = parseFloat(tramoAplicable.peso_min) || 0
    return min === maxPesoMin ? `${min} kg o más` : `${tramoAplicable.peso_min} – ${tramoAplicable.peso_max} kg`
  })() : null

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Clientes</h1>
          <p className="text-gray-600 text-sm mt-0.5">Fichas de mascotas</p>
        </div>
        <button
          onClick={() => { setForm({ ...FORM_DEFAULT, fecha_retiro: todayISO() }); setShowModal(true) }}
          className="bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2.5 rounded-lg text-sm font-semibold shadow-md transition-colors"
        >
          + Nueva ficha
        </button>
      </div>

      {/* Alerta de pagos pendientes */}
      {kpis.pendientesPago > 0 && (
        <div className="mb-6 rounded-xl border-2 border-amber-300 bg-amber-50 px-5 py-4 shadow-md">
          <div className="flex items-center gap-4">
            <div className="shrink-0 inline-flex w-12 h-12 rounded-xl bg-amber-200 items-center justify-center text-2xl">⚠️</div>
            <div className="flex-1">
              <p className="text-sm font-bold text-amber-900">
                {kpis.pendientesPago} cliente{kpis.pendientesPago !== 1 ? 's' : ''} con pago pendiente
              </p>
              <p className="text-xs text-amber-700 mt-0.5">Todos los clientes cuyo estado de pago es &quot;pendiente&quot;. Toca uno para ver su ficha.</p>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {kpis.clientesPendientesPago.map(c => (
              <button
                key={c.id}
                onClick={() => setSelected(c)}
                className="inline-flex items-center gap-2 bg-white border-2 border-amber-300 hover:border-amber-500 hover:bg-amber-100 px-3 py-1.5 rounded-lg text-xs font-semibold text-amber-900 transition-colors shadow-sm"
              >
                <span className="font-mono text-[10px] text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded">{c.codigo}</span>
                <span>{c.nombre_mascota}</span>
                <span className="text-amber-700 font-normal">· {c.nombre_tutor}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
        <KpiCard icon="👥" color="indigo" value={kpis.total.toString()} label="Total clientes" />
        <KpiCard icon="👥" color="emerald" value={kpis.delMes.toString()} label="Clientes del mes"
          hint={kpis.promMesHist !== null ? `Promedio histórico: ${kpis.promMesHist.toFixed(1)} (${kpis.mesesCerrados} mes${kpis.mesesCerrados !== 1 ? 'es' : ''})` : 'Sin histórico aún'} />
      </div>

      {/* Buscador + filtros */}
      <div className="bg-white rounded-xl shadow-md border-2 border-gray-200 p-4 mb-6">
        <input
          type="text"
          placeholder="🔍 Buscar por nombre, tutor, código, email o teléfono..."
          value={buscar}
          onChange={(e) => setBuscar(e.target.value)}
          className="w-full border-2 border-gray-300 rounded-lg px-4 py-3 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
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
                    ? 'bg-indigo-600 border-indigo-600 text-white shadow-md'
                    : esBorr && nBorradores > 0
                      ? 'bg-amber-50 border-amber-300 text-amber-800 hover:bg-amber-100'
                      : 'bg-white border-gray-300 text-gray-700 hover:border-indigo-400 hover:bg-indigo-50'
                }`}
              >
                {opt.label}{esBorr && nBorradores > 0 ? ` (${nBorradores})` : ''}
              </button>
            )
          })}
        </div>
        <p className="text-xs text-gray-500 mt-3">
          {resultados.length} resultado{resultados.length !== 1 ? 's' : ''} · {clientes.length} en total
        </p>
      </div>

      {/* Cards de resultados */}
      {loading ? (
        <div className="bg-white rounded-xl shadow-md border-2 border-gray-200 p-12 text-center text-gray-500 text-sm">Cargando...</div>
      ) : resultados.length === 0 ? (
        <div className="bg-white rounded-xl shadow-md border-2 border-gray-200 p-12 text-center text-gray-500 text-sm">
          Sin resultados para tu búsqueda o filtro.
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-md border-2 border-gray-200 p-4 max-h-[640px] overflow-y-auto">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 pr-1">
          {resultados.map(c => (
            <button
              key={c.id}
              onClick={() => setSelected(c)}
              className="text-left bg-white rounded-xl shadow-md border-2 border-gray-200 hover:border-indigo-400 hover:shadow-lg p-4 transition-all"
            >
              <div className="flex items-start justify-between mb-2">
                <span className={`font-mono text-xs font-bold px-2 py-0.5 rounded ${c.codigo ? 'text-indigo-700 bg-indigo-50' : 'text-gray-400 bg-gray-100'}`}>{c.codigo || 'sin código'}</span>
                <Badge variant={c.estado === 'cremado' ? 'green' : c.estado === 'despachado' ? 'blue' : 'yellow'}>{c.estado === 'borrador' ? 'Por ingresar' : c.estado && c.estado !== 'pendiente' ? c.estado : 'retirado'}</Badge>
              </div>
              <p className="font-bold text-gray-900 text-base">{c.nombre_mascota || <span className="text-gray-400 italic">Sin nombre</span>}</p>
              <p className="text-sm text-gray-600">{c.nombre_tutor}</p>
              <div className="mt-3 flex items-center gap-2 flex-wrap">
                <span className="text-xs text-gray-500">{c.especie || (c.estado === 'borrador' ? 'falta especie' : '')}</span>
                <span className="text-gray-300">·</span>
                <span className="text-xs text-gray-500">{fmtKg(parsePeso(c.peso_ingreso) || parsePeso(c.peso_declarado))}</span>
                <span className="text-gray-300">·</span>
                <span className="text-xs font-semibold text-gray-700">{c.codigo_servicio}</span>
              </div>
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
            </button>
          ))}
        </div>
        </div>
      )}

      {/* Modal preview de cliente seleccionado */}
      <Modal open={!!selected} onClose={() => setSelected(null)} title={selected?.nombre_mascota ?? ''}>
        {selected && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono text-xs text-indigo-700 font-bold bg-indigo-50 px-2 py-0.5 rounded">{selected.codigo}</span>
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
              <div className="col-span-2">
                <PreviewField label="Dirección de retiro" value={selected.direccion_retiro || '—'} />
              </div>
              {selected.direccion_despacho && selected.direccion_despacho !== selected.direccion_retiro && (
                <div className="col-span-2">
                  <PreviewField label="Dirección de despacho" value={selected.direccion_despacho} />
                </div>
              )}
            </div>

            {(() => {
              let items: AdicionalItem[] = []
              try { items = JSON.parse(selected.adicionales || '[]') } catch {}
              if (!Array.isArray(items) || items.length === 0) return null
              const total = items.reduce((s, a) => s + (a.precio || 0) * (a.qty || 1), 0)
              const productos = items.filter(a => a.tipo === 'producto')
              const servicios = items.filter(a => a.tipo === 'servicio')
              return (
                <div className="border-t-2 border-gray-100 pt-3">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Adicionales</p>
                    <span className="bg-indigo-100 text-indigo-700 text-xs font-semibold px-2 py-0.5 rounded-full">
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
                            <span className="text-gray-700">{fmtPrecio(a.precio * (a.qty || 1))}</span>
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
                className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg py-2 text-sm font-semibold text-center shadow-md transition-colors"
              >
                Abrir ficha completa
              </Link>
            </div>
          </div>
        )}
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
              className="w-4 h-4 rounded border-gray-400 text-indigo-600 focus:ring-indigo-500" />
            <label htmlFor="misma" className="text-xs font-medium text-gray-700">Misma dirección para despacho</label>
          </div>

          {!form.misma_direccion && (
            <ModalAddressField required label="Dirección de despacho" value={form.direccion_despacho} onChange={v => setForm(f => ({ ...f, direccion_despacho: v }))} />
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <ModalField required label="Comuna" value={form.comuna} onChange={v => setForm(f => ({ ...f, comuna: v }))} />
            <ModalField required type="date" label="Fecha de defunción" value={form.fecha_defuncion} onChange={v => setForm(f => ({ ...f, fecha_defuncion: v }))} />
            <ModalField required type="date" label="Fecha de retiro" value={form.fecha_retiro} onChange={v => setForm(f => ({ ...f, fecha_retiro: v }))} />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-gray-700">
                Especie <span className="text-red-500">*</span>
              </label>
              <select required value={form.especie} onChange={e => {
                const esp = especies.find(es => es.nombre === e.target.value)
                setForm(f => ({ ...f, especie: e.target.value, letra_especie: esp?.letra ?? '' }))
              }} className={`mt-1 w-full border-2 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 ${!form.especie ? 'border-red-300 bg-red-50' : 'border-gray-300'}`}>
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
            }} className="mt-1 w-full border-2 border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
              {SERVICIOS.map(s => <option key={s.codigo} value={s.codigo}>{s.nombre} ({s.codigo})</option>)}
            </select>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t-2 border-gray-200">
            <div>
              <label className="text-xs font-semibold text-gray-700">
                Tipo de pago <span className="text-red-500">*</span>
              </label>
              <select required value={form.tipo_pago} onChange={e => setForm(f => ({ ...f, tipo_pago: e.target.value }))}
                className={`mt-1 w-full border-2 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 ${!form.tipo_pago ? 'border-red-300 bg-red-50' : 'border-gray-300'}`}>
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
                className="mt-1 w-full border-2 border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                <option value="pendiente">Pendiente de pago</option>
                <option value="pagado">Pagado</option>
              </select>
            </div>
          </div>

          {/* Veterinaria derivante (lógica invertida) */}
          <div className="border-t-2 border-gray-200 pt-4">
            <label className="flex items-center gap-2 cursor-pointer select-none mb-2">
              <input
                type="checkbox"
                checked={esClienteVet}
                onChange={e => {
                  setEsClienteVet(e.target.checked)
                  if (!e.target.checked) setForm(f => ({ ...f, veterinaria_id: '' }))
                }}
                className="w-4 h-4 rounded border-gray-400 text-indigo-600 focus:ring-indigo-500"
              />
              <span className="text-xs font-semibold text-gray-700">Cliente de veterinaria</span>
            </label>
            {esClienteVet && (
              <select value={form.veterinaria_id} onChange={e => setForm(f => ({ ...f, veterinaria_id: e.target.value }))}
                className="w-full border-2 border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                <option value="">Seleccionar veterinaria...</option>
                {veterinarias.map(v => <option key={v.id} value={v.id}>{v.nombre}</option>)}
              </select>
            )}
          </div>

          {/* Adicionales */}
          {(productosDisp.length > 0 || otrosServicios.length > 0) && (
            <div className="border-t-2 border-gray-200">
              <button
                type="button"
                onClick={() => setShowAdicionales(v => !v)}
                className="w-full flex items-center justify-between py-3 text-left hover:bg-gray-50 px-1 rounded transition-colors"
              >
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-gray-700">Adicionales</span>
                  {adicionales.length > 0 && (
                    <span className="bg-indigo-100 text-indigo-700 text-xs font-semibold px-2 py-0.5 rounded-full">
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
                        <div className="space-y-3">
                          {orden.map(cat => (
                            <div key={cat}>
                              <p className="text-[11px] font-bold text-indigo-700 uppercase tracking-wide mb-1.5 border-b border-indigo-100 pb-1">{cat}</p>
                              <div className="space-y-1.5 pl-1">
                                {grupos.get(cat)!.map(p => {
                                  const item = adicionales.find(a => a.tipo === 'producto' && a.id === p.id)
                                  const stockNum = parseInt(p.stock || '0')
                                  const sinStock = stockNum <= 0
                                  return (
                                    <div key={p.id} className={`flex items-center gap-2 ${sinStock ? 'opacity-50' : ''}`}>
                                      <input type="checkbox" checked={!!item} disabled={sinStock && !item}
                                        onChange={() => toggleAdicional('producto', p)}
                                        className="w-3.5 h-3.5 rounded border-gray-400 text-indigo-600 focus:ring-indigo-500 disabled:cursor-not-allowed" />
                                      <span className={`flex-1 text-sm ${sinStock ? 'text-gray-400 line-through' : 'text-gray-800'}`}>{p.nombre}</span>
                                      <span className={`text-xs ${sinStock ? 'text-gray-400 line-through' : 'text-gray-500'}`}>{fmtPrecio(p.precio)}</span>
                                      {sinStock && <span className="text-[10px] text-red-600 font-semibold">sin stock</span>}
                                      {item && !sinStock && (
                                        <input type="number" min={1} value={item.qty} onChange={e => updateQty('producto', p.id, parseInt(e.target.value) || 1)}
                                          className="w-14 border-2 border-gray-300 rounded px-1.5 py-0.5 text-xs text-center focus:outline-none focus:ring-1 focus:ring-indigo-500" />
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
                              <input type="checkbox" checked={!!item} onChange={() => toggleAdicional('servicio', s)} className="w-3.5 h-3.5 rounded border-gray-400 text-indigo-600 focus:ring-indigo-500" />
                              <span className="flex-1 text-sm text-gray-800">{s.nombre}</span>
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
          <div className="border-t-2 border-gray-200 pt-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-bold text-gray-900">Resumen del servicio</p>
              <span className="text-[11px] text-gray-400">{tablaNombre}</span>
            </div>
            <div className="bg-gray-50 rounded-lg border border-gray-200 p-3 space-y-2">
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
                <div className="border-t border-gray-200 pt-2 space-y-1">
                  <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Adicionales</p>
                  {adicionales.map(a => (
                    <div key={`${a.tipo}-${a.id}`} className="flex items-center justify-between text-sm">
                      <span className="text-gray-700">
                        {a.nombre}{a.qty > 1 && <span className="text-gray-400"> × {a.qty}</span>}
                      </span>
                      <span className="text-gray-700">{fmtPrecio(a.precio * a.qty)}</span>
                    </div>
                  ))}
                  <div className="flex items-center justify-between pt-1 border-t border-gray-200">
                    <span className="text-xs text-gray-500">Subtotal adicionales</span>
                    <span className="text-sm font-medium text-gray-700">{fmtPrecio(totalAdicionales)}</span>
                  </div>
                </div>
              )}

              <div className="border-t border-gray-200 pt-2">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={aplicarDescuento}
                    onChange={e => {
                      setAplicarDescuento(e.target.checked)
                      if (!e.target.checked) setDescuentoId('')
                    }}
                    className="w-4 h-4 rounded border-gray-400 text-indigo-600 focus:ring-indigo-500"
                  />
                  <span className="text-sm font-medium text-gray-700">Aplicar descuento</span>
                </label>
                {aplicarDescuento && (
                  <div className="mt-2 space-y-2">
                    <select
                      value={descuentoId}
                      onChange={e => setDescuentoId(e.target.value)}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
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
                <span className="text-lg font-bold text-indigo-700">{fmtPrecio(totalServicio)}</span>
              </div>
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={() => { setShowModal(false); setAdicionales([]); setShowAdicionales(false); setAplicarDescuento(false); setDescuentoId(''); setFormError('') }} className="flex-1 border-2 border-gray-300 text-gray-700 rounded-lg py-2 text-sm font-semibold hover:bg-gray-50 transition-colors">
              Cancelar
            </button>
            <button type="submit" disabled={saving} className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg py-2 text-sm font-semibold shadow-md transition-colors disabled:opacity-50">
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
              <div className="bg-gray-50 rounded-lg border border-gray-200 p-3 space-y-2">
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
                  <div className="border-t border-gray-200 pt-2 space-y-1">
                    <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Adicionales</p>
                    {fichaCreada.adicionales.map(a => (
                      <div key={`${a.tipo}-${a.id}`} className="flex items-center justify-between text-sm">
                        <span className="text-gray-700">
                          {a.nombre}{a.qty > 1 && <span className="text-gray-400"> × {a.qty}</span>}
                        </span>
                        <span className="text-gray-700">{fmtPrecio(a.precio * a.qty)}</span>
                      </div>
                    ))}
                    <div className="flex items-center justify-between pt-1 border-t border-gray-200">
                      <span className="text-xs text-gray-500">Subtotal adicionales</span>
                      <span className="text-sm font-medium text-gray-700">{fmtPrecio(fichaCreada.total_adicionales)}</span>
                    </div>
                  </div>
                )}

                {fichaCreada.descuento_monto > 0 && (
                  <div className="flex items-center justify-between border-t border-gray-200 pt-2 text-sm">
                    <span className="text-gray-700">
                      {fichaCreada.descuento_nombre}
                      <span className="text-gray-400 ml-1">({fichaCreada.descuento_etiqueta})</span>
                    </span>
                    <span className="font-semibold text-red-600">− {fmtPrecio(fichaCreada.descuento_monto)}</span>
                  </div>
                )}

                <div className="flex items-center justify-between border-t-2 border-gray-300 pt-2 mt-1">
                  <span className="text-base font-bold text-gray-900">Total a cobrar</span>
                  <span className="text-xl font-bold text-indigo-700">{fmtPrecio(fichaCreada.total)}</span>
                </div>
              </div>
            </div>

            <button
              onClick={() => setFichaCreada(null)}
              className="w-full bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg py-2.5 text-sm font-semibold shadow-md transition-colors"
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
    indigo: 'bg-indigo-100 text-indigo-600',
    emerald: 'bg-emerald-100 text-emerald-600',
    blue: 'bg-blue-100 text-blue-600',
    purple: 'bg-purple-100 text-purple-600',
  }
  return (
    <div className="bg-white rounded-xl shadow-md border-2 border-gray-200 p-5 flex items-center gap-4">
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
        className={`mt-1 w-full border-2 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 ${
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
          className={`w-full border-2 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 ${
            faltante ? 'border-red-300 bg-red-50' : 'border-gray-300'
          }`}
        />
      </div>
    </div>
  )
}
