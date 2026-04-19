import { getSheetData } from './google-sheets'

export async function generarCodigo(
  letraEspecie: string,
  codigoServicio: string
): Promise<string> {
  const clientes = await getSheetData('clientes')
  const mismaEspecie = clientes.filter((c) => c.letra_especie === letraEspecie)
  const numero = mismaEspecie.length + 1
  const numStr = numero < 10 ? `0${numero}` : String(numero)
  return `${letraEspecie}${numStr}-${codigoServicio}`
}
