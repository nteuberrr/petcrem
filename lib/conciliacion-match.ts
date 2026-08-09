import { getSheetData } from './datastore'
import { formatDateForSheet } from './dates'
import { detalleIngresos, LABEL_INGRESO, type ClaveIngreso, type ItemIngreso } from './eerr-ingresos'
import type { DocVentaSii } from './sii-ventas'

/**
 * ATRIBUCIÓN de los documentos del SII a nuestras categorías de ingreso.
 *
 * Sin esto, el cuadro "según el SII" solo sabe decir boletas/facturas/NC, y no se
 * puede comparar línea a línea contra el cuadro del sistema (venta general,
 * veterinarias, adicionales). Acá cada documento del SII se ata a la ficha que lo
 * originó y hereda su clasificación.
 *
 * Hay DOS caminos de enganche, y la diferencia importa:
 *
 *  - **Por folio** (`sistema`): el documento lo emitimos nosotros, así que está en
 *    `documentos_tributarios` y sabemos exactamente a qué ficha corresponde
 *    (`receptor_id` en boletas, `fichas_json` en facturas de convenio). Es un
 *    enganche EXACTO, sin ambigüedad.
 *
 *  - **Por monto y fecha** (`pos`): la boleta la emitió el POS (TUU), así que no
 *    existe en `documentos_tributarios`. Se busca la ficha pagada con POS cuyo
 *    total y fecha calcen. Es una INFERENCIA: se exige coincidencia exacta de
 *    monto y se asigna uno a uno (una boleta no puede cubrir dos fichas ni al
 *    revés). Si hay más de una candidata igual de buena, se deja SIN atribuir a
 *    propósito — un match inventado ensucia la conciliación más que un hueco.
 */

/** Ventana de días entre la fecha de la boleta del POS y la de pago/retiro de la ficha. */
const DIAS_TOLERANCIA = 3

export interface DocAtribuido {
  tipo_doc: number
  folio: string
  fecha: string
  /** Neto del documento (neto afecto + exento), con signo: las NC van negativas. */
  neto: number
  clave: ClaveIngreso | 'sin_clasificar'
  via: 'sistema' | 'pos' | 'ninguna'
  ficha_id?: string
  codigo?: string
  mascota?: string
  vet?: string
}

export interface ResumenAtribuido {
  /** Neto por clave de ingreso, ya comparable con el cuadro del sistema. */
  porClave: Record<string, number>
  /** Documentos que no se pudieron atribuir a ninguna ficha. */
  sinClasificar: { docs: number; neto: number }
  /** Cuántos enganchamos por cada vía (para saber cuánto confiar). */
  cobertura: { sistema: number; pos: number; ninguna: number; total: number }
  docs: DocAtribuido[]
}

const dias = (a: string, b: string): number => {
  const t1 = Date.parse(`${a}T12:00:00Z`), t2 = Date.parse(`${b}T12:00:00Z`)
  if (!Number.isFinite(t1) || !Number.isFinite(t2)) return 9999
  return Math.abs(t1 - t2) / 86400000
}

/** Clasifica una ficha en sus claves de ingreso, con el peso de cada una. */
function clavesDeFicha(items: ItemIngreso[], fichaId: string): ItemIngreso[] {
  return items.filter(i => i.id === fichaId && i.clave !== 'eutanasias')
}

/**
 * Atribuye los documentos del SII de un período. `siiDocs` son los documentos ya
 * parseados (de la sincronización o del archivo).
 */
export async function atribuirDocumentosSii(periodo: string, siiDocs: DocVentaSii[]): Promise<ResumenAtribuido> {
  const [nuestros, clientes, vets] = await Promise.all([
    getSheetData('documentos_tributarios'),
    getSheetData('clientes'),
    getSheetData('veterinarios'),
  ])
  const items = await detalleIngresos(periodo)

  const vetById = new Map(vets.map(v => [String(v.id), v.nombre || v.razon_social || '']))
  const fichaById = new Map(clientes.map(c => [String(c.id), c]))
  // Nuestros documentos, indexados por tipo+folio para el enganche exacto.
  const nuestroPorFolio = new Map(nuestros.filter(d => d.folio).map(d => [`${d.tipo_dte}|${d.folio}`, d]))
  const nuestroPorId = new Map(nuestros.map(d => [String(d.id), d]))

  // Candidatas para el enganche por monto: fichas pagadas con POS del período,
  // que son las que el sistema NO documentó. Se consumen al asignarse.
  const candidatasPos = clientes
    .filter(c => c.estado !== 'borrador' && String(c.tipo_pago || '').toLowerCase() === 'pos')
    .map(c => ({
      id: String(c.id),
      total: Math.round(parseFloat(String(c.precio_total || '0')) || 0),
      fecha: formatDateForSheet(c.fecha_pago || c.fecha_retiro || c.fecha_creacion) || '',
      usada: false,
      row: c,
    }))
    .filter(c => c.total > 0 && c.fecha)

  const porClave: Record<string, number> = {}
  for (const k of Object.keys(LABEL_INGRESO)) porClave[k] = 0
  const cobertura = { sistema: 0, pos: 0, ninguna: 0, total: 0 }
  const out: DocAtribuido[] = []

  /** Reparte el neto de un documento entre las claves de su(s) ficha(s). */
  const repartir = (fichaIds: string[], neto: number, signo: number): { clave: ClaveIngreso | 'sin_clasificar'; vet?: string } => {
    const propios = fichaIds.flatMap(id => clavesDeFicha(items, id))
    const base = propios.reduce((s, i) => s + Math.abs(i.monto), 0)
    if (base <= 0) return { clave: 'sin_clasificar' }
    for (const i of propios) porClave[i.clave] += signo * neto * (Math.abs(i.monto) / base)
    // La clave "principal" del documento es la de mayor peso (para la etiqueta).
    const principal = propios.reduce((a, b) => (Math.abs(b.monto) > Math.abs(a.monto) ? b : a))
    return { clave: principal.clave, vet: principal.vet }
  }

  for (const d of siiDocs) {
    const neto = d.neto + d.exento
    const esNc = d.grupo === 'notas_credito'
    const signo = esNc ? -1 : 1
    cobertura.total++

    const mio = nuestroPorFolio.get(`${d.tipo_doc}|${d.folio}`)
    let fichaIds: string[] = []
    let via: DocAtribuido['via'] = 'ninguna'
    let codigo = '', mascota = ''

    if (mio) {
      via = 'sistema'
      if (esNc) {
        // La NC hereda la ficha del documento que anula.
        const anulado = nuestroPorId.get(String(mio.documento_anulado_id || ''))
        if (anulado) fichaIds = fichasDeDocumento(anulado)
      } else {
        fichaIds = fichasDeDocumento(mio)
      }
    } else if (d.grupo === 'boletas') {
      // Boleta del POS: enganche por monto exacto + fecha cercana, uno a uno.
      const bruto = d.total
      const cands = candidatasPos.filter(c => !c.usada && c.total === bruto && dias(c.fecha, d.fecha) <= DIAS_TOLERANCIA)
      if (cands.length === 1) {
        cands[0].usada = true
        fichaIds = [cands[0].id]
        via = 'pos'
      } else if (cands.length > 1) {
        // Empate: se queda con la más cercana en fecha SOLO si es estrictamente
        // la única a esa distancia; si no, se deja sin atribuir.
        const mejor = cands.slice().sort((a, b) => dias(a.fecha, d.fecha) - dias(b.fecha, d.fecha))
        if (dias(mejor[0].fecha, d.fecha) < dias(mejor[1].fecha, d.fecha)) {
          mejor[0].usada = true
          fichaIds = [mejor[0].id]
          via = 'pos'
        }
      }
    }

    if (fichaIds.length > 0) {
      const f = fichaById.get(fichaIds[0])
      codigo = String(f?.codigo || '')
      mascota = String(f?.nombre_mascota || '')
    }
    const { clave, vet } = fichaIds.length > 0 ? repartir(fichaIds, neto, signo) : { clave: 'sin_clasificar' as const, vet: undefined }
    if (clave === 'sin_clasificar') via = via === 'sistema' ? 'sistema' : 'ninguna'
    cobertura[clave === 'sin_clasificar' ? 'ninguna' : via === 'ninguna' ? 'ninguna' : via]++

    out.push({
      tipo_doc: d.tipo_doc, folio: d.folio, fecha: d.fecha, neto: signo * neto,
      clave, via, ficha_id: fichaIds[0], codigo, mascota,
      vet: vet || (fichaIds[0] ? vetById.get(String(fichaById.get(fichaIds[0])?.veterinaria_id || '')) : undefined),
    })
  }

  const sinCla = out.filter(d => d.clave === 'sin_clasificar')
  return {
    porClave,
    sinClasificar: { docs: sinCla.length, neto: sinCla.reduce((s, d) => s + d.neto, 0) },
    cobertura,
    docs: out,
  }
}

/** Fichas que cubre un documento nuestro: la boleta apunta a una, la factura de convenio a varias. */
function fichasDeDocumento(d: Record<string, string>): string[] {
  const desdeJson = (() => {
    try { return (JSON.parse(d.fichas_json || '[]') as Array<{ id: string }>).map(f => String(f.id)) } catch { return [] }
  })()
  if (desdeJson.length > 0) return desdeJson
  const rid = String(d.receptor_id || '').trim()
  return rid ? [rid] : []
}
