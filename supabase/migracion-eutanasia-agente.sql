-- Migración: flujo de eutanasia del agente de WhatsApp (Fase 1).
-- Correr en el SQL editor del proyecto Supabase "Alma Animal" (= SUPABASE_URL).
-- Idempotente: ADD COLUMN IF NOT EXISTS. No toca datos existentes.
--
-- En Postgres ensureColumns() es no-op, así que las columnas nuevas que usa el
-- código deben crearse acá antes de desplegar / probar en local.

alter table cotizaciones_eutanasia
  -- Servicio de cremación elegido para DESPUÉS de la eutanasia (CI | CP | SD).
  add column if not exists tipo_servicio_cremacion text not null default '',
  -- El cliente (tutor) confirmó por su link de WhatsApp que coordinó la visita.
  add column if not exists cliente_confirmo text not null default '',
  add column if not exists fecha_cliente_confirmacion text not null default '';
