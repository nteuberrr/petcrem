import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { getSheetData, updateRow, ensureColumns } from '@/lib/datastore'
import { deleteFromR2, keyFromPublicUrl } from '@/lib/cloudflare-r2'

// Registro / borrado de videos del servicio en la ficha del cliente.
//   POST   { url }          → agrega la URL (ya subida a R2) a videos_servicio
//   DELETE ?url=...         → la quita de la lista y borra el objeto en R2
// La subida del binario se hace directo a R2 con la URL prefirmada (ver /presign).

function parseVideos(raw: string | undefined): string[] {
  try { const x = JSON.parse(raw || '[]'); return Array.isArray(x) ? x : [] } catch { return [] }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  try {
    const { id } = await params
    const body = await req.json().catch(() => ({}))
    const url = String(body.url || '').trim()
    if (!url) return NextResponse.json({ error: 'Falta la URL del video' }, { status: 400 })

    await ensureColumns('clientes', ['videos_servicio'])
    const clientes = await getSheetData('clientes')
    const idx = clientes.findIndex(c => c.id === id)
    if (idx === -1) return NextResponse.json({ error: 'Cliente no encontrado' }, { status: 404 })

    const videos = parseVideos(clientes[idx].videos_servicio)
    if (!videos.includes(url)) videos.push(url)
    await updateRow('clientes', idx, { ...clientes[idx], videos_servicio: JSON.stringify(videos) })
    return NextResponse.json({ ok: true, videos })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  try {
    const { id } = await params
    const url = (new URL(req.url).searchParams.get('url') || '').trim()
    if (!url) return NextResponse.json({ error: 'Falta la URL del video' }, { status: 400 })

    await ensureColumns('clientes', ['videos_servicio'])
    const clientes = await getSheetData('clientes')
    const idx = clientes.findIndex(c => c.id === id)
    if (idx === -1) return NextResponse.json({ error: 'Cliente no encontrado' }, { status: 404 })

    const videos = parseVideos(clientes[idx].videos_servicio).filter(u => u !== url)
    await updateRow('clientes', idx, { ...clientes[idx], videos_servicio: JSON.stringify(videos) })

    const key = keyFromPublicUrl(url)
    if (key) { try { await deleteFromR2(key) } catch (e) { console.warn('[video DELETE] R2 falló:', e) } }
    return NextResponse.json({ ok: true, videos })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
