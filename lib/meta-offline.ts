import { getSheetData } from './datastore'
import {
  pendientesMetaLead, pendientesMetaCompra, marcarMetaLead, marcarMetaCompra, type AdsClick,
} from './ads-clicks'
import { isMetaCapiConfigurado, enviarEventosCapi, fbcDe, demasiadoViejo, type EventoCapi } from './meta-capi'

/**
 * CONVERSIONES OFFLINE A META — el gemelo de lib/ads-offline (Google).
 *
 * Manda DOS eventos por clic, en dos momentos distintos, y esa separación es
 * todo el punto:
 *
 *   · «Lead» apenas el clic tiene teléfono (el cliente escribió por WhatsApp).
 *     Es el evento con el que las campañas pueden optimizar de verdad: pasan de
 *     perseguir clics a perseguir conversaciones.
 *   · «Purchase» cuando esa ficha deja de ser borrador, con el precio real. Es
 *     poco frecuente (~46 al mes), pero es lo que le enseña a Meta cuánto vale
 *     un lead — y sin valor, optimizar por volumen trae curiosos.
 *
 * Una ficha en BORRADOR no se informa: todavía no tiene precio ni confirmación
 * del equipo, y una compra sin valor le enseña a Meta lo contrario de lo que
 * queremos. Queda pendiente para la corrida siguiente (mismo criterio que
 * Google, ver lib/ads-offline).
 *
 * Idempotente por dos vías: las marcas `meta_lead_at` / `meta_compra_at` en la
 * tabla y el `event_id` del lado de Meta (reenviar el mismo evento no lo cuenta
 * dos veces). Lo corre el mismo cron diario que sube a Google.
 */

const LOTE = 200

export interface ResultadoMeta {
  leads: number
  compras: number
  esperando: number
  errores: string[]
}

const monto = (v: unknown): number => {
  const n = parseFloat(String(v ?? '').replace(/[^\d.-]/g, ''))
  return Number.isFinite(n) && n > 0 ? n : 0
}

/** El identificador del clic, en el formato que Meta espera para cada origen. */
function identidad(click: AdsClick): { fbc?: string; ctwaClid?: string } | null {
  if (click.ctwa_clid) return { ctwaClid: click.ctwa_clid }
  if (click.fbclid) return { fbc: fbcDe(click.fbclid, click.created_at) }
  return null
}

export async function subirConversionesMeta(): Promise<ResultadoMeta> {
  const vacio: ResultadoMeta = { leads: 0, compras: 0, esperando: 0, errores: [] }
  if (!isMetaCapiConfigurado()) return { ...vacio, errores: ['Meta CAPI no está configurado'] }

  const [pendLead, pendCompra] = await Promise.all([
    pendientesMetaLead(LOTE),
    pendientesMetaCompra(LOTE),
  ])
  if (!pendLead.length && !pendCompra.length) return vacio

  const errores: string[] = []
  let esperando = 0

  // ── «Lead»: empezó la conversación ─────────────────────────────────────────
  const leads: Array<{ click: AdsClick; ev: EventoCapi }> = []
  const leadsVencidos: number[] = []
  for (const click of pendLead) {
    const id = identidad(click)
    if (!id) continue
    // El teléfono aparece cuando el cliente escribe; si no hay marca de cuándo,
    // el clic es lo más cercano que tenemos.
    const cuando = new Date(click.vinculado_at || click.created_at)
    if (Number.isNaN(cuando.getTime())) continue
    // Meta rechaza lo de más de 7 días: reintentarlo para siempre es ruido, así
    // que se marca como resuelto y se deja ir.
    if (demasiadoViejo(cuando)) { leadsVencidos.push(click.id); continue }
    leads.push({
      click,
      ev: { nombre: 'Lead', cuando, eventId: `lead-${click.id}`, telefono: click.telefono, ...id },
    })
  }

  // ── «Purchase»: la ficha se cerró ──────────────────────────────────────────
  const compras: Array<{ click: AdsClick; ev: EventoCapi }> = []
  const comprasHuerfanas: number[] = []
  if (pendCompra.length) {
    let clientes: Record<string, string>[] = []
    try { clientes = await getSheetData('clientes') } catch (e) {
      errores.push(`No se pudo leer clientes: ${e instanceof Error ? e.message : e}`)
    }
    const porId = new Map(clientes.map(c => [String(c.id), c]))
    for (const click of pendCompra) {
      const id = identidad(click)
      if (!id) continue
      const ficha = porId.get(String(click.cliente_id))
      // La ficha se borró: no hay nada que informar y no tiene sentido
      // reintentarla para siempre.
      if (!ficha) { if (clientes.length) comprasHuerfanas.push(click.id); continue }
      if (String(ficha.estado || '').toLowerCase() === 'borrador') { esperando++; continue }
      const cuando = new Date(click.vinculado_at || click.created_at)
      if (Number.isNaN(cuando.getTime())) { esperando++; continue }
      if (demasiadoViejo(cuando)) { comprasHuerfanas.push(click.id); continue }
      compras.push({
        click,
        ev: {
          nombre: 'Purchase', cuando, eventId: `ficha-${click.cliente_id}`,
          telefono: click.telefono, email: ficha.email || null,
          valor: monto(ficha.precio_total) || monto(ficha.precio_servicio), moneda: 'CLP',
          ...id,
        },
      })
    }
  }

  if (leadsVencidos.length) await marcarMetaLead(leadsVencidos)
  if (comprasHuerfanas.length) await marcarMetaCompra(comprasHuerfanas)

  // Un solo envío con todo: Meta acepta eventos mezclados en el mismo lote.
  const todos = [...leads, ...compras]
  if (!todos.length) return { leads: 0, compras: 0, esperando, errores }

  const r = await enviarEventosCapi(todos.map(t => t.ev))
  errores.push(...r.errores)
  if (r.errores.length) return { leads: 0, compras: 0, esperando, errores }

  await marcarMetaLead(leads.map(l => l.click.id))
  await marcarMetaCompra(compras.map(c => c.click.id))
  return { leads: leads.length, compras: compras.length, esperando, errores }
}
