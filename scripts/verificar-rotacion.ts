import './_env-preload'
import { lintRotacion } from '../lib/marketing-pieza'
import { PLANTILLAS, FAMILIA, PLANTILLAS_CON_FOTO, PLANTILLAS_MEMORIAL, sugerenciasParaTanda } from '../lib/marketing-plantillas'

/**
 * Verifica el validador DETERMINISTA de rotación de plantillas (lintRotacion):
 * el que rechaza una pieza y obliga al modelo a regenerarla cuando repite
 * formato. Sin esto la variedad dependía de que el modelo obedeciera el prompt.
 *
 *   npx tsx scripts/verificar-rotacion.ts
 *
 * Debe seguir pasando ante cualquier cambio en las plantillas o en las reglas.
 */

type Img = { modo: 'plantilla' | 'grafico' | 'reuse' | 'nueva'; plantilla?: string }
const im = (p: string): Img => ({ modo: 'plantilla', plantilla: p })
const SIN_MEMORIA = { ultimaPieza: [] as string[], ultimoMemorial: '' }

let fallos = 0
function caso(nombre: string, hallazgos: { campo: string; problema: string }[], espera: 'rechaza' | 'pasa') {
  const rechazo = hallazgos.length > 0
  const ok = espera === 'rechaza' ? rechazo : !rechazo
  if (!ok) fallos++
  const detalle = rechazo ? ` → ${hallazgos.map(h => h.campo).join(', ')}` : ''
  console.log(`${ok ? '✓' : '✗'} ${nombre}${ok ? '' : ` (se esperaba que ${espera})`}${detalle}`)
}

console.log('— Dentro de una misma pieza —')
caso('repite la misma plantilla en dos slides',
  lintRotacion([im('portada'), im('contenido'), im('portada')], SIN_MEMORIA), 'rechaza')
caso('dos slides seguidas de la misma familia (dos listas)',
  lintRotacion([im('numeros'), im('checklist')], SIN_MEMORIA), 'rechaza')
caso('carrusel de 3 sin ninguna foto',
  lintRotacion([im('dato'), im('cita'), im('horario')], SIN_MEMORIA), 'rechaza')
caso('carrusel variado y con foto',
  lintRotacion([im('revista'), im('timeline'), im('dato'), im('cierre')], SIN_MEMORIA), 'pasa')
caso('post simple de una sola imagen',
  lintRotacion([im('tipografico')], SIN_MEMORIA), 'pasa')

console.log('\n— Variedad REAL del carrusel (no basta con no repetir consecutivas) —')
// El caso que motivó la regla: alterna prolijamente entre dos familias, ninguna
// consecutiva se repite… y el carrusel igual se ve monótono.
caso('5 láminas alternando SOLO dos familias',
  lintRotacion([im('revista'), im('numeros'), im('overlay'), im('checklist'), im('arco')], SIN_MEMORIA), 'rechaza')
caso('5 láminas con tres familias distintas',
  lintRotacion([im('revista'), im('numeros'), im('dato'), im('checklist'), im('arco')], SIN_MEMORIA), 'pasa')
// El umbral sube con el largo: 3 y 4 láminas se sostienen con dos familias, de 5
// en adelante se exigen tres. Un carrusel corto alternando foto/lista se ve bien;
// uno largo, no.
caso('3 láminas con dos familias (le basta con 2)',
  lintRotacion([im('revista'), im('numeros'), im('arco')], SIN_MEMORIA), 'pasa')
caso('4 láminas con dos familias (todavía aceptable)',
  lintRotacion([im('revista'), im('numeros'), im('arco'), im('checklist')], SIN_MEMORIA), 'pasa')
caso('6 láminas con dos familias',
  lintRotacion([im('revista'), im('numeros'), im('arco'), im('checklist'), im('overlay'), im('timeline')], SIN_MEMORIA), 'rechaza')

console.log('\n— La preselección que se le ofrece al modelo ya viene variada —')
{
  const sug = sugerenciasParaTanda(5)
  const fams = new Set(sug.map(p => FAMILIA[p as keyof typeof FAMILIA]))
  caso(`sugerenciasParaTanda(5) → ${sug.length} plantillas, ${fams.size} familias`,
    sug.length === 5 && fams.size === 5 ? [] : [{ campo: 'sug', problema: sug.join(', ') }], 'pasa')
  // Y lo que ofrece tiene que PASAR su propio lint: si no, le estaríamos dando
  // al modelo una preselección que el validador va a rechazar.
  caso('lo que sugiere pasa el lint de rotación',
    lintRotacion(sug.map(p => im(p)), SIN_MEMORIA), 'pasa')
  const sinFoto = sugerenciasParaTanda(4, { evitarFamilias: ['foto'] })
  caso('respeta las familias a evitar',
    sinFoto.every(p => FAMILIA[p as keyof typeof FAMILIA] !== 'foto') ? [] : [{ campo: 'sug', problema: sinFoto.join(', ') }], 'pasa')
}

console.log('\n— Contra las piezas anteriores —')
caso('la portada repite la de la pieza anterior',
  lintRotacion([im('revista'), im('numeros')], { ultimaPieza: ['revista', 'dato'], ultimoMemorial: '' }), 'rechaza')
caso('la portada cambia respecto de la anterior',
  lintRotacion([im('overlay'), im('numeros')], { ultimaPieza: ['revista', 'dato'], ultimoMemorial: '' }), 'pasa')
caso('el homenaje repite el memorial anterior',
  lintRotacion([im('memorial_silueta')], { ultimaPieza: [], ultimoMemorial: 'memorial_silueta' }), 'rechaza')
caso('el homenaje rota a otro memorial',
  lintRotacion([im('memorial_diptico')], { ultimaPieza: [], ultimoMemorial: 'memorial_silueta' }), 'pasa')

console.log('\n— Fotos sueltas y HTML libre no tienen familia que controlar —')
caso('dos fotos del banco seguidas',
  lintRotacion([{ modo: 'reuse' } as Img, { modo: 'reuse' } as Img, { modo: 'nueva' } as Img], SIN_MEMORIA), 'pasa')
caso('carrusel de 3 con una plantilla de texto pero dos fotos',
  lintRotacion([im('cita'), { modo: 'nueva' } as Img, { modo: 'reuse' } as Img], SIN_MEMORIA), 'pasa')

console.log('\n— Integridad del catálogo —')
const sinFamilia = PLANTILLAS.filter(p => !FAMILIA[p])
if (sinFamilia.length) { fallos++; console.log(`✗ plantillas sin familia asignada: ${sinFamilia.join(', ')}`) }
else console.log(`✓ las ${PLANTILLAS.length} plantillas tienen familia`)
const fotoHuerfana = PLANTILLAS_CON_FOTO.filter(p => !PLANTILLAS.includes(p))
const memHuerfana = PLANTILLAS_MEMORIAL.filter(p => !PLANTILLAS.includes(p))
if (fotoHuerfana.length || memHuerfana.length) {
  fallos++
  console.log(`✗ nombres inexistentes en las listas auxiliares: ${[...fotoHuerfana, ...memHuerfana].join(', ')}`)
} else console.log('✓ las listas CON_FOTO y MEMORIAL apuntan a plantillas reales')

console.log(fallos === 0 ? '\nTodo OK.' : `\n${fallos} caso(s) fallaron.`)
process.exit(fallos === 0 ? 0 : 1)
