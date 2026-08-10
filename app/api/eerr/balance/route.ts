import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { esAdmin } from '@/lib/roles'
import { getSheetData } from '@/lib/datastore'
import { todayISO } from '@/lib/dates'
import { parseDecimalOr0 } from '@/lib/numbers'
import { ivaPorMes } from '@/lib/eerr-iva'

/**
 * Balance — Posición de IVA (F29) + otras cuentas de balance.
 *
 * El débito y el crédito de cada mes salen de [lib/eerr-iva.ts](lib/eerr-iva.ts),
 * la misma fuente que alimenta la línea informativa de IVA del EERR. Acá se les
 * agrega lo propio del F29: el ARRASTRE DE REMANENTE, o sea que cuando el
 * crédito supera al débito el saldo a favor pasa al mes siguiente en vez de
 * perderse.
 */
export const dynamic = 'force-dynamic'

const MES_ABBR = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

function labelMes(k: string): string {
  const [y, m] = k.split('-')
  return `${MES_ABBR[(parseInt(m) || 1) - 1]} ${(y || '').slice(2)}`
}
/** Lista de meses YYYY-MM desde `desde` hasta `hasta` (ambos inclusive). */
function mesesEntre(desde: string, hasta: string): string[] {
  const out: string[] = []
  let [y, m] = desde.split('-').map(Number)
  const [hy, hm] = hasta.split('-').map(Number)
  while (y < hy || (y === hy && m <= hm)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`)
    m++; if (m > 12) { m = 1; y++ }
  }
  return out
}
export async function GET() {
  const s = await getServerSession(authOptions)
  if (!esAdmin((s?.user as { role?: string })?.role)) return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
  try {
    const [rendiciones, iva] = await Promise.all([
      getSheetData('rendiciones'),
      ivaPorMes(),
    ])

    // Débito y crédito salen de lib/eerr-iva, la misma fuente que usa la línea
    // del EERR: si se calcularan por separado, un día dirían cosas distintas
    // sobre el mismo mes. Los meses son los que tienen el registro de ventas del
    // SII cargado — un mes sin cargar no vale cero, vale «no sabemos», y meterlo
    // inventaría un remanente a favor del tamaño de todo su crédito.
    const cargados = [...iva.keys()].sort()
    const DESDE = cargados[0] || todayISO().slice(0, 7)
    const hasta = cargados[cargados.length - 1] || DESDE
    const meses = mesesEntre(DESDE, hasta)

    const debito: Record<string, number> = {}
    const credito: Record<string, number> = {}
    for (const m of meses) {
      const v = iva.get(m)
      debito[m] = v?.debito ?? 0
      credito[m] = v?.credito ?? 0
    }

    // F29 mes a mes con arrastre de remanente (saldo a favor que pasa al mes siguiente).
    let remanente = 0
    let debitoTotal = 0, creditoTotal = 0, aPagarTotal = 0
    const filas = meses.map(k => {
      const d = Math.round(debito[k] || 0)
      const cr = Math.round(credito[k] || 0)
      const disponible = cr + remanente
      let aPagar = 0
      if (d > disponible) { aPagar = d - disponible; remanente = 0 }
      else { remanente = disponible - d }
      debitoTotal += d; creditoTotal += cr; aPagarTotal += aPagar
      return { key: k, label: labelMes(k), debito: d, credito: cr, a_pagar: aPagar, remanente }
    })

    // Pasivo: préstamos de socios (aportes en rendiciones). Acumulado histórico
    // (no se descuentan devoluciones: aún no se registran).
    let prestamosSocios = 0
    for (const r of rendiciones as Record<string, string>[]) {
      if (r.clasificacion === 'aporte') prestamosSocios += parseDecimalOr0(r.monto)
    }

    return NextResponse.json({
      desde: DESDE,
      hasta,
      meses: filas,
      iva: {
        debito_total: debitoTotal,
        credito_total: creditoTotal,
        saldo_favor: remanente,        // remanente F29 vigente (lo que tenemos a favor)
        a_pagar_total: aPagarTotal,    // suma de lo pagado/por pagar en los meses con débito > crédito
      },
      pasivos: { prestamos_socios: Math.round(prestamosSocios) },
    })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
