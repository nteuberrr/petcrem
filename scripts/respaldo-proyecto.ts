import './_env-preload'
import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { readFileSync, unlinkSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { uploadToR2 } from '../lib/cloudflare-r2'

/**
 * Snapshot COMPLETO del proyecto (código + config) → Cloudflare R2, como respaldo
 * INDEPENDIENTE de GitHub. Comprime todo el repo (excluye node_modules/.next/.git
 * y las carpetas de respaldo de datos) y lo sube a backups/codigo/petcrem-<ts>.tgz.
 *
 * ⚠️ Por defecto INCLUYE .env.local (claves/tokens) para que el respaldo sea
 *    restaurable de una. El objeto en R2 es privado (no se sirve por la URL pública).
 *    Si NO quieres incluir secretos:  npx tsx scripts/respaldo-proyecto.ts --sin-env
 *
 * Uso:  npx tsx scripts/respaldo-proyecto.ts
 *
 * Nota: el código versionado ya vive en GitHub (git push). Esto es una capa extra.
 */

async function main() {
  const sinEnv = process.argv.includes('--sin-env')
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  // Salida con ruta RELATIVA (sin "C:") → funciona con GNU tar y con el bsdtar de
  // Windows sin --force-local. Va en la raíz del repo y se excluye con *.tgz.
  const tmpName = '._respaldo_proyecto_tmp.tgz'
  const tmpPath = join(process.cwd(), tmpName)

  const excludes = [
    './node_modules', './.next', './.git',
    './respaldo sheets', './respaldo postgres',
    '*.tgz',
  ]
  if (sinEnv) { excludes.push('./.env.local', './.env*') }

  const args = ['-czf', tmpName, ...excludes.flatMap(e => ['--exclude', e]), '.']
  console.log(`Comprimiendo proyecto${sinEnv ? ' (sin .env.local)' : ' (incluye .env.local)'}…`)
  execFileSync('tar', args, { cwd: process.cwd() })

  const buf = readFileSync(tmpPath)
  const mb = (statSync(tmpPath).size / 1024 / 1024).toFixed(2)
  // Sufijo aleatorio: el bucket tiene dominio público (sin listing) y este tgz
  // incluye .env.local — una key por timestamp sería adivinable.
  const key = `backups/codigo/petcrem-${stamp}-${randomBytes(16).toString('hex')}.tgz`
  const up = await uploadToR2(buf, key, 'application/gzip')
  try { unlinkSync(tmpPath) } catch { /* */ }

  console.log(`\n✅ Snapshot del proyecto subido a R2 (${mb} MB)`)
  console.log(`   key: ${up.key}`)
}

main().catch(e => { console.error('❌ Error en el respaldo del proyecto:', e); process.exit(1) })
