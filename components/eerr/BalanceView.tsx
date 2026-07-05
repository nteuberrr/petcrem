'use client'
import { useEffect, useState } from 'react'
import { fmtPrecio } from '@/lib/format'

interface MesF29 { key: string; label: string; debito: number; credito: number; a_pagar: number; remanente: number }
interface Data {
  desde: string
  hasta: string
  meses: MesF29[]
  iva: { debito_total: number; credito_total: number; saldo_favor: number; a_pagar_total: number }
  pasivos: { prestamos_socios: number }
}

export default function BalanceView() {
  const [data, setData] = useState<Data | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch('/api/eerr/balance')
      .then(async r => { const d = await r.json(); if (!r.ok) throw new Error(d?.error || 'No se pudo cargar'); return d })
      .then((d: Data) => { setData(d); setError('') })
      .catch(e => setError(e instanceof Error ? e.message : 'Error de red'))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="text-gray-500 text-sm">Cargando…</div>
  if (error) return <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-2.5">{error}</p>
  if (!data) return null

  const { iva, pasivos } = data
  const aFavor = iva.saldo_favor > 0

  // Tarjeta resumen (activo / pasivo / saldo neto).
  const Card = ({ label, valor, tono, sub }: { label: string; valor: number; tono: 'activo' | 'pasivo' | 'neto'; sub?: string }) => {
    const cls = tono === 'activo'
      ? 'border-emerald-200 bg-emerald-50'
      : tono === 'pasivo'
      ? 'border-rose-200 bg-rose-50'
      : aFavor ? 'border-emerald-300 bg-emerald-100' : 'border-amber-300 bg-amber-100'
    const numCls = tono === 'activo' ? 'text-emerald-700' : tono === 'pasivo' ? 'text-rose-700' : aFavor ? 'text-emerald-800' : 'text-amber-800'
    return (
      <div className={`rounded-xl border ${cls} p-4 shadow-sm`}>
        <p className="text-[11px] uppercase tracking-wide font-semibold text-gray-500">{label}</p>
        <p className={`text-2xl font-extrabold tabular-nums mt-1 ${numCls}`}>{fmtPrecio(valor)}</p>
        {sub && <p className="text-xs text-gray-500 mt-1">{sub}</p>}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <p className="text-xs text-gray-500">
        Posición de <strong className="text-gray-700">IVA (F29)</strong> acumulada desde <strong className="text-gray-700">junio 2026</strong> (cuando empezamos a pagar IVA). El saldo a favor arrastra el remanente de crédito de un mes al siguiente.
      </p>

      {/* Resumen IVA */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Card label="IVA Crédito Fiscal (activo)" valor={iva.credito_total} tono="activo" sub="Facturas SII contabilizadas" />
        <Card label="IVA Débito Fiscal (pasivo)" valor={iva.debito_total} tono="pasivo" sub="19/119 de las ventas" />
        <Card
          label={aFavor ? 'Saldo a favor (remanente)' : 'IVA por pagar'}
          valor={aFavor ? iva.saldo_favor : iva.a_pagar_total}
          tono="neto"
          sub={aFavor ? 'Crédito que arrastramos al SII' : 'Neto adeudado en los meses con débito > crédito'}
        />
      </div>

      {/* F29 mes a mes */}
      <div>
        <h3 className="text-sm font-bold text-brand mb-2">Detalle mensual (F29)</h3>
        <div className="bg-white rounded-xl border border-gray-300 overflow-x-auto shadow-md">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr className="bg-gray-800 text-gray-100 text-xs uppercase">
                <th className="border border-gray-700 px-3 py-2.5 text-left font-semibold tracking-wide">Mes</th>
                <th className="border border-gray-700 px-3 py-2.5 text-right font-semibold">Débito</th>
                <th className="border border-gray-700 px-3 py-2.5 text-right font-semibold">Crédito</th>
                <th className="border border-gray-700 px-3 py-2.5 text-right font-semibold">A pagar</th>
                <th className="border border-gray-700 px-3 py-2.5 text-right font-semibold">Saldo a favor</th>
              </tr>
            </thead>
            <tbody>
              {data.meses.map(m => (
                <tr key={m.key} className="hover:bg-gray-50">
                  <td className="border border-gray-300 px-3 py-2 text-left font-medium text-gray-700 capitalize whitespace-nowrap">{m.label}</td>
                  <td className="border border-gray-300 px-3 py-2 text-right tabular-nums text-gray-600">{m.debito ? fmtPrecio(m.debito) : <span className="text-gray-300">—</span>}</td>
                  <td className="border border-gray-300 px-3 py-2 text-right tabular-nums text-gray-600">{m.credito ? fmtPrecio(m.credito) : <span className="text-gray-300">—</span>}</td>
                  <td className="border border-gray-300 px-3 py-2 text-right tabular-nums font-semibold text-rose-700">{m.a_pagar ? fmtPrecio(m.a_pagar) : <span className="text-gray-300">—</span>}</td>
                  <td className="border border-gray-300 px-3 py-2 text-right tabular-nums font-semibold text-emerald-700">{m.remanente ? fmtPrecio(m.remanente) : <span className="text-gray-300">—</span>}</td>
                </tr>
              ))}
              <tr className="bg-gray-100 font-bold">
                <td className="border border-gray-300 px-3 py-2 text-left uppercase text-xs tracking-wide text-gray-700">Acumulado</td>
                <td className="border border-gray-300 px-3 py-2 text-right tabular-nums text-gray-800">{fmtPrecio(iva.debito_total)}</td>
                <td className="border border-gray-300 px-3 py-2 text-right tabular-nums text-gray-800">{fmtPrecio(iva.credito_total)}</td>
                <td className="border border-gray-300 px-3 py-2 text-right tabular-nums text-rose-700">{fmtPrecio(iva.a_pagar_total)}</td>
                <td className="border border-gray-300 px-3 py-2 text-right tabular-nums text-emerald-700">{fmtPrecio(iva.saldo_favor)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Otras cuentas */}
      <div>
        <h3 className="text-sm font-bold text-brand mb-2">Otras cuentas del balance</h3>
        <div className="bg-white rounded-xl border border-gray-300 overflow-hidden shadow-md divide-y divide-gray-100">
          <div className="flex items-center justify-between px-4 py-3">
            <div>
              <p className="text-sm font-semibold text-gray-700">Préstamos de socios <span className="text-[11px] font-normal text-rose-600 bg-rose-50 border border-rose-200 rounded px-1.5 py-0.5 ml-1">Pasivo</span></p>
              <p className="text-xs text-gray-500 mt-0.5">Aportes registrados en Rendiciones (deuda con el socio)</p>
            </div>
            <p className="text-lg font-bold tabular-nums text-rose-700">{fmtPrecio(pasivos.prestamos_socios)}</p>
          </div>
        </div>
      </div>

      {/* En construcción */}
      <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-4">
        <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">Próximas cuentas (lo iremos armando)</p>
        <p className="text-xs text-gray-500">Resultado acumulado (patrimonio, calculado desde el EERR) · Caja / Banco · Activo fijo (horno, vehículo) con depreciación · Inventario de productos · Cuentas por cobrar y por pagar. El balance cuadrará (Activos = Pasivos + Patrimonio) a medida que sumemos estas cuentas.</p>
      </div>
    </div>
  )
}
