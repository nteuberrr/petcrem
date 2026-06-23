'use client'
import { useEffect, useState } from 'react'
import { fmtNumero, fmtPrecio } from '@/lib/format'
import { todayISO } from '@/lib/dates'

interface Fila { nombre: string; valores: number[]; subgrupo: string; sgOrden: number }
interface Data { periodos: { key: string; label: string }[]; ingresos: Fila[]; costos: Fila[]; gastos: Fila[]; impuestos: Fila[] }

export default function EerrIntegralTab() {
  const [modo, setModo] = useState<'meses12' | 'mes' | 'anio'>('meses12')
  const [mes, setMes] = useState(todayISO().slice(0, 7))
  const [anio, setAnio] = useState(todayISO().slice(0, 4))
  const [data, setData] = useState<Data | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

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
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${modo === k ? 'bg-indigo-600 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
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

        // Una fila del estado de resultados (grilla con bordes, números centrados).
        // 'sghead' = nombre del subgrupo (sin números, es un rótulo); 'subsub' =
        // SUBTOTAL del subgrupo; 'itemSg' = partida dentro de un subgrupo (indentada).
        type Kind = 'item' | 'itemSg' | 'sghead' | 'subsub' | 'subtotal' | 'accent' | 'result'
        const row = (key: string, label: string, vals: number[], kind: Kind) => {
          const esItem = kind === 'item' || kind === 'itemSg'
          const bg = kind === 'result' ? 'bg-gray-900' : kind === 'accent' ? 'bg-indigo-50' : kind === 'subtotal' ? 'bg-gray-100' : kind === 'sghead' ? 'bg-gray-50' : 'bg-white'
          const text = kind === 'result' ? 'text-white' : esItem ? 'text-gray-600' : 'text-gray-900'
          const bold = esItem ? '' : 'font-semibold'
          const top = (kind === 'subtotal' || kind === 'accent' || kind === 'result') ? 'border-t-2 border-t-gray-300' : (kind === 'sghead' || kind === 'subsub') ? 'border-t border-t-gray-200' : ''
          const indent = kind === 'itemSg' ? 'pl-8' : kind === 'item' ? 'pl-5' : kind === 'subsub' ? 'pl-5' : kind === 'sghead' ? 'pl-3' : ''
          const base = `border border-gray-200 px-2 py-1.5 ${bg} ${text} ${bold} ${top}`
          const conInRojo = (v: number) => v < 0 && (kind === 'accent' || kind === 'result')
          return (
            <tr key={key}>
              <td className={`${base} text-left whitespace-nowrap sticky left-0 border-r-2 border-r-gray-300 pr-3 ${indent} ${esItem ? 'font-normal' : ''}`}>{kind === 'sghead' ? `▸ ${label}` : label}</td>
              {vals.map((v, i) => {
                if (kind === 'sghead') return <td key={i} className={base}></td>
                const n = enMiles ? Math.round(v / 1000) : Math.round(v)
                return (
                  <td key={i} className={`${base} text-center tabular-nums whitespace-nowrap ${conInRojo(v) ? (kind === 'result' ? 'text-red-300' : 'text-red-600') : ''}`}>
                    {n === 0 ? <span className={kind === 'result' ? 'text-gray-500' : 'text-gray-300'}>—</span> : (enMiles ? fmtNumero(n) : fmtPrecio(n))}
                  </td>
                )
              })}
            </tr>
          )
        }

        // Renderiza un grupo (ingresos/costos/…): cada subgrupo va como rótulo +
        // sus partidas + una fila "Subtotal X"; las sueltas (sin subgrupo) directas.
        const renderGrupo = (filas: Fila[], pre: string) => {
          const out: React.ReactNode[] = []
          let i = 0
          while (i < filas.length) {
            const sg = filas[i].subgrupo
            if (sg) {
              const block: Fila[] = []
              while (i < filas.length && filas[i].subgrupo === sg) { block.push(filas[i]); i++ }
              const sub = block.reduce((acc, f) => acc.map((v, k) => v + (f.valores[k] || 0)), new Array(N).fill(0) as number[])
              out.push(row(`${pre}-h-${sg}`, sg, sub, 'sghead'))
              block.forEach((f, k) => out.push(row(`${pre}-${sg}-${k}`, f.nombre, f.valores, 'itemSg')))
              out.push(row(`${pre}-st-${sg}`, `Subtotal ${sg}`, sub, 'subsub'))
            } else {
              out.push(row(`${pre}-s-${i}`, filas[i].nombre, filas[i].valores, 'item'))
              i++
            }
          }
          return out
        }

        return (
          <div>
            {enMiles && <p className="text-xs font-medium text-gray-500 mb-2">Cifras en <strong className="text-gray-700">miles de $</strong> (CLP). Filtrá un mes o un año para ver pesos exactos.</p>}
            <div className="bg-white rounded-xl border border-gray-300 overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-gray-100 text-gray-600 text-xs uppercase">
                  <th className="border border-gray-200 px-2 py-2.5 text-left font-semibold sticky left-0 bg-gray-100 border-r-2 border-r-gray-300 z-10 pr-3">Concepto</th>
                  {data.periodos.map(p => <th key={p.key} className="border border-gray-200 px-2 py-2.5 text-center font-semibold whitespace-nowrap">{p.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {renderGrupo(data.ingresos, 'ing')}
                {row('totIng', 'Total Ingresos', totIng, 'subtotal')}
                {renderGrupo(data.costos, 'cos')}
                {row('totCos', 'Total Costo', totCos, 'subtotal')}
                {row('margen', 'Margen Operacional', margen, 'accent')}
                {renderGrupo(data.gastos, 'gas')}
                {row('totGas', 'Total Gasto', totGas, 'subtotal')}
                {row('rai', 'Resultado Antes de Impuestos', rai, 'accent')}
                {renderGrupo(data.impuestos, 'imp')}
                {row('res', 'Resultado del Ejercicio', resultado, 'result')}
              </tbody>
            </table>
            </div>
          </div>
        )
      })()}

      <p className="text-xs text-gray-400">
        Ingresos en neto (÷1,19), reconocidos por fecha de retiro. Costos y gastos en neto, por la fecha del documento/gasto.
      </p>
    </div>
  )
}
