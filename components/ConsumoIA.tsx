'use client'
import { useState, useEffect, useCallback } from 'react'
import { Card, Button } from '@/components/ui/kit'

type Resumen = {
  dias: number
  desde: string
  totalUsd: number
  llamadas: number
  tokens: { entrada: number; salida: number; cacheLectura: number; cacheEscritura: number }
  mes: { usd: number; llamadas: number; proyeccionUsd: number }
  porModulo: Array<{ modulo: string; label: string; usd: number; llamadas: number }>
  porModelo: Array<{ modelo: string; usd: number; llamadas: number }>
  porDia: Array<{ fecha: string; usd: number; llamadas: number }>
  truncado: boolean
}

/** Tipo de cambio referencial para mostrar el gasto también en pesos. */
const USD_CLP = 950

const fmtUsd = (n: number) => `US$${n.toFixed(2)}`
const fmtClp = (n: number) => '$' + Math.round(n * USD_CLP).toLocaleString('es-CL')
const fmtNum = (n: number) => n.toLocaleString('es-CL')
const fmtTok = (n: number) => n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n)
const fmtDia = (iso: string) => iso.slice(8, 10) + '/' + iso.slice(5, 7)

export default function ConsumoIA() {
  const [dias, setDias] = useState(30)
  const [data, setData] = useState<Resumen | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')

  // Sin setState antes del primer `await`: el efecto de abajo la llama al montar
  // y hacerlo síncrono dispararía renders en cascada (regla de react-hooks).
  const cargar = useCallback(async (d: number) => {
    try {
      const r = await fetch(`/api/uso-ia?dias=${d}`, { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok) throw new Error(j?.error || 'No se pudo leer el consumo')
      setError('')
      setData(j as Resumen)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al leer el consumo')
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => { cargar(dias) }, [cargar, dias])

  const maxDia = Math.max(0.0001, ...(data?.porDia.map(d => d.usd) ?? [0]))
  const totalModulos = data?.porModulo.reduce((a, m) => a + m.usd, 0) || 0

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-brand">Consumo de IA</h3>
            <p className="text-sm text-gray-600 mt-0.5">
              Lo que gasta cada módulo del sistema en modelos de IA. El costo es una estimación
              calculada con la lista de precios de los proveedores — la cifra oficial es la de la
              consola de cada uno.
            </p>
          </div>
          <div className="flex gap-2">
            {[7, 30, 90].map(d => (
              <Button key={d} variant={dias === d ? 'primary' : 'secondary'}
                onClick={() => { setCargando(true); setDias(d) }} disabled={cargando}>
                {d} días
              </Button>
            ))}
          </div>
        </div>
      </Card>

      {error && (
        <Card className="p-4 border-red-300 bg-red-50">
          <p className="text-sm text-red-700">{error}</p>
          <p className="text-xs text-red-600 mt-1">
            Si dice que no existe la tabla <code>uso_ia</code>, falta correr el SQL en Supabase.
          </p>
        </Card>
      )}

      {cargando && !data && <Card className="p-6 text-sm text-gray-600">Cargando…</Card>}

      {data && (
        <>
          {/* Cifras de cabecera */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <Card className="p-4">
              <div className="text-xs uppercase tracking-wide text-gray-500">Mes en curso</div>
              <div className="text-2xl font-semibold text-brand mt-1 tabular-nums">{fmtUsd(data.mes.usd)}</div>
              <div className="text-xs text-gray-600 mt-0.5">≈ {fmtClp(data.mes.usd)} · {fmtNum(data.mes.llamadas)} llamadas</div>
            </Card>
            <Card className="p-4">
              <div className="text-xs uppercase tracking-wide text-gray-500">Proyección a fin de mes</div>
              <div className="text-2xl font-semibold text-brand mt-1 tabular-nums">{fmtUsd(data.mes.proyeccionUsd)}</div>
              <div className="text-xs text-gray-600 mt-0.5">≈ {fmtClp(data.mes.proyeccionUsd)} · al ritmo actual</div>
            </Card>
            <Card className="p-4">
              <div className="text-xs uppercase tracking-wide text-gray-500">Últimos {data.dias} días</div>
              <div className="text-2xl font-semibold text-brand mt-1 tabular-nums">{fmtUsd(data.totalUsd)}</div>
              <div className="text-xs text-gray-600 mt-0.5">{fmtNum(data.llamadas)} llamadas desde el {fmtDia(data.desde)}</div>
            </Card>
            <Card className="p-4">
              <div className="text-xs uppercase tracking-wide text-gray-500">Tokens del período</div>
              <div className="text-2xl font-semibold text-brand mt-1 tabular-nums">
                {fmtTok(data.tokens.entrada + data.tokens.cacheLectura + data.tokens.cacheEscritura)}
              </div>
              <div className="text-xs text-gray-600 mt-0.5">
                {fmtTok(data.tokens.cacheLectura)} leídos de caché · {fmtTok(data.tokens.salida)} de salida
              </div>
            </Card>
          </div>

          {/* Gasto por día */}
          <Card className="p-4">
            <h4 className="font-semibold text-brand mb-3">Gasto por día</h4>
            {data.porDia.length === 0 ? (
              <p className="text-sm text-gray-600">Todavía no hay consumo registrado en este período.</p>
            ) : (
              <div className="overflow-x-auto">
                <div className="flex items-end gap-1 min-w-[480px] h-40">
                  {data.porDia.map(d => (
                    <div key={d.fecha} className="flex-1 flex flex-col items-center justify-end h-full group" title={`${d.fecha}: ${fmtUsd(d.usd)} · ${d.llamadas} llamadas`}>
                      <div className="w-full bg-brand rounded-t transition-colors group-hover:bg-brand-soft"
                        style={{ height: `${Math.max(2, (d.usd / maxDia) * 100)}%` }} />
                      <div className="text-[10px] text-gray-500 mt-1 tabular-nums">{fmtDia(d.fecha)}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </Card>

          {/* Por módulo */}
          <Card className="p-4">
            <h4 className="font-semibold text-brand mb-3">Por módulo</h4>
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[520px]">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-gray-500 border-b border-gray-200">
                    <th className="py-2 pr-3">Módulo</th>
                    <th className="py-2 pr-3 text-right">Costo</th>
                    <th className="py-2 pr-3 text-right">Llamadas</th>
                    <th className="py-2 w-40">Peso</th>
                  </tr>
                </thead>
                <tbody>
                  {data.porModulo.length === 0 && (
                    <tr><td colSpan={4} className="py-3 text-gray-600">Sin registros.</td></tr>
                  )}
                  {data.porModulo.map(m => (
                    <tr key={m.modulo} className="border-b border-gray-100 last:border-0">
                      <td className="py-2 pr-3 font-medium text-gray-800">{m.label}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{fmtUsd(m.usd)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums text-gray-600">{fmtNum(m.llamadas)}</td>
                      <td className="py-2">
                        <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                          <div className="h-full bg-brand rounded-full"
                            style={{ width: `${totalModulos > 0 ? (m.usd / totalModulos) * 100 : 0}%` }} />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {/* Por modelo */}
          <Card className="p-4">
            <h4 className="font-semibold text-brand mb-3">Por modelo</h4>
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[420px]">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-gray-500 border-b border-gray-200">
                    <th className="py-2 pr-3">Modelo</th>
                    <th className="py-2 pr-3 text-right">Costo</th>
                    <th className="py-2 text-right">Llamadas</th>
                  </tr>
                </thead>
                <tbody>
                  {data.porModelo.length === 0 && (
                    <tr><td colSpan={3} className="py-3 text-gray-600">Sin registros.</td></tr>
                  )}
                  {data.porModelo.map(m => (
                    <tr key={m.modelo} className="border-b border-gray-100 last:border-0">
                      <td className="py-2 pr-3 font-mono text-xs text-gray-800">{m.modelo}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{fmtUsd(m.usd)}</td>
                      <td className="py-2 text-right tabular-nums text-gray-600">{fmtNum(m.llamadas)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {data.truncado && (
            <Card className="p-3 border-amber-300 bg-amber-50">
              <p className="text-xs text-amber-800">
                El período tiene más registros de los que se leen de una vez: los totales mostrados
                se quedan cortos. Consultá una ventana más corta.
              </p>
            </Card>
          )}

          <p className="text-xs text-gray-500">
            Conversión referencial a pesos: US$1 = ${USD_CLP.toLocaleString('es-CL')}.
          </p>
        </>
      )}
    </div>
  )
}
