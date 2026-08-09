import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { esAdmin } from '@/lib/roles'
import { todayISO } from '@/lib/dates'
import { ingestarCompras } from '@/lib/eerr-compras-ingesta'
import { comprasDelPeriodo, puedeConsultarOpenFactura } from '@/lib/openfactura-consulta'

/**
 * POST { periodo: 'YYYY-MM' } — trae las COMPRAS del mes desde OpenFactura y las
 * ingresa, en vez de que el usuario descargue el CSV del SII a mano.
 *
 * Va por OpenFactura y no por el portal del SII porque el RCV protege sus
 * exportaciones con reCAPTCHA (ver lib/openfactura-consulta). Es idempotente:
 * volver a sincronizar el mismo mes no duplica nada — sirve para "refrescar" un
 * mes en curso a medida que llegan facturas nuevas.
 */

export const dynamic = 'force-dynamic'
// Un mes con varias páginas se pagina a ~1 request/segundo (límite de Haulmer).
export const maxDuration = 120

const esPeriodo = (s: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(s)

export async function POST(req: NextRequest) {
  const s = await getServerSession(authOptions)
  if (!esAdmin((s?.user as { role?: string })?.role)) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
  }
  if (!puedeConsultarOpenFactura()) {
    return NextResponse.json({ error: 'OpenFactura no está configurado (falta OPENFACTURA_API_KEY).' }, { status: 400 })
  }
  try {
    const { periodo } = await req.json().catch(() => ({ periodo: '' }))
    const p = String(periodo || '').trim()
    if (!esPeriodo(p)) {
      return NextResponse.json({ error: 'Indica el período a sincronizar (mes y año).' }, { status: 400 })
    }
    // Un mes futuro no tiene documentos: se avisa en vez de devolver "0 nuevas",
    // que se lee como si la sincronización hubiera fallado.
    if (p > todayISO().slice(0, 7)) {
      return NextResponse.json({ error: 'Ese período todavía no ocurre.' }, { status: 400 })
    }

    const compras = await comprasDelPeriodo(p)
    if (compras.length === 0) {
      return NextResponse.json({ ok: true, periodo: p, encontradas: 0, nuevas: 0, duplicadas: 0, completadas: 0, proveedores_nuevos: 0 })
    }
    return NextResponse.json({ ok: true, periodo: p, encontradas: compras.length, ...(await ingestarCompras(compras)) })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
