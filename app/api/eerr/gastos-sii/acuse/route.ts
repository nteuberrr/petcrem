import { NextRequest, NextResponse } from 'next/server'
import { puedeNivel } from '@/lib/permisos-server'
import { puedeConsultarOpenFactura } from '@/lib/openfactura-consulta'
import { darAcuse, esTipoAcuse, pendientesDeAcuse, PLAZO_ACUSE_DIAS, TIPOS_ACUSE } from '@/lib/openfactura-acuse'

/**
 * ACUSE de facturas de compra (aceptar / reclamar ante el SII).
 *
 *   GET  → facturas recibidas que siguen sin acuse, con los días que quedan.
 *   POST → da el acuse elegido a una de ellas. IRREVERSIBLE.
 *
 * El estado se lee en vivo de OpenFactura y no se cachea: vence solo a los 8
 * días (ver lib/openfactura-acuse).
 */

export const dynamic = 'force-dynamic'
// Se paginan ~2 meses de documentos recibidos a 1 request/segundo (límite Haulmer).
export const maxDuration = 60

export async function GET() {
  if (!(await puedeNivel('eerr', 'ver'))) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
  }
  if (!puedeConsultarOpenFactura()) {
    return NextResponse.json({ ok: false, disponible: false, pendientes: [], plazo: PLAZO_ACUSE_DIAS })
  }
  try {
    const pendientes = await pendientesDeAcuse()
    return NextResponse.json({ ok: true, disponible: true, plazo: PLAZO_ACUSE_DIAS, pendientes })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  if (!(await puedeNivel('eerr', 'editar'))) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
  }
  if (!puedeConsultarOpenFactura()) {
    return NextResponse.json({ error: 'OpenFactura no está configurado (falta OPENFACTURA_API_KEY).' }, { status: 400 })
  }
  try {
    const body = await req.json().catch(() => ({})) as { rut?: string; dte?: unknown; folio?: unknown; acuse?: string }
    const rut = String(body.rut || '').trim()
    const dte = Number(body.dte)
    const folio = Number(body.folio)
    const acuse = String(body.acuse || '').trim().toUpperCase()

    if (!rut || !Number.isFinite(dte) || !Number.isFinite(folio) || folio <= 0) {
      return NextResponse.json({ error: 'Faltan datos del documento (RUT, tipo y folio).' }, { status: 400 })
    }
    if (!esTipoAcuse(acuse)) {
      return NextResponse.json({ error: `Tipo de acuse inválido. Debe ser uno de: ${Object.keys(TIPOS_ACUSE).join(', ')}.` }, { status: 400 })
    }

    const r = await darAcuse(rut, dte, folio, acuse)
    if (!r.ok) return NextResponse.json({ error: r.mensaje }, { status: 400 })
    return NextResponse.json({ ok: true, mensaje: r.mensaje, acuse })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
