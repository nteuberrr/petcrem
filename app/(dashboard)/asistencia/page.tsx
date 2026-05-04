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

type JornadaCfg = { id: string; vigente_desde: string; hora_entrada: string; hora_salida: string; precio_hora_extra: number }

function fmtMinutos(mins: number): string {
  if (mins <= 0) return '0:00'
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return `${h}:${String(m).padStart(2, '0')}`
}

export default function AsistenciaPage() {
  const { data: session } = useSession()
  const role = (session?.user as { role?: string })?.role ?? 'operador'
  const isAdmin = role === 'admin'
  const myId = (session?.user as { id?: string })?.id ?? '0'
  const myName = session?.user?.name ?? session?.user?.email ?? ''

  const [registros, setRegistros] = useState<Registro[]>([])
  const [vigente, setVigente] = useState<JornadaCfg | null>(null)
  const [loading, setLoading] = useState(true)

  // Form fichaje
  const [form, setForm] = useState({ fecha: todayISO(), hora_entrada: '', hora_salida: '', comentario: '' })
  const [saving, setSaving] = useState(false)
  const [errorForm, setErrorForm] = useState('')

  // Modal de edición
  const [editing, setEditing] = useState<Registro | null>(null)
  const [editForm, setEditForm] = useState({ fecha: '', hora_entrada: '', hora_salida: '', comentario: '' })
  const [savingEdit, setSavingEdit] = useState(false)
  const [errorEdit, setErrorEdit] = useState('')

  // Filtros admin
  const [filtroMes, setFiltroMes] = useState(() => todayISO().slice(0, 7))
  const [filtroUsuario, setFiltroUsuario] = useState('')
  const [filtroEstado, setFiltroEstado] = useState<'todos' | 'pendiente' | 'aprobado' | 'rechazado' | 'abierto'>('todos')

  const fetchAll = useCallback(async () => {
    setLoading(true)
    const [resReg, resCfg] = await Promise.all([
      fetch('/api/asistencia').then(r => r.json()),
      fetch('/api/jornada-config').then(r => r.json()),
    ])
    setRegistros(Array.isArray(resReg) ? resReg : [])
    setVigente(resCfg?.vigente ?? null)
    setLoading(false)
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll])

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
    return Array.from(m.entries()).map(([id, nombre]) => ({ id, nombre })).sort((a, b) => a.nombre.localeCompare(b.nombre))
  }, [registros])

  const filtrados = useMemo(() => {
    return registros.filter(r => {
      const fecha = formatDateForSheet(r.fecha) || r.fecha
      if (filtroMes && !fecha.startsWith(filtroMes)) return false
      if (filtroUsuario && r.usuario_id !== filtroUsuario) return false
      if (filtroEstado !== 'todos' && r.estado_aprobacion !== filtroEstado) return false
      return true
    })
  }, [registros, filtroMes, filtroUsuario, filtroEstado])

  const resumen = useMemo(() => {
    let totalNormales = 0, totalExtra = 0
    filtrados.forEach(r => {
      totalNormales += parseFloat(r.minutos_normales) || 0
      if (r.estado_aprobacion === 'aprobado') totalExtra += parseFloat(r.minutos_extra) || 0
    })
    const costoExtra = vigente ? (totalExtra / 60) * vigente.precio_hora_extra : 0
    return { totalNormales, totalExtra, costoExtra }
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
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Asistencia</h1>
        <p className="text-gray-600 text-sm mt-0.5">{isAdmin ? 'Control de asistencia y horas extra' : 'Fichaje diario de entrada y salida'}</p>
      </div>

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
              <label className="text-xs font-semibold text-gray-700">Mes</label>
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
          <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="bg-blue-50 border-2 border-blue-200 rounded-lg p-3">
              <p className="text-xs font-semibold text-blue-700 uppercase">Horas normales</p>
              <p className="text-lg font-bold text-blue-900 mt-1">{fmtMinutos(resumen.totalNormales)}</p>
            </div>
            <div className="bg-amber-50 border-2 border-amber-300 rounded-lg p-3">
              <p className="text-xs font-semibold text-amber-700 uppercase">Horas extra (aprobadas)</p>
              <p className="text-lg font-bold text-amber-900 mt-1">{fmtMinutos(resumen.totalExtra)}</p>
            </div>
            <div className="bg-emerald-50 border-2 border-emerald-300 rounded-lg p-3">
              <p className="text-xs font-semibold text-emerald-700 uppercase">Costo extra estimado</p>
              <p className="text-lg font-bold text-emerald-900 mt-1">{fmtPrecio(resumen.costoExtra)}</p>
            </div>
          </div>
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
    </div>
  )
}
