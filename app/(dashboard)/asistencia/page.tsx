'use client'
import { useEffect, useState, useCallback, useMemo } from 'react'
import { useSession } from 'next-auth/react'
import { fmtPrecio, fmtNumero, fmtFecha } from '@/lib/format'
import { todayISO, formatDateForSheet, formatHora } from '@/lib/dates'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'

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

export default function AsistenciaPage() {
  const { data: session } = useSession()
  const role = (session?.user as { role?: string })?.role ?? 'operador'
  const isAdmin = role === 'admin'
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

  // Filtros admin — mes vacío = mostrar todos los meses por default
  const [filtroMes, setFiltroMes] = useState('')
  const [filtroUsuario, setFiltroUsuario] = useState('')
  const [filtroEstado, setFiltroEstado] = useState<'todos' | 'pendiente' | 'aprobado' | 'rechazado' | 'abierto'>('todos')

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
      setErrorPago('Seleccioná al menos un retiro')
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
    if (!confirm(`¿Anular el pago de ${fmtPrecio(p.monto_total)} a ${p.usuario_nombre}? Los ${p.cantidad} retiros volverán a quedar pendientes.`)) return
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
      setErrorForm('Tenés que indicar al menos la hora de entrada')
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
    return retiros.filter(r => {
      const fecha = formatDateForSheet(r.fecha) || r.fecha
      if (filtroMes && !fecha.startsWith(filtroMes)) return false
      if (filtroUsuario && r.usuario_id !== filtroUsuario) return false
      if (filtroPago === 'pendiente' && r.pago_id) return false
      if (filtroPago === 'pagado' && !r.pago_id) return false
      return true
    })
  }, [retiros, filtroMes, filtroUsuario, filtroPago])

  // Resumen de retiros por operador — para la tab "retiros"
  type ResumenRetiros = { usuario_id: string; usuario_nombre: string; cantidad: number; costo: number }
  const resumenRetirosPorOperador = useMemo<ResumenRetiros[]>(() => {
    const precio = vigente?.precio_retiro_adicional ?? 0
    const m = new Map<string, ResumenRetiros>()
    for (const r of retirosFiltrados) {
      let acc = m.get(r.usuario_id)
      if (!acc) {
        acc = { usuario_id: r.usuario_id, usuario_nombre: r.usuario_nombre, cantidad: 0, costo: 0 }
        m.set(r.usuario_id, acc)
      }
      acc.cantidad += 1
      acc.costo += precio
    }
    return Array.from(m.values()).sort((a, b) => a.usuario_nombre.localeCompare(b.usuario_nombre))
  }, [retirosFiltrados, vigente])

  const filtrados = useMemo(() => {
    return registros.filter(r => {
      const fecha = formatDateForSheet(r.fecha) || r.fecha
      if (filtroMes && !fecha.startsWith(filtroMes)) return false
      if (filtroUsuario && r.usuario_id !== filtroUsuario) return false
      if (filtroEstado !== 'todos' && r.estado_aprobacion !== filtroEstado) return false
      return true
    })
  }, [registros, filtroMes, filtroUsuario, filtroEstado])

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

  const fichajeHoy = useMemo(() => {
    const hoy = todayISO()
    return registros.find(r => r.usuario_id === myId && (formatDateForSheet(r.fecha) || r.fecha) === hoy)
  }, [registros, myId])

  if (loading) {
    return <div className="text-sm text-gray-500">Cargando…</div>
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Asistencia</h1>
          <p className="text-gray-600 text-sm mt-0.5">{isAdmin ? 'Control de asistencia y horas extra' : 'Fichaje diario de entrada y salida'}</p>
        </div>
        {isAdmin && tab === 'retiros' && (
          <button onClick={abrirModalPago} disabled={retiros.filter(r => !r.pago_id).length === 0}
            className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed shadow-md">
            💵 Pagar retiros adicionales
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl w-fit">
        <button onClick={() => setTab('fichajes')}
          className={`px-4 py-1.5 rounded-lg text-xs font-medium transition-colors ${tab === 'fichajes' ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>
          Fichajes
        </button>
        <button onClick={() => setTab('retiros')}
          className={`px-4 py-1.5 rounded-lg text-xs font-medium transition-colors ${tab === 'retiros' ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>
          Retiros adicionales
        </button>
      </div>

      {tab === 'fichajes' && <>

      {/* Form fichaje (todos los roles) */}
      <div className="bg-white rounded-xl shadow-md border-2 border-gray-200 p-6 max-w-3xl">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-base font-bold text-gray-900">Fichar día</h2>
          <span className="text-xs font-semibold text-indigo-700 bg-indigo-50 px-2 py-1 rounded-full">
            Operador: {myName}
          </span>
        </div>
        {vigente ? (
          <p className="text-xs text-gray-500 mb-4">
            Jornada base: <b>{vigente.hora_entrada}–{vigente.hora_salida}</b>
            {isAdmin && <> · ${fmtNumero(vigente.precio_hora_extra)}/hr extra</>}
          </p>
        ) : (
          <p className="text-xs text-amber-700 bg-amber-50 border-2 border-amber-200 rounded-lg p-2 mb-4">
            ⚠ Falta configuración de jornada — un admin tiene que crearla en Configuración → Jornada antes de poder fichar.
          </p>
        )}
        {fichajeHoy ? (
          <div className="bg-blue-50 border-2 border-blue-200 rounded-lg p-3 text-sm text-blue-900">
            <p className="font-semibold">Ya tenés un fichaje de hoy.</p>
            <p className="text-xs mt-1">
              Entrada: <b>{formatHora(fichajeHoy.hora_entrada)}</b>
              {fichajeHoy.hora_salida ? <> · Salida: <b>{formatHora(fichajeHoy.hora_salida)}</b></> : ' · Salida pendiente'}
            </p>
            <button onClick={() => abrirEditar(fichajeHoy)}
              className="mt-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold px-3 py-1.5 rounded-lg">
              {fichajeHoy.hora_salida ? 'Editar fichaje' : 'Cerrar día (agregar salida)'}
            </button>
          </div>
        ) : (
          <form onSubmit={fichar} className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="text-xs font-semibold text-gray-700">Fecha</label>
                <input type="date" required value={form.fecha} onChange={e => setForm(f => ({ ...f, fecha: e.target.value }))}
                  className="mt-1 w-full border-2 border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-700">Hora entrada *</label>
                <input type="time" required value={form.hora_entrada} onChange={e => setForm(f => ({ ...f, hora_entrada: e.target.value }))}
                  className="mt-1 w-full border-2 border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-700">Hora salida (opcional)</label>
                <input type="time" value={form.hora_salida} onChange={e => setForm(f => ({ ...f, hora_salida: e.target.value }))}
                  className="mt-1 w-full border-2 border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                <p className="text-[10px] text-gray-500 mt-0.5">Podés dejarla en blanco y completarla más tarde con &quot;Editar&quot;.</p>
              </div>
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-700">Comentario (opcional)</label>
              <input value={form.comentario} onChange={e => setForm(f => ({ ...f, comentario: e.target.value }))}
                className="mt-1 w-full border-2 border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
            {errorForm && <p className="text-xs text-red-700 bg-red-50 border-2 border-red-200 rounded-lg p-2">{errorForm}</p>}
            <button type="submit" disabled={saving || !vigente}
              className="bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2 rounded-lg text-sm font-semibold shadow-md transition-colors disabled:opacity-50">
              {saving ? 'Guardando...' : 'Fichar día'}
            </button>
          </form>
        )}
      </div>

      {/* Filtros (solo admin) */}
      {isAdmin && (
        <div className="bg-white rounded-xl shadow-md border-2 border-gray-200 p-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-gray-700">Mes</label>
                {filtroMes && (
                  <button type="button" onClick={() => setFiltroMes('')}
                    className="text-[10px] text-indigo-600 hover:text-indigo-800 underline">
                    Limpiar
                  </button>
                )}
              </div>
              <input type="month" value={filtroMes} onChange={e => setFiltroMes(e.target.value)}
                className="mt-1 w-full border-2 border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-700">Operador</label>
              <select value={filtroUsuario} onChange={e => setFiltroUsuario(e.target.value)}
                className="mt-1 w-full border-2 border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                <option value="">Todos</option>
                {usuariosUnicos.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-700">Estado</label>
              <select value={filtroEstado} onChange={e => setFiltroEstado(e.target.value as typeof filtroEstado)}
                className="mt-1 w-full border-2 border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                <option value="todos">Todos</option>
                <option value="abierto">Abierto (sin salida)</option>
                <option value="pendiente">Pendiente</option>
                <option value="aprobado">Aprobado</option>
                <option value="rechazado">Rechazado</option>
              </select>
            </div>
          </div>
          {resumenPorOperador.length === 0 && (
            <p className="text-sm text-gray-400 text-center mt-4">Sin registros para este filtro</p>
          )}
        </div>
      )}

      {/* Totales por operador (solo admin) */}
      {isAdmin && resumenPorOperador.length > 0 && (
        <div className="space-y-4">
          {resumenPorOperador.map(op => (
            <div key={op.usuario_id} className="bg-white rounded-xl shadow-md border-2 border-gray-200 p-5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-base font-bold text-gray-900">{op.usuario_nombre}</h3>
                <span className="text-[10px] font-medium text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
                  {op.registros} {op.registros === 1 ? 'fichaje' : 'fichajes'}
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="bg-blue-50 border-2 border-blue-200 rounded-lg p-3">
                  <p className="text-xs font-semibold text-blue-700 uppercase">Horas normales</p>
                  <p className="text-lg font-bold text-blue-900 mt-1">{fmtMinutos(op.minutos_normales)}</p>
                </div>
                <div className="bg-amber-50 border-2 border-amber-300 rounded-lg p-3">
                  <p className="text-xs font-semibold text-amber-700 uppercase">Horas extra aprobadas</p>
                  <p className="text-lg font-bold text-amber-900 mt-1">{fmtMinutos(op.minutos_extra_aprobado)}</p>
                  {op.minutos_extra_pendiente > 0 && (
                    <p className="text-[10px] text-amber-600 mt-0.5">+ {fmtMinutos(op.minutos_extra_pendiente)} pendientes</p>
                  )}
                </div>
                <div className="bg-emerald-50 border-2 border-emerald-300 rounded-lg p-3">
                  <p className="text-xs font-semibold text-emerald-700 uppercase">Costo extra estimado</p>
                  <p className="text-lg font-bold text-emerald-900 mt-1">{fmtPrecio(op.costo_extra)}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Tabla de registros */}
      <div className="bg-white rounded-xl shadow-md border-2 border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b-2 border-gray-200">
          <h2 className="text-base font-bold text-gray-900">{isAdmin ? 'Registros' : 'Mis fichajes'}</h2>
        </div>
        {filtrados.length === 0 ? (
          <div className="p-8 text-center text-gray-400 text-sm">Sin registros</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[820px]">
              <thead className="bg-gray-50">
                <tr>
                  {['Operador', 'Fecha', 'Día', 'Entrada', 'Salida', 'Normal', 'Extra', 'Estado', 'Acciones'].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-gray-500">{h}</th>
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
                  return (
                    <tr key={r.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium text-gray-900">{r.usuario_nombre}</td>
                      <td className="px-4 py-3 text-gray-700">{fmtFecha(r.fecha)}</td>
                      <td className="px-4 py-3 text-gray-700 text-xs capitalize">
                        {r.dia_semana}
                        {esFinde && <span className="ml-1 inline-block bg-purple-100 text-purple-700 text-[10px] font-bold px-1 rounded">FINDE</span>}
                      </td>
                      <td className="px-4 py-3 text-gray-700">{formatHora(r.hora_entrada) || '—'}</td>
                      <td className="px-4 py-3 text-gray-700">{formatHora(r.hora_salida) || <span className="text-amber-700 font-semibold">pendiente</span>}</td>
                      <td className="px-4 py-3 text-blue-700">{fmtMinutos(minNorm)}</td>
                      <td className="px-4 py-3 font-semibold text-amber-700">{fmtMinutos(minExtra)}</td>
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
                        <div className="flex items-center gap-2 flex-wrap">
                          {isAdmin && estado !== 'aprobado' && minExtra > 0 && estado !== 'abierto' && (
                            <button onClick={() => aprobar(r.id, 'aprobado')}
                              className="bg-emerald-500 hover:bg-emerald-600 text-white px-2.5 py-1 rounded-md text-xs font-medium">
                              ✓ Aprobar
                            </button>
                          )}
                          {isAdmin && estado !== 'rechazado' && minExtra > 0 && estado !== 'abierto' && (
                            <button onClick={() => aprobar(r.id, 'rechazado')}
                              className="bg-amber-500 hover:bg-amber-600 text-white px-2.5 py-1 rounded-md text-xs font-medium">
                              ✗ Rechazar
                            </button>
                          )}
                          {puedeEditar && (
                            <button onClick={() => abrirEditar(r)}
                              className="bg-blue-500 hover:bg-blue-600 text-white px-2.5 py-1 rounded-md text-xs font-medium">
                              Editar
                            </button>
                          )}
                          {puedeEditar && (
                            <button onClick={() => eliminar(r.id)}
                              className="bg-red-500 hover:bg-red-600 text-white px-2.5 py-1 rounded-md text-xs font-medium">
                              Eliminar
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      </>}

      {tab === 'retiros' && <>
        {/* Form crear retiro adicional */}
        <div className="bg-white rounded-xl shadow-md border-2 border-gray-200 p-6 max-w-3xl">
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-base font-bold text-gray-900">Registrar retiro adicional</h2>
            <span className="text-xs font-semibold text-indigo-700 bg-indigo-50 px-2 py-1 rounded-full">
              Operador: {myName}
            </span>
          </div>
          {vigente?.precio_retiro_adicional ? (
            <p className="text-xs text-gray-500 mb-4">
              Pago por retiro: <b>{fmtPrecio(vigente.precio_retiro_adicional)}</b>
            </p>
          ) : isAdmin ? (
            <p className="text-xs text-amber-700 bg-amber-50 border-2 border-amber-200 rounded-lg p-2 mb-4">
              ⚠ Falta configurar el monto del retiro adicional en Configuración → Jornada.
            </p>
          ) : (
            <p className="text-xs text-gray-500 mb-4">Cada retiro queda registrado para el cálculo del pago.</p>
          )}
          <form onSubmit={crearRetiro} className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-gray-700">Fecha</label>
                <input type="date" required value={retiroForm.fecha} onChange={e => setRetiroForm(f => ({ ...f, fecha: e.target.value }))}
                  className="mt-1 w-full border-2 border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-700">Hora del retiro *</label>
                <input type="time" required value={retiroForm.hora} onChange={e => setRetiroForm(f => ({ ...f, hora: e.target.value }))}
                  className="mt-1 w-full border-2 border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-700">Cliente *</label>
              <input value={retiroForm.cliente_nombre} onChange={e => setRetiroForm(f => ({ ...f, cliente_nombre: e.target.value }))}
                placeholder="Nombre del tutor o referencia"
                className="mt-1 w-full border-2 border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-700">Comentario (opcional)</label>
              <input value={retiroForm.comentario} onChange={e => setRetiroForm(f => ({ ...f, comentario: e.target.value }))}
                className="mt-1 w-full border-2 border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
            {errorRetiro && <p className="text-xs text-red-700 bg-red-50 border-2 border-red-200 rounded-lg p-2">{errorRetiro}</p>}
            <button type="submit" disabled={savingRetiro}
              className="bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2 rounded-lg text-sm font-semibold shadow-md transition-colors disabled:opacity-50">
              {savingRetiro ? 'Guardando...' : 'Registrar retiro'}
            </button>
          </form>
        </div>

        {/* Filtros admin para retiros + botón Pagar */}
        {isAdmin && (
          <div className="bg-white rounded-xl shadow-md border-2 border-gray-200 p-4 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-gray-700">Mes</label>
                  {filtroMes && (
                    <button type="button" onClick={() => setFiltroMes('')}
                      className="text-[10px] text-indigo-600 hover:text-indigo-800 underline">Limpiar</button>
                  )}
                </div>
                <input type="month" value={filtroMes} onChange={e => setFiltroMes(e.target.value)}
                  className="mt-1 w-full border-2 border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-700">Operador</label>
                <select value={filtroUsuario} onChange={e => setFiltroUsuario(e.target.value)}
                  className="mt-1 w-full border-2 border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                  <option value="">Todos</option>
                  {usuariosUnicos.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-700">Estado pago</label>
                <select value={filtroPago} onChange={e => setFiltroPago(e.target.value as typeof filtroPago)}
                  className="mt-1 w-full border-2 border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                  <option value="todos">Todos</option>
                  <option value="pendiente">Pendientes</option>
                  <option value="pagado">Pagados</option>
                </select>
              </div>
            </div>
          </div>
        )}

        {/* Resumen retiros por operador (admin) */}
        {isAdmin && resumenRetirosPorOperador.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {resumenRetirosPorOperador.map(op => (
              <div key={op.usuario_id} className="bg-white rounded-xl shadow-md border-2 border-gray-200 p-5">
                <h3 className="text-base font-bold text-gray-900 mb-3">{op.usuario_nombre}</h3>
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-blue-50 border-2 border-blue-200 rounded-lg p-3">
                    <p className="text-xs font-semibold text-blue-700 uppercase">Retiros</p>
                    <p className="text-lg font-bold text-blue-900 mt-1">{op.cantidad}</p>
                  </div>
                  <div className="bg-emerald-50 border-2 border-emerald-300 rounded-lg p-3">
                    <p className="text-xs font-semibold text-emerald-700 uppercase">Pago estimado</p>
                    <p className="text-lg font-bold text-emerald-900 mt-1">{fmtPrecio(op.costo)}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Tabla de retiros */}
        <div className="bg-white rounded-xl shadow-md border-2 border-gray-200 overflow-hidden">
          <div className="px-6 py-4 border-b-2 border-gray-200">
            <h2 className="text-base font-bold text-gray-900">{isAdmin ? 'Retiros registrados' : 'Mis retiros'}</h2>
          </div>
          {retirosFiltrados.length === 0 ? (
            <div className="p-8 text-center text-gray-400 text-sm">Sin retiros registrados</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[820px]">
                <thead className="bg-gray-50">
                  <tr>
                    {(isAdmin ? ['Operador', 'Fecha', 'Hora', 'Cliente', 'Comentario', 'Estado', 'Acciones'] : ['Fecha', 'Hora', 'Cliente', 'Comentario', 'Estado', 'Acciones']).map(h => (
                      <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-gray-500">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {retirosFiltrados.map(r => {
                    const esMio = r.usuario_id === myId
                    const puedeEditar = (isAdmin || esMio) && !r.pago_id
                    return (
                      <tr key={r.id} className="hover:bg-gray-50">
                        {isAdmin && <td className="px-4 py-3 font-medium text-gray-900">{r.usuario_nombre}</td>}
                        <td className="px-4 py-3 text-gray-700">{fmtFecha(r.fecha)}</td>
                        <td className="px-4 py-3 text-gray-700">{formatHora(r.hora) || '—'}</td>
                        <td className="px-4 py-3 font-medium text-gray-900">{r.cliente_nombre}</td>
                        <td className="px-4 py-3 text-gray-500 text-xs">{r.comentario || '—'}</td>
                        <td className="px-4 py-3">
                          {r.pago_id ? (
                            <Badge variant="green">pagado</Badge>
                          ) : (
                            <Badge variant="yellow">pendiente</Badge>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            {puedeEditar && (
                              <button onClick={() => abrirEditarRetiro(r)}
                                className="bg-blue-500 hover:bg-blue-600 text-white px-2.5 py-1 rounded-md text-xs font-medium">
                                Editar
                              </button>
                            )}
                            {puedeEditar && (
                              <button onClick={() => eliminarRetiro(r.id)}
                                className="bg-red-500 hover:bg-red-600 text-white px-2.5 py-1 rounded-md text-xs font-medium">
                                Eliminar
                              </button>
                            )}
                            {!puedeEditar && r.pago_id && (
                              <span className="text-[10px] text-gray-400">—</span>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Historial de pagos (solo admin) */}
        {isAdmin && pagos.length > 0 && (
          <div className="bg-white rounded-xl shadow-md border-2 border-gray-200 overflow-hidden">
            <div className="px-6 py-4 border-b-2 border-gray-200">
              <h2 className="text-base font-bold text-gray-900">Pagos realizados</h2>
              <p className="text-xs text-gray-500 mt-0.5">Anular un pago revierte los retiros a estado pendiente.</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[720px]">
                <thead className="bg-gray-50">
                  <tr>
                    {['Fecha pago', 'Operador', 'Cantidad', 'Monto total', 'Comentario', 'Acciones'].map(h => (
                      <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-gray-500">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {pagos.map(p => (
                    <tr key={p.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-gray-900 font-medium">{fmtFecha(p.fecha_pago)}</td>
                      <td className="px-4 py-3 text-gray-700">{p.usuario_nombre}</td>
                      <td className="px-4 py-3 text-gray-700">{p.cantidad}</td>
                      <td className="px-4 py-3 font-bold text-emerald-700">{fmtPrecio(p.monto_total)}</td>
                      <td className="px-4 py-3 text-gray-500 text-xs">{p.comentarios || '—'}</td>
                      <td className="px-4 py-3">
                        <button onClick={() => anularPago(p)}
                          className="bg-red-500 hover:bg-red-600 text-white px-2.5 py-1 rounded-md text-xs font-medium">
                          Anular
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </>}

      {/* Modal edición */}
      <Modal open={!!editing} onClose={() => setEditing(null)} title="Editar fichaje">
        {editing && (
          <form onSubmit={guardarEdicion} className="space-y-3">
            <p className="text-xs text-gray-500">Operador: <b>{editing.usuario_nombre}</b></p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="text-xs font-semibold text-gray-700">Fecha</label>
                <input type="date" required value={editForm.fecha}
                  onChange={e => setEditForm(f => ({ ...f, fecha: e.target.value }))}
                  className="mt-1 w-full border-2 border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-700">Hora entrada</label>
                <input type="time" required value={editForm.hora_entrada}
                  onChange={e => setEditForm(f => ({ ...f, hora_entrada: e.target.value }))}
                  className="mt-1 w-full border-2 border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-700">Hora salida</label>
                <input type="time" value={editForm.hora_salida}
                  onChange={e => setEditForm(f => ({ ...f, hora_salida: e.target.value }))}
                  className="mt-1 w-full border-2 border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-700">Comentario</label>
              <input value={editForm.comentario}
                onChange={e => setEditForm(f => ({ ...f, comentario: e.target.value }))}
                className="mt-1 w-full border-2 border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
            {errorEdit && <p className="text-xs text-red-700 bg-red-50 border-2 border-red-200 rounded-lg p-2">{errorEdit}</p>}
            <div className="flex gap-3 pt-2">
              <button type="button" onClick={() => setEditing(null)}
                className="flex-1 border-2 border-gray-300 text-gray-700 rounded-lg py-2 text-sm font-semibold hover:bg-gray-50">
                Cancelar
              </button>
              <button type="submit" disabled={savingEdit}
                className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg py-2 text-sm font-semibold shadow-md disabled:opacity-50">
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
                <div className="mt-2 max-h-72 overflow-y-auto border border-gray-200 rounded-lg divide-y divide-gray-100">
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
                              className="w-4 h-4 text-indigo-600" />
                            <span className="text-sm font-semibold text-gray-900">{g.usuario_nombre}</span>
                            <span className="text-xs text-gray-500">({g.retiros.length})</span>
                          </div>
                        </div>
                        {g.retiros.map(r => (
                          <label key={r.id} className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-gray-50 pl-9">
                            <input type="checkbox"
                              checked={pagoSeleccion.has(r.id)}
                              onChange={() => togglePagoRetiro(r.id)}
                              className="w-4 h-4 text-indigo-600" />
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
                  className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-700">Comentarios</label>
                <textarea value={pagoComentario} onChange={e => setPagoComentario(e.target.value)} rows={2}
                  className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none" />
              </div>
              {errorPago && <p className="text-xs text-red-700 bg-red-50 border-2 border-red-200 rounded-lg p-2">{errorPago}</p>}
              <button type="submit" disabled={savingPago || pagoSeleccion.size === 0}
                className="w-full bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg py-2 text-sm font-medium transition-colors disabled:opacity-50">
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
            <p className="text-xs text-gray-500">Operador: <b>{editingRetiro.usuario_nombre}</b></p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-gray-700">Fecha</label>
                <input type="date" required value={editRetiroForm.fecha}
                  onChange={e => setEditRetiroForm(f => ({ ...f, fecha: e.target.value }))}
                  className="mt-1 w-full border-2 border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-700">Hora</label>
                <input type="time" required value={editRetiroForm.hora}
                  onChange={e => setEditRetiroForm(f => ({ ...f, hora: e.target.value }))}
                  className="mt-1 w-full border-2 border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-700">Cliente</label>
              <input required value={editRetiroForm.cliente_nombre}
                onChange={e => setEditRetiroForm(f => ({ ...f, cliente_nombre: e.target.value }))}
                className="mt-1 w-full border-2 border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-700">Comentario</label>
              <input value={editRetiroForm.comentario}
                onChange={e => setEditRetiroForm(f => ({ ...f, comentario: e.target.value }))}
                className="mt-1 w-full border-2 border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
            {errorEditRetiro && <p className="text-xs text-red-700 bg-red-50 border-2 border-red-200 rounded-lg p-2">{errorEditRetiro}</p>}
            <div className="flex gap-3 pt-2">
              <button type="button" onClick={() => setEditingRetiro(null)}
                className="flex-1 border-2 border-gray-300 text-gray-700 rounded-lg py-2 text-sm font-semibold hover:bg-gray-50">
                Cancelar
              </button>
              <button type="submit" disabled={savingEditRetiro}
                className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg py-2 text-sm font-semibold shadow-md disabled:opacity-50">
                {savingEditRetiro ? 'Guardando...' : 'Guardar cambios'}
              </button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  )
}
