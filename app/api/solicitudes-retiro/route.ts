import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { esAdmin } from '@/lib/roles'
import { listarSolicitudesPendientes, listarSolicitudesConfirmadas, resolverSolicitudRetiro } from '@/lib/solicitudes-retiro'
import { listarEutanasiasCronograma } from '@/lib/eutanasia-cotizaciones'
import { getSheetData } from '@/lib/datastore'
import { crearEstimadorFichas, valorFicha } from '@/lib/precio-estimado'
import { getConfigCobroEutanasia, cobroClienteCon } from '@/lib/eutanasia-precios'

export const dynamic = 'force-dynamic'

/**
 * Panel de solicitudes de retiro del bot de WhatsApp.
 *   GET  → cualquier usuario logueado: pendientes + confirmadas + eutanasias
 *          (todos deben ver las notificaciones en el dashboard). RESOLVERLAS
 *          (confirmar/rechazar) sigue siendo solo de admin — la UI le oculta
 *          los botones al operador y el POST revalida el rol.
 *   POST { id, accion: 'confirmar' | 'rechazar' } → mismo efecto que el botón de
 *          WhatsApp (crea la ficha borrador + avisa al cliente). Canal confiable,
 *          sin depender de la ventana de 24h de WhatsApp. Solo admin.
 */

type SolicitudLista = Awaited<ReturnType<typeof listarSolicitudesPendientes>>[number]
type EutanasiaLista = Awaited<ReturnType<typeof listarEutanasiasCronograma>>[number]

/**
 * Agrega a cada tarjeta del dashboard el VALOR A COBRAR por los servicios
 * agendados. Si la solicitud ya tiene ficha, manda la ficha (precio congelado o
 * estimación en vivo); si todavía no la tiene (pendiente de confirmar), se
 * estima con los datos del agendamiento (peso, modalidad, comuna, fecha/hora).
 * Best-effort: si algo falla, las tarjetas salen igual, sin monto.
 */
async function agregarValores(d: { pendientes: SolicitudLista[]; confirmadas: SolicitudLista[]; eutanasias: EutanasiaLista[] }) {
  try {
    const [estimar, clientes] = await Promise.all([
      crearEstimadorFichas(),
      getSheetData('clientes').catch(() => [] as Record<string, string>[]),
    ])
    const fichaPorId = new Map(clientes.map(c => [String(c.id), c]))

    const valorSolicitud = (s: SolicitudLista) => {
      const ficha = s.cliente_id ? fichaPorId.get(String(s.cliente_id)) : undefined
      if (ficha) {
        const v = valorFicha(ficha, estimar)
        return { valor: v.total, valor_estimado: v.estimado }
      }
      // Sin ficha todavía: se estima con lo que trae el agendamiento.
      const e = estimar({
        peso_declarado: s.peso || '',
        codigo_servicio: s.tipo_servicio || '',
        veterinaria_id: s.veterinaria_id || '',
        comuna: s.comuna || '',
        fecha_retiro: s.fecha_retiro || '',
        hora_retiro: s.hora_retiro || '',
        adicionales: '[]',
      })
      return { valor: e.total, valor_estimado: true }
    }

    // Eutanasias: lo que se cobra por la eutanasia (fuera de boleta) + la
    // cremación asociada. La config de cobro se lee UNA vez para todas.
    const [cotis, cfgEut] = await Promise.all([
      getSheetData('cotizaciones_eutanasia').catch(() => [] as Record<string, string>[]),
      getConfigCobroEutanasia(),
    ])
    const eutanasias = d.eutanasias.map(e => {
      const cot = cotis.find(c => String(c.id) === String(e.id))
      const valorEut = cot ? cobroClienteCon(cot, cfgEut).total : 0
      const ficha = e.cliente_id ? fichaPorId.get(String(e.cliente_id)) : undefined
      const valorCrem = ficha ? valorFicha(ficha, estimar).total : 0
      return { ...e, valor_eutanasia: valorEut, valor_cremacion: valorCrem, valor: valorEut + valorCrem }
    })

    return {
      pendientes: d.pendientes.map(s => ({ ...s, ...valorSolicitud(s) })),
      confirmadas: d.confirmadas.map(s => ({ ...s, ...valorSolicitud(s) })),
      eutanasias,
    }
  } catch (e) {
    console.warn('[solicitudes-retiro GET] no se pudo calcular el valor a cobrar:', e)
    return d
  }
}

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
  try {
    const [pendientes, confirmadas, eutanasias] = await Promise.all([
      listarSolicitudesPendientes(),
      listarSolicitudesConfirmadas(),
      listarEutanasiasCronograma(),
    ])
    const conValor = await agregarValores({ pendientes, confirmadas, eutanasias })
    return NextResponse.json(conValor, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    console.error('[solicitudes-retiro GET]', e)
    return NextResponse.json({ error: 'No se pudieron cargar las solicitudes.' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!esAdmin((session?.user as { role?: string })?.role)) return NextResponse.json({ error: 'Solo admin' }, { status: 403 })
  try {
    const body = await req.json().catch(() => ({}))
    const id = String(body.id || '').trim()
    const accion = String(body.accion || '')
    if (!id || (accion !== 'confirmar' && accion !== 'rechazar')) {
      return NextResponse.json({ error: 'id y accion (confirmar|rechazar) son requeridos' }, { status: 400 })
    }
    const r = await resolverSolicitudRetiro(id, accion === 'confirmar')
    const status = r.resultado === 'no_existe' ? 404 : r.resultado === 'ya_resuelta' ? 409 : 200
    return NextResponse.json(r, { status })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
