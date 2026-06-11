import './_env-preload'
import bcrypt from 'bcryptjs'
import { getSheetData, updateById } from '../lib/datastore'

// ─────────────────────────────────────────────────────────────────────────────
// Hashea con bcrypt los passwords de 'usuarios' que siguen en texto plano
// (los que no matchean /^\$2[aby]\$/). Idempotente: salta los ya hasheados.
//
// ⚠️ Correr SOLO DESPUÉS de deployar el código que soporta hashes (lib/auth.ts):
// el código viejo en prod compara texto plano y el hasheo rompería esos logins.
//
// Por seguridad corre en DRY-RUN por defecto (lista emails afectados, nunca
// muestra el password en claro). Para escribir:
//   npx tsx scripts/hash-passwords.ts --apply
//
// Respeta DATA_BACKEND (.env.local). OJO: en producción apunta a la base real.
// ─────────────────────────────────────────────────────────────────────────────

const BCRYPT_RE = /^\$2[aby]\$/

const apply = process.argv.includes('--apply')

async function main() {
  console.log(apply ? '⚙️  APLICANDO cambios…\n' : '🔎 DRY-RUN (no escribe). Usa --apply para guardar.\n')
  const usuarios = await getSheetData('usuarios')
  let cambios = 0
  for (const u of usuarios) {
    const pw = u.password ?? ''
    if (!pw || BCRYPT_RE.test(pw)) continue
    cambios++
    console.log(`  [usuarios #${u.id}] ${u.email} — password en texto plano${apply ? ' → hasheado' : ''}`)
    if (apply) {
      await updateById('usuarios', u.id, { ...u, password: bcrypt.hashSync(pw, 10) })
    }
  }
  console.log(`\n${apply ? '✅ Listo. ' : 'DRY-RUN — '}${cambios} usuario(s) ${apply ? 'hasheados' : 'a hashear'} (de ${usuarios.length}).`)
  if (!apply && cambios > 0) console.log('Para aplicar:  npx tsx scripts/hash-passwords.ts --apply')
}

main().catch(e => { console.error('❌', e); process.exit(1) })
