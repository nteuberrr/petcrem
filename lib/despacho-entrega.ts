import { after } from 'next/server'
import { getSheetData, updateById, updateByIdIf } from './datastore'
import { publicarMemorialSiCorresponde } from './memorial'
import { enviarEntregaConfirmada } from './cliente-mailer'
import { resolverVet, enviarEntregaVet } from './vet-cremacion-mailer'
import { avisarClienteWhatsapp } from './whatsapp-avisos'
import { getContacto } from './email-layout'
import { marcarConversacionPorTelefono } from './mensajes'
import { todayISO } from './dates'

/**
 * ENTREGA DE UNA PARADA — el corazón del cierre de una ruta de despacho.
 *
 * Vive acá y no en el route handler porque hay DOS puertas que la disparan y
 * tienen que hacer exactamente lo mismo:
 *   · el equipo desde Operaciones → Despachos (`/api/despachos/[id]/entregar`), y
 *   · el repartidor externo desde la hoja de ruta compartida por link firmado
 *     (`/api/rutas/[token]`, ver [lib/ruta-token.ts](ruta-token.ts)).
 * Duplicar esto significaría que marcar entregado desde el celular del delivery
 * no mande el correo al tutor, o no publique la despedida: media entrega.
 *
 * Lo que hace al marcar entregada, todo best-effort salvo el registro:
 *   1. Anota la entrega en el blob `entregas` de la ruta (con su fecha/hora).
 *   2. Pasa la mascota a 'despachado' y la vincula al despacho.
 *   3. Correo de entrega + reseña al tutor, y WhatsApp con el link de evaluación.
 *   4. Correo al veterinario de convenio, si la ficha viene de uno.
 *   5. Cierra la conversación de WhatsApp del cliente.
 *   6. Publica la historia de despedida en Instagram si el tutor la autorizó.
 *
 * Concurrencia: `entregas` es un blob JSON compartido por toda la ruta. Dos
 * entregas casi simultáneas (el chofer y el delivery, o dos paradas seguidas)
 * harían read-modify-write y una se perdería. Se resuelve con concurrencia
 * optimista: cada intento condiciona el update a que `entregas` siga igual que
 * cuando lo leímos (updateByIdIf); si cambió, reintenta con la versión fresca.
 */

/**
 * Una entrega registrada. `fotos` (URLs en R2) son las que saca el repartidor al
 * momento de entregar: van DENTRO de la entrega y no en una columna aparte
 * porque son parte de ese hecho, y así el resto del sistema —que solo pregunta
 * "¿existe la entrada?" y lee `fecha_hora`— sigue funcionando igual.
 *
 * ⚠️ La entrada existe SOLO si la parada está entregada. Nada debe crearla
 * antes (p. ej. para colgarle una foto): media docena de lugares cuentan
 * entregas con `!!entregas[id]` y pasarían a contar de más.
 */
type Entregas = Record<string, { fecha_hora: string; fotos?: string[] }>

/** Tope de fotos por parada: suficiente para dejar constancia, no un álbum. */
export const MAX_FOTOS_ENTREGA = 5

/**
 * Copia las fotos de la entrega a la FICHA (`clientes.fotos_entrega`), que es el
 * archivo permanente de la mascota: la ruta se puede editar, reordenar o borrar
 * —y ahí se va el blob `entregas`— pero la constancia de la entrega tiene que
 * quedar. Se acumulan sin repetir.
 *
 * `updateByIdIf` con expectativa vacía escribe SOLO esta columna: no puede pisar
 * el resto de la ficha (ver el incidente de updateById que vació dos fichas).
 */
async function copiarFotosAFicha(clienteId: string, fotos: string[]): Promise<void> {
  if (!fotos.length) return
  const cliente = (await getSheetData('clientes')).find(c => String(c.id) === String(clienteId))
  if (!cliente) return
  let previas: string[] = []
  try {
    const x = JSON.parse(cliente.fotos_entrega || '[]')
    if (Array.isArray(x)) previas = x.filter(u => typeof u === 'string')
  } catch {}
  const todas = [...previas, ...fotos].filter((u, i, a) => a.indexOf(u) === i)
  if (todas.length === previas.length) return
  await updateByIdIf('clientes', String(clienteId), {}, { fotos_entrega: JSON.stringify(todas) })
}

export type ResultadoEntrega =
  | { ok: true; tipo: 'ya_entregada' }
  | { ok: true; tipo: 'entregada'; fecha_hora: string; ruta_terminada: boolean }
  | { ok: true; tipo: 'deshecha'; ruta_reabierta: boolean }
  | { ok: false; status: number; error: string }

const MAX_RETRY = 5

export async function registrarEntrega(
  despachoId: string,
  clienteId: string,
  opciones: { deshacer?: boolean; fotos?: string[] } = {},
): Promise<ResultadoEntrega> {
  const deshacer = opciones.deshacer === true
  const fotos = (opciones.fotos ?? []).filter(u => typeof u === 'string' && u.trim()).slice(0, MAX_FOTOS_ENTREGA)
  if (!clienteId) return { ok: false, status: 400, error: 'cliente_id requerido' }

  const now = new Date().toISOString()

  type Aplicado =
    | { tipo: 'ya_entregada' }
    | { tipo: 'entregada'; ruta_terminada: boolean }
    | { tipo: 'deshecha'; ruta_reabierta: boolean }
  let aplicado: Aplicado | null = null

  for (let intento = 0; intento < MAX_RETRY && !aplicado; intento++) {
    const rows = await getSheetData('despachos')
    const row = rows.find(r => r.id === despachoId)
    if (!row) return { ok: false, status: 404, error: 'Ruta no encontrada' }

    let mascotasIds: string[] = []
    try { mascotasIds = JSON.parse(row.mascotas_ids || '[]') } catch {}
    if (!mascotasIds.includes(clienteId)) {
      return { ok: false, status: 400, error: 'La mascota no pertenece a esta ruta' }
    }

    const entregasStr = row.entregas ?? ''  // string EXACTO almacenado (guarda optimista; puede ser '')
    let entregas: Entregas = {}
    try { entregas = JSON.parse(entregasStr || '{}') } catch {}

    const cambios: Record<string, string> = {}
    if (deshacer) {
      const nuevas = { ...entregas }
      delete nuevas[clienteId]
      cambios.entregas = JSON.stringify(nuevas)
      // Si la ruta se había cerrado sola, al deshacer ya no está completa: reabrir.
      const reabierta = row.estado_ruta === 'terminada'
      if (reabierta) {
        cambios.estado_ruta = 'en_curso'
        cambios.hora_termino_ruta = ''
        cambios.fecha_realizada = ''
      }
      const ok = await updateByIdIf('despachos', despachoId, { entregas: entregasStr }, cambios)
      if (ok) aplicado = { tipo: 'deshecha', ruta_reabierta: reabierta }
      continue
    }

    if (entregas[clienteId]) { aplicado = { tipo: 'ya_entregada' }; break }
    const nuevas: Entregas = {
      ...entregas,
      [clienteId]: { fecha_hora: now, ...(fotos.length ? { fotos } : {}) },
    }
    cambios.entregas = JSON.stringify(nuevas)

    // ¿Era la última? Si TODAS las paradas quedaron entregadas, cerramos la ruta.
    const todasEntregadas = mascotasIds.length > 0 && mascotasIds.every(mid => !!nuevas[mid])
    if (todasEntregadas) {
      cambios.estado_ruta = 'terminada'
      if (!row.hora_inicio_ruta) cambios.hora_inicio_ruta = now
      if (!row.hora_termino_ruta) cambios.hora_termino_ruta = now
      if (!row.fecha_realizada) cambios.fecha_realizada = todayISO()
    } else if (row.estado_ruta !== 'terminada' && row.estado_ruta !== 'en_curso') {
      cambios.estado_ruta = 'en_curso'
      if (!row.hora_inicio_ruta) cambios.hora_inicio_ruta = now
    }
    const ok = await updateByIdIf('despachos', despachoId, { entregas: entregasStr }, cambios)
    if (ok) aplicado = { tipo: 'entregada', ruta_terminada: todasEntregadas }
    // si !ok → otra entrega cambió el blob; reintentamos con datos frescos
  }

  if (!aplicado) {
    return { ok: false, status: 409, error: 'No se pudo registrar la entrega (conflicto de concurrencia). Reintenta.' }
  }
  if (aplicado.tipo === 'ya_entregada') return { ok: true, tipo: 'ya_entregada' }

  // Flip del cliente + correo: una sola vez, después de fijar el blob de entregas.
  const clientes = await getSheetData('clientes')
  const cliente = clientes.find(c => c.id === clienteId)

  if (aplicado.tipo === 'deshecha') {
    if (cliente && cliente.despacho_id === despachoId) {
      await updateById('clientes', clienteId, { ...cliente, estado: 'cremado', despacho_id: '' })
    }
    return { ok: true, tipo: 'deshecha', ruta_reabierta: aplicado.ruta_reabierta }
  }

  if (cliente) {
    // Las fotos de la entrega quedan también en la ficha (registro permanente).
    // Van en este mismo write para no hacer dos vueltas a la base.
    let fotosFicha: string[] = []
    try {
      const x = JSON.parse(cliente.fotos_entrega || '[]')
      if (Array.isArray(x)) fotosFicha = x.filter((u: unknown) => typeof u === 'string')
    } catch {}
    const fotosTodas = [...fotosFicha, ...fotos].filter((u, i, a) => a.indexOf(u) === i)
    await updateById('clientes', clienteId, {
      ...cliente,
      estado: 'despachado',
      despacho_id: despachoId,
      ...(fotos.length ? { fotos_entrega: JSON.stringify(fotosTodas) } : {}),
    })
    // Correo de entrega + reseña al tutor (best-effort).
    try {
      await enviarEntregaConfirmada({
        email: cliente.email,
        nombreMascota: cliente.nombre_mascota,
        nombreTutor: cliente.nombre_tutor,
        codigo: cliente.codigo,
        clienteId: cliente.id,
        // Clientes marcados "no pedir evaluación" reciben la entrega SIN el pedido de reseña.
        sinEvaluacion: String(cliente.omitir_evaluacion || '').toUpperCase() === 'TRUE',
      })
    } catch (e) {
      console.warn('[despacho-entrega] fallo correo entrega (no bloqueante):', e)
    }
    // WhatsApp al tutor con el link "Evalúanos aquí" (el mismo del correo).
    // Texto libre primero (gratis); con la ventana de 24h cerrada —lo habitual
    // en la entrega, que suele llegar 72h+ después del último contacto— cae a
    // la plantilla aprobada `evaluacion_entrega`. Si la ficha está marcada
    // "no pedir evaluación" (omitir_evaluacion) NO se envía ningún WhatsApp.
    try {
      const sinEvaluacion = String(cliente.omitir_evaluacion || '').toUpperCase() === 'TRUE'
      const reviewUrl = sinEvaluacion ? '' : (await getContacto()).googleReviewUrl
      if (!sinEvaluacion && reviewUrl && cliente.telefono) {
        const tutor = (cliente.nombre_tutor || '').trim().split(/\s+/)[0] || '👋'
        const mascota = cliente.nombre_mascota || 'tu mascota'
        await avisarClienteWhatsapp(
          cliente.telefono,
          `Hola ${tutor}, ya entregamos el ánfora de ${mascota}. Fue un honor acompañarte en este proceso. Si quieres, puedes dejarnos tu evaluación aquí: ${reviewUrl} — te toma menos de un minuto y nos ayuda muchísimo. Gracias por confiar en Crematorio Alma Animal.`,
          { nombre: 'evaluacion_entrega', variables: [tutor, mascota, reviewUrl] },
        )
      }
    } catch (e) {
      console.warn('[despacho-entrega] fallo WhatsApp evaluación (no bloqueante):', e)
    }
    // Y al veterinario de convenio asociado, si lo hay (best-effort).
    try {
      const vet = await resolverVet(cliente.veterinaria_id)
      if (vet) await enviarEntregaVet({ ...vet, nombreMascota: cliente.nombre_mascota, codigo: cliente.codigo })
    } catch (e) {
      console.warn('[despacho-entrega] fallo correo entrega al vet (no bloqueante):', e)
    }
    // Con la ENTREGA se cierra el negocio → su conversación de WhatsApp pasa a
    // 'cerrado' (cliente histórico). No pisa una conversación de veterinario.
    try {
      await marcarConversacionPorTelefono(cliente.telefono || '', 'cerrado', { soloSi: ['activo', 'cliente', 'archivado'] })
    } catch (e) { console.warn('[despacho-entrega] no se pudo cerrar la conversación:', e) }

    // HISTORIA DE DESPEDIDA en Instagram. Se dispara acá porque la ENTREGA es
    // la segunda de las dos condiciones (la otra es el consentimiento del
    // tutor al subir la foto). El helper revalida ambas contra la ficha fresca
    // y no hace nada si falta alguna. Best-effort y en segundo plano: renderiza
    // y sube a Meta, así que no puede demorar la respuesta al chofer.
    // Sin aviso por WhatsApp (decisión del dueño 2026-08-06): la publicación es
    // silenciosa. Queda el rastro en la ficha (`memorial_publicado_at`,
    // `memorial_story_id`, `memorial_plantilla`) y en el log del servidor. Ojo:
    // la destacada "Despedidas" se sigue fijando A MANO —Instagram no lo permite
    // por API— y ahora nada lo recuerda, así que hay que mirar las historias.
    after(async () => {
      const r = await publicarMemorialSiCorresponde(clienteId)
      console.log(r.ok
        ? `[despacho-entrega] historia de despedida publicada (${clienteId}): ${r.plantilla} · ${r.storyId}`
        : `[despacho-entrega] sin historia de despedida (${clienteId}): ${r.motivo}`)
    })
  }

  return { ok: true, tipo: 'entregada', fecha_hora: now, ruta_terminada: aplicado.ruta_terminada }
}

/**
 * Suma fotos a una parada YA entregada (el repartidor sacó otra después de
 * marcar). No re-dispara nada: la entrega ya avisó al tutor.
 *
 * Misma concurrencia optimista que `registrarEntrega` — el blob es compartido
 * por toda la ruta, así que se reintenta si alguien lo movió mientras tanto.
 */
export async function adjuntarFotosEntrega(
  despachoId: string,
  clienteId: string,
  fotos: string[],
): Promise<{ ok: true; fotos: string[] } | { ok: false; status: number; error: string }> {
  const nuevas = fotos.filter(u => typeof u === 'string' && u.trim())
  if (!clienteId) return { ok: false, status: 400, error: 'cliente_id requerido' }
  if (nuevas.length === 0) return { ok: false, status: 400, error: 'No hay fotos que adjuntar' }

  for (let intento = 0; intento < MAX_RETRY; intento++) {
    const rows = await getSheetData('despachos')
    const row = rows.find(r => r.id === despachoId)
    if (!row) return { ok: false, status: 404, error: 'Ruta no encontrada' }

    const entregasStr = row.entregas ?? ''
    let entregas: Entregas = {}
    try { entregas = JSON.parse(entregasStr || '{}') } catch {}

    const actual = entregas[clienteId]
    if (!actual) return { ok: false, status: 400, error: 'La parada todavía no está entregada' }

    const combinadas = [...(actual.fotos ?? []), ...nuevas]
      .filter((u, i, a) => a.indexOf(u) === i)
      .slice(0, MAX_FOTOS_ENTREGA)
    const blob: Entregas = { ...entregas, [clienteId]: { ...actual, fotos: combinadas } }

    const ok = await updateByIdIf('despachos', despachoId, { entregas: entregasStr }, { entregas: JSON.stringify(blob) })
    if (ok) {
      // Y a la ficha, que es donde queda el registro para siempre (best-effort:
      // la foto ya está guardada en la ruta, esto es la copia al archivo).
      try { await copiarFotosAFicha(clienteId, nuevas) }
      catch (e) { console.warn('[despacho-entrega] no se pudo copiar la foto a la ficha:', e) }
      return { ok: true, fotos: combinadas }
    }
  }
  return { ok: false, status: 409, error: 'No se pudo guardar la foto (conflicto). Reintenta.' }
}
