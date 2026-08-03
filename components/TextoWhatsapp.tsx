'use client'
import { Fragment, type ReactNode } from 'react'

/**
 * Texto de un mensaje del inbox, mostrado COMO EN WHATSAPP.
 *
 * Dos cosas que antes se perdían y hacían que todo se leyera como un párrafo:
 *  1. los saltos de línea (el contenedor no tenía `whitespace-pre-wrap`), y
 *  2. el formato de WhatsApp — *negrita*, _cursiva_, ~tachado~, `mono` y ```bloque```.
 *
 * Ojo: NO es Markdown. En WhatsApp UN asterisco es negrita (en Markdown sería
 * cursiva), así que no sirve react-markdown. Además el agente está instruido para
 * escribir justo con esta sintaxis (ver lib/agente-mensajes.ts), así que sus
 * respuestas llegaban con los asteriscos a la vista.
 */

type Tag = 'strong' | 'em' | 's' | 'code'
const DELIMS: Record<string, Tag> = { '*': 'strong', _: 'em', '~': 's', '`': 'code' }

/** Un delimitador solo abre/cierra si no queda pegado a una letra o número. */
const esBorde = (c: string | undefined) => c === undefined || !/[\p{L}\p{N}]/u.test(c)

const URL_RE = /(https?:\/\/[^\s<>"']+|www\.[^\s<>"']+)/gi

/** Convierte las URLs de un texto plano en enlaces clicables. */
function conEnlaces(texto: string, key: string): ReactNode[] {
  const out: ReactNode[] = []
  let ultimo = 0
  let m: RegExpExecArray | null
  URL_RE.lastIndex = 0
  while ((m = URL_RE.exec(texto))) {
    if (m.index > ultimo) out.push(texto.slice(ultimo, m.index))
    // La puntuación final ("mira example.com.") no es parte del enlace.
    const crudo = m[0].replace(/[.,;:!?)\]]+$/, '')
    const href = crudo.startsWith('http') ? crudo : `https://${crudo}`
    out.push(
      <a key={`${key}u${m.index}`} href={href} target="_blank" rel="noreferrer" className="underline break-all">
        {crudo}
      </a>,
    )
    if (crudo.length < m[0].length) out.push(m[0].slice(crudo.length))
    ultimo = m.index + m[0].length
  }
  if (ultimo < texto.length) out.push(texto.slice(ultimo))
  return out
}

/**
 * Aplica el formato en línea. Recorre el texto de izquierda a derecha buscando el
 * primer delimitador que realmente cierre (misma línea, contenido no vacío y sin
 * espacio pegado); lo que hay dentro se procesa de nuevo, para que `*hola _tú_*`
 * salga en negrita+cursiva. Si un delimitador no cierra, queda como texto normal
 * (así un "2*3" o un nombre_con_guiones no se rompen).
 */
function formatear(texto: string, key: string): ReactNode[] {
  const out: ReactNode[] = []
  let plano = ''
  let i = 0
  const volcar = () => {
    if (plano) { out.push(...conEnlaces(plano, `${key}p${i}`)); plano = '' }
  }

  while (i < texto.length) {
    const ch = texto[i]
    const tag = DELIMS[ch]
    if (!tag || !esBorde(texto[i - 1])) { plano += ch; i++; continue }

    // Busca el cierre en la misma línea.
    let fin = -1
    for (let j = i + 1; j < texto.length; j++) {
      if (texto[j] === '\n') break
      if (texto[j] === ch && esBorde(texto[j + 1])) { fin = j; break }
    }
    const dentro = fin > 0 ? texto.slice(i + 1, fin) : ''
    if (fin < 0 || !dentro.trim() || /^\s|\s$/.test(dentro)) { plano += ch; i++; continue }

    volcar()
    const hijos = tag === 'code' ? [dentro] : formatear(dentro, `${key}${i}`)
    const k = `${key}f${i}`
    out.push(
      tag === 'strong' ? <strong key={k} className="font-semibold">{hijos}</strong>
      : tag === 'em' ? <em key={k}>{hijos}</em>
      : tag === 's' ? <s key={k}>{hijos}</s>
      : <code key={k} className="font-mono text-[0.92em]">{hijos}</code>,
    )
    i = fin + 1
  }
  volcar()
  return out
}

export default function TextoWhatsapp({ texto, className = '' }: { texto: string; className?: string }) {
  // Los bloques ```…``` se sacan primero: adentro no hay formato.
  const partes = texto.split(/```/)
  return (
    <div className={`whitespace-pre-wrap break-words leading-relaxed ${className}`}>
      {partes.map((p, idx) =>
        idx % 2 === 1 && p !== '' ? (
          <code key={`b${idx}`} className="block font-mono text-[0.92em] my-0.5">{p}</code>
        ) : (
          <Fragment key={`t${idx}`}>{formatear(p, `s${idx}`)}</Fragment>
        ),
      )}
    </div>
  )
}
