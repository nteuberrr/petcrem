/**
 * UF y UTM del mes, traídas solas.
 *
 * Las publica el Banco Central (UF, diaria) y el SII (UTM, mensual). Se leen de
 * mindicador.cl, que las espeja en JSON sin pedir credenciales.
 *
 * Para remuneraciones la UF que corresponde es la del **último día del mes**
 * (es la que usa Previred para los topes imponibles y los planes de isapre), no
 * la del día en que se calcula. Si el mes todavía no termina se toma la última
 * publicada y se marca como provisional.
 *
 * Nada se da por bueno a ciegas: cada valor viene con la fecha exacta a la que
 * corresponde y con un chequeo contra el mes anterior, porque la UF y la UTM se
 * mueven poco (menos de 3% mensual) y un salto grande es señal de que la fuente
 * devolvió cualquier cosa.
 */

const BASE = 'https://mindicador.cl/api'

/** Cuánto puede variar un indicador de un mes al otro antes de sospechar. */
const VARIACION_SOSPECHOSA = 0.03

export interface ValorIndicador {
  valor: number
  /** ISO YYYY-MM-DD del día al que corresponde el valor. */
  fecha: string
  /** True si el mes aún no cerró y este es el último dato disponible. */
  provisional: boolean
}

export interface Indicadores {
  periodo: string
  uf: ValorIndicador | null
  utm: ValorIndicador | null
  fuente: string
  /** Qué mirar antes de darlos por buenos. */
  avisos: string[]
}

interface PuntoSerie { fecha: string; valor: number }

const FECHA_CHILE = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Santiago',
  year: 'numeric', month: '2-digit', day: '2-digit',
})

function isoDe(fechaApi: string): string {
  // La API entrega la medianoche de Chile expresada en UTC, y el desfase CAMBIA
  // con el horario de verano: 03:00Z entre octubre y abril, 04:00Z el resto del
  // año. Restar un offset fijo corría un mes entero los valores de enero a
  // abril, así que la conversión va por zona horaria, que sí conoce el cambio.
  const d = new Date(fechaApi)
  if (isNaN(d.getTime())) return ''
  return FECHA_CHILE.format(d)
}

async function serieDelAnio(codigo: 'uf' | 'utm', anio: number): Promise<PuntoSerie[]> {
  const r = await fetch(`${BASE}/${codigo}/${anio}`, {
    cache: 'no-store',
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(10_000),
  })
  if (!r.ok) throw new Error(`mindicador.cl respondió ${r.status} al pedir ${codigo} ${anio}`)
  const d = await r.json()
  const serie = Array.isArray(d?.serie) ? d.serie : []
  return serie
    .map((p: { fecha?: string; valor?: number }) => ({ fecha: isoDe(String(p.fecha || '')), valor: Number(p.valor) }))
    .filter((p: PuntoSerie) => /^\d{4}-\d{2}-\d{2}$/.test(p.fecha) && p.valor > 0)
}

/** Último día del período, en ISO. */
function ultimoDia(periodo: string): string {
  const [anio, mes] = periodo.split('-').map(Number)
  return `${periodo}-${String(new Date(anio, mes, 0).getDate()).padStart(2, '0')}`
}

/** El valor de cierre del mes: el último publicado dentro del período. */
function cierreDelMes(serie: PuntoSerie[], periodo: string): ValorIndicador | null {
  const delMes = serie.filter(p => p.fecha.startsWith(periodo)).sort((a, b) => a.fecha.localeCompare(b.fecha))
  const ultimo = delMes[delMes.length - 1]
  if (!ultimo) return null
  return { valor: ultimo.valor, fecha: ultimo.fecha, provisional: ultimo.fecha !== ultimoDia(periodo) }
}

/**
 * Trae la UF y la UTM del período. No lanza si la fuente falla: devuelve los
 * valores en `null` y el motivo en `avisos`, para que la pantalla lo muestre en
 * vez de romperse.
 */
export async function obtenerIndicadores(periodo: string): Promise<Indicadores> {
  const anio = Number(periodo.slice(0, 4))
  const avisos: string[] = []
  const out: Indicadores = { periodo, uf: null, utm: null, fuente: 'mindicador.cl (Banco Central + SII)', avisos }
  if (!anio) { avisos.push('Período inválido.'); return out }

  const [ufSerie, utmSerie] = await Promise.all([
    serieDelAnio('uf', anio).catch(e => { avisos.push(`No pude traer la UF: ${e instanceof Error ? e.message : e}`); return [] }),
    serieDelAnio('utm', anio).catch(e => { avisos.push(`No pude traer la UTM: ${e instanceof Error ? e.message : e}`); return [] }),
  ])

  out.uf = cierreDelMes(ufSerie, periodo)
  out.utm = cierreDelMes(utmSerie, periodo)

  if (!out.uf) avisos.push(`Todavía no hay UF publicada para ${periodo}.`)
  if (!out.utm) avisos.push(`Todavía no hay UTM publicada para ${periodo}.`)
  // La UTM es mensual: siempre viene fechada el día 1. Si cae otro día, la
  // conversión de zona horaria se corrió y el valor puede ser de otro mes — que
  // es justo el error que el chequeo de variación NO detecta, porque de un mes
  // al otro la UTM se mueve mucho menos del 3%.
  if (out.utm && !out.utm.fecha.endsWith('-01')) {
    avisos.push(`La UTM quedó fechada el ${out.utm.fecha} y debería ser el día 1: revisá la conversión de fechas antes de usarla.`)
  }
  if (out.uf?.provisional) {
    avisos.push(`La UF es la del ${out.uf.fecha}, no la del cierre del mes: el mes aún no termina. Volvé a traerla cuando cierre.`)
  }

  // Chequeo de cordura contra el mes anterior: estos indicadores se mueven poco.
  const [a, m] = periodo.split('-').map(Number)
  const anterior = m === 1 ? `${a - 1}-12` : `${a}-${String(m - 1).padStart(2, '0')}`
  const serieAnterior = anterior.startsWith(String(anio))
    ? { uf: ufSerie, utm: utmSerie }
    : { uf: await serieDelAnio('uf', anio - 1).catch(() => []), utm: await serieDelAnio('utm', anio - 1).catch(() => []) }

  for (const [nombre, actual, previa] of [
    ['UF', out.uf, cierreDelMes(serieAnterior.uf, anterior)],
    ['UTM', out.utm, cierreDelMes(serieAnterior.utm, anterior)],
  ] as const) {
    if (!actual || !previa) continue
    const variacion = (actual.valor - previa.valor) / previa.valor
    if (Math.abs(variacion) > VARIACION_SOSPECHOSA) {
      avisos.push(
        `La ${nombre} varió ${(variacion * 100).toFixed(1)}% respecto de ${anterior} ` +
        `(${Math.round(previa.valor).toLocaleString('es-CL')} → ${Math.round(actual.valor).toLocaleString('es-CL')}). ` +
        'Verificá el valor antes de liquidar.',
      )
    }
  }

  return avisos.length ? { ...out, avisos } : out
}

/** Dónde puede el usuario contrastar cada número a mano. */
export const FUENTES_OFICIALES = {
  uf: 'https://www.bcentral.cl/web/banco-central/areas/estadisticas/uf-utm-e-ipc',
  utm: 'https://www.sii.cl/valores_y_fechas/utm/utm.htm',
  espejo: 'https://mindicador.cl',
}
