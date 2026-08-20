import { getSheetData } from './datastore'

/**
 * ¿A QUIÉN SE LE COBRA UNA FICHA DE CONVENIO? — fuente única.
 *
 * Por defecto, una ficha que llega por un veterinario NO se le boletea al tutor:
 * queda esperando la FACTURA que se le emite al veterinario a fin de mes
 * (lib/facturacion-vets → propuesta del mes).
 *
 * Hay convenios que funcionan al revés: el veterinario solo DERIVA, y al tutor se
 * le cobra y se le boletea a él directamente. Ese es el flag `boleta_al_cliente`
 * de la ficha del veterinario (Bases → el vet → "Boleta al cliente").
 *
 * ⚠️ Antes esto no era un dato: se deducía de que el vet tuviera una COMISIÓN
 * activa (`reglaActivaDeVet`). Las dos cosas venían fusionadas y no se podía tener
 * una sin la otra. Hoy son independientes a propósito (dueño 2026-08-19):
 *
 *   · `boleta_al_cliente` decide A QUIÉN SE LE COBRA — es lo único que mira el
 *     emisor de boletas y la propuesta de facturación mensual.
 *   · la comisión decide SI ADEMÁS LE PAGAMOS ALGO por haber derivado, y se
 *     devenga tenga o no este flag (ver lib/comisiones.ts).
 *
 * Las dos lecturas tienen que salir de acá: si el emisor de boletas y la propuesta
 * del mes se desalinean, al veterinario se le factura un servicio que ya se le
 * boleteó al tutor — el mismo servicio cobrado dos veces.
 */

/** ¿A este veterinario se le boletea al TUTOR en vez de facturarle a él? */
export function boletaAlCliente(vet: Record<string, string> | undefined | null): boolean {
  return String(vet?.boleta_al_cliente ?? '').toUpperCase() === 'TRUE'
}

/** Ids de los veterinarios a los que se les boletea al tutor. */
export async function vetsConBoletaAlCliente(): Promise<Set<string>> {
  const vets = await getSheetData('veterinarios').catch(() => [] as Record<string, string>[])
  return new Set(vets.filter(boletaAlCliente).map(v => String(v.id)))
}

/**
 * Lo mismo pero por id, para los llamadores que solo tienen el `veterinaria_id` de
 * la ficha. Un id vacío responde `false`: sin veterinario no hay convenio que
 * decidir (esa ficha es venta directa y se boletea igual, por otro camino).
 */
export async function vetBoleteaAlCliente(veterinariaId: string): Promise<boolean> {
  const vid = String(veterinariaId || '').trim()
  if (!vid) return false
  const vets = await getSheetData('veterinarios').catch(() => [] as Record<string, string>[])
  return boletaAlCliente(vets.find(v => String(v.id) === vid))
}
