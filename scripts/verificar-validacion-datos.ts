import './_env-preload'
import { getSheetData } from '../lib/datastore'
import { correspondeValidacion, leerBotonValidacion, estadoValidacion } from '../lib/validacion-datos'
import { PLANTILLAS_WA, plantillasAprobadas, renderPlantillaWa } from '../lib/whatsapp'
import { boletaAlCliente } from '../lib/vet-boleta'
import { telWhatsapp } from '../lib/whatsapp-avisos'

/**
 * VALIDACIÓN DE DATOS POR EL TUTOR — que el flujo esté bien armado.
 *
 *   npx tsx scripts/verificar-validacion-datos.ts
 *
 * Es de SOLO LECTURA: no manda un WhatsApp ni toca una ficha. Comprueba las tres
 * cosas que, mal, no hacen ruido en ninguna parte:
 *
 *  1. La plantilla cumple las reglas de Meta (variables correlativas, ninguna
 *     repetida, botones sin emojis y de ≤20 caracteres). Una plantilla mal
 *     formada se rechaza al crearla, y sin ella los envíos fuera de la ventana
 *     de 24h no salen.
 *  2. Los payloads de los botones vuelven a leerse bien. Si el formato cambia,
 *     el tutor toca el botón, no pasa nada y nadie se entera.
 *  3. A quién se le mandaría: sobre las fichas REALES, para ver que no se le
 *     escriba al tutor de un veterinario al que le facturamos a él.
 */

let fallas = 0
const mal = (s: string) => { console.log(`  ❌ ${s}`); fallas++ }
const ok = (s: string) => console.log(`  ✅ ${s}`)

async function main() {
  console.log('\n════ La plantilla ════')
  const p = PLANTILLAS_WA['validar_datos_ficha']
  if (!p) { mal('validar_datos_ficha no está en PLANTILLAS_WA'); process.exit(1) }

  const usadas = [...p.texto.matchAll(/\{\{(\d+)\}\}/g)].map(m => Number(m[1]))
  const unicas = [...new Set(usadas)].sort((a, b) => a - b)
  if (usadas.length !== unicas.length) mal(`hay variables REPETIDAS (${usadas.join(',')}): Meta rechaza la plantilla`)
  else ok(`${unicas.length} variables, ninguna repetida`)
  if (unicas.some((n, i) => n !== i + 1)) mal(`las variables no son correlativas desde 1: ${unicas.join(',')}`)
  else ok('las variables van correlativas desde {{1}}')
  if ((p.ejemplos?.length ?? 0) !== unicas.length) mal(`hay ${unicas.length} variables y ${p.ejemplos?.length ?? 0} ejemplos`)
  else ok('un ejemplo por variable')
  if (/\{\{\d+\}\}\s*$/.test(p.texto) || /^\s*\{\{\d+\}\}/.test(p.texto)) mal('el cuerpo empieza o termina en una variable: Meta lo rechaza')
  else ok('el cuerpo no empieza ni termina en una variable')

  const botones = p.botones ?? []
  if (botones.length !== 2) mal(`se esperaban 2 botones y hay ${botones.length}`)
  for (const b of botones) {
    // El interactivo recorta el título a 20 caracteres, así que uno más largo
    // llega mutilado en el camino gratis y entero en el pago: dos textos distintos.
    if (b.length > 20) mal(`el botón "${b}" tiene ${b.length} caracteres (máx. 20, el interactivo lo recorta)`)
    if (/\p{Extended_Pictographic}/u.test(b)) mal(`el botón "${b}" lleva un emoji y Meta los rechaza en los botones`)
  }
  if (!fallas) ok(`botones: ${botones.map(b => `"${b}"`).join(' · ')}`)

  console.log('\n  Así se ve con datos de ejemplo:')
  for (const l of renderPlantillaWa('validar_datos_ficha', p.ejemplos ?? []).split('\n')) console.log(`    │ ${l}`)

  const aprobadas = await plantillasAprobadas().catch(() => new Set<string>())
  if (!aprobadas.size) console.log('\n  (no se pudo consultar Meta: sin token o sin red)')
  else if (aprobadas.has('validar_datos_ficha')) ok('aprobada en Meta')
  else mal('NO está aprobada en Meta todavía — corré `npx tsx scripts/crear-plantillas-whatsapp.ts` y esperá la aprobación')

  console.log('\n════ Los botones vuelven a leerse ════')
  for (const [payload, esperado] of [
    ['datos_ok:123', { clienteId: '123', ok: true }],
    ['datos_mal:456', { clienteId: '456', ok: false }],
  ] as [string, { clienteId: string; ok: boolean }][]) {
    const r = leerBotonValidacion(payload)
    if (r?.clienteId === esperado.clienteId && r.ok === esperado.ok) ok(`"${payload}" → ficha ${r.clienteId}, ${r.ok ? 'confirma' : 'observa'}`)
    else mal(`"${payload}" no se leyó bien: ${JSON.stringify(r)}`)
  }
  for (const ajeno of ['confirmar_retiro:1', 'eutanasia_si:9', '', 'datos_ok:abc']) {
    if (leerBotonValidacion(ajeno) === null) ok(`"${ajeno || '(vacío)'}" se ignora, como debe`)
    else mal(`"${ajeno}" se tomó como validación y es de otro flujo`)
  }

  console.log('\n════ A quién se le mandaría (fichas reales) ════')
  const [clientes, vets] = await Promise.all([getSheetData('clientes'), getSheetData('veterinarios')])
  const reales = clientes.filter(c => String(c.estado || '') !== 'borrador' && String(c.codigo || '').trim())
  let si = 0, noTel = 0, noVet = 0
  const vetsQueSi = new Set<string>()
  const vetsQueNo = new Set<string>()
  for (const c of reales) {
    if (!telWhatsapp(c.telefono)) { noTel++; continue }
    const vid = String(c.veterinaria_id || '').trim()
    if (await correspondeValidacion(c)) {
      si++
      if (vid) vetsQueSi.add(vid)
    } else {
      noVet++
      if (vid) vetsQueNo.add(vid)
    }
  }
  const nombre = (id: string) => vets.find(v => String(v.id) === id)?.nombre || `#${id}`
  console.log(`  ${reales.length} fichas registradas`)
  console.log(`    se le manda al tutor:      ${si}`)
  console.log(`    NO, es de un veterinario:  ${noVet}${vetsQueNo.size ? ` (${[...vetsQueNo].map(nombre).join(', ')})` : ''}`)
  console.log(`    NO, sin WhatsApp válido:   ${noTel}`)
  if (vetsQueSi.size) console.log(`    vets con "boleta al cliente" a los que SÍ se les escribe: ${[...vetsQueSi].map(nombre).join(', ')}`)

  // Un vet marcado "boleta al cliente" tiene que quedar del lado del SÍ, y el
  // resto del lado del NO. Es la regla que pidió el dueño y la que evita
  // escribirle a un tutor que ni sabe que existimos.
  for (const vid of vetsQueNo) {
    if (boletaAlCliente(vets.find(v => String(v.id) === vid))) mal(`${nombre(vid)} boletea al cliente pero sus fichas quedaron fuera`)
  }
  for (const vid of vetsQueSi) {
    if (!boletaAlCliente(vets.find(v => String(v.id) === vid))) mal(`${nombre(vid)} NO boletea al cliente y sus fichas quedaron dentro`)
  }

  console.log('\n════ Cómo vienen las fichas de hoy ════')
  const cuenta = { '': 0, ok: 0, observado: 0 }
  for (const c of reales) cuenta[estadoValidacion(c)]++
  console.log(`  confirmadas ${cuenta.ok} · observadas ${cuenta.observado} · sin responder ${cuenta['']}`)

  console.log('\n════ Resultado ════')
  if (fallas) { console.log(`  ${fallas} problema(s).\n`); process.exit(1) }
  console.log('  ✅ El flujo está bien armado.\n')
}

main().catch(e => { console.error(e); process.exit(1) })
