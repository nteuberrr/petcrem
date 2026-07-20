/**
 * ¿Una cotización de eutanasia a domicilio INCLUYE cremación posterior?
 *
 * Fuente de verdad: la columna `incluye_cremacion` ('TRUE'/'FALSE') de
 * `cotizaciones_eutanasia`. Para registros previos a esa columna (valor vacío)
 * se DERIVA del `tipo_servicio_cremacion`: solo 'NINGUNA' cuenta como SIN
 * cremación; cualquier otra cosa (un tipo real o vacío) se asume CON cremación,
 * para no cambiarle el comportamiento histórico a las eutanasias ya creadas.
 *
 * Efecto de la distinción:
 *  - SIN cremación → la eutanasia es solo un recordatorio en el calendario
 *    (etiqueta GRIS a la hora del servicio), NO aparece en el panel de
 *    notificaciones del dashboard y NO bloquea la agenda del chofer (nuestro
 *    chofer no pasa a retirar). Igual se gestiona en Servicios → Cotizaciones.
 *  - CON cremación → el chofer pasa a retirar: aparece en el dashboard, ocupa un
 *    slot en la agenda y tiene ficha de cremación (borrador) asociada.
 *
 * Módulo liviano y sin imports de servidor: lo usan tanto libs de servidor
 * (agenda, cotizaciones, rutas API) como el cliente (Servicios).
 */
export function incluyeCremacion(cot: { incluye_cremacion?: string; tipo_servicio_cremacion?: string }): boolean {
  const explicit = String(cot.incluye_cremacion ?? '').trim().toUpperCase()
  if (explicit === 'TRUE' || explicit === 'VERDADERO') return true
  if (explicit === 'FALSE' || explicit === 'FALSO') return false
  const tipo = String(cot.tipo_servicio_cremacion ?? '').trim().toUpperCase()
  return tipo !== 'NINGUNA'
}
