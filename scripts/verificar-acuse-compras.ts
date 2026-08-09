import './_env-preload'
import { config } from '../lib/openfactura-consulta'
import { pendientesDeAcuse, PLAZO_ACUSE_DIAS } from '../lib/openfactura-acuse'
import { fmtPrecio } from '../lib/format'

/**
 * Verifica el panel «Facturas por aceptar» SIN dar ningún acuse.
 *
 * Contrasta lo que calculamos (documentos recibidos sin el campo `Acuses`)
 * contra el Registro de Compras del propio SII, que OpenFactura expone en
 * `/v2/dte/registry/purchase/{año}/{mes}` con los cuatro estados reales. Si los
 * conteos de "Pendiente" no calzan, nuestra lectura del campo `Acuses` dejó de
 * ser equivalente al estado del SII y el panel estaría mintiendo.
 *
 *   npx tsx scripts/verificar-acuse-compras.ts
 */

const dormir = (ms: number) => new Promise(r => setTimeout(r, ms))

async function registroSii(anio: number, mes: number) {
  const { baseUrl, apiKey } = config()
  const r = await fetch(`${baseUrl}/v2/dte/registry/purchase/${anio}/${String(mes).padStart(2, '0')}`, { headers: { apikey: apiKey } })
  if (!r.ok) throw new Error(`registry/purchase ${anio}-${mes} → HTTP ${r.status}`)
  return (await r.json()) as Array<{ estado: string; registros: Array<{ cantDocumentos: number; totalMntTotal: number }> }>
}

async function main() {
  if (!config().apiKey) throw new Error('Falta OPENFACTURA_API_KEY en .env.local')

  const pendientes = await pendientesDeAcuse()
  console.log(`\nPendientes de acuse según nosotros: ${pendientes.length}\n`)
  for (const p of pendientes) {
    const plazo = p.vencido ? 'VENCIDA' : `quedan ${p.dias_restantes}d`
    console.log(
      `  ${String(p.tipo_doc).padEnd(2)}-${p.folio.padEnd(9)} ${p.razon_social.slice(0, 30).padEnd(30)} ` +
      `${fmtPrecio(p.monto_total).padStart(10)}  recep=${p.fecha_recepcion}  ${plazo}`,
    )
  }

  // Cruce contra el estado que declara el SII, mes a mes.
  const hoy = new Date()
  console.log(`\nCruce con el Registro de Compras del SII (plazo legal: ${PLAZO_ACUSE_DIAS} días corridos):\n`)
  let fallas = 0
  for (let i = 2; i >= 0; i--) {
    const d = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth() - i, 1))
    const anio = d.getUTCFullYear(), mes = d.getUTCMonth() + 1
    await dormir(1300)
    const bloques = await registroSii(anio, mes)
    const pend = bloques.find(b => /pendiente/i.test(b.estado))
    const cantSii = (pend?.registros || []).reduce((s, x) => s + x.cantDocumentos, 0)
    // El SII agrupa por período del REGISTRO, que es el de recepción, no el de emisión.
    const cantNuestra = pendientes.filter(p => p.fecha_recepcion.slice(0, 7) === `${anio}-${String(mes).padStart(2, '0')}`).length
    const ok = cantSii === cantNuestra
    if (!ok) fallas++
    console.log(`  ${anio}-${String(mes).padStart(2, '0')}  SII=${cantSii}  nosotros=${cantNuestra}  ${ok ? '✓' : '✗ NO CALZA'}`)
  }

  console.log(fallas === 0
    ? '\n✓ Los conteos calzan: leer `Acuses == null` equivale al estado "Pendiente" del SII.\n'
    : `\n✗ ${fallas} mes(es) sin calzar — revisar antes de confiar en el panel.\n`)
  process.exit(fallas === 0 ? 0 : 1)
}

main().catch(e => { console.error('\n✗', e instanceof Error ? e.message : e, '\n'); process.exit(1) })
