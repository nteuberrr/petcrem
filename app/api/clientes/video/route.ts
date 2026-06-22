import { NextRequest, NextResponse } from 'next/server'
import { getSheetData, updateById } from '@/lib/datastore'
import { verifyTutorToken } from '@/lib/tutor-token'
import { todayISO, formatDate } from '@/lib/dates'

// ─────────────────────────────────────────────────────────────────────────────
// Solicitud PÚBLICA del video del proceso (auto-atención del tutor desde el link
// del correo de registro: /solicitar-video?token=XXX). Autenticación = token HMAC
// firmado por ficha + acción (lib/tutor-token), válido 24h.
//
//   GET  ?token=XXX → { ok, nombre_mascota, ya }   (precarga + si ya lo pidió)
//   POST { token }  → registra la solicitud en clientes.notas (idempotente)
//
// No hay columna dedicada (en Postgres ensureColumns es no-op y no podemos hacer
// ALTER desde acá): dejamos una marca en `notas`, que el operador ve en la ficha.
// Ruta whitelisteada en proxy.ts (sin sesión).
// ─────────────────────────────────────────────────────────────────────────────

const MARCA = 'El tutor solicitó el video'

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
    return NextResponse.json({ ok: true, nombre_mascota: cliente.nombre_mascota, ya: (cliente.notas || '').includes(MARCA) })
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

    // Idempotente: dejamos la marca en las notas de la ficha una sola vez.
    if (!(cliente.notas || '').includes(MARCA)) {
      const nota = `🎥 ${MARCA} del proceso (${formatDate(todayISO())}).`
      const notas = cliente.notas ? `${cliente.notas}\n${nota}` : nota
      await updateById('clientes', cliente.id, { ...cliente, notas })
    }

    return NextResponse.json({ ok: true, nombre_mascota: cliente.nombre_mascota })
  } catch (e) {
    console.error('[clientes/video]', e)
    return NextResponse.json({ ok: false, error: 'No se pudo procesar la solicitud. Intenta nuevamente.' }, { status: 500 })
  }
}
