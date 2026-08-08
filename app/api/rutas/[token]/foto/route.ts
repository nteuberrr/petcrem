import { NextRequest, NextResponse } from 'next/server'
import { getSheetData } from '@/lib/datastore'
import { verificarRutaToken } from '@/lib/ruta-token'
import { uploadToR2 } from '@/lib/cloudflare-r2'

export const dynamic = 'force-dynamic'

/**
 * POST /api/rutas/[token]/foto   FormData { cliente_id, foto }  → { url }
 *
 * Sube la foto que saca el repartidor al entregar (galería o cámara). SIN
 * sesión: el token HMAC de la URL es la autenticación, igual que el resto de la
 * hoja de ruta.
 *
 * Acá SOLO se sube el archivo a R2 y se devuelve su URL: quién la guarda es el
 * POST de la entrega (`/api/rutas/[token]`), que la mete dentro de la entrega.
 * Separarlo permite sacar la foto ANTES de marcar entregado sin crear una
 * entrada de entrega a medias.
 *
 * Guardas contra un link filtrado: la parada tiene que pertenecer a ESA ruta,
 * solo imágenes y con tope de tamaño. El navegador además ya la achica antes de
 * enviarla (ver la página), así que estos límites son el techo, no lo normal.
 */

const TIPOS_OK = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp'])
const MAX_BYTES = 6 * 1024 * 1024

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params
    const v = verificarRutaToken(decodeURIComponent(token))
    if (!v.ok || !v.despachoId) {
      const motivo = v.error === 'expired'
        ? 'Este enlace venció. Pídele uno nuevo al equipo.'
        : 'Este enlace no es válido. Pídele uno nuevo al equipo.'
      return NextResponse.json({ error: motivo }, { status: 401 })
    }

    const form = await req.formData()
    const clienteId = String(form.get('cliente_id') ?? '')
    const archivo = form.get('foto')
    if (!clienteId) return NextResponse.json({ error: 'Falta la parada.' }, { status: 400 })
    if (!(archivo instanceof File)) return NextResponse.json({ error: 'Falta la foto.' }, { status: 400 })
    if (!TIPOS_OK.has(archivo.type)) {
      return NextResponse.json({ error: 'El archivo tiene que ser una imagen (JPG, PNG o WEBP).' }, { status: 400 })
    }
    if (archivo.size > MAX_BYTES) {
      return NextResponse.json({ error: 'La foto pesa demasiado. Inténtalo con otra.' }, { status: 400 })
    }

    // La parada tiene que ser de ESTA ruta: el token no habilita subir fotos a
    // cualquier ficha del sistema.
    const despachos = await getSheetData('despachos')
    const row = despachos.find(d => String(d.id) === String(v.despachoId))
    if (!row) return NextResponse.json({ error: 'La ruta ya no existe.' }, { status: 404 })
    let mascotasIds: string[] = []
    try { mascotasIds = JSON.parse(row.mascotas_ids || '[]') } catch {}
    if (!mascotasIds.includes(clienteId)) {
      return NextResponse.json({ error: 'Esa parada no es de esta ruta.' }, { status: 400 })
    }

    const ext = archivo.type === 'image/png' ? 'png' : archivo.type === 'image/webp' ? 'webp' : 'jpg'
    const key = `despachos/${v.despachoId}/${clienteId}-${Date.now()}.${ext}`
    const { url } = await uploadToR2(Buffer.from(await archivo.arrayBuffer()), key, archivo.type)

    return NextResponse.json({ ok: true, url })
  } catch (e) {
    console.error('[rutas/foto]', e)
    return NextResponse.json({ error: 'No se pudo subir la foto.' }, { status: 500 })
  }
}
