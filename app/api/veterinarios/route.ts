import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSheetData, appendRow, updateRow, getNextId, deleteRow } from '@/lib/datastore'
import { todayISO } from '@/lib/dates'
import { capitalizarNombre } from '@/lib/nombres'
import { enviarBienvenidaConvenioVet } from '@/lib/vet-cremacion-mailer'
import { sincronizarMailingCliente } from '@/lib/mailing-vet-sync'

const VetSchema = z.object({
  nombre: z.string().min(1),
  direccion: z.string(),
  telefono: z.string(),
  correo: z.string(),
  nombre_contacto: z.string(),
  cargo_contacto: z.string(),
  comuna: z.string(),
  rut: z.string(),
  razon_social: z.string(),
  giro: z.string(),
  tipo_precios: z.enum(['precios_convenio', 'precios_especiales']),
  precios_especiales: z.string().optional().default(''),
  activo: z.boolean().optional().default(true),
})

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const soloActivos = searchParams.get('activo') === 'true'
    let rows = await getSheetData('veterinarios')
    if (soloActivos) rows = rows.filter((r) => r.activo === 'TRUE')
    return NextResponse.json(rows)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const data = VetSchema.parse(body)
    data.nombre = capitalizarNombre(data.nombre)
    if (data.nombre_contacto) data.nombre_contacto = capitalizarNombre(data.nombre_contacto)
    const id = await getNextId('veterinarios')
    const now = todayISO()
    const row = { id, ...data, activo: 'TRUE', fecha_creacion: now }
    await appendRow('veterinarios', row)

    // Regla automática: todo vet del convenio queda como CLIENTE en la base de
    // Mailing (upsert por email; best-effort).
    await sincronizarMailingCliente({
      correo: data.correo, nombre: data.nombre,
      nombre_contacto: data.nombre_contacto, comuna: data.comuna, telefono: data.telefono,
    })

    // Correo de bienvenida al convenio (best-effort: no bloquea el alta).
    if (data.correo && /\S+@\S+\.\S+/.test(data.correo)) {
      try {
        await enviarBienvenidaConvenioVet({
          email: data.correo,
          vetNombre: data.nombre,
          contacto: data.nombre_contacto,
          cargoContacto: data.cargo_contacto,
          razonSocial: data.razon_social,
          rut: data.rut,
          giro: data.giro,
          direccion: data.direccion,
          comuna: data.comuna,
          telefono: data.telefono,
        })
      } catch (e) {
        console.warn('[veterinarios POST] fallo mail bienvenida convenio (no bloqueante):', e)
      }
    }

    return NextResponse.json(row, { status: 201 })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const id = searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'id requerido' }, { status: 400 })
    const rows = await getSheetData('veterinarios')
    const idx = rows.findIndex(r => r.id === id)
    if (idx === -1) return NextResponse.json({ error: 'No encontrado' }, { status: 404 })
    await deleteRow('veterinarios', idx)
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json()
    const { id, ...updates } = body
    if (typeof updates.nombre === 'string') updates.nombre = capitalizarNombre(updates.nombre)
    if (typeof updates.nombre_contacto === 'string') updates.nombre_contacto = capitalizarNombre(updates.nombre_contacto)
    const rows = await getSheetData('veterinarios')
    const idx = rows.findIndex((r) => r.id === id)
    if (idx === -1) return NextResponse.json({ error: 'No encontrado' }, { status: 404 })
    const updated = { ...rows[idx], ...updates }
    await updateRow('veterinarios', idx, updated)
    return NextResponse.json(updated)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 })
  }
}
