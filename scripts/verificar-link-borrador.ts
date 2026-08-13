import './_env-preload'
import { createBorradorToken, verifyBorradorToken, linkBorrador } from '../lib/borrador-token'

/**
 * VERIFICA EL LINK CORTO DEL BORRADOR: ida y vuelta, rechazos y —lo que motivó
 * el cambio— el LARGO real del mensaje que le llega al tutor.
 *
 *   npx tsx scripts/verificar-link-borrador.ts
 */
let fallas = 0
const ok = (s: string) => console.log(`  ✓ ${s}`)
const mal = (s: string) => { console.log(`  ✗ ${s}`); fallas++ }

function main() {
  console.log('── Ida y vuelta ──')
  for (const id of ['1', '404', '99999']) {
    const t = createBorradorToken(id)
    const v = verifyBorradorToken(t)
    if (v.ok && v.clienteId === id) ok(`id ${id} → «${t}» (${t.length} car)`)
    else mal(`id ${id}: ${JSON.stringify(v)}`)
  }

  console.log('\n── Rechazos ──')
  const base = createBorradorToken('404')
  const pruebas: Array<[string, string, string]> = [
    ['firma cambiada', base.slice(0, -1) + (base.endsWith('a') ? 'b' : 'a'), 'invalid_signature'],
    ['otro id, misma firma', base.replace(/^[^.]+/, 'zz'), 'invalid_signature'],
    ['vencido', createBorradorToken('404', -10), 'expired'],
    ['basura', 'no-es-un-token', 'malformed'],
    ['vacío', '', 'malformed'],
  ]
  for (const [nombre, token, esperado] of pruebas) {
    const v = verifyBorradorToken(token)
    if (!v.ok && v.error === esperado) ok(`${nombre} → ${v.error}`)
    else mal(`${nombre}: esperaba ${esperado}, dio ${JSON.stringify(v)}`)
  }

  console.log('\n── Compatibilidad con los links ya enviados ──')
  // Formato viejo (JSON en base64 + firma completa), armado igual que antes.
  const crypto = require('node:crypto') as typeof import('node:crypto')
  const b64url = (b: Buffer) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  const payload = b64url(Buffer.from(JSON.stringify({ cid: '404', t: 'completar_ficha', exp: Math.floor(Date.now() / 1000) + 3600 })))
  const firma = b64url(crypto.createHmac('sha256', process.env.NEXTAUTH_SECRET || '').update(payload).digest())
  const viejo = `${payload}.${firma}`
  const v = verifyBorradorToken(viejo)
  if (v.ok && v.clienteId === '404') ok(`el formato viejo sigue valiendo (${viejo.length} car)`)
  else mal(`el formato viejo dejó de andar: ${JSON.stringify(v)} — hay links circulando hasta 30 días`)

  console.log('\n── Largo del link ──')
  const b = process.env.NEXTAUTH_URL || 'https://petcrem.vercel.app'
  const corto = linkBorrador('404', b)
  const largo = `${b.replace(/\/$/, '')}/registro-mascota?ficha=${viejo}`
  console.log(`  antes: ${largo.length} car  ${largo.slice(0, 78)}…`)
  console.log(`  ahora: ${corto.length} car  ${corto}`)
  if (corto.length < largo.length / 2) ok(`quedó menos de la mitad (−${largo.length - corto.length} caracteres)`)
  else mal('no se acortó lo suficiente')

  console.log(fallas === 0 ? '\n✅ Todo en orden.' : `\n❌ ${fallas} problema(s).`)
  process.exit(fallas === 0 ? 0 : 1)
}
main()
