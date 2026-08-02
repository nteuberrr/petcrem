-- ─────────────────────────────────────────────────────────────────────────────
-- Parche 2026-08-02 — correr en el SQL editor de Supabase «Alma Animal»
-- (ixqharypfqlooogoctdp). Es idempotente: se puede re-ejecutar sin daño.
--
-- ⚠ CORRERLO ANTES DE USAR LA APP (local y prod comparten la misma base): sin la
--   columna `video_solicitado`, PostgREST rechaza cualquier update de `clientes`
--   porque el mapa SHEETS ya la incluye.
-- Estas mismas sentencias quedaron incorporadas a schema-principal.sql y
-- migracion-perfiles.sql; este archivo es solo el copy/paste del parche.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. La solicitud del video del proceso pasa a tener columna propia. `notas`
--    queda SOLO para los comentarios que escribe el equipo a mano.
alter table "clientes" add column if not exists "video_solicitado" text not null default '';

-- 2. Migra las solicitudes que quedaron dentro de `notas` y borra esa línea.
--    Toma la fecha del propio texto ("(DD/MM/YYYY)"); si no se puede leer, hoy.
update "clientes"
set "video_solicitado" = coalesce(
      to_char(
        to_date(substring("notas" from 'El tutor solicitó el video del proceso \((\d{2}/\d{2}/\d{4})\)'), 'DD/MM/YYYY'),
        'YYYY-MM-DD'),
      to_char(current_date, 'YYYY-MM-DD')),
    "notas" = btrim(regexp_replace("notas", '\n?[^\n]*El tutor solicitó el video[^\n]*', '', 'g'), E' \n')
where "notas" like '%El tutor solicitó el video%';

-- 3. El perfil del dueño se muestra con su nombre.
update "perfiles" set "nombre" = 'Nicolas (Admin)'
where "slug" = 'administrador' and "nombre" <> 'Nicolas (Admin)';

-- 4. Que PostgREST vea la columna nueva de inmediato (si no, tarda ~30 s).
notify pgrst, 'reload schema';
