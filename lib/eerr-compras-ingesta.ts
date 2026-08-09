import { getSheetData, appendRow, updateById, getNextId } from './datastore'
import { todayISO } from './dates'
import type { FacturaSii } from './eerr-sii'

/**
 * INGESTA de compras al EERR. Fuente única — la comparten la carga manual del CSV
 * del SII y la sincronización automática con OpenFactura
 * ([openfactura-consulta.ts](openfactura-consulta.ts)). Vivía dentro del POST de
 * `/api/eerr/gastos-sii`; se extrajo al sumar el botón «Sincronizar SII» para que
 * los dos caminos no se separaran (dedupe, relleno de blancos y contabilización
 * automática tienen que comportarse igual venga el dato de donde venga).
 */

const SHEET = 'eerr_gastos_sii'
const PROV = 'eerr_proveedores'

/** Un documento es el mismo si coinciden proveedor, tipo y folio. */
const claveDedup = (rut: string, tipoDoc: string, folio: string) => `${rut}|${tipoDoc}|${folio}`

// Campos que vienen del SII (no del usuario: comentario/partida/etc. no se tocan).
// Para un documento YA cargado, si uno está en blanco y el nuevo lo trae, se
// rellena. Los montos vacíos se guardan como '0', así que '0' cuenta como blanco.
const CAMPOS_SII = ['razon_social', 'tipo_compra', 'fecha_documento', 'fecha_recepcion', 'monto_exento', 'monto_neto', 'monto_iva', 'monto_total', 'valor_otro_impuesto']
const esBlank = (v: string | undefined) => { const s = (v || '').trim(); return s === '' || s === '0' }

export interface ResultadoIngesta {
  nuevas: number
  duplicadas: number
  completadas: number
  proveedores_nuevos: number
  fecha_carga: string
}

/**
 * Inserta las compras que falten. Idempotente: reprocesar el mismo mes no
 * duplica nada, solo completa campos que hubieran quedado en blanco.
 *
 * Efectos:
 *  - da de alta los proveedores que aparecen por primera vez (sin contabilización
 *    automática: eso lo configura el usuario la primera vez que asigna una partida);
 *  - a las compras NUEVAS les aplica la contabilización automática del proveedor
 *    si ya estaba configurada.
 */
export async function ingestarCompras(facturas: FacturaSii[]): Promise<ResultadoIngesta> {
  const [existentes, proveedores] = await Promise.all([getSheetData(SHEET), getSheetData(PROV)])
  const existByKey = new Map(existentes.map(r => [claveDedup(r.rut, r.tipo_doc, r.folio), r]))
  const provByRut = new Map(proveedores.map(p => [p.rut, p]))
  const fechaCarga = todayISO()

  // Proveedores nuevos primero: las compras que siguen los buscan por RUT.
  const rutsNuevos = new Map<string, string>() // rut -> razon_social
  for (const f of facturas) {
    if (!provByRut.has(f.rut) && !rutsNuevos.has(f.rut)) rutsNuevos.set(f.rut, f.razon_social)
  }
  for (const [rut, razon] of rutsNuevos) {
    // getNextId por fila y secuencial: paralelizar rompe la unicidad del id.
    const id = await getNextId(PROV)
    await appendRow(PROV, {
      id, rut, razon_social: razon,
      auto_contabiliza: 'FALSE', auto_tipo: '', auto_partida_id: '',
      fecha_creacion: fechaCarga,
    })
  }

  let nuevas = 0, duplicadas = 0, completadas = 0
  const vistas = new Set<string>()
  for (const f of facturas) {
    const k = claveDedup(f.rut, f.tipo_doc, f.folio)
    if (vistas.has(k)) { duplicadas++; continue }
    vistas.add(k)

    const existe = existByKey.get(k)
    if (existe) {
      // Ya cargada: no se duplica. Si lo existente tiene campos en blanco y el
      // nuevo los trae completos, se rellenan SOLO esos (nunca se pisan datos ya
      // cargados ni los del usuario: comentario/partida/contabilizado).
      const fRec = f as unknown as Record<string, string>
      const cambios: Record<string, string> = {}
      for (const c of CAMPOS_SII) {
        if (esBlank(existe[c]) && !esBlank(fRec[c])) cambios[c] = fRec[c]
      }
      if (Object.keys(cambios).length > 0) {
        await updateById(SHEET, existe.id, { ...existe, ...cambios })
        completadas++
      } else {
        duplicadas++
      }
      continue
    }

    const prov = provByRut.get(f.rut)
    const auto = prov?.auto_contabiliza === 'TRUE' && prov.auto_partida_id
      ? { tipo_asignacion: prov.auto_tipo, partida_id: prov.auto_partida_id, contabilizado: 'TRUE' }
      : { tipo_asignacion: '', partida_id: '', contabilizado: 'FALSE' }

    const id = await getNextId(SHEET)
    await appendRow(SHEET, {
      id,
      tipo_doc: f.tipo_doc, tipo_compra: f.tipo_compra, rut: f.rut, razon_social: f.razon_social, folio: f.folio,
      fecha_documento: f.fecha_documento, fecha_recepcion: f.fecha_recepcion,
      monto_exento: f.monto_exento, monto_neto: f.monto_neto, monto_iva: f.monto_iva,
      monto_total: f.monto_total, valor_otro_impuesto: f.valor_otro_impuesto,
      comentario: '',
      ...auto,
      fecha_carga: fechaCarga,
      fecha_creacion: fechaCarga,
    })
    nuevas++
  }

  return { nuevas, duplicadas, completadas, proveedores_nuevos: rutsNuevos.size, fecha_carga: fechaCarga }
}
