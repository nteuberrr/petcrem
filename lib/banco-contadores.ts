import { getSupabase } from './supabase'

/**
 * Contador persistente y MONOTÓNICO para los códigos del banco (i-N / C-X / C-X.Y /
 * v-N / ai-N). NUNCA reutiliza un número aunque se borren imágenes o videos: guarda
 * el "high-water mark" por `clave` en la tabla `banco_contadores` y solo crece.
 *
 * Es atómico: la función Postgres `next_banco_contador` hace un INSERT .. ON CONFLICT
 * .. RETURNING que serializa por fila, así que dos generaciones concurrentes obtienen
 * números distintos (a diferencia del viejo max(existentes)+1, que reutilizaba el
 * número de una imagen recién borrada).
 *
 * `minimo` = mayor número ya presente en los datos actuales; se pasa para que el
 * contador se auto-sincronice si quedara atrás (p. ej. datos importados sin pasar por
 * acá). Si la RPC fallara (función ausente), degrada a `minimo + 1` — el
 * comportamiento histórico — para no romper el registro de imágenes/videos.
 *
 * Claves usadas: `img:i` (fotos sueltas) · `img:C` (nº de campaña) ·
 * `img:C-<X>` (índice .Y dentro de la campaña X) · `vid:v` · `vid:ai`.
 */
export async function nextContador(clave: string, minimo = 0): Promise<number> {
  const min = Math.max(0, Math.floor(minimo) || 0)
  try {
    const { data, error } = await getSupabase().rpc('next_banco_contador', { p_clave: clave, p_min: min })
    if (error) throw new Error(error.message)
    const n = Number(data)
    if (Number.isFinite(n) && n > 0) return n
  } catch (e) {
    console.warn(`[banco-contadores] fallback max+1 para "${clave}":`, e instanceof Error ? e.message : e)
  }
  return min + 1
}
