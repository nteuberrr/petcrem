import './_env-preload'
import { getSheetData } from '../lib/datastore'
import { telefonosDeVet, telefonosVet, vetConvenioPorTelefono } from '../lib/vet-lookup'

/**
 * ¿EL AGENTE RECONOCE TODOS LOS CELULARES DE CADA VETERINARIA?
 *
 *   npx tsx scripts/verificar-telefonos-vet.ts [telefono]
 *
 * Una clínica tiene varios celulares —el veterinario, la recepción, el turno— y
 * todos son la misma veterinaria. Si el reconocimiento falla, el que escribe
 * desde el número secundario NO cae en un error: cae como TUTOR EN DUELO, y el
 * agente lo saluda con un pésame y le cotiza precios de lista que a su convenio
 * no le corresponden. Nadie se entera hasta que el veterinario lo comenta.
 *
 * Esto es de solo lectura: no escribe ni envía nada. Con un teléfono como
 * argumento, dice a quién resolvería ese número.
 */

let fallas = 0
const mal = (s: string) => { console.log(`  ❌ ${s}`); fallas++ }
const ok = (s: string) => console.log(`  ✅ ${s}`)

async function main() {
  const buscado = process.argv[2]

  // ── 1) ¿Existe la columna? ──
  // En Postgres `ensureColumns` es no-op: si el ALTER TABLE no se corrió, la
  // columna no está y guardar un vet falla. Se detecta leyendo una fila.
  const vets = (await getSheetData('veterinarios')).filter(v => (v.activo ?? '').toUpperCase() !== 'FALSE')
  console.log(`\n${vets.length} veterinaria(s) activa(s)\n`)
  if (!vets.length) { console.log('  (nada que revisar)\n'); return }

  if (!('telefonos_adicionales' in vets[0])) {
    mal('la columna `telefonos_adicionales` NO existe: corré supabase/telefonos-vet.sql en Supabase')
  } else {
    ok('la columna `telefonos_adicionales` existe')
  }

  // ── 2) Cada número resuelve a UNA sola veterinaria ──
  // Un celular repetido en dos fichas hace que el agente entre en modo
  // veterinario con la clínica equivocada: nombre, convenio y tarifas de otro.
  const dueño = new Map<string, string[]>()
  for (const v of vets) {
    for (const t of telefonosDeVet(v)) {
      dueño.set(t, [...(dueño.get(t) || []), String(v.nombre || `#${v.id}`)])
    }
  }
  const repetidos = [...dueño.entries()].filter(([, ns]) => ns.length > 1)
  if (repetidos.length) {
    for (const [t, ns] of repetidos) mal(`+56 ${t} está en ${ns.length} fichas: ${ns.join(' · ')}`)
  } else {
    ok('ningún celular está repetido entre veterinarias')
  }

  // ── 3) Un vet sin ningún número válido es invisible para el agente ──
  const sinTelefono = vets.filter(v => telefonosDeVet(v).length === 0)
  if (sinTelefono.length) {
    console.log(`\n  ⚠️  ${sinTelefono.length} sin ningún celular válido (el agente no las va a reconocer):`)
    for (const v of sinTelefono.slice(0, 10)) console.log(`      ${v.nombre}`)
  }

  // ── 4) Lo que el agente ve de verdad ──
  const set = await telefonosVet()
  const conExtras = vets.filter(v => telefonosDeVet(v).length > 1)
  console.log(`\n${set.size} número(s) reconocidos como veterinario (convenio + red de eutanasias)`)
  if (conExtras.length) {
    console.log(`${conExtras.length} veterinaria(s) con más de un celular:\n`)
    for (const v of conExtras) {
      const [p, ...otros] = telefonosDeVet(v)
      console.log(`  ${String(v.nombre || '').slice(0, 28).padEnd(30)} +56 ${p}  (+ ${otros.map(o => `+56 ${o}`).join(', ')})`)
    }
  } else {
    console.log('Ninguna tiene celulares adicionales cargados todavía.')
  }

  // ── 5) Consulta puntual ──
  if (buscado) {
    const v = await vetConvenioPorTelefono(buscado)
    console.log(`\n${buscado} → ${v ? `${v.nombre} (ficha #${v.id})` : 'NO es de una veterinaria del convenio'}`)
  }

  console.log('\n════ Resultado ════')
  if (fallas) { console.log(`  ${fallas} problema(s).\n`); process.exit(1) }
  console.log('  ✅ Cada celular resuelve a una sola veterinaria.\n')
}

main().catch(e => { console.error(e); process.exit(1) })
