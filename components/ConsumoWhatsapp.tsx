'use client'
import { useState, useEffect, useCallback } from 'react'
import { Card } from '@/components/ui/kit'

/**
 * Gasto de WhatsApp, al lado del de IA.
 *
 * Dos fuentes que dicen cosas distintas y las dos hacen falta:
 *  · Meta cobra por MENSAJE y su `pricing_analytics` devuelve la plata real, pero
 *    solo desglosada por categoría.
 *  · Nuestro registro (`uso_whatsapp`) sabe qué plantilla y qué flujo la produjo.
 *
 * El bloque más importante es el de SERVICE: hoy esos mensajes son gratis y el
 * 1 de octubre de 2026 Meta vuelve a cobrarlos. Verlos ahora es saber con qué
 * volumen nos va a agarrar el cambio.
 */

type Punto = { fecha: string; categoria: string; mensajes: number; costo: number }
type Meta = {
  ok: boolean; error?: string; moneda: string; desde: string; hasta: string
  puntos: Punto[]
  porCategoria: Array<{ categoria: string; mensajes: number; costo: number }>
  total: number; gratis: number
}
type Envios = {
  dias: number; desde: string; total: number; fallidos: number
  porCategoria: Array<{ categoria: string; n: number }>
  porPlantilla: Array<{ plantilla: string; categoria: string; n: number }>
  porDia: Array<{ fecha: string; cobrables: number; gratis: number }>
}

const fmtNum = (n: number) => n.toLocaleString('es-CL')
const fmtDia = (iso: string) => iso.slice(8, 10) + '/' + iso.slice(5, 7)
const fmtMoneda = (n: number, m: string) =>
  m === 'CLP' ? '$' + Math.round(n).toLocaleString('es-CL') : `${n.toFixed(2)} ${m}`

/** SERVICE = texto libre dentro de la ventana de 24 h: hoy no se cobra. */
const ETIQUETA: Record<string, string> = {
  SERVICE: 'Respuestas dentro de las 24 h',
  UTILITY: 'Plantillas de servicio',
  MARKETING: 'Plantillas de marketing',
  AUTHENTICATION: 'Plantillas de verificación',
}

export default function ConsumoWhatsapp({ dias }: { dias: number }) {
  const [meta, setMeta] = useState<Meta | null>(null)
  const [envios, setEnvios] = useState<Envios | null>(null)
  const [error, setError] = useState('')
  const [cargando, setCargando] = useState(true)

  const cargar = useCallback(async (d: number) => {
    try {
      const r = await fetch(`/api/uso-whatsapp?dias=${d}`, { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok) throw new Error(j?.error || 'No se pudo leer el gasto de WhatsApp')
      setError(''); setMeta(j.meta); setEnvios(j.envios)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al leer el gasto de WhatsApp')
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => { cargar(dias) }, [cargar, dias])

  const gratis = meta?.porCategoria.find(c => c.categoria === 'SERVICE')?.mensajes ?? 0
  const cobrables = (meta?.porCategoria ?? []).filter(c => c.categoria !== 'SERVICE')
  const nCobrables = cobrables.reduce((s, c) => s + c.mensajes, 0)

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <h3 className="text-lg font-semibold text-brand">Gasto de WhatsApp</h3>
        <p className="text-sm text-gray-600 mt-0.5">
          Acá el costo <strong>no es una estimación</strong>: es lo que Meta factura, leído de su
          propia contabilidad. Nuestro registro agrega qué plantilla lo produjo.
        </p>
      </Card>

      {error && (
        <Card className="p-4 border-red-300 bg-red-50">
          <p className="text-sm text-red-700">{error}</p>
        </Card>
      )}

      {cargando && !meta && <Card className="p-6 text-sm text-gray-600">Cargando…</Card>}

      {meta && !meta.ok && (
        <Card className="p-4 border-amber-300 bg-amber-50">
          <p className="text-sm text-amber-900">No se pudo consultar a Meta: {meta.error}</p>
        </Card>
      )}

      {meta?.ok && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Card className="p-4">
              <div className="text-xs uppercase tracking-wide text-gray-500">Cobrado por Meta</div>
              <div className="text-2xl font-semibold text-brand mt-1 tabular-nums">{fmtMoneda(meta.total, meta.moneda)}</div>
              <div className="text-xs text-gray-600 mt-0.5">{fmtNum(nCobrables)} mensajes con cargo · últimos {dias} días</div>
            </Card>
            <Card className="p-4">
              <div className="text-xs uppercase tracking-wide text-gray-500">Mensajes sin cargo</div>
              <div className="text-2xl font-semibold text-emerald-700 mt-1 tabular-nums">{fmtNum(gratis)}</div>
              <div className="text-xs text-gray-600 mt-0.5">Respuestas dentro de la ventana de 24 h</div>
            </Card>
            <Card className="p-4">
              <div className="text-xs uppercase tracking-wide text-gray-500">Costo por mensaje cobrado</div>
              <div className="text-2xl font-semibold text-brand mt-1 tabular-nums">
                {nCobrables > 0 ? fmtMoneda(meta.total / nCobrables, meta.moneda) : '—'}
              </div>
              <div className="text-xs text-gray-600 mt-0.5">Promedio del período</div>
            </Card>
          </div>

          {gratis > 0 && (
            <Card className="p-4 border-amber-300 bg-amber-50">
              <p className="text-sm text-amber-900">
                <strong>Desde el 1 de octubre de 2026 estos {fmtNum(gratis)} mensajes dejan de ser gratis.</strong>{' '}
                Meta vuelve a cobrar las respuestas dentro de la ventana de 24 h. Hoy son el{' '}
                {Math.round((gratis / Math.max(1, gratis + nCobrables)) * 100)}% de todo lo que enviamos,
                así que ese día la cuenta de WhatsApp cambia de escala. Conviene mirar este número
                antes de que llegue.
              </p>
            </Card>
          )}

          <Card className="p-4">
            <h4 className="font-semibold text-brand mb-3">Por categoría de cobro</h4>
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[440px]">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-gray-500 border-b border-gray-200">
                    <th className="py-2 pr-3">Categoría</th>
                    <th className="py-2 pr-3 text-right">Mensajes</th>
                    <th className="py-2 pr-3 text-right">Costo</th>
                    <th className="py-2 text-right">C/u</th>
                  </tr>
                </thead>
                <tbody>
                  {meta.porCategoria.map(c => (
                    <tr key={c.categoria} className="border-b border-gray-100 last:border-0">
                      <td className="py-2 pr-3">
                        {ETIQUETA[c.categoria] ?? c.categoria}
                        <span className="block text-xs text-gray-500 font-mono">{c.categoria}</span>
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">{fmtNum(c.mensajes)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">
                        {c.costo === 0 ? <span className="text-emerald-700">sin cargo</span> : fmtMoneda(c.costo, meta.moneda)}
                      </td>
                      <td className="py-2 text-right tabular-nums text-gray-600">
                        {c.costo === 0 ? '—' : fmtMoneda(c.costo / Math.max(1, c.mensajes), meta.moneda)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      {envios && envios.total > 0 && (
        <Card className="p-4">
          <h4 className="font-semibold text-brand mb-1">Qué plantillas estamos mandando</h4>
          <p className="text-xs text-gray-600 mb-3">
            De nuestro registro. Meta cobra las plantillas una por una, así que esta lista es el
            detalle de la factura: si una crece, se ve acá primero.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[440px]">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-gray-500 border-b border-gray-200">
                  <th className="py-2 pr-3">Plantilla</th>
                  <th className="py-2 pr-3">Categoría</th>
                  <th className="py-2 text-right">Enviadas</th>
                </tr>
              </thead>
              <tbody>
                {envios.porPlantilla.length === 0 && (
                  <tr><td colSpan={3} className="py-3 text-gray-600">Ninguna: todo salió como texto libre dentro de la ventana.</td></tr>
                )}
                {envios.porPlantilla.map(p => (
                  <tr key={p.plantilla} className="border-b border-gray-100 last:border-0">
                    <td className="py-2 pr-3 font-mono text-xs text-gray-800">{p.plantilla}</td>
                    <td className="py-2 pr-3 text-xs text-gray-600">{p.categoria}</td>
                    <td className="py-2 text-right tabular-nums">{fmtNum(p.n)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {envios.fallidos > 0 && (
            <p className="text-xs text-amber-800 mt-3">
              {fmtNum(envios.fallidos)} envíos fueron rechazados por Meta en el período. Esos no se
              cobran, pero tampoco llegaron.
            </p>
          )}
        </Card>
      )}

      {envios && envios.total === 0 && !error && (
        <Card className="p-4 border-gray-300">
          <p className="text-sm text-gray-600">
            Nuestro registro propio todavía está vacío: empieza a llenarse con los mensajes que
            salgan desde ahora. Si dice que no existe la tabla <code>uso_whatsapp</code>, falta
            correr <code>supabase/uso-whatsapp.sql</code>.
          </p>
        </Card>
      )}

      {meta?.ok && meta.puntos.length > 0 && (
        <p className="text-xs text-gray-500">
          Datos de facturación de Meta entre el {fmtDia(meta.desde)} y el {fmtDia(meta.hasta)}, en {meta.moneda}.
        </p>
      )}
    </div>
  )
}
