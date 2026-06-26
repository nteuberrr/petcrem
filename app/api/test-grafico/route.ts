import { NextResponse } from 'next/server'
import { generarGraficoMarca } from '@/lib/marketing-grafico'

// TEMP: ruta de diagnóstico del render de gráficos. Borrar tras depurar.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const html = `<div style="display:flex;width:1640px;height:624px;background:#FBF8F3"><div style="display:flex;flex-direction:column;justify-content:center;width:940px;height:624px;background:#143C64;padding:0 88px"><span style="font-family:'More Sugar';font-size:84px;color:#ffffff">Alma Animal</span><span style="font-family:Inter;font-weight:600;font-size:34px;color:#F2B84B;margin-top:14px">Huellas que no se borran</span></div><div style="display:flex;width:700px;height:624px;background:#FBF8F3"></div></div>`
    const r = await generarGraficoMarca({ formato: 'portada_fb', html, fotos: [] })
    return NextResponse.json({ ok: true, ...r })
  } catch (e) {
    return NextResponse.json({
      error: e instanceof Error ? e.message : String(e),
      stack: e instanceof Error ? e.stack : null,
    }, { status: 500 })
  }
}
