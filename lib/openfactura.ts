/**
 * Cliente de OpenFactura (Haulmer) para emitir boletas y facturas electrónicas
 * (DTE) ante el SII. https://docsapi-openfactura.haulmer.com/
 *
 * Emisión: POST {base}/v2/dte/document con header `apikey`. El ambiente lo define
 * la key: producción (api.haulmer.com) emite DTE REALES; el de pruebas
 * (dev-api.haulmer.com, keys demo) usa CAF simulado (no válido).
 *
 * ⚠️ Cada emisión en producción es un documento tributario REAL. Para probar,
 * pasar { dev: true } → usa OPENFACTURA_DEV_* (ambiente de pruebas).
 *
 * Envs:
 *   OPENFACTURA_API_KEY / OPENFACTURA_BASE_URL          (producción)
 *   OPENFACTURA_DEV_API_KEY / OPENFACTURA_DEV_BASE_URL  (pruebas)
 */

// ─── Tipos DTE (subset SII que usamos) ───────────────────────────────────────
export const DTE_BOLETA_AFECTA = 39
export const DTE_BOLETA_EXENTA = 41
export const DTE_FACTURA_AFECTA = 33
export const DTE_FACTURA_EXENTA = 34
export const DTE_NOTA_CREDITO = 61

export interface DteEmisor {
  RUTEmisor: string
  RznSocEmisor: string
  GiroEmisor: string
  DirOrigen: string
  CmnaOrigen: string
  Acteco?: number
  CdgSIISucur?: string
}
export interface DteReceptor {
  RUTRecep: string
  RznSocRecep?: string
  GiroRecep?: string
  DirRecep?: string
  CmnaRecep?: string
  CorreoRecep?: string
}
export interface DteDetalle {
  NroLinDet: number
  NmbItem: string
  QtyItem?: number
  PrcItem?: number
  MontoItem: number
  DscItem?: string
  IndExe?: number // 1 = ítem exento
}
export interface DteTotales {
  MntNeto?: number
  TasaIVA?: string | number
  IVA?: number
  MntExe?: number
  MntTotal: number
}
export interface DtePayload {
  /** Qué querés que devuelva la API: FOLIO, SELF_SERVICE, PDF, XML, TIMBRE… */
  response?: string[]
  dte: {
    Encabezado: {
      IdDoc: { TipoDTE: number; FchEmis: string; [k: string]: unknown }
      // DteEmisor (self-service, RznSocEmisor/GiroEmisor) o el emisor DIRECTO
      // (RznSoc/GiroEmis, ver emisorDirecto) para factura/NC.
      Emisor: DteEmisor | Record<string, unknown>
      Receptor?: DteReceptor
      Totales: DteTotales
      [k: string]: unknown
    }
    Detalle: DteDetalle[]
    [k: string]: unknown
  }
  /** Datos para el correo self-service al cliente. */
  customer?: { fullName?: string; email?: string }
  /** Config del modo self-service: OpenFactura completa el esquema SII y hostea la página pública. */
  selfService?: {
    issueBoleta: boolean
    allowFactura: boolean
    documentReference: Array<{ type: string; ID: string; date: string }>
  }
  [k: string]: unknown
}

// ─── Builder ficha → payload ─────────────────────────────────────────────────
// DOS modos según el documento (probado en sandbox):
//
// • BOLETA (39/41) → SELF-SERVICE con `issueBoleta:true`: OpenFactura EMITE la
//   boleta al instante (devuelve FOLIO + PDF). El Detalle va en BRUTO (IVA incl.);
//   OpenFactura deriva el neto. `documentReference.ID` numérico (id de la ficha).
//
// • FACTURA (33/34) y NC (61) → EMISIÓN DIRECTA (SIN `selfService`). ⚠️ El modo
//   self-service para facturas NO emitía: solo mandaba al receptor un link para
//   ELEGIR/generar el documento (pantalla "Obtén tu documento tributario") → el DTE
//   nunca llegaba al SII (bug real, factura de Cooldogs 2026-07-17). La emisión
//   directa exige:
//     - Emisor con nombres SII ESTRICTOS: RznSoc / GiroEmis (no RznSocEmisor/
//       GiroEmisor) → ver `emisorDirecto()`.
//     - Detalle en NETO (PrcItem/MontoItem netos); el IVA lo suma la factura.
//       MntNeto = Σ Detalle; IVA = bruto − MntNeto; MntTotal = bruto (así el total
//       cuadra con lo cotizado y el SII lo acepta).
//     - IdDoc.FmaPago = 1 (contado).
//     - NC: la referencia al documento anulado va en `dte.Referencia`
//       ([{TpoDocRef, FolioRef, FchRef, CodRef:1 (anula), RazonRef}]).
//   Devuelve FOLIO + PDF (base64 en raw.PDF) + XML de forma SÍNCRONA.

export interface LineaItem {
  /** Nombre del ítem (NmbItem, máx 80). */
  nombre: string
  /** Cantidad (QtyItem, default 1). */
  cantidad?: number
  /** Precio unitario BRUTO (IVA incluido) → PrcItem. MontoItem = bruto × cantidad. */
  montoBruto: number
  descripcion?: string
}

export interface ConstruirDteOpts {
  tipo: number            // 39 boleta afecta · 33 factura afecta
  fecha: string           // YYYY-MM-DD
  emisor: DteEmisor
  receptor?: DteReceptor  // requerido para factura 33
  lineas: LineaItem[]     // montos BRUTOS (IVA incluido)
  cliente?: { nombre?: string; email?: string }
  /** ID numérico de referencia (usar el id de la ficha). */
  referenciaId: string | number
  permitirFactura?: boolean
}

/** Emisor para BOLETA directa: nombres originales, SIN Acteco (el esquema de boleta no lo acepta). */
function emisorBoleta(e: DteEmisor) {
  return {
    RUTEmisor: e.RUTEmisor,
    RznSocEmisor: e.RznSocEmisor,
    GiroEmisor: e.GiroEmisor,
    ...(e.CdgSIISucur ? { CdgSIISucur: e.CdgSIISucur } : {}),
    DirOrigen: e.DirOrigen,
    CmnaOrigen: e.CmnaOrigen,
  }
}

/** Emisor con los nombres ESTRICTOS del esquema SII (para emisión DIRECTA de factura/NC). */
function emisorDirecto(e: DteEmisor) {
  return {
    RUTEmisor: e.RUTEmisor,
    RznSoc: e.RznSocEmisor,
    GiroEmis: e.GiroEmisor,
    ...(e.Acteco ? { Acteco: e.Acteco } : {}),
    DirOrigen: e.DirOrigen,
    CmnaOrigen: e.CmnaOrigen,
    ...(e.CdgSIISucur ? { CdgSIISucur: e.CdgSIISucur } : {}),
  }
}

/** Detalle en NETO (para factura/NC): PrcItem/MontoItem netos = round(bruto/1,19). */
function detalleNeto(lineas: LineaItem[]): DteDetalle[] {
  return lineas.map((l, i) => {
    const qty = l.cantidad ?? 1
    const netoUnit = Math.round(l.montoBruto / 1.19)
    return {
      NroLinDet: i + 1,
      NmbItem: (l.nombre || 'Ítem').slice(0, 80),
      QtyItem: qty,
      PrcItem: netoUnit,
      MontoItem: netoUnit * qty,
      ...(l.descripcion ? { DscItem: l.descripcion.slice(0, 990) } : {}),
    }
  })
}

/** Arma el payload de emisión desde datos de negocio (precios con IVA incluido). */
export function construirDtePayload(o: ConstruirDteOpts): DtePayload {
  const esBoleta = o.tipo === DTE_BOLETA_AFECTA || o.tipo === DTE_BOLETA_EXENTA

  // ── BOLETA (39/41): EMISIÓN DIRECTA. ⚠️ Antes se usaba SELF-SERVICE, que emitía
  //    DOS documentos por boleta (el real + un artefacto self-service, folio N-1) →
  //    duplicados en el SII (RCV julio 2026: 18 boletas de más). La directa emite UN
  //    solo documento (probado: no devuelve SELF_SERVICE.url). Detalle en BRUTO,
  //    IndServicio:3 (venta y servicios), emisor con nombres originales (sin Acteco),
  //    receptor consumidor final (66666666-6).
  if (esBoleta) {
    const detalle: DteDetalle[] = o.lineas.map((l, i) => {
      const qty = l.cantidad ?? 1
      return {
        NroLinDet: i + 1,
        NmbItem: (l.nombre || 'Ítem').slice(0, 80),
        QtyItem: qty,
        PrcItem: Math.round(l.montoBruto),
        MontoItem: Math.round(l.montoBruto * qty),
        ...(l.descripcion ? { DscItem: l.descripcion.slice(0, 990) } : {}),
      }
    })
    const bruto = detalle.reduce((s, d) => s + d.MontoItem, 0)
    const { neto, iva } = desglosarIvaIncluido(bruto)
    return {
      response: ['FOLIO', 'PDF'],
      dte: {
        Encabezado: {
          IdDoc: { TipoDTE: o.tipo, IndServicio: 3, FchEmis: o.fecha },
          Emisor: emisorBoleta(o.emisor),
          Receptor: { RUTRecep: o.receptor?.RUTRecep || '66666666-6' },
          Totales: { MntNeto: neto, IVA: iva, MntTotal: bruto },
        },
        Detalle: detalle,
      },
    }
  }

  // ── FACTURA: EMISIÓN DIRECTA (sin selfService). Detalle en NETO, emisor SII estricto.
  const detalle = detalleNeto(o.lineas)
  const bruto = o.lineas.reduce((s, l) => s + Math.round(l.montoBruto) * (l.cantidad ?? 1), 0)
  const mntNeto = detalle.reduce((s, d) => s + d.MontoItem, 0)
  const iva = bruto - mntNeto
  return {
    response: ['FOLIO', 'XML', 'PDF'],
    dte: {
      Encabezado: {
        IdDoc: { TipoDTE: o.tipo, FchEmis: o.fecha, FmaPago: 1 },
        Emisor: emisorDirecto(o.emisor),
        ...(o.receptor ? { Receptor: o.receptor } : {}),
        Totales: { MntNeto: mntNeto, TasaIVA: 19, IVA: iva, MntTotal: bruto },
      },
      Detalle: detalle,
    },
  }
}

export interface ConstruirNcOpts {
  fecha: string
  emisor: DteEmisor
  receptor?: DteReceptor
  lineas: LineaItem[]
  /** TipoDTE del documento que se está anulando (ej. 39 o 33). */
  tipoDocumentoOriginal: number
  /** Folio del documento que se está anulando. */
  folioOriginal: number | string
  fechaOriginal: string
}

/** Arma el payload de una Nota de Crédito (61) que ANULA un documento existente. Emisión DIRECTA. */
export function construirNcPayload(o: ConstruirNcOpts): DtePayload {
  const detalle = detalleNeto(o.lineas)
  const bruto = o.lineas.reduce((s, l) => s + Math.round(l.montoBruto) * (l.cantidad ?? 1), 0)
  const mntNeto = detalle.reduce((s, d) => s + d.MontoItem, 0)
  const iva = bruto - mntNeto
  return {
    response: ['FOLIO', 'XML', 'PDF'],
    dte: {
      Encabezado: {
        IdDoc: { TipoDTE: DTE_NOTA_CREDITO, FchEmis: o.fecha },
        Emisor: emisorDirecto(o.emisor),
        ...(o.receptor ? { Receptor: o.receptor } : {}),
        Totales: { MntNeto: mntNeto, TasaIVA: 19, IVA: iva, MntTotal: bruto },
      },
      Detalle: detalle,
      // Referencia al documento que se anula (CodRef 1 = anula). En emisión directa
      // va en dte.Referencia (en self-service iba en selfService.documentReference).
      Referencia: [{
        NroLinRef: 1,
        TpoDocRef: String(o.tipoDocumentoOriginal),
        FolioRef: String(o.folioOriginal),
        FchRef: o.fechaOriginal,
        CodRef: 1,
        RazonRef: 'Anula documento',
      }],
    },
  }
}

export interface EmitirResultado {
  ok: boolean
  folio?: number
  tipo?: number
  selfServiceUrl?: string
  /** PDF decodificado, listo para subir a R2. */
  pdfBuffer?: Buffer
  /** Warnings no bloqueantes (ej. en el ambiente demo, "Razón Social no corresponde"). */
  warnings?: string[]
  raw?: unknown
  error?: string
  errorDetalle?: unknown
}

interface Ambiente { apiKey: string; baseUrl: string }

function ambiente(dev: boolean): Ambiente {
  if (dev) {
    return {
      // Sin fallback hardcodeado: esa key de ambiente de pruebas quedaba expuesta
      // en el código fuente (mismo valor para cualquiera que lo lea en GitHub).
      apiKey: process.env.OPENFACTURA_DEV_API_KEY || '',
      baseUrl: (process.env.OPENFACTURA_DEV_BASE_URL || 'https://dev-api.haulmer.com').replace(/\/+$/, ''),
    }
  }
  return {
    apiKey: process.env.OPENFACTURA_API_KEY || '',
    baseUrl: (process.env.OPENFACTURA_BASE_URL || 'https://api.haulmer.com').replace(/\/+$/, ''),
  }
}

export function isOpenFacturaConfigurado(): boolean {
  return !!process.env.OPENFACTURA_API_KEY
}

/** IVA-incluido: dado un total BRUTO (con IVA), devuelve {neto, iva, total}. */
export function desglosarIvaIncluido(totalBruto: number): { neto: number; iva: number; total: number } {
  const total = Math.round(totalBruto)
  const neto = Math.round(total / 1.19)
  const iva = total - neto
  return { neto, iva, total }
}

/**
 * Emite un DTE. `dev:true` usa el ambiente de PRUEBAS (no emite documentos reales).
 * `idempotencyKey` evita emitir dos veces la misma venta ante reintentos.
 */
export async function emitirDTE(
  payload: DtePayload,
  opts: { dev?: boolean; idempotencyKey?: string } = {},
): Promise<EmitirResultado> {
  const { apiKey, baseUrl } = ambiente(!!opts.dev)
  if (!apiKey) return { ok: false, error: opts.dev ? 'OPENFACTURA_DEV_API_KEY no configurada' : 'OPENFACTURA_API_KEY no configurada' }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    apikey: apiKey,
  }
  if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey

  // Reintentos SOLO para fallas de red/timeout (fetch que ni siquiera responde) —
  // nunca para errores de negocio (4xx: eso ya llegó con `res`, no lanza acá). El
  // Idempotency-Key hace estos reintentos seguros (Haulmer no duplica el DTE).
  const BACKOFF_MS = [1000, 3000]
  let res: Response | undefined
  let redError: unknown
  for (let intento = 0; intento <= BACKOFF_MS.length; intento++) {
    try {
      res = await fetch(`${baseUrl}/v2/dte/document`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      })
      redError = undefined
      break
    } catch (e) {
      redError = e
      if (intento < BACKOFF_MS.length) {
        console.warn(`[openfactura] fallo de red emitiendo DTE (intento ${intento + 1}/${BACKOFF_MS.length + 1}), reintentando en ${BACKOFF_MS[intento]}ms:`, e instanceof Error ? e.message : e)
        await new Promise(r => setTimeout(r, BACKOFF_MS[intento]))
      }
    }
  }
  if (!res) {
    return { ok: false, error: `Red: ${redError instanceof Error ? redError.message : String(redError)}` }
  }

  const raw = await res.json().catch(() => ({})) as Record<string, unknown>
  if (!res.ok) {
    const err = (raw as { error?: { message?: string; code?: string; details?: unknown } }).error
    return {
      ok: false,
      error: err?.message || `HTTP ${res.status}`,
      errorDetalle: err?.details ?? raw,
      raw,
    }
  }

  const ss = (raw as { SELF_SERVICE?: { url?: string } }).SELF_SERVICE
  const folioRaw = (raw as { FOLIO?: unknown }).FOLIO
  const folio = typeof folioRaw === 'number' ? folioRaw : parseInt(String(folioRaw ?? ''), 10) || undefined
  const pdfB64 = (raw as { PDF?: string }).PDF
  const warningsRaw = (raw as { WARNING?: Array<Record<string, string>> }).WARNING
  const warnings = Array.isArray(warningsRaw)
    ? warningsRaw.map(w => Object.entries(w).map(([k, v]) => `${k}: ${v}`).join(' · '))
    : undefined
  return {
    ok: true,
    folio,
    selfServiceUrl: ss?.url,
    pdfBuffer: pdfB64 ? Buffer.from(pdfB64, 'base64') : undefined,
    warnings,
    raw,
  }
}
