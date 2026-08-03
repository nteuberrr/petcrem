import './_env-preload'
import bcrypt from 'bcryptjs'
import { getSheetData, updateById } from '../lib/datastore'

/**
 * Deja a Oscar y Juan con sus correos personales (los que usan de verdad) en las
 * DOS tablas donde importan:
 *   - `usuarios`        → con qué correo entran a la app (+ su clave)
 *   - `rrhh_empleados`  → a qué correo les llega la liquidación de sueldo
 *
 * Es idempotente: correrlo dos veces deja lo mismo. El correo se guarda en
 * minúsculas (Gmail no distingue mayúsculas y el login compara normalizado).
 *
 *   npx tsx scripts/actualizar-credenciales-equipo.ts          (muestra qué haría)
 *   npx tsx scripts/actualizar-credenciales-equipo.ts --apply  (lo aplica)
 */

const PERSONAS = [
  { usuario: 'Oscar', empleado: 'OSCAR', email: 'munoz.oscar.n@gmail.com', clave: 'oscar123' },
  { usuario: 'Juan', empleado: 'JUAN', email: 'juanmiguel7palencia@gmail.com', clave: 'juan123' },
]

const APPLY = process.argv.includes('--apply')

async function main() {
  const [usuarios, empleados] = await Promise.all([
    getSheetData('usuarios'),
    getSheetData('rrhh_empleados'),
  ])

  for (const p of PERSONAS) {
    const u = usuarios.find(x => (x.nombre || '').trim().toLowerCase() === p.usuario.toLowerCase())
    if (!u) {
      console.log(`⚠️  usuarios: no encontré a "${p.usuario}" — no toco nada.`)
    } else {
      console.log(`usuarios #${u.id} ${u.nombre}: ${u.email} → ${p.email} (clave: ${p.clave})`)
      if (APPLY) {
        await updateById('usuarios', u.id, { ...u, email: p.email, password: bcrypt.hashSync(p.clave, 10) })
      }
    }

    const e = empleados.find(x => (x.nombre_completo || '').toUpperCase().includes(p.empleado))
    if (!e) {
      console.log(`⚠️  rrhh_empleados: no encontré a "${p.empleado}" — no toco nada.`)
    } else {
      console.log(`rrhh_empleados #${e.id} ${e.nombre_completo}: "${e.email}" → ${p.email}`)
      if (APPLY) await updateById('rrhh_empleados', e.id, { ...e, email: p.email })
    }
  }

  console.log(APPLY ? '\n✅ Aplicado.' : '\n(dry-run: agrega --apply para aplicarlo)')
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
