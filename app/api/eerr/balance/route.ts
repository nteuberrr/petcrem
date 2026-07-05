import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { esAdminTotal } from '@/lib/roles'
import { getSheetData } from '@/lib/datastore'
import { todayISO, formatDateForSheet } from '@/lib/dates'
import { parseDecimalOr0 } from '@/lib/numbers'

/**
 * Balance — Posición de IVA (F29) + otras cuentas de balance.
 *
 * IVA DÉBITO FISCAL (pasivo): el IVA contenido en cada venta desde junio 2026
 * (antes no se pagaba IVA). Los precios de las fichas están CON IVA incluido, así
 * que el débito por venta = bruto − bruto/1,19 = bruto × 19/119. Se usa
 * `precio_total` (servicio + adicionales/ánforas). La eutanasia a domicilio NO
 * entra (no vive en `clientes`, se factura aparte).
 *
 * IVA CRÉDITO FISCAL (activo): el "Monto IVA Recuperable" de las facturas del SII
 * (hoja eerr_gastos_sii) que estén CONTABILIZADAS, por mes de emisión. Boletas y
 * rendiciones no generan crédito (no tienen IVA recuperable).
 *
 * Con el débito y el crédito por mes se arma el F29 con arrastre de remanente:
 * si el crédito supera al débito, el saldo a favor se acumula al mes siguiente.
 */
export const dynamic = 'force-dynamic'

const IVA = 1.19
const DESDE = '2026-06' // junio 2026: antes no se pagaba IVA
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
const mesDe = (f: string): string => (formatDateForSheet(f) || '').slice(0, 7)

export async function GET() {
  const s = await getServerSession(authOptions)
  if (!esAdminTotal((s?.user as { role?: string })?.role)) return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
  try {
    const hoyMes = todayISO().slice(0, 7)
    const hasta = hoyMes < DESDE ? DESDE : hoyMes
    const meses = mesesEntre(DESDE, hasta)
    const enRango = (m: string) => m >= DESDE && m <= hasta

    const [clientes, gastosSii, rendiciones] = await Promise.all([
      getSheetData('clientes'),
      getSheetData('eerr_gastos_sii'),
      getSheetData('rendiciones'),
    ])

    const debito: Record<string, number> = {}
    const credito: Record<string, number> = {}
    for (const m of meses) { debito[m] = 0; credito[m] = 0 }

    // Débito: IVA incluido en el precio_total de cada ficha (no borrador), por mes de retiro.
    for (const c of clientes as Record<string, string>[]) {
      if (c.estado === 'borrador') continue
      const m = mesDe(c.fecha_retiro || c.fecha_creacion)
      if (!enRango(m)) continue
      const total = parseDecimalOr0(c.precio_total)
      if (total <= 0) continue
      debito[m] += total - total / IVA
    }

    // Crédito: IVA recuperable de las facturas SII contabilizadas, por mes de emisión.
    for (const f of gastosSii as Record<string, string>[]) {
      if (f.contabilizado !== 'TRUE') continue
      const m = mesDe(f.fecha_documento)
      if (!enRango(m)) continue
      credito[m] += parseInt(f.monto_iva) || 0
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
