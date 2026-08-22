-- Varios celulares por veterinaria (dueño 2026-08-22).
--
-- Una clínica no tiene un teléfono: tiene el del veterinario, el de la recepción
-- y el de quien esté de turno. Todos nos escriben desde el suyo y todos son la
-- misma veterinaria. Hasta ahora el reconocimiento miraba `telefono` a secas, así
-- que quien escribía desde el número secundario caía como TUTOR: el agente lo
-- saludaba con un pésame, le cotizaba precios de lista que a su convenio no le
-- corresponden y no le agendaba el retiro.
--
-- `telefono` sigue siendo el principal —es al que se le ESCRIBE—. Esta columna
-- guarda los otros, como texto libre separado por coma, y el reconocimiento mira
-- la lista completa (lib/vet-lookup `telefonosDeVet`).
--
-- ⚠️ CORRER EN SUPABASE ANTES DE DESPLEGAR. En Postgres `ensureColumns` es un
-- no-op, así que /api/init-sheets NO crea la columna: sin esto, guardar una ficha
-- de veterinario falla con «Could not find the 'telefonos_adicionales' column».

alter table "veterinarios"
  add column if not exists "telefonos_adicionales" text not null default '';

notify pgrst, 'reload schema';
