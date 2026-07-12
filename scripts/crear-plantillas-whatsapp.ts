import './_env-preload'
import { crearPlantillasFaltantes, listarPlantillasWhatsapp } from '../lib/whatsapp'

/**
 * Crea en Meta (envía a revisión) las plantillas de WhatsApp del catálogo
 * PLANTILLAS_WA (lib/whatsapp.ts) que aún no existan en la WABA. Idempotente:
 * correrlo de nuevo solo muestra el estado. Uso:
 *
 *   npx tsx scripts/crear-plantillas-whatsapp.ts
 *
 * La aprobación de Meta suele tardar minutos (utility) a horas (marketing).
 * Volver a correr el script para ver el estado actualizado.
 */
async function main() {
  console.log('Creando plantillas faltantes…\n')
  const resultados = await crearPlantillasFaltantes()
  for (const r of resultados) console.log(`- ${r.nombre}: ${r.resultado}`)

  console.log('\nEstado actual en Meta:')
  const estado = await listarPlantillasWhatsapp()
  if (!estado.length) console.log('(no se pudieron listar)')
  for (const p of estado) console.log(`- ${p.nombre} [${p.estado}] cat=${p.categoria} lang=${p.idioma}`)
}

main().catch(e => { console.error('ERROR:', e); process.exit(1) })
