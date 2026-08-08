/**
 * Verifica la HOJA DE RUTA del repartidor sin levantar el servidor:
 *
 *   npx tsx scripts/verificar-hoja-ruta.ts
 *
 *  1. El token firma y verifica de ida y vuelta, y rechaza lo que tiene que
 *     rechazar (firma alterada, payload de otro tipo, vencido).
 *  2. Sobre una ruta REAL, arma las paradas igual que el endpoint público y
 *     comprueba que cada una traiga los datos de la etiqueta.
 *
 * ⚠️ Firma con el NEXTAUTH_SECRET de .env.local: los tokens que salgan de acá
 * NO sirven en producción (ni al revés).
 */
import './_env-preload'
import { getSheetData } from '../lib/datastore'
import { crearRutaToken, verificarRutaToken } from '../lib/ruta-token'
import { datosEtiqueta } from '../lib/etiqueta-datos'

let fallos = 0
function chequear(titulo: string, obtenido: unknown, esperado: unknown) {
  const ok = JSON.stringify(obtenido) === JSON.stringify(esperado)
  if (!ok) fallos++
  console.log(`${ok ? '  ok  ' : ' FALLA'} ${titulo}${ok ? '' : `\n         esperado ${JSON.stringify(esperado)}\n         obtenido ${JSON.stringify(obtenido)}`}`)
}

async function main() {
  // ── 1. Token ───────────────────────────────────────────────────────────────
  const tok = crearRutaToken('123')
  chequear('el token de ida y vuelta devuelve el despacho', verificarRutaToken(tok).despachoId, '123')

  const [payload, firma] = tok.split('.')
  chequear('firma alterada → rechazado',
    verificarRutaToken(`${payload}.${firma.slice(0, -2)}xy`).ok, false)
  chequear('payload alterado → rechazado',
    verificarRutaToken(`${payload.slice(0, -2)}xy.${firma}`).ok, false)
  chequear('token sin punto → rechazado', verificarRutaToken('cualquiercosa').ok, false)
  chequear('token vencido → rechazado', verificarRutaToken(crearRutaToken('123', -10)).error, 'expired')

  // ── 2. Datos de una ruta real ──────────────────────────────────────────────
  const despachos = await getSheetData('despachos')
  const viva = despachos.find(d => String(d.estado_ruta || '') !== 'terminada') ?? despachos[despachos.length - 1]
  if (!viva) { console.log('\n(sin despachos en la base: no se puede probar el armado)'); return }

  let mascotasIds: string[] = []
  try { mascotasIds = JSON.parse(viva.mascotas_ids || '[]') } catch {}
  const clientes = await getSheetData('clientes')
  const porId = new Map(clientes.map(c => [String(c.id), c]))

  console.log(`\nRuta N° ${viva.numero_recorrido} (${viva.estado_ruta || 'guardada'}) · ${mascotasIds.length} paradas`)
  let sinDatos = 0
  for (const id of mascotasIds) {
    const c = porId.get(String(id))
    if (!c) { console.log(`  ⚠ parada ${id} sin ficha`); sinDatos++; continue }
    const e = datosEtiqueta(c)
    if (!e.nombre_mascota || !e.direccion) sinDatos++
    console.log(`  ${e.codigo.padEnd(9)} ${e.nombre_mascota.padEnd(14)} ${e.direccion || '(sin dirección)'}`)
  }
  chequear('todas las paradas tienen mascota y dirección', sinDatos, 0)
}

main().then(() => {
  console.log(fallos === 0 ? '\nTodo cuadra.' : `\n${fallos} chequeo(s) fallaron.`)
  process.exit(fallos === 0 ? 0 : 1)
}).catch(e => { console.error(e); process.exit(1) })
