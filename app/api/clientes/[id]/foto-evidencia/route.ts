import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { getSheetData, updateRow, ensureColumns } from '@/lib/datastore'
import { deleteFromR2, keyFromPublicUrl } from '@/lib/cloudflare-r2'

// Registro / borrado de fotos de EVIDENCIA del peso en la ficha del cliente.
//   POST   { url }   → agrega la URL (ya subida a R2) a fotos_evidencia
//   DELETE ?url=...  → la quita de la lista y borra el objeto en R2
// El binario se sube directo a R2 con la URL prefirmada (ver /presign).

function parseFotos(raw: string | undefined): string[] {
  try { const x = JSON.parse(raw || '[]'); return Array.isArray(x) ? x : [] } catch { return [] }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  try {
    const { id } = await params
    const body = await req.json().catch(() => ({}))
    const url = String(body.url || '').trim()
    if (!url) return NextResponse.json({ error: 'Falta la URL de la foto' }, { status: 400 })

    await ensureColumns('clientes', ['fotos_evidencia'])
    const clientes = await getSheetData('clientes')
    const idx = clientes.findIndex(c => c.id === id)
    if (idx === -1) return NextResponse.json({ error: 'Cliente no encontrado' }, { status: 404 })

    const fotos = parseFotos(clientes[idx].fotos_evidencia)
    if (!fotos.includes(url)) fotos.push(url)
    await updateRow('clientes', idx, { ...clientes[idx], fotos_evidencia: JSON.stringify(fotos) })
    return NextResponse.json({ ok: true, fotos })
  } catch (e) {
    console.error('[foto-evidencia POST]', e)
    return NextResponse.json({ error: 'No se pudo registrar la foto.' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  try {
    const { id } = await params
    const url = (new URL(req.url).searchParams.get('url') || '').trim()
    if (!url) return NextResponse.json({ error: 'Falta la URL de la foto' }, { status: 400 })

    await ensureColumns('clientes', ['fotos_evidencia'])
    const clientes = await getSheetData('clientes')
    const idx = clientes.findIndex(c => c.id === id)
    if (idx === -1) return NextResponse.json({ error: 'Cliente no encontrado' }, { status: 404 })

    const fotos = parseFotos(clientes[idx].fotos_evidencia).filter(u => u !== url)
    await updateRow('clientes', idx, { ...clientes[idx], fotos_evidencia: JSON.stringify(fotos) })

    const key = keyFromPublicUrl(url)
    if (key) { try { await deleteFromR2(key) } catch (e) { console.warn('[foto-evidencia DELETE] R2 falló:', e) } }
    return NextResponse.json({ ok: true, fotos })
  } catch (e) {
    console.error('[foto-evidencia DELETE]', e)
    return NextResponse.json({ error: 'No se pudo eliminar la foto.' }, { status: 500 })
  }
}
