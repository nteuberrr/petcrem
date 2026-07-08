import { NextRequest, NextResponse } from 'next/server'
import { listarWeb, crearWeb, actualizarWeb, eliminarWeb } from '@/lib/web-cms'

const TABLA = 'web_paginas'

export async function GET() {
  try { return NextResponse.json(await listarWeb(TABLA)) }
  catch (e) { return NextResponse.json({ error: String(e) }, { status: 500 }) }
}

export async function POST(req: NextRequest) {
  try { return NextResponse.json(await crearWeb(TABLA, await req.json()), { status: 201 }) }
  catch (e) { return NextResponse.json({ error: String(e) }, { status: 400 }) }
}

export async function PATCH(req: NextRequest) {
  try {
    const { id, ...rest } = await req.json()
    if (!id) return NextResponse.json({ error: 'id requerido' }, { status: 400 })
    const ok = await actualizarWeb(TABLA, String(id), rest)
    if (!ok) return NextResponse.json({ error: 'Nada que actualizar o no encontrado' }, { status: 404 })
    return NextResponse.json({ ok: true })
  } catch (e) { return NextResponse.json({ error: String(e) }, { status: 400 }) }
}

export async function DELETE(req: NextRequest) {
  try {
    const id = new URL(req.url).searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'id requerido' }, { status: 400 })
    const ok = await eliminarWeb(TABLA, id)
    if (!ok) return NextResponse.json({ error: 'No encontrado' }, { status: 404 })
    return NextResponse.json({ ok: true })
  } catch (e) { return NextResponse.json({ error: String(e) }, { status: 500 }) }
}
