import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { esAdmin } from '@/lib/roles'
import { getSheetData } from '@/lib/datastore'
import { formatDateForSheet } from '@/lib/dates'
import { parseDecimalOr0, parsePeso } from '@/lib/numbers'
import { findTramo, precioDelTramo } from '@/lib/tramos'
import { getConfigCobroEutanasia, margenEutanasiaCon } from '@/lib/eutanasia-precios'
import { CLAVE_RETIROS, getPagosRetirosEerr } from '@/lib/eerr-retiros'
import { CLAVE_REMUNERACIONES, getCostoRemuneracionesEerr } from '@/lib/remuneraciones/eerr'

export const dynamic = 'force-dynamic'

const IVA = 1.19
type Cli = Record<string, string>
interface Tramo { id?: string; peso_min: string; peso_max: string; precio_ci: string; precio_cp: string; precio_sd: string; veterinaria_id?: string }
interface Mov { fecha: string; fuente: string; descripcion: string; proveedor: string; documento: string; monto: number }

async function noAutorizado(): Promise<boolean> {
  const s = await getServerSession(authOptions)
  return !esAdmin((s?.user as { role?: string })?.role)
}
function esConvenio(c: Cli): boolean {
  const e = c.tipo_precios
  if (e === 'convenio' || e === 'especial') return true
  if (e === 'general') return false
  return !!c.veterinaria_id
}
function adicionalesSum(raw: string): number {
  try { const items = JSON.parse(raw || '[]') as Array<{ precio?: number; qty?: number }>; return items.reduce((s, a) => s + Math.max(0, a.precio ?? 0) * Math.max(0, a.qty ?? 1), 0) } catch { return 0 }
}
// `base` = precio del servicio de cremación (el descuento aplica SOLO sobre él, no
// sobre los adicionales). Para fichas con snapshot se usa el monto congelado.
function descuentoMonto(c: Cli, base: number): number {
  const snap = parseDecimalOr0(c.descuento_monto); if (snap > 0) return snap
  const dVal = parseDecimalOr0(c.descuento_valor); if (dVal <= 0) return 0
  if (c.descuento_tipo === 'fijo') return Math.min(dVal, base)
  if (c.descuento_tipo === 'variable') return Math.round(base * dVal / 100)
  return 0
}

/** GET /api/eerr/movimientos?partida_id=&periodo=  → detalle (libro) de una cuenta.
 *  periodo: 'YYYY-MM' | 'YYYY' | '' (todos). */
export async function GET(req: NextRequest) {
  if (await noAutorizado()) return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
  try {
    const { searchParams } = new URL(req.url)
    const partidaId = (searchParams.get('partida_id') || '').trim()
    const periodo = (searchParams.get('periodo') || '').trim()
    if (!partidaId) return NextResponse.json({ error: 'partida_id requerido' }, { status: 400 })
    const sliceLen = periodo.length === 4 ? 4 : 7
    const enPeriodo = (iso: string) => !periodo || (formatDateForSheet(iso) || '').slice(0, sliceLen) === periodo

    const partidas = await getSheetData('eerr_partidas')
    const partida = partidas.find(p => p.id === partidaId)
    if (!partida) return NextResponse.json({ error: 'Partida no encontrada' }, { status: 404 })

    const movimientos: Mov[] = []

    if (partida.tipo === 'ingreso' && (partida.clave || '') === 'eutanasias') {
      // Eutanasias: una línea por servicio cerrado, con el MARGEN (lo cobrado al
      // cliente menos lo que se le paga al veterinario). Ver lib/eutanasia-precios.
      const [cots, cfg] = await Promise.all([getSheetData('cotizaciones_eutanasia'), getConfigCobroEutanasia()])
      for (const cot of cots as Cli[]) {
        const m = margenEutanasiaCon(cot, cfg)
        if (!m || m.margen <= 0 || !enPeriodo(m.fecha)) continue
        movimientos.push({
          fecha: m.fecha,
          fuente: 'Eutanasia',
          descripcion: `${cot.mascota_nombre || ''}${cot.cliente_nombre ? ' · ' + cot.cliente_nombre : ''}${m.concepto === 'consulta' ? ' (consulta, no se realizó)' : ''}`.trim(),
          proveedor: cot.vet_nombre_asignado || '',
          documento: `N° ${cot.id} · cobro ${m.cobro.toLocaleString('es-CL')} − vet ${m.pagoVet.toLocaleString('es-CL')}`,
          monto: Math.round(m.margen),
        })
      }
    } else if (partida.tipo === 'ingreso') {
      const clave = partida.clave || ''
      const [clientes, pg, pc, pe, vets] = await Promise.all([
        getSheetData('clientes'), getSheetData('precios_generales'), getSheetData('precios_convenio'), getSheetData('precios_especiales'), getSheetData('veterinarios'),
      ])
      const preciosG = pg as unknown as Tramo[], preciosC = pc as unknown as Tramo[]
      const peByVet = new Map<string, Tramo[]>()
      for (const t of pe as unknown as Tramo[]) { const v = t.veterinaria_id ?? ''; const arr = peByVet.get(v) ?? []; arr.push(t); peByVet.set(v, arr) }
      const vetById: Record<string, Cli> = {}; for (const v of vets as Cli[]) vetById[v.id] = v
      const tablaDe = (c: Cli): Tramo[] => {
        const e = c.tipo_precios
        if (e === 'convenio') return preciosC
        if (e === 'especial') return peByVet.get(c.veterinaria_id ?? '') ?? []
        if (e === 'general') return preciosG
        if (c.veterinaria_id) { const vet = vetById[c.veterinaria_id]; if (vet?.tipo_precios === 'precios_especiales') return peByVet.get(c.veterinaria_id) ?? []; return preciosC }
        return preciosG
      }
      for (const c of clientes as Cli[]) {
        if (c.estado === 'borrador') continue
        if (!enPeriodo(c.fecha_retiro || c.fecha_creacion)) continue
        let serv = parseDecimalOr0(c.precio_servicio), adic = parseDecimalOr0(c.precio_adicionales), total = parseDecimalOr0(c.precio_total)
        if (!(total > 0 || serv > 0 || adic > 0)) {
          const peso = parsePeso(c.peso_ingreso) || parsePeso(c.peso_declarado)
          serv = precioDelTramo(findTramo(tablaDe(c), peso), c.codigo_servicio || 'CI')
          adic = adicionalesSum(c.adicionales)
          total = Math.max(0, serv + adic - descuentoMonto(c, serv))
        }
        const base = serv + adic
        const servShare = base > 0 ? total * (serv / base) : total
        const adicShare = base > 0 ? total * (adic / base) : 0
        const conv = esConvenio(c)
        let monto = 0
        if (clave === 'adicionales') monto = adicShare / IVA
        else if (clave === 'convenio') monto = conv ? servShare / IVA : 0
        else if (clave === 'general') monto = conv ? 0 : servShare / IVA
        if (monto <= 0) continue
        movimientos.push({
          fecha: c.fecha_retiro || c.fecha_creacion, fuente: 'Ficha',
          descripcion: `${c.nombre_mascota || ''}${c.nombre_tutor ? ' · ' + c.nombre_tutor : ''}`.trim(),
          proveedor: c.veterinaria_id ? (vetById[c.veterinaria_id]?.nombre || '') : '',
          documento: c.codigo || '', monto: Math.round(monto),
        })
      }
    } else {
      const [gsii, gman, rend] = await Promise.all([getSheetData('eerr_gastos_sii'), getSheetData('eerr_gastos_manuales'), getSheetData('rendiciones')])
      for (const f of gsii) if (f.contabilizado === 'TRUE' && f.partida_id === partidaId && enPeriodo(f.fecha_documento)) {
        const monto = (parseInt(f.monto_neto) || 0) + (parseInt(f.monto_exento) || 0)
        if (monto > 0) movimientos.push({ fecha: f.fecha_documento, fuente: 'Factura SII', descripcion: f.comentario || '', proveedor: f.razon_social || '', documento: `${f.tipo_doc || ''} ${f.folio || ''}`.trim(), monto })
      }
      for (const g of gman) if (g.partida_id === partidaId && enPeriodo(g.fecha)) {
        const monto = parseInt(g.monto) || 0
        if (monto > 0) movimientos.push({ fecha: g.fecha, fuente: 'Manual', descripcion: g.detalle || '', proveedor: '', documento: '', monto })
      }
      for (const r of rend) if (r.tipo_documento === 'boleta' && r.clasificacion !== 'aporte' && r.partida_id === partidaId && enPeriodo(r.fecha)) {
        const monto = parseInt(r.monto) || 0
        if (monto > 0) movimientos.push({ fecha: r.fecha, fuente: 'Rendición', descripcion: r.descripcion || '', proveedor: r.usuario || '', documento: 'Boleta', monto })
      }
      // Pagos de retiros adicionales (Asistencia → Adicionales), al mes del pago.
      if ((partida.clave || '') === CLAVE_RETIROS) {
        for (const p of await getPagosRetirosEerr()) {
          if (!enPeriodo(p.fecha)) continue
          movimientos.push({
            fecha: p.fecha, fuente: 'Retiros adicionales',
            descripcion: `${p.cantidad} retiro${p.cantidad === 1 ? '' : 's'} fuera de jornada`,
            proveedor: p.usuario, documento: `Pago N° ${p.id}`, monto: p.monto,
          })
        }
      }
      // Remuneraciones: una fila por liquidación pagada, al mes devengado.
      if ((partida.clave || '') === CLAVE_REMUNERACIONES) {
        for (const c of await getCostoRemuneracionesEerr()) {
          if (!enPeriodo(c.fecha)) continue
          movimientos.push({
            fecha: c.fecha, fuente: 'Remuneraciones',
            descripcion: `Sueldo ${c.periodo} (costo empresa)`,
            proveedor: c.empleado, documento: `Liquidación N° ${c.id}`, monto: c.monto,
          })
        }
      }
    }

    const total = movimientos.reduce((s, m) => s + m.monto, 0)
    return NextResponse.json({ partida: partida.nombre, tipo: partida.tipo, movimientos, total })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
