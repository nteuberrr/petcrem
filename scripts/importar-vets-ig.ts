import './_env-preload'
import fs from 'fs'
import { getSheetData, appendRow, getNextId } from '../lib/datastore'
import { todayISO } from '../lib/dates'

/**
 * Importación puntual (2026-07-04): prospectos de veterinarias extraídos de
 * capturas de Instagram (12 lotes JSON generados por agentes de visión).
 *   npx tsx scripts/importar-vets-ig.ts <carpeta-con-vets-lote-*.json>
 * Dedup: dentro del lote (email → instagram → nombre) y contra la base
 * mailing_veterinarios (por email). Inserta categoria='prospecto'.
 */

interface Rec { archivo?: string; veterinaria?: string; instagram?: string; email?: string; telefono?: string; direccion?: string; comuna?: string; notas?: string }

const norm = (s?: string) => (s || '').trim()
const normKey = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9@]/g, '')

async function main() {
  const dir = process.argv[2]
  if (!dir) { console.error('Falta la carpeta con vets-lote-*.json'); process.exit(1) }
  const files = fs.readdirSync(dir).filter(f => /^vets-lote-\d+\.json$/.test(f)).sort()
  const registros: Rec[] = []
  for (const f of files) {
    try {
      const arr = JSON.parse(fs.readFileSync(`${dir}/${f}`, 'utf8'))
      if (Array.isArray(arr)) registros.push(...arr)
    } catch (e) { console.warn(`⚠ ${f} no parseable:`, e instanceof Error ? e.message : e) }
  }
  console.log(`Lotes: ${files.length} · registros brutos: ${registros.length}`)

  // Filtrar: necesita al menos nombre de veterinaria o email.
  const utiles = registros.filter(r => norm(r.veterinaria) || norm(r.email))

  // Dedup interno: email → instagram → nombre normalizado.
  const vistos = new Set<string>()
  const unicos: Rec[] = []
  let dupInternos = 0
  for (const r of utiles) {
    const email = norm(r.email).toLowerCase()
    const ig = normKey(norm(r.instagram))
    const nom = normKey(norm(r.veterinaria))
    const key = email || (ig ? `ig:${ig}` : `n:${nom}`)
    if (!key || vistos.has(key)) { dupInternos++; continue }
    // También marcar las otras llaves del registro para atrapar duplicados cruzados.
    vistos.add(key)
    if (email) { if (ig) vistos.add(`ig:${ig}`); if (nom) vistos.add(`n:${nom}`) }
    else if (ig && nom) vistos.add(`n:${nom}`)
    unicos.push(r)
  }

  // Dedup contra la base actual (por email y por nombre de veterinaria).
  const base = await getSheetData('mailing_veterinarios')
  const emailsBase = new Set(base.map(b => (b.email || '').trim().toLowerCase()).filter(Boolean))
  const nombresBase = new Set(base.map(b => normKey(b.veterinaria || b.nombre || '')).filter(Boolean))

  let yaExistentes = 0
  let insertados = 0
  let sinEmail = 0
  const listaSinEmail: string[] = []
  for (const r of unicos) {
    const email = norm(r.email).toLowerCase()
    const nombreVet = norm(r.veterinaria) || norm(r.instagram) || '(sin nombre)'
    if (email && emailsBase.has(email)) { yaExistentes++; continue }
    if (!email && nombresBase.has(normKey(nombreVet))) { yaExistentes++; continue }

    const notas = [
      norm(r.instagram) && `IG: ${norm(r.instagram)}`,
      norm(r.direccion) && `Dir: ${norm(r.direccion)}`,
      norm(r.notas),
      'Importado de Instagram (jul 2026)',
    ].filter(Boolean).join(' · ')

    const id = await getNextId('mailing_veterinarios')
    await appendRow('mailing_veterinarios', {
      id,
      nombre: nombreVet,
      email,
      veterinaria: nombreVet,
      comuna: norm(r.comuna),
      telefono: norm(r.telefono),
      categoria: 'prospecto',
      suscrito: 'TRUE',
      notas,
      fecha_creacion: todayISO(),
    })
    insertados++
    if (!email) { sinEmail++; listaSinEmail.push(`${nombreVet}${norm(r.instagram) ? ` (${norm(r.instagram)})` : ''}`) }
    if (insertados % 25 === 0) console.log(`  …${insertados} insertados`)
  }

  console.log(`\nRESUMEN: útiles ${utiles.length} · duplicados internos ${dupInternos} · ya en la base ${yaExistentes} · INSERTADOS ${insertados} (${insertados - sinEmail} con email, ${sinEmail} sin email)`)
  if (listaSinEmail.length) console.log(`\nSin email (quedaron con teléfono/IG en notas):\n- ${listaSinEmail.join('\n- ')}`)
}

main()
