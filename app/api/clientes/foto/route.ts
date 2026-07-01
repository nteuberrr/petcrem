import { NextRequest, NextResponse } from 'next/server'
import { getSheetData, updateById, ensureColumns } from '@/lib/datastore'
import { uploadToR2 } from '@/lib/cloudflare-r2'
import { verifyTutorToken, type AccionTutor } from '@/lib/tutor-token'

// ─────────────────────────────────────────────────────────────────────────────
// Subida PÚBLICA de una foto de la mascota (auto-atención del tutor desde el link
// del correo de registro: /subir-foto?token=XXX[&tipo=cuadro]). La "autenticación"
// es un TOKEN HMAC firmado por ficha + acción (lib/tutor-token), no el código.
//
//   tipo=certificado (default) → acción 'subir_foto'        → clientes.fotos_mascota
//   tipo=cuadro                → acción 'subir_foto_cuadro' → clientes.fotos_cuadro
//   (el cuadro acuarela conmemorativo es exclusivo del servicio Premium/CP)
//
//   GET  ?token=XXX[&tipo=] → { ok, nombre_mascota }  (precarga del landing)
//   POST multipart (token, tipo?, foto) → sube a R2 y la agrega al campo del tipo
//
// Ruta whitelisteada en proxy.ts (sin sesión).
// ─────────────────────────────────────────────────────────────────────────────

const EXT: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
}
const MAX_BYTES = 8 * 1024 * 1024 // 8 MB

type Tipo = 'certificado' | 'cuadro'
const ACCION: Record<Tipo, AccionTutor> = { certificado: 'subir_foto', cuadro: 'subir_foto_cuadro' }
const CAMPO: Record<Tipo, string> = { certificado: 'fotos_mascota', cuadro: 'fotos_cuadro' }
const parseTipo = (v: unknown): Tipo => (String(v) === 'cuadro' ? 'cuadro' : 'certificado')

/** Resuelve la ficha del cliente a partir del token firmado para ESE tipo, o null. */
async function clienteDesdeToken(token: string, tipo: Tipo): Promise<Record<string, string> | null> {
  const v = verifyTutorToken(token, ACCION[tipo])
  if (!v.ok || !v.clienteId) return null
  const rows = await getSheetData('clientes')
  return rows.find(r => String(r.id) === v.clienteId) ?? null
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url)
    const token = (url.searchParams.get('token') || '').trim()
    const tipo = parseTipo(url.searchParams.get('tipo'))
    if (!token) return NextResponse.json({ ok: false, error: 'Falta el token' }, { status: 400 })
    const cliente = await clienteDesdeToken(token, tipo)
    if (!cliente) return NextResponse.json({ ok: false, error: 'Enlace inválido o vencido' }, { status: 404 })
    return NextResponse.json({ ok: true, nombre_mascota: cliente.nombre_mascota, tipo })
  } catch (e) {
    console.error('[clientes/foto]', e)
    return NextResponse.json({ ok: false, error: 'No se pudo procesar la solicitud. Intenta nuevamente.' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData()
    const token = String(form.get('token') || '').trim()
    const tipo = parseTipo(form.get('tipo'))
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

    const campo = CAMPO[tipo]
    await ensureColumns('clientes', [campo])
    const cliente = await clienteDesdeToken(token, tipo)
    if (!cliente) return NextResponse.json({ ok: false, error: 'Enlace inválido o vencido' }, { status: 404 })

    const ab = await foto.arrayBuffer()
    const carpeta = tipo === 'cuadro' ? 'cuadro' : 'fotos'
    const key = `mascotas/${carpeta}/${cliente.codigo || cliente.id}-${Date.now()}.${ext}`
    const up = await uploadToR2(Buffer.from(ab), key, foto.type)

    let fotos: string[] = []
    try { const x = JSON.parse(cliente[campo] || '[]'); if (Array.isArray(x)) fotos = x } catch { /* */ }
    fotos.push(up.url)

    await updateById('clientes', cliente.id, { ...cliente, [campo]: JSON.stringify(fotos) })

    return NextResponse.json({ ok: true, nombre_mascota: cliente.nombre_mascota, url: up.url, tipo })
  } catch (e) {
    console.error('[clientes/foto]', e)
    return NextResponse.json({ ok: false, error: 'No se pudo procesar la solicitud. Intenta nuevamente.' }, { status: 500 })
  }
}
