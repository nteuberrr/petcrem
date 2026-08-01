'use client'
import { useEffect, useMemo, useState } from 'react'
import { Card } from '@/components/ui/kit'
import { Badge } from '@/components/ui/Badge'
import { TableSkeleton } from '@/components/ui/Skeleton'
import { fmtPrecio, fmtFecha } from '@/lib/format'
import { nombrePeriodo } from './tipos-ui'

interface FilaHistorico {
  id: string
  periodo: string
  empleado_nombre: string
  estado: string
  cremaciones: number
  liquido: number
  reembolso_salud: number
  total_a_transferir: number
  costo_empresa: number
  fecha_pago: string
  pdf_url: string
}

export default function HistoricoTab() {
  const [filas, setFilas] = useState<FilaHistorico[] | null>(null)
  const [anio, setAnio] = useState<string>('')
  const [empleado, setEmpleado] = useState<string>('')

  useEffect(() => {
    fetch('/api/remuneraciones/liquidaciones', { cache: 'no-store' })
      .then(r => r.json())
      .then(d => setFilas(d.liquidaciones || []))
      .catch(() => setFilas([]))
  }, [])

  const anios = useMemo(
    () => Array.from(new Set((filas || []).map(f => f.periodo.slice(0, 4)))).sort().reverse(),
    [filas],
  )
  const empleados = useMemo(
    () => Array.from(new Set((filas || []).map(f => f.empleado_nombre))).sort(),
    [filas],
  )

  const visibles = useMemo(
    () => (filas || []).filter(f =>
      (!anio || f.periodo.startsWith(anio)) &&
      (!empleado || f.empleado_nombre === empleado)),
    [filas, anio, empleado],
  )

  // Costo empresa por período, para el gráfico.
  const porPeriodo = useMemo(() => {
    const m = new Map<string, number>()
    for (const f of visibles) m.set(f.periodo, (m.get(f.periodo) || 0) + f.costo_empresa)
    return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0]))
  }, [visibles])
  const maxCosto = Math.max(1, ...porPeriodo.map(([, v]) => v))

  const totales = useMemo(() => visibles.reduce(
    (a, f) => ({
      transferido: a.transferido + f.total_a_transferir,
      costo: a.costo + f.costo_empresa,
    }),
    { transferido: 0, costo: 0 },
  ), [visibles])

  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-end gap-3 p-4">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-gray-600">Año</span>
          <select value={anio} onChange={e => setAnio(e.target.value)} className="rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm">
            <option value="">Todos</option>
            {anios.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-gray-600">Empleado</span>
          <select value={empleado} onChange={e => setEmpleado(e.target.value)} className="rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm">
            <option value="">Todos</option>
            {empleados.map(e => <option key={e} value={e}>{e}</option>)}
          </select>
        </label>
      </Card>

      {!filas && <TableSkeleton rows={5} />}

      {filas && filas.length === 0 && (
        <Card className="p-8 text-center text-sm text-gray-600">
          Todavía no hay liquidaciones guardadas. Calcula un período en la pestaña «Liquidaciones».
        </Card>
      )}

      {filas && filas.length > 0 && (
        <>
          {porPeriodo.length > 1 && (
            <Card className="p-4">
              <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-brand">Costo empresa por mes</h2>
              <div className="flex items-end gap-2 overflow-x-auto pb-1" style={{ minHeight: 140 }}>
                {porPeriodo.map(([p, v]) => (
                  <div key={p} className="flex w-16 shrink-0 flex-col items-center gap-1">
                    <span className="text-[10px] tabular-nums text-gray-600">{Math.round(v / 1000)}k</span>
                    <div
                      className="w-full rounded-t-md bg-brand"
                      style={{ height: `${Math.max(4, (v / maxCosto) * 100)}px` }}
                      title={`${nombrePeriodo(p)}: ${fmtPrecio(v)}`}
                    />
                    <span className="text-[10px] capitalize text-gray-500">{nombrePeriodo(p).split(' ')[0].slice(0, 3)}</span>
                  </div>
                ))}
              </div>
            </Card>
          )}

          <Card className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead>
                <tr className="border-b border-gray-300 bg-cream text-left text-xs uppercase tracking-wide text-gray-600">
                  <th className="px-4 py-3">Período</th>
                  <th className="px-3">Empleado</th>
                  <th className="px-3 text-right">Cremaciones</th>
                  <th className="px-3 text-right">Líquido</th>
                  <th className="px-3 text-right">Transferido</th>
                  <th className="px-3 text-right">Costo empresa</th>
                  <th className="px-3">Estado</th>
                  <th className="px-3"></th>
                </tr>
              </thead>
              <tbody>
                {visibles.map(f => (
                  <tr key={f.id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="px-4 py-2.5 capitalize">{nombrePeriodo(f.periodo)}</td>
                    <td className="px-3">{f.empleado_nombre}</td>
                    <td className="px-3 text-right tabular-nums">{f.cremaciones}</td>
                    <td className="px-3 text-right tabular-nums">{fmtPrecio(f.liquido)}</td>
                    <td className="px-3 text-right tabular-nums font-medium">{fmtPrecio(f.total_a_transferir)}</td>
                    <td className="px-3 text-right tabular-nums text-gray-600">{fmtPrecio(f.costo_empresa)}</td>
                    <td className="px-3">
                      {f.estado === 'pagada' ? <Badge variant="green">Pagada</Badge>
                        : f.estado === 'cerrada' ? <Badge variant="blue">Cerrada</Badge>
                        : <Badge variant="gray">Borrador</Badge>}
                      {f.fecha_pago && <span className="ml-2 text-xs text-gray-500">{fmtFecha(f.fecha_pago)}</span>}
                    </td>
                    <td className="px-3 text-right">
                      <a href={`/api/remuneraciones/liquidaciones/${f.id}/pdf`} className="text-sm text-brand-soft underline">PDF</a>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-gray-400 bg-cream font-bold text-brand">
                  <td className="px-4 py-2.5" colSpan={4}>Total ({visibles.length} liquidaciones)</td>
                  <td className="px-3 text-right tabular-nums">{fmtPrecio(totales.transferido)}</td>
                  <td className="px-3 text-right tabular-nums">{fmtPrecio(totales.costo)}</td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </Card>
        </>
      )}
    </div>
  )
}
