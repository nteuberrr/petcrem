-- ─────────────────────────────────────────────────────────────────────────────
-- FOTOS DE LA ENTREGA EN LA FICHA — 2026-08-08
--
-- El repartidor saca la foto desde la hoja de ruta compartida (/ruta/<token>) y
-- queda dentro de la entrega, en el blob `despachos.entregas`. Esta columna la
-- copia además a la FICHA, que es el archivo permanente de la mascota: la ruta
-- se puede editar o borrar, y con eso se perdería la constancia de la entrega.
--
-- JSON array de URLs públicas de R2, igual que `fotos_evidencia` / `fotos_mascota`.
--
-- ⚠️ CORRER ESTO ANTES DE DESPLEGAR: la columna está en el SHEETS map
-- (lib/sheets-schema.ts), así que sin ella todo write a `clientes` falla con
-- "Could not find the 'fotos_entrega' column ... in the schema cache".
--
-- Idempotente: se puede correr más de una vez.
-- Correr en el SQL editor del proyecto «Alma Animal» (ixqharypfqlooogoctdp).
-- ─────────────────────────────────────────────────────────────────────────────

alter table clientes add column if not exists fotos_entrega text default '';

-- PostgREST cachea el esquema: sin esto los INSERT/UPDATE siguen fallando ~30 s.
notify pgrst, 'reload schema';
