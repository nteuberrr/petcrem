import { getSheetData, appendRow, updateByIdIf, getNextId } from './datastore'
import { fechaChileISO, horaChile } from './dates'
import { sendEmail, isResendConfigured } from './resend-mailer'
import { construirAvisoPagosPendientes, type AvisoRenderizado } from './aviso-pagos-pendientes'
import { construirAvisoAgendamientos } from './aviso-agendamientos'
import { construirAvisoSaludWhatsapp } from './aviso-whatsapp-salud'

/**
 * AVISOS AUTOMÁTICOS (Configuración Avanzada → Avisos).
 *
 * Correos INTERNOS al equipo, programados: cada aviso del catálogo `AVISOS` se
 * arma con datos en vivo y sale a la hora configurada, todos los días.
 *
 * Cómo corre: `/api/cron/avisos` se dispara CADA HORA (Vercel) y `ejecutar()`
 * manda solo los avisos cuya `hora` coincide con la hora de CHILE en ese momento.
 * Se hace así, y no con un cron a las 13:00 UTC, porque Chile cambia de huso dos
 * veces al año (UTC-4 / UTC-3): un cron fijo en UTC se correría una hora en
 * septiembre. La guarda `ultimo_envio` (fecha de Chile) evita el doble envío.
 *
 * ⚠️ Al sumar un aviso nuevo: agregalo a `AVISOS` con su `construir()` y listo —
 * la UI, la vista previa, la prueba y el cron lo toman solos.
 */

const TABLA = 'avisos_config'

export interface AvisoMeta {
  clave: string
  titulo: string
  descripcion: string
  /** Arma el correo con datos en vivo. La usan el cron, la vista previa y la prueba. */
  construir: () => Promise<AvisoRenderizado>
}

export const AVISOS: AvisoMeta[] = [
  {
    // La clave NO cambia: es la que guarda la configuración (horario, destinatarios).
    clave: 'pagos_pendientes',
    titulo: 'Cuentas por cobrar y por pagar',
    descripcion: 'POR COBRAR: fichas con pago pendiente o parcial, separadas en tutores y convenio, con el detalle del cobro y la nota de la ficha. POR PAGAR: la nómina de veterinarios de eutanasia con servicios cerrados sin pago confirmado, agrupada por veterinario y con sus datos de transferencia.',
    construir: construirAvisoPagosPendientes,
  },
  {
    clave: 'agendamientos_sin_resolver',
    titulo: 'Agendamientos sin resolver',
    descripcion: 'Solicitudes de retiro que nadie confirmó ni rechazó (bloquean el horario y dejan al cliente esperando), eutanasias que ningún veterinario tomó todavía, y el listado de lo confirmado para hoy y mañana.',
    construir: construirAvisoAgendamientos,
  },
  {
    clave: 'whatsapp_salud',
    titulo: 'WhatsApp: estado de la cuenta',
    descripcion: 'Vigila que WhatsApp esté ENTREGANDO. Con «omitir si está vacío» no manda nada mientras todo funcione: llega solo el día que Meta bloquea la cuenta (lo más común, un problema con el método de pago) o que un aviso al equipo se pierde. Va por correo a propósito: es el único canal que sirve cuando el que falla es WhatsApp.',
    construir: construirAvisoSaludWhatsapp,
  },
]

export function getAvisoMeta(clave: string): AvisoMeta | undefined {
  return AVISOS.find(a => a.clave === clave)
}

export interface AvisoConfig {
  clave: string
  activo: boolean
  /** Correos que reciben el aviso. */
  destinatarios: string[]
  /** "HH:MM" en hora de Chile. */
  hora: string
  /** true = si no hay nada que reportar, no se manda el correo. */
  omitirVacio: boolean
  /** YYYY-MM-DD (Chile) del último envío automático. */
  ultimoEnvio: string
}

const DEFAULT_HORA = '09:00'

function parseDestinatarios(raw: unknown): string[] {
  return String(raw ?? '')
    .split(/[,;\n]/)
    .map(s => s.trim())
    .filter(Boolean)
}

function esTrue(v: unknown): boolean {
  return String(v ?? '').toUpperCase() === 'TRUE'
}

function normalizarHora(raw: unknown): string {
  const m = String(raw ?? '').trim().match(/^(\d{1,2}):(\d{2})/)
  if (!m) return DEFAULT_HORA
  const h = Math.min(23, Math.max(0, parseInt(m[1], 10)))
  const min = Math.min(59, Math.max(0, parseInt(m[2], 10)))
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
}

function toConfig(row: Record<string, string> | undefined, clave: string): AvisoConfig {
  return {
    clave,
    activo: esTrue(row?.activo),
    destinatarios: parseDestinatarios(row?.destinatarios),
    hora: normalizarHora(row?.hora),
    omitirVacio: esTrue(row?.omitir_vacio),
    ultimoEnvio: String(row?.ultimo_envio ?? ''),
  }
}

/** Config de todos los avisos del catálogo (los que no tienen fila salen apagados). */
export async function listarAvisos(): Promise<Array<AvisoConfig & { titulo: string; descripcion: string }>> {
  let rows: Record<string, string>[] = []
  try { rows = await getSheetData(TABLA) } catch { rows = [] }
  return AVISOS.map(a => ({
    ...toConfig(rows.find(r => String(r.clave) === a.clave), a.clave),
    titulo: a.titulo,
    descripcion: a.descripcion,
  }))
}

export async function getAvisoConfig(clave: string): Promise<AvisoConfig> {
  try {
    const rows = await getSheetData(TABLA)
    return toConfig(rows.find(r => String(r.clave) === clave), clave)
  } catch {
    return toConfig(undefined, clave)
  }
}

export interface GuardarAvisoInput {
  activo?: boolean
  destinatarios?: string[]
  hora?: string
  omitirVacio?: boolean
}

/** Upsert de la config de un aviso. Devuelve la config ya guardada. */
export async function guardarAvisoConfig(clave: string, input: GuardarAvisoInput): Promise<AvisoConfig> {
  if (!getAvisoMeta(clave)) throw new Error('Aviso desconocido')
  const rows = await getSheetData(TABLA)
  const existente = rows.find(r => String(r.clave) === clave)
  const actual = toConfig(existente, clave)

  const campos: Record<string, string> = { fecha_actualizacion: new Date().toISOString() }
  if (input.activo !== undefined) campos.activo = input.activo ? 'TRUE' : 'FALSE'
  if (input.destinatarios !== undefined) campos.destinatarios = input.destinatarios.map(s => s.trim()).filter(Boolean).join(', ')
  if (input.hora !== undefined) campos.hora = normalizarHora(input.hora)
  if (input.omitirVacio !== undefined) campos.omitir_vacio = input.omitirVacio ? 'TRUE' : 'FALSE'

  if (existente) {
    await updateByIdIf(TABLA, String(existente.id), {}, campos)
  } else {
    await appendRow(TABLA, {
      id: await getNextId(TABLA),
      clave,
      activo: campos.activo ?? (actual.activo ? 'TRUE' : 'FALSE'),
      destinatarios: campos.destinatarios ?? actual.destinatarios.join(', '),
      hora: campos.hora ?? actual.hora,
      omitir_vacio: campos.omitir_vacio ?? (actual.omitirVacio ? 'TRUE' : 'FALSE'),
      ultimo_envio: actual.ultimoEnvio,
      fecha_actualizacion: campos.fecha_actualizacion,
    })
  }
  return getAvisoConfig(clave)
}

/** Marca la fecha (Chile) del último envío automático — guarda anti doble envío. */
async function marcarEnviado(clave: string, fecha: string): Promise<void> {
  const rows = await getSheetData(TABLA)
  const row = rows.find(r => String(r.clave) === clave)
  if (row) await updateByIdIf(TABLA, String(row.id), {}, { ultimo_envio: fecha })
}

export interface ResultadoEnvio {
  clave: string
  enviados: number
  fallidos: number
  destinatarios: string[]
  resumen: string
  vacio: boolean
  error?: string
}

/**
 * Arma y manda un aviso. `to` sobrescribe los destinatarios configurados (envío
 * de prueba desde la UI) y `correo` permite reusar uno ya armado (el cron lo
 * construye antes para decidir si está vacío, y así no se arma dos veces).
 * No toca `ultimo_envio`: eso lo hace solo el cron.
 */
export async function enviarAviso(clave: string, opts: { to?: string[]; correo?: AvisoRenderizado } = {}): Promise<ResultadoEnvio> {
  const meta = getAvisoMeta(clave)
  if (!meta) return { clave, enviados: 0, fallidos: 0, destinatarios: [], resumen: '', vacio: true, error: 'Aviso desconocido' }
  if (!isResendConfigured()) {
    return { clave, enviados: 0, fallidos: 0, destinatarios: [], resumen: '', vacio: true, error: 'RESEND_API_KEY no configurada' }
  }
  const cfg = await getAvisoConfig(clave)
  const destinatarios = (opts.to && opts.to.length ? opts.to : cfg.destinatarios).map(s => s.trim()).filter(Boolean)
  if (destinatarios.length === 0) {
    return { clave, enviados: 0, fallidos: 0, destinatarios: [], resumen: '', vacio: true, error: 'No hay destinatarios configurados' }
  }

  const correo = opts.correo ?? await meta.construir()
  let enviados = 0
  let fallidos = 0
  // Uno por destinatario: son pocos y así cada quien recibe el correo a su nombre
  // (sin exponer las otras casillas del equipo).
  for (const to of destinatarios) {
    const r = await sendEmail({
      to,
      subject: correo.subject,
      html: correo.html,
      preview_text: correo.resumen,
      // Es un correo INTERNO al equipo: no lleva la copia de seguimiento (sería
      // una copia de una copia), pero sí queda en el registro de correos.
      noBcc: true,
      seguimiento: { tipo: `aviso_${clave}` },
    })
    if (r.ok) enviados++
    else { fallidos++; console.warn(`[avisos] fallo enviando ${clave} a ${to}:`, r.error) }
  }
  return { clave, enviados, fallidos, destinatarios, resumen: correo.resumen, vacio: correo.vacio }
}

export interface ResultadoCron {
  hora: string
  fecha: string
  ejecutados: ResultadoEnvio[]
  omitidos: Array<{ clave: string; motivo: string }>
}

/**
 * Lo que corre el cron cada hora: manda los avisos activos cuya hora configurada
 * coincide con la hora de Chile y que no salieron todavía hoy.
 */
export async function ejecutarAvisosProgramados(opts: { forzar?: string } = {}): Promise<ResultadoCron> {
  const hora = horaChile()
  const fecha = fechaChileISO()
  const ejecutados: ResultadoEnvio[] = []
  const omitidos: Array<{ clave: string; motivo: string }> = []

  for (const meta of AVISOS) {
    const forzado = opts.forzar === meta.clave
    const cfg = await getAvisoConfig(meta.clave)
    if (!forzado) {
      if (!cfg.activo) { omitidos.push({ clave: meta.clave, motivo: 'desactivado' }); continue }
      if (cfg.destinatarios.length === 0) { omitidos.push({ clave: meta.clave, motivo: 'sin destinatarios' }); continue }
      // El cron corre en punto; comparar la HORA alcanza (y tolera que Vercel
      // dispare unos minutos tarde).
      if (cfg.hora.slice(0, 2) !== hora.slice(0, 2)) { omitidos.push({ clave: meta.clave, motivo: `no es su hora (${cfg.hora})` }); continue }
      if (cfg.ultimoEnvio === fecha) { omitidos.push({ clave: meta.clave, motivo: 'ya salió hoy' }); continue }
    }

    try {
      const correo = await meta.construir()
      if (correo.vacio && cfg.omitirVacio && !forzado) {
        await marcarEnviado(meta.clave, fecha) // cuenta como resuelto: hoy no había nada
        omitidos.push({ clave: meta.clave, motivo: 'sin novedades (configurado para no enviar vacío)' })
        continue
      }
      const r = await enviarAviso(meta.clave, { correo })
      ejecutados.push(r)
      // Se marca aunque algún destinatario falle: reintentar la hora siguiente
      // duplicaría el correo a los que sí lo recibieron.
      if (r.enviados > 0) await marcarEnviado(meta.clave, fecha)
    } catch (e) {
      console.error(`[avisos] error ejecutando ${meta.clave}:`, e)
      omitidos.push({ clave: meta.clave, motivo: 'error al construir/enviar' })
    }
  }

  return { hora, fecha, ejecutados, omitidos }
}
