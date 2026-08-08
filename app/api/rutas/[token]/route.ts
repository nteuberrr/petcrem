import { NextRequest, NextResponse } from 'next/server'
import { getSheetData } from '@/lib/datastore'
import { verificarRutaToken } from '@/lib/ruta-token'
import { registrarEntrega } from '@/lib/despacho-entrega'
import { datosEtiqueta, formatearTelefono } from '@/lib/etiqueta-datos'
import { formatDate } from '@/lib/dates'

export const dynamic = 'force-dynamic'

/**
 * HOJA DE RUTA PÚBLICA — la que abre el repartidor externo desde el link
 * firmado. SIN sesión: el token HMAC ES la autenticación (lib/ruta-token).
 *
 *   GET  /api/rutas/[token]                    → la ruta y sus paradas
 *   POST /api/rutas/[token]  { cliente_id }    → marca esa parada entregada
 *
 * Superficie mínima a propósito: el token trae un solo `despacho_id` y acá no se
 * acepta otro, así que un link filtrado expone esa ruta y nada más. Se devuelven
 * exactamente los datos de la etiqueta que ya viaja impresa en cada ánfora
 * (código, mascota, tutor, dirección, teléfono) — nada de precios, correos ni
 * estado de pago.
 *
 * DESHACER no se expone: al marcar entregado salen el correo y el WhatsApp al
 * tutor, y deshacer no los borra. Si el repartidor se equivoca, lo corrige el
 * equipo desde Operaciones.
 */

interface ParadaGuardada { cliente_id: string; orden?: number; direccion?: string }

function paradasOrdenadas(row: Record<string, string>, mascotasIds: string[]): ParadaGuardada[] {
  let guardadas: ParadaGuardada[] = []
  try {
    const x = JSON.parse(row.paradas || '[]')
    if (Array.isArray(x)) guardadas = x as ParadaGuardada[]
  } catch {}
  if (guardadas.length > 0) {
    return [...guardadas].sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0))
  }
  // Ruta creada a mano (sin optimizador): el orden es el de la lista.
  return mascotasIds.map(id => ({ cliente_id: id }))
}

async function cargarRuta(despachoId: string) {
  const despachos = await getSheetData('despachos')
  const row = despachos.find(d => String(d.id) === String(despachoId))
  if (!row) return null

  let mascotasIds: string[] = []
  try { mascotasIds = JSON.parse(row.mascotas_ids || '[]') } catch {}
  let entregas: Record<string, { fecha_hora: string }> = {}
  try { entregas = JSON.parse(row.entregas || '{}') } catch {}

  const clientes = await getSheetData('clientes')
  const porId = new Map(clientes.map(c => [String(c.id), c]))

  const paradas = paradasOrdenadas(row, mascotasIds).map((p, i) => {
    const c = porId.get(String(p.cliente_id))
    const e = c ? datosEtiqueta(c) : null
    const ent = entregas[p.cliente_id]
    return {
      cliente_id: String(p.cliente_id),
      orden: i + 1,
      codigo: e?.codigo || '',
      nombre_mascota: e?.nombre_mascota || '',
      nombre_tutor: e?.nombre_tutor || '',
      direccion: p.direccion || e?.direccion || '',
      telefono: e?.telefono || '',
      telefono_legible: formatearTelefono(e?.telefono || ''),
      entregada: !!ent,
      entregada_hora: ent?.fecha_hora || '',
    }
  })

  return {
    numero_recorrido: String(row.numero_recorrido || ''),
    fecha: formatDate(row.fecha) || '',
    estado_ruta: String(row.estado_ruta || 'guardada'),
    nota: String(row.nota || ''),
    origen_direccion: String(row.origen_direccion || ''),
    destino_direccion: String(row.destino_direccion || ''),
    paradas,
  }
}

function rechazo(error: string) {
  const motivo = error === 'expired'
    ? 'Este enlace venció. Pídele uno nuevo al equipo.'
    : 'Este enlace no es válido. Pídele uno nuevo al equipo.'
  return NextResponse.json({ error: motivo, motivo: error }, { status: 401 })
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params
    const v = verificarRutaToken(decodeURIComponent(token))
    if (!v.ok || !v.despachoId) return rechazo(v.error || 'malformed')

    const ruta = await cargarRuta(v.despachoId)
    if (!ruta) return NextResponse.json({ error: 'La ruta ya no existe.' }, { status: 404 })
    return NextResponse.json({ ok: true, ruta })
  } catch (e) {
    console.error('[rutas GET]', e)
    return NextResponse.json({ error: 'No se pudo cargar la ruta.' }, { status: 500 })
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params
    const v = verificarRutaToken(decodeURIComponent(token))
    if (!v.ok || !v.despachoId) return rechazo(v.error || 'malformed')

    const body = await req.json().catch(() => ({}))
    const clienteId = String(body.cliente_id ?? '')
    if (!clienteId) return NextResponse.json({ error: 'Falta la parada.' }, { status: 400 })

    // registrarEntrega valida que la parada pertenezca a ESTA ruta.
    const r = await registrarEntrega(v.despachoId, clienteId)
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })

    const ruta = await cargarRuta(v.despachoId)
    return NextResponse.json({ ok: true, ya_entregada: r.tipo === 'ya_entregada', ruta })
  } catch (e) {
    console.error('[rutas POST]', e)
    return NextResponse.json({ error: 'No se pudo registrar la entrega.' }, { status: 500 })
  }
}
