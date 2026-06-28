import { TERMINOS_PROHIBIDOS } from './marca-voz'

/**
 * LINTER determinista del copy de marketing (caption + texto de las placas). Es la
 * red de seguridad que NO depende del LLM: corre por código antes de devolver/guardar
 * una pieza y atrapa lo binario que el prompt no garantiza —términos prohibidos,
 * datos de marca falsos, teléfono que no coincide con el oficial, y glifos que el
 * motor de placas (satori) no puede dibujar (flechas/emojis → cajas rotas)—.
 *
 * El generador usa los hallazgos para RECHAZAR y regenerar con feedback. Las reglas
 * de voz viven en lib/marca-voz.ts; los hechos en lib/diferenciadores.ts.
 */

export interface HallazgoLint { campo: string; problema: string }

/** Texto VISIBLE de un HTML de placa (saca tags y entidades, junta espacios). */
export function extraerTextoHtml(html: string): string {
  return (html || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// Puntuación/símbolos que las fuentes de marca (More Sugar + Inter) SÍ dibujan
// (incluye comillas tipográficas ‘’“” que Inter sí tiene).
const PUNT_OK = new Set(' .,;:()[]{}"\'«»¿?¡!…–—-/%&@#°ºª$+=*·•|<>~^_\\‘’“”\n\r\t'.split(''))

/** Caracteres en una placa que el motor (satori) no puede dibujar → saldrían rotos. */
function glifosRotos(texto: string): string[] {
  const malos = new Set<string>()
  for (const ch of texto) {
    if (/\s/.test(ch)) continue
    if (/[\p{L}\p{N}]/u.test(ch)) continue // letras (incl. acentos) y números
    if (PUNT_OK.has(ch)) continue
    malos.add(ch)
  }
  return [...malos]
}

/** Quita de un texto los caracteres que el motor de placas (satori) NO puede dibujar
 *  (emojis, flechas, símbolos raros). Defensa en profundidad junto al linter: se aplica
 *  al HTML antes de rasterizar, así un glifo colado NUNCA sale como caja rota. */
export function sanitizarGlifos(texto: string): string {
  let out = ''
  for (const ch of texto) {
    if (/\s/.test(ch) || /[\p{L}\p{N}]/u.test(ch) || PUNT_OK.has(ch)) out += ch
  }
  return out
}

const digitos = (s: string): string => (s || '').replace(/\D/g, '')

/** Detecta un teléfono escrito que NO coincide con el oficial (incluye truncados). */
function lintTelefono(texto: string, telefonoOficial?: string): string | null {
  if (!telefonoOficial) return null
  const oficial = digitos(telefonoOficial)
  if (oficial.length < 8) return null
  const oficialMobile = oficial.slice(-9)
  const re = /(?:\+?\s*56[\s.\-]*)?9(?:[\s.\-]*\d){6,8}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(texto))) {
    const d = digitos(m[0])
    if (d.length < 7) continue
    const mob = d.startsWith('56') ? d.slice(2) : d
    if (mob !== oficialMobile) {
      return `El teléfono "${m[0].trim()}" no coincide con el oficial (${telefonoOficial}). Usá EXACTAMENTE el oficial.`
    }
  }
  return null
}

/**
 * Lint del copy de una pieza. `caption` admite emojis (las redes los muestran); las
 * `placas` NO (se rasterizan con satori). Devuelve [] si está todo OK.
 */
export function lintCopy(args: { caption?: string; placas?: string[]; telefono?: string; web?: string }): HallazgoLint[] {
  const out: HallazgoLint[] = []
  const terminos = (texto: string, campo: string) => {
    for (const r of TERMINOS_PROHIBIDOS) if (r.patron.test(texto)) out.push({ campo, problema: r.mensaje })
  }
  if (args.caption && args.caption.trim()) {
    terminos(args.caption, 'caption')
    const tel = lintTelefono(args.caption, args.telefono)
    if (tel) out.push({ campo: 'caption', problema: tel })
  }
  ;(args.placas || []).forEach((p, i) => {
    if (!p || !p.trim()) return
    const campo = `placa ${i + 1}`
    terminos(p, campo)
    const tel = lintTelefono(p, args.telefono)
    if (tel) out.push({ campo, problema: tel })
    const glifos = glifosRotos(p)
    if (glifos.length) out.push({ campo, problema: `Caracteres que el motor de placas NO puede dibujar (saldrían como cajas rotas): ${glifos.join(' ')}. Sacá flechas/emojis/símbolos; usá texto.` })
  })
  return out
}
