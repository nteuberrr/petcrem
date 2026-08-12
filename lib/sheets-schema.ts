// Mapa canónico de hojas/tablas esperadas con sus columnas. ÚNICA fuente de
// verdad del esquema: lo consumen /api/init-sheets (crea/parcha las hojas) y
// scripts/generar-schema-sql.ts (DDL de Postgres). Al sumar columna/hoja,
// editar acá.
export const SHEETS: Record<string, string[]> = {
  clientes: [
    'id', 'codigo', 'nombre_mascota', 'nombre_tutor',
    'email', 'telefono',
    // depto: n° de departamento/oficina cuando la dirección de retiro es un edificio
    // (para que el chofer sepa dónde tocar). Opcional, texto libre ('' si no aplica).
    'direccion_retiro', 'direccion_despacho', 'misma_direccion', 'depto', 'comuna',
    // hora_retiro (HH:MM): junto con fecha_retiro determina si aplica el recargo
    // automático "fuera de horario" (>=18:00 L-V, o sáb/dom) — lib/adicionales-auto.ts.
    'fecha_retiro', 'hora_retiro', 'fecha_defuncion', 'fecha_nacimiento',
    'especie', 'letra_especie',
    'peso_declarado', 'peso_ingreso',
    'tipo_servicio', 'codigo_servicio',
    'estado', 'ciclo_id', 'despacho_id',
    'veterinaria_id', 'tipo_precios', 'adicionales',
    'descuento_id', 'descuento_nombre', 'descuento_tipo', 'descuento_valor', 'descuento_monto',
    'precio_servicio', 'precio_adicionales', 'precio_total',
    // AJUSTE ADMIN: rebaja manual sobre el total, SOLO del dueño (rol admin). Es un
    // monto positivo que se RESTA del total (un negativo lo sube). Va aparte del
    // `descuento_*`, que sale del catálogo de convenios y solo toca la cremación:
    // este es una decisión puntual sobre el precio final. Se guarda quién y cuándo
    // porque cambia lo que se factura.
    'ajuste_admin', 'ajuste_admin_motivo', 'ajuste_admin_por', 'ajuste_admin_fecha',
    // fecha_pago (ISO): el día en que la venta se cobró de verdad. Es la fecha con
    // la que Ventas POS arma cada día y calcula el abono de Haulmer (día hábil
    // siguiente); sin ella no hay forma de cuadrar contra la liquidación.
    'notas', 'tipo_pago', 'estado_pago', 'fecha_pago',
    // Si 'TRUE', el correo de entrega va SIN el pedido de evaluación (clientes conflictivos).
    'omitir_evaluacion',
    // JSON array de URLs (R2) de fotos que el tutor sube desde /subir-foto para
    // incluir una en el certificado de cremación.
    'fotos_mascota',
    // JSON array de URLs (R2) de fotos que el tutor sube para el CUADRO acuarela
    // conmemorativo (solo servicio Premium/CP): /subir-foto?tipo=cuadro.
    'fotos_cuadro',
    // JSON array de URLs (R2) de videos del servicio que sube el operador; se
    // pueden adjuntar al correo del certificado.
    'videos_servicio',
    // Fecha ISO en que el tutor pidió el video del proceso desde /solicitar-video
    // ('' = no lo pidió). Antes esto era una marca dentro de `notas`; se sacó de
    // ahí porque `notas` es solo para comentarios manuales (lib/video-solicitado.ts).
    'video_solicitado',
    // MEMORIAL EN REDES (lib/memorial.ts). El tutor autoriza —opt-in explícito,
    // desde el mismo link con que sube la foto del certificado— que publiquemos
    // un homenaje en Instagram, y puede dejarle una dedicatoria. La historia sale
    // sola cuando la mascota queda ENTREGADA; `memorial_publicado_at` es la
    // guarda de idempotencia (si tiene fecha, no se vuelve a publicar).
    'memorial_consentimiento', 'memorial_consentimiento_fecha', 'memorial_comentario',
    'memorial_publicado_at', 'memorial_story_id', 'memorial_plantilla',
    // JSON array de URLs (R2) de fotos de EVIDENCIA del peso real, que sube el
    // operador cuando hay diferencia de tramo (peso_ingreso > peso_declarado).
    'fotos_evidencia',
    // JSON array de URLs (R2) de las fotos que saca el REPARTIDOR al entregar,
    // desde la hoja de ruta compartida (lib/despacho-entrega). Se copian acá
    // además del blob `despachos.entregas` porque la ficha es el archivo
    // permanente: la ruta se edita o se borra, y la constancia se perdería.
    'fotos_entrega',
    // Correo de cobro por diferencia de peso: fecha de envío + monto cobrado
    // (vacío = no enviado). Lo setea /api/clientes/[id]/cobro-diferencia.
    'correo_diferencia_fecha', 'correo_diferencia_monto',
    // id del documento_tributarios (factura al veterinario) que ya cubrió esta
    // ficha; vacío = no facturada aún (la excluye de la próxima propuesta mensual).
    'factura_vet_id',
    // id de la boleta (39) emitida AL TUTOR al pagar la ficha; vacío = no emitida
    // (guard de idempotencia del auto-emisor).
    'boleta_id',
    // Ánfora de greda descontada del stock por esta ficha (solo Cremación
    // Individual, por tramo de peso: 0-10 S / 10-30 M / 30+ L — lib/greda-stock.ts).
    // '' = ficha legada (sin tracking, no tocar) · '-' = tracked pero sin greda
    // (otro servicio / sin peso) · '<id>' = producto de Bodega descontado.
    'greda_descontada',
    'origen', 'fecha_creacion',
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
    // partida_id: partida del EERR para las rendiciones con BOLETA que sean
    // clasificacion=rendicion (las de factura no se asignan; vienen del SII).
    // tipo_documento: boleta | factura | '' (vacío para aportes).
    // clasificacion: rendicion | aporte. "aporte" = préstamo a la empresa, se
    // clasifica pero NO va al resultado del EERR. ("manual" vive en eerr_gastos_manuales.)
    'partida_id', 'clasificacion',
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
    // precios_indexados: '' | 'general' | 'convenio'. Si viene con valor, los tramos
    // de esta vet en `precios_especiales` son una copia VIVA de esa tabla base y se
    // re-sincronizan al tocarla (lib/precios-indexados.ts).
    'precios_indexados',
  ],
  precios_generales: ['id', 'peso_min', 'peso_max', 'precio_ci', 'precio_cp', 'precio_sd'],
  precios_convenio: ['id', 'peso_min', 'peso_max', 'precio_ci', 'precio_cp', 'precio_sd'],
  precios_especiales: ['id', 'veterinaria_id', 'peso_min', 'peso_max', 'precio_ci', 'precio_cp', 'precio_sd'],
  productos: ['id', 'nombre', 'categoria', 'precio', 'foto_url', 'stock', 'activo', 'mostrar_web', 'fecha_creacion'],
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
  // auto_regla: '' | 'fuera_horario' | 'distancia' — el servicio se pre-carga solo en
  // la ficha (deseleccionable) cuando aplica; comunas = JSON array de nombres (solo
  // para 'distancia'). Reglas en lib/adicionales-auto.ts.
  otros_servicios: ['id', 'nombre', 'precio', 'activo', 'auto_regla', 'comunas', 'fecha_creacion'],
  // Cobros que perseguimos por ficha: producto ADICIONAL agregado o DIFERENCIA
  // de peso. estado: pendiente → cliente_confirmo → pagado.
  // boleta_id: boleta (39) emitida por ESE cobro al confirmarse el pago (guard de
  // idempotencia + trazabilidad). Solo 'adicional' y 'diferencia'; el 'saldo'
  // cierra la ficha y su boleta va en clientes.boleta_id.
  cobros: ['id', 'cliente_id', 'tipo', 'detalle', 'monto', 'estado', 'message_id', 'fecha_creacion', 'fecha_cliente_confirmo', 'fecha_pagado', 'boleta_id'],
  descuentos: ['id', 'nombre', 'tipo', 'valor', 'activo', 'foto_url', 'mostrar_web', 'fecha_creacion'],
  // ── Comisiones de convenio (Configuración → Descuentos Convenios) ──────────
  // A estos vets NO se les factura: la boleta va al TUTOR por el precio completo
  // (su tabla de precios especiales se deja igual a la general) y al vet le queda
  // una comisión por la derivación. Ver lib/comisiones.ts.
  // Regla vigente por veterinaria: 'fijo' (CLP) | 'variable' (% sobre la cremación).
  comisiones_reglas: ['id', 'veterinaria_id', 'tipo', 'valor', 'activo', 'fecha_creacion'],
  // Devengo: UNA por ficha (cliente_id único). Nace al emitirle la boleta al tutor
  // y pasa a 'anulada' si esa boleta se anula con nota de crédito.
  comisiones: [
    'id', 'veterinaria_id', 'cliente_id', 'documento_id',
    'base_monto', 'tipo', 'valor', 'monto',
    'estado', 'fecha_devengo', 'fecha_creacion',
  ],
  // Ajustes de saldo (lo que se le paga al vet). Cada uno deja su contrapartida
  // en eerr_gastos_manuales (partida de tipo 'costo') — único golpe al EERR.
  comisiones_ajustes: [
    'id', 'veterinaria_id', 'monto', 'detalle', 'fecha',
    'gasto_manual_id', 'creado_por_id', 'creado_por_nombre', 'fecha_creacion',
  ],
  // perfil_id → tabla `perfiles`: define qué módulos ve/edita la persona
  // (lib/permisos). El `rol` quedó solo para distinguir al dueño ('admin').
  usuarios: ['id', 'nombre', 'email', 'password', 'rol', 'activo', 'fecha_creacion', 'telefono', 'avisos_whatsapp', 'perfil_id'],
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
  // Conciliación de ventas SII vs sistema, un registro por período YYYY-MM.
  // ⚠️ En Postgres esto NO crea nada: correr supabase/conciliacion-sii.sql.
  conciliacion_sii: [
    'id', 'periodo', 'sii_json', 'docs_json', 'fecha_carga', 'fecha_creacion',
  ],
  documentos_tributarios: [
    'id', 'tipo_dte', 'folio', 'estado', 'ambiente', 'fecha_emision',
    'receptor_tipo', 'receptor_id', 'receptor_rut', 'receptor_razon_social',
    'receptor_giro', 'receptor_direccion', 'receptor_comuna', 'receptor_correo',
    'monto_neto', 'monto_iva', 'monto_total',
    'detalle_json', 'resumen', 'mes_facturado', 'fichas_json',
    'openfactura_url', 'pdf_key', 'pdf_url',
    'documento_anulado_id', 'nc_id', 'motivo_anulacion', 'warnings_json',
    'creado_por_id', 'creado_por_nombre', 'fecha_creacion',
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
    // seguimiento_tipos: JSON {key_correo: bool} para activar/desactivar la copia
    // de seguimiento POR TIPO de correo (vacío = todos los tipos copian).
    'seguimiento_tipos',
    // correos_desactivados: JSON {key_correo: true} con los correos PAUSADOS —
    // no se le envían al destinatario. Solo guarda los apagados: vacío = todos
    // se envían. Lo aplica lib/resend-mailer para cualquier transaccional.
    'correos_desactivados',
    // Datos de transferencia bancaria (correo de cobro de diferencia de peso).
    'titular_cuenta', 'banco', 'tipo_cuenta', 'numero_cuenta',
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
  // Correos transaccionales al tutor (registro, inicio cremación, inicio
  // despacho, entrega, certificado). Se registran al enviar y el webhook de
  // Resend reconcilia entregado/abierto/rebotado por message_id. Alimentan el
  // bloque "Correos al tutor" de la ficha y la alerta de rebote del email.
  // tipo: registro | inicio_cremacion | inicio_despacho | entrega | certificado
  // estado: enviado | entregado | abierto | clic | rebotado | spam | fallido
  correos_cliente: [
    'id', 'cliente_id', 'tipo', 'email', 'message_id',
    'estado', 'motivo', 'fecha_envio', 'fecha_actualizacion',
  ],
  // Registro/respaldo de TODOS los correos transaccionales enviados (cliente +
  // vet + eutanasia; NO las campañas de mailing). Guarda el cuerpo HTML (sin
  // adjuntos) para poder reabrir el correo. Lo escribe sendEmail/sendBatch cuando
  // recibe el campo `seguimiento`. Visor en Configuración → Correos.
  correos_log: [
    'id', 'fecha_envio', 'tipo', 'audiencia', 'destinatario', 'asunto',
    'cliente_id', 'codigo', 'nombre', 'message_id', 'estado', 'motivo',
    'html', 'fecha_creacion',
  ],
  // Banco de imágenes para campañas (generadas con Nano Banana Pro o subidas a
  // mano). Viven en R2 (url/key) y se RECICLAN entre correos: el generador IA
  // revisa este banco y reutiliza una imagen existente cuando calza con el
  // contexto, en vez de generar otra. descripcion + tags alimentan ese match.
  // origen: 'ai' (generada) | 'upload' (subida). aspect ej. '16:9'.
  mailing_imagenes: [
    'id', 'url', 'key',
    // codigo: identificador legible y estable para REFERIRSE a la imagen (en el chat
    // del agente y en el banco). i-N = foto suelta/subida; C-X.Y = pieza de campaña
    // (portada/placa/carrusel, X=campaña, Y=índice). Lo asigna el backend al crear.
    'codigo',
    'descripcion', 'prompt', 'tags', 'alt',
    // grupo: clasificación que asigna el equipo (mascotas | personas | productos
    // | instalaciones | otro). 'instalaciones' SOLO existe en imágenes SUBIDAS por
    // el equipo — la IA nunca genera fotos de instalaciones.
    'grupo',
    // subgrupo: etiqueta libre opcional (ej. por campaña) para ordenar sin crear grupos.
    'subgrupo',
    // whatsapp: TRUE si el agente de WhatsApp puede enviar esta imagen al cliente
    // cuando la pida (ej. fotos de ánforas/urnas). El equipo lo marca a mano.
    'whatsapp',
    // favorita: TRUE si el equipo la marcó con la estrella (destacada en el banco).
    'favorita',
    'aspect', 'ancho', 'alto',
    'origen', 'modelo',
    'creado_por', 'fecha_creacion',
  ],
  // Banco de VIDEOS de campañas (MP4 generados con Veo). Separado del de imágenes.
  // codigo: ai-N = animado desde una imagen; v-N = video generado sin imagen base.
  mailing_videos: [
    'id', 'url', 'key', 'codigo', 'descripcion', 'prompt', 'imagen_origen',
    'aspect', 'duracion', 'modelo', 'favorita', 'creado_por', 'fecha_creacion',
  ],
  // Calendario de campañas multicanal (email | instagram | facebook). Capa de
  // planificación del agente de marketing. estado: propuesta → aprobada →
  // generada → programada → publicada | descartada. El email aprobado puede
  // materializarse en mailing_campanas; el social se publica vía Meta Graph API.
  campaign_calendar: [
    'id', 'fecha', 'hora', 'canal', 'estado', 'activa', 'favorita',
    'objetivo', 'audiencia', 'idea', 'titulo', 'cuerpo',
    'imagen_id', 'imagen_url', 'imagenes_json', 'estilo',
    'campana_id', 'post_externo_id', 'post_url',
    'estado_publicacion', 'error_publicacion',
    'generado_por', 'aprobado_por', 'fecha_publicacion',
    'notas', 'creado_por', 'fecha_creacion',
  ],
  // Config editable del agente de marketing (una sola fila, id=1): instrucciones
  // del equipo + calibración. Espejo de agente_config del inbox.
  marketing_config: [
    'id', 'instrucciones', 'calibracion', 'parametros', 'updated_at',
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
  // Config del módulo de eutanasias (fila única id=1). 'fijo' = cargo fijo que se
  // SUMA al precio del tramo (lo que se paga al vet) para dar el precio AL CLIENTE.
  // fijo = cargo al cliente sobre el pago al vet cuando la eutanasia SÍ se realiza.
  // consulta_vet + consulta_alma = consulta cobrada cuando NO se realiza (total al cliente).
  // recargo_fuera_horario = recargo al cliente si el servicio es fuera de horario (finde/feriado/≥18:00).
  config_eutanasia: ['id', 'fijo', 'consulta_vet', 'consulta_alma', 'recargo_fuera_horario'],
  // Comisión del procesador de pagos (TUU/Haulmer) que descuenta del abono de las
  // ventas por POS y link de pago. Fila única id=1; la edita Facturación → Ventas POS.
  // comision_fija = pesos por transacción · comision_variable = % del total cobrado
  // · iva = % que se le suma a esa comisión. Los tres son NETOS.
  config_pos: ['id', 'comision_fija', 'comision_variable', 'iva', 'fecha_actualizacion'],
  // Cotizaciones de eutanasia que ingresa el admin desde /servicios.
  // - estado: creada | enviada | aceptada | realizada | no_realizada | cancelada
  // - vet_id_asignado: vacío hasta que un vet acepta; luego queda fijo.
  // - precio_snapshot: monto que se paga al vet si se REALIZA (tramo), congelado al crear.
  // - consulta_vet_snapshot: monto al vet si NO se realiza, congelado al agendar.
  // - cliente_id: ficha borrador de cremación ligada (dashboard + borrado en no_realizada).
  cotizaciones_eutanasia: [
    'id',
    'mascota_nombre', 'especie', 'peso',
    'cliente_nombre', 'cliente_telefono', 'cliente_email',
    // wa_id completo del cliente (con código país) cuando la cotización nace del
    // bot de WhatsApp — para avisarle por WhatsApp cuando un vet acepta.
    'cliente_wa_id',
    'direccion', 'comuna',
    'fecha_servicio', 'hora_servicio',
    // Hora ACORDADA con el cliente que el vet informa desde su link; la agenda del
    // crematorio muestra el retiro ~30 min después. ⚠️ Sin esta columna en el mapa,
    // rowForWrite la descartaba en TODO write → el vet informaba la hora y nunca se
    // guardaba (la columna sí existe en Postgres y se leía, por eso pasó inadvertido).
    'hora_retiro_crematorio',
    // Servicio de cremación que el cliente eligió para DESPUÉS de la eutanasia
    // (CI | CP | SD). Se agendan ambos servicios.
    'tipo_servicio_cremacion',
    // ¿Incluye cremación posterior? 'TRUE'/'FALSE'. Sin cremación: recordatorio
    // gris en el calendario, sin notificación ni bloqueo de agenda (ver lib/eutanasia-cremacion).
    'incluye_cremacion',
    'notas',
    'estado',
    'vet_id_asignado', 'vet_nombre_asignado', 'vet_email_asignado',
    'precio_snapshot', 'consulta_vet_snapshot',
    // Ficha borrador de cremación ligada a esta eutanasia (creada al agendar).
    'cliente_id',
    // Estado de pago, aplicable cuando estado='realizada' o 'no_realizada'. Valores:
    // 'pendiente_pago' (default) | 'pago_confirmado' (el admin lo marca tras transferir).
    'estado_pago', 'fecha_pago',
    // El cliente confirmó (por su link de WhatsApp) que coordinó la visita con el vet.
    'cliente_confirmo', 'fecha_cliente_confirmacion',
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
  // Solicitudes de retiro de cremación que el agente de WhatsApp registra y envía
  // al admin para confirmar/rechazar (Flujo A). estado: pendiente | confirmada | rechazada.
  solicitudes_retiro: [
    'id', 'cliente_wa_id', 'cliente_nombre', 'nombre_mascota',
    'peso', 'direccion', 'comuna', 'fecha_retiro', 'hora_retiro', 'tipo_servicio',
    'estado', 'fecha_creacion', 'fecha_resolucion',
    // origen: 'bot_tutor' (default) | 'bot_vet'. Para las de vet, se guarda el
    // veterinario de convenio (de la hoja `veterinarios`) que originó el retiro:
    // veterinaria_id liga la ficha al vet (tarifas de convenio); vet_nombre/vet_email
    // se usan para el correo de confirmación y los del ciclo.
    'origen', 'veterinaria_id', 'vet_nombre', 'vet_email',
    // cliente_id: ficha borrador (clientes) creada al confirmar el retiro. El
    // dashboard oculta el cuadro confirmado cuando esa ficha ya no es borrador.
    'cliente_id',
  ],
  // Relay de consultas de "¿cuánto falta para el retiro?": el agente avisa al
  // admin y guarda el message_id de ese aviso; cuando el admin RESPONDE CITANDO
  // ese mensaje (context.id), el webhook reenvía su respuesta al cliente.
  // estado: pendiente | respondida.
  relay_retiro: [
    'id', 'admin_msg_id', 'cliente_wa_id', 'cliente_nombre', 'mascota',
    'pregunta', 'estado', 'fecha_creacion', 'fecha_respuesta',
  ],
  // Bloqueos manuales de la agenda (botón "Bloquear agenda" del dashboard): rangos
  // fecha/hora en los que el bot NO puede agendar retiros ni eutanasias. El rango
  // es [inicio, fin): se puede agendar justo a la hora de término. Ver lib/agenda.
  agenda_bloqueos: [
    'id', 'fecha_inicio', 'hora_inicio', 'fecha_fin', 'hora_fin',
    'motivo', 'creado_por', 'fecha_creacion', 'activo',
  ],
  // ── Módulo "Estado de Resultados" (EERR) — DDL real en supabase/eerr-schema.sql ──
  // Partidas del EERR. tipo: ingreso | costo | gasto | impuesto. clave: solo para
  // las de ingreso (calculadas desde ventas): general | convenio | adicionales | eutanasias.
  eerr_partidas: [
    'id', 'tipo', 'nombre', 'clave', 'orden', 'subgrupo_id', 'activo', 'fecha_creacion',
  ],
  // Subgrupos que agrupan partidas dentro de un tipo (con subtotal en el EERR).
  eerr_subgrupos: [
    'id', 'tipo', 'nombre', 'orden', 'fecha_creacion',
  ],
  // Proveedores: contabilización automática por proveedor (rut único).
  eerr_proveedores: [
    'id', 'rut', 'razon_social', 'auto_contabiliza', 'auto_tipo', 'auto_partida_id',
    'fecha_creacion',
  ],
  // Facturas del SII (§2.1). Dedup: rut + tipo_doc + folio. fecha_documento = emisión (mes).
  eerr_gastos_sii: [
    'id', 'tipo_doc', 'tipo_compra', 'rut', 'razon_social', 'folio',
    'fecha_documento', 'fecha_recepcion', 'periodo_sii',
    'monto_exento', 'monto_neto', 'monto_iva', 'monto_total', 'valor_otro_impuesto',
    'comentario', 'tipo_asignacion', 'partida_id', 'contabilizado',
    'fecha_carga', 'fecha_creacion',
  ],
  // Gastos manuales (§2.2) — todo neto.
  eerr_gastos_manuales: [
    'id', 'tipo_asignacion', 'partida_id', 'detalle', 'monto', 'fecha', 'fecha_creacion',
  ],
  // ── Módulo Web (panel administrador del sitio público) ──────────────────────
  // Servicios que se muestran en la web (cremación individual/premium/sin devolución, eutanasia).
  web_servicios: [
    'id', 'nombre', 'slug', 'resumen', 'descripcion', 'foto_url',
    'precio_desde', 'orden', 'publicado', 'seo_titulo', 'seo_desc', 'fecha_creacion',
  ],
  // Blog del sitio.
  web_posts: [
    'id', 'titulo', 'slug', 'categoria', 'extracto', 'contenido', 'foto_url',
    'autor', 'fecha', 'publicado', 'seo_titulo', 'seo_desc', 'fecha_creacion',
  ],
  // Bloques de texto/imagen editables de páginas fijas (home, nosotros, convenios, contacto, eutanasia).
  web_paginas: [
    'id', 'pagina', 'clave', 'titulo', 'contenido', 'foto_url', 'orden', 'fecha_creacion',
  ],
  // ── Avisos automáticos (Configuración Avanzada → Avisos) ────────────────────
  // Una fila por aviso del catálogo (lib/avisos): a quién se manda, a qué hora de
  // Chile y si está activo. `ultimo_envio` (YYYY-MM-DD Chile) es la guarda de "ya
  // salió hoy" — el cron corre cada hora y solo dispara el que toca.
  avisos_config: [
    'id', 'clave', 'activo', 'destinatarios', 'hora',
    'omitir_vacio', 'ultimo_envio', 'fecha_actualizacion',
  ],
  // Registro de los avisos que el bot manda al EQUIPO por WhatsApp: es lo que
  // permite enterarse de que uno NO se entregó (Meta lo acepta y recién después
  // reporta `failed`). Ver supabase/avisos-equipo.sql y lib/avisos-equipo.ts.
  avisos_equipo: [
    'id', 'numero', 'tipo', 'cuerpo', 'provider_message_id',
    'estado', 'error', 'reintento_json', 'es_reintento',
    'fecha_creacion', 'fecha_estado',
  ],
  // ── Módulo Remuneraciones (RRHH) ────────────────────────────────────────────
  // Reemplaza el Excel con Solver que se corría a mano cada mes. DDL completo
  // (con índices y el enganche al EERR) en supabase/remuneraciones.sql.
  //
  // El trabajador nunca se borra (rompería el histórico): se desactiva.
  // `modalidad_variable`: meta_liquido = el solver ajusta el bono hasta que el
  // líquido dé sueldo_base + valor_por_cremacion × cremaciones del mes.
  rrhh_empleados: [
    'id', 'usuario_id', 'nombre_completo', 'rut', 'fecha_nacimiento', 'nacionalidad',
    'direccion', 'comuna', 'email', 'telefono',
    'cargo', 'unidad_negocio', 'tipo_contrato', 'fecha_ingreso', 'fecha_termino',
    'jornada_semanal_horas',
    'sueldo_base', 'modalidad_variable', 'valor_por_cremacion', 'haberes_no_imponibles',
    'afp', 'prevision_salud', 'isapre_codigo', 'plan_salud_uf', 'apv_monto', 'apv_institucion',
    'banco', 'tipo_cuenta', 'numero_cuenta',
    'activo', 'notas', 'fecha_creacion',
  ],
  // Valores legales POR PERÍODO (YYYY-MM). Es lo que impide que el módulo
  // envejezca: los topes imponibles se reajustan cada año y el aporte
  // previsional del empleador (Ley 21.735) sube todos los años hasta 2033.
  rrhh_parametros: [
    'id', 'periodo', 'valor_uf', 'valor_utm', 'imm',
    'tope_afp_uf', 'tope_afc_uf', 'tasas_afp', 'tramos_impuesto',
    'tasa_afc_trabajador', 'tasa_afc_empleador_indefinido', 'tasa_afc_empleador_plazo_fijo',
    'tasa_mutual', 'tasa_sis', 'tasa_cuenta_individual', 'tasa_fapp', 'tasa_seguro_social',
    'factor_gratificacion', 'tope_gratificacion_imm',
    'dias_habiles', 'dias_descanso', 'notas', 'fecha_creacion',
  ],
  // Una por empleado y período. `detalle_json` guarda cada línea con su fórmula;
  // `parametros_json` congela los parámetros usados, para que reimprimir enero
  // en diciembre dé exactamente el mismo PDF.
  rrhh_liquidaciones: [
    'id', 'periodo', 'empleado_id', 'empleado_nombre', 'estado',
    'cremaciones', 'meta_liquido', 'variable_imponible',
    'total_imponible', 'total_no_imponible', 'total_haberes', 'total_descuentos',
    'impuesto_unico', 'liquido', 'reembolso_salud', 'total_a_transferir',
    'aportes_empleador', 'costo_empresa', 'exacto', 'diferencia_meta',
    'detalle_json', 'parametros_json', 'novedades_json',
    'pdf_key', 'pdf_url', 'fecha_pago', 'cerrada_por', 'fecha_creacion',
  ],
  // La orden de pago del mes (lo que efectivamente se transfiere).
  rrhh_pagos: [
    'id', 'periodo', 'liquidacion_ids', 'total_liquidos', 'total_reembolsos',
    'total_transferido', 'costo_empresa', 'fecha_pago', 'comentarios',
    'creado_por', 'fecha_creacion',
  ],
}
