import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { esAdmin } from '@/lib/roles'
import { generarInformeCorporativoPdf } from '@/lib/informe-corporativo-generator'

/**
 * GET /api/empresa/informe  (admin)
 * Genera y descarga el dossier corporativo en PDF (presentación de servicios para
 * licitaciones), SIEMPRE con los datos vigentes (tarifas, productos, datos de la empresa).
 */
export const maxDuration = 120

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!esAdmin((session?.user as { role?: string })?.role)) {
    return NextResponse.json({ error: 'Solo admin' }, { status: 403 })
  }
  try {
    const pdf = await generarInformeCorporativoPdf()
    const fecha = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="alma-animal-presentacion-servicios-${fecha}.pdf"`,
        'Content-Length': String(pdf.byteLength),
        'Cache-Control': 'no-store',
      },
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[empresa/informe]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
