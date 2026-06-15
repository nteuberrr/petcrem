import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSheetData, updateById, ensureColumns } from '@/lib/datastore'
import { calcularSnapshotFicha } from '@/lib/price-calculator'
import { capitalizarNombre } from '@/lib/nombres'
import { verifyBorradorToken } from '@/lib/borrador-token'

// ─────────────────────────────────────────────────────────────────────────────
// Completar la ficha BORRADOR por el tutor, desde el link firmado del WhatsApp
// de "retiro confirmado". Whitelisteado en proxy.ts (sin sesión; auth = token).
//
// Clave: esto SOLO enriquece el borrador. NO genera código ni manda correo. El
// ingreso oficial (código + correo de bienvenida) lo hace el operador al
// "Registrar ficha" en /clientes. Si el tutor no completa, no pasa nada: el
// equipo pregunta los datos al momento del retiro.
//
//   GET  ?t=<token> → datos actuales del borrador + especies + tramos (prefill)
//   POST { t, ...campos } → actualiza el borrador (sigue 'borrador', sin código)
// ─────────────────────────────────────────────────────────────────────────────

function borradorById(rows: Record<string, string>[], id: string) {
  return rows.find(r => String(r.id) === String(id))
}

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('t') || ''
  const v = verifyBorradorToken(token)
  if (!v.ok || !v.clienteId) {
    return NextResponse.json({ error: 'Link inválido o vencido.' }, { status: 400 })
  }
  try {
    const [clientes, especiesRaw, tramos] = await Promise.all([
      getSheetData('clientes'),
      getSheetData('especies'),
      getSheetData('precios_generales'),
    ])
    const c = borradorById(clientes, v.clienteId)
    if (!c) return NextResponse.json({ error: 'Ficha no encontrada.' }, { status: 404 })
    const especies = especiesRaw.filter(e => e.activo === 'TRUE').map(e => ({ id: e.id, nombre: e.nombre, letra: e.letra }))
    // Si ya dejó de ser borrador, el operador ya hizo el ingreso oficial.
    if (c.estado !== 'borrador') {
      return NextResponse.json({ yaIngresada: true, nombre_mascota: c.nombre_mascota || '', especies, tramos })
    }
    return NextResponse.json({
      yaIngresada: false,
      especies,
      tramos,
      borrador: {
        nombre_mascota: c.nombre_mascota || '',
        nombre_tutor: c.nombre_tutor || '',
        email: c.email || '',
        telefono: c.telefono || '',
        direccion_retiro: c.direccion_retiro || '',
        direccion_despacho: c.direccion_despacho || '',
        misma_direccion: (c.misma_direccion || 'TRUE') === 'TRUE',
        comuna: c.comuna || '',
        fecha_retiro: c.fecha_retiro || '',
        fecha_defuncion: c.fecha_defuncion || '',
        especie: c.especie || '',
        letra_especie: c.letra_especie || '',
        peso_declarado: c.peso_declarado || '',
        codigo_servicio: (c.codigo_servicio || 'CI'),
        tipo_servicio: c.tipo_servicio || '',
      },
    })
  } catch (e) {
    console.error('[completar-borrador GET]', e)
    return NextResponse.json({ error: 'No se pudo cargar la información. Intenta nuevamente.' }, { status: 500 })
  }
}

const CompletarSchema = z.object({
  t: z.string().min(1),
  nombre_mascota: z.string().min(1, 'Nombre de mascota requerido'),
  nombre_tutor: z.string().min(1, 'Nombre de tutor requerido'),
  email: z.string().email('Email inválido'),
  telefono: z.string().regex(/^\d{9}$/, 'Teléfono debe tener exactamente 9 dígitos'),
  direccion_retiro: z.string().min(1, 'Dirección de retiro requerida'),
  direccion_despacho: z.string().min(1, 'Dirección de despacho requerida'),
  misma_direccion: z.boolean(),
  comuna: z.string().min(1, 'Comuna requerida'),
  fecha_retiro: z.string().min(1, 'Fecha de retiro requerida'),
  fecha_defuncion: z.string().min(1, 'Fecha de defunción requerida'),
  especie: z.string().min(1, 'Especie requerida'),
  letra_especie: z.string().length(1),
  peso_declarado: z.number().positive(),
  tipo_servicio: z.string().min(1, 'Servicio requerido'),
  codigo_servicio: z.enum(['CI', 'CP', 'SD']),
})

export async function POST(req: NextRequest) {
  try {
    const data = CompletarSchema.parse(await req.json())
    const v = verifyBorradorToken(data.t)
    if (!v.ok || !v.clienteId) {
      return NextResponse.json({ error: 'Link inválido o vencido.' }, { status: 400 })
    }
    await ensureColumns('clientes', [
      'email', 'telefono', 'fecha_defuncion', 'peso_declarado',
      'precio_servicio', 'precio_adicionales', 'precio_total', 'tipo_precios',
    ])
    const clientes = await getSheetData('clientes')
    const c = borradorById(clientes, v.clienteId)
    if (!c) return NextResponse.json({ error: 'Ficha no encontrada.' }, { status: 404 })
    if (c.estado !== 'borrador') {
      // El operador ya hizo el ingreso oficial: no se puede sobreescribir por el link.
      return NextResponse.json({ yaIngresada: true }, { status: 409 })
    }

    // Snapshot de precio (cliente general), igual que la ficha pública. NO se
    // genera código ni se manda correo: eso es del operador al "Registrar".
    const snapshot = await calcularSnapshotFicha({
      peso: data.peso_declarado,
      codigo_servicio: data.codigo_servicio,
      tipo_precios: 'general',
      adicionales: [],
    })

    const direccionDespacho = data.misma_direccion ? data.direccion_retiro : data.direccion_despacho
    // Merge sobre la fila existente (updateById reescribe la fila completa).
    await updateById('clientes', v.clienteId, {
      ...c,
      nombre_mascota: capitalizarNombre(data.nombre_mascota),
      nombre_tutor: capitalizarNombre(data.nombre_tutor),
      email: data.email,
      telefono: data.telefono,
      direccion_retiro: data.direccion_retiro,
      direccion_despacho: direccionDespacho,
      misma_direccion: data.misma_direccion ? 'TRUE' : 'FALSE',
      comuna: data.comuna,
      fecha_retiro: data.fecha_retiro,
      fecha_defuncion: data.fecha_defuncion,
      especie: data.especie,
      letra_especie: data.letra_especie,
      peso_declarado: String(data.peso_declarado),
      tipo_servicio: data.tipo_servicio,
      codigo_servicio: data.codigo_servicio,
      tipo_precios: 'general',
      precio_servicio: snapshot.precio_servicio,
      precio_adicionales: snapshot.precio_adicionales,
      precio_total: snapshot.precio_total,
      // estado y codigo NO se tocan: sigue 'borrador' sin código. El ingreso
      // oficial (código + correo) lo hace el operador al "Registrar ficha".
    })

    return NextResponse.json({ ok: true, nombre_mascota: data.nombre_mascota })
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: e.issues[0]?.message ?? 'Datos inválidos' }, { status: 400 })
    }
    console.error('[completar-borrador POST]', e)
    return NextResponse.json({ error: 'No se pudo guardar. Revisa los datos e intenta nuevamente.' }, { status: 400 })
  }
}
