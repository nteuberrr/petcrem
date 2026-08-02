/**
 * "El tutor pidió el video del proceso" — una sola fuente de verdad.
 *
 * Vive en su propia columna `clientes.video_solicitado` (fecha ISO de la
 * solicitud; '' = no lo pidió). `notas` quedó reservado EXCLUSIVAMENTE para los
 * comentarios que escribe el equipo a mano: nada automático se escribe ahí.
 *
 * Las fichas viejas (anteriores a la columna) traen la marca dentro de `notas`;
 * `pidioVideo` la sigue reconociendo para no perder esas solicitudes. La
 * migración que limpia esas notas está en supabase/schema-principal.sql.
 */

/** Marca legada que se escribía dentro de `notas` (solo lectura, ya no se escribe). */
export const MARCA_VIDEO_LEGADA = 'El tutor solicitó el video'

/** ¿El tutor pidió el video del proceso para esta ficha? */
export function pidioVideo(cliente: { video_solicitado?: string; notas?: string }): boolean {
  if ((cliente.video_solicitado || '').trim()) return true
  return (cliente.notas || '').includes(MARCA_VIDEO_LEGADA)
}
