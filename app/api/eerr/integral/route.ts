import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { esAdminTotal } from '@/lib/roles'
import { getSheetData } from '@/lib/datastore'
import { todayISO, formatDateForSheet } from '@/lib/dates'
import { parseDecimalOr0, parsePeso } from '@/lib/numbers'
import { findTramo, precioDelTramo } from '@/lib/tramos'

export const dynamic = 'force-dynamic'

const IVA = 1.19
const MES_ABBR = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

interface Tramo { id?: string; peso_min: string; peso_max: string; precio_ci: string; precio_cp: string; precio_sd: string; veterinaria_id?: string }
type Cli = Record<string, string>

async function noAutorizado(): Promise<boolean> {
  const s = await getServerSession(authOptions)
  return !esAdminTotal((s?.user as { role?: string })?.role)
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

function esConvenio(c: Cli): boolean {
  const e = c.tipo_precios
  if (e === 'convenio' || e === 'especial') return true
  if (e === 'general') return false
  return !!c.veterinaria_id
}
function adicionalesSum(raw: string): number {
  try {
    const items = JSON.parse(raw || '[]') as Array<{ precio?: number; qty?: number }>
    return items.reduce((s, a) => s + Math.max(0, a.precio ?? 0) * Math.max(0, a.qty ?? 1), 0)
  } catch { return 0 }
}
function descuentoMonto(c: Cli, subtotal: number): number {
  const snap = parseDecimalOr0(c.descuento_monto)
  if (snap > 0) return snap
  const dVal = parseDecimalOr0(c.descuento_valor)
  if (dVal <= 0) return 0
  if (c.descuento_tipo === 'fijo') return Math.min(dVal, subtotal)
  if (c.descuento_tipo === 'variable') return Math.round(subtotal * dVal / 100)
  return 0
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

    const [clientes, partidas, subgrupos, gastosSii, gastosMan, rendiciones, pg, pc, pe, vets] = await Promise.all([
      getSheetData('clientes'),
      getSheetData('eerr_partidas'),
      getSheetData('eerr_subgrupos'),
      getSheetData('eerr_gastos_sii'),
      getSheetData('eerr_gastos_manuales'),
      getSheetData('rendiciones'),
      getSheetData('precios_generales'),
      getSheetData('precios_convenio'),
      getSheetData('precios_especiales'),
      getSheetData('veterinarios'),
    ])

    const preciosG = pg as unknown as Tramo[]
    const preciosC = pc as unknown as Tramo[]
    const peByVet = new Map<string, Tramo[]>()
    for (const t of pe as unknown as Tramo[]) {
      const v = t.veterinaria_id ?? ''
      const arr = peByVet.get(v) ?? []; arr.push(t); peByVet.set(v, arr)
    }
    const vetById: Record<string, Cli> = {}
    for (const v of vets as Cli[]) vetById[v.id] = v

    function tablaDe(c: Cli): Tramo[] {
      const e = c.tipo_precios
      if (e === 'convenio') return preciosC
      if (e === 'especial') return peByVet.get(c.veterinaria_id ?? '') ?? []
      if (e === 'general') return preciosG
      if (c.veterinaria_id) {
        const vet = vetById[c.veterinaria_id]
        if (vet?.tipo_precios === 'precios_especiales') return peByVet.get(c.veterinaria_id) ?? []
        return preciosC
      }
      return preciosG
    }

    // ── INGRESOS (neto = ÷1,19). General/Convenios = servicio; Adicionales aparte.
    // El descuento se reparte proporcional usando precio_total (ya neto de descuento).
    const inGeneral = zeros(), inConvenio = zeros(), inAdic = zeros()
    for (const c of clientes as Cli[]) {
      if (c.estado === 'borrador') continue
      const p = periodIdx(c.fecha_retiro || c.fecha_creacion)
      if (p === undefined) continue
      let serv = parseDecimalOr0(c.precio_servicio)
      let adic = parseDecimalOr0(c.precio_adicionales)
      let total = parseDecimalOr0(c.precio_total)
      if (!(total > 0 || serv > 0 || adic > 0)) {
        // Ficha legacy sin snapshot → recalcular en vivo.
        const peso = parsePeso(c.peso_ingreso) || parsePeso(c.peso_declarado)
        serv = precioDelTramo(findTramo(tablaDe(c), peso), c.codigo_servicio || 'CI')
        adic = adicionalesSum(c.adicionales)
        total = Math.max(0, serv + adic - descuentoMonto(c, serv + adic))
      }
      const base = serv + adic
      const servShare = base > 0 ? total * (serv / base) : total
      const adicShare = base > 0 ? total * (adic / base) : 0
      if (esConvenio(c)) inConvenio[p] += servShare / IVA
      else inGeneral[p] += servShare / IVA
      inAdic[p] += adicShare / IVA
    }
    const ingresoPorClave: Record<string, number[]> = { general: inGeneral, convenio: inConvenio, adicionales: inAdic, eutanasias: zeros() }

    // ── COSTO / GASTO / IMPUESTO: gastos asignados a cada partida, por período.
    const porPartida = new Map<string, number[]>()
    const add = (partida_id: string, iso: string, monto: number) => {
      if (!partida_id || !(monto > 0)) return
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
      add(f.partida_id, f.fecha_documento, (parseInt(f.monto_neto) || 0) + (parseInt(f.monto_exento) || 0))
    }
    for (const g of gastosMan as Cli[]) add(g.partida_id, g.fecha, parseInt(g.monto) || 0)
    for (const r of rendiciones as Cli[]) {
      if (r.tipo_documento === 'boleta' && r.partida_id) add(r.partida_id, r.fecha, parseInt(r.monto) || 0)
    }

    const sgById = new Map<string, { nombre: string; orden: number }>()
    for (const s of subgrupos as Cli[]) sgById.set(s.id, { nombre: s.nombre, orden: parseInt(s.orden) || 0 })
    const SUELTA = 99999

    const fila = (p: Cli) => {
      const valores = p.tipo === 'ingreso'
        ? (ingresoPorClave[p.clave] ? [...ingresoPorClave[p.clave]] : zeros())
        : (porPartida.get(p.id) ?? zeros())
      const sg = sgById.get(p.subgrupo_id || '')
      return { nombre: p.nombre, valores, subgrupo: sg?.nombre || '', sgOrden: sg ? sg.orden : SUELTA }
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
