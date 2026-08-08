/**
 * REVISIÓN FINAL del mensaje del agente, justo antes de enviarlo por WhatsApp.
 *
 * Dos cosas que el prompt NO puede garantizar por sí solo, y que acá se resuelven
 * de forma determinística:
 *
 *  1. FUGA DE RAZONAMIENTO. El modelo a veces escribe su deliberación interna en
 *     el mensaje. Caso real (2026-08-08, clienta con su gato recién fallecido):
 *     «Espera, la herramienta dice que no aplica recargo, pero hoy es sábado…
 *     Debo confiar en la herramienta… Hmm, pero la instrucción dice "OBLIGATORIA…"».
 *     Fueron 11 mensajes así en 30 conversaciones, todos en fin de semana o
 *     después de las 18:00. La causa de fondo (la contradicción entre el prompt y
 *     la herramienta de precios) está arreglada en lib/agenda + agente-acciones;
 *     esto es la red de seguridad para que NUNCA vuelva a llegarle a un cliente.
 *
 *  2. DÍAS DE LA SEMANA INVENTADOS. El modelo escribe "jueves 07-08-2026" cuando
 *     ese día era viernes (caso real, conv #651), aunque la herramienta se lo
 *     había entregado bien. Acá se recalcula cada día nombrado a partir de su
 *     fecha y se corrige en silencio.
 *
 * Nada de esto reemplaza al prompt: lo respalda. Y no inventa contenido — solo
 * borra lo que el cliente no debe ver y corrige lo verificable.
 */

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
const RE_DIA = '(lunes|martes|mi[ée]rcoles|jueves|viernes|s[áa]bado|domingo)'

const sinTildes = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/** Día de la semana (en español) de una fecha ISO, sin depender de la zona del server. */
export function diaDeISO(iso: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!m) return null
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12))
  return isNaN(d.getTime()) ? null : DIAS[d.getUTCDay()]
}

const addDias = (iso: string, n: number): string => {
  const [y, m, d] = iso.split('-').map(Number)
  const x = new Date(Date.UTC(y, m - 1, d + n, 12))
  return `${x.getUTCFullYear()}-${String(x.getUTCMonth() + 1).padStart(2, '0')}-${String(x.getUTCDate()).padStart(2, '0')}`
}

/** Respeta la mayúscula inicial del original ("Viernes" → "Sábado"). */
const comoElOriginal = (original: string, nuevo: string) =>
  /^[A-ZÁÉÍÓÚÑ]/.test(original) ? nuevo.charAt(0).toUpperCase() + nuevo.slice(1) : nuevo

// ── 1. Fuga de razonamiento ──────────────────────────────────────────────────
/**
 * Vocabulario que delata que el modelo está hablando de su propia maquinaria.
 * Ninguna de estas expresiones tiene por qué aparecer JAMÁS en un mensaje a un
 * cliente que acaba de perder a su mascota.
 */
const MAQUINARIA: RegExp[] = [
  /\bla herramienta\b/i,
  /\bherramienta (dice|devuelve|indica|no est[áa]|arroj[óo])/i,
  /\bel bloque\b/i,
  /\b(la|las) instrucci[óo]n(es)?\b/i,
  /\bmis instrucciones\b/i,
  /\bregla dura\b/i,
  /\bRECARGO VIGENTE\b/i,
  /\bFECHA Y HORA ACTUAL\b/,
  /\bDISPONIBILIDAD REAL\b/,
  /\bel CALENDARIO\b/,
  /\bseg[úu]n las reglas\b/i,
  /\bel (system )?prompt\b/i,
  /\bdebo (confiar|seguir|incluirlo|respetar|recotizar|decidir)\b/i,
  /\bvoy a recotizar\b/i,
  /\b(el sistema|el contexto) (dice|indica|marca)\b/i,
]

/** ¿Este fragmento expone maquinaria interna? */
export function esRazonamientoInterno(fragmento: string): boolean {
  return MAQUINARIA.some(re => re.test(fragmento))
}

/**
 * Quita las frases que exponen maquinaria interna. Trabaja por PÁRRAFO y, dentro
 * de cada uno, por ORACIÓN: en los casos reales la deliberación venía como uno o
 * dos párrafos delante del mensaje bueno, pero también apareció mezclada.
 */
function quitarRazonamiento(texto: string): { texto: string; fugas: string[] } {
  const fugas: string[] = []
  const parrafos = texto.split(/\n{2,}/)
  const limpios = parrafos.map(p => {
    if (!esRazonamientoInterno(p)) return p
    // El párrafo tiene algo interno: se filtra oración por oración para no perder
    // el contenido bueno que venga pegado.
    const oraciones = p.split(/(?<=[.!?…])\s+/)
    const buenas = oraciones.filter(o => {
      if (!esRazonamientoInterno(o)) return true
      fugas.push(o.trim())
      return false
    })
    return buenas.join(' ').trim()
  })
  return {
    texto: limpios.filter(p => p.trim()).join('\n\n').replace(/\n{3,}/g, '\n\n').trim(),
    fugas,
  }
}

// ── 2. Días de la semana ─────────────────────────────────────────────────────
/**
 * Corrige todo día de la semana que se pueda verificar contra una fecha concreta.
 * Cubre las cuatro formas en que el bot los escribe:
 *   "viernes 07-08-2026" · "viernes 7 de agosto" · "mañana viernes" · "viernes 7"
 */
function corregirDiasSemana(texto: string, hoyISO: string): { texto: string; correcciones: string[] } {
  const correcciones: string[] = []
  let out = texto

  const arreglar = (dicho: string, isoReal: string, frase: string): string => {
    const real = diaDeISO(isoReal)
    if (!real || sinTildes(real) === sinTildes(dicho)) return dicho
    correcciones.push(`"${frase}" → ${real} (${isoReal})`)
    return comoElOriginal(dicho, real)
  }

  // a) "<día> DD-MM-YYYY" o "<día> DD/MM/YYYY" (se respeta el separador original)
  out = out.replace(new RegExp(`\\b${RE_DIA}(\\s+)((\\d{1,2})[-/](\\d{1,2})[-/](\\d{4}))\\b`, 'gi'),
    (frase, dia, sep, fechaTxt, D, M, Y) => {
      const iso = `${Y}-${String(M).padStart(2, '0')}-${String(D).padStart(2, '0')}`
      return `${arreglar(dia, iso, frase)}${sep}${fechaTxt}`
    })

  // b) "<día> DD de <mes>" (con año opcional)
  out = out.replace(new RegExp(`\\b${RE_DIA}(\\s+)(\\d{1,2})(\\s+de\\s+)(${MESES.join('|')})(\\s+de\\s+(\\d{4}))?`, 'gi'),
    (frase, dia, s1, D, s2, mes, _resto, Y) => {
      const mi = MESES.findIndex(x => sinTildes(x) === sinTildes(mes))
      if (mi < 0) return frase
      const anio = Y || hoyISO.slice(0, 4)
      const iso = `${anio}-${String(mi + 1).padStart(2, '0')}-${String(D).padStart(2, '0')}`
      return frase.replace(dia, arreglar(dia, iso, frase))
    })

  // c) "hoy/mañana/pasado mañana <día>"
  out = out.replace(new RegExp(`\\b(hoy|ma[ñn]ana|pasado ma[ñn]ana)(\\s+)${RE_DIA}\\b`, 'gi'),
    (frase, rel, sep, dia) => {
      const r = sinTildes(rel)
      const off = r === 'hoy' ? 0 : r === 'manana' ? 1 : 2
      return `${rel}${sep}${arreglar(dia, addDias(hoyISO, off), frase)}`
    })

  // d) "<día> DD" suelto (sin mes ni año): se resuelve al día de ese número más
  //    cercano a hoy, que es como lo lee el cliente.
  out = out.replace(new RegExp(`\\b${RE_DIA}(\\s+)(\\d{1,2})\\b(?!\\s*[-/:.]\\s*\\d)(?!\\s+de\\s)`, 'gi'),
    (frase, dia, sep, D) => {
      const num = Number(D)
      if (num < 1 || num > 31) return frase
      let iso: string | null = null
      for (let k = 0; k <= 20 && !iso; k++) {
        for (const s of [k, -k]) {
          const cand = addDias(hoyISO, s)
          if (Number(cand.slice(8, 10)) === num) { iso = cand; break }
        }
      }
      return iso ? `${arreglar(dia, iso, frase)}${sep}${D}` : frase
    })

  return { texto: out, correcciones }
}

// ── Punto de entrada ─────────────────────────────────────────────────────────
export interface RevisionSalida {
  /** El mensaje ya saneado. */
  texto: string
  /** Fragmentos internos que se eliminaron (para el log y el aviso al equipo). */
  fugas: string[]
  /** Días de la semana corregidos. */
  correcciones: string[]
  /** true si tras sanear no quedó un mensaje utilizable → mejor escalar. */
  vacio: boolean
}

/** Longitud mínima para considerar que todavía hay un mensaje que enviar. */
const MIN_UTIL = 15

export function revisarSalidaAgente(texto: string, hoyISO: string): RevisionSalida {
  const original = String(texto ?? '')
  const sinFuga = quitarRazonamiento(original)
  const conDias = corregirDiasSemana(sinFuga.texto, hoyISO)
  const limpio = conDias.texto.trim()
  return {
    texto: limpio,
    fugas: sinFuga.fugas,
    correcciones: conDias.correcciones,
    vacio: limpio.length < MIN_UTIL,
  }
}
