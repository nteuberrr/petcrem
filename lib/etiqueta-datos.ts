/**
 * Datos y formato de la etiqueta de despacho. Va aparte del generador de PDF
 * ([lib/etiqueta-despacho.ts](etiqueta-despacho.ts), que importa pdf-lib y `fs`)
 * para que la vista previa del navegador use exactamente lo mismo que se imprime.
 */

/** Etiqueta de despacho: 80 mm de ancho × 50 mm de alto (se imprime vertical). */
export const ETIQUETA_MM = { ancho: 80, alto: 50 }

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
