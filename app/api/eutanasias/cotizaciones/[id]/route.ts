import { NextRequest, NextResponse } from 'next/server'
import { getSheetData, updateById, deleteRow } from '@/lib/datastore'
import { sesionConAcceso } from '@/lib/permisos-server'
import { precioParaPeso } from '@/lib/eutanasia-matcher'
import { parsePeso } from '@/lib/numbers'
import { enviarCoordinarConFamilia, enviarClienteVetAsignado, enviarVetEutanasiaCancelada, nombreCompletoVet } from '@/lib/eutanasia-mailer'
import { avisarClienteVetConfirmado } from '@/lib/eutanasia-avisos'
import { formatDate } from '@/lib/dates'
import { crearClienteBorrador } from '@/lib/cliente-borrador'
import { camposResultado, efectosResultado, esResultado, cancelarEutanasiaConservandoFicha } from '@/lib/eutanasia-resultado'
import { sincronizarFichaDeEutanasia, horaRetiroDeEutanasia } from '@/lib/eutanasia-sync'

const SHEET = 'cotizaciones_eutanasia'

async function requireAdmin(metodo: string) {
  const { ok } = await sesionConAcceso('/api/eutanasias', metodo)
  if (!ok) return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
  return null
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireAdmin('GET')
  if (denied) return denied
  void req
  try {
    const { id } = await params
    const rows = await getSheetData(SHEET)
    const found = rows.find(r => r.id === id)
    if (!found) return NextResponse.json({ error: 'No encontrado' }, { status: 404 })
    return NextResponse.json(found)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

const CAMPOS_EDITABLES = [
  'mascota_nombre', 'especie', 'peso',
  'cliente_nombre', 'cliente_telefono', 'cliente_email',
  'direccion', 'comuna',
  'fecha_servicio', 'hora_servicio',
  'notas',
  'estado',
  // estado de pago (aplicable cuando estado=realizada): pendiente_pago | pago_confirmado
  'estado_pago',
] as const

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireAdmin('PATCH')
  if (denied) return denied
  try {
    const { id } = await params
    const body = await req.json()
    const rows = await getSheetData(SHEET)
    const idx = rows.findIndex(r => r.id === id)
    if (idx === -1) return NextResponse.json({ error: 'No encontrado' }, { status: 404 })

    // SERVICIO CANCELADO: la tercera salida del bloque de resultado, la misma
    // que la ficha del dashboard (sin pago al vet ni cobro al tutor, la ficha de
    // cremación sigue viva y el retiro pendiente vuelve a la agenda). No es lo
    // mismo que el "Cancelar" de la cotización, que solo la cierra.
    if (body?.accion === 'cancelar_servicio') {
      const r = await cancelarEutanasiaConservandoFicha(String(id), {
        motivo: typeof body?.motivo === 'string' ? body.motivo : undefined,
      })
      if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
      return NextResponse.json(r.cotizacion)
    }

    const partial: Record<string, string> = {}
    for (const campo of CAMPOS_EDITABLES) {
      if (campo in body) partial[campo] = String(body[campo] ?? '')
    }
    // Teléfono siempre en formato de 9 dígitos (los correos anteponen "+56 ").
    if (partial.cliente_telefono) partial.cliente_telefono = partial.cliente_telefono.replace(/\D/g, '').slice(-9)

    // Vet a notificar con el correo "coordina con la familia" si esta edición
    // asigna un vet NUEVO (se resuelve más abajo, se envía tras persistir).
    let vetParaCoordinar: Record<string, string> | null = null

    // Asignación manual de vet (cambio o asignación inicial).
    // - Si viene vet_id_asignado con valor → buscamos el vet, lo asignamos,
    //   estado pasa a 'aceptada' (si no estaba 'realizada'/'cancelada'),
    //   y completamos los timestamps que falten.
    // - Si viene vet_id_asignado como '' (vacío explícito) → se desasigna y
    //   el estado vuelve a 'enviada' (asume que ya se había enviado al menos
    //   a alguien). Si no se había enviado, queda 'creada'.
    if ('vet_id_asignado' in body) {
      const ahora = new Date().toISOString()
      const nuevoVetId = String(body.vet_id_asignado ?? '')
      if (nuevoVetId) {
        const vets = await getSheetData('vet_convenio_eutanasia')
        const v = vets.find(r => r.id === nuevoVetId)
        if (!v) return NextResponse.json({ error: 'Veterinario no existe' }, { status: 400 })
        partial.vet_id_asignado = v.id
        partial.vet_nombre_asignado = `${v.nombre || ''} ${v.apellido || ''}`.trim()
        partial.vet_email_asignado = v.email
        const estadoActual = partial.estado ?? rows[idx].estado
        if (estadoActual !== 'realizada' && estadoActual !== 'cancelada') {
          // El vet asignado = aceptó: queda 'aceptada' y recibe el correo de
          // "coordina con la familia" (con los botones realizada/no realizada).
          partial.estado = 'aceptada'
          if (!rows[idx].fecha_aceptacion) partial.fecha_aceptacion = ahora
          // Solo notificamos si es una asignación NUEVA (cambió el vet), para no
          // reenviar correos al re-guardar la ficha con el mismo vet.
          if (nuevoVetId !== (rows[idx].vet_id_asignado || '')) vetParaCoordinar = v
        }
      } else {
        // Desasignar
        partial.vet_id_asignado = ''
        partial.vet_nombre_asignado = ''
        partial.vet_email_asignado = ''
        const estadoActual = partial.estado ?? rows[idx].estado
        if (estadoActual === 'aceptada') {
          // Volvemos al estado previo razonable
          partial.estado = rows[idx].fecha_envio_cotizacion ? 'enviada' : 'creada'
        }
      }
    }

    // Cierre con resultado (realizada / no realizada): fecha de cierre, estado de
    // pago y snapshot de la consulta. Misma regla que la ficha del dashboard.
    if (esResultado(partial.estado)) {
      Object.assign(partial, await camposResultado(rows[idx], partial.estado, partial))
    }
    if (partial.estado === 'cancelada' && !rows[idx].fecha_cancelacion) {
      partial.fecha_cancelacion = new Date().toISOString()
      // Cancelar NO genera pago al veterinario ni cobro al tutor: si la
      // cotización venía de un cierre con resultado, se limpian esos campos para
      // que no quede un pago fantasma en la lista de pendientes.
      partial.estado_pago = ''
      partial.fecha_realizacion = ''
      partial.consulta_vet_snapshot = ''
    }
    // Al marcar pago_confirmado sellamos fecha_pago si no estaba.
    if (partial.estado_pago === 'pago_confirmado' && !rows[idx].fecha_pago) {
      partial.fecha_pago = new Date().toISOString()
    }

    // Si se corrige el PESO y la cotización aún no está comprometida con un vet
    // (creada/enviada), recalculamos precio_snapshot (lo que se le paga al vet) con
    // la MISMA tabla y regla que al crearla. Una vez aceptada/realizada, el
    // precio queda congelado (el vet ya aceptó ese monto).
    if ('peso' in body && partial.peso !== rows[idx].peso) {
      const estadoActual = partial.estado ?? rows[idx].estado
      if (!['aceptada', 'realizada', 'no_realizada', 'cancelada'].includes(estadoActual)) {
        const tramos = await getSheetData('precios_eutanasia')
        partial.precio_snapshot = String(precioParaPeso(tramos, parsePeso(partial.peso)))
      }
    }

    // ── Toggle "¿incluye cremación?" ────────────────────────────────────────
    // Además del flag, gestiona la ficha de cremación (borrador) para que el
    // chofer tenga o no algo que retirar. Aviso al frontend si conservó una ficha.
    let avisoToggle: string | undefined
    if ('incluye_cremacion' in body) {
      const quiere = body.incluye_cremacion === true || String(body.incluye_cremacion).toUpperCase() === 'TRUE'
      partial.incluye_cremacion = quiere ? 'TRUE' : 'FALSE'
      const c = rows[idx]
      const clienteIdActual = c.cliente_id || ''
      if (quiere) {
        // Pasa a CON cremación → asegurar ficha borrador (si no tiene una).
        if (!clienteIdActual) {
          try {
            const tipo = (c.tipo_servicio_cremacion || '').toUpperCase()
            const borradorId = await crearClienteBorrador({
              nombre_tutor: c.cliente_nombre,
              nombre_mascota: c.mascota_nombre,
              telefono: c.cliente_wa_id || c.cliente_telefono,
              email: c.cliente_email,
              direccion_retiro: c.direccion,
              comuna: c.comuna,
              peso_declarado: c.peso,
              codigo_servicio: ['CI', 'CP', 'SD'].includes(tipo) ? tipo : '',
              origen: 'bot_eutanasia',
              notas: `Cremación tras eutanasia a domicilio (cotización N° ${id}).`,
            })
            if (borradorId) partial.cliente_id = borradorId
          } catch (e) { console.warn('[cotizaciones PATCH] no se pudo crear borrador al activar cremación:', e) }
        }
      } else if (clienteIdActual) {
        // Pasa a SIN cremación → si la ficha aún es borrador, se elimina; si ya
        // está registrada (con código / en proceso), se conserva y se avisa.
        try {
          const clientes = await getSheetData('clientes')
          const ci = clientes.findIndex(r => String(r.id) === String(clienteIdActual))
          if (ci === -1) {
            partial.cliente_id = ''
          } else if ((clientes[ci].estado || '') === 'borrador') {
            await deleteRow('clientes', ci)
            partial.cliente_id = ''
          } else {
            avisoToggle = `La eutanasia quedó SIN cremación, pero su ficha de cremación${clientes[ci].codigo ? ` ${clientes[ci].codigo}` : ''} ya estaba registrada: se conservó. Elimínala a mano si corresponde.`
          }
        } catch (e) { console.warn('[cotizaciones PATCH] no se pudo procesar la ficha al desactivar cremación:', e) }
      }
    }

    // Si cambió la HORA del procedimiento, la hora del retiro del crematorio la
    // sigue (procedimiento + 30 min) — pero solo si el vet ya la había informado:
    // mientras esté en blanco, la agenda muestra la hora del servicio a propósito.
    if (partial.hora_servicio && partial.hora_servicio !== rows[idx].hora_servicio && rows[idx].hora_retiro_crematorio) {
      partial.hora_retiro_crematorio = horaRetiroDeEutanasia(partial.hora_servicio) || partial.hora_servicio
    }

    const updated = { ...rows[idx], ...partial }
    await updateById(SHEET, id, updated)

    // La ficha de cremación de esta eutanasia tiene que quedar el MISMO día/hora:
    // la agenda lee la cotización y el resto del sistema lee la ficha, así que si
    // se separan el calendario muestra una cosa y el chofer otra (caso Mila, 30-07).
    if (partial.fecha_servicio || partial.hora_servicio || partial.hora_retiro_crematorio) {
      await sincronizarFichaDeEutanasia(updated)
    }

    // ── Efectos de correo (best-effort, tras persistir) ──────────────────────
    const baseUrl = (process.env.PUBLIC_APP_URL || process.env.NEXTAUTH_URL || '').replace(/\/+$/, '')

    // Asignación manual de un vet NUEVO → coordinar (vet) + aviso (cliente).
    if (vetParaCoordinar) {
      await enviarCoordinarConFamilia({ c: updated, vet: vetParaCoordinar, baseUrl })
      // Mismo aviso por WhatsApp que cuando el vet acepta desde el link del
      // correo: al tutor le da igual por qué camino se asignó, y este path no le
      // avisaba nada (solo correo).
      await avisarClienteVetConfirmado({
        c: updated,
        vetNombre: updated.vet_nombre_asignado || nombreCompletoVet(vetParaCoordinar.nombre, vetParaCoordinar.apellido),
        vetTelefono: vetParaCoordinar.telefono,
        baseUrl,
        vetId: vetParaCoordinar.id,
      })
      if (updated.cliente_email) {
        try {
          await enviarClienteVetAsignado({
            clienteEmail: updated.cliente_email,
            clienteNombre: updated.cliente_nombre,
            mascotaNombre: updated.mascota_nombre,
            vetNombre: updated.vet_nombre_asignado,
            vetTelefono: vetParaCoordinar.telefono || '',
            fechaServicio: formatDate(updated.fecha_servicio),
            horaServicio: updated.hora_servicio,
          })
        } catch (e) { console.warn('[cotizaciones PATCH] correo al cliente falló:', e) }
      }
    }

    // Cierre con resultado → agradecimiento al tutor (realizada) o borrado del
    // borrador + aviso de pago de consulta al vet (no realizada). Best-effort y
    // guardado contra reenvíos (solo si el estado cambió).
    if (esResultado(partial.estado)) {
      await efectosResultado(updated, rows[idx].estado || '')
    }

    // Cancelar desde el panel tampoco le avisaba al veterinario que tenía la
    // visita tomada: se quedaba esperando. Se manda el correo de servicio
    // cancelado (y si venía de un cierre con resultado, se aclara que el correo
    // del pago de la consulta queda sin efecto).
    if (partial.estado === 'cancelada' && rows[idx].estado !== 'cancelada' && updated.vet_email_asignado) {
      try {
        await enviarVetEutanasiaCancelada({
          email: updated.vet_email_asignado,
          vetNombre: updated.vet_nombre_asignado || '',
          mascota: updated.mascota_nombre || '',
          motivo: 'El servicio fue cancelado y no se realizará.',
          correccion: rows[idx].estado === 'no_realizada',
        })
      } catch (e) { console.warn('[cotizaciones PATCH] aviso de cancelación al vet falló:', e) }
    }

    return NextResponse.json({ ...updated, aviso: avisoToggle })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 })
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireAdmin('DELETE')
  if (denied) return denied
  void req
  try {
    const { id } = await params
    const rows = await getSheetData(SHEET)
    const idx = rows.findIndex(r => r.id === id)
    if (idx === -1) return NextResponse.json({ error: 'No encontrado' }, { status: 404 })
    await deleteRow(SHEET, idx)
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
