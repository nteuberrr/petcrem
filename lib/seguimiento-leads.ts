import {
  listConversaciones, getMensajes, marcarSeguimientoEnviado, marcarSeguimientoControl,
  conversacionesClasificadas, reclamarBarridoSeguimiento, insertarMensaje, type Mensaje,
} from './mensajes'
import { redactarSeguimiento, type TurnoMensaje } from './agente-mensajes'
import { enviarTextoWhatsapp, enviarPlantillaWhatsapp, renderPlantillaWa, plantillasAprobadas } from './whatsapp'
import { getSheetData } from './datastore'

/**
 * Seguimiento automático de leads que se enfriaron sin cerrar.
 *
 * El agente del inbox solo responde cuando el cliente escribe; un lead que
 * cotizó y se quedó en silencio no dispara ningún evento. Este barrido (lo
 * corren el cron diario y el oportunista) busca esas conversaciones y les
 * escribe.
 *
 * UN SOLO TOQUE (~50 min): retoma el contacto donde quedó y ahí termina.
 * Hubo un segundo toque a las ~19 h y se sacó (decisión del dueño 2026-08-17):
 * a quien acaba de perder a su mascota se le escribe UNA vez, y si no responde
 * se le deja tranquilo — insistir no recupera la venta, molesta. El manual de
 * e-commerce recomienda tres toques y rematar con un descuento con reloj; acá
 * eso no es una palanca de conversión, es un motivo para no volver nunca.
 * El código del segundo toque queda (SEGUNDO_TOQUE_HORAS, SYSTEM_SEGUIMIENTO_2
 * en lib/agente-mensajes): se reactiva subiendo SEGUIMIENTO_MAX_TOQUES a 2.
 *
 * GRUPO DE CONTROL (holdout). Un 10% de los leads elegibles NO recibe ningún
 * seguimiento, elegido de forma determinística por su teléfono. Sin ese grupo no
 * hay forma de saber si el seguimiento recupera ventas o solo le escribe a gente
 * que iba a volver igual: la comparación honesta es la diferencia entre las dos
 * ramas, no la tasa de conversión de los contactados. Se apaga con
 * SEGUIMIENTO_HOLDOUT_PCT=0 cuando la respuesta ya esté medida.
 *
 * Restricción de WhatsApp: fuera de la ventana de 24h del último mensaje del
 * cliente solo se puede escribir con PLANTILLA aprobada (categoría marketing,
 * tiene costo por mensaje). Dentro de la ventana va texto libre redactado por
 * el agente (gratis); con la ventana cerrada y hasta SEGUIMIENTO_PLANTILLA_MAX_HORAS
 * (default 72h) va la plantilla `seguimiento_consulta`.
 *
 * Idempotencia: `seguimiento_n` cuenta los toques (−1 = grupo de control).
 * ⚠️ Esa columna la agrega supabase/atribucion-meta-y-seguimiento.sql. Mientras
 * no se corra, el barrido se comporta como antes (un solo toque, sin holdout):
 * ver `tieneContador`.
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

/**
 * ¿Este lead cae en el grupo de CONTROL? Determinístico por teléfono: el mismo
 * número siempre cae del mismo lado, así que la asignación no cambia entre
 * corridas ni se puede "reintentar hasta que toque tratamiento".
 */
function enHoldout(telefono: string): boolean {
  const pct = num(process.env.SEGUIMIENTO_HOLDOUT_PCT, 10)
  if (pct <= 0) return false
  const t = tel9(telefono)
  if (t.length !== 9) return false
  let h = 0
  for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) >>> 0
  return h % 100 < pct
}

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

  // Minutos de silencio antes de escribir. Antes eran 2 horas (SEGUIMIENTO_MIN_HORAS,
  // ya no se usa): a esa altura el lead solía estar cotizando con la competencia.
  // Ojo: el barrido se dispara con el cron externo (cada ~15 min), así que el
  // mensaje sale entre los 50 y los ~65 minutos.
  const MIN_MINUTOS = num(process.env.SEGUIMIENTO_MIN_MINUTOS, 50)
  // Horas entre el primer toque y el segundo. 19 h no es un número redondo: es
  // lo que deja el segundo mensaje DENTRO de la ventana de 24 h (el primero sale
  // ~1 h después del cliente), y adentro de la ventana el texto libre es gratis.
  // Subirlo lo empuja a plantilla paga; bajarlo lo vuelve insistente.
  const SEGUNDO_TOQUE_HORAS = num(process.env.SEGUIMIENTO_TOQUE2_HORAS, 19)
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

    // Cuántos toques van. Si la columna todavía no existe (el DDL se corre a
    // mano), `seguimiento_n` llega undefined y se cae al comportamiento previo:
    // un solo toque, gobernado por la fecha. Nunca al revés — dar por hecho el
    // contador sin la columna dispararía el segundo toque en CADA barrido,
    // porque el update que lo registra fallaría en silencio.
    const tieneContador = conv.seguimiento_n !== undefined && conv.seguimiento_n !== null
    const toques = tieneContador ? Number(conv.seguimiento_n) : (conv.seguimiento_at ? 1 : 0)
    // −1 = grupo de control: elegible, pero a propósito sin mensajes.
    if (toques < 0) { salto('grupo de control'); continue }
    // Un solo toque por defecto (ver el encabezado). Sigue siendo configurable
    // por env para poder volver a dos sin desplegar.
    const MAX_TOQUES = tieneContador ? num(process.env.SEGUIMIENTO_MAX_TOQUES, 1) : 1
    if (toques >= MAX_TOQUES) { salto(`ya tiene ${toques} toque(s)`); continue }
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

    const minutosDesdeUltimo = (ahora - new Date(ultimo.ts).getTime()) / 60000
    if (toques === 0) {
      if (minutosDesdeUltimo < MIN_MINUTOS) { salto(`aún reciente (${Math.round(minutosDesdeUltimo)} min)`); continue }
    } else {
      // Segundo toque: se cuenta desde el PRIMERO, no desde el último mensaje —
      // si no, cualquier saliente posterior (un aviso, una foto) correría el reloj.
      const horasDesdeToque1 = (ahora - new Date(conv.seguimiento_at || ultimo.ts).getTime()) / 3600000
      if (horasDesdeToque1 < SEGUNDO_TOQUE_HORAS) { salto(`toque 2 aún no toca (${horasDesdeToque1.toFixed(1)}h)`); continue }
    }

    // Lead "tibio": tiene que haber recibido una cotización (algún saliente con precio).
    const cotizó = conTexto.some(m => m.direccion === 'saliente' && (m.cuerpo || '').includes('$'))
    if (!cotizó) { salto('no llegó a cotizar'); continue }

    // GRUPO DE CONTROL: se decide recién acá, cuando el lead ya pasó TODOS los
    // filtros. Marcarlo antes contaminaría el experimento con leads que igual no
    // habrían recibido nada; marcarlo ahora deja las dos ramas comparables.
    if (toques === 0 && enHoldout(telefono)) {
      if (tieneContador) await marcarSeguimientoControl(conv.id).catch(() => {})
      salto('grupo de control (holdout)')
      continue
    }

    const toqueActual: 1 | 2 = toques === 0 ? 1 : 2
    const nombreCliente = /[a-záéíóúñ]/i.test(nombre) ? nombre : undefined

    // Envío por PLANTILLA (con costo): registra en el inbox el texto real recibido.
    const enviarPlantillaSeguimiento = async (): Promise<boolean> => {
      const primerNombre = (nombreCliente || '').split(/\s+/)[0] || '👋'
      const envio = await enviarPlantillaWhatsapp(telefono, 'seguimiento_consulta', [primerNombre])
      if (!envio.ok) { salto(`error de plantilla: ${envio.error || 'desconocido'}`); return false }
      try {
        await insertarMensaje({ conversacion_id: conv.id, direccion: 'saliente', cuerpo: renderPlantillaWa('seguimiento_consulta', [primerNombre]), enviado_por: 'seguimiento-auto', provider_message_id: envio.message_id ?? null, estado: 'enviado' })
      } catch { /* el mensaje se envió; si falla el registro, seguimos */ }
      await marcarSeguimientoEnviado(conv.id, toqueActual).catch(() => {})
      out.enviados++
      out.detalle.push({ id: conv.id, nombre, resultado: `enviado (plantilla, toque ${toqueActual})` })
      return true
    }

    // ¿La ventana de 24h del último mensaje ENTRANTE sigue abierta?
    const ultEntrante = [...conTexto].reverse().find(m => m.direccion === 'entrante')
    if (!ultEntrante) { salto('el cliente nunca escribió'); continue }
    const horasVentana = (ahora - new Date(ultEntrante.ts).getTime()) / 3600000
    if (horasVentana > MAX_HORAS) {
      // El SEGUNDO toque no se manda por plantilla: es un cierre amable, y pagar
      // una plantilla de marketing para despedirse de alguien que ya no contestó
      // es gastar y molestar a la vez. Se da por cerrado y no se reintenta.
      if (toqueActual === 2) {
        await marcarSeguimientoEnviado(conv.id, 2).catch(() => {})
        salto('toque 2 omitido (fuera de la ventana de 24h)')
        continue
      }
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
      // Con el ts, cada mensaje del cliente le llega al modelo fechado: así un
      // "hoy" de días atrás no se lee como si fuera de ahora.
      ts: m.ts,
    }))

    let texto = ''
    try { texto = await redactarSeguimiento(historial, { nombreCliente, toque: toqueActual }) } catch { /* best-effort */ }
    if (!texto) { salto('no se pudo redactar'); continue }

    const envio = await enviarTextoWhatsapp(telefono, texto)
    if (envio.ok) {
      try {
        await insertarMensaje({ conversacion_id: conv.id, direccion: 'saliente', cuerpo: texto, enviado_por: 'seguimiento-auto', provider_message_id: envio.message_id ?? null, estado: 'enviado' })
      } catch { /* el mensaje se envió; si falla el registro, seguimos */ }
      await marcarSeguimientoEnviado(conv.id, toqueActual).catch(() => {})
      out.enviados++
      out.detalle.push({ id: conv.id, nombre, resultado: `enviado (toque ${toqueActual})` })
    } else if (envio.fuera_de_ventana) {
      // La ventana se cerró entre el cálculo y el envío: intentar la plantilla al
      // vuelo, salvo en el segundo toque (no se paga una plantilla por un cierre).
      if (toqueActual === 1 && (await plantillasAprobadas()).has('seguimiento_consulta')) {
        if (!(await enviarPlantillaSeguimiento())) await marcarSeguimientoEnviado(conv.id, toqueActual).catch(() => {})
      } else {
        await marcarSeguimientoEnviado(conv.id, toqueActual).catch(() => {})
        salto('fuera de ventana al enviar')
      }
    } else {
      // Error transitorio (red / API): NO marcamos, se reintenta en la próxima corrida.
      salto(`error de envío: ${envio.error || 'desconocido'}`)
    }
  }

  return out
}

export interface LiftSeguimiento {
  /** Leads elegibles que SÍ recibieron seguimiento. */
  tratados: number
  tratadosConFicha: number
  /** Leads elegibles del grupo de control (no recibieron nada). */
  control: number
  controlConFicha: number
  /** Diferencia en puntos porcentuales (tratados − control). null si no hay control. */
  liftPuntos: number | null
}

/**
 * El resultado del experimento: ¿el seguimiento recupera ventas, o le escribe a
 * gente que iba a volver igual?
 *
 * Compara las dos ramas que el barrido ya separó (`seguimiento_n >= 1` contra
 * `-1`) por el único desenlace que importa: si ese teléfono terminó en una ficha.
 * Ambas pasaron por el mismo filtro de elegibilidad, así que la diferencia es
 * atribuible al mensaje y no a qué leads eran mejores.
 *
 * ⚠️ Con ~46 fichas al mes y un 10% de control, esto tarda MESES en tener
 * significancia. Es un termómetro para mirar de a trimestres, no una métrica
 * semanal: si el control tiene 4 leads, la diferencia no dice nada todavía.
 */
export async function medirLiftSeguimiento(desdeIso: string): Promise<LiftSeguimiento | null> {
  try {
    const clasificadas = await conversacionesClasificadas(desdeIso)
    if (!clasificadas.length) return null
    const fichas = new Set<string>()
    for (const c of await getSheetData('clientes')) {
      const t = tel9(c.telefono)
      if (t) fichas.add(t)
    }
    const cuenta = (filtro: (n: number) => boolean) => {
      const grupo = clasificadas.filter(c => filtro(c.seguimiento_n))
      return { total: grupo.length, conFicha: grupo.filter(c => fichas.has(tel9(c.telefono))).length }
    }
    const t = cuenta(n => n >= 1)
    const c = cuenta(n => n < 0)
    return {
      tratados: t.total,
      tratadosConFicha: t.conFicha,
      control: c.total,
      controlConFicha: c.conFicha,
      liftPuntos: t.total > 0 && c.total > 0
        ? Math.round(((t.conFicha / t.total) - (c.conFicha / c.total)) * 1000) / 10
        : null,
    }
  } catch (e) {
    console.warn('[seguimiento] medirLift:', e instanceof Error ? e.message : e)
    return null
  }
}

/**
 * Barrido "oportunista" con throttle: se cuelga del cron externo (cada 15 min, el
 * de publicar campañas) para escribir cerca de los 50 min de enfriado, sin depender
 * solo del cron diario. Reclama el slot (corre a lo más cada ~8 min aunque lo
 * disparen varias veces) y usa un cap chico por corrida.
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
