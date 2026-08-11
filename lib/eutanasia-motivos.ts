/**
 * POR QUÉ no se realizó una eutanasia ya agendada.
 *
 * Las tres salidas existían pero repartidas en botones distintos ("No se
 * realizó" y "Servicio cancelado"), y la diferencia entre ellas —quién cobra y
 * qué pasa con la cremación— no estaba a la vista al momento de decidir. Acá
 * viven el catálogo y sus consecuencias, en un módulo SIN imports de servidor
 * para que lo compartan el modal (cliente) y el cierre del caso (servidor,
 * lib/eutanasia-resultado).
 */

export type MotivoNoRealizada = 'cancelado' | 'vet_no_realizo' | 'mascota_fallecio'

export interface OpcionNoRealizada {
  valor: MotivoNoRealizada
  titulo: string
  resumen: string
  /** Consecuencias, en el mismo orden en las tres opciones para poder compararlas. */
  vet: string
  cremacion: string
  tutor: string
  /** Texto que queda registrado en las notas de la cotización. */
  nota: string
}

export const MOTIVOS_NO_REALIZADA: OpcionNoRealizada[] = [
  {
    valor: 'cancelado',
    titulo: 'Se canceló',
    resumen: 'La familia dio marcha atrás: no hay eutanasia ni cremación.',
    vet: 'No se le paga nada.',
    cremacion: 'Se cancela. Si la ficha sigue en borrador, se elimina y sale de la agenda.',
    tutor: 'No se le cobra nada.',
    nota: 'Servicio cancelado: no se realiza la eutanasia ni la cremación.',
  },
  {
    valor: 'vet_no_realizo',
    titulo: 'El veterinario decidió no realizarla',
    resumen: 'Fue a domicilio, evaluó y no correspondía. La mascota sigue viva.',
    vet: 'Se le paga la consulta (monto fijo).',
    cremacion: 'No hay: se elimina el borrador de la ficha.',
    tutor: 'Se le cobra la consulta.',
    nota: 'El veterinario evaluó a domicilio y no correspondía realizar la eutanasia.',
  },
  {
    valor: 'mascota_fallecio',
    titulo: 'La mascota falleció antes',
    resumen: 'El veterinario no alcanzó a ir, pero la cremación sigue.',
    vet: 'No se le paga (no llegó a asistir).',
    cremacion: 'Sigue activa: la ficha queda abierta y el retiro, en la agenda.',
    tutor: 'No se le cobra la eutanasia (sí la cremación).',
    nota: 'La mascota falleció antes de la visita: la eutanasia no se realizó y sigue solo la cremación.',
  },
]

export function esMotivoNoRealizada(v: unknown): v is MotivoNoRealizada {
  return MOTIVOS_NO_REALIZADA.some(m => m.valor === v)
}

export function opcionNoRealizada(motivo: MotivoNoRealizada): OpcionNoRealizada {
  return MOTIVOS_NO_REALIZADA.find(m => m.valor === motivo) ?? MOTIVOS_NO_REALIZADA[1]
}
