import { NextRequest, NextResponse } from 'next/server'
import { getSheetData } from '@/lib/datastore'
import { enviarInvitacionEditarDatos } from '@/lib/eutanasia-mailer'
import { sesionConAcceso } from '@/lib/permisos-server'

const SHEET = 'vet_convenio_eutanasia'

function parseArr(s: string | undefined): string[] {
  try { const v = JSON.parse(s || '[]'); return Array.isArray(v) ? v : [] } catch { return [] }
}
function parseObj(s: string | undefined): Record<string, { am?: boolean; pm?: boolean }> {
  try { const v = JSON.parse(s || '{}'); return v && typeof v === 'object' ? v : {} } catch { return {} }
}

/**
 * POST /api/eutanasias/vets/enviar-datos  body: { vet_id }
 *
 * Le manda al veterinario el correo con el botón "Revisar y actualizar mis
 * datos" (link firmado, 30 días) para que mantenga su ficha del convenio al
 * día sin pasar por el equipo. Lo dispara el botón "Enviar datos a Vet" de
 * Servicios → Veterinarios.
 */
export async function POST(req: NextRequest) {
  const { ok } = await sesionConAcceso('/api/eutanasias')
  if (!ok) return NextResponse.json({ error: 'No autorizado' }, { status: 403 })

  try {
    const body = await req.json().catch(() => ({}))
    const vetId = String(body.vet_id ?? '').trim()
    if (!vetId) return NextResponse.json({ error: 'Falta el veterinario.' }, { status: 400 })

    const vets = await getSheetData(SHEET)
    const v = vets.find(r => r.id === vetId)
    if (!v) return NextResponse.json({ error: 'Veterinario no encontrado.' }, { status: 404 })
    if (!(v.email || '').trim()) {
      return NextResponse.json({ error: 'Ese veterinario no tiene correo registrado. Agrégalo primero con "Editar".' }, { status: 400 })
    }

    const res = await enviarInvitacionEditarDatos({
      vetId: v.id,
      nombre: v.nombre || '',
      apellido: v.apellido || '',
      email: v.email,
      comunas: parseArr(v.comunas),
      horarios: parseObj(v.horarios),
      datosPagoCompletos: (v.datos_pago_completos || '').toUpperCase() === 'TRUE',
    })
    if (!res.ok) {
      return NextResponse.json({ error: res.error || 'No se pudo enviar el correo.' }, { status: 502 })
    }
    return NextResponse.json({ ok: true, email: res.to, mensaje: `Correo enviado a ${res.to}.` })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[eutanasias/vets/enviar-datos] error:', msg)
    return NextResponse.json({ error: 'Error enviando el correo.' }, { status: 500 })
  }
}
