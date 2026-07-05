import { getSheetData, appendRow, updateRow, updateById, getNextId, ensureSheet, ensureColumns } from './datastore'
import { buscarComuna } from './comunas'
import { precioParaPeso, matchVets } from './eutanasia-matcher'
import { sendBatch, isResendConfigured } from './resend-mailer'
import { createToken, createVetToken } from './eutanasia-tokens'
import { formatDate, formatHoraDia } from './dates'
import { nombreCompletoVet, renderCotizacionEmail, enviarClienteCotizacionEutanasia } from './eutanasia-mailer'
import { getContacto } from './email-layout'
import { getConsultaEutanasia, getFijoEutanasia } from './eutanasia-precios'
import { crearClienteBorrador } from './cliente-borrador'
import { capitalizarNombre } from './nombres'
import { enviarTextoWhatsapp, isWhatsappConfigured, avisarAdminsWhatsapp } from './whatsapp'
import { marcarConversacionPorTelefono } from './mensajes'

// ─────────────────────────────────────────────────────────────────────────────
// Lógica compartida de cotizaciones de eutanasia: envío a vets + alta automática
// desde el bot. La ruta admin /api/eutanasias/cotizaciones/[id]/enviar y el
// handler del agente (agendarEutanasia) usan las mismas funciones, para que el
// armado del correo y el registro de envíos vivan en UN solo lugar.
// ─────────────────────────────────────────────────────────────────────────────

const SHEET_COTI = 'cotizaciones_eutanasia'
const SHEET_ENVIOS = 'cotizaciones_eutanasia_envios'
const COLS_ENVIOS = ['id', 'cotizacion_id', 'vet_id', 'vet_email', 'fecha_envio', 'fecha_respuesta', 'estado_envio', 'resend_message_id']

const COLS_COTI = [
  'id',
  'mascota_nombre', 'especie', 'peso',
  'cliente_nombre', 'cliente_telefono', 'cliente_email', 'cliente_wa_id',
  'direccion', 'comuna',
  'fecha_servicio', 'hora_servicio',
  // Hora que el VET informa (coordinada con el cliente) para que el crematorio
  // pase a retirar tras la eutanasia. En blanco hasta que la informe.
  'hora_retiro_crematorio',
  'tipo_servicio_cremacion',
  'notas',
  'estado',
  'vet_id_asignado', 'vet_nombre_asignado', 'vet_email_asignado',
  'precio_snapshot', 'consulta_vet_snapshot',
  'cliente_id',
  'estado_pago', 'fecha_pago',
  'cliente_confirmo', 'fecha_cliente_confirmacion',
  'fecha_creacion', 'fecha_envio_cotizacion',
  'fecha_aceptacion', 'fecha_confirmacion',
  'fecha_realizacion', 'fecha_cancelacion',
  'creado_por',
]

export function baseUrlApp(): string {
  return (process.env.PUBLIC_APP_URL || process.env.NEXTAUTH_URL || '').replace(/\/+$/, '')
}

export interface EnvioCotizacionResult {
  enviados: number
  fallidos: number
  total: number
}

/**
 * Envía una cotización por correo a los vets indicados (por id). Crea el token
 * 'aceptar' de cada uno, arma el HTML, registra cada envío en
 * cotizaciones_eutanasia_envios y deja la cotización en 'enviada'. Lanza si la
 * cotización no existe o ya fue tomada.
 */
export async function enviarCotizacionAVets(opts: {
  cotiId: string
  vetIds: string[]
  baseUrl?: string
}): Promise<EnvioCotizacionResult> {
  const baseUrl = (opts.baseUrl ?? baseUrlApp())
  if (!isResendConfigured()) throw new Error('RESEND_API_KEY no configurada')
  if (!baseUrl) throw new Error('PUBLIC_APP_URL o NEXTAUTH_URL deben estar configuradas')
  const vetIds = (opts.vetIds ?? []).map(String)
  if (vetIds.length === 0) throw new Error('No se indicó ningún veterinario')

  const cotis = await getSheetData(SHEET_COTI)
  const idxCot = cotis.findIndex(r => r.id === String(opts.cotiId))
  if (idxCot === -1) throw new Error('Cotización no encontrada')
  const c = cotis[idxCot]
  if (c.estado === 'aceptada' || c.estado === 'realizada') {
    throw new Error(`La cotización ya está en estado "${c.estado}"; no se puede reenviar.`)
  }

  const vets = await getSheetData('vet_convenio_eutanasia')
  const vetsSeleccionados = vets.filter(v => vetIds.includes(v.id))
  if (vetsSeleccionados.length === 0) throw new Error('Ningún veterinario válido')

  await ensureSheet(SHEET_ENVIOS)
  await ensureColumns(SHEET_ENVIOS, COLS_ENVIOS)

  // Idempotencia: no reenviar a un vet que ya recibió ESTA cotización con éxito
  // (evita correos y filas de envío duplicados si se llama dos veces, o si el
  // match automático se solapa con un envío manual previo). Un envío anterior
  // con estado 'error' SÍ se reintenta.
  const enviosPrevios = await getSheetData(SHEET_ENVIOS)
  const yaEnviados = new Set(
    enviosPrevios
      .filter(e => String(e.cotizacion_id) === String(c.id) && (e.estado_envio || '') !== 'error')
      .map(e => String(e.vet_id)),
  )
  const vetsAEnviar = vetsSeleccionados.filter(v => !yaEnviados.has(String(v.id)))
  if (vetsAEnviar.length === 0) {
    return { enviados: 0, fallidos: 0, total: 0 }
  }

  const contacto = await getContacto()
  const emails = vetsAEnviar.map(v => {
    const token = createToken(c.id, v.id, 'aceptar')
    const linkAceptar = `${baseUrl}/eutanasia/aceptar/${token}`
    const tieneDatosPago = (v.datos_pago_completos ?? '').toUpperCase() === 'TRUE'
    const linkDatosPago = tieneDatosPago ? '' : `${baseUrl}/eutanasia/datos-pago/${createVetToken(v.id, 'datos_pago')}`
    return {
      to: v.email,
      subject: `Solicitud de eutanasia en ${c.comuna} — ${formatDate(c.fecha_servicio)} ${formatHoraDia(c.hora_servicio)}`,
      html: renderCotizacionEmail({ vetNombre: nombreCompletoVet(v.nombre, v.apellido), c, linkAceptar, linkDatosPago, contacto }),
      preview_text: `Solicitud de eutanasia para ${c.mascota_nombre} en ${c.comuna}.`,
      reply_to: process.env.MAILING_REPLY_TO || undefined,
      tags: [
        { name: 'tipo', value: 'eutanasia_cotizacion' },
        { name: 'cotizacion_id', value: String(c.id) },
        { name: 'vet_id', value: String(v.id) },
      ],
      // Para el registro/respaldo (correos_log). Sin bccSeguimiento: es un
      // broadcast a la red, no copiamos al admin una vez por veterinario.
      seguimiento: { tipo: 'eutanasia_cotizacion', audiencia: 'Veterinario' as const, nombre: c.mascota_nombre },
    }
  })

  const results = await sendBatch(emails)

  const ahora = new Date().toISOString()
  let okCount = 0
  let failCount = 0
  for (let i = 0; i < vetsAEnviar.length; i++) {
    const v = vetsAEnviar[i]
    const r = results[i]
    if (r.ok) okCount++; else failCount++
    const envioId = await getNextId(SHEET_ENVIOS)
    await appendRow(SHEET_ENVIOS, {
      id: envioId,
      cotizacion_id: c.id,
      vet_id: v.id,
      vet_email: v.email,
      fecha_envio: r.ok ? ahora : '',
      fecha_respuesta: '',
      estado_envio: r.ok ? 'enviada' : 'error',
      resend_message_id: r.message_id || '',
    })
  }

  const partial: Record<string, string> = {}
  if (!c.fecha_envio_cotizacion) partial.fecha_envio_cotizacion = ahora
  if (c.estado === 'creada') partial.estado = 'enviada'
  if (Object.keys(partial).length > 0) {
    await updateRow(SHEET_COTI, idxCot, { ...c, ...partial })
  }

  return { enviados: okCount, fallidos: failCount, total: vetsAEnviar.length }
}

export interface AgendarEutInput {
  mascota_nombre: string
  especie: string
  peso: number
  cliente_nombre: string
  cliente_telefono: string
  cliente_email?: string
  cliente_wa_id?: string
  direccion: string
  comuna: string
  fecha: string   // YYYY-MM-DD
  hora: string    // HH:MM
  tipo_servicio_cremacion?: string  // CI | CP | SD (cremación posterior) | NINGUNA (el tutor no quiere cremación)
  notas?: string
}

export interface AgendarEutResult {
  id: string
  precioVet: number
  comunaCanon: string
  matched: number
  enviados: number
}

/**
 * Alta automática de una cotización de eutanasia (desde el bot): la crea,
 * matchea TODOS los vets que calzan (comuna + día/franja) y les envía el correo.
 * Devuelve cuántos calzaron y a cuántos se les envió.
 */
export async function agendarEutanasiaAutomatico(input: AgendarEutInput): Promise<AgendarEutResult> {
  const comunaCanon = buscarComuna(input.comuna)?.nombre ?? input.comuna

  await ensureSheet('precios_eutanasia')
  await ensureColumns('precios_eutanasia', ['id', 'peso_min', 'peso_max', 'precio'])
  const tramos = await getSheetData('precios_eutanasia')
  const precioVet = precioParaPeso(tramos, input.peso)

  // Snapshot del pago al vet si NO se realiza (la consulta), congelado al agendar.
  const consulta = await getConsultaEutanasia()

  await ensureSheet(SHEET_COTI)
  await ensureColumns(SHEET_COTI, COLS_COTI)
  const id = await getNextId(SHEET_COTI)
  const ahora = new Date().toISOString()
  const cliTel = (input.cliente_telefono || '').replace(/\D/g, '').slice(-9)

  const row = {
    id,
    mascota_nombre: capitalizarNombre(input.mascota_nombre),
    especie: input.especie,
    peso: String(input.peso),
    cliente_nombre: capitalizarNombre(input.cliente_nombre),
    cliente_telefono: cliTel,
    cliente_email: (input.cliente_email || '').trim().toLowerCase(),
    cliente_wa_id: (input.cliente_wa_id || '').replace(/\D/g, ''),
    direccion: input.direccion,
    comuna: comunaCanon,
    fecha_servicio: input.fecha,
    hora_servicio: input.hora,
    tipo_servicio_cremacion: input.tipo_servicio_cremacion ?? '',
    notas: input.notas ?? '',
    estado: 'creada',
    vet_id_asignado: '',
    vet_nombre_asignado: '',
    vet_email_asignado: '',
    precio_snapshot: String(precioVet),
    consulta_vet_snapshot: String(consulta.vet),
    cliente_id: '',
    estado_pago: '',
    fecha_pago: '',
    cliente_confirmo: '',
    fecha_cliente_confirmacion: '',
    fecha_creacion: ahora,
    fecha_envio_cotizacion: '',
    fecha_aceptacion: '',
    fecha_confirmacion: '',
    fecha_realizacion: '',
    fecha_cancelacion: '',
    creado_por: 'bot_whatsapp',
  }
  await appendRow(SHEET_COTI, row)

  // Crear el cliente borrador para la CREMACIÓN posterior (queda "Por ingresar"
  // en /clientes; se agendan ambos servicios) y LIGARLO a la cotización (cliente_id),
  // para el cronograma del dashboard y el borrado si la eutanasia no se realiza.
  // Best-effort: no bloquea la cotización. Si el tutor NO quiere cremación
  // (tipo 'NINGUNA'), no hay servicio posterior → no se crea borrador.
  const sinCremacion = (input.tipo_servicio_cremacion || '').toUpperCase() === 'NINGUNA'
  if (!sinCremacion) try {
    const borradorId = await crearClienteBorrador({
      nombre_tutor: input.cliente_nombre,
      nombre_mascota: input.mascota_nombre,
      telefono: input.cliente_wa_id || input.cliente_telefono,
      email: input.cliente_email,
      direccion_retiro: input.direccion,
      comuna: comunaCanon,
      peso_declarado: input.peso,
      codigo_servicio: input.tipo_servicio_cremacion,
      origen: 'bot_eutanasia',
      notas: `Cremación tras eutanasia a domicilio (cotización N° ${id}).`,
    })
    if (borradorId) await updateById(SHEET_COTI, String(id), { ...row, cliente_id: borradorId })
  } catch (e) {
    console.warn('[eutanasia-cotizaciones] no se pudo crear cliente borrador:', e)
    // Sin borrador la cotización no aparece en el cronograma ni puede limpiarse
    // si la eutanasia no se realiza → avisar al admin para que la ingrese a mano.
    if (isWhatsappConfigured()) {
      try {
        await avisarAdminsWhatsapp(
          `⚠️ Eutanasia N° ${id} (${input.mascota_nombre} / ${input.cliente_nombre}): no se pudo crear la ficha borrador de cremación. Revisa /clientes e ingrésala a mano.`,
        )
      } catch (e2) { console.warn('[eutanasia-cotizaciones] aviso al admin falló:', e2) }
    }
  }

  // Correo al TUTOR: recibimos tu solicitud (explica la evaluación + precios).
  // Best-effort. Precio al cliente si se realiza = tramo + cargo fijo.
  if ((input.cliente_email || '').trim()) {
    try {
      const fijo = await getFijoEutanasia()
      await enviarClienteCotizacionEutanasia({
        clienteEmail: input.cliente_email!.trim().toLowerCase(),
        clienteNombre: input.cliente_nombre,
        mascotaNombre: input.mascota_nombre,
        especie: input.especie,
        peso: input.peso,
        fechaServicio: input.fecha,
        horaServicio: input.hora,
        comuna: comunaCanon,
        precioClienteRealizada: precioVet + fijo,
        consultaTotal: consulta.total,
        conCremacion: !sinCremacion,
      })
    } catch (e) {
      console.warn('[eutanasia-cotizaciones] no se pudo enviar el correo al tutor:', e)
    }
  }

  // Matchear vets que calzan y enviarles el correo.
  const vets = await getSheetData('vet_convenio_eutanasia')
  const matched = matchVets(vets, comunaCanon, input.fecha, input.hora)
  let enviados = 0
  if (matched.length > 0) {
    try {
      const res = await enviarCotizacionAVets({ cotiId: String(id), vetIds: matched.map(v => v.id) })
      enviados = res.enviados
    } catch (e) {
      console.warn('[eutanasia-cotizaciones] no se pudo enviar a los vets:', e)
    }
  }

  // Al AGENDAR la eutanasia, la conversación del tutor pasa a 'cliente'.
  await marcarConversacionPorTelefono(input.cliente_wa_id || input.cliente_telefono || '', 'cliente', { soloSi: ['activo', 'archivado', 'cerrado'] })

  return { id: String(id), precioVet, comunaCanon, matched: matched.length, enviados }
}

/**
 * Cuenta las eutanasias "sobre la marcha": NO canceladas y que aún NO están con
 * el pago confirmado (incluye las en curso creada/enviada/aceptada y las
 * realizada/no_realizada pendientes de pago). Para el badge del sidebar.
 */
export async function contarEutanasiasAbiertas(): Promise<number> {
  const cotis = await getSheetData(SHEET_COTI)
  return cotis.filter(c => (c.estado || '') !== 'cancelada' && (c.estado_pago || '') !== 'pago_confirmado').length
}

export interface EutanasiaCronograma {
  id: string
  mascota_nombre: string
  cliente_nombre: string
  peso: string
  comuna: string
  direccion: string
  fecha_servicio: string
  hora_servicio: string
  /** Hora que el vet informó para el retiro del crematorio ('' si aún no la informa). */
  hora_retiro_crematorio: string
  vet_nombre: string
  /** Ficha borrador asociada (para abrirla desde el dashboard). '' si no tiene. */
  cliente_id: string
  /** 'esperando' (naranja: sin vet aún) | 'tomada' (verde: un vet la tomó / la realizó). */
  estado_cronograma: 'esperando' | 'tomada'
}

/**
 * Eutanasias activas para el cronograma del dashboard:
 *  - 'esperando' (naranja): estado creada/enviada, aún sin veterinario.
 *  - 'tomada' (verde): estado aceptada; o realizada mientras su ficha de cremación
 *    (cliente_id) siga en borrador (aún no se registró el ingreso).
 * Se excluyen no_realizada / cancelada y las realizadas cuya ficha ya se registró
 * (o que no tienen borrador ligado). Ordenadas por fecha/hora del servicio.
 */
export async function listarEutanasiasCronograma(): Promise<EutanasiaCronograma[]> {
  const [cotis, clientes] = await Promise.all([
    getSheetData(SHEET_COTI),
    getSheetData('clientes'),
  ])
  const esBorradorVivo = (clienteId: string) => {
    if (!clienteId) return false
    const c = clientes.find(r => String(r.id) === String(clienteId))
    return !!c && (c.estado || '') === 'borrador'
  }
  const out: EutanasiaCronograma[] = []
  for (const c of cotis) {
    const estado = c.estado || ''
    let cronograma: 'esperando' | 'tomada' | null = null
    if (estado === 'creada' || estado === 'enviada') cronograma = 'esperando'
    else if (estado === 'aceptada') cronograma = 'tomada'
    else if (estado === 'realizada' && esBorradorVivo(c.cliente_id || '')) cronograma = 'tomada'
    if (!cronograma) continue
    out.push({
      id: c.id || '',
      mascota_nombre: c.mascota_nombre || '',
      cliente_nombre: c.cliente_nombre || '',
      peso: c.peso || '',
      comuna: c.comuna || '',
      direccion: c.direccion || '',
      fecha_servicio: c.fecha_servicio || '',
      hora_servicio: c.hora_servicio || '',
      hora_retiro_crematorio: c.hora_retiro_crematorio || '',
      vet_nombre: c.vet_nombre_asignado || '',
      cliente_id: c.cliente_id || '',
      estado_cronograma: cronograma,
    })
  }
  return out.sort((a, b) =>
    (a.fecha_servicio || '').localeCompare(b.fecha_servicio || '') ||
    (a.hora_servicio || '').localeCompare(b.hora_servicio || ''))
}
