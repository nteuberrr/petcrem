import { getSheetData } from './datastore'
import { formatDate, formatDateForSheet, fechaChileISO } from './dates'
import { nombreCompletoVet } from './eutanasia-mailer'

/**
 * Lo que el agente necesita saber cuando quien escribe es un VETERINARIO.
 *
 * Por qué existe (dueño 2026-08-18): la coordinación de eutanasias dejaba la
 * conversación del vet PAUSADA para siempre, con la idea de que el bot de tutores
 * no le contestara cotizaciones de cremación. El efecto colateral fue peor que el
 * problema: cuando esa misma veterinaria nos escribía días después para agendar
 * un retiro de su clínica, el agente estaba mudo y el retiro no se agendaba (caso
 * Daniella). Ahora la conversación queda VIVA y en su lugar se le dice al agente
 * quién le está hablando, para que entre directo en MODO VETERINARIO en vez de
 * saludar con un pésame y cotizar precios que a un convenio no le corresponden.
 *
 * Va en la parte DINÁMICA del system (después del prefijo cacheado), igual que
 * `bloqueFichaEnProceso`: son pocos vets y el prefijo caro no se toca.
 */

const tel9 = (s?: string) => (s || '').replace(/\D/g, '').slice(-9)

const ACTIVO = (v?: string) => (v ?? '').toUpperCase() !== 'FALSE'

export async function bloqueVeterinario(waId: string): Promise<string> {
  const t = tel9(waId)
  if (t.length !== 9) return ''

  const [vets, vetsEut] = await Promise.all([
    getSheetData('veterinarios').catch(() => [] as Record<string, string>[]),
    getSheetData('vet_convenio_eutanasia').catch(() => [] as Record<string, string>[]),
  ])
  const convenio = vets.find(v => tel9(v.telefono) === t && ACTIVO(v.activo))
  const red = vetsEut.find(v => tel9(v.telefono) === t && ACTIVO(v.activo))
  if (!convenio && !red) return ''

  // nombreCompletoVet y no un join a mano: en la red de eutanasias varios tienen
  // el apellido repetido dentro de `nombre` ("Camila Gómez Barría" + "Gómez
  // Barría") y quedaba duplicado.
  const nombre = convenio?.nombre || nombreCompletoVet(red?.nombre, red?.apellido)
  const lineas: string[] = [
    `QUIEN TE ESCRIBE ES UN VETERINARIO DE NUESTRA RED${nombre ? `: ${nombre}` : ''}. No es un tutor en duelo.`,
    'Aplica MODO VETERINARIO desde el PRIMER mensaje: nada de pésame, nada de precios de cremación (su convenio tiene tarifas propias que no debes decir) y nada de ofrecer eutanasia a domicilio.',
  ]

  if (convenio) {
    lineas.push(
      `Está en la base del convenio de CREMACIÓN como «${convenio.nombre}». Si quiere agendar el retiro de una mascota desde su clínica, reúne los datos y llama "solicitar_retiro_vet" pasando exactamente ese nombre en veterinaria_nombre.`,
    )
  } else {
    lineas.push(
      'Pertenece a la red de EUTANASIAS A DOMICILIO. Si quiere agendar el retiro de una mascota desde su clínica igual intenta "solicitar_retiro_vet" con el nombre de su clínica: si no está en la base del convenio de cremación, la herramienta te lo dirá y ahí sí escalas.',
    )
  }

  // Eutanasias vivas de ESTE vet: ese hilo lo maneja el sistema (botones de la
  // plantilla + links firmados del correo), no el agente. Si el agente improvisa
  // ahí, contradice al flujo que sí mueve la agenda y el pago.
  if (red) {
    try {
      const cotis = await getSheetData('cotizaciones_eutanasia').catch(() => [] as Record<string, string>[])
      // Solo lo que está VIVO (hoy o más adelante): una eutanasia vieja que nunca
      // se cerró no puede quedar condicionando sus conversaciones para siempre.
      const desde = fechaChileISO()
      const asignada = cotis.find(c => String(c.vet_id_asignado) === String(red.id)
        && (c.estado || '') === 'aceptada'
        && (formatDateForSheet(c.fecha_servicio) || '') >= desde)
      if (asignada) {
        lineas.push(
          `Tiene ASIGNADA la eutanasia N° ${asignada.id} (${asignada.mascota_nombre || 'mascota'}, ${formatDate(asignada.fecha_servicio)}). ` +
          'Si te habla de ella —el día y la hora que acordó con la familia, el resultado de la visita, el pago—, NO lo resuelvas tú: usa "escalar_a_humano" con el detalle. El día y la hora se registran respondiendo por este mismo chat (el sistema los lee solo) o con el enlace del correo.',
        )
      } else if (cotis.some(c => (c.estado || '') === 'enviada' && (formatDateForSheet(c.fecha_servicio) || '') >= desde)) {
        lineas.push(
          'Puede tener una invitación de eutanasia abierta. Si responde sobre ella (que la toma o que no puede), dile breve que confirme con los botones del mensaje que le enviamos o con el enlace del correo, y usa "escalar_a_humano".',
        )
      }
    } catch { /* best-effort */ }
  }

  return lineas.join('\n- ').replace(/^/, '- ')
}
