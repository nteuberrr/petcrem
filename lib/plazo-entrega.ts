/**
 * PLAZO DE ENTREGA PROMETIDO — FUENTE ÚNICA.
 *
 * Lo normal son 4 días hábiles. Cuando la operación se satura se abre una
 * VENTANA DE ALTA DEMANDA con un plazo mayor, y eso hay que moverlo en TODAS
 * partes a la vez: lo que promete el sitio, lo que responde el agente de
 * WhatsApp, lo que escribe el de marketing, los PDF del catálogo/informe y
 * —sobre todo— con cuántos días se programa la entrega en el calendario de
 * despachos. Antes ese "4" estaba escrito a mano en una veintena de archivos.
 *
 * ─── CÓMO VOLVER A LOS 4 DÍAS ──────────────────────────────────────────────
 * Poné en VENTANA: `activa: false` y la fecha del último día en `hasta`.
 * Es el único cambio necesario (más un deploy).
 *
 * El `hasta` NO es un detalle: las fichas retiradas DENTRO de la ventana
 * conservan su plazo largo aunque la ventana ya esté cerrada. Sin esa fecha,
 * cerrar la ventana volvería a marcar como atrasadas a todas las que se
 * retiraron durante la alta demanda. Por eso el plazo se decide por la FECHA DE
 * RETIRO de cada ficha y no por el día en que se mira el calendario: a cada
 * tutor se le cumple lo que se le prometió cuando entregó a su mascota.
 */

/** El plazo de siempre, el que rige cuando no hay ventana abierta. */
export const PLAZO_NORMAL = 4

export const VENTANA = {
  /** false = no hay alta demanda; el sitio y los agentes vuelven a decir 4 días. */
  activa: true,
  /** Plazo máximo que prometemos mientras dure. */
  dias: 10,
  /** Primer día de retiro afectado (ISO). Los retiros ANTERIORES conservan sus 4 días. */
  desde: '2026-08-13',
  /** Último día de retiro afectado (ISO). '' = sigue abierta. Ver el comentario de arriba. */
  hasta: '',
  /** Cómo lo nombramos de cara al cliente. */
  periodo: 'agosto',
  motivo: 'la alta demanda',
  /** El Servicio Express (48 h hábiles) no se ofrece mientras dure (decisión del dueño). */
  suspendeExpress: true,
}

/**
 * Plazo en días hábiles que le corresponde a una ficha, según CUÁNDO se retiró.
 * `plazoBase` es el del tipo de servicio (`tipos_servicio.plazo_entrega_dias`).
 * El Servicio Express lo resuelve quien llama, ANTES: ese plazo manda sobre este.
 */
export function plazoParaRetiro(fechaRetiroIso: string | null | undefined, plazoBase = PLAZO_NORMAL): number {
  const iso = (fechaRetiroIso || '').slice(0, 10)
  if (!iso) return plazoBase
  if (iso < VENTANA.desde) return plazoBase
  if (VENTANA.hasta && iso > VENTANA.hasta) return plazoBase
  // Ventana cerrada SIN fecha de cierre = se canceló, como si nunca hubiera existido.
  if (!VENTANA.activa && !VENTANA.hasta) return plazoBase
  return VENTANA.dias
}

/** ¿Se puede ofrecer hoy el Servicio Express? */
export function expressDisponible(): boolean {
  return !(VENTANA.activa && VENTANA.suspendeExpress)
}

export const ENTREGA_DIAS_MIN = PLAZO_NORMAL
export const ENTREGA_DIAS_MAX = VENTANA.activa ? VENTANA.dias : PLAZO_NORMAL

/**
 * "4 a 10 días hábiles" · "4 días hábiles" — PELADO, para celdas de tabla,
 * títulos y cualquier lugar donde la preposición sobra.
 */
export const PLAZO_TXT = VENTANA.activa
  ? `${ENTREGA_DIAS_MIN} a ${ENTREGA_DIAS_MAX} días hábiles`
  : `${PLAZO_NORMAL} días hábiles`

/**
 * "en 4 a 10 días hábiles" — con la preposición, que es como entra en las frases
 * ("la entrega es …", "te devolvemos las cenizas …"). Va incluida a propósito:
 * los textos ya decían "en 4 días hábiles", así que el reemplazo calza sin
 * quedar cojo cuando se vuelva al plazo normal.
 */
export const ENTREGA_TXT = `en ${PLAZO_TXT}`

/** "entrega de 4 a 10 días hábiles" — para listas de diferenciadores. */
export const ENTREGA = `entrega ${ENTREGA_TXT}`

/** El mismo plazo con el porqué, para donde convenga explicarlo (web, correos). */
export const ENTREGA_FRASE = VENTANA.activa
  ? `${ENTREGA_TXT} (plazo excepcional durante ${VENTANA.periodo} por ${VENTANA.motivo})`
  : ENTREGA_TXT

/** Bloque para los prompts de los agentes (WhatsApp y marketing). */
export const PLAZO_AGENTES = VENTANA.activa
  ? `PLAZO DE ENTREGA — VIGENTE, es el ÚNICO que puedes prometer:
- La entrega de las cenizas + certificado es ${ENTREGA_TXT.toUpperCase()} desde el retiro. NUNCA prometas ${PLAZO_NORMAL} días: hoy no es el plazo.
- Es excepcional, por ${VENTANA.motivo} de ${VENTANA.periodo}; lo habitual son ${PLAZO_NORMAL} días hábiles y volveremos a eso. Dilo con naturalidad ("la entrega es ${ENTREGA_TXT}") y explica el motivo SOLO si preguntan o si ves que la fecha le importa. Sin dramatizar y sin pedir disculpas de más.
- Si el cliente ya tiene su código, la fecha máxima exacta sale de la herramienta de estado: esa fecha manda sobre cualquier estimación tuya.${VENTANA.suspendeExpress ? `
- El Servicio Express (48 horas hábiles) está SUSPENDIDO mientras dure: NO lo ofrezcas, no lo cotices y no lo menciones. Si el cliente lo pide por su nombre, dile que por ahora no está disponible y ofrécele el plazo normal.` : ''}`
  : `PLAZO DE ENTREGA: ${PLAZO_NORMAL} días hábiles desde el retiro.`
