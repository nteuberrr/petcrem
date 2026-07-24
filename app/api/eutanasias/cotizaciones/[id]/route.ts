import { NextRequest, NextResponse } from 'next/server'
import { getSheetData, updateById, deleteRow } from '@/lib/datastore'
import { sesionConAcceso } from '@/lib/permisos-server'
import { precioParaPeso } from '@/lib/eutanasia-matcher'
import { getConsultaEutanasia } from '@/lib/eutanasia-precios'
import { parsePeso } from '@/lib/numbers'
import { enviarCoordinarConFamilia, enviarClienteVetAsignado, enviarClienteAgradecimientoEutanasia, enviarMailNoRealizada } from '@/lib/eutanasia-mailer'
import { formatDate } from '@/lib/dates'
import { crearClienteBorrador } from '@/lib/cliente-borrador'

const SHEET = 'cotizaciones_eutanasia'

async function requireAdmin() {
  const { ok } = await sesionConAcceso('/api/eutanasias')
  if (!ok) return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
  return null
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireAdmin()
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
  const denied = await requireAdmin()
  if (denied) return denied
  try {
    const { id } = await params
    const body = await req.json()
    const rows = await getSheetData(SHEET)
    const idx = rows.findIndex(r => r.id === id)
    if (idx === -1) return NextResponse.json({ error: 'No encontrado' }, { status: 404 })

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

    // Marcadores de timestamp si cambia el estado a algunos específicos
    if (partial.estado === 'realizada' && !rows[idx].fecha_realizacion) {
      partial.fecha_realizacion = new Date().toISOString()
    }
    // Al pasar a 'realizada' inicializamos el estado de pago si no lo tenía,
    // así aparece automáticamente en el listado histórico esperando que el
    // admin marque 'pago_confirmado' luego de transferir.
    if (partial.estado === 'realizada' && !rows[idx].estado_pago && !partial.estado_pago) {
      partial.estado_pago = 'pendiente_pago'
    }
    // Al pasar a 'no_realizada': sellamos la fecha de cierre (para el pago),
    // inicializamos estado_pago y congelamos el pago al vet por la consulta.
    if (partial.estado === 'no_realizada') {
      if (!rows[idx].fecha_realizacion) partial.fecha_realizacion = new Date().toISOString()
      if (!rows[idx].estado_pago && !partial.estado_pago) partial.estado_pago = 'pendiente_pago'
      if (!rows[idx].consulta_vet_snapshot && !partial.consulta_vet_snapshot) {
        partial.consulta_vet_snapshot = String((await getConsultaEutanasia()).vet)
      }
    }
    if (partial.estado === 'cancelada' && !rows[idx].fecha_cancelacion) {
      partial.fecha_cancelacion = new Date().toISOString()
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

    const updated = { ...rows[idx], ...partial }
    await updateById(SHEET, id, updated)

    // ── Efectos de correo (best-effort, tras persistir) ──────────────────────
    const baseUrl = (process.env.PUBLIC_APP_URL || process.env.NEXTAUTH_URL || '').replace(/\/+$/, '')

    // Asignación manual de un vet NUEVO → coordinar (vet) + aviso (cliente).
    if (vetParaCoordinar) {
      await enviarCoordinarConFamilia({ c: updated, vet: vetParaCoordinar, baseUrl })
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

    // Transición a 'realizada' desde el panel → agradecimiento + reseña al tutor
    // (mismo correo que dispara el flujo del vet). Guardado contra reenvíos.
    if (partial.estado === 'realizada' && rows[idx].estado !== 'realizada' && updated.cliente_email) {
      try {
        await enviarClienteAgradecimientoEutanasia({
          clienteEmail: updated.cliente_email,
          clienteNombre: updated.cliente_nombre,
          mascotaNombre: updated.mascota_nombre,
        })
      } catch (e) { console.warn('[cotizaciones PATCH] agradecimiento al cliente falló:', e) }
    }

    // Transición a 'no_realizada' desde el panel → elimina el borrador de cremación
    // (la mascota sigue viva) y paga la consulta al vet. Guardado contra reenvíos.
    if (partial.estado === 'no_realizada' && rows[idx].estado !== 'no_realizada') {
      if (updated.cliente_id) {
        try {
          const clientes = await getSheetData('clientes')
          const ci = clientes.findIndex(r => String(r.id) === String(updated.cliente_id))
          if (ci !== -1 && (clientes[ci].estado || '') === 'borrador') await deleteRow('clientes', ci)
        } catch (e) { console.warn('[cotizaciones PATCH] no se pudo eliminar borrador:', e) }
      }
      if (updated.vet_email_asignado) {
        try {
          await enviarMailNoRealizada({
            vetEmail: updated.vet_email_asignado,
            vetNombre: updated.vet_nombre_asignado || '',
            mascotaNombre: updated.mascota_nombre,
            consultaVet: parseInt(updated.consulta_vet_snapshot || '0', 10) || (await getConsultaEutanasia()).vet,
            fechaRealizacionISO: (updated.fecha_realizacion || new Date().toISOString()).slice(0, 10),
          })
        } catch (e) { console.warn('[cotizaciones PATCH] correo no-realizada al vet falló:', e) }
      }
    }

    return NextResponse.json({ ...updated, aviso: avisoToggle })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 })
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireAdmin()
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
