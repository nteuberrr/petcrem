import { listConversaciones, getMensajes, marcarSeguimientoEnviado, reclamarBarridoSeguimiento, insertarMensaje, type Mensaje } from './mensajes'
import { redactarSeguimiento, type TurnoMensaje } from './agente-mensajes'
import { enviarTextoWhatsapp, enviarPlantillaWhatsapp, renderPlantillaWa, plantillasAprobadas } from './whatsapp'
import { getSheetData } from './datastore'

/**
 * Seguimiento automático de leads que se enfriaron sin cerrar.
 *
 * El agente del inbox solo responde cuando el cliente escribe; un lead que
 * cotizó y se quedó en silencio no dispara ningún evento. Este barrido (lo
 * corre el cron diario) busca esas conversaciones y les envía UN mensaje de
 * seguimiento cálido para retomar el contacto.
 *
 * Restricción de WhatsApp: fuera de la ventana de 24h del último mensaje del
 * cliente solo se puede escribir con PLANTILLA aprobada (categoría marketing,
 * tiene costo por mensaje). Dentro de la ventana va texto libre redactado por
 * el agente (gratis); con la ventana cerrada y hasta SEGUIMIENTO_PLANTILLA_MAX_HORAS
 * (default 72h) va la plantilla `seguimiento_consulta`. Un solo seguimiento por
 * lead (idempotencia por la columna seguimiento_at).
 */

const num = (v: string | undefined, def: number) => {
  const n = parseInt(v || '', 10)
  return Number.isFinite(n) ? n : def
}

/** Hora actual en Chile (0–23), para respetar horario hábil al escribir. */
function horaChile(): number {
  const h = new Intl.DateTimeFormat('es-CL', { timeZone: 'America/Santiago', hour: '2-digit', hour12: false }).format(new Date())
  return parseInt(h, 10) || 0
}

/** Teléfono a 9 dígitos (para cruzar con la hoja clientes). */
const tel9 = (s: string | null | undefined) => (s || '').replace(/\D/g, '').slice(-9)

export interface ResultadoSeguimiento {
  activo: boolean
  revisadas: number
  enviados: number
  saltados: number
  motivo?: string
  detalle: { id: number; nombre: string; resultado: string }[]
}

/**
 * Recorre las conversaciones activas de WhatsApp (tutores) y envía seguimiento
 * a las que califican. Best-effort en cada lead: un fallo no corta el barrido.
 */
export async function enviarSeguimientosPendientes(opts: { maxEnvios?: number } = {}): Promise<ResultadoSeguimiento> {
  const out: ResultadoSeguimiento = { activo: true, revisadas: 0, enviados: 0, saltados: 0, detalle: [] }

  if ((process.env.SEGUIMIENTO_AUTO || 'true').toLowerCase() === 'false') {
    return { ...out, activo: false, motivo: 'SEGUIMIENTO_AUTO=false' }
  }

  const MIN_HORAS = num(process.env.SEGUIMIENTO_MIN_HORAS, 2)      // debe llevar frío al menos esto (horas desde que se cortó)
  const MAX_HORAS = num(process.env.SEGUIMIENTO_MAX_HORAS, 22)     // ventana de 24h: margen bajo 24
  const HORA_MIN = num(process.env.SEGUIMIENTO_HORA_MIN, 10)       // no escribir antes de esta hora (Chile)
  const HORA_MAX = num(process.env.SEGUIMIENTO_HORA_MAX, 21)       // ni después de esta
  const MAX_ENVIOS = opts.maxEnvios ?? num(process.env.SEGUIMIENTO_MAX_ENVIOS, 40)   // tope de seguridad por corrida

  const h = horaChile()
  if (h < HORA_MIN || h > HORA_MAX) {
    return { ...out, motivo: `fuera de horario hábil (${h}h Chile)` }
  }

  // Clientes ya con ficha (borrador o registrada): no los molestamos con seguimiento.
  const fichas = new Set<string>()
  try {
    for (const c of await getSheetData('clientes')) {
      const t = tel9(c.telefono)
      if (t) fichas.add(t)
    }
  } catch { /* best-effort: si falla, seguimos sin el filtro */ }

  const convs = await listConversaciones({ estado: 'activo', canal: 'whatsapp', audiencia: 'A', limit: 300 })
  const ahora = Date.now()

  for (const conv of convs) {
    if (out.enviados >= MAX_ENVIOS) break
    out.revisadas++
    const nombre = (conv.contacto?.nombre || conv.contacto?.telefono || `#${conv.id}`).replace(/^~/, '').trim()
    const salto = (motivo: string) => { out.saltados++; out.detalle.push({ id: conv.id, nombre, resultado: motivo }) }

    // Ya se le hizo seguimiento, o está pausada / escalada → no tocar.
    if (conv.seguimiento_at) { salto('ya tenía seguimiento'); continue }
    const etq = conv.etiquetas || []
    if (etq.includes('pausado') || etq.includes('requiere-humano')) { salto('pausada/escalada'); continue }

    const telefono = conv.contacto?.wa_id || conv.contacto?.telefono || ''
    if (!telefono) { salto('sin teléfono'); continue }
    if (fichas.has(tel9(telefono))) { salto('ya es cliente con ficha'); continue }

    let msgs: Mensaje[]
    try { msgs = await getMensajes(conv.id) } catch { salto('error al leer mensajes'); continue }
    const conTexto = msgs.filter(m => (m.cuerpo && m.cuerpo.trim()) || m.tipo !== 'texto')
    if (conTexto.length === 0) { salto('sin contenido'); continue }

    const ultimo = conTexto[conTexto.length - 1]
    // Debemos haber hablado nosotros al final (el cliente quedó en silencio).
    if (ultimo.direccion !== 'saliente') { salto('el cliente habló último'); continue }

    const horasDesdeUltimo = (ahora - new Date(ultimo.ts).getTime()) / 3600000
    if (horasDesdeUltimo < MIN_HORAS) { salto(`aún reciente (${horasDesdeUltimo.toFixed(1)}h)`); continue }

    // Lead "tibio": tiene que haber recibido una cotización (algún saliente con precio).
    const cotizó = conTexto.some(m => m.direccion === 'saliente' && (m.cuerpo || '').includes('$'))
    if (!cotizó) { salto('no llegó a cotizar'); continue }

    const nombreCliente = /[a-záéíóúñ]/i.test(nombre) ? nombre : undefined

    // Envío por PLANTILLA (con costo): registra en el inbox el texto real recibido.
    const enviarPlantillaSeguimiento = async (): Promise<boolean> => {
      const primerNombre = (nombreCliente || '').split(/\s+/)[0] || '👋'
      const envio = await enviarPlantillaWhatsapp(telefono, 'seguimiento_consulta', [primerNombre])
      if (!envio.ok) { salto(`error de plantilla: ${envio.error || 'desconocido'}`); return false }
      try {
        await insertarMensaje({ conversacion_id: conv.id, direccion: 'saliente', cuerpo: renderPlantillaWa('seguimiento_consulta', [primerNombre]), enviado_por: 'seguimiento-auto', provider_message_id: envio.message_id ?? null, estado: 'enviado' })
      } catch { /* el mensaje se envió; si falla el registro, seguimos */ }
      await marcarSeguimientoEnviado(conv.id).catch(() => {})
      out.enviados++
      out.detalle.push({ id: conv.id, nombre, resultado: 'enviado (plantilla)' })
      return true
    }

    // ¿La ventana de 24h del último mensaje ENTRANTE sigue abierta?
    const ultEntrante = [...conTexto].reverse().find(m => m.direccion === 'entrante')
    if (!ultEntrante) { salto('el cliente nunca escribió'); continue }
    const horasVentana = (ahora - new Date(ultEntrante.ts).getTime()) / 3600000
    if (horasVentana > MAX_HORAS) {
      // Ventana cerrada → plantilla de reenganche, si aplica y está aprobada.
      const PLANTILLA_MAX_HORAS = num(process.env.SEGUIMIENTO_PLANTILLA_MAX_HORAS, 72)
      if (horasVentana > PLANTILLA_MAX_HORAS) { salto(`demasiado frío para plantilla (${horasVentana.toFixed(1)}h)`); continue }
      if (!(await plantillasAprobadas()).has('seguimiento_consulta')) { salto(`fuera de ventana 24h (${horasVentana.toFixed(1)}h) y plantilla no aprobada`); continue }
      await enviarPlantillaSeguimiento()
      continue
    }

    // Ventana abierta → texto libre redactado por el agente (gratis).
    const historial: TurnoMensaje[] = conTexto.map(m => ({
      rol: m.direccion === 'entrante' ? 'cliente' : 'nosotros',
      texto: (m.cuerpo && m.cuerpo.trim()) ? m.cuerpo : `[${m.tipo}]`,
    }))

    let texto = ''
    try { texto = await redactarSeguimiento(historial, { nombreCliente }) } catch { /* best-effort */ }
    if (!texto) { salto('no se pudo redactar'); continue }

    const envio = await enviarTextoWhatsapp(telefono, texto)
    if (envio.ok) {
      try {
        await insertarMensaje({ conversacion_id: conv.id, direccion: 'saliente', cuerpo: texto, enviado_por: 'seguimiento-auto', provider_message_id: envio.message_id ?? null, estado: 'enviado' })
      } catch { /* el mensaje se envió; si falla el registro, seguimos */ }
      await marcarSeguimientoEnviado(conv.id).catch(() => {})
      out.enviados++
      out.detalle.push({ id: conv.id, nombre, resultado: 'enviado' })
    } else if (envio.fuera_de_ventana) {
      // La ventana se cerró entre el cálculo y el envío: intentar la plantilla al vuelo.
      if ((await plantillasAprobadas()).has('seguimiento_consulta')) {
        if (!(await enviarPlantillaSeguimiento())) await marcarSeguimientoEnviado(conv.id).catch(() => {})
      } else {
        await marcarSeguimientoEnviado(conv.id).catch(() => {})
        salto('fuera de ventana al enviar')
      }
    } else {
      // Error transitorio (red / API): NO marcamos, se reintenta en la próxima corrida.
      salto(`error de envío: ${envio.error || 'desconocido'}`)
    }
  }

  return out
}

/**
 * Barrido "oportunista" con throttle: pensado para colgarse del cron externo de
 * 10 min (el de publicar campañas) y así hacer el seguimiento cerca de las 2h de
 * enfriado, sin depender solo del cron diario. Reclama el slot (corre a lo más
 * cada ~8 min aunque lo disparen varias veces) y usa un cap chico por corrida.
 * Best-effort: nunca lanza.
 */
export async function barridoOportunidadSeguimiento(): Promise<ResultadoSeguimiento | { activo: boolean; motivo: string }> {
  try {
    if ((process.env.SEGUIMIENTO_AUTO || 'true').toLowerCase() === 'false') return { activo: false, motivo: 'SEGUIMIENTO_AUTO=false' }
    const gano = await reclamarBarridoSeguimiento(num(process.env.SEGUIMIENTO_THROTTLE_MIN, 8))
    if (!gano) return { activo: true, motivo: 'throttle: otro barrido corrió hace poco' } as { activo: boolean; motivo: string }
    return await enviarSeguimientosPendientes({ maxEnvios: num(process.env.SEGUIMIENTO_MAX_ENVIOS_OPORTUNO, 15) })
  } catch (e) {
    return { activo: false, motivo: `error: ${e instanceof Error ? e.message : String(e)}` }
  }
}
