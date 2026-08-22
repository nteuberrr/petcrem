import './_env-preload'
import { getSheetData } from '../lib/datastore'
import { formatDateForSheet, todayISO } from '../lib/dates'

/**
 * ¿SE ESTÁN PUBLICANDO LAS DESPEDIDAS EN INSTAGRAM?
 *
 *   npx tsx scripts/verificar-memorial.ts
 *
 * La historia sale sola cuando la mascota queda ENTREGADA y el tutor dio su
 * consentimiento (lib/memorial). Ese "sola" es el problema: cuando se rompe, no
 * lo dice nadie. Del 19 al 22-08-2026 estuvo caído —sharp dejó de funcionar en
 * producción tras pasarlo a import dinámico— y se perdieron 13 despedidas de
 * gente que había pedido expresamente que la publicáramos. No hubo un error en
 * ninguna pantalla: simplemente dejaron de aparecer.
 *
 * Este script mira el resultado, no el código: cuántos días hace que no se
 * publica una, y qué fichas quedaron con permiso y sin homenaje.
 *
 * Es de solo lectura: no publica nada.
 */

/** Se avisa si no hay publicaciones en tantos días (con entregas de por medio). */
const DIAS_SIN_PUBLICAR = 3

let fallas = 0
const mal = (s: string) => { console.log(`  ❌ ${s}`); fallas++ }
const ok = (s: string) => console.log(`  ✅ ${s}`)

const diasEntre = (a: string, b: string) =>
  Math.round((new Date(`${b}T12:00:00`).getTime() - new Date(`${a}T12:00:00`).getTime()) / 86400000)

async function main() {
  const [clientes, despachos] = await Promise.all([
    getSheetData('clientes'),
    getSheetData('despachos').catch(() => [] as Record<string, string>[]),
  ])
  const hoy = todayISO()

  // Fecha de ENTREGA real de cada ficha (del blob `entregas` de su despacho).
  const entregaDe = new Map<string, string>()
  for (const d of despachos) {
    let e: Record<string, { fecha_hora?: string }> = {}
    try { e = JSON.parse(d.entregas || '{}') } catch { /* ruta sin entregas */ }
    for (const [cid, v] of Object.entries(e)) {
      entregaDe.set(String(cid), String(v?.fecha_hora || '').slice(0, 10) || formatDateForSheet(d.fecha_realizada) || '')
    }
  }

  const conPermiso = clientes.filter(c => String(c.memorial_consentimiento || '').toUpperCase() === 'TRUE')
  const publicados = conPermiso.filter(c => String(c.memorial_publicado_at || '').trim())
  const ultima = publicados
    .map(c => String(c.memorial_publicado_at).slice(0, 10))
    .sort()
    .pop() || ''

  console.log(`\n${conPermiso.length} tutores autorizaron publicar · ${publicados.length} homenajes publicados`)
  console.log(`última publicación: ${ultima || 'nunca'}${ultima ? ` (hace ${diasEntre(ultima, hoy)} día(s))` : ''}\n`)

  // ── Las que se quedaron esperando ──
  // Entregada + con permiso + sin publicar. Esas son las que se perdieron: el
  // disparador es la entrega y no vuelve a pasar.
  const pendientes = conPermiso
    .filter(c => !String(c.memorial_publicado_at || '').trim())
    .filter(c => String(c.estado || '').toLowerCase() === 'despachado')
    .map(c => ({ c, entrega: entregaDe.get(String(c.id)) || '' }))
    .sort((a, b) => a.entrega.localeCompare(b.entrega))

  if (pendientes.length) {
    console.log('CON PERMISO, YA ENTREGADAS Y SIN HOMENAJE:')
    console.log('  codigo      mascota              entregada    consintió')
    for (const { c, entrega } of pendientes) {
      const cons = formatDateForSheet(c.memorial_consentimiento_fecha) || ''
      // Consentir DESPUÉS de la entrega no es una falla del sistema: el
      // disparador ya pasó. Se distingue para no mezclar las dos cosas.
      const tarde = cons && entrega && cons > entrega
      console.log(
        `  ${String(c.codigo || '').padEnd(11)} ${String(c.nombre_mascota || '').slice(0, 18).padEnd(20)}`
        + ` ${(entrega || '—').padEnd(12)} ${(cons || '—').padEnd(12)}${tarde ? ' (consintió después de la entrega)' : ''}`,
      )
    }
    const perdidas = pendientes.filter(({ c, entrega }) => {
      const cons = formatDateForSheet(c.memorial_consentimiento_fecha) || ''
      return !(cons && entrega && cons > entrega)
    })
    if (perdidas.length) {
      mal(`${perdidas.length} despedida(s) tenían permiso ANTES de la entrega y no se publicaron`)
    } else {
      ok('las pendientes consintieron después de la entrega: el disparador ya había pasado')
    }
  } else {
    ok('no quedan despedidas entregadas sin publicar')
  }

  // ── ¿Está vivo el flujo? ──
  // Un silencio largo solo preocupa si hubo entregas con permiso en el medio.
  const entregadasRecientes = conPermiso.filter(c => {
    const e = entregaDe.get(String(c.id)) || ''
    return e && diasEntre(e, hoy) <= DIAS_SIN_PUBLICAR
  })
  console.log('')
  if (!ultima) mal('nunca se publicó una despedida')
  else if (diasEntre(ultima, hoy) > DIAS_SIN_PUBLICAR && entregadasRecientes.length) {
    mal(`hace ${diasEntre(ultima, hoy)} días que no se publica una, y hubo ${entregadasRecientes.length} entrega(s) con permiso en ese lapso`)
  } else if (diasEntre(ultima, hoy) > DIAS_SIN_PUBLICAR) {
    ok(`sin publicaciones hace ${diasEntre(ultima, hoy)} días, pero tampoco hubo entregas con permiso`)
  } else {
    ok('el flujo está publicando al ritmo de las entregas')
  }

  console.log('\n════ Resultado ════')
  if (fallas) {
    console.log(`  ${fallas} problema(s).`)
    console.log('  Para publicar las atrasadas: npx tsx scripts/publicar-memoriales-pendientes.ts --aplicar\n')
    process.exit(1)
  }
  console.log('  ✅ Las despedidas se están publicando.\n')
}

main().catch(e => { console.error(e); process.exit(1) })
