import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { esAdmin } from '@/lib/roles'
import { getSheetData } from '@/lib/datastore'
import { createBorradorToken } from '@/lib/borrador-token'
import { enviarTextoWhatsapp, isWhatsappConfigured } from '@/lib/whatsapp'
import { upsertContacto, getOrCreateConversacion, insertarMensaje } from '@/lib/mensajes'

/**
 * POST /api/clientes/[id]/reenviar-link-borrador
 *
 * Reenvía al tutor (por WhatsApp) el link firmado para completar su ficha BORRADOR
 * ("Por ingresar"). Clave: el token del link se firma con NEXTAUTH_SECRET, así que
 * SOLO vale un link generado en el MISMO entorno que lo valida (producción). Por eso
 * existe este endpoint: para mintear el link EN PROD y evitar links firmados en local.
 *
 * Auth: sesión admin O `Bearer CRON_SECRET` (fail-closed si no hay ninguno).
 * Body opcional { soloLink?: boolean } — por defecto manda SOLO el link.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  const bearer = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  const okCron = !!process.env.CRON_SECRET && bearer === process.env.CRON_SECRET
  const okAdmin = esAdmin((session?.user as { role?: string })?.role)
  if (!okAdmin && !okCron) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  const { id } = await params
  const c = (await getSheetData('clientes')).find(r => String(r.id) === String(id))
  if (!c) return NextResponse.json({ error: 'Ficha no encontrada' }, { status: 404 })
  if ((c.estado || '') !== 'borrador') return NextResponse.json({ error: 'La ficha ya no es borrador (ya fue registrada).' }, { status: 400 })
  const tel = (c.telefono || '').replace(/\D/g, '').slice(-9)
  if (tel.length !== 9) return NextResponse.json({ error: 'La ficha no tiene un teléfono válido.' }, { status: 400 })
  if (!isWhatsappConfigured()) return NextResponse.json({ error: 'WhatsApp no configurado' }, { status: 400 })

  const base = (process.env.PUBLIC_APP_URL || process.env.NEXTAUTH_URL || 'https://petcrem.vercel.app').replace(/\/+$/, '')
  const link = `${base}/registro-mascota?ficha=${createBorradorToken(String(id))}`
  const soloLink = await req.json().then((b: { soloLink?: boolean }) => b?.soloLink !== false).catch(() => true)
  const cuerpo = soloLink ? link : `Para completar los datos de ${c.nombre_mascota || 'tu mascota'}, entra aquí:\n${link}`
  const wa = `56${tel}`
  const env = await enviarTextoWhatsapp(wa, cuerpo)

  // Registrar el envío en el inbox de Mensajes para que quede VISIBLE en la
  // conversación (antes se mandaba por WhatsApp pero no aparecía → parecía no enviado).
  try {
    const cont = await upsertContacto({ wa_id: wa, telefono: wa, audiencia: 'A' })
    const conv = await getOrCreateConversacion(cont.id, 'whatsapp', cont.audiencia, 'whatsapp')
    await insertarMensaje({ conversacion_id: conv.id, direccion: 'saliente', cuerpo, tipo: 'texto', estado: env.ok ? 'enviado' : 'fallido', enviado_por: 'humano' })
  } catch (e) { console.warn('[reenviar-link-borrador] no se pudo registrar en el inbox:', e) }

  return NextResponse.json({ ok: env.ok, enviado: env.ok, link, error: env.ok ? undefined : (env.error || 'no enviado') })
}
