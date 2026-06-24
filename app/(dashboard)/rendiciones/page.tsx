'use client'
import { useCallback, useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import { fmtPrecio } from '@/lib/format'
import { formatDate, formatDateForSheet, todayISO } from '@/lib/dates'
import { Modal } from '@/components/ui/Modal'
import { Badge } from '@/components/ui/Badge'

type Rendicion = {
  id: string; usuario: string; descripcion: string; fecha: string
  monto: string; tipo_documento: string; clasificacion: string; partida_id: string; estado: string; pago_id: string
}

type Usuario = { id: string; nombre: string; email: string; rol: string }
type Partida = { id: string; tipo: string; nombre: string }

const docLabel = (d: string) => (d === 'boleta' ? 'Boleta' : d === 'factura' ? 'Factura' : '—')
const clasifLabel = (c: string) => ((c || 'rendicion') === 'aporte' ? 'Aporte' : 'Rendición')

export default function RendicionesPage() {
  const { data: session, status } = useSession()
  const role = session?.user?.role
  // Admin principal: ve TODO y es el único que edita/elimina. admin2: ve, crea y paga.
  const esPrincipal = status === 'authenticated' && (role === 'admin' || role === undefined)
  const puedeVer = esPrincipal || role === 'admin2'

  const [rendiciones, setRendiciones] = useState<Rendicion[]>([])
  const [usuarios, setUsuarios] = useState<Usuario[]>([])
  const [partidas, setPartidas] = useState<Partida[]>([])
  const [filtroEstado, setFiltroEstado] = useState<'todos' | 'pendiente' | 'pagado'>('todos')
  const [filtroUsuario, setFiltroUsuario] = useState('')
  const [filtroDoc, setFiltroDoc] = useState('')
  const [filtroClasif, setFiltroClasif] = useState('')
  const [filtroPartida, setFiltroPartida] = useState('')
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [showBulk, setShowBulk] = useState(false)

  const [showCrear, setShowCrear] = useState(false)
  const [showPagar, setShowPagar] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState({ usuario: '', descripcion: '', fecha: todayISO(), monto: '', clasificacion: 'rendicion', tipo_documento: 'boleta', partida_id: '' })

  const [pagoForm, setPagoForm] = useState({
    rendicion_ids: [] as string[],
    usuario_pagado: '',
    fecha_pago: todayISO(),
    comentarios: '',
  })
  const [saving, setSaving] = useState(false)

  const fetchAll = useCallback(async () => {
    const [r, u, p] = await Promise.all([
      fetch('/api/rendiciones').then(r => r.json()),
      fetch('/api/usuarios').then(r => r.json()),
      fetch('/api/rendiciones/partidas').then(r => r.json()).catch(() => []),
    ])
    setRendiciones(Array.isArray(r) ? r : [])
    setPartidas(Array.isArray(p) ? p : [])
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

  function resetForm() {
    setForm({ usuario: '', descripcion: '', fecha: todayISO(), monto: '', clasificacion: 'rendicion', tipo_documento: 'boleta', partida_id: '' })
    setEditId(null)
  }

  async function crear(e: React.FormEvent) {
    e.preventDefault()
    if (form.clasificacion === 'rendicion' && form.tipo_documento === 'boleta' && !form.partida_id) {
      return alert('Elegí la partida para la boleta.')
    }
    setSaving(true)
    const esAporte = form.clasificacion === 'aporte'
    const tipoDoc = esAporte ? '' : form.tipo_documento
    const payload = {
      ...(editId ? { id: editId } : {}),
      usuario: form.usuario,
      descripcion: form.descripcion,
      fecha: form.fecha,
      monto: parseFloat(form.monto) || 0,
      clasificacion: form.clasificacion,
      tipo_documento: tipoDoc,
      partida_id: !esAporte && tipoDoc === 'boleta' ? form.partida_id : '',
    }
    const res = await fetch('/api/rendiciones', {
      method: editId ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (res.ok) {
      resetForm()
      setShowCrear(false)
      await fetchAll()
    } else {
      const err = await res.json().catch(() => ({}))
      alert(`Error: ${err.error ?? res.status}`)
    }
    setSaving(false)
  }

  function editar(r: Rendicion) {
    setForm({
      usuario: r.usuario, descripcion: r.descripcion,
      fecha: formatDateForSheet(r.fecha) || r.fecha,
      monto: r.monto,
      clasificacion: r.clasificacion || 'rendicion',
      tipo_documento: r.tipo_documento || 'boleta',
      partida_id: r.partida_id || '',
    })
    setEditId(r.id)
    setShowCrear(true)
  }

  async function eliminar(r: Rendicion) {
    if (!confirm(`¿Eliminar la rendición de ${r.usuario} (${fmtPrecio(r.monto)})?`)) return
    const res = await fetch(`/api/rendiciones?id=${encodeURIComponent(r.id)}`, { method: 'DELETE' })
    if (res.ok) await fetchAll()
    else alert('No se pudo eliminar')
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
  if (!puedeVer) return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <p className="text-4xl mb-4">🔒</p>
      <h2 className="text-xl font-bold text-gray-900 mb-2">Acceso restringido</h2>
      <p className="text-gray-500 text-sm">Solo administradores.</p>
    </div>
  )

  const filtered = rendiciones.filter(r => {
    if (filtroEstado !== 'todos' && r.estado !== filtroEstado) return false
    if (filtroUsuario && r.usuario !== filtroUsuario) return false
    if (filtroDoc && r.tipo_documento !== filtroDoc) return false
    if (filtroClasif && (r.clasificacion || 'rendicion') !== filtroClasif) return false
    if (filtroPartida === '__none__') {
      // Sin asignar: una boleta de rendición que todavía no tiene partida.
      const necesita = r.tipo_documento === 'boleta' && (r.clasificacion || 'rendicion') !== 'aporte'
      if (!(necesita && !r.partida_id)) return false
    } else if (filtroPartida && r.partida_id !== filtroPartida) return false
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

  const partidaNombre = (id: string) => partidas.find(p => p.id === id)?.nombre || ''

  const todasSel = filtered.length > 0 && filtered.every(r => sel.has(r.id))
  const toggleSel = (id: string) => setSel(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const toggleAll = () => setSel(() => (todasSel ? new Set() : new Set(filtered.map(r => r.id))))

  return (
    <div className="max-w-6xl space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-extrabold text-brand tracking-tight">Rendiciones</h1>
          <p className="text-gray-500 text-sm mt-0.5">Gastos del personal y control de pagos</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => { resetForm(); setShowCrear(true) }}
            className="bg-brand hover:bg-brand-dark text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
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
      <div className="flex flex-wrap gap-3">
        <select value={filtroEstado} onChange={e => setFiltroEstado(e.target.value as typeof filtroEstado)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand">
          <option value="todos">Todos los estados</option>
          <option value="pendiente">Pendientes</option>
          <option value="pagado">Pagados</option>
        </select>
        <select value={filtroUsuario} onChange={e => setFiltroUsuario(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand">
          <option value="">Todos los usuarios</option>
          {usuarios.map(u => <option key={u.id} value={u.nombre}>{u.nombre}</option>)}
        </select>
        <select value={filtroDoc} onChange={e => setFiltroDoc(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand">
          <option value="">Todo documento</option>
          <option value="boleta">Boleta</option>
          <option value="factura">Factura</option>
        </select>
        <select value={filtroClasif} onChange={e => setFiltroClasif(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand">
          <option value="">Toda clasificación</option>
          <option value="rendicion">Rendición</option>
          <option value="aporte">Aporte</option>
        </select>
        <select value={filtroPartida} onChange={e => setFiltroPartida(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand">
          <option value="">Toda partida</option>
          <option value="__none__">Sin asignar</option>
          {partidas.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
        </select>
        {(filtroEstado !== 'todos' || filtroUsuario || filtroDoc || filtroClasif || filtroPartida) && (
          <button onClick={() => { setFiltroEstado('todos'); setFiltroUsuario(''); setFiltroDoc(''); setFiltroClasif(''); setFiltroPartida('') }}
            className="text-xs text-gray-400 hover:text-gray-700 self-center">Limpiar</button>
        )}
      </div>

      {/* Barra de edición masiva (solo admin principal) */}
      {esPrincipal && sel.size > 0 && (
        <div className="flex flex-wrap items-center gap-3 bg-brand/10 border border-brand/30 rounded-lg px-4 py-2.5">
          <span className="text-sm text-brand font-medium">{sel.size} seleccionada(s)</span>
          <button onClick={() => setShowBulk(true)} className="bg-brand text-white px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-brand-dark">Editar seleccionadas</button>
          <button onClick={() => setSel(new Set())} className="text-sm text-gray-500 hover:text-gray-700 ml-auto">Limpiar selección</button>
        </div>
      )}

      {/* Tabla */}
      <div className="bg-white rounded-xl shadow-md border border-gray-300 overflow-x-auto">
        <table className="w-full text-sm min-w-[920px]">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-3 py-3 w-8 text-center">{esPrincipal && <input type="checkbox" checked={todasSel} onChange={toggleAll} title="Seleccionar todas" />}</th>
              {['Usuario', 'Descripción', 'Fecha', 'Monto', 'Documento', 'Clasif.', 'Partida', 'Estado', ''].map((h, i) => (
                <th key={i} className="text-left px-4 py-3 text-xs font-semibold text-gray-500">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filtered.map(r => {
              const esAporte = (r.clasificacion || 'rendicion') === 'aporte'
              return (
                <tr key={r.id} className={`hover:bg-gray-50 ${sel.has(r.id) ? 'bg-brand/10/40' : ''}`}>
                  <td className="px-3 py-3 text-center">{esPrincipal && <input type="checkbox" checked={sel.has(r.id)} onChange={() => toggleSel(r.id)} />}</td>
                  <td className="px-4 py-3 font-medium text-gray-900">{r.usuario}</td>
                  <td className="px-4 py-3 text-gray-700">{r.descripcion}</td>
                  <td className="px-4 py-3 text-gray-700 whitespace-nowrap">{formatDate(r.fecha)}</td>
                  <td className="px-4 py-3 font-semibold text-gray-900 whitespace-nowrap">{fmtPrecio(r.monto)}</td>
                  <td className="px-4 py-3 text-gray-700">{docLabel(r.tipo_documento)}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded ${esAporte ? 'bg-purple-50 text-purple-700' : 'bg-gray-100 text-gray-600'}`}>{clasifLabel(r.clasificacion)}</span>
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {r.tipo_documento === 'boleta' && !esAporte
                      ? (r.partida_id ? <span className="text-gray-700">{partidaNombre(r.partida_id)}</span> : <span className="text-amber-600 font-bold" title="Pendiente de asignación">(!)</span>)
                      : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={r.estado === 'pagado' ? 'green' : 'yellow'}>{r.estado}</Badge>
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    {esPrincipal ? (
                      <>
                        <button onClick={() => editar(r)} className="text-xs text-gray-400 hover:text-brand mr-3">Editar</button>
                        <button onClick={() => eliminar(r)} className="text-xs text-gray-300 hover:text-red-600">Eliminar</button>
                      </>
                    ) : <span className="text-gray-300">—</span>}
                  </td>
                </tr>
              )
            })}
            {filtered.length === 0 && (
              <tr><td colSpan={10} className="px-4 py-8 text-center text-sm text-gray-400">Sin rendiciones</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Modal nueva rendición */}
      <Modal open={showCrear} onClose={() => { setShowCrear(false); resetForm() }} title={editId ? 'Editar rendición' : 'Nueva rendición'}>
        <form onSubmit={crear} className="space-y-3">
          <div>
            <label className="text-xs font-medium text-gray-700">Usuario</label>
            <select required value={form.usuario} onChange={e => setForm(f => ({ ...f, usuario: e.target.value }))}
              className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand">
              <option value="">Seleccionar...</option>
              {usuarios.map(u => <option key={u.id} value={u.nombre}>{u.nombre} ({u.email})</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-700">Descripción</label>
            <textarea required value={form.descripcion} onChange={e => setForm(f => ({ ...f, descripcion: e.target.value }))} rows={3}
              className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand resize-none" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-gray-700">Fecha</label>
              <input type="date" required value={form.fecha} onChange={e => setForm(f => ({ ...f, fecha: e.target.value }))}
                className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-700">Monto ($)</label>
              <input type="number" min="0" required value={form.monto} onChange={e => setForm(f => ({ ...f, monto: e.target.value }))}
                className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand" />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-700">Clasificación</label>
            <div className="mt-2 flex gap-4">
              {(['rendicion', 'aporte'] as const).map(c => (
                <label key={c} className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" checked={form.clasificacion === c} onChange={() => setForm(f => ({ ...f, clasificacion: c }))} />
                  <span className="text-sm">{c === 'aporte' ? 'Aporte (préstamo)' : 'Rendición'}</span>
                </label>
              ))}
            </div>
            {form.clasificacion === 'aporte' && (
              <p className="text-xs text-gray-400 mt-1">El aporte es un préstamo a la empresa: se clasifica pero no va al resultado del EERR.</p>
            )}
          </div>
          {form.clasificacion === 'rendicion' && (
            <div>
              <label className="text-xs font-medium text-gray-700">Documento</label>
              <div className="mt-2 flex gap-4">
                {(['boleta', 'factura'] as const).map(t => (
                  <label key={t} className="flex items-center gap-2 cursor-pointer">
                    <input type="radio" checked={form.tipo_documento === t} onChange={() => setForm(f => ({ ...f, tipo_documento: t, partida_id: t === 'boleta' ? f.partida_id : '' }))} />
                    <span className="text-sm capitalize">{t}</span>
                  </label>
                ))}
              </div>
              {form.tipo_documento === 'factura' && (
                <p className="text-xs text-gray-400 mt-1">La factura no se asigna a partida (viene del SII).</p>
              )}
            </div>
          )}
          {form.clasificacion === 'rendicion' && form.tipo_documento === 'boleta' && (
            <div>
              <label className="text-xs font-medium text-gray-700">Partida (Estado de Resultados)</label>
              <select required value={form.partida_id} onChange={e => setForm(f => ({ ...f, partida_id: e.target.value }))}
                className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand">
                <option value="">Seleccionar partida...</option>
                {partidas.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
              </select>
            </div>
          )}
          <button type="submit" disabled={saving}
            className="w-full bg-brand hover:bg-brand-dark text-white rounded-lg py-2 text-sm font-medium transition-colors disabled:opacity-50">
            {saving ? 'Guardando...' : (editId ? 'Guardar cambios' : 'Crear rendición')}
          </button>
        </form>
      </Modal>

      {/* Modal pagar rendiciones */}
      <Modal open={showPagar} onClose={() => setShowPagar(false)} title="Pagar rendiciones">
        <form onSubmit={pagarRendiciones} className="space-y-3">
          <div>
            <label className="text-xs font-medium text-gray-700">Rendiciones pendientes</label>
            <div className="mt-2 max-h-60 overflow-y-auto border border-gray-300 rounded-lg divide-y divide-gray-100">
              {pendientesParaPago.length === 0 ? (
                <p className="p-4 text-xs text-gray-400 text-center">Sin rendiciones pendientes</p>
              ) : pendientesParaPago.map(r => (
                <label key={r.id} className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-gray-50">
                  <input type="checkbox"
                    checked={pagoForm.rendicion_ids.includes(r.id)}
                    onChange={() => togglePago(r.id)}
                    className="w-4 h-4 text-brand" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-gray-900 truncate">{r.usuario} · {r.descripcion}</div>
                    <div className="text-xs text-gray-500">{formatDate(r.fecha)} · {clasifLabel(r.clasificacion)}{r.tipo_documento ? ` · ${docLabel(r.tipo_documento)}` : ''}</div>
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
              className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand">
              <option value="">Seleccionar...</option>
              {usuarios.map(u => <option key={u.id} value={u.nombre}>{u.nombre}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-700">Fecha del pago</label>
            <input type="date" required value={pagoForm.fecha_pago} onChange={e => setPagoForm(p => ({ ...p, fecha_pago: e.target.value }))}
              className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand" />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-700">Comentarios</label>
            <textarea value={pagoForm.comentarios} onChange={e => setPagoForm(p => ({ ...p, comentarios: e.target.value }))} rows={2}
              className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand resize-none" />
          </div>
          <button type="submit" disabled={saving || pagoForm.rendicion_ids.length === 0}
            className="w-full bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg py-2 text-sm font-medium transition-colors disabled:opacity-50">
            {saving ? 'Procesando...' : `Confirmar pago (${fmtPrecio(montoSeleccionado)})`}
          </button>
        </form>
      </Modal>

      {showBulk && (
        <BulkEditModal
          ids={Array.from(sel)}
          partidas={partidas}
          onClose={() => setShowBulk(false)}
          onSaved={() => { setShowBulk(false); setSel(new Set()); fetchAll() }}
        />
      )}
    </div>
  )
}

function BulkEditModal({ ids, partidas, onClose, onSaved }: {
  ids: string[]; partidas: Partida[]; onClose: () => void; onSaved: () => void
}) {
  const [campo, setCampo] = useState<'clasificacion' | 'tipo_documento' | 'partida_id'>('clasificacion')
  const [valor, setValor] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  const elegirCampo = (c: typeof campo) => { setCampo(c); setValor('') }
  const opt = (active: boolean) => `px-3 py-1.5 rounded-lg text-sm font-medium ${active ? 'bg-brand text-white' : 'bg-white border border-gray-300 text-gray-600'}`

  async function aplicar() {
    if (!valor) { setErr('Elegí un valor.'); return }
    setSaving(true); setErr('')
    const res = await fetch('/api/rendiciones', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids, [campo]: valor }) })
    setSaving(false)
    if (res.ok) onSaved()
    else { const d = await res.json().catch(() => ({})); setErr(d?.error || 'No se pudo aplicar') }
  }

  return (
    <Modal open onClose={onClose} title={`Editar ${ids.length} rendición(es)`}>
      <div className="space-y-4">
        <div>
          <label className="block text-xs text-gray-500 mb-1.5">¿Qué querés editar?</label>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => elegirCampo('clasificacion')} className={opt(campo === 'clasificacion')}>Clasificación</button>
            <button onClick={() => elegirCampo('tipo_documento')} className={opt(campo === 'tipo_documento')}>Documento</button>
            <button onClick={() => elegirCampo('partida_id')} className={opt(campo === 'partida_id')}>Partida</button>
          </div>
        </div>

        <div className="border-t border-gray-300 pt-4">
          {campo === 'clasificacion' && (
            <>
              <label className="block text-xs text-gray-500 mb-1.5">Marcar como</label>
              <div className="flex gap-2">
                <button onClick={() => setValor('rendicion')} className={opt(valor === 'rendicion')}>Rendición</button>
                <button onClick={() => setValor('aporte')} className={opt(valor === 'aporte')}>Aporte</button>
              </div>
              {valor === 'aporte' && <p className="text-xs text-gray-400 mt-2">El aporte queda sin documento ni partida y no va al resultado del EERR.</p>}
            </>
          )}
          {campo === 'tipo_documento' && (
            <>
              <label className="block text-xs text-gray-500 mb-1.5">Marcar como</label>
              <div className="flex gap-2">
                <button onClick={() => setValor('boleta')} className={opt(valor === 'boleta')}>Boleta</button>
                <button onClick={() => setValor('factura')} className={opt(valor === 'factura')}>Factura</button>
              </div>
              <p className="text-xs text-gray-400 mt-2">Solo aplica a rendiciones (no a aportes). La factura no lleva partida (viene del SII).</p>
            </>
          )}
          {campo === 'partida_id' && (
            <>
              <label className="block text-xs text-gray-500 mb-1.5">Partida</label>
              <select value={valor} onChange={e => setValor(e.target.value)} className="w-full border border-gray-300 rounded px-2 py-2 text-sm">
                <option value="">Seleccionar partida...</option>
                {partidas.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
              </select>
              <p className="text-xs text-gray-400 mt-2">Solo se aplica a las boletas de rendición (facturas y aportes no llevan partida).</p>
            </>
          )}
        </div>

        {err && <p className="text-sm text-red-700">{err}</p>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="text-sm text-gray-500 px-3 py-2">Cancelar</button>
          <button onClick={aplicar} disabled={saving} className="bg-brand text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-brand-dark disabled:opacity-50">{saving ? 'Aplicando…' : 'Aplicar a todas'}</button>
        </div>
      </div>
    </Modal>
  )
}
