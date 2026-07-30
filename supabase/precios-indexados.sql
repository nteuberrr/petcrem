-- ═══════════════════════════════════════════════════════════════════════════
-- Precios especiales INDEXADOS a una tabla base
-- Correr en el SQL editor de Supabase «Alma Animal» (ixqharypfqlooogoctdp).
-- Idempotente.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Al duplicar una tabla de precios a los ESPECIALES de una veterinaria se puede
-- dejar la copia INDEXADA a su origen: si mañana cambian los precios generales (o
-- los de convenio), los tramos de esa veterinaria se re-copian solos.
--
-- Valores de `precios_indexados`:
--   ''          → copia suelta (una foto; se edita a mano y nadie la toca)
--   'general'   → sigue a precios_generales
--   'convenio'  → sigue a precios_convenio
--
-- La sincronización vive en lib/precios-indexados.ts y la dispara el endpoint de
-- precios después de crear / editar / borrar un tramo de la tabla base.

alter table "veterinarios" add column if not exists "precios_indexados" text not null default '';

notify pgrst, 'reload schema';
