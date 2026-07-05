import './_env-preload'
import { getMensajesSupabase } from '../lib/supabase'
import { getSheetData } from '../lib/datastore'
import { telefonosVet } from '../lib/vet-lookup'
import { normalizarEstado } from '../lib/mensajes'

/**
 * Backfill de categorías del inbox (una sola vez). Reglas:
 *  1. Número de VETERINARIO → 'veterinario'.
 *  2. Número de CLIENTE nuestro → 'cerrado' si TODAS sus fichas están entregadas
 *     (despachado); 'cliente' si alguna sigue sin entrega (proceso en curso).
 *  3. Lo que sobra: última actividad de hace +3 días → 'archivado'; lo reciente
 *     se deja como está (activo).
 *
 *   npx tsx scripts/clasificar-conversaciones.ts          (dry-run: solo cuenta)
 *   npx tsx scripts/clasificar-conversaciones.ts --apply  (aplica los cambios)
 */
const APPLY = process.argv.includes('--apply')
const tel9 = (s: string) => (s || '').replace(/\D/g, '').slice(-9)

async function main() {
  // ── Base principal: clientes + vets ──────────────────────────────────────
  const [clientes, vetSet] = await Promise.all([getSheetData('clientes'), telefonosVet()])
  // Por teléfono: ¿es cliente? ¿tiene alguna ficha SIN entregar?
  const porTel = new Map<string, { undelivered: boolean }>()
  const porId = new Map<string, { tel: string; entregado: boolean }>()
  for (const c of clientes) {
    const t = tel9(c.telefono || '')
    const entregado = (c.estado || '') === 'despachado'
    if (c.id) porId.set(String(c.id), { tel: t, entregado })
    if (t.length !== 9) continue
    const cur = porTel.get(t) || { undelivered: false }
    if (!entregado) cur.undelivered = true
    porTel.set(t, cur)
  }

  // ── Inbox: conversaciones de WhatsApp + su contacto ──────────────────────
  const sb = getMensajesSupabase()
  const { data: convs, error } = await sb.from('mensajes_conversaciones')
    .select('id, estado, ultimo_mensaje_at, contacto:mensajes_contactos(wa_id, telefono, cliente_id)')
    .eq('canal', 'whatsapp')
  if (error) throw new Error(error.message)

  const corte3d = Date.now() - 3 * 86400000
  const cuenta: Record<string, number> = { veterinario: 0, cerrado: 0, cliente: 0, archivado: 0, activo_sin_cambio: 0 }
  const cambios: { id: number; estado: string }[] = []

  for (const cv of (convs ?? []) as Array<{ id: number; estado: string; ultimo_mensaje_at: string | null; contacto: { wa_id?: string; telefono?: string; cliente_id?: string } | null }>) {
    const co = cv.contacto || {}
    const t = tel9(co.wa_id || '') || tel9(co.telefono || '')
    let destino: string

    // cliente vinculado por id (aunque el teléfono no matchee)
    const porVinculo = co.cliente_id ? porId.get(String(co.cliente_id)) : undefined

    if (t && vetSet.has(t)) {
      destino = 'veterinario'
    } else if ((t && porTel.has(t)) || porVinculo) {
      const undelivered = (t && porTel.get(t)?.undelivered) || (porVinculo ? !porVinculo.entregado : false)
      destino = undelivered ? 'cliente' : 'cerrado'
    } else {
      const ts = cv.ultimo_mensaje_at ? new Date(cv.ultimo_mensaje_at).getTime() : 0
      destino = ts && ts < corte3d ? 'archivado' : 'activo'
    }

    if (destino === 'activo') { cuenta.activo_sin_cambio++; }
    else cuenta[destino]++

    if (normalizarEstado(cv.estado) !== destino) cambios.push({ id: cv.id, estado: destino })
  }

  console.log(`Conversaciones WhatsApp: ${(convs ?? []).length}`)
  console.log(`Destino → veterinario:${cuenta.veterinario} · cerrado:${cuenta.cerrado} · cliente:${cuenta.cliente} · archivado:${cuenta.archivado} · activo(sin cambio):${cuenta.activo_sin_cambio}`)
  console.log(`Cambios a aplicar: ${cambios.length}`)

  if (!APPLY) { console.log('\n(dry-run: nada se aplicó. Corré con --apply para persistir.)'); return }

  let n = 0
  for (const c of cambios) {
    const { error: e } = await sb.from('mensajes_conversaciones').update({ estado: c.estado }).eq('id', c.id)
    if (e) console.warn(`  ⚠ conv ${c.id}: ${e.message}`)
    else if (++n % 50 === 0) console.log(`  …${n} aplicados`)
  }
  console.log(`\n✅ ${n} conversaciones actualizadas.`)
}

main()
