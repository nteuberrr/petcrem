import { getPageToken, isFacebookConfigurado } from './meta-publish'

/**
 * Mensajería de Instagram (Messenger API for Instagram, Graph API de Meta).
 * Espejo mínimo de lib/whatsapp.ts para el canal 'instagram' del inbox:
 * responder DMs del perfil de IG del negocio con el agente.
 *
 * Requisitos del lado Meta (misma app que el WhatsApp):
 *  - IG profesional vinculado a la Página (META_PAGE_ID / META_IG_USER_ID ya en env).
 *  - Webhook suscrito al objeto `instagram` (field `messages`) — misma URL y
 *    verify token que WhatsApp (/api/mensajes/webhook).
 *  - En la app de IG: Configuración → Herramientas conectadas → permitir acceso a mensajes.
 *  - Permiso `instagram_manage_messages` (App Review para público; en modo
 *    desarrollo funciona con cuentas admin/tester de la app).
 *
 * Regla de ventana: Instagram NO tiene plantillas como WhatsApp — solo se puede
 * RESPONDER dentro de las 24h del último mensaje del usuario. Fuera de ventana el
 * envío falla y se marca `fuera_de_ventana` (no hay fallback).
 */

const API_VERSION = process.env.WHATSAPP_API_VERSION || 'v22.0'
const GRAPH = `https://graph.facebook.com/${API_VERSION}`

export interface EnvioIgResult {
  ok: boolean
  id?: string
  error?: string
  fuera_de_ventana?: boolean
}

export function isInstagramMensajesConfigurado(): boolean {
  return isFacebookConfigurado() // META_GRAPH_TOKEN + META_PAGE_ID (el page token sale de ahí)
}

async function enviarPayload(igsid: string, message: Record<string, unknown>): Promise<EnvioIgResult> {
  try {
    const pt = await getPageToken()
    const res = await fetch(`${GRAPH}/${process.env.META_PAGE_ID}/messages?access_token=${encodeURIComponent(pt)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipient: { id: igsid }, messaging_type: 'RESPONSE', message }),
    })
    const j = await res.json().catch(() => ({})) as { message_id?: string; error?: { message?: string; code?: number; error_subcode?: number } }
    if (!res.ok || j.error) {
      // code 10 / subcodes de política = fuera de la ventana de 24h (u opt-in faltante).
      const fuera = j.error?.code === 10
      console.warn('[instagram] envío falló:', JSON.stringify(j.error || j).slice(0, 300))
      return { ok: false, error: j.error?.message || `HTTP ${res.status}`, fuera_de_ventana: fuera }
    }
    return { ok: true, id: j.message_id }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/** Responde un DM de Instagram con texto (dentro de la ventana de 24h). */
export function enviarTextoInstagram(igsid: string, texto: string): Promise<EnvioIgResult> {
  return enviarPayload(igsid, { text: texto.slice(0, 1000) }) // límite IG: 1000 chars
}

/** Envía una imagen por URL pública (fotos del banco habilitadas). */
export function enviarImagenInstagram(igsid: string, url: string): Promise<EnvioIgResult> {
  return enviarPayload(igsid, { attachment: { type: 'image', payload: { url } } })
}

/** Perfil básico del usuario de IG (nombre/username) para el inbox. Best-effort. */
export async function perfilInstagram(igsid: string): Promise<{ nombre: string | null; username: string | null }> {
  try {
    const pt = await getPageToken()
    const res = await fetch(`${GRAPH}/${igsid}?fields=name,username&access_token=${encodeURIComponent(pt)}`)
    const j = await res.json().catch(() => ({})) as { name?: string; username?: string }
    if (!res.ok) return { nombre: null, username: null }
    return { nombre: j.name || j.username || null, username: j.username || null }
  } catch {
    return { nombre: null, username: null }
  }
}
