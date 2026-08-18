-- Ventas SIN BOLETA (decisión del dueño, 2026-08-18).
--
-- Marca en la ficha para que el sistema NO emita el DTE de ese servicio. El
-- ingreso se sigue registrando —y en BRUTO, porque sin boleta no hay IVA que
-- remesar— y la Conciliación deja de contarlo como diferencia contra el SII.
-- El checkbox que la enciende solo lo ve el admin (dueño).
--
-- ⚠️ CORRER ESTO EN SUPABASE ANTES DE DESPLEGAR: en Postgres `ensureColumns` es
-- no-op, así que sin la columna el guardado de la ficha falla con
-- "Could not find the 'sin_boleta' column ... in the schema cache".

alter table public.clientes
  add column if not exists sin_boleta text not null default 'FALSE';

notify pgrst, 'reload schema';
