import './_env-preload'
import { PERIODOS, REGIMEN, PLAZO_NORMAL, PLAZO_TXT, ENTREGA_TXT, ENTREGA, PLAZO_AGENTES, plazoParaRetiro, expressDisponible, aplicarPlazoEntrega } from '../lib/plazo-entrega'
import { DIFERENCIADORES, MODALIDADES_SERVICIOS } from '../lib/diferenciadores'
import { REGLAS_INVIOLABLES } from '../lib/marca-voz'
import { GUIA_SOCIAL } from '../lib/marketing-guia'
import { LANDINGS } from '../lib/sitio/landings'
import { agregarDiasHabiles, isoFecha, EXPRESS_DIAS } from '../lib/dias-habiles'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Verifica el PLAZO DE ENTREGA que promete cada superficie.
 *   npx tsx scripts/verificar-plazo-entrega.ts
 *
 * Existe por tres motivos:
 *
 * 1) El plazo se prometía a mano en una veintena de archivos (sitio, agentes,
 *    PDF) y en el calendario de despachos. Cambiarlo sin una vista única deja
 *    superficies contradiciéndose: la web diciendo un número y el bot otro.
 *
 * 2) Buena parte de esos textos son cadenas con COMILLAS SIMPLES. Meter un
 *    `${...}` ahí compila igual y no falla nunca: sale publicado el literal
 *    "${ENTREGA_TXT}" en la web. El build no lo caza — este script sí.
 *
 * 3) Desde el 20-08-2026 los plazos son un HISTORIAL (lib/plazo-entrega): lo que
 *    prometemos hoy y lo que le debemos a una ficha vieja son cosas distintas.
 *    Si dos períodos se pisan o queda un hueco, el plazo de un tutor pasa a
 *    depender del orden de un array — acá se comprueba que no.
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

const PALABRA: Record<string, number> = { cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10 }

/**
 * Ningún plazo que no sea el vigente puede seguir PROMETIDO.
 *
 * Sí puede nombrarse como referencia ("lo habitual son 4 días hábiles y
 * volveremos a eso", "a esos tutores se les prometió un plazo más largo"), que
 * es lo que los bloques de los agentes necesitan: por eso se mira el contexto
 * anterior y no la frase suelta.
 *
 * Mira CUALQUIER número, no solo el 4: cuando el plazo pasó de 10 a 5, un texto
 * que hubiera quedado con el 10 habría pasado inadvertido.
 */
function sinPlazoViejo(nombre: string, txt: string) {
  for (const m of txt.matchAll(/\b(\d+|cuatro|cinco|seis|siete|ocho|nueve|diez) días hábiles/gi)) {
    const n = PALABRA[m[1].toLowerCase()] ?? parseInt(m[1], 10)
    if (n === REGIMEN.dias) continue
    if (n === EXPRESS_DIAS) continue   // "48 horas hábiles (= 2 días hábiles)"
    const contexto = txt.slice(Math.max(0, (m.index ?? 0) - 70), m.index)
    if (/habitual|normal|volver|en vez de|en lugar de|más largo|anterior|prometi/i.test(contexto)) continue
    mal(`${nombre}: sigue prometiendo "${m[0]}" → …${contexto.slice(-45).replace(/\s+/g, ' ')}[${m[0]}]`)
  }
}

console.log('\n════ Historial de plazos (por FECHA DE RETIRO) ════')
for (const p of PERIODOS) {
  console.log(
    `  ${p.desde} → ${(p.hasta || 'abierto').padEnd(10)} ${String(p.dias).padStart(2)} días hábiles · ${p.formato}`
    + `${p.suspendeExpress ? ' · Express suspendido' : ''}${p === REGIMEN ? '   ← VIGENTE' : ''}`,
  )
}
console.log(`  antes de ${PERIODOS[0].desde}: ${PLAZO_NORMAL} días hábiles`)
console.log(`  Servicio Express hoy: ${expressDisponible() ? 'DISPONIBLE' : 'SUSPENDIDO'}`)

// Los períodos no pueden pisarse ni dejar el futuro sin cubrir: si dos cubren la
// misma fecha, el plazo de una ficha depende del orden del array y no de lo que
// se le prometió al tutor.
for (let i = 1; i < PERIODOS.length; i++) {
  const prev = PERIODOS[i - 1], cur = PERIODOS[i]
  if (!prev.hasta) mal(`el período que arranca el ${prev.desde} quedó abierto y hay otro después: cerralo con 'hasta'`)
  else if (cur.desde <= prev.hasta) mal(`se pisan: ${prev.desde}→${prev.hasta} y ${cur.desde}→${cur.hasta || 'abierto'}`)
}
if (REGIMEN.hasta) mal(`el régimen vigente (${REGIMEN.desde}) tiene 'hasta' puesto: nada cubriría los retiros posteriores`)
if (!fallas) ok('los períodos no se pisan y el vigente está abierto')

console.log('\n════ Cómo se dice ════')
console.log(`  PLAZO_TXT   → "${PLAZO_TXT}"`)
console.log(`  ENTREGA_TXT → "${ENTREGA_TXT}"`)
console.log(`  ENTREGA     → "${ENTREGA}"`)

console.log('\n════ Qué plazo le toca a cada ficha (por FECHA DE RETIRO) ════')
const casos: [string, string, number][] = [
  ['antes de todo período', '2026-08-01', PLAZO_NORMAL],
  ...PERIODOS.flatMap(p => {
    const c: [string, string, number][] = [[`primer día de ${p.desde}→${p.hasta || 'abierto'}`, p.desde, p.dias]]
    if (p.hasta) c.push([`último día de ${p.desde}→${p.hasta}`, p.hasta, p.dias])
    return c
  }),
]
const antesDeFichas = fallas
for (const [etiqueta, iso, esperado] of casos) {
  const real = plazoParaRetiro(iso)
  const objetivo = isoFecha(agregarDiasHabiles(new Date(`${iso}T12:00:00`), real))
  console.log(`  retiro ${iso} (${etiqueta}) → ${real} días hábiles → entrega el ${objetivo}`)
  if (real !== esperado) mal(`retiro ${iso}: da ${real} días y debería dar ${esperado}`)
}
if (fallas === antesDeFichas) ok('cada ficha conserva el plazo que se le prometió el día del retiro')

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
/** Todos los .html de un directorio, recursivo. */
function recorrerHtml(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) recorrerHtml(p, out)
    else if (e.endsWith('.html')) out.push(p.replace(/\\/g, '/'))
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

// ── Plantillas del sitio ──
// El plazo de los templates de Webflow se reemplaza al SERVIR (aplicarPlazoEntrega).
// Acá se corre ese reemplazo sobre cada archivo y se imprime TODA línea que cambia,
// por dos motivos opuestos: que no quede ninguna promesa de entrega sin actualizar,
// y que no se toque de más — las políticas de privacidad prometen responder
// "dentro del plazo de 10 días hábiles", que es un compromiso LEGAL, no de entrega.
console.log('\n════ Plantillas del sitio ════')
const DIR_TPL = 'lib/sitio/templates'
let tocadas = 0
let intactas = 0
for (const archivo of recorrerHtml(DIR_TPL)) {
  const antes = readFileSync(archivo, 'utf8')
  if (antes === aplicarPlazoEntrega(antes)) { intactas++; continue }
  tocadas++
  const cambios = new Set<string>()
  for (const m of antes.matchAll(/.{0,55}\d+(?: a \d+)? días hábiles/g)) {
    if (aplicarPlazoEntrega(m[0]) !== m[0]) cambios.add(m[0].replace(/\s+/g, ' ').trim())
  }
  for (const c of cambios) console.log(`  ${archivo.replace(DIR_TPL + '/', '')}: …${c}`)
}
console.log(`  ${tocadas} plantilla(s) con el plazo reemplazado · ${intactas} sin plazo de entrega`)

// Lo que NO se puede tocar: el plazo LEGAL de las políticas de privacidad.
let legalRoto = 0
for (const archivo of recorrerHtml(DIR_TPL)) {
  const antes = readFileSync(archivo, 'utf8')
  const despues = aplicarPlazoEntrega(antes)
  for (const frase of ['dentro del plazo de', 'no superior a']) {
    const re = new RegExp(`${frase}[^<]{0,40}días hábiles`, 'g')
    if ((antes.match(re) || []).length !== (despues.match(re) || []).length) {
      mal(`${archivo}: se reescribió un plazo LEGAL ("${frase} … días hábiles")`)
      legalRoto++
    }
  }
}
if (!legalRoto) ok('los plazos legales de las políticas de privacidad quedaron intactos')

console.log('\n════ Servicio Express ════')
if (REGIMEN.suspendeExpress) {
  if (/servicio express/i.test(DIFERENCIADORES) && !/SUSPENDIDO/i.test(DIFERENCIADORES)) mal('los diferenciadores siguen ofreciendo el Express')
  else ok('figura como suspendido en los diferenciadores')
} else {
  if (/SUSPENDIDO/i.test(DIFERENCIADORES)) mal('el Express volvió pero los diferenciadores lo dan por suspendido')
  else if (!/servicio express/i.test(DIFERENCIADORES)) mal('el Express está disponible pero no aparece en los diferenciadores')
  else ok('vuelve a ofrecerse en los diferenciadores')
}

console.log('\n════ Resultado ════')
if (fallas) { console.log(`  ${fallas} problema(s).\n`); process.exit(1) }
console.log('  ✅ Todas las superficies dicen lo mismo.\n')
