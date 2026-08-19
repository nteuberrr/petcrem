import { readFileSync, existsSync } from 'node:fs'
import { dirname, join, normalize, relative, sep } from 'node:path'

/**
 * `sharp` no puede estar en el grafo de importación de la OPERACIÓN.
 *
 * El 19-08-2026 el webhook de WhatsApp estuvo devolviendo 500 en cada mensaje
 * entrante —con Meta reintentando encima— porque un build de Vercel dejó el
 * binario de sharp desalineado con su libvips (`libvips-cpp.so.8.18.3: cannot
 * open shared object file`). El bot no procesa imágenes: lo arrastraba un
 * `import sharp from 'sharp'` en la cabecera de tres módulos que sí toca
 * (banco de imágenes, logo de marca, catálogo en PDF). Un import estático de una
 * librería NATIVA se cobra caro lejos de donde se escribió.
 *
 *   npx tsx scripts/verificar-sharp-aislado.ts
 *
 * Falla si alguna ruta crítica vuelve a alcanzarlo. Para usar sharp:
 * `const sharp = await getSharp()` de lib/sharp-lazy.
 */

const RAIZ = process.cwd()

// Rutas que tienen que seguir en pie aunque sharp esté roto.
const CRITICAS = [
  'app/api/mensajes/webhook/route.ts',
  'app/api/clientes/route.ts',
  'app/api/clientes/[id]/route.ts',
  'app/api/despachos/[id]/entregar/route.ts',
  'app/api/rutas/[token]/route.ts',
  'app/api/eutanasias/cotizaciones/aceptar/route.ts',
  'app/api/eutanasias/cotizaciones/hora-retiro/route.ts',
  'app/api/cron/cache-agente/route.ts',
]

function resolver(spec: string, desde: string): string | null {
  let base: string
  if (spec.startsWith('@/')) base = join(RAIZ, spec.slice(2))
  else if (spec.startsWith('.')) base = normalize(join(dirname(desde), spec))
  else return null
  for (const ext of ['.ts', '.tsx', `${sep}index.ts`]) {
    if (existsSync(base + ext)) return base + ext
  }
  return null
}

/** Devuelve la cadena de imports hasta el archivo que importa sharp, o null. */
function buscarSharp(entrada: string): string[] | null {
  const vistos = new Set<string>()
  const pila: Array<{ f: string; cadena: string[] }> = [{ f: entrada, cadena: [] }]
  while (pila.length) {
    const { f, cadena } = pila.pop()!
    if (vistos.has(f)) continue
    vistos.add(f)
    let src: string
    try { src = readFileSync(f, 'utf8') } catch { continue }
    if (/^import sharp from 'sharp'/m.test(src)) return [...cadena, f]
    for (const m of src.matchAll(/from '([^']+)'/g)) {
      const r = resolver(m[1], f)
      if (r) pila.push({ f: r, cadena: [...cadena, f] })
    }
  }
  return null
}

let fallos = 0
for (const ruta of CRITICAS) {
  if (!existsSync(join(RAIZ, ruta))) { console.log(`—    ${ruta} (no existe, se omite)`); continue }
  const cadena = buscarSharp(join(RAIZ, ruta))
  if (cadena) {
    fallos++
    console.log(`FALLA ${ruta}`)
    for (const p of cadena) console.log(`        ${relative(RAIZ, p)}`)
  } else {
    console.log(`OK    ${ruta}`)
  }
}

console.log(fallos === 0
  ? `\n${CRITICAS.length}/${CRITICAS.length} OK — sharp queda fuera de la operación`
  : `\n${fallos} ruta(s) alcanzan sharp. Usa getSharp() de lib/sharp-lazy en el modulo señalado.`)
if (fallos > 0) process.exit(1)
