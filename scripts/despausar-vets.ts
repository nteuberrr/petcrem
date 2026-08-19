import './_env-preload'
import { getMensajesSupabase } from '../lib/supabase'
import { telefonosVet } from '../lib/vet-lookup'

/**
 * Despausa las conversaciones de VETERINARIOS que quedaron con el agente apagado.
 *
 * Por qué (dueño 2026-08-18): la coordinación de eutanasias por WhatsApp marcaba
 * la conversación del vet como 'pausado' para que el bot de tutores no le
 * contestara precios de cremación. La pausa quedaba puesta PARA SIEMPRE: días
 * después esa misma veterinaria escribía para agendar un retiro de su clínica y
 * el agente estaba mudo (caso Daniella). Eso ya no se hace más
 * (lib/eutanasia-whatsapp) y el agente ahora sabe cuándo le habla un vet
 * (lib/vet-contexto), pero las conversaciones viejas siguen pausadas: esto las
 * limpia de una vez.
 *
 *   npx tsx scripts/despausar-vets.ts            # solo lista (dry-run)
 *   npx tsx scripts/despausar-vets.ts --aplicar  # las despausa
 *
 * NO toca las marcadas 'requiere-humano': esas las pausó alguien del equipo a
 * propósito y las está atendiendo una persona.
 */

const APLICAR = process.argv.includes('--aplicar')

interface Fila {
  id: number
  estado: string | null
  etiquetas: string[] | null
  contacto: { nombre: string | null; telefono: string | null; wa_id: string | null } | null
}

async function main() {
  const sb = getMensajesSupabase()
  const vets = await telefonosVet()
  console.log(`Teléfonos de veterinarios en base: ${vets.size}`)

  const { data, error } = await sb
    .from('mensajes_conversaciones')
    .select('id, estado, etiquetas, contacto:mensajes_contactos(nombre, telefono, wa_id)')
    .contains('etiquetas', ['pausado'])
  if (error) throw new Error(error.message)

  const tel9 = (t?: string | null) => (t || '').replace(/\D/g, '').slice(-9)
  const filas = ((data ?? []) as unknown as Fila[]).filter(f => {
    const tags = f.etiquetas || []
    if (tags.includes('requiere-humano')) return false
    const t = tel9(f.contacto?.wa_id) || tel9(f.contacto?.telefono)
    // 'veterinario' cubre a los que el webhook ya clasificó aunque su número haya
    // cambiado de formato en la base de vets.
    return vets.has(t) || (f.estado || '') === 'veterinario'
  })

  if (filas.length === 0) {
    console.log('No hay conversaciones de veterinarios pausadas. Nada que hacer.')
    return
  }

  console.log(`\nConversaciones de veterinarios PAUSADAS: ${filas.length}`)
  for (const f of filas) {
    console.log(`  #${f.id}  ${f.contacto?.nombre || '(sin nombre)'}  ${f.contacto?.telefono || ''}  [${(f.etiquetas || []).join(', ')}]`)
  }

  if (!APLICAR) {
    console.log('\n(dry-run) Volvé a correrlo con --aplicar para despausarlas.')
    return
  }

  let ok = 0
  for (const f of filas) {
    const etiquetas = (f.etiquetas || []).filter(t => t !== 'pausado')
    const { error: e } = await sb.from('mensajes_conversaciones').update({ etiquetas }).eq('id', f.id)
    if (e) console.warn(`  #${f.id} falló: ${e.message}`)
    else ok++
  }
  console.log(`\nDespausadas: ${ok}/${filas.length}`)
}

main().catch(e => { console.error(e); process.exit(1) })
