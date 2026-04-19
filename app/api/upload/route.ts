import { NextRequest, NextResponse } from 'next/server'
import { uploadImage } from '@/lib/google-drive'

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData()
    const file = form.get('file') as File | null
    if (!file) return NextResponse.json({ error: 'No file' }, { status: 400 })
    const buffer = Buffer.from(await file.arrayBuffer())
    const url = await uploadImage(buffer, file.name, file.type)
    return NextResponse.json({ url })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
