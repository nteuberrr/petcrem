import { NextRequest, NextResponse } from 'next/server'
import { getSheetData, updateById, ensureColumns } from '@/lib/datastore'
import { uploadToR2 } from '@/lib/cloudflare-r2'
import { verifyTutorToken } from '@/lib/tutor-token'

// ─────────────────────────────────────────────────────────────────────────────
// Subida PÚBLICA de la foto de la mascota (auto-atención del tutor desde el link
// del correo de registro: /subir-foto?token=XXX). La "autenticación" es un TOKEN
// HMAC firmado por ficha (lib/tutor-token), no el código de la mascota — el código
// era secuencial y adivinable (permitía enumerar nombres y subir a fichas ajenas).
//
//   GET  ?token=XXX → { ok, nombre_mascota }  (para precargar el landing)
//   POST multipart (token, foto) → sube a R2 y la agrega a clientes.fotos_mascota
//
// Ruta whitelisteada en proxy.ts (sin sesión).
// ─────────────────────────────────────────────────────────────────────────────

const EXT: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
}
const MAX_BYTES = 8 * 1024 * 1024 // 8 MB

/** Resuelve la ficha del cliente a partir del token firmado, o null si no vale. */
async function clienteDesdeToken(token: string): Promise<Record<string, string> | null> {
  const v = verifyTutorToken(token, 'subir_foto')
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
    return NextResponse.json({ ok: true, nombre_mascota: cliente.nombre_mascota })
  } catch (e) {
    console.error('[clientes/foto]', e)
    return NextResponse.json({ ok: false, error: 'No se pudo procesar la solicitud. Intenta nuevamente.' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData()
    const token = String(form.get('token') || '').trim()
    const foto = form.get('foto')
    if (!token) return NextResponse.json({ ok: false, error: 'Falta el token' }, { status: 400 })
    if (!(foto instanceof File) || foto.size === 0) {
      return NextResponse.json({ ok: false, error: 'Sube una foto' }, { status: 400 })
    }
    if (foto.size > MAX_BYTES) {
      return NextResponse.json({ ok: false, error: 'La foto supera el tamaño máximo (8 MB)' }, { status: 400 })
    }
    const ext = EXT[(foto.type || '').toLowerCase()]
    if (!ext) return NextResponse.json({ ok: false, error: 'Formato no soportado. Usa JPG o PNG.' }, { status: 400 })

    await ensureColumns('clientes', ['fotos_mascota'])
    const cliente = await clienteDesdeToken(token)
    if (!cliente) return NextResponse.json({ ok: false, error: 'Enlace inválido o vencido' }, { status: 404 })

    const ab = await foto.arrayBuffer()
    const key = `mascotas/fotos/${cliente.codigo || cliente.id}-${Date.now()}.${ext}`
    const up = await uploadToR2(Buffer.from(ab), key, foto.type)

    let fotos: string[] = []
    try { const x = JSON.parse(cliente.fotos_mascota || '[]'); if (Array.isArray(x)) fotos = x } catch { /* */ }
    fotos.push(up.url)

    await updateById('clientes', cliente.id, { ...cliente, fotos_mascota: JSON.stringify(fotos) })

    return NextResponse.json({ ok: true, nombre_mascota: cliente.nombre_mascota, url: up.url })
  } catch (e) {
    console.error('[clientes/foto]', e)
    return NextResponse.json({ ok: false, error: 'No se pudo procesar la solicitud. Intenta nuevamente.' }, { status: 500 })
  }
}
