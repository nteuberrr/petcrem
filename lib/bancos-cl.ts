/**
 * Bancos chilenos comunes y tipos de cuenta disponibles. Lista para el form
 * público de datos de pago del vet. No es exhaustiva — agregamos según
 * usuarios que registren bancos no incluidos.
 */

export const BANCOS_CL: readonly string[] = [
  'Banco BCI',
  'Banco BICE',
  'Banco Consorcio',
  'Banco de Chile / Edwards / CrediChile',
  'Banco Falabella',
  'Banco Internacional',
  'Banco Itaú',
  'Banco Ripley',
  'Banco Santander',
  'Banco Security',
  'BancoEstado',
  'Coopeuch',
  'HSBC',
  'MercadoPago',
  'Scotiabank',
  'Tenpo',
  'Tapp Caja Los Andes',
  'Mach',
  'Otro',
] as const

export const TIPOS_CUENTA: readonly string[] = [
  'Cuenta Corriente',
  'Cuenta Vista',
  'Cuenta de Ahorros',
  'Cuenta RUT',
  'Chequera Electrónica',
] as const

export function bancoValido(b: string): boolean {
  return BANCOS_CL.includes(b)
}

export function tipoCuentaValido(t: string): boolean {
  return TIPOS_CUENTA.includes(t)
}
