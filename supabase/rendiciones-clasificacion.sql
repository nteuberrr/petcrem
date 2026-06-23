-- Rendiciones: separar Documento (boleta/factura) de Clasificación (rendicion/aporte).
--   tipo_documento  → boleta | factura | ''   (el '' es para los aportes, que no tienen documento)
--   clasificacion   → rendicion | aporte
-- "aporte" = préstamo a la empresa: se rinde/devuelve después, pero NO cubre un gasto,
-- así que se clasifica pero NO va al resultado del EERR.
-- "manual" NO es una clasificación de rendición (los gastos manuales viven en eerr_gastos_manuales).
--
-- Correr una vez sobre el Supabase principal «Alma Animal» (ixqharypfqlooogoctdp).

alter table "rendiciones" add column if not exists "clasificacion" text not null default 'rendicion';

-- Backfill: los antiguos 'prestamo' pasan a clasificación 'aporte' y se les vacía el documento.
update "rendiciones" set "clasificacion" = 'aporte' where "tipo_documento" = 'prestamo';
update "rendiciones" set "tipo_documento" = '' where "tipo_documento" = 'prestamo';

notify pgrst, 'reload schema';
