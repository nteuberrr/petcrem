import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { getSheetData, updateRow, deleteRow } from '@/lib/datastore'
import { esAdmin } from '@/lib/roles'

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
          partial.estado = 'confirmada'
          if (!rows[idx].fecha_aceptacion) partial.fecha_aceptacion = ahora
          if (!rows[idx].fecha_confirmacion) partial.fecha_confirmacion = ahora
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
    const updated = { ...rows[idx], ...partial }
    await updateRow(SHEET, idx, updated)
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
