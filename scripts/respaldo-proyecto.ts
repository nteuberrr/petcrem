import './_env-preload'
import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { readFileSync, unlinkSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { uploadBackupToR2 } from '../lib/cloudflare-r2'

/**
 * Snapshot COMPLETO del proyecto (código + config) → Cloudflare R2, como respaldo
 * INDEPENDIENTE de GitHub. Comprime todo el repo (excluye node_modules/.next/.git
 * y las carpetas de respaldo de datos) y lo sube a backups/codigo/petcrem-<ts>.tgz.
 *
 * ⚠️ Por defecto INCLUYE .env.local (claves/tokens) para que el respaldo sea
 *    restaurable de una. Sube al bucket DEDICADO de respaldos (R2_BACKUP_BUCKET_NAME,
 *    sin dominio público) — si esa env var no está seteada, cae al bucket público
 *    de siempre (avisando por consola), que solo protege la key por ser inadivinable.
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

  // try/finally: el tgz temporal INCLUYE .env.local en texto plano — si algo falla
  // después de crearlo (ej. uploadToR2 sin conexión/credenciales), tiene que borrarse
  // igual. Antes solo se borraba tras un upload exitoso y un run fallido dejó el
  // archivo (con secretos de producción) suelto en la raíz del repo.
  try {
    console.log(`Comprimiendo proyecto${sinEnv ? ' (sin .env.local)' : ' (incluye .env.local)'}…`)
    execFileSync('tar', args, { cwd: process.cwd() })

    const buf = readFileSync(tmpPath)
    const mb = (statSync(tmpPath).size / 1024 / 1024).toFixed(2)
    // Sufijo aleatorio extra + bucket dedicado de respaldos (sin dominio público) —
    // este tgz incluye .env.local en texto plano.
    const key = `backups/codigo/petcrem-${stamp}-${randomBytes(16).toString('hex')}.tgz`
    const up = await uploadBackupToR2(buf, key, 'application/gzip')

    console.log(`\n✅ Snapshot del proyecto subido a R2 (${mb} MB)`)
    console.log(`   bucket: ${up.bucket}`)
    console.log(`   key: ${up.key}`)
  } finally {
    try { unlinkSync(tmpPath) } catch { /* nunca se llegó a crear, ok */ }
  }
}

main().catch(e => { console.error('❌ Error en el respaldo del proyecto:', e); process.exit(1) })
