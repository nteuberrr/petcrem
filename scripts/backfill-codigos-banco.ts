import './_env-preload'
import { getSheetData, updateById } from '../lib/datastore'

/**
 * Backfill de los códigos legibles del banco (i-N / C-X.Y / v-N / ai-N) sobre lo
 * YA existente, por antigüedad (id ascendente = i-1 la más vieja). Idempotente:
 * salta las filas que ya tienen `codigo`, así se puede correr varias veces.
 *
 *   npx tsx scripts/backfill-codigos-banco.ts
 *
 * Clasificación de imágenes:
 *   - C-X.Y (publicación) si la fila es una pieza de campaña: pseudo-código viejo en
 *     la descripción (C-<itemId>.<n>), gráfico satori, subgrupo 'grafico' o tags
 *     con 'grafico'/'edicion'. Las de pieza vieja se agrupan por su itemId.
 *   - i-N en el resto (fotos sueltas y subidas).
 * Videos: ai-N si se animó desde una imagen (imagen_origen), si no v-N.
 */

const TABLE_IMG = 'mailing_imagenes'
const TABLE_VID = 'mailing_videos'
const num = (s: string) => parseInt(s, 10) || 0

async function backfillImagenes() {
  const rows = (await getSheetData(TABLE_IMG)).slice().sort((a, b) => num(a.id) - num(b.id))
  let iN = 0
  let campN = 0
  const subgrupoToCamp = new Map<string, number>() // título de campaña → nº de campaña
  const campY = new Map<number, number>()          // nº de campaña → último índice .Y
  let updated = 0
  let skipped = 0
  for (const row of rows) {
    if ((row.codigo || '').trim()) { skipped++; continue }
    const tags = (row.tags || '').toLowerCase()
    const modelo = (row.modelo || '').toLowerCase()
    const subgrupo = (row.subgrupo || '').trim()
    let codigo = ''
    if (modelo === 'satori' || /edicion/.test(tags)) {
      // Gráfico final (satori) o edición de pieza = publicación individual → C-X.1.
      codigo = `C-${++campN}.1`
    } else if (subgrupo && subgrupo.toLowerCase() !== 'grafico') {
      // Pieza/publicación generada por el agente: el subgrupo es el TÍTULO de la
      // campaña → agrupar todas sus imágenes en una misma C-X (carrusel, portadas
      // viejas vía nano-banana, etc.). 'grafico' se excluye: esas son la FOTO interna
      // de una portada satori → fotos → i-.
      if (!subgrupoToCamp.has(subgrupo)) subgrupoToCamp.set(subgrupo, ++campN)
      const camp = subgrupoToCamp.get(subgrupo)!
      const y = (campY.get(camp) || 0) + 1
      campY.set(camp, y)
      codigo = `C-${camp}.${y}`
    } else {
      codigo = `i-${++iN}`
    }
    await updateById(TABLE_IMG, row.id, { ...row, codigo })
    updated++
  }
  console.log(`Imágenes: ${updated} actualizadas, ${skipped} ya tenían código. (i hasta i-${iN}, campañas hasta C-${campN})`)
}

async function backfillVideos() {
  const rows = (await getSheetData(TABLE_VID)).slice().sort((a, b) => num(a.id) - num(b.id))
  let vN = 0
  let aiN = 0
  let updated = 0
  let skipped = 0
  for (const row of rows) {
    if ((row.codigo || '').trim()) { skipped++; continue }
    const codigo = (row.imagen_origen || '').trim() ? `ai-${++aiN}` : `v-${++vN}`
    await updateById(TABLE_VID, row.id, { ...row, codigo })
    updated++
  }
  console.log(`Videos: ${updated} actualizados, ${skipped} ya tenían código. (v hasta v-${vN}, ai hasta ai-${aiN})`)
}

async function main() {
  await backfillImagenes()
  await backfillVideos()
  console.log('Backfill de códigos completo.')
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
