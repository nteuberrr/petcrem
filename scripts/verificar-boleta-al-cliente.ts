import './_env-preload'
import { getSheetData } from '../lib/datastore'
import { boletaAlCliente, vetsConBoletaAlCliente } from '../lib/vet-boleta'
import { listarReglas } from '../lib/comisiones'
import { construirPropuestaMes } from '../lib/facturacion-vets'
import { formatDateForSheet } from '../lib/dates'
import { fmtPrecio } from '../lib/format'

/**
 * A QUIÉN SE LE COBRA CADA CONVENIO — y que los tres consumidores digan lo mismo.
 *
 *   npx tsx scripts/verificar-boleta-al-cliente.ts [YYYY-MM]
 *
 * El riesgo que cubre no hace ruido en ninguna parte: si el emisor automático de
 * boletas y la propuesta de facturación mensual leyeran distinto, al veterinario se
 * le factura a fin de mes un servicio que ya se le boleteó al tutor — el mismo
 * servicio cobrado dos veces, y el que lo descubre es el veterinario.
 *
 * Por eso el driver es UNO solo (`veterinarios.boleta_al_cliente`, lib/vet-boleta)
 * y este script comprueba que ningún vet marcado aparezca en la propuesta del mes.
 *
 * Es de solo lectura: no emite, no factura, no escribe nada.
 */

function mesPorDefecto(): string {
  const hoy = new Date()
  const d = new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

async function main() {
  const mes = process.argv[2] || mesPorDefecto()

  const [vets, clientes, reglas] = await Promise.all([
    getSheetData('veterinarios'),
    getSheetData('clientes'),
    listarReglas().catch(() => []),
  ])
  const conComision = new Map(reglas.filter(r => r.activo).map(r => [r.veterinaria_id, r]))
  const marcados = await vetsConBoletaAlCliente()

  const fichasPorVet = new Map<string, Record<string, string>[]>()
  for (const c of clientes) {
    const vid = String(c.veterinaria_id || '').trim()
    if (!vid || String(c.estado || '') === 'borrador') continue
    if (!fichasPorVet.has(vid)) fichasPorVet.set(vid, [])
    fichasPorVet.get(vid)!.push(c)
  }

  console.log('\nMODELO DE COBRO POR CONVENIO\n')
  console.log('  id   veterinaria                          cobro           tarifa            comisión     fichas')
  const activos = vets.filter(v => String(v.activo) !== 'FALSE')
  const orden = [...activos].sort((a, b) =>
    Number(marcados.has(String(b.id))) - Number(marcados.has(String(a.id)))
    || (fichasPorVet.get(String(b.id))?.length || 0) - (fichasPorVet.get(String(a.id))?.length || 0))

  for (const v of orden) {
    const vid = String(v.id)
    const tutor = boletaAlCliente(v)
    const idx = String(v.precios_indexados || '').trim()
    const tarifa = idx === 'general' ? 'lista (indexada)'
      : idx === 'convenio' ? 'convenio (indexada)'
      : String(v.tipo_precios) === 'precios_especiales' ? 'propia'
      : 'convenio'
    const r = conComision.get(vid)
    const com = r ? (r.tipo === 'variable' ? `${r.valor}%` : fmtPrecio(r.valor)) : '—'
    const n = fichasPorVet.get(vid)?.length || 0
    if (!tutor && n === 0 && !r) continue   // convenio dormido: no aporta al informe
    console.log(
      `  ${vid.padStart(3)}  ${String(v.nombre).slice(0, 34).padEnd(35)}`
      + ` ${(tutor ? 'BOLETA al tutor' : 'factura al vet').padEnd(15)}`
      + ` ${tarifa.padEnd(18)} ${com.padEnd(12)} ${String(n).padStart(4)}`,
    )
  }

  // ── El chequeo que importa ────────────────────────────────────────────────
  let fallos = 0

  const propuesta = await construirPropuestaMes(mes)
  const colados = propuesta.vets.filter(v => marcados.has(String(v.veterinaria_id)))
  if (colados.length) {
    fallos++
    console.log(`\nFALLA — ${colados.length} convenio(s) con "boleta al cliente" aparecen en la propuesta de ${mes}:`)
    for (const v of colados) console.log(`   ${v.nombre}: ${v.fichas.length} ficha(s) por ${fmtPrecio(v.total)}`)
    console.log('   Se les iba a facturar un servicio que se le cobra al tutor.')
  } else {
    console.log(`\nOK   ningún convenio marcado se coló a la propuesta de ${mes}`
      + ` (${propuesta.vets.length} vet(s) a facturar)`)
  }

  // Una ficha no puede llevar boleta Y factura al vet.
  const dobles = clientes.filter(c => String(c.boleta_id || '').trim() && String(c.factura_vet_id || '').trim())
  if (dobles.length) {
    fallos++
    console.log(`\nFALLA — ${dobles.length} ficha(s) con boleta al tutor Y factura al vet:`)
    for (const c of dobles) console.log(`   ${c.codigo} (boleta ${c.boleta_id} · factura ${c.factura_vet_id})`)
  } else {
    console.log('OK   ninguna ficha lleva boleta y factura a la vez')
  }

  // Comisión sin el flag: le pagamos por derivar Y además le facturamos el servicio.
  // No es un error del código —el dueño puede quererlo— pero casi nunca es la
  // intención, así que se avisa.
  const comSinFlag = [...conComision.keys()].filter(vid => !marcados.has(vid))
  if (comSinFlag.length) {
    console.log(`\nAVISO — comisión activa SIN "boleta al cliente" en: `
      + comSinFlag.map(vid => vets.find(v => String(v.id) === vid)?.nombre || `#${vid}`).join(', '))
    console.log('   A ese vet se le factura el servicio y además se le paga comisión por derivarlo.')
  }

  // Fichas pagadas de un convenio marcado que se quedaron sin boleta: son las que
  // hay que emitir a mano desde Facturación → "Pagadas sin boleta".
  for (const vid of marcados) {
    const pend = (fichasPorVet.get(vid) || []).filter(c =>
      String(c.estado_pago || '').toLowerCase() === 'pagado'
      && !String(c.boleta_id || '').trim()
      && !String(c.factura_vet_id || '').trim()
      && String(c.sin_boleta || '').toUpperCase() !== 'TRUE')
    if (!pend.length) continue
    const nombre = vets.find(v => String(v.id) === vid)?.nombre || `#${vid}`
    const fechas = pend.map(c => formatDateForSheet(c.fecha_retiro)).filter(Boolean).sort()
    console.log(`\nAVISO — ${nombre}: ${pend.length} ficha(s) pagadas sin documento`
      + ` (${fechas[0]} → ${fechas[fechas.length - 1]}).`)
    console.log('   Aparecen en Facturación → "Pagadas sin boleta" para emitirlas a mano.')
  }

  console.log(fallos === 0 ? '\nSin fallas.' : `\n${fallos} falla(s).`)
  if (fallos > 0) process.exit(1)
}

main().catch(e => { console.error(e); process.exit(1) })
