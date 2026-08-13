import './_env-preload'
import { VENTANA, PLAZO_NORMAL, PLAZO_TXT, ENTREGA_TXT, ENTREGA, PLAZO_AGENTES, plazoParaRetiro, expressDisponible } from '../lib/plazo-entrega'
import { DIFERENCIADORES, MODALIDADES_SERVICIOS } from '../lib/diferenciadores'
import { REGLAS_INVIOLABLES } from '../lib/marca-voz'
import { GUIA_SOCIAL } from '../lib/marketing-guia'
import { LANDINGS } from '../lib/sitio/landings'
import { agregarDiasHabiles, isoFecha } from '../lib/dias-habiles'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Verifica el PLAZO DE ENTREGA que promete cada superficie.
 *   npx tsx scripts/verificar-plazo-entrega.ts
 *
 * Existe por dos motivos:
 *
 * 1) El plazo se prometía a mano en una veintena de archivos (sitio, agentes,
 *    PDF) y en el calendario de despachos. Cambiarlo sin una vista única deja
 *    superficies contradiciéndose: la web diciendo un número y el bot otro.
 *
 * 2) Buena parte de esos textos son cadenas con COMILLAS SIMPLES. Meter un
 *    `${...}` ahí compila igual y no falla nunca: sale publicado el literal
 *    "${ENTREGA_TXT}" en la web. El build no lo caza — este script sí.
 */

let fallas = 0
const mal = (s: string) => { console.log(`  ❌ ${s}`); fallas++ }
const ok = (s: string) => console.log(`  ✅ ${s}`)

/** Un "${" literal en un texto ya renderizado = interpolación que no ocurrió. */
function sinPlaceholders(nombre: string, txt: string) {
  const m = txt.match(/\$\{[A-Za-z_]/)
  if (m) mal(`${nombre}: quedó un placeholder SIN interpolar (${txt.slice(Math.max(0, txt.indexOf(m[0]) - 40), txt.indexOf(m[0]) + 30).replace(/\s+/g, ' ')})`)
  else ok(`${nombre}: interpolado`)
}

/**
 * El plazo viejo no puede seguir PROMETIDO en ningún lado. Sí puede nombrarse
 * como referencia ("lo habitual son 4 días hábiles y volveremos a eso"), que es
 * justo lo que el bloque de los agentes necesita para no sonar a que este plazo
 * vino para quedarse: por eso se mira el contexto anterior y no la frase sola.
 */
function sinPlazoViejo(nombre: string, txt: string) {
  if (!VENTANA.activa) return
  for (const m of txt.matchAll(/\b(?:4|cuatro) días hábiles/gi)) {
    const contexto = txt.slice(Math.max(0, (m.index ?? 0) - 60), m.index)
    if (/habitual|normal|volver|en vez de|en lugar de/i.test(contexto)) continue
    mal(`${nombre}: sigue prometiendo "${m[0]}" → …${contexto.slice(-45).replace(/\s+/g, ' ')}[${m[0]}]`)
  }
}

console.log('\n════ Ventana de alta demanda ════')
console.log(`  activa: ${VENTANA.activa} · ${VENTANA.dias} días hábiles · desde ${VENTANA.desde} · hasta ${VENTANA.hasta || '(abierta)'}`)
console.log(`  plazo normal: ${PLAZO_NORMAL} · Servicio Express: ${expressDisponible() ? 'DISPONIBLE' : 'SUSPENDIDO'}`)

console.log('\n════ Cómo se dice ════')
console.log(`  PLAZO_TXT   → "${PLAZO_TXT}"`)
console.log(`  ENTREGA_TXT → "${ENTREGA_TXT}"`)
console.log(`  ENTREGA     → "${ENTREGA}"`)

console.log('\n════ Qué plazo le toca a cada ficha (por FECHA DE RETIRO) ════')
const antes = '2026-08-01'
const dentro = VENTANA.desde
const despues = VENTANA.hasta ? isoFecha(agregarDiasHabiles(new Date(`${VENTANA.hasta}T12:00:00`), 1)) : ''
for (const [etiqueta, iso] of [['antes de la ventana', antes], ['dentro de la ventana', dentro], ...(despues ? [['después de la ventana', despues]] : [])] as [string, string][]) {
  const p = plazoParaRetiro(iso)
  const objetivo = isoFecha(agregarDiasHabiles(new Date(`${iso}T12:00:00`), p))
  console.log(`  retiro ${iso} (${etiqueta}) → ${p} días hábiles → entrega el ${objetivo}`)
}
if (plazoParaRetiro(antes) !== PLAZO_NORMAL) mal(`una ficha retirada ANTES de la ventana debería conservar sus ${PLAZO_NORMAL} días`)
else ok(`las fichas anteriores a ${VENTANA.desde} conservan sus ${PLAZO_NORMAL} días`)
if (VENTANA.activa && plazoParaRetiro(dentro) !== VENTANA.dias) mal('una ficha retirada dentro de la ventana debería tomar el plazo largo')
else ok('las fichas retiradas dentro de la ventana toman el plazo largo')

console.log('\n════ Superficies ════')
const textos: [string, string][] = [
  ['DIFERENCIADORES (todos los agentes)', DIFERENCIADORES],
  ['MODALIDADES_SERVICIOS', MODALIDADES_SERVICIOS],
  ['REGLAS_INVIOLABLES (marketing)', REGLAS_INVIOLABLES],
  ['GUIA_SOCIAL (marketing)', GUIA_SOCIAL],
  ['PLAZO_AGENTES', PLAZO_AGENTES],
  ['sitio · landings', JSON.stringify(LANDINGS)],
]
for (const [nombre, txt] of textos) { sinPlaceholders(nombre, txt); sinPlazoViejo(nombre, txt) }

// El mismo control, pero sobre el CÓDIGO: una cadena con comillas simples que
// contenga ${ENTREGA_TXT} compila, no falla nunca y publica el literal.
console.log('\n════ Cadenas mal citadas en el código ════')
const CONSTANTES = /\$\{\s*(ENTREGA_TXT|PLAZO_TXT|ENTREGA_DIAS_MAX|ENTREGA_DIAS_MIN|ENTREGA)\s*\}/
function recorrer(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    if (e === 'node_modules' || e === '.next' || e === '.git') continue
    const p = join(dir, e)
    if (statSync(p).isDirectory()) recorrer(p, out)
    else if (/\.tsx?$/.test(e)) out.push(p)
  }
  return out
}
let malCitadas = 0
for (const archivo of [...recorrer('lib'), ...recorrer('app'), ...recorrer('components')]) {
  const lineas = readFileSync(archivo, 'utf8').split('\n')
  lineas.forEach((ln, i) => {
    for (const trozo of ln.match(/'[^'\n]*'/g) || []) {
      if (CONSTANTES.test(trozo)) { mal(`${archivo}:${i + 1} — cadena en comillas simples con un placeholder: ${trozo.slice(0, 90)}`); malCitadas++ }
    }
  })
}
if (!malCitadas) ok('ninguna: todos los placeholders viven en template literals')

if (VENTANA.activa && VENTANA.suspendeExpress) {
  if (/servicio express/i.test(DIFERENCIADORES) && !/SUSPENDIDO/i.test(DIFERENCIADORES)) mal('los diferenciadores siguen ofreciendo el Express')
  else ok('el Express figura como suspendido en los diferenciadores')
}

console.log('\n════ Resultado ════')
if (fallas) { console.log(`  ${fallas} problema(s).\n`); process.exit(1) }
console.log('  ✅ Todas las superficies dicen lo mismo.\n')
