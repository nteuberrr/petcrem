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
// El POST acusa de a uno, en serie y con pausa entre medio (límite ~1 req/seg de
// Haulmer): un lote de 30 documentos tarda cerca de un minuto.
export const maxDuration = 300

/** Tope por lote: más que esto no se alcanza a procesar dentro de maxDuration. */
const MAX_LOTE = 40
const dormir = (ms: number) => new Promise(r => setTimeout(r, ms))

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
    const body = await req.json().catch(() => ({})) as {
      rut?: string; dte?: unknown; folio?: unknown; acuse?: string
      documentos?: Array<{ rut?: string; dte?: unknown; folio?: unknown }>
    }
    const acuse = String(body.acuse || '').trim().toUpperCase()
    if (!esTipoAcuse(acuse)) {
      return NextResponse.json({ error: `Tipo de acuse inválido. Debe ser uno de: ${Object.keys(TIPOS_ACUSE).join(', ')}.` }, { status: 400 })
    }

    // Acepta un documento suelto o un lote; internamente siempre es una lista.
    const crudos = Array.isArray(body.documentos) && body.documentos.length > 0
      ? body.documentos
      : [{ rut: body.rut, dte: body.dte, folio: body.folio }]

    const docs = crudos.map(d => ({
      rut: String(d.rut || '').trim(),
      dte: Number(d.dte),
      folio: Number(d.folio),
    }))
    if (docs.some(d => !d.rut || !Number.isFinite(d.dte) || !Number.isFinite(d.folio) || d.folio <= 0)) {
      return NextResponse.json({ error: 'Faltan datos de algún documento (RUT, tipo y folio).' }, { status: 400 })
    }
    if (docs.length > MAX_LOTE) {
      return NextResponse.json({ error: `Máximo ${MAX_LOTE} documentos por vez. Selecciona menos y repite.` }, { status: 400 })
    }

    // En SERIE: el acuse es una escritura en el SII y Haulmer limita el ritmo.
    // Paralelizar acá se traduce en 429 y acuses perdidos a mitad del lote.
    const resultados: Array<{ rut: string; dte: number; folio: number; ok: boolean; mensaje: string }> = []
    for (const [i, d] of docs.entries()) {
      if (i > 0) await dormir(1100)
      try {
        const r = await darAcuse(d.rut, d.dte, d.folio, acuse)
        resultados.push({ ...d, ...r })
      } catch (e) {
        resultados.push({ ...d, ok: false, mensaje: e instanceof Error ? e.message : String(e) })
      }
    }

    const exitosas = resultados.filter(r => r.ok).length
    // Un lote donde NO pasó ninguna es un fallo: se responde 400 para que el
    // frontend lo trate como error y no como "listo" con letra chica.
    return NextResponse.json(
      { ok: exitosas > 0, acuse, exitosas, fallidas: resultados.length - exitosas, resultados },
      { status: exitosas > 0 ? 200 : 400 },
    )
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
