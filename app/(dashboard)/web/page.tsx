'use client'
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { PageHeader, Card, Button, Tabs } from '@/components/ui/kit'
import { fmtPrecio } from '@/lib/format'
import { useAccionUnica } from '@/lib/use-accion-unica'
import { ColeccionEditor, type Campo } from '@/components/web/ColeccionEditor'

type Producto = { id: string; nombre: string; categoria: string; precio: string; foto_url: string; stock: string; activo: string; mostrar_web: string }
type Descuento = { id: string; nombre: string; tipo: string; valor: string; activo: string; foto_url: string; mostrar_web: string }

type Tab = 'productos' | 'descuentos' | 'servicios' | 'blog' | 'paginas'

const CAMPOS_SERVICIOS: Campo[] = [
  { name: 'nombre', label: 'Nombre del servicio', tipo: 'text', full: true },
  { name: 'resumen', label: 'Resumen corto', tipo: 'textarea', full: true, help: 'Una o dos líneas para la tarjeta del servicio.' },
  { name: 'descripcion', label: 'Descripción', tipo: 'markdown', full: true },
  { name: 'foto_url', label: 'Imagen', tipo: 'image' },
  { name: 'precio_desde', label: 'Precio "desde" (opcional)', tipo: 'text', placeholder: 'ej. 90.000' },
  { name: 'orden', label: 'Orden', tipo: 'number' },
  { name: 'publicado', label: 'Publicado en la web', tipo: 'toggle', full: true },
  { name: 'seo_titulo', label: 'SEO · Título', tipo: 'text', full: true },
  { name: 'seo_desc', label: 'SEO · Meta descripción', tipo: 'textarea', full: true },
]

const CAMPOS_BLOG: Campo[] = [
  { name: 'titulo', label: 'Título', tipo: 'text', full: true },
  { name: 'categoria', label: 'Categoría', tipo: 'text', placeholder: 'guías, actualizaciones…' },
  { name: 'autor', label: 'Autor', tipo: 'text' },
  { name: 'fecha', label: 'Fecha', tipo: 'date' },
  { name: 'extracto', label: 'Extracto', tipo: 'textarea', full: true, help: 'Resumen para el listado del blog.' },
  { name: 'contenido', label: 'Contenido', tipo: 'markdown', full: true },
  { name: 'foto_url', label: 'Portada', tipo: 'image' },
  { name: 'publicado', label: 'Publicado en la web', tipo: 'toggle', full: true },
  { name: 'seo_titulo', label: 'SEO · Título', tipo: 'text', full: true },
  { name: 'seo_desc', label: 'SEO · Meta descripción', tipo: 'textarea', full: true },
]

const CAMPOS_PAGINAS: Campo[] = [
  { name: 'pagina', label: 'Página', tipo: 'select', full: true, opciones: [
    { value: 'home', label: 'Inicio' },
    { value: 'nosotros', label: 'Nosotros' },
    { value: 'convenios', label: 'Convenios' },
    { value: 'contacto', label: 'Contacto' },
    { value: 'eutanasia', label: 'Eutanasia' },
  ] },
  { name: 'clave', label: 'Identificador del bloque', tipo: 'text', help: 'ej. hero, mision, cta (único por página).' },
  { name: 'orden', label: 'Orden', tipo: 'number' },
  { name: 'titulo', label: 'Título del bloque', tipo: 'text', full: true },
  { name: 'contenido', label: 'Texto', tipo: 'markdown', full: true },
  { name: 'foto_url', label: 'Imagen', tipo: 'image' },
]

// Un producto se muestra en la web salvo que lo apaguemos explícitamente (nuevos = visibles).
const prodVisible = (p: Producto) => p.mostrar_web !== 'FALSE'
// Un descuento/convenio se muestra solo si lo prendemos (opt-in).
const descVisible = (d: Descuento) => d.mostrar_web === 'TRUE'
const agotado = (p: Producto) => !(parseInt(p.stock || '0', 10) > 0)
const inactivo = (r: { activo: string }) => r.activo === 'FALSE'

function Switch({ on, disabled, onClick }: { on: boolean; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={onClick}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${on ? 'bg-brand' : 'bg-gray-300'}`}
    >
      <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${on ? 'translate-x-5' : 'translate-x-0.5'}`} />
    </button>
  )
}

export default function WebPage() {
  const [tab, setTab] = useState<Tab>('productos')
  const [productos, setProductos] = useState<Producto[]>([])
  const [descuentos, setDescuentos] = useState<Descuento[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const { ejecutar, procesando } = useAccionUnica()

  async function cargar() {
    setLoading(true)
    try {
      const r = await fetch('/api/web', { cache: 'no-store' })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'Error')
      setProductos(Array.isArray(d.productos) ? d.productos : [])
      setDescuentos(Array.isArray(d.descuentos) ? d.descuentos : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { cargar() }, [])

  async function toggleProducto(p: Producto) {
    const nuevo = !prodVisible(p)
    setProductos(prev => prev.map(x => x.id === p.id ? { ...x, mostrar_web: nuevo ? 'TRUE' : 'FALSE' } : x))
    await ejecutar(async () => {
      const r = await fetch('/api/web', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ entidad: 'producto', id: p.id, mostrar_web: nuevo }) })
      if (!r.ok) { await cargar() }
    })
  }

  async function toggleDescuento(d: Descuento) {
    const nuevo = !descVisible(d)
    setDescuentos(prev => prev.map(x => x.id === d.id ? { ...x, mostrar_web: nuevo ? 'TRUE' : 'FALSE' } : x))
    await ejecutar(async () => {
      const r = await fetch('/api/web', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ entidad: 'descuento', id: d.id, mostrar_web: nuevo }) })
      if (!r.ok) { await cargar() }
    })
  }

  async function subirFotoDescuento(d: Descuento, file: File) {
    await ejecutar(async () => {
      const fd = new FormData()
      fd.append('file', file)
      const up = await fetch('/api/upload', { method: 'POST', body: fd })
      const uj = await up.json()
      if (!up.ok) { setError(uj.error || 'No se pudo subir la imagen'); return }
      const r = await fetch('/api/web', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ entidad: 'descuento', id: d.id, foto_url: uj.url }) })
      if (r.ok) setDescuentos(prev => prev.map(x => x.id === d.id ? { ...x, foto_url: uj.url } : x))
    })
  }

  // Productos agrupados por categoría (para mostrarlos como en la web).
  const porCategoria = useMemo(() => {
    const map = new Map<string, Producto[]>()
    for (const p of productos) {
      const cat = (p.categoria || 'Sin categoría').trim() || 'Sin categoría'
      if (!map.has(cat)) map.set(cat, [])
      map.get(cat)!.push(p)
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]))
  }, [productos])

  const visiblesEnWeb = productos.filter(p => prodVisible(p) && !inactivo(p)).length

  return (
    <div className="space-y-5">
      <PageHeader
        title="Web"
        subtitle="Panel del sitio público — controla qué se muestra en crematorioalmaanimal.cl"
        icon={<span className="text-3xl">🌐</span>}
      />

      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        tabs={[
          { key: 'productos', label: `🏺 Productos (${visiblesEnWeb})` },
          { key: 'descuentos', label: `🤝 Convenios (${descuentos.filter(descVisible).length})` },
          { key: 'servicios', label: '🔥 Servicios' },
          { key: 'blog', label: '📝 Blog' },
          { key: 'paginas', label: '📄 Páginas' },
        ]}
      />

      {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-600">{error}</div>}
      {tab === 'servicios' ? (
        <ColeccionEditor
          endpoint="/api/web/servicios"
          campos={CAMPOS_SERVICIOS}
          tituloCampo="nombre" subtituloCampo="resumen" imagenCampo="foto_url" publicarCampo="publicado"
          nuevoLabel="Nuevo servicio" vacioLabel="Aún no hay servicios cargados."
          ayuda="Los servicios que se muestran en la web (cremación individual, premium, sin devolución, eutanasia). Marca «Publicado» para que aparezca."
        />
      ) : tab === 'blog' ? (
        <ColeccionEditor
          endpoint="/api/web/posts"
          campos={CAMPOS_BLOG}
          tituloCampo="titulo" subtituloCampo="categoria" imagenCampo="foto_url" publicarCampo="publicado"
          nuevoLabel="Nuevo artículo" vacioLabel="Aún no hay artículos en el blog."
          ayuda="Artículos del blog. Se guardan como borrador hasta que marques «Publicado»."
        />
      ) : tab === 'paginas' ? (
        <ColeccionEditor
          endpoint="/api/web/paginas"
          campos={CAMPOS_PAGINAS}
          tituloCampo="titulo" subtituloCampo="clave" imagenCampo="foto_url" grupoCampo="pagina"
          nuevoLabel="Nuevo bloque" vacioLabel="Aún no hay bloques de texto cargados."
          ayuda="Los textos e imágenes editables de las páginas fijas (Inicio, Nosotros, Convenios, Contacto, Eutanasia). Cada bloque tiene un identificador único por página."
        />
      ) : loading ? (
        <Card className="p-8 text-center text-gray-400 text-sm">Cargando…</Card>
      ) : tab === 'productos' ? (
        <div className="space-y-4">
          <Card className="p-4 flex items-start gap-3 bg-cream">
            <span className="text-xl">💡</span>
            <div className="text-sm text-gray-600">
              El catálogo de la web es un <b>espejo de tu Bodega</b>. Los productos se crean y editan en{' '}
              <Link href="/configuracion" className="text-brand-soft font-semibold underline">Configuración → Bodega</Link>{' '}
              (nombre, foto, precio, stock). Acá solo decides <b>cuáles se muestran</b> en la web. Un producto sin stock aparece con el sello <b>Agotado</b>; el precio publicado es el de lista de Bodega.
            </div>
          </Card>

          {productos.length === 0 ? (
            <Card className="p-8 text-center text-gray-400 text-sm">Aún no hay productos en Bodega.</Card>
          ) : porCategoria.map(([cat, items]) => (
            <Card key={cat} className="overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-200 bg-gray-50">
                <h3 className="font-bold text-brand">{cat}</h3>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 p-4">
                {items.map(p => {
                  const visible = prodVisible(p) && !inactivo(p)
                  return (
                    <div key={p.id} className={`rounded-xl border border-gray-300 overflow-hidden transition-opacity ${visible ? '' : 'opacity-60'}`}>
                      <div className="relative aspect-[4/3] bg-gray-100">
                        {p.foto_url
                          // eslint-disable-next-line @next/next/no-img-element
                          ? <img src={p.foto_url} alt={p.nombre} className="w-full h-full object-cover" />
                          : <div className="w-full h-full flex items-center justify-center text-gray-300 text-3xl">🏺</div>}
                        {agotado(p) && (
                          <span className="absolute top-2 left-2 rounded-full bg-gray-900/80 text-white text-[11px] font-bold px-2 py-0.5">Agotado</span>
                        )}
                      </div>
                      <div className="p-3">
                        <div className="font-semibold text-gray-800 text-sm truncate">{p.nombre}</div>
                        <div className="text-brand font-bold text-sm mt-0.5">{fmtPrecio(p.precio)}</div>
                        {inactivo(p) && <div className="text-[11px] text-amber-600 mt-1">Inactivo en Bodega (no se muestra)</div>}
                        <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-100">
                          <span className="text-xs text-gray-500">Mostrar en la web</span>
                          <Switch on={prodVisible(p)} disabled={procesando || inactivo(p)} onClick={() => toggleProducto(p)} />
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <div className="space-y-4">
          <Card className="p-4 flex items-start gap-3 bg-cream">
            <span className="text-xl">💡</span>
            <div className="text-sm text-gray-600">
              Estos son tus <b>convenios/descuentos</b> (de{' '}
              <Link href="/configuracion" className="text-brand-soft font-semibold underline">Configuración → Descuentos</Link>).
              Súbeles un <b>logo/imagen</b> y actívalos para mostrarlos en la web. Por defecto están ocultos hasta que los prendas.
            </div>
          </Card>

          {descuentos.length === 0 ? (
            <Card className="p-8 text-center text-gray-400 text-sm">Aún no hay convenios cargados.</Card>
          ) : (
            <Card className="divide-y divide-gray-200">
              {descuentos.map(d => (
                <div key={d.id} className="flex items-center gap-4 p-4">
                  <div className="w-16 h-16 shrink-0 rounded-lg border border-gray-300 bg-gray-50 overflow-hidden flex items-center justify-center">
                    {d.foto_url
                      // eslint-disable-next-line @next/next/no-img-element
                      ? <img src={d.foto_url} alt={d.nombre} className="w-full h-full object-contain" />
                      : <span className="text-gray-300 text-2xl">🏥</span>}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-gray-800 truncate">{d.nombre}</div>
                    <div className="text-xs text-gray-500">
                      {d.tipo === 'fijo' ? `${fmtPrecio(d.valor)} de descuento` : `${d.valor}% de descuento`}
                      {inactivo(d) && <span className="text-amber-600"> · inactivo</span>}
                    </div>
                    <label className="inline-flex items-center gap-1.5 mt-2 text-xs text-brand-soft font-semibold cursor-pointer hover:underline">
                      <span>📷 {d.foto_url ? 'Cambiar logo' : 'Subir logo'}</span>
                      <input type="file" accept="image/*" className="hidden" disabled={procesando}
                        onChange={e => { const f = e.target.files?.[0]; if (f) subirFotoDescuento(d, f); e.target.value = '' }} />
                    </label>
                  </div>
                  <div className="flex flex-col items-center gap-1 shrink-0">
                    <Switch on={descVisible(d)} disabled={procesando} onClick={() => toggleDescuento(d)} />
                    <span className="text-[10px] text-gray-400">{descVisible(d) ? 'En la web' : 'Oculto'}</span>
                  </div>
                </div>
              ))}
            </Card>
          )}
        </div>
      )}
    </div>
  )
}
