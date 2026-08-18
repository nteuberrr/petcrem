-- Medio de pago con que se CONFIRMA un cobro pendiente (saldo de un parcial,
-- adicional, diferencia de peso). Dueño, 2026-08-18.
--
-- Hasta ahora se asumía que todo cobro pendiente llegaba por TRANSFERENCIA y por
-- eso quedaba fuera de la conciliación del procesador. No es así: un saldo se
-- puede cobrar con la máquina o con un link de pago, y en ese caso SÍ pasa por
-- Haulmer, paga comisión y tiene que aparecer en Facturación → Ventas POS.
--
-- Vacío = transferencia (es lo que había antes; no se re-interpreta la historia).
--
-- ⚠️ CORRER EN SUPABASE ANTES DE DESPLEGAR: en Postgres `ensureColumns` es no-op
-- y el datastore escribe todas las columnas del esquema, así que sin esta columna
-- falla el cierre de cualquier cobro.

alter table public.cobros
  add column if not exists medio_pago text not null default '';

notify pgrst, 'reload schema';
