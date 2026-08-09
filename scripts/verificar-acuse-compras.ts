import './_env-preload'
import { config } from '../lib/openfactura-consulta'
import { detalleDocumento, pdfDocumento, pendientesDeAcuse, PLAZO_ACUSE_DIAS } from '../lib/openfactura-acuse'
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
    // Solo importa una dirección. Si mostramos MÁS pendientes que el SII, estamos
    // ofreciendo acusar algo que ya no lo necesita: eso es el bug (así apareció
    // una nota de crédito colada). Mostrar MENOS es normal y esperable: el campo
    // `Acuses` de cada documento se actualiza antes que el resumen mensual, así
    // que una factura recién acusada desaparece de nuestra lista mientras el
    // registro del SII todavía la cuenta.
    const sobran = cantNuestra - cantSii
    if (sobran > 0) fallas++
    const nota = sobran > 0 ? '✗ MOSTRAMOS DE MÁS' : sobran < 0 ? '· el SII va atrasado (ok)' : '✓'
    console.log(`  ${anio}-${String(mes).padStart(2, '0')}  SII=${cantSii}  nosotros=${cantNuestra}  ${nota}`)
  }

  console.log(fallas === 0
    ? '\n✓ No mostramos ningún pendiente que el SII no reconozca.'
    : `\n✗ ${fallas} mes(es) con pendientes de más — revisar antes de confiar en el panel.`)

  // El botón «Ver» del panel: detalle + PDF de un documento real.
  const p = pendientes[0]
  if (p) {
    console.log(`\nDetalle de ${p.tipo_doc}-${p.folio} (${p.razon_social}):`)
    await dormir(1300)
    const det = await detalleDocumento(p.rut, p.tipo_doc, Number(p.folio))
    const emisor = det.encabezado?.Emisor as Record<string, unknown> | undefined
    console.log(`  estado SII: ${det.estado} | giro: ${String(emisor?.GiroEmis || '—').slice(0, 50)}`)
    if (!det.estado) { console.error('  ✗ el detalle vino sin estado'); fallas++ }

    await dormir(1300)
    const pdf = await pdfDocumento(p.rut, p.tipo_doc, Number(p.folio))
    const cabecera = Buffer.from(pdf.slice(0, 5)).toString('latin1')
    const okPdf = cabecera === '%PDF-'
    console.log(`  PDF: ${(pdf.byteLength / 1024).toFixed(0)} KB, cabecera "${cabecera}" ${okPdf ? '✓' : '✗'}`)
    if (!okPdf) fallas++
  }

  console.log(fallas === 0 ? '\n✓ Todo en orden.\n' : `\n✗ ${fallas} problema(s).\n`)
  process.exit(fallas === 0 ? 0 : 1)
}

main().catch(e => { console.error('\n✗', e instanceof Error ? e.message : e, '\n'); process.exit(1) })
