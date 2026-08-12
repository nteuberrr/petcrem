/**
 * SALUD DE LA CUENTA DE WHATSAPP.
 *
 * Meta expone en `health_status` si el número puede enviar y, si no, por qué.
 * Es la consulta que destrabó el incidente del 11-08-2026: la cuenta llevaba
 * DÍAS bloqueada (error 141006, «There is an error with the payment method.
 * This will block business initiated conversations») y desde adentro no se veía
 * nada — el bot seguía respondiendo a los clientes con normalidad, porque esas
 * conversaciones las inicia el cliente y son gratis, mientras que TODO lo que
 * inicia el negocio (avisos al equipo, plantillas al tutor, invitaciones a la red
 * de veterinarios) moría en silencio.
 *
 * Lo consulta el aviso diario `whatsapp_salud` (lib/aviso-whatsapp-salud), que
 * manda un correo apenas la cuenta se bloquea. El correo va por Resend —otro
 * proveedor— justamente porque el canal caído es WhatsApp.
 */

export interface BloqueoWhatsapp {
  /** PHONE_NUMBER | WABA | BUSINESS | APP */
  entidad: string
  codigo: number
  descripcion: string
  solucion: string
}

export interface SaludWhatsapp {
  /** false si no se pudo consultar (sin credenciales o error de red). */
  consultado: boolean
  /** true si Meta dice que se puede enviar. */
  puedeEnviar: boolean
  /** Qué bloquea el envío, entidad por entidad. */
  bloqueos: BloqueoWhatsapp[]
  error?: string
}

/**
 * Errores de la API de LLAMADAS por SIP. No tienen nada que ver con los mensajes
 * y aparecen siempre porque no usamos esa función: si no se filtran, el aviso
 * gritaría todos los días por algo que no está roto.
 */
const IRRELEVANTES = new Set([138024, 138025])

export async function consultarSaludWhatsapp(): Promise<SaludWhatsapp> {
  const token = process.env.WHATSAPP_TOKEN
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID
  if (!token || !phoneId) {
    return { consultado: false, puedeEnviar: false, bloqueos: [], error: 'WhatsApp no configurado' }
  }
  const version = process.env.WHATSAPP_API_VERSION || 'v22.0'
  try {
    const res = await fetch(
      `https://graph.facebook.com/${version}/${phoneId}?fields=health_status`,
      { headers: { Authorization: `Bearer ${token}` } },
    )
    const j = await res.json().catch(() => ({}))
    if (!res.ok) {
      return { consultado: false, puedeEnviar: false, bloqueos: [], error: j?.error?.message || `HTTP ${res.status}` }
    }
    const h = j?.health_status
    const entidades = Array.isArray(h?.entities) ? h.entities : []
    const bloqueos: BloqueoWhatsapp[] = []
    for (const e of entidades) {
      if (String(e?.can_send_message || '') !== 'BLOCKED') continue
      for (const err of (e?.errors ?? [])) {
        const codigo = Number(err?.error_code) || 0
        if (IRRELEVANTES.has(codigo)) continue
        bloqueos.push({
          entidad: String(e?.entity_type || '—'),
          codigo,
          descripcion: String(err?.error_description || 'Sin detalle'),
          solucion: String(err?.possible_solution || ''),
        })
      }
      // Bloqueada sin errores detallados: igual hay que reportarla.
      if (!(e?.errors ?? []).length) {
        bloqueos.push({ entidad: String(e?.entity_type || '—'), codigo: 0, descripcion: 'Bloqueada sin detalle de Meta', solucion: '' })
      }
    }
    return {
      consultado: true,
      puedeEnviar: String(h?.can_send_message || '') === 'AVAILABLE' && bloqueos.length === 0,
      bloqueos,
    }
  } catch (e) {
    return { consultado: false, puedeEnviar: false, bloqueos: [], error: e instanceof Error ? e.message : String(e) }
  }
}
