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
    'descuento_id', 'descuento_nombre', 'descuento_tipo', 'descuento_valor', 'descuento_monto',
    'precio_servicio', 'precio_adicionales', 'precio_total',
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
    'id', 'fecha', 'numero_recorrido', 'numero_global', 'mascotas_ids', 'nota', 'fecha_creacion',
    // Ruta viva: estado del recorrido y datos de la ruta optimizada.
    // estado_ruta: guardada | en_curso | terminada
    'estado_ruta',
    'origen_direccion', 'origen_lat', 'origen_lng',
    'destino_direccion', 'destino_lat', 'destino_lng',
    // paradas: JSON ordenado [{cliente_id, lat, lng, direccion, orden}]
    'paradas',
    // entregas: JSON { [cliente_id]: { fecha_hora: ISO } } — solo las ya entregadas
    'entregas',
    'hora_inicio_ruta', 'hora_termino_ruta', 'fecha_realizada',
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
  productos: ['id', 'nombre', 'categoria', 'precio', 'foto_url', 'stock', 'activo', 'fecha_creacion'],
  categorias_productos: ['id', 'nombre', 'activo', 'fecha_creacion'],
  informes_veterinaria: [
    'id', 'veterinaria_id', 'veterinaria_nombre',
    'version',
    'formato', // 'excel' | 'pdf'
    'periodo_hasta_mes',  // 'YYYY-MM' del último mes incluido (referencia)
    'cantidad_meses', 'cantidad_fichas', 'monto_total_clp',
    'fecha_emision', 'hora_emision',
    'emitido_por_id', 'emitido_por_nombre',
    'archivo_key', 'archivo_url',
    'fecha_creacion',
  ],
  especies: ['id', 'nombre', 'letra', 'activo'],
  tipos_servicio: ['id', 'nombre', 'codigo', 'plazo_entrega_dias', 'activo'],
  otros_servicios: ['id', 'nombre', 'precio', 'activo', 'fecha_creacion'],
  descuentos: ['id', 'nombre', 'tipo', 'valor', 'activo', 'fecha_creacion'],
  usuarios: ['id', 'nombre', 'email', 'password', 'rol', 'activo', 'fecha_creacion'],
  asistencia: [
    'id', 'usuario_id', 'usuario_nombre', 'fecha', 'dia_semana', 'es_findesemana',
    'hora_entrada', 'hora_salida', 'minutos_trabajados', 'minutos_normales', 'minutos_extra',
    'estado_aprobacion', 'aprobado_por', 'comentario', 'fecha_creacion',
  ],
  jornada_config: [
    'id', 'vigente_desde', 'hora_entrada', 'hora_salida', 'precio_hora_extra',
    'tolerancia_minutos', 'precio_retiro_adicional', 'creado_por', 'fecha_creacion',
  ],
  retiros_adicionales: [
    'id', 'usuario_id', 'usuario_nombre', 'fecha', 'hora',
    'cliente_nombre', 'comentario', 'pago_id', 'fecha_creacion',
  ],
  pagos_retiros: [
    'id', 'fecha_pago', 'usuario_id', 'usuario_nombre',
    'retiros_ids', 'cantidad', 'monto_total', 'comentarios',
    'creado_por', 'fecha_creacion',
  ],
  certificados: [
    'id', 'cliente_id', 'codigo_mascota', 'nombre_mascota',
    'version',
    'fecha_emision', 'hora_emision',
    'emitido_por_id', 'emitido_por_nombre',
    'sin_foto', 'pdf_key', 'pdf_url',
    'enviado_ultima_fecha', 'enviado_ultima_hora', 'enviado_cantidad', 'enviado_a',
    'fecha_creacion',
  ],
  geocoding_cache: [
    'id', 'direccion_normalizada', 'direccion_original',
    'lat', 'lng', 'formatted_address',
    'fecha_creacion',
  ],
  empresa_config: [
    'id', 'nombre', 'rut', 'giro',
    'direccion', 'comuna',
    'telefono', 'correo',
    'web', 'instagram', 'facebook',
    'google_review_url', 'email_seguimiento', 'email_seguimiento_activo',
    'fecha_actualizacion',
  ],
  mailing_veterinarios: [
    'id', 'nombre', 'email',
    'veterinaria', 'comuna', 'telefono',
    'categoria', 'tamano_veterinaria', 'suscrito', 'notas',
    'fecha_creacion',
  ],
  mailing_campanas: [
    'id', 'asunto',
    'html_key', 'html_url',
    'preview_text', 'reply_to',
    'fecha_envio', 'hora_envio',
    'total_destinatarios',
    'enviados', 'entregados', 'aperturas', 'clicks',
    'rebotes', 'spam', 'fallidos',
    'estado', 'filtros_json',
    'attachments_json',
    'creado_por', 'fecha_creacion',
  ],
  mailing_logs: [
    'id', 'campana_id',
    'vet_email', 'vet_nombre',
    'resend_message_id',
    'estado',
    'fecha_envio', 'fecha_entrega',
    'fecha_apertura', 'fecha_click', 'fecha_rebote',
    'motivo_rebote', 'url_clickeada',
    'error_msg',
    'fecha_creacion',
  ],
  // Convenio de eutanasias a domicilio. Vets se inscriben en /convenio-eutanasias
  // (auto-aprobado) o los carga el admin manualmente.
  // - comunas: JSON array de nombres de comuna donde puede atender.
  // - horarios: JSON object { lun: {am: bool, pm: bool}, mar: {...}, ... }
  // - rut: opcional, formato 12345678-9.
  // - origen: 'manual' (cargado por admin) | 'publico' (inscripto desde landing).
  vet_convenio_eutanasia: [
    'id', 'nombre', 'apellido', 'email', 'telefono', 'rut',
    'comunas', 'horarios',
    'activo', 'origen', 'notas',
    'total_servicios',
    // Datos bancarios para transferencia del pago. Se completan vía
    // /eutanasia/datos-pago/<token> desde el link del mail de bienvenida.
    'banco', 'tipo_cuenta', 'numero_cuenta',
    'datos_pago_completos', 'fecha_datos_pago',
    'fecha_inscripcion', 'fecha_creacion',
  ],
  // Tabla de precios que se le paga al vet por servicio de eutanasia, segmentada
  // solo por tramo de peso (no por especie). Mismo precio para todos los vets.
  precios_eutanasia: ['id', 'peso_min', 'peso_max', 'precio'],
  // Cotizaciones de eutanasia que ingresa el admin desde /servicios.
  // - estado: creada | enviada | aceptada | confirmada | realizada | cancelada
  // - vet_id_asignado: vacío hasta que un vet acepta; luego queda fijo.
  // - precio_snapshot: monto que se paga al vet, congelado al momento de crear.
  cotizaciones_eutanasia: [
    'id',
    'mascota_nombre', 'especie', 'peso',
    'cliente_nombre', 'cliente_telefono', 'cliente_email',
    'direccion', 'comuna',
    'fecha_servicio', 'hora_servicio',
    'notas',
    'estado',
    'vet_id_asignado', 'vet_nombre_asignado', 'vet_email_asignado',
    'precio_snapshot',
    // Estado de pago, aplicable cuando estado='realizada'. Valores:
    // 'pendiente_pago' (default al marcar realizada) | 'pago_confirmado'
    // (el admin lo marca después de transferir).
    'estado_pago', 'fecha_pago',
    'fecha_creacion', 'fecha_envio_cotizacion',
    'fecha_aceptacion', 'fecha_confirmacion',
    'fecha_realizacion', 'fecha_cancelacion',
    'creado_por',
  ],
  // Log de a qué vets se envió cada cotización, con el resultado individual.
  // estado_envio: enviada | aceptada | rechazada | expirada
  cotizaciones_eutanasia_envios: [
    'id', 'cotizacion_id', 'vet_id', 'vet_email',
    'fecha_envio', 'fecha_respuesta',
    'estado_envio',
    'resend_message_id',
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
