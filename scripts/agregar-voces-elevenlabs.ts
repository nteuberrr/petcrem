import './_env-preload'
import { writeFileSync } from 'fs'
import { VOCES } from '../lib/elevenlabs'

/**
 * Deja en la cuenta de ElevenLabs las voces que usa la locución de Marketing.
 *
 * Las voces de `lib/elevenlabs.ts` son de la BIBLIOTECA PÚBLICA: para poder
 * sintetizar con ellas hay que agregarlas una vez a la cuenta. Es idempotente
 * (si ya está, la saltea).
 *
 *   npx tsx scripts/agregar-voces-elevenlabs.ts            solo agrega
 *   npx tsx scripts/agregar-voces-elevenlabs.ts --muestras agrega y genera un MP3 de prueba por voz
 */

const API = 'https://api.elevenlabs.io/v1'
const KEY = (process.env.ELEVENLABS_API_KEY || '').trim()
const H = { 'xi-api-key': KEY, 'Content-Type': 'application/json' }
const MUESTRAS = process.argv.includes('--muestras')
const DESTINO = process.argv.find(a => a.startsWith('--destino='))?.split('=')[1] || '.'

/** Texto de prueba: la voz de marca real, para juzgar el tono y no la dicción. */
const GUION_MUESTRA =
  'Cuando una mascota parte, lo último que uno quiere es preocuparse por trámites. ' +
  'En Alma Animal la cremación se hace en nuestras propias instalaciones, con trazabilidad de principio a fin, ' +
  'y te devolvemos sus cenizas en cuatro días hábiles. Estamos todos los días, de nueve de la mañana a diez de la noche.'

async function buscarEnBiblioteca(vozId: string, nombre: string) {
  const url = new URL(`${API}/shared-voices`)
  url.searchParams.set('language', 'es')
  url.searchParams.set('page_size', '100')
  const r = await fetch(url, { headers: H })
  if (!r.ok) throw new Error(`shared-voices ${r.status}`)
  const j = await r.json() as { voices?: Array<Record<string, unknown>> }
  return (j.voices || []).find(v => v.voice_id === vozId)
    || (j.voices || []).find(v => String(v.name || '').toLowerCase().startsWith(nombre.toLowerCase()))
}

async function main() {
  if (!KEY) { console.error('Falta ELEVENLABS_API_KEY en .env.local'); process.exit(1) }

  const enCuenta = await (async () => {
    const r = await fetch(`${API}/voices`, { headers: H })
    const j = await r.json() as { voices?: Array<{ voice_id: string; name: string }> }
    return new Map((j.voices || []).map(v => [v.voice_id, v.name]))
  })()

  for (const voz of VOCES) {
    if (enCuenta.has(voz.id)) {
      console.log(`• ${voz.nombre}: ya estaba en la cuenta`)
    } else {
      const lib = await buscarEnBiblioteca(voz.id, voz.nombreBiblioteca)
      if (!lib) { console.log(`⚠️  ${voz.nombre}: no la encontré en la biblioteca pública`); continue }
      const owner = String(lib.public_owner_id || '')
      const r = await fetch(`${API}/voices/add/${owner}/${lib.voice_id}`, {
        method: 'POST', headers: H,
        body: JSON.stringify({ new_name: `${voz.nombre} (Alma Animal)` }),
      })
      if (!r.ok) { console.log(`⚠️  ${voz.nombre}: no se pudo agregar — ${r.status} ${(await r.text()).slice(0, 160)}`); continue }
      console.log(`✅ ${voz.nombre}: agregada (owner ${owner})`)
    }

    if (MUESTRAS) {
      const r = await fetch(`${API}/text-to-speech/${voz.id}`, {
        method: 'POST', headers: H,
        body: JSON.stringify({
          text: GUION_MUESTRA,
          model_id: process.env.ELEVENLABS_MODEL || 'eleven_multilingual_v2',
          voice_settings: { stability: 0.55, similarity_boost: 0.8, style: 0.15, use_speaker_boost: true },
        }),
      })
      if (!r.ok) { console.log(`   muestra: falló (${r.status} ${(await r.text()).slice(0, 160)})`); continue }
      const archivo = `${DESTINO}/muestra-${voz.nombre.toLowerCase()}.mp3`
      writeFileSync(archivo, Buffer.from(await r.arrayBuffer()))
      console.log(`   muestra → ${archivo}`)
    }
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
