import { NextRequest, NextResponse } from 'next/server'
import { getSheetData, updateById } from '@/lib/datastore'
import { verifyTutorToken } from '@/lib/tutor-token'
import { todayISO } from '@/lib/dates'
import { pidioVideo } from '@/lib/video-solicitado'

// ─────────────────────────────────────────────────────────────────────────────
// Solicitud PÚBLICA del video del proceso (auto-atención del tutor desde el link
// del correo de registro: /solicitar-video?token=XXX). Autenticación = token HMAC
// firmado por ficha + acción (lib/tutor-token), válido 24h.
//
//   GET  ?token=XXX → { ok, nombre_mascota, ya }   (precarga + si ya lo pidió)
//   POST { token }  → marca clientes.video_solicitado con la fecha (idempotente)
//
// Se guarda en su PROPIA columna (`video_solicitado` = fecha ISO, '' = no pidió).
// Antes se dejaba una marca dentro de `notas`, pero ese campo es solo para los
// comentarios que escribe el equipo a mano — ver lib/video-solicitado.ts.
// Ruta whitelisteada en proxy.ts (sin sesión).
// ─────────────────────────────────────────────────────────────────────────────

async function clienteDesdeToken(token: string): Promise<Record<string, string> | null> {
  const v = verifyTutorToken(token, 'solicitar_video')
  if (!v.ok || !v.clienteId) return null
  const rows = await getSheetData('clientes')
  return rows.find(r => String(r.id) === v.clienteId) ?? null
}

export async function GET(req: NextRequest) {
  try {
    const token = (new URL(req.url).searchParams.get('token') || '').trim()
    if (!token) return NextResponse.json({ ok: false, error: 'Falta el token' }, { status: 400 })
    const cliente = await clienteDesdeToken(token)
    if (!cliente) return NextResponse.json({ ok: false, error: 'Enlace inválido o vencido' }, { status: 404 })
    return NextResponse.json({ ok: true, nombre_mascota: cliente.nombre_mascota, ya: pidioVideo(cliente) })
  } catch (e) {
    console.error('[clientes/video]', e)
    return NextResponse.json({ ok: false, error: 'No se pudo procesar la solicitud. Intenta nuevamente.' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const token = String(body.token || '').trim()
    if (!token) return NextResponse.json({ ok: false, error: 'Falta el token' }, { status: 400 })
    const cliente = await clienteDesdeToken(token)
    if (!cliente) return NextResponse.json({ ok: false, error: 'Enlace inválido o vencido' }, { status: 404 })

    // Idempotente: la primera solicitud fija la fecha, las siguientes no la pisan.
    if (!pidioVideo(cliente)) {
      await updateById('clientes', cliente.id, { ...cliente, video_solicitado: todayISO() })
    }

    return NextResponse.json({ ok: true, nombre_mascota: cliente.nombre_mascota })
  } catch (e) {
    console.error('[clientes/video]', e)
    return NextResponse.json({ ok: false, error: 'No se pudo procesar la solicitud. Intenta nuevamente.' }, { status: 500 })
  }
}
