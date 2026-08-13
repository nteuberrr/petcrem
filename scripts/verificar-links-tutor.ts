import './_env-preload'
import { createTutorToken, verifyTutorToken, accionDeToken, type AccionTutor } from '../lib/tutor-token'
import { BASE_PUBLICA } from '../lib/whatsapp'

/**
 * VERIFICA LOS LINKS CORTOS DEL TUTOR (subir foto / ver certificado): ida y
 * vuelta, que un token de una acción NO sirva para otra, rechazos, el formato
 * viejo de los correos ya enviados, y el largo real del link.
 *
 *   npx tsx scripts/verificar-links-tutor.ts
 */
let fallas = 0
const ok = (s: string) => console.log(`  ✓ ${s}`)
const mal = (s: string) => { console.log(`  ✗ ${s}`); fallas++ }

function main() {
  const acciones: AccionTutor[] = ['subir_foto', 'subir_foto_cuadro', 'solicitar_video', 'ver_certificado']

  console.log('── Ida y vuelta ──')
  for (const a of acciones) {
    const t = createTutorToken('404', a)
    const v = verifyTutorToken(t, a)
    if (v.ok && v.clienteId === '404' && accionDeToken(t) === a) ok(`${a.padEnd(18)} «${t}» (${t.length} car)`)
    else mal(`${a}: ${JSON.stringify(v)} · accionDeToken=${accionDeToken(t)}`)
  }

  console.log('\n── Un token NO sirve para otra acción ──')
  const tFoto = createTutorToken('404', 'subir_foto')
  for (const a of acciones.filter(x => x !== 'subir_foto')) {
    const v = verifyTutorToken(tFoto, a)
    if (!v.ok) ok(`token de subir_foto rechazado como ${a} (${v.error})`)
    else mal(`¡el token de subir_foto pasó como ${a}!`)
  }

  console.log('\n── Rechazos ──')
  for (const [nombre, token, esperado] of [
    ['firma cambiada', tFoto.slice(0, -1) + (tFoto.endsWith('a') ? 'b' : 'a'), 'invalid_signature'],
    ['otro id', tFoto.replace(/^[^.]+/, 'zz'), 'invalid_signature'],
    ['vencido', createTutorToken('404', 'subir_foto', -10), 'expired'],
    ['basura', 'no-vale', 'malformed'],
  ] as Array<[string, string, string]>) {
    const v = verifyTutorToken(token, 'subir_foto')
    if (!v.ok && v.error === esperado) ok(`${nombre} → ${v.error}`)
    else mal(`${nombre}: esperaba ${esperado}, dio ${JSON.stringify(v)}`)
  }

  console.log('\n── Compatibilidad con los correos ya enviados ──')
  const crypto = require('node:crypto') as typeof import('node:crypto')
  const b64url = (b: Buffer) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  const payload = b64url(Buffer.from(JSON.stringify({ cid: '404', t: 'subir_foto', exp: Math.floor(Date.now() / 1000) + 3600 })))
  const viejo = `${payload}.${b64url(crypto.createHmac('sha256', process.env.NEXTAUTH_SECRET || '').update(payload).digest())}`
  const v = verifyTutorToken(viejo, 'subir_foto')
  if (v.ok && v.clienteId === '404') ok(`el formato viejo sigue valiendo (${viejo.length} car)`)
  else mal(`el formato viejo dejó de andar: ${JSON.stringify(v)}`)

  console.log('\n── Largo del link ──')
  const cortoFoto = `${BASE_PUBLICA}/p/${createTutorToken('404', 'subir_foto')}`
  const cortoCert = `${BASE_PUBLICA}/c/${createTutorToken('404', 'ver_certificado')}`
  const largo = `${BASE_PUBLICA}/subir-foto?token=${encodeURIComponent(viejo)}`
  console.log(`  antes: ${largo.length} car`)
  console.log(`  foto : ${cortoFoto.length} car  ${cortoFoto}`)
  console.log(`  cert : ${cortoCert.length} car  ${cortoCert}`)
  if (cortoFoto.length < largo.length / 2) ok('el link quedó menos de la mitad')
  else mal('no se acortó lo suficiente')

  console.log(fallas === 0 ? '\n✅ Todo en orden.' : `\n❌ ${fallas} problema(s).`)
  process.exit(fallas === 0 ? 0 : 1)
}
main()
