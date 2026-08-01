'use client'
import { useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/kit'
import { fmtPrecio } from '@/lib/format'
import type { Novedades, ResultadoUI } from './tipos-ui'
import { nombrePeriodo } from './tipos-ui'

/**
 * La liquidación completa, en dos columnas Haberes / Descuentos como el papel
 * que firma el trabajador. Cada línea muestra su fórmula: la idea es que nunca
 * haya un número del que no se pueda decir de dónde salió.
 */
export default function DetalleLiquidacion({
  periodo, resultado, editable, onGuardarNovedades, onCerrar,
}: {
  periodo: string
  resultado: ResultadoUI
  editable: boolean
  onGuardarNovedades: (empleadoId: string, novedades: Partial<Novedades>) => Promise<void>
  onCerrar: () => void
}) {
  const { liquidacion: l, novedades: n, solver } = resultado
  const [horasExtra, setHorasExtra] = useState(String(n.horas_extra || 0))
  const [anticipos, setAnticipos] = useState(String(n.anticipos || 0))
  const [diasTrabajados, setDiasTrabajados] = useState(String(n.dias_trabajados || 30))
  const [guardando, setGuardando] = useState(false)

  async function aplicar() {
    setGuardando(true)
    try {
      await onGuardarNovedades(resultado.empleado_id, {
        horas_extra: Number(horasExtra) || 0,
        anticipos: Number(anticipos) || 0,
        dias_trabajados: Number(diasTrabajados) || 30,
      })
    } finally {
      setGuardando(false)
    }
  }

  const hayCambios =
    Number(horasExtra) !== (n.horas_extra || 0) ||
    Number(anticipos) !== (n.anticipos || 0) ||
    Number(diasTrabajados) !== (n.dias_trabajados || 30)

  return (
    <Modal open onClose={onCerrar} title={`${resultado.empleado_nombre} — ${nombrePeriodo(periodo)}`} size="3xl">
      <div className="space-y-5">
        {/* ── Novedades del mes ───────────────────────────────────────────── */}
        <section className="rounded-2xl border border-gray-300 bg-cream p-4">
          <h3 className="mb-3 text-sm font-bold text-brand">Novedades del mes</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Campo label="Días trabajados (de 30)" value={diasTrabajados} onChange={setDiasTrabajados} disabled={!editable} />
            <Campo label="Horas extra" value={horasExtra} onChange={setHorasExtra} disabled={!editable} />
            <Campo label="Anticipos ($)" value={anticipos} onChange={setAnticipos} disabled={!editable} />
          </div>
          {editable && hayCambios && (
            <div className="mt-3">
              <Button variant="primary" onClick={aplicar} disabled={guardando}>
                {guardando ? 'Recalculando…' : 'Aplicar y recalcular'}
              </Button>
            </div>
          )}
          {!editable && (
            <p className="mt-2 text-xs text-gray-600">
              El período está cerrado. Reábrelo desde la pantalla anterior para poder editarlo.
            </p>
          )}
        </section>

        {/* ── Haberes / Descuentos ────────────────────────────────────────── */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Bloque titulo="Haberes">
            <Subtitulo>Imponibles</Subtitulo>
            {l.haberes.imponibles.map((li, i) => <Linea key={`i${i}`} {...li} />)}
            <Total label="Total imponible" monto={l.totales.total_imponible} />
            {l.haberes.no_imponibles.length > 0 && (
              <>
                <Subtitulo>No imponibles</Subtitulo>
                {l.haberes.no_imponibles.map((li, i) => <Linea key={`ni${i}`} {...li} />)}
                <Total label="Total no imponible" monto={l.totales.total_no_imponible} />
              </>
            )}
            <Total label="Total haberes" monto={l.totales.total_haberes} fuerte />
          </Bloque>

          <Bloque titulo="Descuentos">
            {l.descuentos.legales.map((li, i) => <Linea key={`d${i}`} {...li} />)}
            {l.descuentos.otros.map((li, i) => <Linea key={`o${i}`} {...li} />)}
            <Total label="Total descuentos" monto={l.totales.total_descuentos} fuerte />
            <div className="mt-3 rounded-xl bg-brand px-4 py-3 text-white">
              <div className="flex items-baseline justify-between">
                <span className="text-sm font-medium">Líquido a pago</span>
                <span className="text-xl font-extrabold">{fmtPrecio(l.totales.liquido)}</span>
              </div>
              {l.totales.reembolso_salud > 0 && (
                <>
                  <div className="mt-2 flex items-baseline justify-between border-t border-white/25 pt-2 text-sm">
                    <span>+ Reembolso de salud (fuera de liquidación)</span>
                    <span className="font-semibold">{fmtPrecio(l.totales.reembolso_salud)}</span>
                  </div>
                  <div className="mt-1 flex items-baseline justify-between text-sm">
                    <span className="font-medium">= Total a transferir</span>
                    <span className="font-extrabold text-gold">{fmtPrecio(l.totales.total_a_transferir)}</span>
                  </div>
                </>
              )}
            </div>
            {solver && (
              <p className="mt-2 text-xs text-gray-600">
                Meta pactada {fmtPrecio(solver.meta)} ·{' '}
                {solver.exacto
                  ? 'alcanzada exacta'
                  : `quedó ${fmtPrecio(solver.diferencia)} por encima (no hay un bono entero que dé el valor exacto)`}
              </p>
            )}
          </Bloque>
        </div>

        {/* ── Costo empresa ───────────────────────────────────────────────── */}
        <Bloque titulo="Costo para la empresa">
          <Linea etiqueta="Total haberes" monto={l.totales.total_haberes} />
          {l.aportes_empleador.map((li, i) => <Linea key={`a${i}`} {...li} />)}
          {l.totales.reembolso_salud > 0 && (
            <Linea etiqueta="Reembolso de salud" monto={l.totales.reembolso_salud} formula="se le entrega directo al trabajador" />
          )}
          <Total label="Costo total del mes" monto={l.totales.costo_empresa} fuerte />
        </Bloque>
      </div>
    </Modal>
  )
}

function Campo({ label, value, onChange, disabled }: { label: string; value: string; onChange: (v: string) => void; disabled?: boolean }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-gray-600">{label}</span>
      <input
        type="number"
        value={value}
        disabled={disabled}
        onChange={e => onChange(e.target.value)}
        className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-100 disabled:text-gray-500"
      />
    </label>
  )
}

function Bloque({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-gray-300 bg-white p-4 shadow-sm">
      <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-brand">{titulo}</h3>
      {children}
    </section>
  )
}

function Subtitulo({ children }: { children: React.ReactNode }) {
  return <p className="mt-3 mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">{children}</p>
}

function Linea({ etiqueta, monto, formula }: { etiqueta: string; monto: number; formula?: string }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-gray-100 py-1.5 last:border-0">
      <div className="min-w-0">
        <p className="truncate text-sm text-gray-800">{etiqueta}</p>
        {formula && <p className="truncate text-[11px] text-gray-500" title={formula}>{formula}</p>}
      </div>
      <span className="shrink-0 text-sm font-semibold tabular-nums text-gray-900">{fmtPrecio(monto)}</span>
    </div>
  )
}

function Total({ label, monto, fuerte }: { label: string; monto: number; fuerte?: boolean }) {
  return (
    <div className={`mt-1 flex items-baseline justify-between border-t pt-2 ${fuerte ? 'border-gray-400' : 'border-gray-200'}`}>
      <span className={`text-sm ${fuerte ? 'font-bold text-brand' : 'font-medium text-gray-700'}`}>{label}</span>
      <span className={`tabular-nums ${fuerte ? 'text-base font-extrabold text-brand' : 'text-sm font-semibold text-gray-900'}`}>
        {fmtPrecio(monto)}
      </span>
    </div>
  )
}
