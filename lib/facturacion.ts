import { getSheetData, appendRow, updateByIdIf, getNextId } from './datastore'
import { sinBoleta } from './eerr-ingresos'
import { todayISO } from './dates'
import { uploadToR2 } from './cloudflare-r2'
import { enviarBoletaCliente } from './cliente-mailer'
import { marcarBoletaCobro } from './cobros'
import { anularComisionPorFicha, devengarComisionDeFicha, reglaActivaDeVet } from './comisiones'
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

/**
 * Tipos de cobro posterior que SÍ emiten su propia boleta al confirmarse el pago
 * (decisión del dueño 2026-07-29): plata cobrada después de la boleta original,
 * que si no quedaría sin documentar. 'saldo' NO va: ese cierra el pago de la
 * ficha completa y su boleta es la de la ficha.
 */
const TIPOS_COBRO_CON_BOLETA = ['adicional', 'diferencia']

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
 * También cubre las fichas de un vet con COMISIÓN: a esos no se les factura, se le
 * cobra el precio de lista al tutor y se le boletea a él (Configuración → Descuentos
 * Convenios). Al resto de las fichas de veterinaria NO se les emite boleta: se les
 * factura al vet, mensual y manual.
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
 * TODO lo tributario que dispara una ficha al quedar PAGADA, en un solo lugar:
 * devenga la comisión del vet que la derivó (si tiene regla) y emite su boleta si
 * corresponde. La llaman el PATCH de la ficha, el alta ya pagada y el cierre del
 * saldo de un pago parcial — los tres tienen que hacer lo mismo.
 *
 * La BOLETA sale para las fichas REGISTRADAS, PAGADAS, SIN boleta previa y que
 * sean de TUTOR (sin veterinaria) **o de un vet con COMISIÓN**. Idempotente por
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
  const vetId = String(ficha.veterinaria_id || '').trim()
  const fichaRegistrada = String(ficha.estado || '') !== 'borrador' && !!String(ficha.codigo || '').trim()
  const yaTieneBoleta = !!String(ficha.boleta_id || '').trim()
  const estaPagada = String(ficha.estado_pago || '').toLowerCase() === 'pagado'

  // COMISIÓN del vet que derivó, si tiene regla activa. Va PRIMERO y aparte de la
  // boleta a propósito (dueño 2026-08-19): la comisión se gana por derivar un caso
  // que se cobró, y hay ventas que se cierran sin documento —una ficha de Manuel
  // Astorga quedó marcada "no emitir boleta" y su comisión no se devengó nunca—.
  // Es idempotente, así que da igual cuántas veces pase por acá.
  if (fichaRegistrada && estaPagada && vetId) {
    try { await devengarComisionDeFicha(ficha) }
    catch (e) { console.warn('[facturacion] no se pudo devengar la comisión (no bloqueante):', e) }
  }

  // El dueño marcó "no emitir boleta por este servicio". No se emite ni se avisa:
  // es una decisión suya, no una falla. El ingreso igual se registra (en BRUTO,
  // ver lib/eerr-ingresos) y la Conciliación no lo cuenta como diferencia.
  if (sinBoleta(ficha)) return { emitida: false }
  // Una ficha de veterinaria NO se boletea: se le factura al vet a fin de mes. La
  // excepción son los vets con COMISIÓN, que es justamente al revés — al tutor se
  // le cobra el precio de lista y se le boletea a él, y al vet le queda la comisión
  // (Configuración → Descuentos Convenios). Sin esta excepción esas boletas había
  // que emitirlas UNA POR UNA desde Facturación, y las que nadie apretaba se
  // colaban a la propuesta de facturación mensual del veterinario.
  if (vetId && !(await reglaActivaDeVet(vetId))) return { emitida: false }
  if (!fichaRegistrada || yaTieneBoleta || !estaPagada) return { emitida: false }
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

/**
 * Emite la BOLETA (39) de un COBRO POSTERIOR de una ficha ya facturada: producto
 * adicional pedido después, o diferencia de peso. La boleta original cubrió el
 * monto de ese momento, así que esta plata quedaría sin documentar.
 *
 * Es SOLO por el monto del cobro (no por el total de la ficha), y sale al
 * confirmarse el pago recibido — misma regla que el resto: se boletea cuando el
 * pago está en casa. Idempotente por `cobros.boleta_id`.
 *
 * Los cobros tipo 'saldo' NO pasan por acá: esos cierran el pago de la ficha
 * completa y su boleta es la de la ficha (clientes.boleta_id).
 *
 * ⚠️ Solo aplica si la ficha YA tiene su boleta emitida ("cobro POSTERIOR"). Si
 * todavía no la tiene, el adicional ya está dentro de `precio_total` (tanto la
 * ficha como el bot recalculan el snapshot al agregarlo) y lo va a cubrir la
 * boleta de la ficha cuando se emita → emitir acá lo cobraría DOS VECES.
 * Caso real (Simón P183-CP, 2026-07-30): se agregaron dos ánforas premium a una
 * Cremación Premium, se pagó el cobro de la segunda (boleta 10228 por $30.000) y
 * 23 segundos después la ficha se marcó pagada → boleta 10229 por $215.000, que
 * ya incluía esos $30.000. Se declararon $245.000 por una venta de $215.000.
 */
export async function emitirBoletaCobroSiCorresponde(
  cobro: { id: string; cliente_id: string; tipo: string; detalle: string; monto: string; boleta_id?: string },
  meta: { creadoPorNombre?: string } = {},
): Promise<{ emitida: boolean; boleta_id?: string }> {
  if (!TIPOS_COBRO_CON_BOLETA.includes(cobro.tipo)) return { emitida: false }
  if (String(cobro.boleta_id || '').trim()) return { emitida: false }
  const monto = parseInt(String(cobro.monto || '0'), 10) || 0
  if (monto <= 0) return { emitida: false }
  if (!isOpenFacturaConfigurado()) return { emitida: false }

  const ficha = (await getSheetData('clientes')).find(c => String(c.id) === String(cobro.cliente_id))
  if (!ficha) return { emitida: false }
  // Mismas guardas que la boleta de la ficha: solo tutor (las de convenio se
  // facturan al vet, mensual y manual) y solo fichas ya registradas.
  if (String(ficha.veterinaria_id || '').trim()) return { emitida: false }
  if (String(ficha.estado || '') === 'borrador' || !String(ficha.codigo || '').trim()) return { emitida: false }
  // La ficha todavía no tiene boleta → el adicional viaja dentro de precio_total
  // y lo documenta la boleta de la ficha. Emitir acá sería facturarlo dos veces.
  if (!String(ficha.boleta_id || '').trim()) return { emitida: false }

  const mascota = (ficha.nombre_mascota || 'mascota').trim()
  const tutor = (ficha.nombre_tutor || mascota).trim()
  const esDiferencia = cobro.tipo === 'diferencia'
  const nombreLinea = esDiferencia
    ? `Diferencia de peso — cremación de ${mascota}`
    : (cobro.detalle || 'Producto adicional').trim()
  const avisar = (extra: string) => avisarAdminsWhatsapp(
    `⚠️ *Boleta SII no emitida*\n\nEl cobro de ${String(ficha.codigo || '#' + ficha.id)} (${mascota}) por ${fmtPrecio(monto)} se confirmó pagado pero ${extra}\n\nEmítela a mano desde Facturación → emisión manual.`
  ).catch(e => console.warn('[facturacion] no se pudo avisar al admin por WhatsApp:', e))

  try {
    const r = await emitirDocumento({
      tipo: DTE_BOLETA_AFECTA,
      receptorTipo: 'tutor',
      receptorId: String(ficha.id || ''),
      receptor: { RUTRecep: '66666666-6', RznSocRecep: tutor, CorreoRecep: (ficha.email || '').trim() || undefined },
      lineas: [{ nombre: nombreLinea.slice(0, 80), cantidad: 1, montoBruto: monto, descripcion: esDiferencia ? undefined : 'Producto adicional' }],
      resumen: `${esDiferencia ? 'Diferencia' : 'Adicional'} ${(ficha.codigo || '').trim()} · ${mascota}`.trim(),
      cliente: { nombre: tutor, email: (ficha.email || '').trim() || undefined },
      creadoPorId: undefined,
      creadoPorNombre: meta.creadoPorNombre || 'Automático (cobro adicional pagado)',
    })
    if (!r.ok || !r.documento?.id) { avisar(`la boleta automática falló:\n${r.error || 'error desconocido'}`); return { emitida: false } }

    await marcarBoletaCobro(String(cobro.id), String(r.documento.id))

    // Enviarle la boleta al tutor, igual que la de la ficha (best-effort).
    const email = (ficha.email || '').trim()
    if (email) {
      try {
        await enviarBoletaCliente({
          email, nombreMascota: mascota, nombreTutor: tutor, clienteId: String(ficha.id || ''),
          folio: r.documento.folio, montoTotal: parseInt(r.documento.monto_total, 10) || monto,
          pdfUrl: r.documento.pdf_url,
        })
      } catch (e) { console.error('[facturacion] error enviando boleta de cobro al tutor:', e) }
    }
    return { emitida: true, boleta_id: String(r.documento.id) }
  } catch (e) {
    console.warn('[facturacion] error emitiendo boleta de cobro (no bloqueante):', e)
    avisar('la emisión falló con un error inesperado.')
    return { emitida: false }
  }
}

/**
 * DEVOLUCIÓN al tutor confirmada → NOTA DE CRÉDITO parcial sobre la boleta de la
 * ficha (ver el tipo 'devolucion' en [lib/cobros.ts](cobros.ts)).
 *
 * Es la contracara de `emitirBoletaCobroSiCorresponde`: ahí entra plata y se
 * emite un documento nuevo; acá SALE plata y hay que corregir el documento que ya
 * se emitió de más. Va como abono PARCIAL (CodRef 3), nunca como anulación total:
 * la boleta sigue vigente por lo que el servicio realmente valió.
 *
 * Devuelve `{ emitida: false }` sin romper nada cuando no hay nada que corregir
 * al SII —ficha de convenio (se factura al vet), ficha sin boleta (se cobró sin
 * documento), OpenFactura apagado—: la devolución igual queda cerrada, porque la
 * plata se le devolvió al tutor de todos modos.
 */
export async function emitirNcDevolucionSiCorresponde(
  cobro: { id: string; cliente_id: string; tipo: string; detalle: string; monto: string },
  meta: { creadoPorId?: string; creadoPorNombre?: string } = {},
): Promise<{ emitida: boolean; nota_credito_id?: string; error?: string }> {
  if (cobro.tipo !== 'devolucion') return { emitida: false }
  const monto = parseInt(String(cobro.monto || '0'), 10) || 0
  if (monto <= 0) return { emitida: false }
  if (!isOpenFacturaConfigurado()) return { emitida: false, error: 'OpenFactura no está configurado.' }

  const ficha = (await getSheetData('clientes')).find(c => String(c.id) === String(cobro.cliente_id))
  if (!ficha) return { emitida: false, error: 'La ficha del cobro ya no existe.' }
  // Convenio: el servicio se factura al veterinario, mensual y a mano — la
  // corrección va por ahí (Descuentos Convenios → Ajustar saldo), no acá. Y sin
  // boleta no hay documento que corregir (la devolución igual se cierra: la plata
  // se le devolvió al tutor de todos modos).
  if (String(ficha.veterinaria_id || '').trim()) return { emitida: false }
  const boletaId = String(ficha.boleta_id || '').trim()
  if (!boletaId) return { emitida: false }

  const mascota = (ficha.nombre_mascota || 'mascota').trim()
  const r = await anularDocumento({
    documentoId: boletaId,
    monto,
    motivo: (cobro.detalle || `Devolución al tutor — ${mascota}`).slice(0, 990),
    creadoPorId: meta.creadoPorId,
    creadoPorNombre: meta.creadoPorNombre || 'Automático (devolución confirmada)',
  })
  if (!r.ok || !r.documento?.id) {
    await avisarAdminsWhatsapp(
      `⚠️ *Nota de crédito NO emitida*\n\nSe confirmó la devolución de ${String(ficha.codigo || '#' + ficha.id)} (${mascota}) por ${fmtPrecio(monto)} pero la NC automática falló:\n${r.error || 'error desconocido'}\n\nEmítela a mano desde Facturación sobre la boleta del servicio.`
    ).catch(e => console.warn('[facturacion] no se pudo avisar al admin por WhatsApp:', e))
    return { emitida: false, error: r.error }
  }
  return { emitida: true, nota_credito_id: String(r.documento.id) }
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
  /**
   * Monto a acreditar para un ABONO PARCIAL (NC con CodRef 3, "corrige montos"):
   * el documento original sigue vigente por el saldo. Omitido = anulación TOTAL.
   */
  monto?: number
}

/**
 * Total ya acreditado sobre un documento por notas de crédito PARCIALES.
 *
 * No hace falta marcar la NC como parcial en ninguna columna: una anulación total
 * deja el documento en 'anulado', así que cualquier NC que apunte a un documento
 * todavía 'emitido' es necesariamente un abono parcial. (Y una NC no se puede
 * anular, por lo que ninguna se cae después.)
 */
export function abonadoDeDocumento(documentoId: string, todos: Record<string, string>[]): number {
  return todos
    .filter(r => r.tipo_dte === String(DTE_NOTA_CREDITO) && String(r.documento_anulado_id || '') === String(documentoId))
    .reduce((s, r) => s + (parseInt(String(r.monto_total || '0'), 10) || 0), 0)
}

/**
 * Emite una Nota de Crédito (61) sobre un documento emitido.
 *
 *  - Sin `monto` → ANULACIÓN TOTAL: replica el detalle original, marca el documento
 *    'anulado' y libera la ficha (vuelve a la propuesta mensual / se puede
 *    re-documentar). Se bloquea si el documento ya tiene abonos parciales: sumarle
 *    una anulación total acreditaría más de lo emitido.
 *  - Con `monto` → ABONO PARCIAL: una sola línea por ese monto; el documento sigue
 *    vigente por el saldo, la ficha NO se libera y la comisión del vet no se toca
 *    (si hay que corregirla, va por "Ajustar saldo" en Descuentos Convenios).
 */
export async function anularDocumento(o: AnularOpts): Promise<EmitirDocResultado> {
  const rows = await getSheetData(SHEET)
  const doc = rows.find(r => r.id === o.documentoId)
  if (!doc) return { ok: false, error: 'Documento no encontrado' }
  if (doc.estado === 'anulado') return { ok: false, error: 'Este documento ya fue anulado.' }
  if (doc.tipo_dte === String(DTE_NOTA_CREDITO)) return { ok: false, error: 'Una Nota de Crédito no se puede anular.' }
  if (!doc.folio) return { ok: false, error: 'El documento no tiene folio (no se emitió correctamente).' }

  const montoDoc = parseInt(String(doc.monto_total || '0'), 10) || 0
  const abonado = abonadoDeDocumento(doc.id, rows)
  const saldo = montoDoc - abonado
  const esParcial = o.monto !== undefined && o.monto !== null

  if (esParcial) {
    const monto = Math.round(Number(o.monto) || 0)
    if (monto <= 0) return { ok: false, error: 'El monto a acreditar debe ser mayor a 0.' }
    if (monto > saldo) {
      return {
        ok: false,
        error: abonado > 0
          ? `El monto supera el saldo del documento (${fmtPrecio(saldo)}, ya acreditado ${fmtPrecio(abonado)}).`
          : `El monto supera el total del documento (${fmtPrecio(saldo)}).`,
      }
    }
  } else if (abonado > 0) {
    return {
      ok: false,
      error: `Este documento ya tiene notas de crédito por ${fmtPrecio(abonado)}. Emití un abono parcial por el saldo (${fmtPrecio(saldo)}) en vez de una anulación total.`,
    }
  }

  const emisor = await getEmisor()
  let detalle: LineaItem[] = []
  try { detalle = JSON.parse(doc.detalle_json || '[]') } catch { /* deja detalle vacío */ }
  // En el abono parcial el detalle NO es el del documento original: es una sola
  // línea por el monto acreditado (el SII lo lee como corrección de montos).
  if (esParcial) {
    const etiqueta = doc.tipo_dte === '39' ? 'boleta' : 'factura'
    detalle = [{
      nombre: `Abono sobre ${etiqueta} folio ${doc.folio}`.slice(0, 80),
      cantidad: 1,
      montoBruto: Math.round(Number(o.monto) || 0),
      ...(o.motivo?.trim() ? { descripcion: o.motivo.trim().slice(0, 990) } : {}),
    }]
  }
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
    parcial: esParcial,
    razon: o.motivo?.trim() || undefined,
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
    // En el abono parcial guardamos el detalle REAL de la NC (la línea del abono),
    // no el del documento original: es lo que se emitió y lo que suma el saldo.
    detalle_json: esParcial ? JSON.stringify(detalle) : doc.detalle_json,
    resumen: esParcial
      ? `Abona ${etiquetaOriginal.toLowerCase()} folio ${doc.folio}`
      : `Anula ${etiquetaOriginal} folio ${doc.folio}`,
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

  // ⚠️ Todo lo que sigue es exclusivo de la anulación TOTAL. En un abono parcial el
  // documento sigue VIGENTE por el saldo: no se marca 'anulado', la ficha no se
  // libera (sigue documentada) y la comisión del vet no se toca.
  if (!esParcial) {
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

    // Si lo anulado era la BOLETA de una ficha, liberarla también: si no, quedaría
    // marcada como documentada para siempre (fuera de la propuesta mensual y sin
    // poder re-emitirle nada). El `expected` es la guarda fina: solo limpia si esta
    // era efectivamente SU boleta — las boletas de cobros posteriores (adicional /
    // diferencia) apuntan al mismo tutor pero viven en `cobros.boleta_id`.
    if (doc.receptor_tipo === 'tutor' && String(doc.receptor_id || '').trim()) {
      const liberada = await updateByIdIf(
        'clientes', String(doc.receptor_id), { boleta_id: String(doc.id) }, { boleta_id: '' },
      )
      // Esa boleta era la que devengaba la comisión del vet que derivó → se cae con ella.
      if (liberada) {
        try { await anularComisionPorFicha(String(doc.receptor_id)) }
        catch (e) { console.warn('[facturacion] no se pudo anular la comisión de la ficha:', e) }
      }
    }
  }

  return { ok: true, documento: ncRow }
}
