/**
 * RUT chileno: limpieza, dígito verificador y formato.
 *
 * Lo usa la ficha del empleado en Remuneraciones (un RUT mal tipeado se arrastra
 * a la liquidación y a la declaración de cotizaciones).
 */

/** Deja solo dígitos y el DV en mayúscula: "19.381.790-4" → "193817904". */
export function limpiarRut(raw: string | undefined | null): string {
  return String(raw || '').replace(/[^0-9kK]/g, '').toUpperCase()
}

/** Dígito verificador que le corresponde al número (módulo 11). */
export function calcularDv(numero: string): string {
  let suma = 0
  let multiplicador = 2
  for (let i = numero.length - 1; i >= 0; i--) {
    suma += parseInt(numero[i], 10) * multiplicador
    multiplicador = multiplicador === 7 ? 2 : multiplicador + 1
  }
  const resto = 11 - (suma % 11)
  if (resto === 11) return '0'
  if (resto === 10) return 'K'
  return String(resto)
}

/** True si el RUT es válido (largo razonable y DV correcto). */
export function validarRut(raw: string | undefined | null): boolean {
  const limpio = limpiarRut(raw)
  if (limpio.length < 8 || limpio.length > 9) return false
  const numero = limpio.slice(0, -1)
  const dv = limpio.slice(-1)
  if (!/^\d+$/.test(numero)) return false
  return calcularDv(numero) === dv
}

/** Formatea con puntos y guion: "193817904" → "19.381.790-4". */
export function formatearRut(raw: string | undefined | null): string {
  const limpio = limpiarRut(raw)
  if (limpio.length < 2) return limpio
  const numero = limpio.slice(0, -1)
  const dv = limpio.slice(-1)
  return `${numero.replace(/\B(?=(\d{3})+(?!\d))/g, '.')}-${dv}`
}

/** Número sin DV ni puntos, para los archivos previsionales. */
export function rutSinDv(raw: string | undefined | null): string {
  return limpiarRut(raw).slice(0, -1)
}

/** Solo el dígito verificador. */
export function dvDeRut(raw: string | undefined | null): string {
  return limpiarRut(raw).slice(-1)
}
