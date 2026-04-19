'use client'
import { useState, useEffect, useCallback } from 'react'
import { Toggle } from '@/components/ui/Toggle'
import { Modal } from '@/components/ui/Modal'
import { Badge } from '@/components/ui/Badge'

const TABS = ['Veterinarios', 'Productos', 'Precios generales', 'Precios convenio', 'Especies', 'Tipos servicio', 'Otros servicios'] as const
type Tab = typeof TABS[number]

type Vet = { id: string; nombre: string; comuna: string; nombre_contacto: string; cargo_contacto: string; tipo_precios: string; activo: string; direccion: string; telefono: string; correo: string; rut: string; razon_social: string; giro: string }
type Producto = { id: string; nombre: string; precio: string; foto_url: string; activo: string }
type Tramo = { id: string; peso_min: string; peso_max: string; precio_ci: string; precio_cp: string; precio_sd: string }
type Especie = { id: string; nombre: string; letra: string; activo: string }
type TipoServicio = { id: string; nombre: string; codigo: string; activo: string }
type OtroServicio = { id: string; nombre: string; precio: string; activo: string }

const emptyVet = { nombre: '', direccion: '', telefono: '', correo: '', nombre_contacto: '', cargo_contacto: '', comuna: '', rut: '', razon_social: '', giro: '', tipo_precios: 'precios_convenio' }

export default function BasesPage() {
  const [tab, setTab] = useState<Tab>('Veterinarios')
  const [vets, setVets] = useState<Vet[]>([])
  const [productos, setProductos] = useState<Producto[]>([])
  const [preciosG, setPreciosG] = useState<Tramo[]>([])
  const [preciosC, setPreciosC] = useState<Tramo[]>([])
  const [especies, setEspecies] = useState<Especie[]>([])
  const [tiposServicio, setTiposServicio] = useState<TipoServicio[]>([])
  const [otros, setOtros] = useState<OtroServicio[]>([])
  const [showVetModal, setShowVetModal] = useState(false)
  const [showEspecieModal, setShowEspecieModal] = useState(false)
  const [showOtroModal, setShowOtroModal] = useState(false)
  const [showProdModal, setShowProdModal] = useState(false)
  const [vetForm, setVetForm] = useState(emptyVet)
  const [especieForm, setEspecieForm] = useState({ nombre: '', letra: '' })
  const [otroForm, setOtroForm] = useState({ nombre: '', precio: '' })
  const [prodForm, setProdForm] = useState({ nombre: '', precio: '' })

  const fetchAll = useCallback(async () => {
    const [v, p, pg, pc, e, ts, os] = await Promise.all([
      fetch('/api/veterinarios').then(r => r.json()),
      fetch('/api/productos').then(r => r.json()),
      fetch('/api/precios?tipo=general').then(r => r.json()),
      fetch('/api/precios?tipo=convenio').then(r => r.json()),
      fetch('/api/especies').then(r => r.json()),
      fetch('/api/servicios').then(r => r.json()),
      fetch('/api/servicios?tipo=otros').then(r => r.json()),
    ])
    setVets(Array.isArray(v) ? v : [])
    setProductos(Array.isArray(p) ? p : [])
    setPreciosG(Array.isArray(pg) ? pg : [])
    setPreciosC(Array.isArray(pc) ? pc : [])
    setEspecies(Array.isArray(e) ? e : [])
    setTiposServicio(Array.isArray(ts) ? ts : [])
    setOtros(Array.isArray(os) ? os : [])
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll])

  const patch = async (url: string, body: object) => {
    await fetch(url, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    await fetchAll()
  }

  const post = async (url: string, body: object) => {
    await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    await fetchAll()
  }

  const fmt = (n: string) => `$${parseInt(n || '0').toLocaleString('es-CL')}`

  return (
    <div className="max-w-5xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Bases</h1>
        <p className="text-gray-500 text-sm mt-0.5">Configuración y datos maestros</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-gray-100 p-1 rounded-xl overflow-x-auto">
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)} className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${tab === t ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>
            {t}
          </button>
        ))}
      </div>

      {/* Veterinarios */}
      {tab === 'Veterinarios' && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
            <h2 className="font-semibold text-gray-900">Veterinarios</h2>
            <button onClick={() => setShowVetModal(true)} className="text-indigo-600 text-sm font-medium hover:text-indigo-800">+ Agregar</button>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>{['Nombre', 'Comuna', 'Contacto', 'Precios', 'Estado'].map(h => <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-gray-500">{h}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {vets.map(v => (
                <tr key={v.id}>
                  <td className="px-4 py-3 font-medium text-gray-900">{v.nombre}</td>
                  <td className="px-4 py-3 text-gray-600">{v.comuna}</td>
                  <td className="px-4 py-3 text-gray-600">{v.nombre_contacto}</td>
                  <td className="px-4 py-3"><Badge variant="blue">{v.tipo_precios === 'precios_convenio' ? 'Convenio' : 'Especial'}</Badge></td>
                  <td className="px-4 py-3"><Toggle checked={v.activo === 'TRUE'} onChange={val => patch('/api/veterinarios', { id: v.id, activo: val ? 'TRUE' : 'FALSE' })} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Productos */}
      {tab === 'Productos' && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
            <h2 className="font-semibold text-gray-900">Productos adicionales</h2>
            <button onClick={() => setShowProdModal(true)} className="text-indigo-600 text-sm font-medium hover:text-indigo-800">+ Agregar</button>
          </div>
          <div className="divide-y divide-gray-50">
            {productos.map(p => (
              <div key={p.id} className="flex items-center gap-4 px-6 py-4">
                {p.foto_url && <img src={p.foto_url} alt={p.nombre} className="w-10 h-10 object-cover rounded-lg" />}
                <div className="flex-1">
                  <p className="text-sm font-medium text-gray-900">{p.nombre}</p>
                  <p className="text-xs text-gray-500">{fmt(p.precio)}</p>
                </div>
                <Toggle checked={p.activo === 'TRUE'} onChange={val => patch('/api/productos', { id: p.id, activo: val ? 'TRUE' : 'FALSE' })} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Precios generales */}
      {tab === 'Precios generales' && (
        <TablaPrecios tramos={preciosG} tipo="general" onUpdate={fetchAll} />
      )}

      {/* Precios convenio */}
      {tab === 'Precios convenio' && (
        <TablaPrecios tramos={preciosC} tipo="convenio" onUpdate={fetchAll} />
      )}

      {/* Especies */}
      {tab === 'Especies' && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
            <h2 className="font-semibold text-gray-900">Especies</h2>
            <button onClick={() => setShowEspecieModal(true)} className="text-indigo-600 text-sm font-medium hover:text-indigo-800">+ Agregar</button>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-gray-50"><tr>{['Nombre', 'Letra', 'Activo'].map(h => <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-gray-500">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-gray-50">
              {especies.map(e => (
                <tr key={e.id}>
                  <td className="px-4 py-3 font-medium text-gray-900">{e.nombre}</td>
                  <td className="px-4 py-3"><span className="font-mono font-bold text-indigo-700">{e.letra}</span></td>
                  <td className="px-4 py-3"><Toggle checked={e.activo === 'TRUE'} onChange={val => patch('/api/especies', { id: e.id, activo: val ? 'TRUE' : 'FALSE' })} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Tipos de servicio */}
      {tab === 'Tipos servicio' && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100">
            <h2 className="font-semibold text-gray-900">Tipos de servicio</h2>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-gray-50"><tr>{['Nombre', 'Código', 'Activo'].map(h => <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-gray-500">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-gray-50">
              {tiposServicio.map(t => (
                <tr key={t.id}>
                  <td className="px-4 py-3 font-medium text-gray-900">{t.nombre}</td>
                  <td className="px-4 py-3"><span className="font-mono font-semibold text-gray-700">{t.codigo}</span></td>
                  <td className="px-4 py-3"><Toggle checked={t.activo === 'TRUE'} onChange={val => patch('/api/servicios', { id: t.id, activo: val ? 'TRUE' : 'FALSE' })} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Otros servicios */}
      {tab === 'Otros servicios' && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
            <h2 className="font-semibold text-gray-900">Otros servicios</h2>
            <button onClick={() => setShowOtroModal(true)} className="text-indigo-600 text-sm font-medium hover:text-indigo-800">+ Agregar</button>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-gray-50"><tr>{['Nombre', 'Precio', 'Activo'].map(h => <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-gray-500">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-gray-50">
              {otros.map(o => (
                <tr key={o.id}>
                  <td className="px-4 py-3 font-medium text-gray-900">{o.nombre}</td>
                  <td className="px-4 py-3 text-gray-600">{fmt(o.precio)}</td>
                  <td className="px-4 py-3"><Toggle checked={o.activo === 'TRUE'} onChange={val => patch('/api/servicios?tipo=otros', { id: o.id, activo: val ? 'TRUE' : 'FALSE' })} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Modales */}
      <Modal open={showVetModal} onClose={() => setShowVetModal(false)} title="Agregar veterinario">
        <form onSubmit={async e => {
          e.preventDefault()
          await post('/api/veterinarios', vetForm)
          setShowVetModal(false)
          setVetForm(emptyVet)
        }} className="space-y-3">
          {[['Nombre', 'nombre'], ['RUT', 'rut'], ['Razón social', 'razon_social'], ['Giro', 'giro'], ['Dirección', 'direccion'], ['Teléfono', 'telefono'], ['Correo', 'correo'], ['Nombre contacto', 'nombre_contacto'], ['Cargo contacto', 'cargo_contacto'], ['Comuna', 'comuna']].map(([label, key]) => (
            <div key={key}>
              <label className="text-xs font-medium text-gray-700">{label}</label>
              <input value={(vetForm as Record<string, string>)[key]} onChange={e => setVetForm(f => ({ ...f, [key]: e.target.value }))} className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
          ))}
          <div>
            <label className="text-xs font-medium text-gray-700">Tipo de precios</label>
            <select value={vetForm.tipo_precios} onChange={e => setVetForm(f => ({ ...f, tipo_precios: e.target.value }))} className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
              <option value="precios_convenio">Precios convenio</option>
              <option value="precios_especiales">Precios especiales</option>
            </select>
          </div>
          <button type="submit" className="w-full bg-indigo-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-indigo-700">Guardar</button>
        </form>
      </Modal>

      <Modal open={showEspecieModal} onClose={() => setShowEspecieModal(false)} title="Agregar especie">
        <form onSubmit={async e => {
          e.preventDefault()
          await post('/api/especies', especieForm)
          setShowEspecieModal(false)
          setEspecieForm({ nombre: '', letra: '' })
        }} className="space-y-4">
          <div>
            <label className="text-xs font-medium text-gray-700">Nombre</label>
            <input required value={especieForm.nombre} onChange={e => setEspecieForm(f => ({ ...f, nombre: e.target.value }))} className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-700">Letra (1 char mayúscula)</label>
            <input required maxLength={1} value={especieForm.letra} onChange={e => setEspecieForm(f => ({ ...f, letra: e.target.value.toUpperCase() }))} className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
          <button type="submit" className="w-full bg-indigo-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-indigo-700">Guardar</button>
        </form>
      </Modal>

      <Modal open={showOtroModal} onClose={() => setShowOtroModal(false)} title="Agregar servicio">
        <form onSubmit={async e => {
          e.preventDefault()
          await post('/api/servicios?tipo=otros', { nombre: otroForm.nombre, precio: parseInt(otroForm.precio) })
          setShowOtroModal(false)
          setOtroForm({ nombre: '', precio: '' })
        }} className="space-y-4">
          <div>
            <label className="text-xs font-medium text-gray-700">Nombre</label>
            <input required value={otroForm.nombre} onChange={e => setOtroForm(f => ({ ...f, nombre: e.target.value }))} className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-700">Precio (CLP)</label>
            <input required type="number" min="0" value={otroForm.precio} onChange={e => setOtroForm(f => ({ ...f, precio: e.target.value }))} className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
          <button type="submit" className="w-full bg-indigo-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-indigo-700">Guardar</button>
        </form>
      </Modal>

      <Modal open={showProdModal} onClose={() => setShowProdModal(false)} title="Agregar producto">
        <form onSubmit={async e => {
          e.preventDefault()
          await post('/api/productos', { nombre: prodForm.nombre, precio: parseInt(prodForm.precio) })
          setShowProdModal(false)
          setProdForm({ nombre: '', precio: '' })
        }} className="space-y-4">
          <div>
            <label className="text-xs font-medium text-gray-700">Nombre</label>
            <input required value={prodForm.nombre} onChange={e => setProdForm(f => ({ ...f, nombre: e.target.value }))} className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-700">Precio (CLP)</label>
            <input required type="number" min="0" value={prodForm.precio} onChange={e => setProdForm(f => ({ ...f, precio: e.target.value }))} className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
          <button type="submit" className="w-full bg-indigo-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-indigo-700">Guardar</button>
        </form>
      </Modal>
    </div>
  )
}

function TablaPrecios({ tramos, tipo, onUpdate }: { tramos: Tramo[]; tipo: string; onUpdate: () => void }) {
  const [editCell, setEditCell] = useState<{ id: string; campo: string; valor: string } | null>(null)

  async function saveCell() {
    if (!editCell) return
    await fetch(`/api/precios?tipo=${tipo}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: editCell.id, [editCell.campo]: editCell.valor }),
    })
    setEditCell(null)
    onUpdate()
  }

  const campos = [
    { key: 'peso_min', label: 'Peso mín' },
    { key: 'peso_max', label: 'Peso máx' },
    { key: 'precio_ci', label: 'CI' },
    { key: 'precio_cp', label: 'CP' },
    { key: 'precio_sd', label: 'SD' },
  ]

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-100">
        <h2 className="font-semibold text-gray-900">{tipo === 'convenio' ? 'Precios convenio' : 'Precios generales'}</h2>
      </div>
      <table className="w-full text-sm">
        <thead className="bg-gray-50"><tr>{campos.map(c => <th key={c.key} className="text-left px-4 py-3 text-xs font-semibold text-gray-500">{c.label}</th>)}</tr></thead>
        <tbody className="divide-y divide-gray-50">
          {tramos.map(t => (
            <tr key={t.id}>
              {campos.map(c => {
                const isEditing = editCell?.id === t.id && editCell?.campo === c.key
                return (
                  <td key={c.key} className="px-4 py-2">
                    {isEditing ? (
                      <input
                        autoFocus
                        type="number"
                        value={editCell.valor}
                        onChange={e => setEditCell(ec => ec ? { ...ec, valor: e.target.value } : null)}
                        onBlur={saveCell}
                        onKeyDown={e => e.key === 'Enter' && saveCell()}
                        className="w-full border border-indigo-400 rounded px-2 py-1 text-sm focus:outline-none"
                      />
                    ) : (
                      <span
                        onClick={() => setEditCell({ id: t.id, campo: c.key, valor: (t as Record<string, string>)[c.key] })}
                        className="cursor-pointer hover:text-indigo-600 hover:underline"
                      >
                        {(t as Record<string, string>)[c.key]}
                      </span>
                    )}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="px-6 py-3 text-xs text-gray-400 border-t border-gray-50">Clic en cualquier celda para editar</p>
    </div>
  )
}
