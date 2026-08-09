import { NextRequest, NextResponse } from 'next/server'
import { puedeNivel } from '@/lib/permisos-server'
import { getSheetData, appendRow, updateByIdIf, getNextId } from '@/lib/datastore'
import { todayISO, formatDateForSheet } from '@/lib/dates'
import { parseArchivoVentas, resumirVentasSii, type ResumenSii, type DocVentaSii } from '@/lib/sii-ventas'
import { ventasParaConciliacion, puedeConsultarOpenFactura } from '@/lib/openfactura-consulta'
import { calcularIngresos, SE_DOCUMENTA, type ClaveIngreso } from '@/lib/eerr-ingresos'

/**
 * CONCILIACIÓN de ventas: lo declarado al SII vs lo vendido según el sistema.
 *
 * El SII entrega las ventas en DOS archivos (detalle de facturas/NC y boletas
 * diferidas .gz — ver lib/sii-ventas). Acá se suben, se resumen y se comparan
 * contra los ingresos del EERR (lib/eerr-ingresos, la MISMA fuente que el Estado
 * de Resultados) para cazar ventas que no llegaron a documentarse.
 *
 * Lo del SII se PERSISTE (`conciliacion_sii`, un registro por período) porque es
 * un hecho fechado: lo que ese mes decía el SII. Lo del sistema se calcula SIEMPRE
 * en vivo — si se corrige una ficha vieja, el histórico tiene que reflejarlo, no
 * quedar congelado en un número que ya no es cierto.
 */

export const dynamic = 'force-dynamic'
// Un mes con varias páginas se pagina a ~1 request/segundo (límite de Haulmer).
export const maxDuration = 120

const SHEET = 'conciliacion_sii'

/** ¿Es un período válido YYYY-MM? */
const esPeriodo = (s: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(s)

interface TotDoc { docs: number; neto: number; total: number }
const vacioDoc = (): TotDoc => ({ docs: 0, neto: 0, total: 0 })

export interface LadoSistema {
  ingresos: Record<ClaveIngreso, number>
  /** Suma de los ingresos que SÍ deberían tener respaldo tributario (netos). */
  documentable: number
  /** Lo que nosotros registramos haber emitido, desde `documentos_tributarios`. */
  emitido: { boletas: TotDoc; facturas: TotDoc; notas_credito: TotDoc; neto_venta: number }
}

/**
 * Lo vendido según NOSOTROS en un período: ingresos del EERR + documentos que
 * dejamos registrados como emitidos. Son dos miradas distintas a propósito: la
 * primera es la venta real (aunque nadie la haya boleteado) y la segunda es lo
 * que creemos haberle informado al SII. Si esas dos no calzan entre sí, el
 * problema es nuestro y no del SII.
 */
async function ladoSistema(periodo: string): Promise<LadoSistema> {
  const periodIdx = (iso: string): number | undefined =>
    (formatDateForSheet(iso) || '').slice(0, 7) === periodo ? 0 : undefined

  const [ing, docs] = await Promise.all([
    calcularIngresos(periodIdx, 1),
    getSheetData('documentos_tributarios'),
  ])

  const ingresos = {
    general: Math.round(ing.general[0]),
    convenio: Math.round(ing.convenio[0]),
    adicionales: Math.round(ing.adicionales[0]),
    eutanasias: Math.round(ing.eutanasias[0]),
  }
  const documentable = (Object.keys(ingresos) as ClaveIngreso[])
    .filter(k => SE_DOCUMENTA[k])
    .reduce((s, k) => s + ingresos[k], 0)

  const emitido = { boletas: vacioDoc(), facturas: vacioDoc(), notas_credito: vacioDoc(), neto_venta: 0 }
  for (const d of docs) {
    if ((formatDateForSheet(d.fecha_emision) || '').slice(0, 7) !== periodo) continue
    // Sin folio no llegó al SII (emisión fallida): no puede aparecer del otro lado.
    if (!String(d.folio || '').trim()) continue
    const neto = parseInt(d.monto_neto, 10) || 0
    const total = parseInt(d.monto_total, 10) || 0
    const t = d.tipo_dte === '61' ? emitido.notas_credito : d.tipo_dte === '33' ? emitido.facturas : d.tipo_dte === '39' ? emitido.boletas : null
    if (!t) continue
    t.docs++; t.neto += neto; t.total += total
  }
  emitido.neto_venta = emitido.boletas.neto + emitido.facturas.neto - emitido.notas_credito.neto

  return { ingresos, documentable, emitido }
}

/** Fila guardada de un período conciliado. */
async function filaDe(periodo: string): Promise<Record<string, string> | undefined> {
  return (await getSheetData(SHEET)).find(r => r.periodo === periodo)
}

function leerSii(row?: Record<string, string>): ResumenSii | null {
  if (!row?.sii_json) return null
  try { return JSON.parse(row.sii_json) as ResumenSii } catch { return null }
}

/**
 * GET ?periodo=YYYY-MM → el período pedido (o el último cargado) + el histórico
 * de todos los meses conciliados, cada uno con su lado del sistema recalculado.
 */
export async function GET(req: NextRequest) {
  if (!(await puedeNivel('facturacion', 'ver'))) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
  }
  try {
    const pedido = (new URL(req.url).searchParams.get('periodo') || '').trim()
    const filas = (await getSheetData(SHEET)).sort((a, b) => (b.periodo || '').localeCompare(a.periodo || ''))
    const periodo = esPeriodo(pedido) ? pedido : (filas[0]?.periodo || todayISO().slice(0, 7))

    const fila = filas.find(r => r.periodo === periodo)
    const [sistema, historico] = await Promise.all([
      ladoSistema(periodo),
      // El histórico recalcula el lado del sistema de cada mes: una corrección en
      // una ficha vieja tiene que verse acá, no quedar congelada.
      Promise.all(filas.filter(r => r.periodo !== periodo).map(async r => ({
        periodo: r.periodo,
        fecha_carga: r.fecha_carga || '',
        sii: leerSii(r),
        sistema: await ladoSistema(r.periodo),
      }))),
    ])

    return NextResponse.json({
      periodo,
      sii: leerSii(fila),
      fecha_carga: fila?.fecha_carga || '',
      sistema,
      historico,
      periodos_cargados: filas.map(r => r.periodo),
    })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

/**
 * POST multipart `archivos` (1 o 2: detalle de ventas y/o boletas .gz).
 *
 * El período NO se pide por formulario: sale de las fechas de los propios
 * documentos. Si los archivos mezclan meses se rechaza — conciliar dos períodos
 * juntos da un número que no cuadra con nada.
 *
 * Los dos archivos del mismo mes se FUSIONAN: subir primero las facturas y
 * después las boletas tiene que dejar el período completo, no pisarlo. Por eso se
 * guardan los documentos crudos y el resumen se recalcula sobre el conjunto.
 */
export async function POST(req: NextRequest) {
  if (!(await puedeNivel('facturacion', 'editar'))) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
  }
  try {
    // Dos caminos hacia el mismo lugar: sincronizar contra OpenFactura (JSON, el
    // normal) o subir los CSV del SII a mano (multipart, el respaldo). Los dos
    // terminan en la misma lista de documentos y en la misma fusión.
    const nuevos: DocVentaSii[] = []
    const esSync = (req.headers.get('content-type') || '').includes('application/json')

    if (esSync) {
      const { periodo } = await req.json().catch(() => ({ periodo: '' }))
      const p = String(periodo || '').trim()
      if (!esPeriodo(p)) return NextResponse.json({ error: 'Indica el período a sincronizar (mes y año).' }, { status: 400 })
      if (p > todayISO().slice(0, 7)) return NextResponse.json({ error: 'Ese período todavía no ocurre.' }, { status: 400 })
      if (!puedeConsultarOpenFactura()) {
        return NextResponse.json({ error: 'OpenFactura no está configurado (falta OPENFACTURA_API_KEY).' }, { status: 400 })
      }
      nuevos.push(...(await ventasParaConciliacion(p)))
      if (nuevos.length === 0) {
        return NextResponse.json({ error: `No hay ventas emitidas en ${p}.` }, { status: 400 })
      }
    } else {
      const form = await req.formData()
      const archivos = form.getAll('archivos').filter((f): f is File => f instanceof File && f.size > 0)
      if (archivos.length === 0) {
        return NextResponse.json({ error: 'Sube al menos un archivo del SII (detalle de ventas o boletas).' }, { status: 400 })
      }
      for (const f of archivos) {
        let docs
        try { docs = parseArchivoVentas(await f.arrayBuffer()) } catch (e) {
          return NextResponse.json({ error: `No pude leer "${f.name}": ${e instanceof Error ? e.message : String(e)}` }, { status: 400 })
        }
        if (docs.length === 0) {
          return NextResponse.json({ error: `"${f.name}" no tiene documentos. ¿Es el CSV de VENTAS del SII (detalle o boletas)?` }, { status: 400 })
        }
        nuevos.push(...docs)
      }
    }

    const periodos = [...new Set(nuevos.map(d => d.fecha.slice(0, 7)).filter(Boolean))]
    if (periodos.length === 0) return NextResponse.json({ error: 'Los documentos no traen fecha; no puedo determinar el período.' }, { status: 400 })
    if (periodos.length > 1) {
      return NextResponse.json({ error: `Los archivos mezclan varios períodos (${periodos.join(', ')}). Sube un mes a la vez.` }, { status: 400 })
    }
    const periodo = periodos[0]

    // Fusión con lo ya cargado del mismo período, deduplicando por tipo+folio: el
    // usuario sube los dos archivos en dos pasos y a veces repite uno.
    const fila = await filaDe(periodo)
    let previos: DocVentaSii[] = []
    if (fila?.docs_json) { try { previos = JSON.parse(fila.docs_json) } catch { previos = [] } }
    const porClave = new Map(previos.map(d => [`${d.tipo_doc}|${d.folio}`, d]))
    let agregados = 0
    for (const d of nuevos) {
      const k = `${d.tipo_doc}|${d.folio}`
      if (!porClave.has(k)) agregados++
      porClave.set(k, d)
    }
    const todos = [...porClave.values()]
    const sii = resumirVentasSii(todos)

    const payload = {
      periodo,
      sii_json: JSON.stringify(sii),
      docs_json: JSON.stringify(todos),
      fecha_carga: todayISO(),
    }
    if (fila) await updateByIdIf(SHEET, fila.id, {}, payload)
    else await appendRow(SHEET, { id: await getNextId(SHEET), ...payload, fecha_creacion: todayISO() })

    return NextResponse.json({
      ok: true, periodo, agregados, total_documentos: todos.length, origen: esSync ? 'openfactura' : 'archivo',
      sii, sistema: await ladoSistema(periodo),
    })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
