-- ─────────────────────────────────────────────────────────────────────────────
-- Ajuste admin en la ficha — 2026-08-04
--
-- CORRER EN SUPABASE «Alma Animal» (SQL editor) ANTES DE DESPLEGAR.
-- En Postgres `ensureColumns` es no-op, así que /api/init-sheets NO crea nada.
-- Idempotente.
--
-- Rebaja manual sobre el TOTAL de la ficha que solo puede hacer el dueño
-- (rol admin). `ajuste_admin` es un monto POSITIVO que se RESTA del total
-- (un negativo lo sube). Se guarda quién y cuándo porque cambia lo que se cobra.
-- ─────────────────────────────────────────────────────────────────────────────

alter table "clientes" add column if not exists "ajuste_admin" text not null default '';
alter table "clientes" add column if not exists "ajuste_admin_motivo" text not null default '';
alter table "clientes" add column if not exists "ajuste_admin_por" text not null default '';
alter table "clientes" add column if not exists "ajuste_admin_fecha" text not null default '';

notify pgrst, 'reload schema';
