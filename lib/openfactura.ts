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
  TasaIVA?: string
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
      Emisor: DteEmisor
      Receptor?: DteReceptor
      Totales: DteTotales
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

// ─── Builder ficha → payload (estructura PROBADA en sandbox 2026-07-07) ───────
// Aprendizajes clave del sandbox (3 emisiones reales probadas: boleta 39, factura
// 33 con Receptor, NC 61 anulando la boleta — las tres con folio + selfServiceUrl):
//  - Se usa el modo SELF-SERVICE (OpenFactura completa IndServicio/timbre/esquema
//    SII y hostea una página pública). El modo "directo" (sin selfService) exige
//    el esquema SII estricto con orden de campos propio — no lo usamos.
//  - El Detalle va con montos BRUTOS (IVA incluido) — OpenFactura deriva el neto
//    (MntNeto = bruto/1,19); mandar el neto tira "Monto erróneo".
//  - documentReference.ID debe ser NUMÉRICO (usar el id de la ficha).
//  - Para una NC que ANULA un documento: la referencia va en
//    `selfService.documentReference` con `type` = TipoDTE del documento ORIGINAL
//    (ej. "39" si anula una boleta) — NO usar `dte.Referencia` (eso da error
//    "Incluir referencias solo en objeto 'selfService'"). `type: "801"` es para
//    referencias normales (ej. orden de compra), no para anulaciones.
//  - `response: ['FOLIO','SELF_SERVICE','PDF']` trae los tres a la vez: el PDF
//    llega en `raw.PDF` como base64 (decodificar con Buffer.from(x,'base64')).

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

/** Arma el payload de emisión desde datos de negocio (precios con IVA incluido). */
export function construirDtePayload(o: ConstruirDteOpts): DtePayload {
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
  const { neto, iva, total } = desglosarIvaIncluido(bruto)
  const esBoleta = o.tipo === DTE_BOLETA_AFECTA || o.tipo === DTE_BOLETA_EXENTA
  return {
    response: ['FOLIO', 'SELF_SERVICE', 'PDF'],
    dte: {
      Encabezado: {
        IdDoc: { TipoDTE: o.tipo, FchEmis: o.fecha },
        Emisor: o.emisor,
        ...(o.receptor ? { Receptor: o.receptor } : {}),
        Totales: { MntNeto: neto, TasaIVA: '19.00', IVA: iva, MntTotal: total },
      },
      Detalle: detalle,
    },
    ...(o.cliente ? { customer: { fullName: o.cliente.nombre, email: o.cliente.email } } : {}),
    selfService: {
      issueBoleta: esBoleta,
      allowFactura: !!o.permitirFactura,
      documentReference: [{ type: '801', ID: String(o.referenciaId), date: o.fecha }],
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

/** Arma el payload de una Nota de Crédito (61) que ANULA un documento existente. */
export function construirNcPayload(o: ConstruirNcOpts): DtePayload {
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
  const { neto, iva, total } = desglosarIvaIncluido(bruto)
  return {
    response: ['FOLIO', 'SELF_SERVICE', 'PDF'],
    dte: {
      Encabezado: {
        IdDoc: { TipoDTE: DTE_NOTA_CREDITO, FchEmis: o.fecha },
        Emisor: o.emisor,
        ...(o.receptor ? { Receptor: o.receptor } : {}),
        Totales: { MntNeto: neto, TasaIVA: '19.00', IVA: iva, MntTotal: total },
      },
      Detalle: detalle,
    },
    selfService: {
      issueBoleta: false,
      allowFactura: false,
      documentReference: [{ type: String(o.tipoDocumentoOriginal), ID: String(o.folioOriginal), date: o.fechaOriginal }],
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
      apiKey: process.env.OPENFACTURA_DEV_API_KEY || '928e15a2d14d4a6292345f04960f4bd3',
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
  if (!apiKey) return { ok: false, error: 'OPENFACTURA_API_KEY no configurada' }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    apikey: apiKey,
  }
  if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey

  let res: Response
  try {
    res = await fetch(`${baseUrl}/v2/dte/document`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    })
  } catch (e) {
    return { ok: false, error: `Red: ${e instanceof Error ? e.message : String(e)}` }
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
