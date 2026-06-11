import { NextRequest, NextResponse } from 'next/server'
import { getSheetData, updateRow, ensureColumns } from '@/lib/datastore'
import { uploadToR2 } from '@/lib/cloudflare-r2'

// ─────────────────────────────────────────────────────────────────────────────
// Subida PÚBLICA de la foto de la mascota (auto-atención del tutor desde el link
// del correo de registro: /subir-foto?codigo=XXX). El código de la mascota es la
// "autenticación" (mismo criterio que los tokens públicos del módulo eutanasias).
//
//   GET  ?codigo=XXX → { ok, nombre_mascota }  (para precargar el landing)
//   POST multipart (codigo, foto) → sube a R2 y la agrega a clientes.fotos_mascota
//
// Ruta whitelisteada en proxy.ts (sin sesión).
// ─────────────────────────────────────────────────────────────────────────────

const EXT: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
}
const MAX_BYTES = 8 * 1024 * 1024 // 8 MB

function findByCodigo(rows: Record<string, string>[], codigo: string): number {
  const c = codigo.trim().toLowerCase()
  return rows.findIndex(r => (r.codigo || '').trim().toLowerCase() === c)
}

export async function GET(req: NextRequest) {
  try {
    const codigo = (new URL(req.url).searchParams.get('codigo') || '').trim()
    if (!codigo) return NextResponse.json({ ok: false, error: 'Falta el código' }, { status: 400 })
    const rows = await getSheetData('clientes')
    const idx = findByCodigo(rows, codigo)
    if (idx === -1) return NextResponse.json({ ok: false, error: 'No encontramos ese código' }, { status: 404 })
    return NextResponse.json({ ok: true, nombre_mascota: rows[idx].nombre_mascota })
  } catch (e) {
    console.error('[clientes/foto]', e)
    return NextResponse.json({ ok: false, error: 'No se pudo procesar la solicitud. Intenta nuevamente.' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData()
    const codigo = String(form.get('codigo') || '').trim()
    const foto = form.get('foto')
    if (!codigo) return NextResponse.json({ ok: false, error: 'Falta el código' }, { status: 400 })
    if (!(foto instanceof File) || foto.size === 0) {
      return NextResponse.json({ ok: false, error: 'Sube una foto' }, { status: 400 })
    }
    if (foto.size > MAX_BYTES) {
      return NextResponse.json({ ok: false, error: 'La foto supera el tamaño máximo (8 MB)' }, { status: 400 })
    }
    const ext = EXT[(foto.type || '').toLowerCase()]
    if (!ext) return NextResponse.json({ ok: false, error: 'Formato no soportado. Usa JPG o PNG.' }, { status: 400 })

    await ensureColumns('clientes', ['fotos_mascota'])
    const rows = await getSheetData('clientes')
    const idx = findByCodigo(rows, codigo)
    if (idx === -1) return NextResponse.json({ ok: false, error: 'No encontramos ese código' }, { status: 404 })
    const cliente = rows[idx]

    const ab = await foto.arrayBuffer()
    const key = `mascotas/fotos/${cliente.codigo}-${Date.now()}.${ext}`
    const up = await uploadToR2(Buffer.from(ab), key, foto.type)

    let fotos: string[] = []
    try { const x = JSON.parse(cliente.fotos_mascota || '[]'); if (Array.isArray(x)) fotos = x } catch { /* */ }
    fotos.push(up.url)

    await updateRow('clientes', idx, { ...cliente, fotos_mascota: JSON.stringify(fotos) })

    return NextResponse.json({ ok: true, nombre_mascota: cliente.nombre_mascota, url: up.url })
  } catch (e) {
    console.error('[clientes/foto]', e)
    return NextResponse.json({ ok: false, error: 'No se pudo procesar la solicitud. Intenta nuevamente.' }, { status: 500 })
  }
}
