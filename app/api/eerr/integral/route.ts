import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { esAdmin } from '@/lib/roles'
import { getSheetData } from '@/lib/datastore'
import { todayISO, formatDateForSheet } from '@/lib/dates'
import { getPagosRetirosEerr, partidaRetiros } from '@/lib/eerr-retiros'
import { getCostoRemuneracionesEerr, partidaImposiciones, partidaRemuneraciones } from '@/lib/remuneraciones/eerr'
import { calcularIngresos } from '@/lib/eerr-ingresos'
import { netoDeCompra } from '@/lib/eerr-compras-ingesta'

export const dynamic = 'force-dynamic'

const MES_ABBR = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

type Cli = Record<string, string>

async function noAutorizado(): Promise<boolean> {
  const s = await getServerSession(authOptions)
  return !esAdmin((s?.user as { role?: string })?.role)
}

function labelMes(k: string): string {
  const [y, m] = k.split('-')
  return `${MES_ABBR[(parseInt(m) || 1) - 1]} ${(y || '').slice(2)}`
}
function ultimos12Meses(hoyMes: string): string[] {
  const [y, m] = hoyMes.split('-').map(Number)
  const keys: string[] = []
  for (let i = 11; i >= 0; i--) {
    let mm = m - i, yy = y
    while (mm <= 0) { mm += 12; yy -= 1 }
    keys.push(`${yy}-${String(mm).padStart(2, '0')}`)
  }
  return keys
}

export async function GET(req: NextRequest) {
  if (await noAutorizado()) return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
  try {
    const { searchParams } = new URL(req.url)
    const mes = (searchParams.get('mes') || '').trim()   // YYYY-MM
    const anio = (searchParams.get('anio') || '').trim() // YYYY

    // Períodos + cómo mapear una fecha a su columna.
    let periodos: { key: string; label: string }[]
    let sliceLen: number
    if (anio) { periodos = [{ key: anio, label: anio }]; sliceLen = 4 }
    else if (mes) { periodos = [{ key: mes, label: labelMes(mes) }]; sliceLen = 7 }
    else { periodos = ultimos12Meses(todayISO().slice(0, 7)).map(k => ({ key: k, label: labelMes(k) })); sliceLen = 7 }
    const idxByKey = new Map(periodos.map((p, i) => [p.key, i]))
    const periodIdx = (iso: string): number | undefined => idxByKey.get((formatDateForSheet(iso) || '').slice(0, sliceLen))
    const N = periodos.length
    const zeros = () => new Array(N).fill(0)

    // Los INGRESOS los calcula lib/eerr-ingresos (misma fuente que la Conciliación
    // del SII en Facturación): acá solo se arman costos, gastos e impuestos.
    const [ingresoPorClave, partidas, subgrupos, gastosSii, gastosMan, rendiciones, pagosRetiros, costoRemuneraciones] = await Promise.all([
      calcularIngresos(periodIdx, N),
      getSheetData('eerr_partidas'),
      getSheetData('eerr_subgrupos'),
      getSheetData('eerr_gastos_sii'),
      getSheetData('eerr_gastos_manuales'),
      getSheetData('rendiciones'),
      getPagosRetirosEerr(),
      getCostoRemuneracionesEerr(),
    ])

    // ── COSTO / GASTO / IMPUESTO: gastos asignados a cada partida, por período.
    const porPartida = new Map<string, number[]>()
    // Acepta montos NEGATIVOS: las notas de crédito de compra restan.
    const add = (partida_id: string, iso: string, monto: number) => {
      if (!partida_id || !Number.isFinite(monto) || monto === 0) return
      const p = periodIdx(iso)
      if (p === undefined) return
      const arr = porPartida.get(partida_id) ?? zeros()
      arr[p] += monto
      porPartida.set(partida_id, arr)
    }
    // Mes = fecha de emisión. Las compras sin emisión NO entran (la UI las marca
    // con una alerta para que el usuario complete la fecha).
    for (const f of gastosSii as Cli[]) {
      if (f.contabilizado !== 'TRUE' || !f.partida_id) continue
      add(f.partida_id, f.fecha_documento, netoDeCompra(f))
    }
    for (const g of gastosMan as Cli[]) add(g.partida_id, g.fecha, parseInt(g.monto) || 0)
    for (const r of rendiciones as Cli[]) {
      // Solo boletas de rendición con partida. Las facturas vienen del SII y los
      // aportes (préstamos a la empresa) no van al resultado.
      if (r.tipo_documento === 'boleta' && r.clasificacion !== 'aporte' && r.partida_id) add(r.partida_id, r.fecha, parseInt(r.monto) || 0)
    }
    // Pagos de retiros adicionales (Asistencia → Adicionales): automáticos, al mes
    // del pago, en la partida marcada con la clave `retiros_adicionales`.
    const pRetiros = partidaRetiros(partidas as Cli[])
    if (pRetiros) for (const p of pagosRetiros) add(pRetiros.id, p.fecha, p.monto)
    // Remuneraciones: liquidaciones PAGADAS imputadas al mes DEVENGADO (el sueldo
    // de julio es costo de julio aunque se pague en agosto), partidas en dos:
    // «Personal» lo que se le transfiere al trabajador e «Imposiciones» las
    // cotizaciones y los aportes patronales. Fuente automática: no hay que
    // cargar los sueldos a mano en Compras ni en Gastos manuales.
    const pRemun = partidaRemuneraciones(partidas as Cli[])
    const pImpos = partidaImposiciones(partidas as Cli[])
    for (const c of costoRemuneraciones) {
      if (pRemun) add(pRemun.id, c.fecha, c.transferido)
      // Sin partida de Imposiciones, todo cae en Personal para no perder costo.
      add(pImpos?.id ?? pRemun?.id ?? '', c.fecha, c.imposiciones)
    }

    const sgById = new Map<string, { nombre: string; orden: number }>()
    for (const s of subgrupos as Cli[]) sgById.set(s.id, { nombre: s.nombre, orden: parseInt(s.orden) || 0 })
    const SUELTA = 99999

    // `clave` viene de la fila de eerr_partidas (texto libre en la base): puede no
    // corresponder a ninguna clave de ingreso conocida → esa partida va en cero.
    const porClave = ingresoPorClave as Record<string, number[] | undefined>
    const fila = (p: Cli) => {
      const valores = p.tipo === 'ingreso'
        ? ([...(porClave[p.clave] ?? zeros())])
        : (porPartida.get(p.id) ?? zeros())
      const sg = sgById.get(p.subgrupo_id || '')
      return { nombre: p.nombre, valores, subgrupo: sg?.nombre || '', sgOrden: sg ? sg.orden : SUELTA, partida_id: p.id, tipo: p.tipo, clave: p.clave || '' }
    }
    const activas = (partidas as Cli[]).filter(p => p.activo !== 'FALSE')
    // Orden dentro de un tipo: primero los subgrupos (por su orden), luego las
    // partidas sueltas; dentro de cada uno, por el orden de la partida.
    const grupo = (tipo: string) =>
      activas
        .filter(p => p.tipo === tipo)
        .sort((a, b) => {
          const oa = sgById.get(a.subgrupo_id || '')?.orden ?? SUELTA
          const ob = sgById.get(b.subgrupo_id || '')?.orden ?? SUELTA
          return oa - ob || (parseInt(a.orden) || 0) - (parseInt(b.orden) || 0)
        })
        .map(fila)

    return NextResponse.json({
      periodos,
      ingresos: grupo('ingreso'),
      costos: grupo('costo'),
      gastos: grupo('gasto'),
      impuestos: grupo('impuesto'),
    })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
