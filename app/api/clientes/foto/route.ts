import { NextRequest, NextResponse } from 'next/server'
import { getSheetData, updateById, ensureColumns } from '@/lib/datastore'
import { uploadToR2, deleteFromR2 } from '@/lib/cloudflare-r2'
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
//   GET  ?token=XXX[&tipo=] → { ok, nombre_mascota, ya }  (precarga del landing)
//   POST multipart (token, tipo?, foto) → sube a R2 y REEMPLAZA la del campo
//
// Por decisión del dueño el tutor tiene UNA sola foto por tipo: si sube otra,
// pisa a la anterior (y la anterior se borra de R2). Así el operador nunca ve
// una galería del mismo tutor sin saber cuál es la buena — la última es la elegida.
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

/** URLs guardadas en el campo (JSON array); [] si está vacío o corrupto. */
function fotosDe(cliente: Record<string, string>, campo: string): string[] {
  try {
    const x = JSON.parse(cliente[campo] || '[]')
    return Array.isArray(x) ? x.filter((u): u is string => typeof u === 'string') : []
  } catch { return [] }
}

/** Key de R2 a partir de la URL pública (…/mascotas/fotos/ABC-123.jpg → mascotas/…). */
function keyDesdeUrl(url: string): string | null {
  const i = url.indexOf('/mascotas/')
  return i === -1 ? null : url.slice(i + 1)
}

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
    return NextResponse.json({
      ok: true,
      nombre_mascota: cliente.nombre_mascota,
      tipo,
      ya: fotosDe(cliente, CAMPO[tipo]).length > 0,
    })
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

    // Una sola foto por tipo: la nueva REEMPLAZA a la anterior.
    const previas = fotosDe(cliente, campo)
    await updateById('clientes', cliente.id, { ...cliente, [campo]: JSON.stringify([up.url]) })

    // Las anteriores ya no las referencia nadie → se borran de R2 (best-effort,
    // después de guardar: si falla solo queda un objeto huérfano).
    for (const vieja of previas) {
      if (vieja === up.url) continue
      const key = keyDesdeUrl(vieja)
      if (key) await deleteFromR2(key).catch(() => false)
    }

    return NextResponse.json({ ok: true, nombre_mascota: cliente.nombre_mascota, url: up.url, tipo, ya: true })
  } catch (e) {
    console.error('[clientes/foto]', e)
    return NextResponse.json({ ok: false, error: 'No se pudo procesar la solicitud. Intenta nuevamente.' }, { status: 500 })
  }
}
