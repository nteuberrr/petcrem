/**
 * PLAZO DE ENTREGA PROMETIDO — FUENTE ÚNICA.
 *
 * Lo que promete el sitio, lo que responde el agente de WhatsApp, lo que escribe
 * el de marketing, los PDF del catálogo/informe y —sobre todo— con cuántos días
 * se programa la entrega en el calendario de despachos. Antes ese número estaba
 * escrito a mano en una veintena de archivos.
 *
 * ─── DOS PREGUNTAS DISTINTAS, NO UNA ───────────────────────────────────────
 *
 *  · **¿Qué prometemos HOY?** → el RÉGIMEN vigente, que es el último de PERIODOS.
 *    De ahí salen todos los textos (`ENTREGA_TXT`, `PLAZO_AGENTES`…) y si el
 *    Servicio Express se ofrece o no. Cambia el día que se despliega.
 *
 *  · **¿Qué le debemos a ESTA ficha?** → `plazoParaRetiro(fecha_retiro)`, que
 *    busca el período que cubría el día en que se retiró a la mascota. A cada
 *    tutor se le cumple lo que se le prometió cuando la entregó, así que bajar
 *    el plazo hoy NO puede reescribir el de una ficha que ya está en curso.
 *
 * Por eso PERIODOS es un HISTORIAL y no un solo valor: el 20-08-2026 bajamos de
 * "4 a 10 días" a "máximo 5", y las 19 fichas que venían en curso conservaron los
 * 10 que se les había prometido (decisión del dueño). Con un único valor eso era
 * imposible: habrían pasado a 5 de un día para otro.
 *
 * ─── CÓMO SE CAMBIA EL PLAZO ───────────────────────────────────────────────
 * 1. Cerrá el período abierto poniéndole `hasta` = el último día de retiro que
 *    le corresponde (normalmente hoy).
 * 2. Agregá uno nuevo al FINAL con `desde` = el día siguiente, sus `dias` y su
 *    `formato`. Ese pasa a ser el régimen vigente.
 * 3. Desplegá y corré `npx tsx scripts/verificar-plazo-entrega.ts`.
 *
 * NO edites los `dias` de un período viejo: eso le cambia el plazo a fichas ya
 * entregadas y a las que están en curso.
 */

/** El plazo histórico, el que rige para retiros anteriores a todo período. */
export const PLAZO_NORMAL = 4

/**
 * Cómo se dice de cara al cliente:
 *  · `exacto` → "4 días hábiles"
 *  · `rango`  → "4 a 10 días hábiles"          (el piso es PLAZO_NORMAL)
 *  · `tope`   → "un máximo de 5 días hábiles"
 */
export type FormatoPlazo = 'exacto' | 'rango' | 'tope'

export interface PeriodoPlazo {
  /** Días hábiles máximos que prometemos en este período. */
  dias: number
  /** Primer día de RETIRO al que aplica (ISO). */
  desde: string
  /** Último día de RETIRO al que aplica (ISO). '' = sigue abierto. */
  hasta: string
  formato: FormatoPlazo
  /** Cómo lo nombramos si hay que explicarlo ('' = no se explica, es lo normal). */
  motivo: string
  periodo: string
  /** El Servicio Express (48 h hábiles) no se ofrece mientras rija. */
  suspendeExpress: boolean
}

/** Historial, en orden. El ÚLTIMO es el régimen vigente. */
export const PERIODOS: PeriodoPlazo[] = [
  {
    // Alta demanda de agosto. Cerrado el 20-08-2026: las fichas retiradas hasta
    // ese día conservan los 10 días hábiles que se les prometió.
    dias: 10,
    desde: '2026-08-13',
    hasta: '2026-08-20',
    formato: 'rango',
    motivo: 'la alta demanda',
    periodo: 'agosto',
    suspendeExpress: true,
  },
  {
    // Régimen vigente: máximo 5 días hábiles, y el Express vuelve a ofrecerse.
    dias: 5,
    desde: '2026-08-21',
    hasta: '',
    formato: 'tope',
    motivo: '',
    periodo: '',
    suspendeExpress: false,
  },
]

/** Lo que prometemos HOY. Es el último período: rige desde que se despliega. */
export const REGIMEN: PeriodoPlazo = PERIODOS[PERIODOS.length - 1]

/**
 * Alias histórico. Varios módulos leen `VENTANA.motivo`; apunta al régimen
 * vigente, que es lo que querían saber.
 */
export const VENTANA = REGIMEN

/**
 * Plazo en días hábiles que le corresponde a una ficha, según CUÁNDO se retiró.
 * `plazoBase` es el del tipo de servicio (`tipos_servicio.plazo_entrega_dias`).
 * El Servicio Express lo resuelve quien llama, ANTES: ese plazo manda sobre este.
 */
export function plazoParaRetiro(fechaRetiroIso: string | null | undefined, plazoBase = PLAZO_NORMAL): number {
  const iso = (fechaRetiroIso || '').slice(0, 10)
  if (!iso) return plazoBase
  for (const p of PERIODOS) {
    if (iso < p.desde) continue
    if (p.hasta && iso > p.hasta) continue
    return p.dias
  }
  return plazoBase
}

/** ¿Se puede ofrecer hoy el Servicio Express? */
export function expressDisponible(): boolean {
  return !REGIMEN.suspendeExpress
}

export const ENTREGA_DIAS_MAX = REGIMEN.dias
export const ENTREGA_DIAS_MIN = REGIMEN.formato === 'rango' ? PLAZO_NORMAL : REGIMEN.dias

/**
 * "máximo 5 días hábiles" · "4 a 10 días hábiles" · "4 días hábiles" — PELADO,
 * para celdas de tabla, títulos y cualquier lugar donde la preposición sobra.
 */
export const PLAZO_TXT =
  REGIMEN.formato === 'tope' ? `máximo ${REGIMEN.dias} días hábiles`
  : REGIMEN.formato === 'rango' ? `${PLAZO_NORMAL} a ${REGIMEN.dias} días hábiles`
  : `${REGIMEN.dias} días hábiles`

/**
 * "en un máximo de 5 días hábiles" — con la preposición, que es como entra en
 * las frases ("la entrega es …", "te devolvemos las cenizas …"). Va incluida a
 * propósito: los textos ya decían "en 4 días hábiles", así que el reemplazo
 * calza sin quedar cojo.
 */
export const ENTREGA_TXT =
  REGIMEN.formato === 'tope' ? `en un máximo de ${REGIMEN.dias} días hábiles` : `en ${PLAZO_TXT}`

/** "entrega en un máximo de 5 días hábiles" — para listas de diferenciadores. */
export const ENTREGA = `entrega ${ENTREGA_TXT}`

/** El mismo plazo con el porqué, para donde convenga explicarlo (web, correos). */
export const ENTREGA_FRASE = REGIMEN.motivo
  ? `${ENTREGA_TXT} (plazo excepcional durante ${REGIMEN.periodo} por ${REGIMEN.motivo})`
  : ENTREGA_TXT

/**
 * Los templates del sitio (lib/sitio/templates/*.html) son el EXPORT de Webflow
 * y traen el plazo escrito a mano, tanto en las meta descriptions como en el
 * badge del hero. Editarlos se perdería en la próxima exportación, así que el
 * plazo se reemplaza al vuelo, al servir la página. Si algún día se cambia la
 * redacción del template, hay que sumar el patrón nuevo acá.
 *
 * ⚠️ Los patrones tienen que cubrir TODAS las redacciones que hayan estado
 * vigentes, no solo la original: si un template quedó con "en 4 a 10 días
 * hábiles" de la ventana anterior, sin su patrón se publica ese texto viejo.
 *
 * ⚠️ Y NO pueden ser más anchos de la cuenta. Las políticas de privacidad
 * prometen responder "dentro del plazo de 10 días hábiles" y "en un plazo
 * razonable y no superior a 10 días hábiles": son plazos LEGALES, no de entrega,
 * y reescribirlos cambiaría un compromiso ante el titular de los datos. Por eso
 * cada patrón exige el número pegado a la preposición ("dentro de 4 días", no
 * "dentro del plazo de 10 días"). `scripts/verificar-plazo-entrega.ts` recorre
 * los templates e imprime CADA línea que se toca, para poder mirarlas.
 */
export function aplicarPlazoEntrega(html: string): string {
  return html
    .replace(/en un máximo de \d+ días hábiles/g, ENTREGA_TXT)
    .replace(/en \d+ a \d+ días hábiles/g, ENTREGA_TXT)
    .replace(/en \d+ días hábiles/g, ENTREGA_TXT)
    // "Entregamos tu ánfora dentro de 4 días hábiles": cambia la preposición
    // entera, porque "dentro de máximo 5 días hábiles" queda cojo.
    .replace(/dentro de \d+(?: a \d+)? días hábiles/g, ENTREGA_TXT)
}

/** Bloque para los prompts de los agentes (WhatsApp y marketing). */
export const PLAZO_AGENTES = `PLAZO DE ENTREGA — VIGENTE, es el ÚNICO que puedes prometer:
- La entrega de las cenizas + certificado es ${ENTREGA_TXT.toUpperCase()} desde el retiro. Dilo con naturalidad ("la entrega es ${ENTREGA_TXT}") y agrega que puede ser antes. No prometas una fecha más corta que esa.
- Si el cliente ya tiene su código, la fecha máxima exacta sale de la herramienta de estado: esa fecha manda sobre cualquier estimación tuya.${REGIMEN.motivo ? `
- Es excepcional, por ${REGIMEN.motivo} de ${REGIMEN.periodo}; lo habitual son ${PLAZO_NORMAL} días hábiles y volveremos a eso. Explica el motivo SOLO si preguntan o si ves que la fecha le importa, sin dramatizar y sin pedir disculpas de más.` : ''}${REGIMEN.suspendeExpress ? `
- El Servicio Express (48 horas hábiles) está SUSPENDIDO: NO lo ofrezcas, no lo cotices y no lo menciones. Si el cliente lo pide por su nombre, dile que por ahora no está disponible y ofrécele el plazo normal.` : `
- OJO con las fichas ANTERIORES al ${REGIMEN.desde}: a esos tutores se les prometió un plazo más largo y su fecha máxima es la que devuelve la herramienta de estado. Nunca les rebajes la fecha de memoria.`}`
