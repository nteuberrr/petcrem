-- ─────────────────────────────────────────────────────────────────────────────
-- MEMORIAL EN REDES (historia de despedida en Instagram) — 2026-08-06
--
-- El tutor autoriza, desde el mismo link con el que sube la foto del certificado
-- (/subir-foto), que publiquemos un homenaje a su mascota en Instagram, y puede
-- dejarle una dedicatoria. La historia se publica sola cuando se cumplen LAS DOS
-- condiciones: consentimiento + mascota ENTREGADA (clientes.estado='despachado').
-- Ver lib/memorial.ts.
--
-- Idempotente: se puede correr más de una vez sin romper nada.
-- Correr en el SQL editor del proyecto «Alma Animal» (ixqharypfqlooogoctdp).
-- ─────────────────────────────────────────────────────────────────────────────

-- Consentimiento explícito del tutor ('TRUE' | 'FALSE'). Sin esto NO se publica.
alter table clientes add column if not exists memorial_consentimiento text default 'FALSE';
-- Cuándo lo dio (ISO). Se limpia si lo revoca.
alter table clientes add column if not exists memorial_consentimiento_fecha text default '';
-- Dedicatoria del tutor (máx. 280). Va tal cual en la pieza, sin reescribir.
alter table clientes add column if not exists memorial_comentario text default '';
-- Guarda de idempotencia: con fecha, la despedida ya salió y no se repite.
alter table clientes add column if not exists memorial_publicado_at text default '';
-- Id de la historia en Instagram (para rastrearla).
alter table clientes add column if not exists memorial_story_id text default '';
-- Qué plantilla de las 15 salió sorteada (para revisar variedad).
alter table clientes add column if not exists memorial_plantilla text default '';

-- PostgREST cachea el esquema: sin esto, los INSERT/UPDATE fallan con
-- "Could not find the 'memorial_consentimiento' column ... in the schema cache".
notify pgrst, 'reload schema';
