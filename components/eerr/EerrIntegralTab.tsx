'use client'
import { useEffect, useState } from 'react'
import { fmtNumero, fmtPrecio } from '@/lib/format'
import { todayISO, formatDate } from '@/lib/dates'

interface Fila { nombre: string; valores: number[]; subgrupo: string; sgOrden: number; partida_id: string; tipo: string; clave: string }
interface Data { periodos: { key: string; label: string }[]; ingresos: Fila[]; costos: Fila[]; gastos: Fila[]; impuestos: Fila[] }
type Drill = { partida_id: string; nombre: string; periodo: string; label: string }

export default function EerrIntegralTab() {
  const [modo, setModo] = useState<'meses12' | 'mes' | 'anio'>('meses12')
  const [mes, setMes] = useState(todayISO().slice(0, 7))
  const [anio, setAnio] = useState(todayISO().slice(0, 4))
  const [data, setData] = useState<Data | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [drill, setDrill] = useState<Drill | null>(null)

  async function cargar() {
    try {
      const q = new URLSearchParams()
      if (modo === 'mes' && mes) q.set('mes', mes)
      if (modo === 'anio' && anio) q.set('anio', anio)
      const r = await fetch(`/api/eerr/integral?${q.toString()}`)
      const d = await r.json()
      if (r.ok) { setData(d); setError('') } else setError(d?.error || 'No se pudo cargar')
    } catch { setError('Error de red') } finally { setLoading(false) }
  }
  useEffect(() => { cargar() }, [modo, mes, anio]) // eslint-disable-line react-hooks/exhaustive-deps

  const N = data?.periodos.length ?? 0
  const sumar = (filas: Fila[]) => { const o = new Array(N).fill(0); filas.forEach(f => f.valores.forEach((v, i) => { o[i] += v })); return o }
  const restar = (a: number[], b: number[]) => a.map((v, i) => v - (b[i] || 0))

  return (
    <div className="space-y-4">
      {/* Filtros */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex gap-2 flex-wrap">
          {([['meses12', 'Últimos 12 meses'], ['mes', 'Mes'], ['anio', 'Año']] as const).map(([k, label]) => (
            <button key={k} onClick={() => setModo(k)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${modo === k ? 'bg-brand text-white' : 'bg-white border border-gray-300 text-gray-600 hover:bg-gray-50'}`}>
              {label}
            </button>
          ))}
        </div>
        {modo === 'mes' && (
          <input type="month" value={mes} onChange={e => setMes(e.target.value)} className="border border-gray-300 rounded px-2 py-1.5 text-sm" />
        )}
        {modo === 'anio' && (
          <input type="number" value={anio} onChange={e => setAnio(e.target.value)} min="2020" max="2100" className="border border-gray-300 rounded px-2 py-1.5 text-sm w-24" />
        )}
      </div>

      {error && <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-2.5">{error}</p>}

      {loading || !data ? (
        <div className="text-gray-500 text-sm">Cargando…</div>
      ) : (() => {
        const totIng = sumar(data.ingresos)
        const totCos = sumar(data.costos)
        const margen = restar(totIng, totCos)
        const totGas = sumar(data.gastos)
        const rai = restar(margen, totGas)
        const totImp = sumar(data.impuestos)
        const resultado = restar(rai, totImp)
        // 12 meses → cifras en miles (entran sin scroll); 1 columna (mes/año) → pesos exactos.
        const enMiles = data.periodos.length > 1

        // Tabla financiera top-down: cada sección muestra su TÍTULO + TOTAL arriba
        // y el detalle debajo. Jerarquía de tamaños (de mayor a menor):
        //   section / accent / result  >  sgHead (subtotal)  >  item (detalle)
        type Kind = 'section' | 'accent' | 'result' | 'sgHead' | 'item' | 'loose'
        // Tamaño ÚNICO para TODAS las celdas (look ejecutivo): la jerarquía se da por
        // peso (bold/semibold/normal), color y banda de fondo — nunca por tamaños de
        // número distintos, que se ven disparejos.
        const SIZE = 'text-[13px]'
        const CFG: Record<Kind, { bg: string; text: string; weight: string; num: string; upper: string; top: string; indent: string }> = {
          section: { bg: 'bg-gray-100', text: 'text-gray-900', weight: 'font-bold', num: 'font-bold', upper: 'uppercase tracking-wide', top: 'border-t-2 border-t-gray-400', indent: 'pl-3' },
          accent: { bg: 'bg-brand/10', text: 'text-brand', weight: 'font-bold', num: 'font-bold', upper: '', top: 'border-t-2 border-t-brand/30', indent: 'pl-3' },
          result: { bg: 'bg-gray-900', text: 'text-white', weight: 'font-bold', num: 'font-bold', upper: 'uppercase tracking-wide', top: 'border-t-2 border-t-gray-700', indent: 'pl-3' },
          sgHead: { bg: 'bg-white', text: 'text-gray-700', weight: 'font-semibold', num: 'font-semibold', upper: '', top: 'border-t border-t-gray-200', indent: 'pl-6' },
          item: { bg: 'bg-white', text: 'text-gray-500', weight: 'font-normal', num: 'font-normal', upper: '', top: '', indent: 'pl-10' },
          loose: { bg: 'bg-white', text: 'text-gray-500', weight: 'font-normal', num: 'font-normal', upper: '', top: '', indent: 'pl-6' },
        }
        const row = (key: string, label: string, vals: number[], kind: Kind, partidaId?: string) => {
          const c = CFG[kind]
          const base = `border border-gray-300 px-2 py-1.5 ${SIZE} ${c.bg} ${c.text} ${c.top}`
          const neg = (v: number) => v < 0 && (kind === 'accent' || kind === 'result')
          const drillable = !!partidaId && (kind === 'item' || kind === 'loose')
          return (
            <tr key={key}>
              <td className={`${base} ${c.weight} ${c.upper} text-left whitespace-nowrap sticky left-0 border-r-2 border-r-gray-300 pr-3 ${c.indent}`}>{label}</td>
              {vals.map((v, i) => {
                const n = enMiles ? Math.round(v / 1000) : Math.round(v)
                const click = drillable && v !== 0
                return (
                  <td key={i}
                    onClick={click ? () => setDrill({ partida_id: partidaId!, nombre: label, periodo: data.periodos[i].key, label: data.periodos[i].label }) : undefined}
                    title={click ? 'Ver detalle de la cuenta' : undefined}
                    className={`${base} ${c.num} text-center tabular-nums whitespace-nowrap ${neg(v) ? (kind === 'result' ? 'text-red-300' : 'text-red-600') : ''} ${click ? 'cursor-pointer hover:bg-brand/10 hover:text-brand hover:underline' : ''}`}>
                    {n === 0 ? <span className={kind === 'result' ? 'text-gray-600' : 'text-gray-300'}>—</span> : (enMiles ? fmtNumero(n) : fmtPrecio(n))}
                  </td>
                )
              })}
            </tr>
          )
        }

        // Una sección (ingresos/costos/…): título + total ARRIBA y debajo el
        // detalle; cada subgrupo muestra su subtotal arriba de sus partidas.
        const renderSection = (titulo: string, filas: Fila[], total: number[], pre: string) => {
          const out: React.ReactNode[] = [row(`${pre}-head`, titulo, total, 'section')]
          let i = 0
          while (i < filas.length) {
            const sg = filas[i].subgrupo
            if (sg) {
              const block: Fila[] = []
              while (i < filas.length && filas[i].subgrupo === sg) { block.push(filas[i]); i++ }
              const sub = block.reduce((acc, f) => acc.map((v, k) => v + (f.valores[k] || 0)), new Array(N).fill(0) as number[])
              out.push(row(`${pre}-sg-${sg}`, sg, sub, 'sgHead'))
              block.forEach((f, k) => out.push(row(`${pre}-${sg}-${k}`, f.nombre, f.valores, 'item', f.partida_id)))
            } else {
              out.push(row(`${pre}-l-${i}`, filas[i].nombre, filas[i].valores, 'loose', filas[i].partida_id))
              i++
            }
          }
          return out
        }

        return (
          <div>
            {enMiles && <p className="text-xs font-medium text-gray-500 mb-2">Cifras en <strong className="text-gray-700">miles de $</strong> (CLP). Filtrá un mes o un año para ver pesos exactos.</p>}
            <div className="bg-white rounded-xl border border-gray-300 overflow-x-auto shadow-md">
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-gray-800 text-gray-100 text-xs uppercase">
                  <th className="border border-gray-700 px-2 py-3 text-left font-semibold sticky left-0 bg-gray-800 border-r-2 border-r-gray-600 z-10 pr-3 tracking-wide">Concepto</th>
                  {data.periodos.map(p => <th key={p.key} className="border border-gray-700 px-2 py-3 text-center font-semibold whitespace-nowrap">{p.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {renderSection('Ingresos', data.ingresos, totIng, 'ing')}
                {renderSection('Costos', data.costos, totCos, 'cos')}
                {row('margen', 'Margen Operacional', margen, 'accent')}
                {renderSection('Gastos', data.gastos, totGas, 'gas')}
                {row('rai', 'Resultado Antes de Impuestos', rai, 'accent')}
                {renderSection('Impuestos', data.impuestos, totImp, 'imp')}
                {row('res', 'Resultado del Ejercicio', resultado, 'result')}
              </tbody>
            </table>
            </div>
          </div>
        )
      })()}

      <p className="text-xs text-gray-400">
        Ingresos en neto (÷1,19), reconocidos por fecha de retiro. Costos y gastos en neto, por la fecha del documento/gasto.
        <span className="text-gray-300"> · Tip: hacé clic en cualquier monto para ver su detalle.</span>
      </p>

      {drill && <MovimientosPanel drill={drill} onClose={() => setDrill(null)} />}
    </div>
  )
}

interface Mov { fecha: string; fuente: string; descripcion: string; proveedor: string; documento: string; monto: number }
const FUENTE_CLS: Record<string, string> = {
  'Factura SII': 'bg-brand/10 text-brand', 'Manual': 'bg-amber-100 text-amber-700',
  'Rendición': 'bg-sky-100 text-sky-700', 'Ficha': 'bg-emerald-100 text-emerald-700',
}

function MovimientosPanel({ drill, onClose }: { drill: Drill; onClose: () => void }) {
  const [todos, setTodos] = useState(false)
  const [movs, setMovs] = useState<Mov[]>([])
  const [loading, setLoading] = useState(true)
  const [buscar, setBuscar] = useState('')
  const [fuente, setFuente] = useState('')
  const [sortBy, setSortBy] = useState<'fecha' | 'fuente' | 'descripcion' | 'proveedor' | 'monto'>('fecha')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  useEffect(() => {
    setLoading(true)
    const q = new URLSearchParams({ partida_id: drill.partida_id })
    if (!todos) q.set('periodo', drill.periodo)
    fetch(`/api/eerr/movimientos?${q.toString()}`)
      .then(r => r.json())
      .then(d => setMovs(Array.isArray(d?.movimientos) ? d.movimientos : []))
      .catch(() => setMovs([]))
      .finally(() => setLoading(false))
  }, [drill, todos])

  const bl = buscar.trim().toLowerCase()
  const filt = movs.filter(m => (!fuente || m.fuente === fuente) && (!bl || `${m.descripcion} ${m.proveedor} ${m.documento}`.toLowerCase().includes(bl)))
  const sorted = [...filt].sort((a, b) => {
    const va = a[sortBy], vb = b[sortBy]
    const cmp = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb))
    return sortDir === 'asc' ? cmp : -cmp
  })
  const total = filt.reduce((s, m) => s + m.monto, 0)
  const toggleSort = (col: typeof sortBy) => {
    if (sortBy === col) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortBy(col); setSortDir(col === 'monto' || col === 'fecha' ? 'desc' : 'asc') }
  }
  const th = (col: typeof sortBy, label: string, align: 'left' | 'right' = 'left') => (
    <th onClick={() => toggleSort(col)} className={`px-3 py-2 font-medium cursor-pointer select-none hover:text-gray-700 whitespace-nowrap ${align === 'right' ? 'text-right' : 'text-left'}`}>
      {label}{sortBy === col ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}
    </th>
  )

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex justify-end" onClick={onClose}>
      <div className="bg-white w-full max-w-2xl h-full flex flex-col shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="border-b border-gray-300 px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="font-bold text-gray-900">{drill.nombre}</h3>
              <p className="text-xs text-gray-500 mt-0.5">{todos ? 'Todos los períodos' : drill.label} · {filt.length} movimiento(s) · <strong className="text-gray-700">{fmtPrecio(total)}</strong></p>
            </div>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-2xl leading-none">×</button>
          </div>
          <div className="flex flex-wrap items-center gap-2 mt-3">
            <input value={buscar} onChange={e => setBuscar(e.target.value)} placeholder="Buscar detalle, proveedor, doc…" className="border border-gray-300 rounded px-2 py-1.5 text-sm w-52" />
            <select value={fuente} onChange={e => setFuente(e.target.value)} className="border border-gray-300 rounded px-2 py-1.5 text-sm">
              <option value="">Todas las fuentes</option>
              <option>Factura SII</option><option>Manual</option><option>Rendición</option><option>Ficha</option>
            </select>
            <label className="flex items-center gap-1.5 text-sm text-gray-600 ml-auto cursor-pointer">
              <input type="checkbox" checked={todos} onChange={e => setTodos(e.target.checked)} /> Todos los períodos
            </label>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-8 text-gray-400 text-sm">Cargando…</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-500 text-xs uppercase sticky top-0">
                <tr>{th('fecha', 'Fecha')}{th('fuente', 'Fuente')}{th('descripcion', 'Detalle')}{th('proveedor', 'Proveedor')}{th('monto', 'Monto', 'right')}</tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {sorted.map((m, i) => (
                  <tr key={i} className="hover:bg-gray-50">
                    <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{formatDate(m.fecha)}</td>
                    <td className="px-3 py-2"><span className={`text-[11px] px-1.5 py-0.5 rounded ${FUENTE_CLS[m.fuente] || 'bg-gray-100 text-gray-600'}`}>{m.fuente}</span></td>
                    <td className="px-3 py-2 text-gray-800 max-w-[240px] truncate" title={`${m.descripcion}${m.documento ? ' · ' + m.documento : ''}`}>
                      {m.descripcion || '—'}{m.documento && <span className="text-gray-400 text-xs"> · {m.documento}</span>}
                    </td>
                    <td className="px-3 py-2 text-gray-500 whitespace-nowrap max-w-[140px] truncate" title={m.proveedor}>{m.proveedor || '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap text-gray-800">{fmtPrecio(m.monto)}</td>
                  </tr>
                ))}
                {sorted.length === 0 && <tr><td colSpan={5} className="px-4 py-10 text-center text-gray-400 text-sm">Sin movimientos.</td></tr>}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
