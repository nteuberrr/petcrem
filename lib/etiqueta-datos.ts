/**
 * Datos y formato de la etiqueta de despacho. Va aparte del generador de PDF
 * ([lib/etiqueta-despacho.ts](etiqueta-despacho.ts), que importa pdf-lib y `fs`)
 * para que la vista previa del navegador use exactamente lo mismo que se imprime.
 */

/** Etiqueta de despacho: 80 mm de ancho × 50 mm de alto (se imprime vertical). */
export const ETIQUETA_MM = { ancho: 80, alto: 50 }

/** 1 mm en puntos PDF. */
export const MM = 72 / 25.4
/** Lienzo de la etiqueta en puntos: 226,8 × 141,7. */
export const ETIQUETA_PT = { ancho: ETIQUETA_MM.ancho * MM, alto: ETIQUETA_MM.alto * MM }

/**
 * Medidas del contenido, en PUNTOS PDF. Fuente única: el generador dibuja con
 * estos números y la vista previa del navegador los multiplica por su escala
 * (px por punto). Antes la vista previa usaba los puntos como si fueran píxeles
 * y se veía a mitad de tamaño, con media etiqueta vacía.
 */
export const L = {
  margen: 6,
  logoAlto: 32,        // el logo (706×807, casi cuadrado) manda el alto de la cabecera
  logoAnchoMax: 120,
  codigo: 25,          // código de servicio: el dato que se lee de lejos
  codigoLargo: 19,     // si no entra a 25 pt
  codigoRotulo: 6,
  rotulo: 6,           // "MASCOTA", "TUTOR"…
  rotuloGap: 2,        // entre el rótulo y su valor
  reglaGap: 4,         // entre la cabecera y la línea divisoria
  trasRegla: 5,        // entre la línea y el primer campo
  interlineado: 2,     // entre líneas de un mismo valor
  huecoMin: 2,         // separación mínima entre campos
  mascota: 15,
  tutor: 12,
  direccion: 9.5,
  telefono: 12,
} as const

export interface EtiquetaDespachoData {
  codigo: string
  nombre_mascota: string
  nombre_tutor: string
  direccion: string
  telefono: string
}

/**
 * Datos de la etiqueta a partir de una fila de `clientes`. La dirección es la de
 * DESPACHO (donde se entrega); si la ficha no la tiene cargada cae a la de retiro
 * para no imprimir una etiqueta vacía.
 */
export function datosEtiqueta(c: Record<string, unknown>): EtiquetaDespachoData {
  const s = (k: string) => String(c[k] ?? '')
  const calle = s('direccion_despacho') || s('direccion_retiro')
  const direccion = [calle, s('depto') ? `Depto/of. ${s('depto')}` : '', s('comuna')].filter(Boolean).join(', ')
  return {
    codigo: s('codigo'),
    nombre_mascota: s('nombre_mascota'),
    nombre_tutor: s('nombre_tutor'),
    direccion,
    telefono: s('telefono'),
  }
}

/** Teléfono chileno legible: 987654321 → +56 9 8765 4321 */
export function formatearTelefono(raw: string): string {
  const d = String(raw || '').replace(/\D/g, '')
  if (!d) return ''
  const n = d.startsWith('56') ? d.slice(2) : d
  if (n.length === 9) return `+56 ${n[0]} ${n.slice(1, 5)} ${n.slice(5)}`
  return raw
}
