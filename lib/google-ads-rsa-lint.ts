/**
 * LINTER determinista de anuncios RSA (Responsive Search Ads) — la red de seguridad
 * que NO depende del LLM, corre por código antes de crear el anuncio en Google Ads y
 * atrapa las reglas editoriales DURAS de GUIA_GADS_RSA (google-ads-guia.ts): Google
 * rechaza el anuncio automáticamente si se violan, así que atajarlas antes evita
 * idas y vueltas con la API. Mismo patrón que lib/marketing-lint.ts.
 */

import { TERMINOS_PROHIBIDOS } from './marca-voz'

export interface HallazgoLintRsa { campo: string; problema: string }

export interface HeadlineRsa { texto: string; pinnedSlot1?: boolean }

const SIMBOLOS_PROHIBIDOS = /[★☆→←↑↓»«▶◀✓✔✗✘🔥💯🎉🐾❤♥•●○@#™®©]/gu
const SUPERLATIVOS_SIN_PRUEBA = /\b(el mejor|la mejor|los mejores|las mejores|número ?1|#1|líder(?:es)?|garantizad[oa]|el más barato|lo más barato)\b/i
const TELEFONO_EN_TEXTO = /(?:\+?56[\s.\-]?)?9(?:[\s.\-]?\d){7,8}/
const ESPACIADO_GIMMICK = /\b(?:\p{L}[\s.\-]){2,}\p{L}\b/u
const PUNTUACION_REPETIDA = /([!?.,])\1|\.{2,}/

function mayusculasSostenidas(texto: string): string[] {
  const m = texto.match(/\b[A-ZÁÉÍÓÚÑ]{4,}\b/g)
  return m ? [...new Set(m)] : []
}

function lintTexto(texto: string, campo: string, out: HallazgoLintRsa[]): void {
  for (const r of TERMINOS_PROHIBIDOS) if (r.patron.test(texto)) out.push({ campo, problema: r.mensaje })
  const caps = mayusculasSostenidas(texto)
  if (caps.length) out.push({ campo, problema: `Mayúsculas sostenidas: ${caps.join(', ')}. Google lo rechaza — usá formato normal (ej. "Free Quote", no "FREE QUOTE").` })
  const simbolos = texto.match(SIMBOLOS_PROHIBIDOS)
  if (simbolos) out.push({ campo, problema: `Símbolos/emoji no permitidos: ${[...new Set(simbolos)].join(' ')}. Sacalos — texto plano.` })
  if (SUPERLATIVOS_SIN_PRUEBA.test(texto)) out.push({ campo, problema: 'Superlativo sin prueba verificable ("el mejor", "#1", "garantizado"...). Google lo rechaza salvo que haya un dato objetivo detrás (ej. una calificación real).' })
  if (TELEFONO_EN_TEXTO.test(texto)) out.push({ campo, problema: 'Hay un número de teléfono en el texto — no va en el anuncio (para eso están las extensiones de llamada).' })
  if (ESPACIADO_GIMMICK.test(texto)) out.push({ campo, problema: 'Espaciado artificial tipo "G R A T I S" — Google lo rechaza. Escribí la palabra normal.' })
  if (PUNTUACION_REPETIDA.test(texto)) out.push({ campo, problema: 'Puntuación repetida (ej. "..." o "??"). Sacala.' })
}

/**
 * Valida un RSA completo contra las reglas duras: 15 titulares (≤30 chars, exactamente
 * 3 pinneados en slot 1, ninguno con "!"), 4 descripciones (≤90 chars, máx 1 "!" entre
 * todas), sin duplicados, sin términos prohibidos de marca. Devuelve [] si está OK.
 */
export function lintRSA(args: { headlines: HeadlineRsa[]; descriptions: string[] }): HallazgoLintRsa[] {
  const out: HallazgoLintRsa[] = []
  const { headlines, descriptions } = args

  if (headlines.length !== 15) out.push({ campo: 'titulares', problema: `Hay ${headlines.length} titulares — tienen que ser EXACTAMENTE 15 (Google testea hasta 43.680 combinaciones; dejar slots vacíos le quita datos al algoritmo).` })
  const pinneados = headlines.filter(h => h.pinnedSlot1).length
  if (pinneados !== 3) out.push({ campo: 'titulares', problema: `Hay ${pinneados} titular(es) pinneado(s) en slot 1 — tienen que ser EXACTAMENTE 3 (variantes de la keyword). Ningún otro titular debe ir pinneado.` })
  if (descriptions.length !== 4) out.push({ campo: 'descripciones', problema: `Hay ${descriptions.length} descripciones — tienen que ser EXACTAMENTE 4.` })

  let exclamacionesTotal = 0
  headlines.forEach((h, i) => {
    const campo = `titular ${i + 1}`
    if (!h.texto?.trim()) { out.push({ campo, problema: 'Vacío.' }); return }
    if (h.texto.length > 30) out.push({ campo, problema: `${h.texto.length} caracteres — máximo 30.` })
    if (h.texto.includes('!')) out.push({ campo, problema: 'Tiene "!" — en TITULARES nunca va exclamación (solo se permite, como máximo 1 en todo el anuncio, en descripciones).' })
    lintTexto(h.texto, campo, out)
  })
  descriptions.forEach((d, i) => {
    const campo = `descripción ${i + 1}`
    if (!d?.trim()) { out.push({ campo, problema: 'Vacía.' }); return }
    if (d.length > 90) out.push({ campo, problema: `${d.length} caracteres — máximo 90.` })
    exclamacionesTotal += (d.match(/!/g) || []).length
    lintTexto(d, campo, out)
  })
  if (exclamacionesTotal > 1) out.push({ campo: 'descripciones', problema: `Hay ${exclamacionesTotal} signos "!" entre las descripciones — máximo 1 en TODO el anuncio (titulares+descripciones).` })

  const vistos = new Set<string>()
  for (const h of headlines) {
    const k = h.texto?.trim().toLowerCase()
    if (!k) continue
    if (vistos.has(k)) out.push({ campo: 'titulares', problema: `Titular repetido: "${h.texto}". Cada titular debe ser distinto.` })
    vistos.add(k)
  }

  return out
}

/** Lint liviano para callouts (texto corto, sin las reglas de RSA que no aplican). */
export function lintCallout(texto: string): string | null {
  if (!texto?.trim()) return 'Vacío.'
  if (texto.length > 25) return `${texto.length} caracteres — máximo 25 (ideal 10-20).`
  for (const r of TERMINOS_PROHIBIDOS) if (r.patron.test(texto)) return r.mensaje
  if (mayusculasSostenidas(texto).length) return 'Mayúsculas sostenidas — usá formato normal.'
  return null
}
