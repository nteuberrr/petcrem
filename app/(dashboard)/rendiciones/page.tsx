'use client'
import { useCallback, useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import { fmtPrecio } from '@/lib/format'
import { formatDate, todayISO } from '@/lib/dates'
import { Modal } from '@/components/ui/Modal'
import { Badge } from '@/components/ui/Badge'

type Rendicion = {
  id: string; usuario: string; descripcion: string; fecha: string
  monto: string; tipo_documento: string; estado: string; pago_id: string
}

type Usuario = { id: string; nombre: string; email: string; rol: string }

export default function RendicionesPage() {
  const { data: session, status } = useSession()
  const isAdmin = status === 'authenticated' && (session?.user?.role === 'admin' || session?.user?.role === undefined)

  const [rendiciones, setRendiciones] = useState<Rendicion[]>([])
  const [usuarios, setUsuarios] = useState<Usuario[]>([])
  const [filtroEstado, setFiltroEstado] = useState<'todos' | 'pendiente' | 'pagado'>('todos')
  const [filtroUsuario, setFiltroUsuario] = useState('')

  const [showCrear, setShowCrear] = useState(false)
  const [showPagar, setShowPagar] = useState(false)
  const [form, setForm] = useState({ usuario: '', descripcion: '', fecha: todayISO(), monto: '', tipo_documento: 'boleta' })

  const [pagoForm, setPagoForm] = useState({
    rendicion_ids: [] as string[],
    usuario_pagado: '',
    fecha_pago: todayISO(),
    comentarios: '',
  })
  const [saving, setSaving] = useState(false)

  const fetchAll = useCallback(async () => {
    const [r, u] = await Promise.all([
      fetch('/api/rendiciones').then(r => r.json()),
      fetch('/api/usuarios').then(r => r.json()),
    ])
    setRendiciones(Array.isArray(r) ? r : [])
    // Incluir al admin como usuario seleccionable
    const adminUser: Usuario = {
      id: 'admin-env',
      nombre: 'Administrador',
      email: process.env.NEXT_PUBLIC_ADMIN_EMAIL ?? 'admin',
      rol: 'admin',
    }
    const reales = Array.isArray(u) ? u : []
    setUsuarios([adminUser, ...reales])
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll])

  async function crear(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    const res = await fetch('/api/rendiciones', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        usuario: form.usuario,
        descripcion: form.descripcion,
        fecha: form.fecha,
        monto: parseFloat(form.monto) || 0,
        tipo_documento: form.tipo_documento,
      }),
    })
    if (res.ok) {
      setForm({ usuario: '', descripcion: '', fecha: todayISO(), monto: '', tipo_documento: 'boleta' })
      setShowCrear(false)
      await fetchAll()
    } else {
      const err = await res.json().catch(() => ({}))
      alert(`Error: ${err.error ?? res.status}`)
    }
    setSaving(false)
  }

  async function pagarRendiciones(e: React.FormEvent) {
    e.preventDefault()
    if (pagoForm.rendicion_ids.length === 0) return alert('Selecciona al menos una rendición')
    if (!pagoForm.usuario_pagado) return alert('Selecciona a quién se paga')
    setSaving(true)
    const res = await fetch('/api/rendiciones/pagar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(pagoForm),
    })
    if (res.ok) {
      setPagoForm({ rendicion_ids: [], usuario_pagado: '', fecha_pago: todayISO(), comentarios: '' })
      setShowPagar(false)
      await fetchAll()
    } else {
      const err = await res.json().catch(() => ({}))
      alert(`Error: ${err.error ?? res.status}`)
    }
    setSaving(false)
  }

  async function descargarInforme() {
    const res = await fetch('/api/rendiciones/informe')
    if (!res.ok) return alert('Error al generar informe')
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    const now = new Date()
    a.download = `rendiciones_${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}.xlsx`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (status === 'loading') return <div className="p-8 text-gray-400 text-sm">Cargando...</div>
  if (!isAdmin) return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <p className="text-4xl mb-4">🔒</p>
      <h2 className="text-xl font-bold text-gray-900 mb-2">Acceso restringido</h2>
      <p className="text-gray-500 text-sm">Solo administradores.</p>
    </div>
  )

  const filtered = rendiciones.filter(r => {
    if (filtroEstado !== 'todos' && r.estado !== filtroEstado) return false
    if (filtroUsuario && r.usuario !== filtroUsuario) return false
    return true
  })

  const totalPendientes = rendiciones.filter(r => r.estado !== 'pagado').reduce((s, r) => s + (parseFloat(r.monto) || 0), 0)
  const totalPagados = rendiciones.filter(r => r.estado === 'pagado').reduce((s, r) => s + (parseFloat(r.monto) || 0), 0)

  // Monto pendiente agrupado por usuario
  const pendientesPorUsuario: Record<string, number> = {}
  rendiciones.filter(r => r.estado !== 'pagado').forEach(r => {
    pendientesPorUsuario[r.usuario] = (pendientesPorUsuario[r.usuario] || 0) + (parseFloat(r.monto) || 0)
  })
  const pendientesPorUsuarioArr = Object.entries(pendientesPorUsuario).sort((a, b) => b[1] - a[1])

  const togglePago = (id: string) => {
    setPagoForm(pf => ({
      ...pf,
      rendicion_ids: pf.rendicion_ids.includes(id) ? pf.rendicion_ids.filter(x => x !== id) : [...pf.rendicion_ids, id],
    }))
  }

  const pendientesParaPago = rendiciones.filter(r => r.estado !== 'pagado')
  const montoSeleccionado = pagoForm.rendicion_ids.reduce((s, id) => {
    const r = rendiciones.find(x => x.id === id)
    return s + (r ? parseFloat(r.monto) || 0 : 0)
  }, 0)

  return (
    <div className="max-w-6xl space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Rendiciones</h1>
          <p className="text-gray-500 text-sm mt-0.5">Gastos del personal y control de pagos</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowCrear(true)}
            className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
            + Nueva rendición
          </button>
          <button onClick={() => setShowPagar(true)}
            className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
            💰 Pagar rendiciones
          </button>
          <button onClick={descargarInforme}
            className="bg-gray-800 hover:bg-gray-900 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
            ↓ Descargar informe
          </button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-5">
          <div className="flex items-baseline justify-between mb-2">
            <p className="text-xs font-medium text-amber-700 uppercase tracking-wide">Pendientes de pago</p>
            <p className="text-2xl font-bold text-amber-900">{fmtPrecio(totalPendientes)}</p>
          </div>
          {pendientesPorUsuarioArr.length > 0 ? (
            <div className="mt-3 divide-y divide-amber-200 border-t border-amber-200">
              {pendientesPorUsuarioArr.map(([usuario, monto]) => (
                <div key={usuario} className="flex items-center justify-between py-1.5 text-sm">
                  <span className="text-amber-900">{usuario}</span>
                  <span className="font-semibold text-amber-900">{fmtPrecio(monto)}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-amber-700 italic mt-2">Sin pendientes</p>
          )}
        </div>
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-5">
          <p className="text-xs font-medium text-emerald-700 uppercase tracking-wide">Total pagado</p>
          <p className="text-2xl font-bold text-emerald-900 mt-1">{fmtPrecio(totalPagados)}</p>
        </div>
      </div>

      {/* Filtros */}
      <div className="flex gap-3">
        <select value={filtroEstado} onChange={e => setFiltroEstado(e.target.value as typeof filtroEstado)}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
          <option value="todos">Todos los estados</option>
          <option value="pendiente">Pendientes</option>
          <option value="pagado">Pagados</option>
        </select>
        <select value={filtroUsuario} onChange={e => setFiltroUsuario(e.target.value)}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
          <option value="">Todos los usuarios</option>
          {usuarios.map(u => <option key={u.id} value={u.nombre}>{u.nombre}</option>)}
        </select>
      </div>

      {/* Tabla */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              {['Usuario', 'Descripción', 'Fecha', 'Monto', 'Tipo doc.', 'Estado'].map(h => (
                <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-gray-500">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filtered.map(r => (
              <tr key={r.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-medium text-gray-900">{r.usuario}</td>
                <td className="px-4 py-3 text-gray-700">{r.descripcion}</td>
                <td className="px-4 py-3 text-gray-700">{formatDate(r.fecha)}</td>
                <td className="px-4 py-3 font-semibold text-gray-900">{fmtPrecio(r.monto)}</td>
                <td className="px-4 py-3 text-gray-700 capitalize">{r.tipo_documento}</td>
                <td className="px-4 py-3">
                  <Badge variant={r.estado === 'pagado' ? 'green' : 'yellow'}>{r.estado}</Badge>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-sm text-gray-400">Sin rendiciones</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Modal nueva rendición */}
      <Modal open={showCrear} onClose={() => setShowCrear(false)} title="Nueva rendición">
        <form onSubmit={crear} className="space-y-3">
          <div>
            <label className="text-xs font-medium text-gray-700">Usuario</label>
            <select required value={form.usuario} onChange={e => setForm(f => ({ ...f, usuario: e.target.value }))}
              className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
              <option value="">Seleccionar...</option>
              {usuarios.map(u => <option key={u.id} value={u.nombre}>{u.nombre} ({u.email})</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-700">Descripción</label>
            <textarea required value={form.descripcion} onChange={e => setForm(f => ({ ...f, descripcion: e.target.value }))} rows={3}
              className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-gray-700">Fecha</label>
              <input type="date" required value={form.fecha} onChange={e => setForm(f => ({ ...f, fecha: e.target.value }))}
                className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-700">Monto ($)</label>
              <input type="number" min="0" required value={form.monto} onChange={e => setForm(f => ({ ...f, monto: e.target.value }))}
                className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-700">Tipo de documento</label>
            <div className="mt-2 flex gap-4">
              {(['boleta', 'factura'] as const).map(t => (
                <label key={t} className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" checked={form.tipo_documento === t} onChange={() => setForm(f => ({ ...f, tipo_documento: t }))} />
                  <span className="text-sm capitalize">{t}</span>
                </label>
              ))}
            </div>
          </div>
          <button type="submit" disabled={saving}
            className="w-full bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg py-2 text-sm font-medium transition-colors disabled:opacity-50">
            {saving ? 'Guardando...' : 'Crear rendición'}
          </button>
        </form>
      </Modal>

      {/* Modal pagar rendiciones */}
      <Modal open={showPagar} onClose={() => setShowPagar(false)} title="Pagar rendiciones">
        <form onSubmit={pagarRendiciones} className="space-y-3">
          <div>
            <label className="text-xs font-medium text-gray-700">Rendiciones pendientes</label>
            <div className="mt-2 max-h-60 overflow-y-auto border border-gray-200 rounded-lg divide-y divide-gray-100">
              {pendientesParaPago.length === 0 ? (
                <p className="p-4 text-xs text-gray-400 text-center">Sin rendiciones pendientes</p>
              ) : pendientesParaPago.map(r => (
                <label key={r.id} className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-gray-50">
                  <input type="checkbox"
                    checked={pagoForm.rendicion_ids.includes(r.id)}
                    onChange={() => togglePago(r.id)}
                    className="w-4 h-4 text-indigo-600" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-gray-900 truncate">{r.usuario} · {r.descripcion}</div>
                    <div className="text-xs text-gray-500">{formatDate(r.fecha)} · {r.tipo_documento}</div>
                  </div>
                  <div className="text-sm font-semibold text-gray-900">{fmtPrecio(r.monto)}</div>
                </label>
              ))}
            </div>
            <div className="mt-2 flex justify-between text-sm">
              <span className="text-gray-500">{pagoForm.rendicion_ids.length} seleccionada(s)</span>
              <span className="font-bold text-gray-900">Total: {fmtPrecio(montoSeleccionado)}</span>
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-700">A quién se paga</label>
            <select required value={pagoForm.usuario_pagado} onChange={e => setPagoForm(p => ({ ...p, usuario_pagado: e.target.value }))}
              className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
              <option value="">Seleccionar...</option>
              {usuarios.map(u => <option key={u.id} value={u.nombre}>{u.nombre}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-700">Fecha del pago</label>
            <input type="date" required value={pagoForm.fecha_pago} onChange={e => setPagoForm(p => ({ ...p, fecha_pago: e.target.value }))}
              className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-700">Comentarios</label>
            <textarea value={pagoForm.comentarios} onChange={e => setPagoForm(p => ({ ...p, comentarios: e.target.value }))} rows={2}
              className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none" />
          </div>
          <button type="submit" disabled={saving || pagoForm.rendicion_ids.length === 0}
            className="w-full bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg py-2 text-sm font-medium transition-colors disabled:opacity-50">
            {saving ? 'Procesando...' : `Confirmar pago (${fmtPrecio(montoSeleccionado)})`}
          </button>
        </form>
      </Modal>
    </div>
  )
}
