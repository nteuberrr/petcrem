import { getSheetData, appendRow, updateByIdIf, getNextId } from './datastore'
import { todayISO } from './dates'
import { uploadToR2 } from './cloudflare-r2'
import { enviarBoletaCliente } from './cliente-mailer'
import { avisarAdminsWhatsapp } from './whatsapp'
import { sendEmail } from './resend-mailer'
import { renderEmailLayout, getContacto, escapeHtml } from './email-layout'
import { fmtPrecio } from './format'
import {
  emitirDTE, construirDtePayload, construirNcPayload, desglosarIvaIncluido, isOpenFacturaConfigurado,
  DTE_NOTA_CREDITO, DTE_BOLETA_AFECTA, type DteEmisor, type DteReceptor, type LineaItem,
} from './openfactura'

/**
 * Capa de negocio de Facturación manual (OpenFactura/Haulmer). Persiste cada
 * documento emitido en `documentos_tributarios` + guarda una copia PROPIA del
 * PDF en R2 (no depende de que el link self-service de Haulmer siga vivo).
 *
 * ⚠️ Todas las escrituras a `clientes`/`documentos_tributarios` acá usan
 * `updateByIdIf` (PARCIAL) — nunca `updateById` (ese reescribe la fila COMPLETA
 * y blanquea cualquier columna no pasada explícitamente; ver rowForWrite en
 * lib/datastore.ts). Usar `updateById` acá borraría datos de la ficha/documento.
 */

const SHEET = 'documentos_tributarios'

export type EmisorInfo = DteEmisor

let emisorCache: { ts: number; data: EmisorInfo } | null = null

/** Emisor (Alma Animal) desde empresa_config. Acteco es config técnica rara vez editada → env. */
export async function getEmisor(): Promise<EmisorInfo> {
  if (emisorCache && Date.now() - emisorCache.ts < 60_000) return emisorCache.data
  const rows = await getSheetData('empresa_config')
  const row = rows.find(r => r.id === '1') || rows[0] || {}
  const data: EmisorInfo = {
    RUTEmisor: row.rut || '',
    RznSocEmisor: row.nombre || '',
    GiroEmisor: row.giro || '',
    DirOrigen: row.direccion || '',
    CmnaOrigen: row.comuna || '',
    Acteco: parseInt(process.env.OPENFACTURA_ACTECO || '382100', 10),
  }
  emisorCache = { ts: Date.now(), data }
  return data
}

export interface DocumentoRow {
  id: string
  tipo_dte: string
  folio: string
  estado: 'emitido' | 'anulado' | string
  ambiente: string
  fecha_emision: string
  receptor_tipo: 'tutor' | 'veterinaria' | 'manual' | string
  receptor_id: string
  receptor_rut: string
  receptor_razon_social: string
  receptor_giro: string
  receptor_direccion: string
  receptor_comuna: string
  receptor_correo: string
  monto_neto: string
  monto_iva: string
  monto_total: string
  detalle_json: string
  resumen: string
  mes_facturado: string
  fichas_json: string
  openfactura_url: string
  pdf_key: string
  pdf_url: string
  documento_anulado_id: string
  nc_id: string
  motivo_anulacion: string
  warnings_json: string
  creado_por_id: string
  creado_por_nombre: string
  fecha_creacion: string
  [k: string]: string
}

export interface EmitirDocOpts {
  tipo: number // 39 boleta · 33 factura
  fecha?: string
  receptorTipo: 'tutor' | 'veterinaria' | 'manual'
  receptorId?: string
  receptor?: DteReceptor
  lineas: LineaItem[]
  resumen: string
  mesFacturado?: string
  fichasJson?: Array<{ id: string; codigo: string }>
  cliente?: { nombre?: string; email?: string }
  permitirFactura?: boolean
  /** true = ambiente de PRUEBAS (sandbox, no emite documentos reales). */
  dev?: boolean
  creadoPorId?: string
  creadoPorNombre?: string
}

export interface EmitirDocResultado {
  ok: boolean
  documento?: DocumentoRow
  error?: string
  warnings?: string[]
}

function montoBrutoDeLineas(lineas: LineaItem[]): number {
  return lineas.reduce((s, l) => s + Math.round(l.montoBruto * (l.cantidad ?? 1)), 0)
}

/** Emite una boleta (39) o factura (33), la persiste y guarda copia del PDF en R2. */
export async function emitirDocumento(o: EmitirDocOpts): Promise<EmitirDocResultado> {
  const emisor = await getEmisor()
  const fecha = o.fecha || todayISO()
  // El id se reserva ANTES de emitir: sirve como ID numérico de documentReference
  // (OpenFactura exige un ID numérico) y como Idempotency-Key estable.
  const id = await getNextId(SHEET)
  const payload = construirDtePayload({
    tipo: o.tipo,
    fecha,
    emisor,
    receptor: o.receptor,
    lineas: o.lineas,
    cliente: o.cliente,
    referenciaId: id,
    permitirFactura: o.permitirFactura,
  })
  const r = await emitirDTE(payload, { dev: o.dev, idempotencyKey: `DOC_${id}` })
  if (!r.ok) return { ok: false, error: r.error }

  let pdf_key = '', pdf_url = ''
  if (r.pdfBuffer) {
    try {
      const up = await uploadToR2(r.pdfBuffer, `facturacion/${o.tipo}-${r.folio ?? id}-${id}.pdf`, 'application/pdf')
      pdf_key = up.key; pdf_url = up.url
    } catch (e) {
      console.error('[facturacion] error subiendo PDF a R2:', e)
    }
  }

  const { neto, iva, total } = desglosarIvaIncluido(montoBrutoDeLineas(o.lineas))

  const row: DocumentoRow = {
    id,
    tipo_dte: String(o.tipo),
    folio: String(r.folio ?? ''),
    estado: 'emitido',
    ambiente: o.dev ? 'pruebas' : 'produccion',
    fecha_emision: fecha,
    receptor_tipo: o.receptorTipo,
    receptor_id: o.receptorId || '',
    receptor_rut: o.receptor?.RUTRecep || '',
    receptor_razon_social: o.receptor?.RznSocRecep || o.cliente?.nombre || '',
    receptor_giro: o.receptor?.GiroRecep || '',
    receptor_direccion: o.receptor?.DirRecep || '',
    receptor_comuna: o.receptor?.CmnaRecep || '',
    receptor_correo: o.receptor?.CorreoRecep || o.cliente?.email || '',
    monto_neto: String(neto),
    monto_iva: String(iva),
    monto_total: String(total),
    detalle_json: JSON.stringify(o.lineas),
    resumen: o.resumen,
    mes_facturado: o.mesFacturado || '',
    fichas_json: JSON.stringify(o.fichasJson || []),
    openfactura_url: r.selfServiceUrl || '',
    pdf_key,
    pdf_url,
    documento_anulado_id: '',
    nc_id: '',
    motivo_anulacion: '',
    warnings_json: JSON.stringify(r.warnings || []),
    creado_por_id: o.creadoPorId || '',
    creado_por_nombre: o.creadoPorNombre || '',
    fecha_creacion: todayISO(),
  }
  await appendRow(SHEET, row)

  // Marcar las fichas facturadas al vet (partial update — nunca updateById acá).
  if (o.fichasJson && o.fichasJson.length > 0) {
    for (const f of o.fichasJson) {
      await updateByIdIf('clientes', f.id, {}, { factura_vet_id: id })
    }
  }

  return { ok: true, documento: row, warnings: r.warnings }
}

/**
 * Emite la BOLETA (39) al TUTOR por una ficha de cremación cuando se confirma su
 * pago. Consumidor final (RUT 66666666-6). Una sola línea con el total de la ficha
 * (precio_total ya trae servicio − descuento + adicionales). Best-effort: la llama
 * el trigger del PATCH de clientes; si algo falla devuelve {ok:false} sin romper.
 *
 * NO se usa para fichas de veterinaria (esas se facturan al vet, mensual y manual).
 */
export async function emitirBoletaFicha(
  c: Record<string, string>,
  meta: { creadoPorId?: string; creadoPorNombre?: string } = {},
): Promise<EmitirDocResultado> {
  if (!isOpenFacturaConfigurado()) return { ok: false, error: 'OpenFactura no configurado' }
  const total = parseInt(String(c.precio_total || '0'), 10) || 0
  if (total <= 0) return { ok: false, error: 'La ficha no tiene monto para facturar.' }
  const mascota = (c.nombre_mascota || 'mascota').trim()
  const tutor = (c.nombre_tutor || mascota).trim()
  const servicio = (c.tipo_servicio || 'Cremación').trim()
  const lineas: LineaItem[] = [{
    nombre: `Cremación de ${mascota}`.slice(0, 80),
    cantidad: 1,
    montoBruto: total,
    descripcion: servicio,
  }]
  const r = await emitirDocumento({
    tipo: DTE_BOLETA_AFECTA,
    receptorTipo: 'tutor',
    receptorId: String(c.id || ''),
    // Boleta a consumidor final: RUT genérico 66666666-6 (mismo criterio que la emisión manual).
    receptor: { RUTRecep: '66666666-6', RznSocRecep: tutor, CorreoRecep: (c.email || '').trim() || undefined },
    lineas,
    resumen: `Cremación ${(c.codigo || '').trim()} · ${mascota}`.trim(),
    cliente: { nombre: tutor, email: (c.email || '').trim() || undefined },
    creadoPorId: meta.creadoPorId,
    creadoPorNombre: meta.creadoPorNombre,
  })

  // Envío al tutor (al correo ingresado en la ficha) — best-effort, nunca rompe
  // la emisión ya confirmada ante el SII.
  const email = (c.email || '').trim()
  if (r.ok && r.documento && email) {
    try {
      await enviarBoletaCliente({
        email, nombreMascota: mascota, nombreTutor: tutor, clienteId: String(c.id || ''),
        folio: r.documento.folio, montoTotal: parseInt(r.documento.monto_total, 10) || total,
        pdfUrl: r.documento.pdf_url,
      })
    } catch (e) {
      console.error('[facturacion] error enviando boleta al tutor:', e)
    }
  }

  return r
}

/**
 * Emite la boleta automática de una ficha SI corresponde: solo fichas de TUTOR
 * (sin veterinaria), REGISTRADAS, PAGADAS y SIN boleta previa. Idempotente por
 * `boleta_id`. Best-effort: ante fallo avisa al admin por WhatsApp y no lanza.
 * Persiste `boleta_id` en la ficha y lo devuelve si la emitió.
 *
 * La usan el PATCH de la ficha (al pasar a 'pagado') y la confirmación del saldo
 * de un pago parcial (al cerrar el cobro 'saldo' → la ficha queda pagada).
 */
export async function emitirBoletaSiCorresponde(
  ficha: Record<string, string>,
  meta: { creadoPorNombre?: string } = {},
): Promise<{ emitida: boolean; boleta_id?: string }> {
  const esTutor = !String(ficha.veterinaria_id || '').trim()
  const fichaRegistrada = String(ficha.estado || '') !== 'borrador' && !!String(ficha.codigo || '').trim()
  const yaTieneBoleta = !!String(ficha.boleta_id || '').trim()
  const estaPagada = String(ficha.estado_pago || '').toLowerCase() === 'pagado'
  if (!esTutor || !fichaRegistrada || yaTieneBoleta || !estaPagada) return { emitida: false }
  const nombre = String(ficha.nombre_mascota || ficha.codigo || ficha.id || '')
  const avisar = (extra: string) => avisarAdminsWhatsapp(
    `⚠️ *Boleta SII no emitida*\n\nFicha ${String(ficha.codigo || '#' + ficha.id)} (${nombre}) quedó *pagada* pero ${extra}\n\nReintenta manualmente desde Facturación → "Pagadas sin boleta".`
  ).catch(e => console.warn('[facturacion] no se pudo avisar al admin por WhatsApp:', e))
  try {
    const r = await emitirBoletaFicha(ficha, { creadoPorNombre: meta.creadoPorNombre || 'Automático (pago confirmado)' })
    if (r.ok && r.documento?.id) {
      await updateByIdIf('clientes', String(ficha.id), {}, { boleta_id: String(r.documento.id) })
      return { emitida: true, boleta_id: String(r.documento.id) }
    }
    if (!r.ok) avisar(`la boleta automática falló:\n${r.error || 'error desconocido'}`)
    return { emitida: false }
  } catch (e) {
    console.warn('[facturacion] error emitiendo boleta automática (no bloqueante):', e)
    avisar('la emisión de la boleta automática falló con un error inesperado.')
    return { emitida: false }
  }
}

/** Correo del dueño para la COPIA de revisión de facturas: email_seguimiento (1º de la lista) o ADMIN_EMAIL. */
async function getOwnerEmail(): Promise<string> {
  try {
    const rows = await getSheetData('empresa_config')
    const row = rows.find(r => r.id === '1') || rows[0] || {}
    const raw = String(row.email_seguimiento || '').split(/[,;]/)[0]?.trim()
    if (raw) return raw
  } catch { /* cae al env */ }
  return (process.env.ADMIN_EMAIL || '').trim()
}

/**
 * Envía al DUEÑO una copia de una factura recién emitida, para revisar el
 * formato / lo que se le cobra a la veterinaria. Best-effort (nunca rompe la
 * emisión ya confirmada). El PDF real del DTE de factura no siempre llega
 * sincrónico desde Haulmer (queda en validación SII) → se enlaza el documento.
 */
export async function enviarCopiaFacturaOwner(
  doc: DocumentoRow,
  extra: { vetNombre: string; mesLabel?: string; fichas: Array<{ codigo: string; nombre_mascota: string; monto: number }>; preview?: boolean },
): Promise<void> {
  try {
    const to = await getOwnerEmail()
    if (!to) return
    const contacto = await getContacto()
    const encabezado = extra.preview
      ? `<strong style="color:#B45309">VISTA PREVIA</strong> — así se verá la copia de la factura a <strong>${escapeHtml(extra.vetNombre)}</strong>${extra.mesLabel ? ` (${escapeHtml(extra.mesLabel)})` : ''}. No se ha emitido ningún documento al SII.`
      : `Copia interna de la factura emitida a <strong>${escapeHtml(extra.vetNombre)}</strong>${extra.mesLabel ? ` (${escapeHtml(extra.mesLabel)})` : ''}, para revisar el formato.`
    const filas = extra.fichas.map(f => `
      <tr>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;font-size:13px;color:#555">${escapeHtml(f.codigo)} — ${escapeHtml(f.nombre_mascota || 'mascota')}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;font-size:13px;color:#222;text-align:right;white-space:nowrap">${fmtPrecio(f.monto)}</td>
      </tr>`).join('')
    const linkDoc = doc.pdf_url || doc.openfactura_url
    const bodyHtml = `
      <p style="margin:0 0 14px;font-size:15px;color:#222">${encabezado}</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 12px">
        <tr><td style="font-size:13px;color:#666">Folio</td><td style="font-size:13px;color:#222;text-align:right">${doc.folio ? escapeHtml(doc.folio) : '— (en validación SII)'}</td></tr>
        <tr><td style="font-size:13px;color:#666">RUT receptor</td><td style="font-size:13px;color:#222;text-align:right">${escapeHtml(doc.receptor_rut)}</td></tr>
        <tr><td style="font-size:13px;color:#666">Fecha</td><td style="font-size:13px;color:#222;text-align:right">${escapeHtml(doc.fecha_emision)}</td></tr>
      </table>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #eee;border-radius:8px;overflow:hidden;margin:0 0 12px">
        ${filas}
        <tr><td style="padding:8px 10px;font-size:13px;color:#666">Neto</td><td style="padding:8px 10px;font-size:13px;color:#222;text-align:right">${fmtPrecio(parseInt(doc.monto_neto, 10) || 0)}</td></tr>
        <tr><td style="padding:2px 10px;font-size:13px;color:#666">IVA (19%)</td><td style="padding:2px 10px;font-size:13px;color:#222;text-align:right">${fmtPrecio(parseInt(doc.monto_iva, 10) || 0)}</td></tr>
        <tr><td style="padding:8px 10px;font-size:15px;color:#111;font-weight:700">Total</td><td style="padding:8px 10px;font-size:15px;color:#111;font-weight:700;text-align:right">${fmtPrecio(parseInt(doc.monto_total, 10) || 0)}</td></tr>
      </table>
      ${linkDoc ? `<p style="margin:0"><a href="${escapeHtml(linkDoc)}" style="display:inline-block;background:#143C64;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-size:14px;font-weight:600">Ver documento</a></p>` : ''}
    `
    const html = renderEmailLayout({ titulo: 'Copia de factura', bodyHtml, contacto, contexto: 'Facturación · Revisión' })
    await sendEmail({
      to,
      subject: (extra.preview ? `Vista previa factura — ${extra.vetNombre}` : `Copia factura ${doc.folio || ''} — ${extra.vetNombre}`).trim(),
      html,
      preview_text: extra.preview ? 'Vista previa del formato de factura (no emitida).' : 'Copia interna para revisar el formato de la factura.',
      noBcc: true,
    })
  } catch (e) {
    console.warn('[facturacion] no se pudo enviar la copia de factura al dueño:', e)
  }
}

export interface AnularOpts {
  documentoId: string
  motivo?: string
  dev?: boolean
  creadoPorId?: string
  creadoPorNombre?: string
}

/** Anula un documento emitido: genera una NC (61) que lo referencia y lo marca 'anulado'. */
export async function anularDocumento(o: AnularOpts): Promise<EmitirDocResultado> {
  const rows = await getSheetData(SHEET)
  const doc = rows.find(r => r.id === o.documentoId)
  if (!doc) return { ok: false, error: 'Documento no encontrado' }
  if (doc.estado === 'anulado') return { ok: false, error: 'Este documento ya fue anulado.' }
  if (doc.tipo_dte === String(DTE_NOTA_CREDITO)) return { ok: false, error: 'Una Nota de Crédito no se puede anular.' }
  if (!doc.folio) return { ok: false, error: 'El documento no tiene folio (no se emitió correctamente).' }

  const emisor = await getEmisor()
  let detalle: LineaItem[] = []
  try { detalle = JSON.parse(doc.detalle_json || '[]') } catch { /* deja detalle vacío */ }
  const receptor: DteReceptor | undefined = doc.receptor_rut ? {
    RUTRecep: doc.receptor_rut,
    RznSocRecep: doc.receptor_razon_social || undefined,
    GiroRecep: doc.receptor_giro || undefined,
    DirRecep: doc.receptor_direccion || undefined,
    CmnaRecep: doc.receptor_comuna || undefined,
  } : undefined

  const ncId = await getNextId(SHEET)
  const payload = construirNcPayload({
    fecha: todayISO(),
    emisor,
    receptor,
    lineas: detalle,
    tipoDocumentoOriginal: parseInt(doc.tipo_dte, 10),
    folioOriginal: doc.folio,
    fechaOriginal: doc.fecha_emision,
  })
  const r = await emitirDTE(payload, { dev: o.dev, idempotencyKey: `NC_${ncId}` })
  if (!r.ok) return { ok: false, error: r.error }

  let pdf_key = '', pdf_url = ''
  if (r.pdfBuffer) {
    try {
      const up = await uploadToR2(r.pdfBuffer, `facturacion/61-${r.folio ?? ncId}-${ncId}.pdf`, 'application/pdf')
      pdf_key = up.key; pdf_url = up.url
    } catch (e) {
      console.error('[facturacion] error subiendo PDF de NC a R2:', e)
    }
  }

  const { neto, iva, total } = desglosarIvaIncluido(montoBrutoDeLineas(detalle))
  const etiquetaOriginal = doc.tipo_dte === '39' ? 'Boleta' : 'Factura'

  const ncRow: DocumentoRow = {
    id: ncId,
    tipo_dte: String(DTE_NOTA_CREDITO),
    folio: String(r.folio ?? ''),
    estado: 'emitido',
    ambiente: o.dev ? 'pruebas' : 'produccion',
    fecha_emision: todayISO(),
    receptor_tipo: doc.receptor_tipo,
    receptor_id: doc.receptor_id,
    receptor_rut: doc.receptor_rut,
    receptor_razon_social: doc.receptor_razon_social,
    receptor_giro: doc.receptor_giro,
    receptor_direccion: doc.receptor_direccion,
    receptor_comuna: doc.receptor_comuna,
    receptor_correo: doc.receptor_correo,
    monto_neto: String(neto),
    monto_iva: String(iva),
    monto_total: String(total),
    detalle_json: doc.detalle_json,
    resumen: `Anula ${etiquetaOriginal} folio ${doc.folio}`,
    mes_facturado: '',
    fichas_json: '[]',
    openfactura_url: r.selfServiceUrl || '',
    pdf_key,
    pdf_url,
    documento_anulado_id: doc.id,
    nc_id: '',
    motivo_anulacion: o.motivo || '',
    warnings_json: JSON.stringify(r.warnings || []),
    creado_por_id: o.creadoPorId || '',
    creado_por_nombre: o.creadoPorNombre || '',
    fecha_creacion: todayISO(),
  }
  await appendRow(SHEET, ncRow)
  await updateByIdIf(SHEET, doc.id, {}, { estado: 'anulado', nc_id: ncId })

  // Si el documento anulado facturaba fichas a un vet, liberarlas (vuelven a la
  // próxima propuesta mensual en vez de quedar invisibles para siempre).
  if (doc.fichas_json && doc.fichas_json !== '[]') {
    let fichas: Array<{ id: string }> = []
    try { fichas = JSON.parse(doc.fichas_json) } catch { /* nada que liberar */ }
    for (const f of fichas) {
      await updateByIdIf('clientes', f.id, {}, { factura_vet_id: '' })
    }
  }

  return { ok: true, documento: ncRow }
}
