import { getSheetData } from './google-sheets'

/**
 * Genera un código único para un cliente nuevo del estilo "G64-CI".
 *
 * Antes usaba `clientes.length + 1` lo cual rompía si se eliminaba un cliente
 * intermedio o si algún registro tenía `letra_especie` vacío pero código con
 * la misma letra: el conteo bajaba y se generaba un código duplicado.
 *
 * Ahora busca el número MÁXIMO ya usado en cualquier código que arranque con
 * la letra (independiente del campo letra_especie) y suma 1. Robusto contra
 * eliminaciones, cambios de especie y registros con letra_especie ausente.
 */
export async function generarCodigo(
  letraEspecie: string,
  codigoServicio: string
): Promise<string> {
  const clientes = await getSheetData('clientes')
  const re = new RegExp(`^${letraEspecie}(\\d+)`, 'i')
  let maxNum = 0
  for (const c of clientes) {
    const match = c.codigo?.match(re)
    if (!match) continue
    const n = parseInt(match[1], 10)
    if (Number.isFinite(n) && n > maxNum) maxNum = n
  }
  const numero = maxNum + 1
  const numStr = String(numero).padStart(2, '0')
  return `${letraEspecie}${numStr}-${codigoServicio}`
}
