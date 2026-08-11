import './_env-preload'
import { resumenCampanas } from '../lib/google-ads'

/**
 * Verifica que el VALOR DE CONVERSIÓN de Google Ads salga en pesos y no
 * dividido por un millón.
 *
 *   npx tsx scripts/verificar-valor-conversion.ts
 *
 * Por qué existe: `metrics.conversions_value` es un double en la moneda de la
 * cuenta, pero `cost_micros`/`average_cpc`/los presupuestos SÍ vienen en micros.
 * Se estaban pasando todos por el mismo divisor, así que 14 días con ~$2.000.000
 * de valor de conversión se informaban como **$2** — y con ese 2 el informe de
 * ads concluía que el algoritmo no tenía señal de valor (10-08-2026).
 *
 * El chequeo: el valor por conversión tiene que caer en un rango de pesos
 * chilenos plausible. Las acciones principales de la cuenta tienen valores por
 * defecto entre $10.000 y $40.000, así que un promedio de centavos delata que
 * la división volvió.
 */
const MIN_POR_CONVERSION = 100      // menos que esto son centavos: está dividido de más
const MAX_POR_CONVERSION = 1_000_000 // más que esto está multiplicado de más

async function main() {
  const r = await resumenCampanas('last_14d')
  const c = r.cuenta
  if (c.conversiones <= 0) {
    console.log('Sin conversiones en el período: no hay nada que verificar.')
    return
  }
  const porConversion = c.conversionesValor / c.conversiones
  console.log(`conversiones: ${c.conversiones}`)
  console.log(`valor de conversión total: $${c.conversionesValor.toLocaleString('es-CL')}`)
  console.log(`valor por conversión: $${Math.round(porConversion).toLocaleString('es-CL')}`)

  const ok = porConversion >= MIN_POR_CONVERSION && porConversion <= MAX_POR_CONVERSION
  console.log(ok
    ? `\nOK — el valor por conversión cae en el rango esperado ($${MIN_POR_CONVERSION.toLocaleString('es-CL')}–$${MAX_POR_CONVERSION.toLocaleString('es-CL')}).`
    : `\nFALLA — $${Math.round(porConversion)} por conversión está fuera del rango. Revisa si conversions_value volvió a pasar por el divisor de micros (lib/google-ads.ts).`)
  if (!ok) process.exit(1)
}
main().catch(e => { console.error('ERROR:', e instanceof Error ? e.message : e); process.exit(1) })
