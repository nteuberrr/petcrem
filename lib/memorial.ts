import { getSharp } from './sharp-lazy'
import { getSheetData, updateByIdIf } from './datastore'
import { uploadToR2 } from './cloudflare-r2'
import { renderGraficoHTML } from './grafico-render'
import { construirPlantilla, PLANTILLAS_MEMORIAL } from './marketing-plantillas'
import { publicarHistoriaInstagram, isInstagramConfigurado } from './meta-publish'
import { listarImagenes } from './mailing-images'
import { formatDate } from './dates'

/**
 * HISTORIA DE DESPEDIDA en Instagram: el homenaje a una mascota que ya fue
 * ENTREGADA, armado con la foto que subió su tutor.
 *
 * Se publica SOLO si se cumplen las dos condiciones, sin excepción:
 *   1. el tutor marcó el CONSENTIMIENTO al subir la foto para el certificado
 *      (`clientes.memorial_consentimiento`), y
 *   2. la mascota está ENTREGADA (`clientes.estado === 'despachado'`).
 * Si falta cualquiera de las dos, no se publica nada. El consentimiento es
 * opt-in explícito y se puede revocar desmarcándolo: nunca se asume.
 *
 * La plantilla sale AL AZAR de las 15 de homenaje (lib/marketing-plantillas), en
 * formato story 1080x1920, y se sube a Instagram con `media_type=STORIES`.
 *
 * ⚠️ DESTACADA "Despedidas": Meta NO expone ningún endpoint para crear una
 * destacada ni para agregarle una historia — la API de Instagram simplemente no
 * cubre highlights. Hay que fijarla A MANO desde el teléfono mientras la historia
 * siga viva (24 h). Por eso cada publicación queda registrada en la ficha
 * (`memorial_publicado_at`) y se avisa al equipo.
 *
 * Idempotente: `memorial_publicado_at` es la guarda — una ficha ya publicada no
 * se vuelve a publicar aunque el flujo se dispare de nuevo.
 *
 * Best-effort: nunca lanza hacia el caller (la entrega es lo importante).
 */

export interface ResultadoMemorial {
  ok: boolean
  /** Motivo por el que NO se publicó (para el log; no es un error). */
  motivo?: string
  storyId?: string
  plantilla?: string
  imagenUrl?: string
}

/** Encabezados que rotan, para que no todas digan lo mismo. */
const EYEBROWS = ['En memoria', 'Hasta siempre', 'Gracias por tanto', 'Siempre con nosotros']

/** Primera foto guardada en un campo JSON de la ficha. */
function primeraFoto(cliente: Record<string, string>, campo: string): string {
  try {
    const x = JSON.parse(cliente[campo] || '[]')
    return Array.isArray(x) && typeof x[0] === 'string' ? x[0] : ''
  } catch { return '' }
}

/** "2011 — 2026" a partir de las fechas de la ficha; '' si no hay ninguna. */
function rangoFechas(cliente: Record<string, string>): string {
  const anio = (v: string) => {
    const f = formatDate(v)
    const m = /(\d{4})/.exec(f || '')
    return m ? m[1] : ''
  }
  const nac = anio(cliente.fecha_nacimiento || '')
  const def = anio(cliente.fecha_defuncion || '')
  if (nac && def) return `${nac} — ${def}`
  return def || nac || ''
}

/** ¿Esta ficha cumple las dos condiciones para publicar su despedida? */
export function puedePublicarMemorial(cliente: Record<string, string>): { ok: boolean; motivo?: string } {
  if (String(cliente.memorial_consentimiento || '').toUpperCase() !== 'TRUE') {
    return { ok: false, motivo: 'el tutor no dio consentimiento' }
  }
  if (String(cliente.estado || '').toLowerCase() !== 'despachado') {
    return { ok: false, motivo: 'la mascota todavía no está entregada' }
  }
  if (String(cliente.memorial_publicado_at || '').trim()) {
    return { ok: false, motivo: 'ya se publicó su despedida' }
  }
  if (!primeraFoto(cliente, 'fotos_mascota')) {
    return { ok: false, motivo: 'el tutor no subió una foto' }
  }
  return { ok: true }
}

/** Logos del banco para la plantilla (mismo criterio que el generador de piezas). */
async function logosDeMarca(): Promise<{ logoBlanco?: string; logoNavy?: string }> {
  try {
    const banco = await listarImagenes()
    const logos = banco.filter(i => i.grupo === 'marca' && i.url)
    const txt = (i: { descripcion?: string; tags?: string }) => `${i.descripcion || ''} ${i.tags || ''}`
    return {
      logoBlanco: logos.find(l => /blanc|white/i.test(txt(l)))?.url || logos[0]?.url,
      logoNavy: logos.find(l => /navy|azul/i.test(txt(l)))?.url || logos[0]?.url,
    }
  } catch { return {} }
}

/**
 * Arma la imagen de la historia (1080x1920 JPEG) y la deja en R2.
 * Devuelve la URL pública y qué plantilla salió sorteada.
 */
export async function generarImagenMemorial(
  cliente: Record<string, string>,
  opts: { plantilla?: string } = {},
): Promise<{ url: string; plantilla: string }> {
  const foto = primeraFoto(cliente, 'fotos_mascota')
  if (!foto) throw new Error('la ficha no tiene foto del tutor')

  // AL AZAR entre las 15 (salvo que se fuerce una, para las pruebas).
  const plantilla = opts.plantilla && PLANTILLAS_MEMORIAL.includes(opts.plantilla as never)
    ? opts.plantilla
    : PLANTILLAS_MEMORIAL[Math.floor(Math.random() * PLANTILLAS_MEMORIAL.length)]

  const { logoBlanco, logoNavy } = await logosDeMarca()
  const { html } = construirPlantilla(plantilla, {
    eyebrow: EYEBROWS[Math.floor(Math.random() * EYEBROWS.length)],
    titulo: (cliente.nombre_mascota || '').trim(),
    fechas: rangoFechas(cliente),
    // La dedicatoria es TAL CUAL la escribió el tutor. No se reescribe ni se
    // "mejora" con IA: es su voz, y publicarla cambiada sería traicionarla.
    bajada: (cliente.memorial_comentario || '').trim(),
    // `url` salta la generación por IA: se usa la foto real de la mascota.
    foto: { url: foto },
  }, { formato: 'story', logoBlanco, logoNavy })

  const { buffer: png } = await renderGraficoHTML({ html, width: 1080, height: 1920 })
  // Instagram solo acepta JPEG; `flatten` saca cualquier transparencia.
  const jpg = await (await getSharp())(png).flatten({ background: '#143C64' }).jpeg({ quality: 92 }).toBuffer()
  const key = `memoriales/${cliente.codigo || cliente.id}-${Date.now()}.jpg`
  const up = await uploadToR2(jpg, key, 'image/jpeg')
  return { url: up.url, plantilla }
}

/**
 * Publica la historia de despedida de una ficha si corresponde. Best-effort:
 * devuelve el resultado y NUNCA lanza.
 *
 * `clienteId` se relee de la base a propósito: el caller suele tener la fila de
 * antes de marcar la entrega.
 */
export async function publicarMemorialSiCorresponde(clienteId: string): Promise<ResultadoMemorial> {
  try {
    const id = String(clienteId || '').trim()
    if (!id) return { ok: false, motivo: 'sin id de ficha' }
    if (!isInstagramConfigurado()) return { ok: false, motivo: 'Instagram no configurado' }

    const rows = await getSheetData('clientes')
    const cliente = rows.find(r => String(r.id) === id)
    if (!cliente) return { ok: false, motivo: 'ficha no encontrada' }

    const permiso = puedePublicarMemorial(cliente)
    if (!permiso.ok) return { ok: false, motivo: permiso.motivo }

    const { url, plantilla } = await generarImagenMemorial(cliente)
    const pub = await publicarHistoriaInstagram({ imagenUrl: url })

    // Se sella DESPUÉS de publicar: si Instagram falla, la ficha queda sin
    // marcar y el próximo intento la vuelve a tomar. `updateByIdIf` con la guarda
    // vacía evita que dos entregas simultáneas publiquen dos veces.
    await updateByIdIf('clientes', id, { memorial_publicado_at: '' }, {
      memorial_publicado_at: new Date().toISOString(),
      memorial_story_id: pub.id,
      memorial_plantilla: plantilla,
    }).catch(e => { console.warn('[memorial] no se pudo sellar la ficha:', e) })

    return { ok: true, storyId: pub.id, plantilla, imagenUrl: url }
  } catch (e) {
    console.warn('[memorial] no se pudo publicar la despedida:', e)
    return { ok: false, motivo: e instanceof Error ? e.message : String(e) }
  }
}
