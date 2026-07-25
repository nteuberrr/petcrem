/**
 * Origen de la ficha: por dónde llegó el cliente. Fuente ÚNICA de los valores que
 * viven en `clientes.origen`.
 *
 * Para qué: hoy el costo publicitario por ficha es un promedio de TODO el negocio
 * (Google, veterinarias, recomendación, orgánico), así que no se puede saber cuánto
 * cuesta de verdad traer un cliente por cada canal ni decidir presupuesto con datos.
 * Con este campo, `inversión del canal ÷ fichas de ese canal` pasa a ser un número real.
 *
 * Los valores `bot_*` los escribe el sistema solo (lib/cliente-borrador) cuando la
 * ficha nace de una conversación del agente de WhatsApp; el resto los elige el
 * equipo al registrar la ficha.
 */

export interface OrigenCliente { valor: string; label: string; auto?: boolean }

export const ORIGENES: OrigenCliente[] = [
  { valor: 'google', label: 'Google (buscando)' },
  { valor: 'instagram', label: 'Instagram' },
  { valor: 'facebook', label: 'Facebook' },
  { valor: 'recomendacion', label: 'Recomendación de un conocido' },
  { valor: 'veterinaria', label: 'Veterinaria / clínica' },
  { valor: 'cliente_anterior', label: 'Ya era cliente' },
  { valor: 'otro', label: 'Otro' },
  // Los pone el sistema, no el equipo: se muestran pero no se ofrecen en el select.
  { valor: 'bot_retiro', label: 'WhatsApp (agente)', auto: true },
  { valor: 'bot_eutanasia', label: 'WhatsApp (agente · eutanasia)', auto: true },
  { valor: 'bot_vet', label: 'WhatsApp (agente · veterinario)', auto: true },
]

/** Los que el equipo puede elegir a mano (excluye los automáticos del bot). */
export const ORIGENES_MANUALES = ORIGENES.filter(o => !o.auto)

/** Etiqueta legible de un valor guardado ('' → '—'). */
export function labelOrigen(valor: string | undefined | null): string {
  const v = (valor || '').trim()
  if (!v) return '—'
  return ORIGENES.find(o => o.valor === v)?.label || v
}
