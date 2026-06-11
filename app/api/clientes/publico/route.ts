import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSheetData, appendRow, getNextId, ensureColumns } from '@/lib/datastore'
import { generarCodigo } from '@/lib/codigo-generator'
import { enviarRegistroMascota } from '@/lib/cliente-mailer'
import { todayISO } from '@/lib/dates'
import { calcularSnapshotFicha } from '@/lib/price-calculator'
import { capitalizarNombre } from '@/lib/nombres'

// ─────────────────────────────────────────────────────────────────────────────
// Registro PÚBLICO de mascota (formulario auto-atención del tutor).
//
// Es la misma ficha que se llena manual en /clientes, pero acotada a un cliente
// GENERAL: siempre "sin veterinaria" (tipo_precios = general), sin adicionales,
// descuentos ni datos de pago (eso lo gestiona el admin después). El tutor solo
// entrega lo necesario para crear la ficha y ver el precio del servicio.
//
// Ruta whitelisteada en proxy.ts (no requiere sesión).
//   GET  → metadata para el form (especies activas + tramos de precios_generales)
//   POST → crea la ficha y dispara el mail de bienvenida con el código.
// ─────────────────────────────────────────────────────────────────────────────

export async function GET() {
  try {
    const [especiesRaw, tramos] = await Promise.all([
      getSheetData('especies'),
      getSheetData('precios_generales'),
    ])
    const especies = especiesRaw
      .filter((e) => e.activo === 'TRUE')
      .map((e) => ({ id: e.id, nombre: e.nombre, letra: e.letra }))
    return NextResponse.json({ especies, tramos })
  } catch (e) {
    console.error('[clientes/publico GET]', e)
    return NextResponse.json({ error: 'No se pudo cargar la información. Intenta nuevamente.' }, { status: 500 })
  }
}

const RegistroPublicoSchema = z.object({
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
    const body = await req.json()
    const data = RegistroPublicoSchema.parse(body)
    data.nombre_mascota = capitalizarNombre(data.nombre_mascota)
    data.nombre_tutor = capitalizarNombre(data.nombre_tutor)
    await ensureColumns('clientes', [
      'email', 'telefono',
      'veterinaria_id', 'adicionales', 'tipo_precios',
      'peso_declarado', 'peso_ingreso', 'despacho_id',
      'descuento_id', 'descuento_nombre', 'descuento_tipo', 'descuento_valor', 'descuento_monto',
      'fecha_defuncion', 'notas', 'tipo_pago', 'estado_pago',
      'precio_servicio', 'precio_adicionales', 'precio_total', 'origen',
    ])
    const codigo = await generarCodigo(data.letra_especie, data.codigo_servicio)
    const id = await getNextId('clientes')
    const now = todayISO()

    // Cliente general → tabla de precios_generales (sin veterinaria, sin adicionales,
    // sin descuento). Congelamos el snapshot igual que la ficha manual.
    const snapshot = await calcularSnapshotFicha({
      peso: data.peso_declarado,
      codigo_servicio: data.codigo_servicio,
      tipo_precios: 'general',
      adicionales: [],
    })

    const row = {
      id,
      codigo,
      nombre_mascota: data.nombre_mascota,
      nombre_tutor: data.nombre_tutor,
      email: data.email,
      telefono: data.telefono,
      direccion_retiro: data.direccion_retiro,
      direccion_despacho: data.misma_direccion ? data.direccion_retiro : data.direccion_despacho,
      misma_direccion: data.misma_direccion ? 'TRUE' : 'FALSE',
      comuna: data.comuna,
      fecha_retiro: data.fecha_retiro,
      fecha_defuncion: data.fecha_defuncion,
      especie: data.especie,
      letra_especie: data.letra_especie,
      peso_declarado: data.peso_declarado,
      peso_ingreso: '',
      tipo_servicio: data.tipo_servicio,
      codigo_servicio: data.codigo_servicio,
      estado: 'pendiente',
      ciclo_id: '',
      despacho_id: '',
      veterinaria_id: '',
      tipo_precios: 'general',
      adicionales: '[]',
      descuento_id: '',
      descuento_nombre: '',
      descuento_tipo: '',
      descuento_valor: '',
      descuento_monto: '0',
      precio_servicio: snapshot.precio_servicio,
      precio_adicionales: snapshot.precio_adicionales,
      precio_total: snapshot.precio_total,
      // Datos de pago los completa el admin (queda como "datos pendientes" en /clientes).
      tipo_pago: '',
      estado_pago: 'pendiente',
      origen: 'registro_publico',
      fecha_creacion: now,
    }
    await appendRow('clientes', row)

    // Mail de bienvenida con el código (best-effort).
    try {
      await enviarRegistroMascota({
        email: row.email,
        nombreMascota: row.nombre_mascota,
        nombreTutor: row.nombre_tutor,
        codigo: row.codigo,
      })
    } catch (e) {
      console.warn('[clientes/publico POST] fallo mail registro (no bloqueante):', e)
    }

    return NextResponse.json({
      codigo: row.codigo,
      nombre_mascota: row.nombre_mascota,
      precio_total: snapshot.precio_total,
    }, { status: 201 })
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: e.issues[0]?.message ?? 'Datos inválidos' }, { status: 400 })
    }
    console.error('[clientes/publico POST]', e)
    return NextResponse.json({ error: 'No se pudo completar el registro. Revisa los datos e intenta nuevamente.' }, { status: 400 })
  }
}
