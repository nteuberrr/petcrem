'use client'
import { useCallback, useEffect, useState } from 'react'
import { Card, Button } from '@/components/ui/kit'
import { TableSkeleton } from '@/components/ui/Skeleton'
import { InfoTip } from '@/components/ui/InfoTip'
import { fmtPrecio } from '@/lib/format'
import { moverPeriodo, nombrePeriodo, periodoActual } from './tipos-ui'

interface Fila {
  empleado_id: string
  nombre: string
  rut: string
  renta_imponible: number
  afp: string
  cotizacion_afp: number
  sis: number
  salud_sistema: string
  cotizacion_salud: number
  afc_trabajador: number
  afc_empleador: number
  mutual: number
  seguro_social: number
  cuenta_individual: number
  fapp: number
  total: number
  avisos: string[]
}

/**
 * Lo que hay que tipear en Previred cada mes. No genera el archivo plano a
 * propósito: con dos trabajadores la declaración directa toma minutos, y el
 * formato de Previred (105 campos en 861 posiciones exactas) cambia un par de
 * veces al año — mantenerlo costaría más de lo que ahorra.
 */
export default function CotizacionesTab() {
  const [periodo, setPeriodo] = useState(() => moverPeriodo(periodoActual(), -1))
  const [filas, setFilas] = useState<Fila[] | null>(null)
  const [total, setTotal] = useState(0)
  const [err, setErr] = useState('')
  const [copiado, setCopiado] = useState(false)

  const cargar = useCallback(async () => {
    setFilas(null); setErr('')
    try {
      const r = await fetch(`/api/remuneraciones/periodos/${periodo}/cotizaciones`, { cache: 'no-store' })
      const d = await r.json()
      if (!r.ok) { setErr(d.error || 'No se pudo cargar'); setFilas([]) }
      else { setFilas(d.filas || []); setTotal(d.total || 0) }
    } catch { setErr('Error de red'); setFilas([]) }
  }, [periodo])

  useEffect(() => { cargar() }, [cargar])

  async function copiar() {
    if (!filas?.length) return
    const texto = filas.map(f => [
      f.nombre,
      `RUT ${f.rut}`,
      `Renta imponible ${f.renta_imponible}`,
      `AFP ${f.afp}: ${f.cotizacion_afp}`,
      f.sis ? `SIS: ${f.sis}` : '',
      `${f.salud_sistema}: ${f.cotizacion_salud}`,
      `AFC trabajador: ${f.afc_trabajador}`,
      `AFC empleador: ${f.afc_empleador}`,
      `Mutual: ${f.mutual}`,
      f.seguro_social ? `Seguro social: ${f.seguro_social}` : '',
      `Cuenta individual: ${f.cuenta_individual}`,
      `FAPP: ${f.fapp}`,
    ].filter(Boolean).join('\n')).join('\n\n')
    await navigator.clipboard.writeText(texto)
    setCopiado(true)
    setTimeout(() => setCopiado(false), 2000)
  }

  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={() => setPeriodo(moverPeriodo(periodo, -1))} aria-label="Mes anterior">‹</Button>
          <span className="min-w-[9rem] text-center text-lg font-bold capitalize text-brand">{nombrePeriodo(periodo)}</span>
          <Button variant="secondary" onClick={() => setPeriodo(moverPeriodo(periodo, 1))} aria-label="Mes siguiente">›</Button>
        </div>
        <div className="flex items-center gap-2">
          <InfoTip titulo="Para qué sirve esta pestaña" posicion="izquierda">
            Son los montos a declarar en <b>Previred</b>, en el mismo orden del formulario: tipear y listo.
            <br /><br />
            No generamos el archivo plano a propósito: son 105 campos en 861 posiciones exactas, se rechaza entero ante
            un solo carácter fuera de lugar y el formato cambia un par de veces al año. Con dos trabajadores, la
            declaración directa toma unos minutos.
          </InfoTip>
          {copiado && <span className="text-xs text-green-700">Copiado</span>}
          <Button variant="secondary" onClick={copiar} disabled={!filas?.length}>Copiar todo</Button>
        </div>
      </Card>

      {err && <Card className="border-red-300 bg-red-50 p-4 text-sm text-red-700">{err}</Card>}
      {!filas && <TableSkeleton rows={3} />}

      {filas && filas.length === 0 && !err && (
        <Card className="p-8 text-center text-sm text-gray-600">
          {nombrePeriodo(periodo)} no tiene liquidaciones calculadas.
        </Card>
      )}

      {filas && filas.length > 0 && (
        <>
          {filas.map(f => (
            <Card key={f.empleado_id} className="p-4">
              <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2 border-b border-gray-200 pb-2">
                <div>
                  <p className="font-bold text-brand">{f.nombre}</p>
                  <p className="font-mono text-xs text-gray-600">{f.rut || 'sin RUT'}</p>
                </div>
                <p className="text-sm text-gray-600">
                  Total a pagar por este trabajador: <b className="text-brand">{fmtPrecio(f.total)}</b>
                </p>
              </div>

              <div className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
                <Item label="Renta imponible" valor={f.renta_imponible} />
                <Item label={`Cotización AFP ${f.afp}`} valor={f.cotizacion_afp} />
                <Item label={`Salud — ${f.salud_sistema}`} valor={f.cotizacion_salud} />
                <Item label="SIS (empleador)" valor={f.sis} ocultarSiCero />
                <Item label="Seguro cesantía — trabajador" valor={f.afc_trabajador} />
                <Item label="Seguro cesantía — empleador" valor={f.afc_empleador} />
                <Item label="Mutual / ISL" valor={f.mutual} />
                <Item label="Seguro social (Ley 21.735)" valor={f.seguro_social} ocultarSiCero />
                <Item label="Cuenta individual (Ley 21.735)" valor={f.cuenta_individual} />
                <Item label="FAPP / expectativa de vida" valor={f.fapp} />
              </div>

              {f.avisos.length > 0 && (
                <ul className="mt-3 space-y-0.5 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
                  {f.avisos.map((a, i) => <li key={i}>· {a}</li>)}
                </ul>
              )}
            </Card>
          ))}

          <Card className="flex items-baseline justify-between p-4">
            <span className="font-bold text-brand">Total de cotizaciones del mes</span>
            <span className="text-2xl font-extrabold text-brand">{fmtPrecio(total)}</span>
          </Card>
        </>
      )}
    </div>
  )
}

function Item({ label, valor, ocultarSiCero }: { label: string; valor: number; ocultarSiCero?: boolean }) {
  if (ocultarSiCero && !valor) return null
  return (
    <div className="flex items-baseline justify-between border-b border-gray-100 py-1.5">
      <span className="text-sm text-gray-700">{label}</span>
      <span className="text-sm font-semibold tabular-nums text-gray-900">{fmtPrecio(valor)}</span>
    </div>
  )
}
