import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { getSheetData, updateById, deleteRow } from '@/lib/datastore'
import { esAdmin } from '@/lib/roles'
import { precioParaPeso } from '@/lib/eutanasia-matcher'
import { parsePeso } from '@/lib/numbers'
import { enviarCoordinarConFamilia, enviarClienteVetAsignado, enviarClienteAgradecimientoEutanasia } from '@/lib/eutanasia-mailer'
import { formatDate } from '@/lib/dates'

const SHEET = 'cotizaciones_eutanasia'

async function requireAdmin() {
  const session = await getServerSession(authOptions)
  if (!esAdmin((session?.user as { role?: string })?.role)) {
    return NextResponse.json({ error: 'Solo admin' }, { status: 403 })
  }
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

    // Vet a notificar con el correo "coordina con la familia" si esta edición
    // asigna un vet NUEVO (se resuelve más abajo, se envía tras persistir).
    let vetParaCoordinar: Record<string, string> | null = null

    // Asignación manual de vet (cambio o asignación inicial).
    // - Si viene vet_id_asignado con valor → buscamos el vet, lo asignamos,
    //   estado pasa a 'confirmada' (si no estaba 'realizada'/'cancelada'),
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
          // "coordina con la familia" (el flujo sigue: confirmar → realizado).
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
        if (estadoActual === 'aceptada' || estadoActual === 'confirmada') {
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
    if (partial.estado === 'cancelada' && !rows[idx].fecha_cancelacion) {
      partial.fecha_cancelacion = new Date().toISOString()
    }
    // Al marcar pago_confirmado sellamos fecha_pago si no estaba.
    if (partial.estado_pago === 'pago_confirmado' && !rows[idx].fecha_pago) {
      partial.fecha_pago = new Date().toISOString()
    }

    // Si se corrige el PESO y la cotización aún no está comprometida con un vet
    // (creada/enviada), recalculamos precio_snapshot (lo que se le paga al vet) con
    // la MISMA tabla y regla que al crearla. Una vez aceptada/confirmada/realizada,
    // el precio queda congelado (el vet ya aceptó ese monto).
    if ('peso' in body && partial.peso !== rows[idx].peso) {
      const estadoActual = partial.estado ?? rows[idx].estado
      if (!['aceptada', 'confirmada', 'realizada', 'cancelada'].includes(estadoActual)) {
        const tramos = await getSheetData('precios_eutanasia')
        partial.precio_snapshot = String(precioParaPeso(tramos, parsePeso(partial.peso)))
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

    return NextResponse.json(updated)
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
