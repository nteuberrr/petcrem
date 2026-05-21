import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { getSheetData, updateRow } from '@/lib/google-sheets'
import { uploadToR2, deleteFromR2 } from '@/lib/cloudflare-r2'

const SHEET = 'mailing_campanas'
const MAX_TOTAL_MB = 40  // límite de Resend

export interface AttachmentMeta {
  filename: string
  key: string
  url: string
  size: number
  content_type: string
}

function parseAttachments(json: string | undefined | null): AttachmentMeta[] {
  if (!json) return []
  try {
    const arr = JSON.parse(json)
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

async function requireAdmin() {
  const session = await getServerSession(authOptions)
  if ((session?.user as { role?: string })?.role !== 'admin') {
    return NextResponse.json({ error: 'Solo admin' }, { status: 403 })
  }
  return null
}

function sanitizeFilename(name: string): string {
  return name
    .replace(/[^\w.\-]+/g, '_')
    .replace(/_{2,}/g, '_')
    .slice(0, 100) || 'archivo'
}

/**
 * POST /api/mailing/campanas/[id]/attachments
 * Body: FormData con field "file"
 * Sube el archivo a R2 y agrega su metadata a attachments_json de la campaña.
 * Solo en borrador.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireAdmin()
  if (denied) return denied

  try {
    const { id } = await params
    const rows = await getSheetData(SHEET)
    const idx = rows.findIndex(r => r.id === id)
    if (idx === -1) return NextResponse.json({ error: 'Campaña no encontrada' }, { status: 404 })
    const campana = rows[idx]
    if (campana.estado !== 'borrador') {
      return NextResponse.json({ error: 'Solo se pueden modificar adjuntos en borradores' }, { status: 400 })
    }

    const form = await req.formData()
    const file = form.get('file') as File | null
    if (!file) return NextResponse.json({ error: 'falta file' }, { status: 400 })

    const existing = parseAttachments(campana.attachments_json)
    const totalActualBytes = existing.reduce((s, a) => s + (a.size || 0), 0)
    const newTotal = totalActualBytes + file.size
    if (newTotal > MAX_TOTAL_MB * 1024 * 1024) {
      return NextResponse.json({
        error: `El total de adjuntos supera ${MAX_TOTAL_MB}MB (Resend limit). Actual: ${(totalActualBytes / 1024 / 1024).toFixed(1)}MB + nuevo: ${(file.size / 1024 / 1024).toFixed(1)}MB`,
      }, { status: 400 })
    }

    // Evitar collisión de nombres
    const safeName = sanitizeFilename(file.name)
    if (existing.some(a => a.filename === safeName)) {
      return NextResponse.json({ error: `Ya existe un adjunto con el nombre "${safeName}"` }, { status: 409 })
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    const key = `mailing/campanas/${id}/attachments/${safeName}`
    const contentType = file.type || 'application/octet-stream'
    const up = await uploadToR2(buffer, key, contentType)

    const attachmentMeta: AttachmentMeta = {
      filename: safeName,
      key: up.key,
      url: up.url,
      size: file.size,
      content_type: contentType,
    }
    const nuevos = [...existing, attachmentMeta]

    await updateRow(SHEET, idx, { ...campana, attachments_json: JSON.stringify(nuevos) })
    return NextResponse.json({ ok: true, attachment: attachmentMeta, total: nuevos.length })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

/**
 * DELETE /api/mailing/campanas/[id]/attachments?filename=xxx
 * Elimina un adjunto de R2 y del attachments_json. Solo en borrador.
 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireAdmin()
  if (denied) return denied

  try {
    const { id } = await params
    const filename = req.nextUrl.searchParams.get('filename')
    if (!filename) return NextResponse.json({ error: 'falta filename' }, { status: 400 })

    const rows = await getSheetData(SHEET)
    const idx = rows.findIndex(r => r.id === id)
    if (idx === -1) return NextResponse.json({ error: 'Campaña no encontrada' }, { status: 404 })
    const campana = rows[idx]
    if (campana.estado !== 'borrador') {
      return NextResponse.json({ error: 'Solo se pueden modificar adjuntos en borradores' }, { status: 400 })
    }

    const existing = parseAttachments(campana.attachments_json)
    const target = existing.find(a => a.filename === filename)
    if (!target) return NextResponse.json({ error: 'Adjunto no encontrado' }, { status: 404 })

    await deleteFromR2(target.key)
    const nuevos = existing.filter(a => a.filename !== filename)
    await updateRow(SHEET, idx, { ...campana, attachments_json: JSON.stringify(nuevos) })
    return NextResponse.json({ ok: true, total: nuevos.length })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
