'use client'
import { useEffect, useMemo, useState } from 'react'
import { Card, Button } from '@/components/ui/kit'
import { useAccionUnica } from '@/lib/use-accion-unica'

export type CampoTipo = 'text' | 'textarea' | 'markdown' | 'number' | 'image' | 'toggle' | 'select' | 'date'
export type Campo = {
  name: string
  label: string
  tipo: CampoTipo
  opciones?: { value: string; label: string }[]
  placeholder?: string
  help?: string
  full?: boolean
}
type Item = Record<string, string>

export function ColeccionEditor({
  endpoint, campos, tituloCampo, subtituloCampo, imagenCampo, publicarCampo, grupoCampo,
  nuevoLabel, vacioLabel, ayuda,
}: {
  endpoint: string
  campos: Campo[]
  tituloCampo: string
  subtituloCampo?: string
  imagenCampo?: string
  publicarCampo?: string
  grupoCampo?: string
  nuevoLabel: string
  vacioLabel: string
  ayuda?: string
}) {
  const [items, setItems] = useState<Item[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [form, setForm] = useState<Item | null>(null) // null = modal cerrado
  const { ejecutar, procesando } = useAccionUnica()

  async function cargar() {
    setLoading(true)
    try {
      const r = await fetch(endpoint, { cache: 'no-store' })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'Error')
      setItems(Array.isArray(d) ? d : [])
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setLoading(false) }
  }
  useEffect(() => { cargar() }, [endpoint])

  async function guardar() {
    if (!form) return
    await ejecutar(async () => {
      const esNuevo = !form.id
      const r = await fetch(endpoint, {
        method: esNuevo ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) { setError(d.error || 'No se pudo guardar'); return }
      setError(''); setForm(null); await cargar()
    })
  }

  async function eliminar(it: Item) {
    if (!confirm('¿Eliminar este elemento? No se puede deshacer.')) return
    await ejecutar(async () => {
      const r = await fetch(`${endpoint}?id=${encodeURIComponent(it.id)}`, { method: 'DELETE' })
      if (r.ok) setItems(prev => prev.filter(x => x.id !== it.id))
    })
  }

  async function togglePublicar(it: Item) {
    if (!publicarCampo) return
    const nuevo = it[publicarCampo] === 'TRUE' ? 'FALSE' : 'TRUE'
    setItems(prev => prev.map(x => x.id === it.id ? { ...x, [publicarCampo]: nuevo } : x))
    await ejecutar(async () => {
      const r = await fetch(endpoint, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: it.id, [publicarCampo]: nuevo }) })
      if (!r.ok) await cargar()
    })
  }

  async function subirImagen(name: string, file: File) {
    await ejecutar(async () => {
      const fd = new FormData(); fd.append('file', file)
      const up = await fetch('/api/upload', { method: 'POST', body: fd })
      const uj = await up.json()
      if (!up.ok) { setError(uj.error || 'No se pudo subir la imagen'); return }
      setForm(f => (f ? { ...f, [name]: uj.url } : f))
    })
  }

  const grupos = useMemo(() => {
    if (!grupoCampo) return [['', items] as [string, Item[]]]
    const map = new Map<string, Item[]>()
    for (const it of items) {
      const g = (it[grupoCampo] || '—').trim() || '—'
      if (!map.has(g)) map.set(g, [])
      map.get(g)!.push(it)
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]))
  }, [items, grupoCampo])

  const setF = (name: string, value: string) => setForm(f => (f ? { ...f, [name]: value } : f))

  return (
    <div className="space-y-4">
      {ayuda && (
        <Card className="p-4 flex items-start gap-3 bg-cream">
          <span className="text-xl">💡</span>
          <div className="text-sm text-gray-600">{ayuda}</div>
        </Card>
      )}
      <div className="flex justify-end">
        <Button variant="primary" onClick={() => { setError(''); setForm({}) }}>+ {nuevoLabel}</Button>
      </div>
      {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-600">{error}</div>}

      {loading ? (
        <Card className="p-8 text-center text-gray-400 text-sm">Cargando…</Card>
      ) : items.length === 0 ? (
        <Card className="p-8 text-center text-gray-400 text-sm">{vacioLabel}</Card>
      ) : grupos.map(([g, its]) => (
        <Card key={g || 'all'} className="overflow-hidden">
          {grupoCampo && <div className="px-5 py-3 border-b border-gray-200 bg-gray-50"><h3 className="font-bold text-brand capitalize">{g}</h3></div>}
          <div className="divide-y divide-gray-100">
            {its.map(it => (
              <div key={it.id} className="flex items-center gap-4 p-4">
                {imagenCampo && (
                  <div className="w-14 h-14 shrink-0 rounded-lg border border-gray-300 bg-gray-50 overflow-hidden flex items-center justify-center">
                    {it[imagenCampo]
                      // eslint-disable-next-line @next/next/no-img-element
                      ? <img src={it[imagenCampo]} alt="" className="w-full h-full object-cover" />
                      : <span className="text-gray-300 text-xl">🖼️</span>}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-gray-800 truncate">{it[tituloCampo] || <span className="text-gray-400">(sin título)</span>}</div>
                  {subtituloCampo && it[subtituloCampo] && <div className="text-xs text-gray-500 truncate">{it[subtituloCampo]}</div>}
                </div>
                {publicarCampo && (
                  <button onClick={() => togglePublicar(it)} disabled={procesando}
                    className={`text-[11px] font-bold px-2 py-1 rounded-full shrink-0 ${it[publicarCampo] === 'TRUE' ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                    {it[publicarCampo] === 'TRUE' ? 'Publicado' : 'Borrador'}
                  </button>
                )}
                <div className="flex items-center gap-1 shrink-0">
                  <Button variant="secondary" onClick={() => { setError(''); setForm({ ...it }) }}>Editar</Button>
                  <Button variant="danger" onClick={() => eliminar(it)} disabled={procesando}>Eliminar</Button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      ))}

      {form && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center overflow-y-auto p-4" onClick={() => setForm(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl my-8" onClick={e => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <h3 className="font-bold text-brand">{form.id ? 'Editar' : nuevoLabel}</h3>
              <button onClick={() => setForm(null)} aria-label="Cerrar" className="text-gray-400 hover:text-gray-700 text-xl">×</button>
            </div>
            <div className="p-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
              {campos.map(c => {
                const val = form[c.name] ?? ''
                const wrap = c.full ? 'sm:col-span-2' : ''
                if (c.tipo === 'toggle') {
                  return (
                    <label key={c.name} className={`flex items-center gap-2 ${wrap}`}>
                      <input type="checkbox" checked={val === 'TRUE'} onChange={e => setF(c.name, e.target.checked ? 'TRUE' : 'FALSE')} className="w-4 h-4 accent-brand" />
                      <span className="text-sm text-gray-700">{c.label}</span>
                    </label>
                  )
                }
                if (c.tipo === 'image') {
                  return (
                    <div key={c.name} className={wrap}>
                      <label className="block text-xs font-semibold text-gray-500 mb-1">{c.label}</label>
                      <div className="flex items-center gap-3">
                        <div className="w-16 h-16 rounded-lg border border-gray-300 bg-gray-50 overflow-hidden flex items-center justify-center shrink-0">
                          {val
                            // eslint-disable-next-line @next/next/no-img-element
                            ? <img src={val} alt="" className="w-full h-full object-cover" />
                            : <span className="text-gray-300 text-xl">🖼️</span>}
                        </div>
                        <label className="text-xs text-brand-soft font-semibold cursor-pointer hover:underline">
                          📷 {val ? 'Cambiar' : 'Subir'}
                          <input type="file" accept="image/*" className="hidden" disabled={procesando}
                            onChange={e => { const f = e.target.files?.[0]; if (f) subirImagen(c.name, f); e.target.value = '' }} />
                        </label>
                        {val && <button onClick={() => setF(c.name, '')} className="text-xs text-red-500 hover:underline">Quitar</button>}
                      </div>
                    </div>
                  )
                }
                if (c.tipo === 'select') {
                  return (
                    <div key={c.name} className={wrap}>
                      <label className="block text-xs font-semibold text-gray-500 mb-1">{c.label}</label>
                      <select value={val} onChange={e => setF(c.name, e.target.value)} className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm">
                        <option value="">—</option>
                        {(c.opciones || []).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                      {c.help && <p className="text-[11px] text-gray-400 mt-1">{c.help}</p>}
                    </div>
                  )
                }
                if (c.tipo === 'textarea' || c.tipo === 'markdown') {
                  return (
                    <div key={c.name} className={wrap}>
                      <label className="block text-xs font-semibold text-gray-500 mb-1">{c.label}{c.tipo === 'markdown' && <span className="text-gray-400 font-normal"> · Markdown</span>}</label>
                      <textarea value={val} onChange={e => setF(c.name, e.target.value)} placeholder={c.placeholder}
                        rows={c.tipo === 'markdown' ? 8 : 3}
                        className={`w-full rounded-xl border border-gray-300 px-3 py-2 text-sm ${c.tipo === 'markdown' ? 'font-mono' : ''}`} />
                      {c.help && <p className="text-[11px] text-gray-400 mt-1">{c.help}</p>}
                    </div>
                  )
                }
                return (
                  <div key={c.name} className={wrap}>
                    <label className="block text-xs font-semibold text-gray-500 mb-1">{c.label}</label>
                    <input type={c.tipo === 'number' ? 'number' : c.tipo === 'date' ? 'date' : 'text'} value={val}
                      onChange={e => setF(c.name, e.target.value)} placeholder={c.placeholder}
                      className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm" />
                    {c.help && <p className="text-[11px] text-gray-400 mt-1">{c.help}</p>}
                  </div>
                )
              })}
            </div>
            <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setForm(null)}>Cancelar</Button>
              <Button variant="primary" onClick={guardar} disabled={procesando}>{procesando ? 'Guardando…' : 'Guardar'}</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
