'use client'
import { PageHeader, Card, Button, Tabs } from '@/components/ui/kit'
import { TablaScroll, THEAD_STICKY, HistorialPie } from '@/components/ui/TablaScroll'
import {
  Banknote, Check, Clock, CalendarClock, Coins, Pencil, Search, Timer,
  Trash2, Truck, X as XIcon,
} from 'lucide-react'
import { useEffect, useState, useCallback, useMemo } from 'react'
import { useSession } from 'next-auth/react'
import { fmtPrecio, fmtNumero, fmtFecha } from '@/lib/format'
import { todayISO, formatDateForSheet, formatHora } from '@/lib/dates'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { esAdmin, nombreVisible } from '@/lib/roles'

type Registro = {
  id: string
  usuario_id: string
  usuario_nombre: string
  fecha: string
  dia_semana: string
  es_findesemana: string
  hora_entrada: string
  hora_salida: string
  minutos_trabajados: string
  minutos_normales: string
  minutos_extra: string
  estado_aprobacion: string
  aprobado_por: string
  comentario: string
  fecha_creacion: string
}

type JornadaCfg = { id: string; vigente_desde: string; hora_entrada: string; hora_salida: string; precio_hora_extra: number; tolerancia_minutos: number; precio_retiro_adicional: number }
type RetiroAdicional = {
  id: string
  usuario_id: string
  usuario_nombre: string
  fecha: string
  hora: string
  cliente_nombre: string
  comentario: string
  pago_id: string
  fecha_creacion: string
}
type PagoRetiros = {
  id: string
  fecha_pago: string
  usuario_id: string
  usuario_nombre: string
  retiros_ids: string[]
  cantidad: number
  monto_total: number
  comentarios: string
  creado_por: string
  fecha_creacion: string
}

/**
 * Formatea minutos como duración:
 * - 0 → "0h"
 * - 30 → "30 min"
 * - 90 → "1h 30min"
 * - 1158 → "1158h" (sin minutos cuando son muchas horas, para que no confunda con hora de reloj)
 */
function fmtMinutos(mins: number): string {
  if (mins <= 0) return '0h'
  const h = Math.floor(mins / 60)
  const m = Math.round(mins % 60)
  if (h === 0) return `${m} min`
  if (m === 0) return `${h}h`
  return `${h}h ${m}min`
}

/** Cuántas filas se ven en cada historial antes de tener que scrollear dentro. */
const FILAS_VISIBLES = 10

/** Estilo único de todos los campos de la página (estándar del kit). */
const INPUT = 'mt-1 w-full border border-gray-300 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand focus:border-brand'

const TONOS = {
  brand: 'bg-brand/5 border-brand/25 text-brand',
  amber: 'bg-amber-50 border-amber-200 text-amber-800',
  emerald: 'bg-emerald-50 border-emerald-200 text-emerald-800',
} as const

/** Tarjetita de métrica de los resúmenes por operador. */
function Metrica({ icon, label, valor, nota, tono }: {
  icon: React.ReactNode; label: string; valor: string; nota?: string; tono: keyof typeof TONOS
}) {
  return (
    <div className={`rounded-xl border p-3.5 ${TONOS[tono]}`}>
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide opacity-90">
        {icon}{label}
      </div>
      <p className="text-xl font-extrabold mt-1.5 text-gray-900">{valor}</p>
      {nota && <p className="text-[11px] mt-0.5 opacity-90">{nota}</p>}
    </div>
  )
}

/** Botón de acción compacto de las tablas (solo icono + tooltip). */
function IconBtn({ onClick, titulo, tono = 'gris', children }: {
  onClick: () => void; titulo: string; tono?: 'gris' | 'red' | 'emerald' | 'amber'; children: React.ReactNode
}) {
  const estilos = {
    gris: 'border-gray-300 text-gray-600 hover:bg-gray-50 hover:text-brand',
    red: 'border-red-200 text-red-600 hover:bg-red-50',
    emerald: 'border-emerald-300 text-emerald-700 hover:bg-emerald-50',
    amber: 'border-amber-300 text-amber-700 hover:bg-amber-50',
  }[tono]
  return (
    <button onClick={onClick} title={titulo} aria-label={titulo}
      className={`border bg-white p-1.5 rounded-lg transition-colors ${estilos}`}>
      {children}
    </button>
  )
}

/**
 * Barra de filtros compartida por las dos pestañas. Antes solo el admin podía
 * filtrar y solo por mes/operador/estado; ahora filtra cualquiera (el operador
 * sobre lo suyo) por texto, mes, rango de fechas y el estado de cada pestaña.
 */
function Filtros({
  isAdmin, usuariosUnicos, texto, setTexto, placeholder, mes, setMes, desde, setDesde,
  hasta, setHasta, usuario, setUsuario, extra, hayFiltros, limpiar, resultados,
}: {
  isAdmin: boolean
  usuariosUnicos: { id: string; nombre: string }[]
  texto: string; setTexto: (v: string) => void; placeholder: string
  mes: string; setMes: (v: string) => void
  desde: string; setDesde: (v: string) => void
  hasta: string; setHasta: (v: string) => void
  usuario: string; setUsuario: (v: string) => void
  extra: React.ReactNode
  hayFiltros: boolean; limpiar: () => void; resultados: number
}) {
  return (
    <Card className="p-4 sm:p-5">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
          <input value={texto} onChange={e => setTexto(e.target.value)} placeholder={placeholder}
            className="w-full border border-gray-300 rounded-xl pl-9 pr-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand focus:border-brand" />
        </div>
        {hayFiltros && (
          <Button variant="secondary" onClick={limpiar}>
            <XIcon className="w-3.5 h-3.5 shrink-0" aria-hidden="true" /> Limpiar filtros
          </Button>
        )}
      </div>
      <div className={`grid grid-cols-1 sm:grid-cols-2 gap-3 ${isAdmin ? 'lg:grid-cols-5' : 'lg:grid-cols-4'}`}>
        <div>
          <label className="text-xs font-semibold text-gray-700">Mes</label>
          <input type="month" value={mes} onChange={e => setMes(e.target.value)} className={INPUT} />
        </div>
        <div>
          <label className="text-xs font-semibold text-gray-700">Desde</label>
          <input type="date" value={desde} onChange={e => setDesde(e.target.value)} className={INPUT} />
        </div>
        <div>
          <label className="text-xs font-semibold text-gray-700">Hasta</label>
          <input type="date" value={hasta} onChange={e => setHasta(e.target.value)} className={INPUT} />
        </div>
        {isAdmin && (
          <div>
            <label className="text-xs font-semibold text-gray-700">Operador</label>
            <select value={usuario} onChange={e => setUsuario(e.target.value)} className={INPUT}>
              <option value="">Todos</option>
              {usuariosUnicos.map(u => <option key={u.id} value={u.id}>{nombreVisible(u.nombre)}</option>)}
            </select>
          </div>
        )}
        {extra}
      </div>
      <p className="text-xs text-gray-600 mt-3">
        {resultados} {resultados === 1 ? 'resultado' : 'resultados'}{hayFiltros ? ' con los filtros aplicados' : ''}
      </p>
    </Card>
  )
}

/**
 * Orden de los historiales: lo más nuevo arriba (fecha desc, y a igual fecha el
 * id mayor). Sin esto la lista arrancaba por lo más viejo y las 10 primeras
 * filas eran siempre las mismas de hace meses.
 */
function ordenDesc(a: { fecha: string; id: string }, b: { fecha: string; id: string }): number {
  const fa = formatDateForSheet(a.fecha) || a.fecha
  const fb = formatDateForSheet(b.fecha) || b.fecha
  if (fa !== fb) return fa < fb ? 1 : -1
  return (parseInt(b.id, 10) || 0) - (parseInt(a.id, 10) || 0)
}

export default function AsistenciaPage() {
  const { data: session } = useSession()
  const role = (session?.user as { role?: string })?.role ?? 'operador'
  // admin y admin2 gestionan asistencia (ver todos, aprobar horas, registrar pagos).
  const isAdmin = esAdmin(role)
  const myId = (session?.user as { id?: string })?.id ?? '0'
  const myName = session?.user?.name ?? session?.user?.email ?? ''

  const [tab, setTab] = useState<'fichajes' | 'retiros'>('fichajes')
  const [registros, setRegistros] = useState<Registro[]>([])
  const [vigente, setVigente] = useState<JornadaCfg | null>(null)
  const [loading, setLoading] = useState(true)

  // Retiros adicionales
  const [retiros, setRetiros] = useState<RetiroAdicional[]>([])
  const [retiroForm, setRetiroForm] = useState({ fecha: todayISO(), hora: '', cliente_nombre: '', comentario: '' })
  const [savingRetiro, setSavingRetiro] = useState(false)
  const [errorRetiro, setErrorRetiro] = useState('')
  const [editingRetiro, setEditingRetiro] = useState<RetiroAdicional | null>(null)
  const [editRetiroForm, setEditRetiroForm] = useState({ fecha: '', hora: '', cliente_nombre: '', comentario: '' })
  const [savingEditRetiro, setSavingEditRetiro] = useState(false)
  const [errorEditRetiro, setErrorEditRetiro] = useState('')

  // Filtro de estado de pago + pagos realizados
  const [filtroPago, setFiltroPago] = useState<'todos' | 'pendiente' | 'pagado'>('todos')
  const [pagos, setPagos] = useState<PagoRetiros[]>([])
  const [showPagoModal, setShowPagoModal] = useState(false)
  const [pagoFecha, setPagoFecha] = useState(todayISO())
  const [pagoSeleccion, setPagoSeleccion] = useState<Set<string>>(new Set())
  const [pagoComentario, setPagoComentario] = useState('')
  const [savingPago, setSavingPago] = useState(false)
  const [errorPago, setErrorPago] = useState('')

  // Form fichaje
  const [form, setForm] = useState({ fecha: todayISO(), hora_entrada: '', hora_salida: '', comentario: '' })
  const [saving, setSaving] = useState(false)
  const [errorForm, setErrorForm] = useState('')

  // Modal de edición
  const [editing, setEditing] = useState<Registro | null>(null)
  const [editForm, setEditForm] = useState({ fecha: '', hora_entrada: '', hora_salida: '', comentario: '' })
  const [savingEdit, setSavingEdit] = useState(false)
  const [errorEdit, setErrorEdit] = useState('')

  // Filtros — mes vacío = mostrar todos los meses por default. Los ve TODO el
  // mundo (el operador filtra sobre lo suyo); el selector de operador es del admin.
  const [filtroMes, setFiltroMes] = useState('')
  const [filtroUsuario, setFiltroUsuario] = useState('')
  const [filtroEstado, setFiltroEstado] = useState<'todos' | 'pendiente' | 'aprobado' | 'rechazado' | 'abierto'>('todos')
  const [filtroDesde, setFiltroDesde] = useState('')
  const [filtroHasta, setFiltroHasta] = useState('')
  const [filtroTexto, setFiltroTexto] = useState('')
  const hayFiltros = !!(filtroMes || filtroUsuario || filtroDesde || filtroHasta || filtroTexto || filtroEstado !== 'todos' || filtroPago !== 'todos')
  function limpiarFiltros() {
    setFiltroMes(''); setFiltroUsuario(''); setFiltroEstado('todos')
    setFiltroDesde(''); setFiltroHasta(''); setFiltroTexto(''); setFiltroPago('todos')
  }

  const fetchAll = useCallback(async () => {
    setLoading(true)
    const fetchers: Promise<unknown>[] = [
      fetch('/api/asistencia', { cache: 'no-store' }).then(r => r.json()),
      fetch('/api/jornada-config', { cache: 'no-store' }).then(r => r.json()),
      fetch('/api/retiros-adicionales', { cache: 'no-store' }).then(r => r.json()),
    ]
    if (isAdmin) {
      fetchers.push(fetch('/api/pagos-retiros', { cache: 'no-store' }).then(r => r.json()))
    }
    const results = await Promise.all(fetchers)
    const [resReg, resCfg, resRet, resPagos] = results
    setRegistros(Array.isArray(resReg) ? (resReg as Registro[]) : [])
    setVigente((resCfg as { vigente: JornadaCfg })?.vigente ?? null)
    setRetiros(Array.isArray(resRet) ? (resRet as RetiroAdicional[]) : [])
    setPagos(Array.isArray(resPagos) ? (resPagos as PagoRetiros[]) : [])
    setLoading(false)
  }, [isAdmin])

  useEffect(() => { fetchAll() }, [fetchAll])

  async function crearRetiro(e: React.FormEvent) {
    e.preventDefault()
    setErrorRetiro('')
    if (!retiroForm.fecha || !retiroForm.hora || !retiroForm.cliente_nombre.trim()) {
      setErrorRetiro('Fecha, hora y cliente son obligatorios')
      return
    }
    setSavingRetiro(true)
    const res = await fetch('/api/retiros-adicionales', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(retiroForm),
    })
    if (res.ok) {
      setRetiroForm({ fecha: todayISO(), hora: '', cliente_nombre: '', comentario: '' })
      await fetchAll()
    } else {
      const err = await res.json().catch(() => ({}))
      setErrorRetiro(err?.error ?? 'Error al guardar')
    }
    setSavingRetiro(false)
  }

  function abrirEditarRetiro(r: RetiroAdicional) {
    setEditingRetiro(r)
    setErrorEditRetiro('')
    setEditRetiroForm({
      fecha: formatDateForSheet(r.fecha) || r.fecha,
      hora: formatHora(r.hora),
      cliente_nombre: r.cliente_nombre ?? '',
      comentario: r.comentario ?? '',
    })
  }

  async function guardarEdicionRetiro(e: React.FormEvent) {
    e.preventDefault()
    if (!editingRetiro) return
    setErrorEditRetiro('')
    if (!editRetiroForm.cliente_nombre.trim()) return setErrorEditRetiro('El nombre del cliente es obligatorio')
    setSavingEditRetiro(true)
    const res = await fetch('/api/retiros-adicionales', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: editingRetiro.id,
        fecha: editRetiroForm.fecha,
        hora: editRetiroForm.hora,
        cliente_nombre: editRetiroForm.cliente_nombre,
        comentario: editRetiroForm.comentario,
      }),
    })
    if (res.ok) {
      setEditingRetiro(null)
      await fetchAll()
    } else {
      const err = await res.json().catch(() => ({}))
      setErrorEditRetiro(err?.error ?? 'Error al actualizar')
    }
    setSavingEditRetiro(false)
  }

  async function eliminarRetiro(id: string) {
    if (!confirm('¿Eliminar este retiro adicional?')) return
    const res = await fetch(`/api/retiros-adicionales?id=${id}`, { method: 'DELETE' })
    if (res.ok) await fetchAll()
    else {
      const err = await res.json().catch(() => ({}))
      alert(err?.error ?? 'Error al eliminar')
    }
  }

  function abrirModalPago() {
    setPagoFecha(todayISO())
    setPagoSeleccion(new Set())
    setPagoComentario('')
    setErrorPago('')
    setShowPagoModal(true)
  }

  function togglePagoRetiro(id: string) {
    setPagoSeleccion(prev => {
      const s = new Set(prev)
      if (s.has(id)) s.delete(id)
      else s.add(id)
      return s
    })
  }

  async function guardarPago(e: React.FormEvent) {
    e.preventDefault()
    setErrorPago('')
    if (pagoSeleccion.size === 0) {
      setErrorPago('Selecciona al menos un retiro')
      return
    }
    setSavingPago(true)
    // Agrupar selección por operador (cada pago en backend = 1 operador)
    const seleccionados = retiros.filter(r => pagoSeleccion.has(r.id))
    const porOperador = new Map<string, string[]>()
    for (const r of seleccionados) {
      const arr = porOperador.get(r.usuario_id) ?? []
      arr.push(r.id)
      porOperador.set(r.usuario_id, arr)
    }
    const errores: string[] = []
    for (const [, ids] of porOperador) {
      const res = await fetch('/api/pagos-retiros', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fecha_pago: pagoFecha,
          retiros_ids: ids,
          comentarios: pagoComentario,
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        errores.push(err?.error ?? `HTTP ${res.status}`)
      }
    }
    if (errores.length > 0) {
      setErrorPago(`Algunos pagos fallaron: ${errores.join('; ')}`)
    } else {
      setShowPagoModal(false)
    }
    await fetchAll()
    setSavingPago(false)
  }

  async function anularPago(p: PagoRetiros) {
    if (!confirm(`¿Anular el pago de ${fmtPrecio(p.monto_total)} a ${nombreVisible(p.usuario_nombre)}? Los ${p.cantidad} retiros volverán a quedar pendientes.`)) return
    const res = await fetch(`/api/pagos-retiros?id=${p.id}`, { method: 'DELETE' })
    if (res.ok) await fetchAll()
    else {
      const err = await res.json().catch(() => ({}))
      alert(err?.error ?? 'Error al anular pago')
    }
  }

  // Pendientes agrupados por operador para mostrar en el modal
  const pendientesAgrupados = useMemo(() => {
    const m = new Map<string, { usuario_id: string; usuario_nombre: string; retiros: RetiroAdicional[] }>()
    for (const r of retiros) {
      if (r.pago_id) continue
      let g = m.get(r.usuario_id)
      if (!g) {
        g = { usuario_id: r.usuario_id, usuario_nombre: r.usuario_nombre, retiros: [] }
        m.set(r.usuario_id, g)
      }
      g.retiros.push(r)
    }
    return Array.from(m.values()).sort((a, b) => a.usuario_nombre.localeCompare(b.usuario_nombre))
  }, [retiros])

  async function fichar(e: React.FormEvent) {
    e.preventDefault()
    setErrorForm('')
    if (!form.hora_entrada) {
      setErrorForm('Tienes que indicar al menos la hora de entrada')
      return
    }
    setSaving(true)
    const res = await fetch('/api/asistencia', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    if (res.ok) {
      setForm({ fecha: todayISO(), hora_entrada: '', hora_salida: '', comentario: '' })
      await fetchAll()
    } else {
      const err = await res.json().catch(() => ({}))
      setErrorForm(err?.error ?? 'Error al fichar')
    }
    setSaving(false)
  }

  function abrirEditar(r: Registro) {
    setEditing(r)
    setErrorEdit('')
    setEditForm({
      fecha: formatDateForSheet(r.fecha) || r.fecha,
      hora_entrada: formatHora(r.hora_entrada),
      hora_salida: formatHora(r.hora_salida),
      comentario: r.comentario ?? '',
    })
  }

  async function guardarEdicion(e: React.FormEvent) {
    e.preventDefault()
    if (!editing) return
    setErrorEdit('')
    setSavingEdit(true)
    const res = await fetch('/api/asistencia', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: editing.id,
        fecha: editForm.fecha,
        hora_entrada: editForm.hora_entrada,
        hora_salida: editForm.hora_salida,
        comentario: editForm.comentario,
      }),
    })
    if (res.ok) {
      setEditing(null)
      await fetchAll()
    } else {
      const err = await res.json().catch(() => ({}))
      setErrorEdit(err?.error ?? 'Error al actualizar')
    }
    setSavingEdit(false)
  }

  async function aprobar(id: string, estado: 'aprobado' | 'rechazado') {
    const res = await fetch('/api/asistencia', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, estado_aprobacion: estado }),
    })
    if (res.ok) await fetchAll()
    else alert('Error al actualizar')
  }

  async function eliminar(id: string) {
    if (!confirm('¿Eliminar este registro?')) return
    const res = await fetch(`/api/asistencia?id=${id}`, { method: 'DELETE' })
    if (res.ok) await fetchAll()
    else alert('No autorizado o error al eliminar')
  }

  const usuariosUnicos = useMemo(() => {
    const m = new Map<string, string>()
    registros.forEach(r => m.set(r.usuario_id, r.usuario_nombre))
    retiros.forEach(r => m.set(r.usuario_id, r.usuario_nombre))
    return Array.from(m.entries()).map(([id, nombre]) => ({ id, nombre })).sort((a, b) => a.nombre.localeCompare(b.nombre))
  }, [registros, retiros])

  const retirosFiltrados = useMemo(() => {
    const q = filtroTexto.trim().toLowerCase()
    return retiros.filter(r => {
      // Operador solo ve sus propios retiros
      if (!isAdmin && r.usuario_id !== myId) return false
      const fecha = formatDateForSheet(r.fecha) || r.fecha
      if (filtroMes && !fecha.startsWith(filtroMes)) return false
      if (filtroDesde && fecha < filtroDesde) return false
      if (filtroHasta && fecha > filtroHasta) return false
      if (filtroUsuario && r.usuario_id !== filtroUsuario) return false
      if (filtroPago === 'pendiente' && r.pago_id) return false
      if (filtroPago === 'pagado' && !r.pago_id) return false
      if (q && !`${r.usuario_nombre} ${r.cliente_nombre} ${r.comentario}`.toLowerCase().includes(q)) return false
      return true
    }).sort((a, b) => ordenDesc(a, b))
  }, [retiros, filtroMes, filtroDesde, filtroHasta, filtroUsuario, filtroPago, filtroTexto, isAdmin, myId])

  // Resumen de retiros por operador — para la tab "retiros". Separa pagados y pendientes
  // para que el admin vea ambos montos en lugar de uno solo agregado (que confundía).
  type ResumenRetiros = {
    usuario_id: string
    usuario_nombre: string
    cantidad_pagada: number
    cantidad_pendiente: number
    monto_pagado: number
    monto_pendiente: number
  }
  const resumenRetirosPorOperador = useMemo<ResumenRetiros[]>(() => {
    const precio = vigente?.precio_retiro_adicional ?? 0
    const m = new Map<string, ResumenRetiros>()
    for (const r of retirosFiltrados) {
      let acc = m.get(r.usuario_id)
      if (!acc) {
        acc = { usuario_id: r.usuario_id, usuario_nombre: r.usuario_nombre, cantidad_pagada: 0, cantidad_pendiente: 0, monto_pagado: 0, monto_pendiente: 0 }
        m.set(r.usuario_id, acc)
      }
      if (r.pago_id) {
        acc.cantidad_pagada += 1
        acc.monto_pagado += precio
      } else {
        acc.cantidad_pendiente += 1
        acc.monto_pendiente += precio
      }
    }
    return Array.from(m.values()).sort((a, b) => a.usuario_nombre.localeCompare(b.usuario_nombre))
  }, [retirosFiltrados, vigente])

  const filtrados = useMemo(() => {
    const q = filtroTexto.trim().toLowerCase()
    return registros.filter(r => {
      // Operador solo ve sus propios fichajes
      if (!isAdmin && r.usuario_id !== myId) return false
      const fecha = formatDateForSheet(r.fecha) || r.fecha
      if (filtroMes && !fecha.startsWith(filtroMes)) return false
      if (filtroDesde && fecha < filtroDesde) return false
      if (filtroHasta && fecha > filtroHasta) return false
      if (filtroUsuario && r.usuario_id !== filtroUsuario) return false
      if (filtroEstado !== 'todos' && (r.estado_aprobacion || 'pendiente') !== filtroEstado) return false
      if (q && !`${r.usuario_nombre} ${r.dia_semana} ${r.comentario}`.toLowerCase().includes(q)) return false
      return true
    }).sort((a, b) => ordenDesc(a, b))
  }, [registros, filtroMes, filtroDesde, filtroHasta, filtroUsuario, filtroEstado, filtroTexto, isAdmin, myId])

  // Resumen por operador — totales separados por persona
  type ResumenOperador = {
    usuario_id: string; usuario_nombre: string
    minutos_normales: number; minutos_extra_aprobado: number; minutos_extra_pendiente: number
    costo_extra: number; registros: number
  }
  const resumenPorOperador = useMemo<ResumenOperador[]>(() => {
    const precio = vigente?.precio_hora_extra ?? 0
    const m = new Map<string, ResumenOperador>()
    for (const r of filtrados) {
      let acc = m.get(r.usuario_id)
      if (!acc) {
        acc = { usuario_id: r.usuario_id, usuario_nombre: r.usuario_nombre, minutos_normales: 0, minutos_extra_aprobado: 0, minutos_extra_pendiente: 0, costo_extra: 0, registros: 0 }
        m.set(r.usuario_id, acc)
      }
      acc.minutos_normales += parseFloat(r.minutos_normales) || 0
      const extra = parseFloat(r.minutos_extra) || 0
      if (r.estado_aprobacion === 'aprobado') acc.minutos_extra_aprobado += extra
      else if (r.estado_aprobacion === 'pendiente') acc.minutos_extra_pendiente += extra
      acc.registros += 1
    }
    for (const acc of m.values()) {
      acc.costo_extra = (acc.minutos_extra_aprobado / 60) * precio
    }
    return Array.from(m.values()).sort((a, b) => a.usuario_nombre.localeCompare(b.usuario_nombre))
  }, [filtrados, vigente])

  // Pagos: lo más reciente arriba (el historial se ve de a 10 y scrollea).
  const pagosOrdenados = useMemo(
    () => [...pagos].sort((a, b) => ordenDesc({ fecha: a.fecha_pago, id: a.id }, { fecha: b.fecha_pago, id: b.id })),
    [pagos],
  )

  const fichajeHoy = useMemo(() => {
    const hoy = todayISO()
    return registros.find(r => r.usuario_id === myId && (formatDateForSheet(r.fecha) || r.fecha) === hoy)
  }, [registros, myId])

  if (loading) {
    return <div className="text-sm text-gray-500">Cargando…</div>
  }

  const pendientesDePago = retiros.filter(r => !r.pago_id).length

  return (
    <div className="space-y-6">
      <PageHeader
        title="Asistencia"
        subtitle={isAdmin ? 'Fichajes, horas extra y retiros adicionales del equipo' : 'Tu fichaje diario de entrada y salida'}
        icon={<div className="w-11 h-11 rounded-2xl bg-brand/10 flex items-center justify-center"><Clock className="w-5 h-5 text-brand" aria-hidden="true" /></div>}
        actions={isAdmin && tab === 'retiros' ? (
          <Button variant="primary" onClick={abrirModalPago} disabled={pendientesDePago === 0}>
            <Banknote className="w-4 h-4 shrink-0" aria-hidden="true" />
            Pagar retiros{pendientesDePago > 0 ? ` (${pendientesDePago})` : ''}
          </Button>
        ) : undefined}
      />

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { key: 'fichajes', label: <><Clock className="w-4 h-4 shrink-0" aria-hidden="true" /> Fichajes</> },
          { key: 'retiros', label: <><Truck className="w-4 h-4 shrink-0" aria-hidden="true" /> Retiros adicionales</> },
        ]}
      />

      {tab === 'fichajes' && <>

      {/* Form fichaje (todos los roles) */}
      <Card className="p-5 sm:p-6 max-w-3xl">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-1">
          <h2 className="text-base font-bold text-brand">Fichar día</h2>
          <span className="text-xs font-semibold text-brand bg-brand/10 px-2.5 py-1 rounded-full">
            {nombreVisible(myName)}
          </span>
        </div>
        {vigente ? (
          <p className="text-xs text-gray-600 mb-4">
            Jornada base: <b>{formatHora(vigente.hora_entrada)}–{formatHora(vigente.hora_salida)}</b>
            {isAdmin && <> · ${fmtNumero(vigente.precio_hora_extra)}/hr extra</>}
          </p>
        ) : (
          <p className="text-xs text-amber-800 bg-amber-50 border border-amber-300 rounded-xl p-2.5 mb-4">
            ⚠ Falta configuración de jornada — hay que crearla en Configuración → Jornada antes de poder fichar.
          </p>
        )}
        {fichajeHoy ? (
          <div className="bg-brand/5 border border-brand/30 rounded-xl p-4 text-sm text-brand">
            <p className="font-semibold">Ya tienes un fichaje de hoy.</p>
            <p className="text-xs mt-1 text-gray-700">
              Entrada: <b>{formatHora(fichajeHoy.hora_entrada)}</b>
              {fichajeHoy.hora_salida ? <> · Salida: <b>{formatHora(fichajeHoy.hora_salida)}</b></> : ' · Salida pendiente'}
            </p>
            <Button variant="primary" className="mt-3" onClick={() => abrirEditar(fichajeHoy)}>
              {fichajeHoy.hora_salida ? 'Editar fichaje' : 'Cerrar día (agregar salida)'}
            </Button>
          </div>
        ) : (
          <form onSubmit={fichar} className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="text-xs font-semibold text-gray-700">Fecha</label>
                <input type="date" required value={form.fecha} onChange={e => setForm(f => ({ ...f, fecha: e.target.value }))}
                  className={INPUT} />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-700">Hora entrada *</label>
                <input type="time" required value={form.hora_entrada} onChange={e => setForm(f => ({ ...f, hora_entrada: e.target.value }))}
                  className={INPUT} />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-700">Hora salida (opcional)</label>
                <input type="time" value={form.hora_salida} onChange={e => setForm(f => ({ ...f, hora_salida: e.target.value }))}
                  className={INPUT} />
                <p className="text-[10px] text-gray-500 mt-0.5">Puedes dejarla en blanco y completarla más tarde con &quot;Editar&quot;.</p>
              </div>
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-700">Comentario (opcional)</label>
              <input value={form.comentario} onChange={e => setForm(f => ({ ...f, comentario: e.target.value }))}
                className={INPUT} />
            </div>
            {errorForm && <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-xl p-2.5">{errorForm}</p>}
            <Button type="submit" variant="primary" disabled={saving || !vigente}>
              {saving ? 'Guardando…' : 'Fichar día'}
            </Button>
          </form>
        )}
      </Card>

      {/* Filtros — todos los roles (el operador filtra sobre lo suyo) */}
      <Filtros
        isAdmin={isAdmin}
        usuariosUnicos={usuariosUnicos}
        texto={filtroTexto} setTexto={setFiltroTexto}
        placeholder="Buscar por operador, día o comentario…"
        mes={filtroMes} setMes={setFiltroMes}
        desde={filtroDesde} setDesde={setFiltroDesde}
        hasta={filtroHasta} setHasta={setFiltroHasta}
        usuario={filtroUsuario} setUsuario={setFiltroUsuario}
        hayFiltros={hayFiltros} limpiar={limpiarFiltros}
        resultados={filtrados.length}
        extra={
          <div>
            <label className="text-xs font-semibold text-gray-700">Estado</label>
            <select value={filtroEstado} onChange={e => setFiltroEstado(e.target.value as typeof filtroEstado)} className={INPUT}>
              <option value="todos">Todos</option>
              <option value="abierto">Abierto (sin salida)</option>
              <option value="pendiente">Pendiente</option>
              <option value="aprobado">Aprobado</option>
              <option value="rechazado">Rechazado</option>
            </select>
          </div>
        }
      />

      {/* Totales por operador (solo admin) */}
      {isAdmin && resumenPorOperador.length > 0 && (
        <div className="space-y-4">
          {resumenPorOperador.map(op => (
            <Card key={op.usuario_id} className="p-5">
              <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
                <h3 className="text-base font-bold text-brand">{nombreVisible(op.usuario_nombre)}</h3>
                <span className="text-[11px] font-medium text-gray-600 bg-gray-100 px-2.5 py-0.5 rounded-full">
                  {op.registros} {op.registros === 1 ? 'fichaje' : 'fichajes'}
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Metrica icon={<Clock className="w-4 h-4" aria-hidden="true" />} tono="brand"
                  label="Horas normales" valor={fmtMinutos(op.minutos_normales)} />
                <Metrica icon={<Timer className="w-4 h-4" aria-hidden="true" />} tono="amber"
                  label="Horas extra aprobadas" valor={fmtMinutos(op.minutos_extra_aprobado)}
                  nota={op.minutos_extra_pendiente > 0 ? `+ ${fmtMinutos(op.minutos_extra_pendiente)} por aprobar` : undefined} />
                <Metrica icon={<Coins className="w-4 h-4" aria-hidden="true" />} tono="emerald"
                  label="Costo extra estimado" valor={fmtPrecio(op.costo_extra)} />
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Tabla de registros — se ven 10 y el resto se scrollea DENTRO de la tarjeta */}
      <Card className="overflow-hidden">
        <div className="px-5 sm:px-6 py-4 border-b border-gray-300">
          <h2 className="text-base font-bold text-brand">{isAdmin ? 'Registros' : 'Mis fichajes'}</h2>
        </div>
        {filtrados.length === 0 ? (
          <div className="p-10 text-center text-gray-500 text-sm">
            {hayFiltros ? 'Ningún fichaje coincide con los filtros.' : 'Sin registros todavía.'}
          </div>
        ) : (
          <TablaScroll filas={FILAS_VISIBLES}>
            <table className="w-full text-sm min-w-[820px]">
              <thead className={THEAD_STICKY}>
                <tr>
                  {['Operador', 'Fecha', 'Día', 'Entrada', 'Salida', 'Normal', 'Extra', 'Estado', ''].map((h, i) => (
                    <th key={i} className={`px-4 py-3 text-[11px] uppercase tracking-wide font-semibold text-gray-500 whitespace-nowrap ${i === 8 ? 'text-right' : 'text-left'}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtrados.map(r => {
                  const minNorm = parseFloat(r.minutos_normales) || 0
                  const minExtra = parseFloat(r.minutos_extra) || 0
                  const esFinde = r.es_findesemana === 'TRUE'
                  const esMio = r.usuario_id === myId
                  const puedeEditar = isAdmin || esMio
                  const estado = r.estado_aprobacion || 'pendiente'
                  const decideExtra = isAdmin && minExtra > 0 && estado !== 'abierto'
                  return (
                    <tr key={r.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium text-gray-900 whitespace-nowrap">{nombreVisible(r.usuario_nombre)}</td>
                      <td className="px-4 py-3 text-gray-700 whitespace-nowrap">{fmtFecha(r.fecha)}</td>
                      <td className="px-4 py-3 text-gray-700 text-xs capitalize whitespace-nowrap">
                        {r.dia_semana}
                        {esFinde && <span className="ml-1 inline-block bg-purple-100 text-purple-700 text-[10px] font-bold px-1 rounded">FINDE</span>}
                      </td>
                      <td className="px-4 py-3 text-gray-700 whitespace-nowrap">{formatHora(r.hora_entrada) || '—'}</td>
                      <td className="px-4 py-3 text-gray-700 whitespace-nowrap">{formatHora(r.hora_salida) || <span className="text-amber-700 font-semibold">pendiente</span>}</td>
                      <td className="px-4 py-3 text-brand whitespace-nowrap">{fmtMinutos(minNorm)}</td>
                      <td className="px-4 py-3 font-semibold text-amber-700 whitespace-nowrap">{fmtMinutos(minExtra)}</td>
                      <td className="px-4 py-3">
                        <Badge variant={
                          estado === 'aprobado' ? 'green' :
                          estado === 'rechazado' ? 'red' :
                          estado === 'abierto' ? 'blue' : 'yellow'
                        }>
                          {estado}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          {decideExtra && estado !== 'aprobado' && (
                            <IconBtn onClick={() => aprobar(r.id, 'aprobado')} titulo="Aprobar horas extra" tono="emerald">
                              <Check className="w-3.5 h-3.5" aria-hidden="true" />
                            </IconBtn>
                          )}
                          {decideExtra && estado !== 'rechazado' && (
                            <IconBtn onClick={() => aprobar(r.id, 'rechazado')} titulo="Rechazar horas extra" tono="amber">
                              <XIcon className="w-3.5 h-3.5" aria-hidden="true" />
                            </IconBtn>
                          )}
                          {puedeEditar && (
                            <IconBtn onClick={() => abrirEditar(r)} titulo="Editar fichaje">
                              <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
                            </IconBtn>
                          )}
                          {puedeEditar && (
                            <IconBtn onClick={() => eliminar(r.id)} titulo="Eliminar fichaje" tono="red">
                              <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                            </IconBtn>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </TablaScroll>
        )}
        <HistorialPie total={filtrados.length} filas={FILAS_VISIBLES} singular="fichaje" plural="fichajes" />
      </Card>

      </>}

      {tab === 'retiros' && <>
        {/* Form crear retiro adicional */}
        <Card className="p-5 sm:p-6 max-w-3xl">
          <div className="flex items-center justify-between gap-3 flex-wrap mb-1">
            <h2 className="text-base font-bold text-brand">Registrar retiro adicional</h2>
            <span className="text-xs font-semibold text-brand bg-brand/10 px-2.5 py-1 rounded-full">
              {nombreVisible(myName)}
            </span>
          </div>
          {vigente?.precio_retiro_adicional ? (
            <p className="text-xs text-gray-600 mb-4">
              Pago por retiro: <b>{fmtPrecio(vigente.precio_retiro_adicional)}</b>
            </p>
          ) : isAdmin ? (
            <p className="text-xs text-amber-800 bg-amber-50 border border-amber-300 rounded-xl p-2.5 mb-4">
              ⚠ Falta configurar el monto del retiro adicional en Configuración → Jornada.
            </p>
          ) : (
            <p className="text-xs text-gray-600 mb-4">Cada retiro queda registrado para el cálculo del pago.</p>
          )}
          <form onSubmit={crearRetiro} className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-gray-700">Fecha</label>
                <input type="date" required value={retiroForm.fecha} onChange={e => setRetiroForm(f => ({ ...f, fecha: e.target.value }))}
                  className={INPUT} />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-700">Hora del retiro *</label>
                <input type="time" required value={retiroForm.hora} onChange={e => setRetiroForm(f => ({ ...f, hora: e.target.value }))}
                  className={INPUT} />
              </div>
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-700">Cliente *</label>
              <input value={retiroForm.cliente_nombre} onChange={e => setRetiroForm(f => ({ ...f, cliente_nombre: e.target.value }))}
                placeholder="Nombre del tutor o referencia"
                className={INPUT} />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-700">Comentario (opcional)</label>
              <input value={retiroForm.comentario} onChange={e => setRetiroForm(f => ({ ...f, comentario: e.target.value }))}
                className={INPUT} />
            </div>
            {errorRetiro && <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-xl p-2.5">{errorRetiro}</p>}
            <Button type="submit" variant="primary" disabled={savingRetiro}>
              {savingRetiro ? 'Guardando…' : 'Registrar retiro'}
            </Button>
          </form>
        </Card>

        {/* Filtros de retiros — todos los roles */}
        <Filtros
          isAdmin={isAdmin}
          usuariosUnicos={usuariosUnicos}
          texto={filtroTexto} setTexto={setFiltroTexto}
          placeholder="Buscar por cliente, operador o comentario…"
          mes={filtroMes} setMes={setFiltroMes}
          desde={filtroDesde} setDesde={setFiltroDesde}
          hasta={filtroHasta} setHasta={setFiltroHasta}
          usuario={filtroUsuario} setUsuario={setFiltroUsuario}
          hayFiltros={hayFiltros} limpiar={limpiarFiltros}
          resultados={retirosFiltrados.length}
          extra={
            <div>
              <label className="text-xs font-semibold text-gray-700">Estado de pago</label>
              <select value={filtroPago} onChange={e => setFiltroPago(e.target.value as typeof filtroPago)} className={INPUT}>
                <option value="todos">Todos</option>
                <option value="pendiente">Pendientes</option>
                <option value="pagado">Pagados</option>
              </select>
            </div>
          }
        />

        {/* Resumen retiros por operador (admin) — separa pagados de pendientes */}
        {isAdmin && resumenRetirosPorOperador.length > 0 && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {resumenRetirosPorOperador.map(op => (
              <Card key={op.usuario_id} className="p-5">
                <h3 className="text-base font-bold text-brand mb-3">{nombreVisible(op.usuario_nombre)}</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Metrica icon={<Coins className="w-4 h-4" aria-hidden="true" />} tono="emerald"
                    label="Pagados" valor={fmtPrecio(op.monto_pagado)}
                    nota={`${op.cantidad_pagada} retiro${op.cantidad_pagada !== 1 ? 's' : ''}`} />
                  <Metrica icon={<CalendarClock className="w-4 h-4" aria-hidden="true" />} tono="amber"
                    label="Pendientes de pago" valor={fmtPrecio(op.monto_pendiente)}
                    nota={`${op.cantidad_pendiente} retiro${op.cantidad_pendiente !== 1 ? 's' : ''}`} />
                </div>
              </Card>
            ))}
          </div>
        )}

        {/* Tabla de retiros */}
        <Card className="overflow-hidden">
          <div className="px-5 sm:px-6 py-4 border-b border-gray-300">
            <h2 className="text-base font-bold text-brand">{isAdmin ? 'Retiros registrados' : 'Mis retiros'}</h2>
          </div>
          {retirosFiltrados.length === 0 ? (
            <div className="p-10 text-center text-gray-500 text-sm">
              {hayFiltros ? 'Ningún retiro coincide con los filtros.' : 'Sin retiros registrados.'}
            </div>
          ) : (
            <TablaScroll filas={FILAS_VISIBLES}>
              <table className="w-full text-sm min-w-[760px]">
                <thead className={THEAD_STICKY}>
                  <tr>
                    {(isAdmin ? ['Operador', 'Fecha', 'Hora', 'Cliente', 'Comentario', 'Estado', ''] : ['Fecha', 'Hora', 'Cliente', 'Comentario', 'Estado', '']).map((h, i, arr) => (
                      <th key={i} className={`px-4 py-3 text-[11px] uppercase tracking-wide font-semibold text-gray-500 whitespace-nowrap ${i === arr.length - 1 ? 'text-right' : 'text-left'}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {retirosFiltrados.map(r => {
                    const esMio = r.usuario_id === myId
                    const puedeEditar = (isAdmin || esMio) && !r.pago_id
                    return (
                      <tr key={r.id} className="hover:bg-gray-50">
                        {isAdmin && <td className="px-4 py-3 font-medium text-gray-900 whitespace-nowrap">{nombreVisible(r.usuario_nombre)}</td>}
                        <td className="px-4 py-3 text-gray-700 whitespace-nowrap">{fmtFecha(r.fecha)}</td>
                        <td className="px-4 py-3 text-gray-700 whitespace-nowrap">{formatHora(r.hora) || '—'}</td>
                        <td className="px-4 py-3 font-medium text-gray-900">{r.cliente_nombre}</td>
                        <td className="px-4 py-3 text-gray-500 text-xs">{r.comentario || '—'}</td>
                        <td className="px-4 py-3">
                          {r.pago_id ? <Badge variant="green">pagado</Badge> : <Badge variant="yellow">pendiente</Badge>}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-1">
                            {puedeEditar ? (
                              <>
                                <IconBtn onClick={() => abrirEditarRetiro(r)} titulo="Editar retiro">
                                  <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
                                </IconBtn>
                                <IconBtn onClick={() => eliminarRetiro(r.id)} titulo="Eliminar retiro" tono="red">
                                  <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                                </IconBtn>
                              </>
                            ) : (
                              <span className="text-[11px] text-gray-400">{r.pago_id ? 'pagado' : '—'}</span>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </TablaScroll>
          )}
          <HistorialPie total={retirosFiltrados.length} filas={FILAS_VISIBLES} singular="retiro" plural="retiros" />
        </Card>

        {/* Historial de pagos (solo admin) */}
        {isAdmin && pagos.length > 0 && (
          <Card className="overflow-hidden">
            <div className="px-5 sm:px-6 py-4 border-b border-gray-300">
              <h2 className="text-base font-bold text-brand">Pagos realizados</h2>
              <p className="text-xs text-gray-600 mt-0.5">Anular un pago revierte los retiros a estado pendiente.</p>
            </div>
            <TablaScroll filas={FILAS_VISIBLES}>
              <table className="w-full text-sm min-w-[700px]">
                <thead className={THEAD_STICKY}>
                  <tr>
                    {['Fecha pago', 'Operador', 'Cantidad', 'Monto total', 'Comentario', ''].map((h, i) => (
                      <th key={i} className={`px-4 py-3 text-[11px] uppercase tracking-wide font-semibold text-gray-500 whitespace-nowrap ${i === 5 ? 'text-right' : 'text-left'}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {pagosOrdenados.map(p => (
                    <tr key={p.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-gray-900 font-medium whitespace-nowrap">{fmtFecha(p.fecha_pago)}</td>
                      <td className="px-4 py-3 text-gray-700 whitespace-nowrap">{nombreVisible(p.usuario_nombre)}</td>
                      <td className="px-4 py-3 text-gray-700">{p.cantidad}</td>
                      <td className="px-4 py-3 font-bold text-emerald-700 whitespace-nowrap">{fmtPrecio(p.monto_total)}</td>
                      <td className="px-4 py-3 text-gray-500 text-xs">{p.comentarios || '—'}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end">
                          <IconBtn onClick={() => anularPago(p)} titulo="Anular pago" tono="red">
                            <XIcon className="w-3.5 h-3.5" aria-hidden="true" />
                          </IconBtn>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TablaScroll>
            <HistorialPie total={pagos.length} filas={FILAS_VISIBLES} singular="pago" plural="pagos" />
          </Card>
        )}
      </>}

      {/* Modal edición */}
      <Modal open={!!editing} onClose={() => setEditing(null)} title="Editar fichaje">
        {editing && (
          <form onSubmit={guardarEdicion} className="space-y-3">
            <p className="text-xs text-gray-500">Operador: <b>{nombreVisible(editing.usuario_nombre)}</b></p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="text-xs font-semibold text-gray-700">Fecha</label>
                <input type="date" required value={editForm.fecha}
                  onChange={e => setEditForm(f => ({ ...f, fecha: e.target.value }))}
                  className={INPUT} />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-700">Hora entrada</label>
                <input type="time" required value={editForm.hora_entrada}
                  onChange={e => setEditForm(f => ({ ...f, hora_entrada: e.target.value }))}
                  className={INPUT} />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-700">Hora salida</label>
                <input type="time" value={editForm.hora_salida}
                  onChange={e => setEditForm(f => ({ ...f, hora_salida: e.target.value }))}
                  className={INPUT} />
              </div>
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-700">Comentario</label>
              <input value={editForm.comentario}
                onChange={e => setEditForm(f => ({ ...f, comentario: e.target.value }))}
                className={INPUT} />
            </div>
            {errorEdit && <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-xl p-2.5">{errorEdit}</p>}
            <div className="flex gap-3 pt-2">
              <button type="button" onClick={() => setEditing(null)}
                className="flex-1 border border-gray-300 text-gray-700 bg-white rounded-xl py-2 text-sm font-semibold hover:bg-gray-50 transition-colors">
                Cancelar
              </button>
              <button type="submit" disabled={savingEdit}
                className="flex-1 bg-brand hover:bg-brand-dark text-white rounded-xl py-2 text-sm font-semibold shadow-md disabled:opacity-50 transition-colors">
                {savingEdit ? 'Guardando...' : 'Guardar cambios'}
              </button>
            </div>
          </form>
        )}
      </Modal>

      {/* Modal pagar retiros adicionales (solo admin) */}
      <Modal open={showPagoModal} onClose={() => setShowPagoModal(false)} title="Pagar retiros adicionales">
        {showPagoModal && (() => {
          const precio = vigente?.precio_retiro_adicional ?? 0
          const totalSeleccionado = pagoSeleccion.size * precio
          const totalPendientes = pendientesAgrupados.reduce((s, g) => s + g.retiros.length, 0)
          return (
            <form onSubmit={guardarPago} className="space-y-3">
              <div>
                <label className="text-xs font-medium text-gray-700">Retiros pendientes</label>
                <div className="mt-2 max-h-72 overflow-y-auto border border-gray-300 rounded-xl divide-y divide-gray-100">
                  {pendientesAgrupados.length === 0 ? (
                    <p className="p-4 text-xs text-gray-400 text-center">Sin retiros pendientes</p>
                  ) : pendientesAgrupados.map(g => {
                    const todosSel = g.retiros.every(r => pagoSeleccion.has(r.id))
                    return (
                      <div key={g.usuario_id}>
                        <div className="flex items-center justify-between px-3 py-2 bg-gray-50">
                          <div className="flex items-center gap-2">
                            <input type="checkbox" checked={todosSel}
                              onChange={() => {
                                setPagoSeleccion(prev => {
                                  const s = new Set(prev)
                                  if (todosSel) g.retiros.forEach(r => s.delete(r.id))
                                  else g.retiros.forEach(r => s.add(r.id))
                                  return s
                                })
                              }}
                              className="w-4 h-4 text-brand" />
                            <span className="text-sm font-semibold text-gray-900">{nombreVisible(g.usuario_nombre)}</span>
                            <span className="text-xs text-gray-500">({g.retiros.length})</span>
                          </div>
                        </div>
                        {g.retiros.map(r => (
                          <label key={r.id} className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-gray-50 pl-9">
                            <input type="checkbox"
                              checked={pagoSeleccion.has(r.id)}
                              onChange={() => togglePagoRetiro(r.id)}
                              className="w-4 h-4 text-brand" />
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-medium text-gray-900 truncate">{r.cliente_nombre}</div>
                              <div className="text-xs text-gray-500">{fmtFecha(r.fecha)} · {formatHora(r.hora)} {r.comentario ? `· ${r.comentario}` : ''}</div>
                            </div>
                            <div className="text-sm font-semibold text-gray-900">{fmtPrecio(precio)}</div>
                          </label>
                        ))}
                      </div>
                    )
                  })}
                </div>
                <div className="mt-2 flex justify-between text-sm">
                  <span className="text-gray-500">{pagoSeleccion.size} de {totalPendientes} seleccionado(s)</span>
                  <span className="font-bold text-gray-900">Total: {fmtPrecio(totalSeleccionado)}</span>
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-700">Fecha del pago</label>
                <input type="date" required value={pagoFecha} onChange={e => setPagoFecha(e.target.value)}
                  className={INPUT} />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-700">Comentarios</label>
                <textarea value={pagoComentario} onChange={e => setPagoComentario(e.target.value)} rows={2}
                  className={`${INPUT} resize-none`} />
              </div>
              {errorPago && <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-xl p-2.5">{errorPago}</p>}
              <button type="submit" disabled={savingPago || pagoSeleccion.size === 0}
                className="w-full bg-brand hover:bg-brand-dark text-white rounded-xl py-2.5 text-sm font-semibold shadow-md transition-colors disabled:opacity-50">
                {savingPago ? 'Procesando...' : `Confirmar pago (${fmtPrecio(totalSeleccionado)})`}
              </button>
            </form>
          )
        })()}
      </Modal>

      {/* Modal edición retiro adicional */}
      <Modal open={!!editingRetiro} onClose={() => setEditingRetiro(null)} title="Editar retiro adicional">
        {editingRetiro && (
          <form onSubmit={guardarEdicionRetiro} className="space-y-3">
            <p className="text-xs text-gray-500">Operador: <b>{nombreVisible(editingRetiro.usuario_nombre)}</b></p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-gray-700">Fecha</label>
                <input type="date" required value={editRetiroForm.fecha}
                  onChange={e => setEditRetiroForm(f => ({ ...f, fecha: e.target.value }))}
                  className={INPUT} />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-700">Hora</label>
                <input type="time" required value={editRetiroForm.hora}
                  onChange={e => setEditRetiroForm(f => ({ ...f, hora: e.target.value }))}
                  className={INPUT} />
              </div>
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-700">Cliente</label>
              <input required value={editRetiroForm.cliente_nombre}
                onChange={e => setEditRetiroForm(f => ({ ...f, cliente_nombre: e.target.value }))}
                className={INPUT} />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-700">Comentario</label>
              <input value={editRetiroForm.comentario}
                onChange={e => setEditRetiroForm(f => ({ ...f, comentario: e.target.value }))}
                className={INPUT} />
            </div>
            {errorEditRetiro && <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-xl p-2.5">{errorEditRetiro}</p>}
            <div className="flex gap-3 pt-2">
              <button type="button" onClick={() => setEditingRetiro(null)}
                className="flex-1 border border-gray-300 text-gray-700 bg-white rounded-xl py-2 text-sm font-semibold hover:bg-gray-50 transition-colors">
                Cancelar
              </button>
              <button type="submit" disabled={savingEditRetiro}
                className="flex-1 bg-brand hover:bg-brand-dark text-white rounded-xl py-2 text-sm font-semibold shadow-md disabled:opacity-50 transition-colors">
                {savingEditRetiro ? 'Guardando...' : 'Guardar cambios'}
              </button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  )
}
