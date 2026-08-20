import { formatDateForSheet, formatHora } from './dates'

/**
 * Fecha (ISO) y minutos del día AHORA en Chile. Igual que `ahoraChile` de
 * lib/agenda, pero acá sin arrastrar imports de servidor: este módulo lo usa
 * también la ficha en el navegador.
 */
export function ahoraEnChile(): { iso: string; min: number } {
  const now = new Date()
  const tz = 'America/Santiago'
  const iso = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
  const hhmm = new Intl.DateTimeFormat('es-CL', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now)
  const [h, m] = hhmm.split(':').map(Number)
  return { iso, min: (h || 0) * 60 + (m || 0) }
}

/**
 * ¿La mascota YA fue retirada?
 *
 * Hasta ahora el sistema lo deducía de "la ficha tiene código y no es borrador",
 * pero registrar la ficha y retirar a la mascota son cosas distintas: el equipo
 * puede dejar la ficha lista antes de que el chofer salga. Cuando eso pasa, todo
 * lo que se apoya en "ya está registrada" se adelanta — el caso Channel
 * (2026-07-28): la ficha se registró una hora antes del retiro y el bot le cobró
 * el adicional por transferencia en vez de dejarlo para el momento del retiro.
 *
 * Regla: si la ficha tiene una fecha/hora de retiro que TODAVÍA no llega, la
 * mascota no ha sido retirada. Sin fecha de retiro (o ya pasada) se asume que sí,
 * que es como se comportaba antes.
 *
 * Es una función PURA (sin imports de servidor): la usan la ficha en el navegador
 * y los handlers del bot.
 */
export function retiroPendiente(
  ficha: { fecha_retiro?: string; hora_retiro?: string },
  ahora: { iso: string; min: number },
): boolean {
  const fecha = formatDateForSheet(ficha.fecha_retiro) || String(ficha.fecha_retiro || '').trim()
  if (!fecha) return false
  if (fecha > ahora.iso) return true
  if (fecha < ahora.iso) return false
  // Mismo día: decide la hora. Sin hora, se asume que ya pasó (comportamiento previo).
  const hhmm = formatHora(ficha.hora_retiro)
  if (!hhmm) return false
  const [h, m] = hhmm.split(':').map(Number)
  if (!Number.isFinite(h) || !Number.isFinite(m)) return false
  return h * 60 + m > ahora.min
}

/**
 * ¿La ficha ya está INGRESADA al sistema?
 *
 * Registrarla es el acto con el que el equipo da por recibida a la mascota: le
 * genera el código de seguimiento y le manda el correo al tutor. Para el equipo,
 * eso ES el retiro realizado (dueño 2026-08-19), y por eso es lo que pinta de
 * azul la etiqueta en la agenda — sin esperar a que el reloj llegue a la hora
 * agendada, que dejaba tres horas en verde un retiro ya hecho.
 *
 * ⚠️ NO confundir con `yaFueRetirada`, que responde una pregunta parecida pero
 * distinta —"¿la mascota está FÍSICAMENTE acá?"— y se usa para decidir si un
 * adicional lo cobra el chofer en la puerta o se manda por transferencia. Esa es
 * más estricta a propósito: ver el caso Channel en su comentario.
 */
export function fichaIngresada(ficha: { codigo?: string; estado?: string }): boolean {
  return String(ficha.codigo || '').trim() !== '' && String(ficha.estado || '').toLowerCase() !== 'borrador'
}

/**
 * Complemento de `retiroPendiente`: la mascota ya está en nuestras manos.
 *
 * Dos señales, y hace falta cualquiera de las dos porque solas se equivocan en
 * direcciones opuestas:
 *
 *  · **El PESO DE INGRESO.** Se toma en nuestra pesa, así que si está, la mascota
 *    está acá — no hay forma de escribirlo sin tenerla enfrente. Manda por sobre
 *    el reloj: cuando el retiro se adelanta (agendado a las 18:00 y hecho a las
 *    15:00), la ficha se ingresa con su peso y la agenda tiene que reflejarlo en
 *    el momento, no esperar a que den las 18:00 (dueño 2026-08-19).
 *  · **La hora agendada ya pasó.** Es el respaldo para las fichas que todavía no
 *    tienen peso cargado.
 *
 * Lo que NO alcanza es "la ficha está registrada", que era la regla original: el
 * equipo a veces deja la ficha lista ANTES de salir a buscar a la mascota, y eso
 * adelantaba todo lo que se apoya en esto — caso Channel (2026-07-28), donde el
 * bot cobró el adicional por transferencia en vez de dejárselo al chofer. Esa
 * ficha se prepara sin peso, así que sigue contando como pendiente.
 *
 * Es una función PURA (sin imports de servidor): la usan la ficha en el navegador
 * y los handlers del bot.
 */
export function yaFueRetirada(
  ficha: { codigo?: string; estado?: string; fecha_retiro?: string; hora_retiro?: string; peso_ingreso?: string | number },
  ahora: { iso: string; min: number },
): boolean {
  if (!fichaIngresada(ficha)) return false
  if (pesada(ficha.peso_ingreso)) return true
  return !retiroPendiente(ficha, ahora)
}

/** ¿Tiene un peso de ingreso real? Un 0 o un texto suelto no cuentan. */
function pesada(peso: string | number | undefined): boolean {
  const n = parseFloat(String(peso ?? '').replace(',', '.'))
  return Number.isFinite(n) && n > 0
}
