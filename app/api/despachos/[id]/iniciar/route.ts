import { NextRequest, NextResponse } from 'next/server'
import { getSheetData, updateByIdIf } from '@/lib/datastore'
import { enviarInicioDespacho } from '@/lib/cliente-mailer'
import { resolverVet, enviarInicioRutaVet } from '@/lib/vet-cremacion-mailer'

export const dynamic = 'force-dynamic'

/**
 * POST /api/despachos/[id]/iniciar
 * Marca la ruta como en curso, fija hora_inicio_ruta y envía a cada tutor el
 * correo "vamos en camino". Idempotente: si ya estaba iniciada, no reenvía.
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const rows = await getSheetData('despachos')
    const idx = rows.findIndex(r => r.id === id)
    if (idx === -1) return NextResponse.json({ error: 'Ruta no encontrada' }, { status: 404 })
    const row = rows[idx]

    if (row.estado_ruta === 'en_curso' || row.estado_ruta === 'terminada') {
      return NextResponse.json({ ok: true, ya_iniciada: true, hora_inicio_ruta: row.hora_inicio_ruta })
    }

    const now = new Date().toISOString()
    // Flip ATÓMICO: solo una ejecución gana el paso a "en_curso" desde el estado
    // actual. Evita que un doble clic o dos requests concurrentes manden el correo
    // "vamos en camino" dos veces a cada tutor y a cada vet de la ruta.
    const gano = await updateByIdIf('despachos', id,
      { estado_ruta: row.estado_ruta ?? '' },
      { estado_ruta: 'en_curso', hora_inicio_ruta: row.hora_inicio_ruta || now },
    )
    if (!gano) {
      return NextResponse.json({ ok: true, ya_iniciada: true, hora_inicio_ruta: row.hora_inicio_ruta })
    }

    // Correo "vamos en camino" a todos los tutores de la ruta (best-effort).
    try {
      let mascotasIds: string[] = []
      try { mascotasIds = JSON.parse(row.mascotas_ids || '[]') } catch {}
      const clientes = await getSheetData('clientes')
      const byId = new Map(clientes.map(c => [c.id, c]))
      const mascotas = mascotasIds
        .map(mid => byId.get(mid))
        .filter((c): c is Record<string, string> => !!c)
      const destinatarios = mascotas
        .map(c => ({ email: c.email, nombreMascota: c.nombre_mascota, nombreTutor: c.nombre_tutor, clienteId: c.id }))
      await enviarInicioDespacho(destinatarios)

      // Y a los veterinarios de convenio asociados a las mascotas de la ruta
      // (best-effort). Leemos `veterinarios` una sola vez.
      const conVet = mascotas.filter(c => c.veterinaria_id)
      if (conVet.length > 0) {
        const vets = await getSheetData('veterinarios')
        for (const c of conVet) {
          const vet = await resolverVet(c.veterinaria_id, vets)
          if (vet) await enviarInicioRutaVet({ ...vet, nombreMascota: c.nombre_mascota, codigo: c.codigo })
        }
      }
    } catch (e) {
      console.warn('[despachos/iniciar] fallo correo (no bloqueante):', e)
    }

    return NextResponse.json({ ok: true, hora_inicio_ruta: now })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
