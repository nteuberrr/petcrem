/**
 * Verifica que TODA página y ruta de API esté cubierta por un módulo de
 * lib/permisos (o sea pública / de Configuración Avanzada).
 *
 * Importa porque el proxy es FAIL-CLOSED: una ruta que no matchea ningún módulo
 * queda bloqueada para todos menos el dueño — y el síntoma es un 403 silencioso o
 * un ítem del sidebar que no aparece, difícil de atribuir. Correr al sumar una
 * pantalla o un endpoint.
 *
 * Uso:  npx tsx scripts/verificar-cobertura-permisos.ts
 */
import { readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { MODULOS } from '../lib/permisos'
import { APIS_AVANZADAS } from '../lib/roles'

// Rutas públicas declaradas en proxy.ts (no necesitan módulo).
const PUBLICAS = [
  '/api/auth', '/api/init-sheets', '/api/reorder-columns', '/api/backup', '/api/web-vitals',
  '/api/mailing/webhooks', '/api/mailing/pixel', '/api/mailing/click', '/api/mensajes/webhook',
  '/api/mailing/cron-publicar', '/api/mensajes/cron-archivar', '/api/mensajes/cron-seguimiento',
  '/api/cron', '/api/veterinarios/inscribir', '/api/veterinarios/precios-convenio',
  '/api/clientes/completar-borrador', '/api/clientes/foto', '/api/clientes/video',
  '/api/pago', '/api/eutanasias/precios', '/api/eutanasias/vets/inscribir',
  '/api/eutanasias/comunas', '/api/eutanasias/cotizaciones/aceptar',
  '/api/eutanasias/cotizaciones/realizado', '/api/eutanasias/cotizaciones/no-realizado',
  '/api/eutanasias/cotizaciones/cliente-confirmar', '/api/eutanasias/cotizaciones/hora-retiro',
  '/api/eutanasias/vets/datos-pago', '/api/eutanasias/vets/mis-datos', '/api/mis-modulos',
]

function cubierta(ruta: string): boolean {
  if (PUBLICAS.some(p => ruta === p || ruta.startsWith(p + '/'))) return true
  if (APIS_AVANZADAS.some(p => ruta === p || ruta.startsWith(p + '/'))) return true
  return MODULOS.some(m =>
    [...m.pages, ...m.apis, ...(m.soloLectura || [])].some(p => ruta === p || ruta.startsWith(p + '/')))
}

function rutasDe(base: string, prefijo: string, out: string[] = []): string[] {
  if (!existsSync(base)) return out
  for (const e of readdirSync(base, { withFileTypes: true })) {
    if (!e.isDirectory()) continue
    if (e.name.startsWith('[') || e.name.startsWith('(') || e.name.startsWith('_')) {
      rutasDe(join(base, e.name), e.name.startsWith('(') ? prefijo : `${prefijo}/${e.name}`, out)
      continue
    }
    const ruta = `${prefijo}/${e.name}`
    const dir = join(base, e.name)
    if (existsSync(join(dir, 'route.ts')) || existsSync(join(dir, 'page.tsx'))) out.push(ruta)
    rutasDe(dir, ruta, out)
  }
  return out
}

const apis = rutasDe(join(process.cwd(), 'app', 'api'), '/api')
const paginas = rutasDe(join(process.cwd(), 'app', '(dashboard)'), '')

const huerfanas = [...paginas, ...apis].filter(r => !cubierta(r))
if (huerfanas.length === 0) {
  console.log(`✅ Cobertura completa: ${paginas.length} páginas + ${apis.length} rutas de API, todas con módulo (o públicas / Config Avanzada).`)
} else {
  console.log(`⚠️  ${huerfanas.length} ruta(s) SIN módulo → el proxy las bloquea a todos menos al dueño:`)
  for (const r of huerfanas) console.log('   ' + r)
}
