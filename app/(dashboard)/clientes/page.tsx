'use client'
import { useState, useEffect, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
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
}
type Especie = { id: string; nombre: string; letra: string; activo: string }
type Veterinario = { id: string; nombre: string; activo: string }
type Producto = { id: string; nombre: string; precio: string; stock: string; activo: string }
type OtroServicio = { id: string; nombre: string; precio: string; activo: string }
type AdicionalItem = { tipo: 'producto' | 'servicio'; id: string; nombre: string; precio: number; qty: number }

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
  const [filtro, setFiltro] = useState<'todos' | 'pendiente' | 'cremado' | 'despachado' | 'pago_pendiente' | 'este_mes' | 'esta_semana' | 'datos_pendientes'>('todos')
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [selected, setSelected] = useState<Cliente | null>(null)
  const [especies, setEspecies] = useState<Especie[]>([])
  const [veterinarias, setVeterinarias] = useState<Veterinario[]>([])
  const [productosDisp, setProductosDisp] = useState<Producto[]>([])
  const [otrosServicios, setOtrosServicios] = useState<OtroServicio[]>([])
  const [noEsVeterinaria, setNoEsVeterinaria] = useState(false)
  const [adicionales, setAdicionales] = useState<AdicionalItem[]>([])
  const [showAdicionales, setShowAdicionales] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState(FORM_DEFAULT)
  const [formError, setFormError] = useState('')

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
  }, [])

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
    }
    const res = await fetch('/api/clientes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (res.ok) {
      setShowModal(false)
      setForm(FORM_DEFAULT)
      setNoEsVeterinaria(false)
      setAdicionales([])
      setShowAdicionales(false)
      await fetchClientes()
    } else {
      const err = await res.json().catch(() => ({}))
      setFormError(err?.error ?? 'Error al guardar la ficha. Revisá que todos los campos obligatorios estén completos.')
    }
    setSaving(false)
  }

  const totalAdicionales = adicionales.reduce((sum, a) => sum + a.precio * a.qty, 0)

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
              <p className="text-xs text-amber-700 mt-0.5">Todos los clientes cuyo estado de pago es &quot;pendiente&quot;. Tocá uno para ver su ficha.</p>
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
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <KpiCard icon="👥" color="indigo" value={kpis.total.toString()} label="Total clientes" />
        <KpiCard icon="👥" color="emerald" value={kpis.delMes.toString()} label="Clientes del mes"
          hint={kpis.promMesHist !== null ? `Promedio histórico: ${kpis.promMesHist.toFixed(1)} (${kpis.mesesCerrados} mes${kpis.mesesCerrados !== 1 ? 'es' : ''})` : 'Sin histórico aún'} />
        <KpiCard icon="👥" color="blue" value={kpis.delaSemana.toString()} label="Clientes de la semana"
          hint={kpis.promSemanaHist !== null ? `Promedio histórico: ${kpis.promSemanaHist.toFixed(1)} (${kpis.semanasCerradas} semana${kpis.semanasCerradas !== 1 ? 's' : ''})` : 'Sin histórico aún'} />
        <KpiCard icon="⚖️" color="purple" value={fmtKg(kpis.pesoProm)} label="Peso promedio" />
      </div>

      {/* Segmentación */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <div className="bg-white rounded-xl shadow-md border-2 border-gray-200 p-5">
          <p className="text-xs font-bold text-gray-600 uppercase tracking-wide mb-3">Distribución por especie</p>
          <Distribucion items={kpis.porEspecie} total={kpis.total} />
        </div>
        <div className="bg-white rounded-xl shadow-md border-2 border-gray-200 p-5">
          <p className="text-xs font-bold text-gray-600 uppercase tracking-wide mb-3">Distribución por servicio</p>
          <Distribucion items={kpis.porServicio} total={kpis.total} />
        </div>
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
            { id: 'pendiente', label: '⏳ Pendientes de cremación' },
            { id: 'cremado', label: '✓ Cremados' },
            { id: 'despachado', label: '📦 Despachados' },
            { id: 'pago_pendiente', label: '⚠ Pago pendiente' },
            { id: 'este_mes', label: 'Este mes' },
            { id: 'esta_semana', label: 'Esta semana' },
            { id: 'datos_pendientes', label: '📝 Datos pendientes' },
          ] as const).map(opt => {
            const active = filtro === opt.id
            return (
              <button
                key={opt.id}
                onClick={() => setFiltro(opt.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold border-2 transition-colors ${
                  active
                    ? 'bg-indigo-600 border-indigo-600 text-white shadow-md'
                    : 'bg-white border-gray-300 text-gray-700 hover:border-indigo-400 hover:bg-indigo-50'
                }`}
              >
                {opt.label}
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
                <span className="font-mono text-xs text-indigo-700 font-bold bg-indigo-50 px-2 py-0.5 rounded">{c.codigo}</span>
                <Badge variant={c.estado === 'cremado' ? 'green' : c.estado === 'despachado' ? 'blue' : 'yellow'}>{c.estado || 'pendiente'}</Badge>
              </div>
              <p className="font-bold text-gray-900 text-base">{c.nombre_mascota}</p>
              <p className="text-sm text-gray-600">{c.nombre_tutor}</p>
              <div className="mt-3 flex items-center gap-2 flex-wrap">
                <span className="text-xs text-gray-500">{c.especie}</span>
                <span className="text-gray-300">·</span>
                <span className="text-xs text-gray-500">{fmtKg(parsePeso(c.peso_ingreso) || parsePeso(c.peso_declarado))}</span>
                <span className="text-gray-300">·</span>
                <span className="text-xs font-semibold text-gray-700">{c.codigo_servicio}</span>
              </div>
              {c.estado_pago !== 'pagado' && (
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
              <Badge variant={selected.estado === 'cremado' ? 'green' : selected.estado === 'despachado' ? 'blue' : 'yellow'}>{selected.estado || 'pendiente'}</Badge>
              {selected.estado_pago === 'pagado' ? (
                <Badge variant="green">Pagado</Badge>
              ) : (
                <Badge variant="yellow">Pago pendiente</Badge>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3 text-sm">
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

          <div className="grid grid-cols-2 gap-3">
            <ModalField required label="Nombre mascota" value={form.nombre_mascota} onChange={v => setForm(f => ({ ...f, nombre_mascota: v }))} />
            <ModalField required label="Nombre tutor" value={form.nombre_tutor} onChange={v => setForm(f => ({ ...f, nombre_tutor: v }))} />
            <ModalField required type="email" label="Email" value={form.email} onChange={v => setForm(f => ({ ...f, email: v }))} placeholder="ejemplo@correo.cl" />
            <ModalField required type="tel" label="Teléfono" value={form.telefono} onChange={v => setForm(f => ({ ...f, telefono: v }))} placeholder="+56 9 xxxx xxxx" />
          </div>

          <ModalField required label="Dirección de retiro" value={form.direccion_retiro}
            onChange={v => setForm(f => ({ ...f, direccion_retiro: v, direccion_despacho: f.misma_direccion ? v : f.direccion_despacho }))} />

          <div className="flex items-center gap-2">
            <input type="checkbox" id="misma" checked={form.misma_direccion}
              onChange={e => setForm(f => ({ ...f, misma_direccion: e.target.checked, direccion_despacho: e.target.checked ? f.direccion_retiro : '' }))}
              className="w-4 h-4 rounded border-gray-400 text-indigo-600 focus:ring-indigo-500" />
            <label htmlFor="misma" className="text-xs font-medium text-gray-700">Misma dirección para despacho</label>
          </div>

          {!form.misma_direccion && (
            <ModalField required label="Dirección de despacho" value={form.direccion_despacho} onChange={v => setForm(f => ({ ...f, direccion_despacho: v }))} />
          )}

          <div className="grid grid-cols-2 gap-3">
            <ModalField required label="Comuna" value={form.comuna} onChange={v => setForm(f => ({ ...f, comuna: v }))} />
            <ModalField required type="date" label="Fecha de retiro" value={form.fecha_retiro} onChange={v => setForm(f => ({ ...f, fecha_retiro: v }))} />
          </div>

          <div className="grid grid-cols-2 gap-3">
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
              const svc = SERVICIOS.find(s => s.codigo === e.target.value)
              setForm(f => ({ ...f, codigo_servicio: e.target.value, tipo_servicio: svc?.nombre ?? '' }))
            }} className="mt-1 w-full border-2 border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
              {SERVICIOS.map(s => <option key={s.codigo} value={s.codigo}>{s.nombre} ({s.codigo})</option>)}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3 pt-2 border-t-2 border-gray-200">
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

          {/* Veterinaria */}
          <div className="border-t-2 border-gray-200 pt-4">
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-semibold text-gray-700">Veterinaria derivante</label>
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input type="checkbox" checked={noEsVeterinaria} onChange={e => { setNoEsVeterinaria(e.target.checked); if (e.target.checked) setForm(f => ({ ...f, veterinaria_id: '' })) }} className="w-3.5 h-3.5 rounded border-gray-400 text-indigo-600 focus:ring-indigo-500" />
                <span className="text-xs text-gray-600">No es veterinaria</span>
              </label>
            </div>
            {!noEsVeterinaria && (
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
                  {productosDisp.length > 0 && (
                    <div className="mb-3">
                      <p className="text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wide">Productos</p>
                      <div className="space-y-1.5">
                        {productosDisp.map(p => {
                          const item = adicionales.find(a => a.tipo === 'producto' && a.id === p.id)
                          const stockNum = parseInt(p.stock || '0')
                          return (
                            <div key={p.id} className="flex items-center gap-2">
                              <input type="checkbox" checked={!!item} onChange={() => toggleAdicional('producto', p)} className="w-3.5 h-3.5 rounded border-gray-400 text-indigo-600 focus:ring-indigo-500" />
                              <span className="flex-1 text-sm text-gray-800">{p.nombre}</span>
                              <span className="text-xs text-gray-500">{fmtPrecio(p.precio)}</span>
                              {stockNum < 50 && <span className="text-xs text-red-500 font-medium">⚠{stockNum}</span>}
                              {item && (
                                <input type="number" min={1} value={item.qty} onChange={e => updateQty('producto', p.id, parseInt(e.target.value) || 1)}
                                  className="w-14 border-2 border-gray-300 rounded px-1.5 py-0.5 text-xs text-center focus:outline-none focus:ring-1 focus:ring-indigo-500" />
                              )}
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )}

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

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={() => { setShowModal(false); setAdicionales([]); setShowAdicionales(false); setFormError('') }} className="flex-1 border-2 border-gray-300 text-gray-700 rounded-lg py-2 text-sm font-semibold hover:bg-gray-50 transition-colors">
              Cancelar
            </button>
            <button type="submit" disabled={saving} className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg py-2 text-sm font-semibold shadow-md transition-colors disabled:opacity-50">
              {saving ? 'Guardando...' : 'Guardar ficha'}
            </button>
          </div>
        </form>
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

function Distribucion({ items, total }: { items: Record<string, number>; total: number }) {
  const sorted = Object.entries(items).sort((a, b) => b[1] - a[1]).slice(0, 5)
  if (total === 0 || sorted.length === 0) {
    return <p className="text-xs text-gray-400">Sin datos</p>
  }
  return (
    <div className="space-y-2">
      {sorted.map(([label, count]) => {
        const pct = Math.round((count / total) * 100)
        return (
          <div key={label}>
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="font-semibold text-gray-800">{label}</span>
              <span className="text-gray-600">{count} · {pct}%</span>
            </div>
            <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
              <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${pct}%` }} />
            </div>
          </div>
        )
      })}
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
