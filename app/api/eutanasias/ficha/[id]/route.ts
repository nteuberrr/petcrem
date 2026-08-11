/**
 * Ficha de UNA eutanasia — la que se abre desde el dashboard (notificaciones) y
 * desde la agenda. Disponible para TODOS los roles (módulo 'eutanasia-ficha' en
 * lib/permisos), a diferencia del panel completo de Servicios.
 *
 *  GET  → datos de la cotización para mostrarla (sin exponer la tabla completa).
 *  POST → cierra el caso:
 *         { resultado: 'realizada' }
 *         { resultado: 'no_realizada', motivo: 'cancelado' | 'vet_no_realizo' |
 *           'mascota_fallecio' }  ← cada motivo resuelve distinto el pago al vet
 *           y la cremación (ver lib/eutanasia-motivos).
 *
 * El POST existe porque el veterinario muchas veces no marca el enlace que le
 * llega por correo: sin esto el equipo no puede cerrar la ficha ni el pago.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getSheetData } from '@/lib/datastore'
import { sesionConAcceso } from '@/lib/permisos-server'
import { getConfigCobroEutanasia, cobroClienteCon } from '@/lib/eutanasia-precios'
import { incluyeCremacion } from '@/lib/eutanasia-cremacion'
import { aplicarResultadoEutanasia, esResultado, aplicarNoRealizada, cancelarEutanasiaConservandoFicha } from '@/lib/eutanasia-resultado'
import { esMotivoNoRealizada } from '@/lib/eutanasia-motivos'

const SHEET = 'cotizaciones_eutanasia'
const RUTA = '/api/eutanasias/ficha'

async function gate(metodo: string) {
  const { ok } = await sesionConAcceso(RUTA, metodo)
  return ok ? null : NextResponse.json({ error: 'No autorizado' }, { status: 403 })
}

/** Vista de la cotización que se le entrega a la ficha (no la fila cruda). */
async function armarFicha(c: Record<string, string>) {
  // Teléfono del vet asignado: el operador necesita poder llamarlo desde la ficha.
  let vetTelefono = ''
  if (c.vet_id_asignado) {
    try {
      const vets = await getSheetData('vet_convenio_eutanasia')
      vetTelefono = vets.find(v => String(v.id) === String(c.vet_id_asignado))?.telefono || ''
    } catch { /* best-effort */ }
  }
  // Lo que se le cobra al cliente (eutanasia, o la consulta si no se realizó).
  let cobro = { concepto: 'ninguno', base: 0, recargo: 0, total: 0 }
  try {
    cobro = cobroClienteCon(c, await getConfigCobroEutanasia())
  } catch { /* config no disponible: la ficha se muestra igual */ }

  return {
    id: c.id,
    estado: c.estado || '',
    estado_pago: c.estado_pago || '',
    mascota_nombre: c.mascota_nombre || '',
    especie: c.especie || '',
    peso: c.peso || '',
    cliente_nombre: c.cliente_nombre || '',
    cliente_telefono: c.cliente_telefono || '',
    cliente_email: c.cliente_email || '',
    cliente_id: c.cliente_id || '',
    direccion: c.direccion || '',
    comuna: c.comuna || '',
    fecha_servicio: c.fecha_servicio || '',
    hora_servicio: c.hora_servicio || '',
    hora_retiro_crematorio: c.hora_retiro_crematorio || '',
    incluye_cremacion: incluyeCremacion(c),
    notas: c.notas || '',
    vet_nombre: c.vet_nombre_asignado || '',
    vet_email: c.vet_email_asignado || '',
    vet_telefono: vetTelefono,
    fecha_realizacion: c.fecha_realizacion || '',
    cobro,
  }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await gate('GET')
  if (denied) return denied
  void req
  try {
    const { id } = await params
    const rows = await getSheetData(SHEET)
    const c = rows.find(r => String(r.id) === String(id))
    if (!c) return NextResponse.json({ error: 'No encontrado' }, { status: 404 })
    return NextResponse.json(await armarFicha(c))
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await gate('POST')
  if (denied) return denied
  try {
    const { id } = await params
    const body = await req.json().catch(() => ({}))
    const resultado = body?.resultado
    // NO SE REALIZÓ → el motivo decide el cierre (pago al vet + cremación).
    if (resultado === 'no_realizada' && esMotivoNoRealizada(body?.motivo)) {
      const r = await aplicarNoRealizada(String(id), body.motivo)
      if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
      return NextResponse.json({ ...(await armarFicha(r.cotizacion)), ...(r.aviso ? { aviso: r.aviso } : {}) })
    }
    // Compatibilidad: 'cancelado' era la tercera salida antes del modal de
    // motivos (= 'mascota_fallecio', la ficha de cremación queda abierta).
    if (resultado === 'cancelado') {
      const r = await cancelarEutanasiaConservandoFicha(String(id), {
        motivo: typeof body?.motivo === 'string' ? body.motivo : undefined,
      })
      if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
      return NextResponse.json(await armarFicha(r.cotizacion))
    }
    if (!esResultado(resultado)) {
      return NextResponse.json({ error: "Resultado inválido (usa 'realizada' o 'no_realizada' + motivo)" }, { status: 400 })
    }
    const r = await aplicarResultadoEutanasia(String(id), resultado)
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
    return NextResponse.json(await armarFicha(r.cotizacion))
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 })
  }
}
