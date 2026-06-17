import { NextRequest, NextResponse } from 'next/server'
import { getSheetData, updateById, updateByIdIf } from '@/lib/datastore'
import { enviarEntregaConfirmada } from '@/lib/cliente-mailer'
import { resolverVet, enviarEntregaVet } from '@/lib/vet-cremacion-mailer'
import { todayISO } from '@/lib/dates'

export const dynamic = 'force-dynamic'

type Entregas = Record<string, { fecha_hora: string }>

/**
 * POST /api/despachos/[id]/entregar  body: { cliente_id, deshacer? }
 * Marca (o desmarca) una mascota como entregada dentro de la ruta:
 *  - Registra la entrega en `entregas` con su fecha/hora.
 *  - Pone la mascota en estado 'despachado' y la vincula al despacho.
 *  - Envía el correo de entrega + reseña al tutor (solo al marcar, no al deshacer).
 * Si la ruta estaba 'guardada', la pasa a 'en_curso' (sin reenviar el correo de inicio).
 *
 * Concurrencia: `entregas` es un blob JSON compartido por toda la ruta. Dos
 * entregas casi simultáneas (de paradas distintas) harían read-modify-write y una
 * se perdería. Lo resolvemos con optimistic concurrency: cada intento condiciona
 * el update a que `entregas` siga igual que cuando lo leímos (updateByIdIf); si
 * cambió, reintentamos con la versión fresca.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await req.json().catch(() => ({}))
    const clienteId = String(body.cliente_id ?? '')
    const deshacer = body.deshacer === true
    if (!clienteId) return NextResponse.json({ error: 'cliente_id requerido' }, { status: 400 })

    const now = new Date().toISOString()
    const MAX_RETRY = 5

    // Resultado a devolver tras aplicar el cambio en `entregas` (o early-return).
    type Aplicado =
      | { tipo: 'ya_entregada' }
      | { tipo: 'entregada'; ruta_terminada: boolean }
      | { tipo: 'deshecha'; ruta_reabierta: boolean }
    let aplicado: Aplicado | null = null

    for (let attempt = 0; attempt < MAX_RETRY && !aplicado; attempt++) {
      const rows = await getSheetData('despachos')
      const idx = rows.findIndex(r => r.id === id)
      if (idx === -1) return NextResponse.json({ error: 'Ruta no encontrada' }, { status: 404 })
      const row = rows[idx]

      let mascotasIds: string[] = []
      try { mascotasIds = JSON.parse(row.mascotas_ids || '[]') } catch {}
      if (!mascotasIds.includes(clienteId)) {
        return NextResponse.json({ error: 'La mascota no pertenece a esta ruta' }, { status: 400 })
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
        const ok = await updateByIdIf('despachos', id, { entregas: entregasStr }, cambios)
        if (ok) aplicado = { tipo: 'deshecha', ruta_reabierta: reabierta }
        continue
      }

      if (entregas[clienteId]) { aplicado = { tipo: 'ya_entregada' }; break }
      const nuevas: Entregas = { ...entregas, [clienteId]: { fecha_hora: now } }
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
      const ok = await updateByIdIf('despachos', id, { entregas: entregasStr }, cambios)
      if (ok) aplicado = { tipo: 'entregada', ruta_terminada: todasEntregadas }
      // si !ok → otra entrega cambió el blob; reintentamos con datos frescos
    }

    if (!aplicado) {
      return NextResponse.json({ error: 'No se pudo registrar la entrega (conflicto de concurrencia). Reintenta.' }, { status: 409 })
    }

    if (aplicado.tipo === 'ya_entregada') {
      return NextResponse.json({ ok: true, ya_entregada: true })
    }

    // Flip del cliente + correo: una sola vez, después de fijar el blob de entregas.
    const clientes = await getSheetData('clientes')
    const cliente = clientes.find(c => c.id === clienteId)

    if (aplicado.tipo === 'deshecha') {
      if (cliente && cliente.despacho_id === id) {
        await updateById('clientes', clienteId, { ...cliente, estado: 'cremado', despacho_id: '' })
      }
      return NextResponse.json({ ok: true, entregada: false, ruta_reabierta: aplicado.ruta_reabierta })
    }

    // tipo === 'entregada'
    if (cliente) {
      await updateById('clientes', clienteId, { ...cliente, estado: 'despachado', despacho_id: id })
      // Correo de entrega + reseña al tutor (best-effort).
      try {
        await enviarEntregaConfirmada({
          email: cliente.email,
          nombreMascota: cliente.nombre_mascota,
          nombreTutor: cliente.nombre_tutor,
          codigo: cliente.codigo,
          clienteId: cliente.id,
        })
      } catch (e) {
        console.warn('[despachos/entregar] fallo correo entrega (no bloqueante):', e)
      }
      // Y al veterinario de convenio asociado, si lo hay (best-effort).
      try {
        const vet = await resolverVet(cliente.veterinaria_id)
        if (vet) await enviarEntregaVet({ ...vet, nombreMascota: cliente.nombre_mascota, codigo: cliente.codigo })
      } catch (e) {
        console.warn('[despachos/entregar] fallo correo entrega al vet (no bloqueante):', e)
      }
    }

    return NextResponse.json({ ok: true, entregada: true, fecha_hora: now, ruta_terminada: aplicado.ruta_terminada })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
