import './_env-preload'
import {
  CATALOGO, PLANTILLAS, GRUPOS, PLANTILLAS_POR_GRUPO, PLANTILLAS_MEMORIAL,
  PLANTILLAS_CON_FOTO, PLANTILLAS_INFO, PLANTILLA_TOOL_DESC, candidatas,
  construirPlantilla, type NombrePlantilla, type GrupoPlantilla,
} from '../lib/marketing-plantillas'
import { MUESTRAS_PLANTILLAS } from './muestras-plantillas'

/**
 * CANDADO del catálogo de plantillas. Sin esto el registro se pudre solo: pasó
 * dos veces el 2026-08-06 —al sumar 10 memoriales quedaron listas sin actualizar,
 * y al sacarlos aparecieron tres archivos con los nombres viejos escritos a mano—
 * y en ningún caso falló el build. El agente simplemente pedía plantillas que ya
 * no existían.
 *
 * TypeScript ya obliga a que exista una entrada por plantilla (el catálogo está
 * tipado `Record<NombrePlantilla, …>`). Lo que NO puede ver el compilador y sí
 * chequea este script:
 *   · que cada plantilla tenga contenido de muestra para el catálogo visual
 *   · que declare como obligatorio lo que de verdad necesita para dibujarse
 *   · que los textos que lee el agente la nombren
 *   · que ningún grupo se quede vacío (un kit apuntaría a la nada)
 *   · que renderice sin explotar, en los dos formatos que usamos
 *
 *   npx tsx scripts/verificar-plantillas.ts
 */

let fallos = 0
function chequear(ok: boolean, titulo: string, detalle = '') {
  if (ok) { console.log(`✓ ${titulo}`); return }
  fallos++
  console.log(`✗ ${titulo}${detalle ? `\n    ${detalle}` : ''}`)
}

const nombres = PLANTILLAS as readonly NombrePlantilla[]

console.log(`— Catálogo (${nombres.length} plantillas) —`)

// 1) Cada plantilla tiene builder y muestra.
const sinBuilder = nombres.filter(n => typeof CATALOGO[n]?.builder !== 'function')
chequear(sinBuilder.length === 0, 'todas tienen builder', sinBuilder.join(', '))

const sinMuestra = nombres.filter(n => !MUESTRAS_PLANTILLAS[n])
chequear(sinMuestra.length === 0,
  'todas tienen contenido de muestra (catálogo visual)',
  sinMuestra.length ? `sin muestra: ${sinMuestra.join(', ')} — agregalas en scripts/muestras-plantillas.ts` : '')

// 2) Los slots obligatorios existen en la muestra: si la muestra no los trae, o
//    la muestra está incompleta o el `requiere` miente.
const requiereRoto: string[] = []
for (const n of nombres) {
  const m = CATALOGO[n]
  const muestra = MUESTRAS_PLANTILLAS[n]
  if (!muestra) continue
  for (const req of m.requiere || []) {
    const v = (muestra.slots as Record<string, unknown>)[req]
    const vacio = v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)
    if (vacio) requiereRoto.push(`${n}.${req}`)
  }
}
chequear(requiereRoto.length === 0, 'los slots obligatorios están en la muestra', requiereRoto.join(', '))

// 3) Todo slot obligatorio tiene que estar descrito en `slots` (si no, el modelo
//    no sabe qué poner ahí).
const reqSinDescribir: string[] = []
for (const n of nombres) {
  const m = CATALOGO[n]
  for (const req of m.requiere || []) if (!(req in m.slots)) reqSinDescribir.push(`${n}.${req}`)
}
chequear(reqSinDescribir.length === 0, 'todo slot obligatorio está descrito', reqSinDescribir.join(', '))

// 4) `fotos > 0` ⇔ declara un slot de foto. Es lo que alimenta PLANTILLAS_CON_FOTO
//    y la regla de "1 de cada 3 piezas con foto".
const fotoIncoherente = nombres.filter(n => {
  const m = CATALOGO[n]
  const declara = 'foto' in m.slots || 'fotos' in m.slots
  return (m.fotos > 0) !== declara
})
chequear(fotoIncoherente.length === 0, 'el contador de fotos coincide con los slots', fotoIncoherente.join(', '))

// 5) Textos que ve el agente: tienen que nombrarlas a todas.
const faltaEnInfo = nombres.filter(n => !PLANTILLAS_INFO.includes(`"${n}"`))
chequear(faltaEnInfo.length === 0, 'PLANTILLAS_INFO las nombra a todas', faltaEnInfo.join(', '))
const faltaEnTool = nombres.filter(n => !PLANTILLA_TOOL_DESC.includes(n))
chequear(faltaEnTool.length === 0, 'PLANTILLA_TOOL_DESC las nombra a todas', faltaEnTool.join(', '))

// 6) `cuando` es el campo que hace elegir bien: no puede quedar en un placeholder.
const cuandoPobre = nombres.filter(n => (CATALOGO[n].cuando || '').trim().length < 30)
chequear(cuandoPobre.length === 0, 'todas explican CUÁNDO usarlas', cuandoPobre.join(', '))

// 7) Ningún grupo vacío (un kit apuntaría a la nada).
const gruposVacios = (Object.keys(GRUPOS) as GrupoPlantilla[]).filter(g => !(PLANTILLAS_POR_GRUPO[g] || []).length)
chequear(gruposVacios.length === 0, 'ningún grupo quedó vacío', gruposVacios.join(', '))

// 8) Coherencia de los derivados.
chequear(PLANTILLAS_MEMORIAL.every(n => CATALOGO[n].grupo === 'homenaje') && PLANTILLAS_MEMORIAL.length > 0,
  'PLANTILLAS_MEMORIAL sale del grupo homenaje')
chequear(PLANTILLAS_CON_FOTO.every(n => CATALOGO[n].fotos > 0),
  'PLANTILLAS_CON_FOTO sale del contador de fotos')

// 9) El selector nunca ofrece un homenaje sin que se lo pidan (mezclarlo con una
//    pieza comercial sería grave).
const sueltas = candidatas({})
chequear(sueltas.length > 0 && sueltas.every(n => CATALOGO[n].grupo !== 'homenaje'),
  'candidatas() no filtra homenajes salvo que se los pidan')
chequear(candidatas({ grupo: 'homenaje' }).length === PLANTILLAS_MEMORIAL.length,
  'candidatas({grupo:"homenaje"}) devuelve los cinco homenajes')
chequear(candidatas({ conFoto: true }).every(n => CATALOGO[n].fotos > 0),
  'candidatas({conFoto:true}) solo devuelve plantillas con foto')

// 10) Que rendericen sin explotar, en los dos formatos que usamos de verdad.
console.log('\n— Render —')
for (const formato of ['post_vertical', 'story']) {
  const rotas: string[] = []
  for (const n of nombres) {
    const muestra = MUESTRAS_PLANTILLAS[n]
    if (!muestra) continue
    try {
      const { html } = construirPlantilla(n, muestra.slots, { formato })
      if (!html.includes('<div')) rotas.push(`${n} (html vacío)`)
    } catch (e) {
      rotas.push(`${n} (${e instanceof Error ? e.message : String(e)})`)
    }
  }
  chequear(rotas.length === 0, `las ${nombres.length} construyen su HTML en ${formato}`, rotas.join(', '))
}

console.log(fallos === 0 ? '\nTodo OK.' : `\n${fallos} chequeo(s) fallando.`)
if (fallos > 0) process.exitCode = 1
