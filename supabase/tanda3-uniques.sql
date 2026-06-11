-- ─────────────────────────────────────────────────────────────────────────────
-- Tanda 3 — Constraints UNIQUE para cerrar races de concurrencia a nivel DB.
--
-- El código ya hace su parte (updates condicionales atómicos, dedupe por
-- provider_message_id, retry-on-colisión de código), pero la garantía DURA de
-- "no hay duplicados" la da la base de datos. Estos índices únicos convierten
-- una carrera perdida en un error limpio (que el código ya sabe reintentar) en
-- vez de datos corruptos.
--
-- ⚠️ IMPORTANTE: un CREATE UNIQUE INDEX FALLA si ya existen filas duplicadas.
-- Antes de cada índice hay un SELECT para encontrarlas: corré ese SELECT primero,
-- limpiá lo que aparezca, y recién después creá el índice.
--
-- Hay DOS proyectos Supabase distintos (ver CLAUDE.md):
--   • PRINCIPAL  → env SUPABASE_URL            (clientes, asistencia, …)
--   • MENSAJES   → env MENSAJES_SUPABASE_URL   (mensajes_*)
-- Corré cada sección en el SQL editor del proyecto que corresponde.
-- ─────────────────────────────────────────────────────────────────────────────


-- ═══════════════════════════════════════════════════════════════════════════
-- SECCIÓN A — PROYECTO PRINCIPAL (SUPABASE_URL)
-- ═══════════════════════════════════════════════════════════════════════════

-- A1. clientes.codigo único (ignora borradores con codigo vacío).
--     Buscar duplicados primero:
--       select codigo, count(*) from clientes
--       where coalesce(codigo,'') <> '' group by codigo having count(*) > 1;
create unique index if not exists clientes_codigo_uniq
  on "clientes" ("codigo")
  where codigo is not null and codigo <> '';

-- A2. asistencia: una marca por (usuario_id, fecha).
--     Buscar duplicados primero:
--       select usuario_id, fecha, count(*) from asistencia
--       where coalesce(usuario_id,'') <> '' and coalesce(fecha,'') <> ''
--       group by usuario_id, fecha having count(*) > 1;
create unique index if not exists asistencia_usuario_fecha_uniq
  on "asistencia" ("usuario_id", "fecha")
  where usuario_id is not null and usuario_id <> '' and fecha is not null and fecha <> '';


-- ═══════════════════════════════════════════════════════════════════════════
-- SECCIÓN B — PROYECTO MENSAJES (MENSAJES_SUPABASE_URL)
-- ═══════════════════════════════════════════════════════════════════════════

-- B1. mensajes_mensajes.provider_message_id único (dedupe de webhooks de Meta;
--     los salientes sin provider_message_id quedan fuera del índice → NULL ok).
--     Buscar duplicados primero:
--       select provider_message_id, count(*) from mensajes_mensajes
--       where provider_message_id is not null
--       group by provider_message_id having count(*) > 1;
create unique index if not exists mensajes_provider_msg_uniq
  on mensajes_mensajes (provider_message_id)
  where provider_message_id is not null;

-- B2. mensajes_contactos.wa_id único (evita contactos duplicados por carrera
--     en upsertContacto).
--     Buscar duplicados primero:
--       select wa_id, count(*) from mensajes_contactos
--       where wa_id is not null group by wa_id having count(*) > 1;
create unique index if not exists mensajes_contactos_wa_uniq
  on mensajes_contactos (wa_id)
  where wa_id is not null;

-- B3. mensajes_conversaciones: una conversación por (contacto_id, canal)
--     (evita duplicadas por carrera en getOrCreateConversacion).
--     Buscar duplicados primero:
--       select contacto_id, canal, count(*) from mensajes_conversaciones
--       group by contacto_id, canal having count(*) > 1;
create unique index if not exists mensajes_conv_contacto_canal_uniq
  on mensajes_conversaciones (contacto_id, canal);
