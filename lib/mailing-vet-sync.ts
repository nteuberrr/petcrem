import { getSheetData, appendRow, getNextId, updateById } from './datastore'
import { todayISO } from './dates'

/**
 * REGLA AUTOMÁTICA (decisión del dueño 2026-07-04): todo veterinario inscrito
 * al CONVENIO de cremación (hoja `veterinarios`) queda en la base de Mailing
 * (`mailing_veterinarios`) como categoría **cliente** — nunca "prospecto",
 * porque ya trabaja con nosotros y las campañas de captación no le aplican.
 *
 * Upsert por email: si ya existe en la base se le actualiza la categoría (y se
 * completan datos vacíos); si no existe, se crea suscrito. Best-effort: un
 * fallo acá NUNCA rompe el alta del convenio.
 */
export async function sincronizarMailingCliente(vet: {
  correo: string
  nombre: string           // nombre de la clínica/veterinaria
  nombre_contacto?: string
  comuna?: string
  telefono?: string
}): Promise<void> {
  try {
    const email = (vet.correo || '').trim().toLowerCase()
    if (!email || !/\S+@\S+\.\S+/.test(email)) return

    const rows = await getSheetData('mailing_veterinarios')
    const existente = rows.find(r => (r.email || '').trim().toLowerCase() === email)

    if (existente) {
      await updateById('mailing_veterinarios', String(existente.id), {
        ...existente,
        categoria: 'cliente',
        // Completar solo lo que la base no tenga (sin pisar datos curados a mano).
        veterinaria: existente.veterinaria || vet.nombre || '',
        comuna: existente.comuna || vet.comuna || '',
        telefono: existente.telefono || vet.telefono || '',
      })
      return
    }

    const id = await getNextId('mailing_veterinarios')
    await appendRow('mailing_veterinarios', {
      id,
      nombre: (vet.nombre_contacto || vet.nombre || '').trim(),
      email,
      veterinaria: vet.nombre || '',
      comuna: vet.comuna || '',
      telefono: vet.telefono || '',
      categoria: 'cliente',
      suscrito: 'TRUE',
      notas: 'Convenio de cremación (sync automático)',
      fecha_creacion: todayISO(),
    })
  } catch (e) {
    console.warn('[mailing-vet-sync] no se pudo sincronizar a la base de mailing:', e instanceof Error ? e.message : String(e))
  }
}
