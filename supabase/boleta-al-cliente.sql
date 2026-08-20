-- BOLETA AL CLIENTE POR VETERINARIO
--
-- Hasta ahora "a este vet se le boletea al tutor en vez de facturarle a él" no era
-- un dato: se DEDUCÍA de que el vet tuviera una comisión activa en
-- `comisiones_reglas`. Eran dos cosas fusionadas en una, y por eso no se podía
-- tener un convenio que factura al tutor sin pagarle comisión (ni al revés).
--
-- Esta columna las separa. Es el ÚNICO driver del modelo de cobro (lib/vet-boleta):
--   FALSE → ficha de este vet NO se boletea; entra a la propuesta de factura del mes.
--   TRUE  → al tutor se le emite la boleta al confirmarse el pago, y el vet NUNCA
--           aparece en la propuesta mensual.
--
-- La comisión (Configuración → Descuentos Convenios) queda como algo aparte: se
-- devenga por DERIVAR, tenga o no este flag.
--
-- Correr en Supabase (proyecto «Alma Animal») ANTES de desplegar: en Postgres
-- ensureColumns es no-op, así que sin esto guardar un veterinario falla con
-- "Could not find the 'boleta_al_cliente' column".

alter table "veterinarios"
  add column if not exists "boleta_al_cliente" text not null default 'FALSE';

notify pgrst, 'reload schema';
