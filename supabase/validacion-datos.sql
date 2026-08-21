-- VALIDACIÓN DE LOS DATOS DE LA FICHA POR EL TUTOR
--
-- Al registrar la ficha se le manda al tutor un WhatsApp con los datos que
-- tenemos de su mascota y dos botones: "Los datos están bien" / "Hay un dato
-- malo". Existe porque los errores de tipeo (la fecha de fallecimiento, sobre
-- todo) se descubrían tarde: al emitir el certificado o al imprimir la etiqueta,
-- cuando ya había que rehacer el trabajo.
--
--   datos_validados: '' = todavía no responde · 'ok' = confirmó
--                    'observado' = dijo que hay algo mal (lo corrige una persona)
--   datos_validados_at: cuándo respondió (ISO)
--
-- NO bloquea nada (decisión del dueño 2026-08-20): el certificado se emite igual
-- con la ficha observada, solo se avisa. Un bloqueo duro frenaría la operación
-- por un dato que capaz ya se corrigió.
--
-- Correr en Supabase (proyecto «Alma Animal») ANTES de desplegar: en Postgres
-- ensureColumns es no-op, así que sin esto guardar la validación falla con
-- "Could not find the 'datos_validados' column".

alter table "clientes"
  add column if not exists "datos_validados" text not null default '';
alter table "clientes"
  add column if not exists "datos_validados_at" text not null default '';

notify pgrst, 'reload schema';
