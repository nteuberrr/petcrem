import { NextResponse } from 'next/server'
import { ensureSheet, ensureColumns } from '@/lib/google-sheets'

// Mapa completo de hojas esperadas con sus columnas.
// Idempotente: si la hoja existe, solo agrega columnas faltantes.
const SHEETS: Record<string, string[]> = {
  clientes: [
    'id', 'codigo', 'nombre_mascota', 'nombre_tutor',
    'email', 'telefono',
    'direccion_retiro', 'direccion_despacho', 'misma_direccion', 'comuna',
    'fecha_retiro', 'fecha_defuncion',
    'especie', 'letra_especie',
    'peso_declarado', 'peso_ingreso',
    'tipo_servicio', 'codigo_servicio',
    'estado', 'ciclo_id', 'despacho_id',
    'veterinaria_id', 'tipo_precios', 'adicionales',
    'notas', 'tipo_pago', 'estado_pago',
    'fecha_creacion',
  ],
  ciclos: [
    'id', 'fecha', 'numero_ciclo', 'litros_inicio', 'litros_fin',
    'mascotas_ids', 'comentarios',
    'hora_inicio', 'hora_fin', 'temperatura_camara',
    'peso_total', 'lt_kg', 'lt_mascota',
    'fecha_creacion',
  ],
  cargas_petroleo: [
    'id', 'fecha', 'litros', 'precio_neto', 'iva', 'especifico',
    'total_bruto', 'notas', 'fecha_creacion',
  ],
  vehiculo_cargas: [
    'id', 'fecha', 'litros', 'km_odometro', 'monto',
    'comentarios', 'fecha_creacion',
  ],
  despachos: [
    'id', 'fecha', 'numero_recorrido', 'mascotas_ids', 'nota', 'fecha_creacion',
  ],
  rendiciones: [
    'id', 'usuario', 'descripcion', 'fecha', 'monto', 'tipo_documento',
    'estado', 'pago_id', 'fecha_creacion',
  ],
  pagos_rendicion: [
    'id', 'fecha_pago', 'usuario_pagado', 'rendicion_ids', 'monto_total',
    'comentarios', 'fecha_creacion',
  ],
  veterinarios: [
    'id', 'nombre', 'rut', 'razon_social', 'giro',
    'direccion', 'comuna', 'telefono', 'correo',
    'nombre_contacto', 'cargo_contacto',
    'tipo_precios', 'precios_especiales', 'activo', 'fecha_creacion',
  ],
  precios_generales: ['id', 'peso_min', 'peso_max', 'precio_ci', 'precio_cp', 'precio_sd'],
  precios_convenio: ['id', 'peso_min', 'peso_max', 'precio_ci', 'precio_cp', 'precio_sd'],
  precios_especiales: ['id', 'veterinaria_id', 'peso_min', 'peso_max', 'precio_ci', 'precio_cp', 'precio_sd'],
  productos: ['id', 'nombre', 'precio', 'foto_url', 'stock', 'activo', 'fecha_creacion'],
  especies: ['id', 'nombre', 'letra', 'activo'],
  tipos_servicio: ['id', 'nombre', 'codigo', 'activo'],
  otros_servicios: ['id', 'nombre', 'precio', 'activo', 'fecha_creacion'],
  usuarios: ['id', 'nombre', 'email', 'password', 'rol', 'activo', 'fecha_creacion'],
  asistencia: [
    'id', 'usuario_id', 'usuario_nombre', 'fecha', 'dia_semana', 'es_findesemana',
    'hora_entrada', 'hora_salida', 'minutos_trabajados', 'minutos_normales', 'minutos_extra',
    'estado_aprobacion', 'aprobado_por', 'comentario', 'fecha_creacion',
  ],
  jornada_config: [
    'id', 'vigente_desde', 'hora_entrada', 'hora_salida', 'precio_hora_extra',
    'creado_por', 'fecha_creacion',
  ],
}

export async function POST() {
  const results: Array<{ hoja: string; ok: boolean; error?: string }> = []
  for (const [nombre, columnas] of Object.entries(SHEETS)) {
    try {
      await ensureSheet(nombre)
      await ensureColumns(nombre, columnas)
      results.push({ hoja: nombre, ok: true })
    } catch (e) {
      results.push({ hoja: nombre, ok: false, error: String(e) })
    }
  }
  const okCount = results.filter(r => r.ok).length
  return NextResponse.json({ ok: okCount === results.length, total: results.length, ok_count: okCount, results })
}

export async function GET() {
  return POST()
}
