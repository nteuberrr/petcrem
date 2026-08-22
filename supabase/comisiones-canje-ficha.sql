-- CANJE: contra qué mascota se aplicó un pago de comisión
--
-- Un ajuste de saldo (Configuración → Descuentos Convenios) no siempre es una
-- transferencia: muchas veces el saldo del veterinario se CANJEA por un servicio
-- que le prestamos y que no se le cobró a nadie. Esta columna guarda la ficha
-- contra la que se aplicó, para que el libro mayor muestre el código en vez de
-- un comentario escrito a mano.
--
-- '' = fue una transferencia (o un pago sin ficha asociada). El comentario sigue
-- existiendo aparte: son dos cosas distintas y el dueño quiere las dos.
--
-- Correr en Supabase (proyecto «Alma Animal») ANTES de desplegar: en Postgres
-- ensureColumns es no-op, así que sin esto guardar un ajuste falla con
-- "Could not find the 'cliente_id' column".

alter table "comisiones_ajustes"
  add column if not exists "cliente_id" text not null default '';

create index if not exists "comisiones_ajustes_cliente_idx"
  on "comisiones_ajustes" ("cliente_id");

notify pgrst, 'reload schema';
