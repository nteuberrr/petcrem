import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { getSheetData, appendRow, getNextId, ensureSheet, ensureColumns } from '@/lib/datastore'
import { buscarComuna } from '@/lib/comunas'
import { precioParaPeso } from '@/lib/eutanasia-matcher'
import { capitalizarNombre } from '@/lib/nombres'
import { esAdmin } from '@/lib/roles'
import { enviarCoordinarConFamilia, enviarClienteVetAsignado, enviarClienteCotizacionEutanasia } from '@/lib/eutanasia-mailer'
import { getConsultaEutanasia, getFijoEutanasia } from '@/lib/eutanasia-precios'
import { formatDate } from '@/lib/dates'

const SHEET = 'cotizaciones_eutanasia'
const COLS = [
  'id',
  'mascota_nombre', 'especie', 'peso',
  'cliente_nombre', 'cliente_telefono', 'cliente_email', 'cliente_wa_id',
  'direccion', 'comuna',
  'fecha_servicio', 'hora_servicio',
  'notas',
  'estado',
  'vet_id_asignado', 'vet_nombre_asignado', 'vet_email_asignado',
  'precio_snapshot', 'consulta_vet_snapshot',
  'cliente_id',
  'fecha_creacion', 'fecha_envio_cotizacion',
  'fecha_aceptacion', 'fecha_confirmacion',
  'fecha_realizacion', 'fecha_cancelacion',
  'creado_por',
]

async function requireAdmin() {
  const session = await getServerSession(authOptions)
  if (!esAdmin((session?.user as { role?: string })?.role)) {
    return { denied: NextResponse.json({ error: 'Solo admin' }, { status: 403 }), session: null }
  }
  return { denied: null, session }
}

function nowISO(): string {
  return new Date().toISOString()
}

function validarEmail(s: string): boolean {
  return /^[^\s,;<>"()@]+@[^\s,;<>"()@]+\.[^\s,;<>"()@]+$/i.test(s.trim())
}

export async function GET(req: NextRequest) {
  const { denied } = await requireAdmin()
  if (denied) return denied
  try {
    await ensureSheet(SHEET)
    await ensureColumns(SHEET, COLS)
    const url = new URL(req.url)
    const estado = url.searchParams.get('estado')
    const rows = await getSheetData(SHEET)
    const filtradas = estado ? rows.filter(r => r.estado === estado) : rows
    filtradas.sort((a, b) => (b.fecha_creacion || '').localeCompare(a.fecha_creacion || ''))
    return NextResponse.json(filtradas)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const { denied, session } = await requireAdmin()
  if (denied) return denied
  try {
    const body = await req.json()

    const mascota = String(body.mascota_nombre ?? '').trim()
    const especie = String(body.especie ?? '').trim()
    const peso = parseFloat(String(body.peso ?? ''))
    const cliNombre = String(body.cliente_nombre ?? '').trim()
    const cliTel = String(body.cliente_telefono ?? '').replace(/\D/g, '').slice(-9)
    const cliEmail = String(body.cliente_email ?? '').trim().toLowerCase()
    const direccion = String(body.direccion ?? '').trim()
    const comuna = String(body.comuna ?? '').trim()
    const fecha = String(body.fecha_servicio ?? '').trim()
    const hora = String(body.hora_servicio ?? '').trim()
    const notas = String(body.notas ?? '').trim()

    if (!mascota) return NextResponse.json({ error: 'Nombre de la mascota requerido' }, { status: 400 })
    if (!especie) return NextResponse.json({ error: 'Especie requerida' }, { status: 400 })
    if (!Number.isFinite(peso) || peso <= 0) return NextResponse.json({ error: 'Peso inválido' }, { status: 400 })
    if (!cliNombre) return NextResponse.json({ error: 'Nombre del cliente requerido' }, { status: 400 })
    if (cliTel.length !== 9) return NextResponse.json({ error: 'Teléfono del cliente debe tener 9 dígitos' }, { status: 400 })
    if (cliEmail && !validarEmail(cliEmail)) return NextResponse.json({ error: 'Email del cliente inválido' }, { status: 400 })
    if (!direccion) return NextResponse.json({ error: 'Dirección requerida' }, { status: 400 })
    if (!comuna) return NextResponse.json({ error: 'Comuna requerida' }, { status: 400 })
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return NextResponse.json({ error: 'Fecha inválida' }, { status: 400 })
    if (!/^\d{2}:\d{2}$/.test(hora)) return NextResponse.json({ error: 'Hora inválida' }, { status: 400 })

    const comunaCanon = buscarComuna(comuna)?.nombre ?? comuna

    // Snapshot del precio que se le paga al vet, según el peso
    await ensureSheet('precios_eutanasia')
    await ensureColumns('precios_eutanasia', ['id', 'peso_min', 'peso_max', 'precio'])
    const tramos = await getSheetData('precios_eutanasia')
    const precio = precioParaPeso(tramos, peso)
    const consulta = await getConsultaEutanasia() // pago al vet si NO se realiza (congelado)

    // Asignación manual opcional: si viene vet_id_asignado, buscamos el vet y la
    // cotización arranca 'aceptada' (el vet fue asignado = aceptó): se le manda el
    // correo de "coordina con la familia" y sigue el flujo natural hasta realizada.
    let vetAsignado: Record<string, string> | null = null
    if (body.vet_id_asignado) {
      const vets = await getSheetData('vet_convenio_eutanasia')
      const v = vets.find(r => r.id === String(body.vet_id_asignado))
      if (!v) return NextResponse.json({ error: 'Veterinario asignado no existe' }, { status: 400 })
      if (v.activo === 'FALSE') return NextResponse.json({ error: 'El veterinario está inactivo' }, { status: 400 })
      vetAsignado = v
    }

    await ensureSheet(SHEET)
    await ensureColumns(SHEET, COLS)
    const id = await getNextId(SHEET)
    const ahora = nowISO()
    const row = {
      id,
      mascota_nombre: capitalizarNombre(mascota),
      especie,
      peso: String(peso),
      cliente_nombre: capitalizarNombre(cliNombre),
      cliente_telefono: cliTel,
      cliente_email: cliEmail,
      direccion,
      comuna: comunaCanon,
      fecha_servicio: fecha,
      hora_servicio: hora,
      notas,
      estado: vetAsignado ? 'aceptada' : 'creada',
      vet_id_asignado: vetAsignado?.id ?? '',
      vet_nombre_asignado: vetAsignado ? `${vetAsignado.nombre || ''} ${vetAsignado.apellido || ''}`.trim() : '',
      vet_email_asignado: vetAsignado?.email ?? '',
      precio_snapshot: String(precio),
      consulta_vet_snapshot: String(consulta.vet),
      cliente_id: '',
      fecha_creacion: ahora,
      fecha_envio_cotizacion: '',
      fecha_aceptacion: vetAsignado ? ahora : '',
      fecha_confirmacion: '',
      fecha_realizacion: '',
      fecha_cancelacion: '',
      creado_por: session?.user?.name || session?.user?.email || '',
    }
    await appendRow(SHEET, row)

    // Asignación manual → dispara los mismos correos que el flujo natural:
    //  · al veterinario: "coordina con la familia" (contacto + botón confirmar);
    //  · al tutor: aviso de que un veterinario tomó el caso (único correo al cliente).
    // Best-effort: no bloquean la creación.
    if (vetAsignado) {
      const baseUrl = (process.env.PUBLIC_APP_URL || process.env.NEXTAUTH_URL || '').replace(/\/+$/, '')
      const cCorreo = { ...row, id: String(id) } as unknown as Record<string, string>
      await enviarCoordinarConFamilia({ c: cCorreo, vet: vetAsignado, baseUrl })
      if (cliEmail) {
        try {
          await enviarClienteVetAsignado({
            clienteEmail: cliEmail,
            clienteNombre: row.cliente_nombre,
            mascotaNombre: row.mascota_nombre,
            vetNombre: row.vet_nombre_asignado,
            vetTelefono: vetAsignado.telefono || '',
            fechaServicio: formatDate(row.fecha_servicio),
            horaServicio: row.hora_servicio,
          })
        } catch (e) { console.warn('[cotizaciones POST] correo al cliente falló:', e) }
      }
    } else if (cliEmail) {
      // Sin vet pre-asignado (flujo normal) → correo al tutor: recibimos tu
      // solicitud, explica la evaluación + precios. Best-effort.
      try {
        const fijo = await getFijoEutanasia()
        await enviarClienteCotizacionEutanasia({
          clienteEmail: cliEmail,
          clienteNombre: row.cliente_nombre,
          mascotaNombre: row.mascota_nombre,
          especie: row.especie,
          peso: row.peso,
          fechaServicio: row.fecha_servicio,
          horaServicio: row.hora_servicio,
          comuna: row.comuna,
          precioClienteRealizada: precio + fijo,
          consultaTotal: consulta.total,
        })
      } catch (e) { console.warn('[cotizaciones POST] correo cotización al tutor falló:', e) }
    }

    return NextResponse.json({ ok: true, ...row }, { status: 201 })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 })
  }
}
