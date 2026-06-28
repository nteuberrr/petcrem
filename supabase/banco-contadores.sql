-- Contadores MONOTÓNICOS de los códigos del banco de imágenes/videos.
-- Va APARTE del schema-principal.sql (que es generado): correr a mano en el SQL
-- editor del proyecto principal (SUPABASE_URL) o vía MCP. Idempotente.
--
-- Garantiza que i-N / C-X / C-X.Y / v-N / ai-N nunca reutilicen un número aunque se
-- borren filas: guarda el high-water mark por clave y solo crece. Lo consume
-- lib/banco-contadores.ts (nextContador) → lib/mailing-images.ts + lib/mailing-videos.ts.

create table if not exists banco_contadores (
  clave text primary key,
  valor int not null default 0
);

-- Atómico: INSERT .. ON CONFLICT .. RETURNING serializa por fila. p_min auto-sincroniza
-- el contador con el máximo real de los datos si quedó atrás.
create or replace function next_banco_contador(p_clave text, p_min int default 0)
returns int
language sql
as $$
  insert into banco_contadores (clave, valor)
  values (p_clave, greatest(coalesce(p_min, 0), 0) + 1)
  on conflict (clave) do update
    set valor = greatest(banco_contadores.valor, coalesce(p_min, 0)) + 1
  returning valor;
$$;

-- Siembra de high-water marks desde los códigos existentes (idempotente: greatest).
insert into banco_contadores(clave, valor)
select 'img:i', coalesce(max((substring(codigo from '^i-(\d+)$'))::int), 0)
  from mailing_imagenes where codigo ~ '^i-\d+$'
on conflict (clave) do update set valor = greatest(banco_contadores.valor, excluded.valor);

insert into banco_contadores(clave, valor)
select 'img:C', coalesce(max((substring(codigo from '^C-(\d+)\.'))::int), 0)
  from mailing_imagenes where codigo ~ '^C-\d+\.'
on conflict (clave) do update set valor = greatest(banco_contadores.valor, excluded.valor);

insert into banco_contadores(clave, valor)
select 'img:C-' || (substring(codigo from '^C-(\d+)\.')), max((substring(codigo from '^C-\d+\.(\d+)$'))::int)
  from mailing_imagenes where codigo ~ '^C-\d+\.\d+$'
  group by substring(codigo from '^C-(\d+)\.')
on conflict (clave) do update set valor = greatest(banco_contadores.valor, excluded.valor);

insert into banco_contadores(clave, valor)
select 'vid:v', coalesce(max((substring(codigo from '^v-(\d+)$'))::int), 0)
  from mailing_videos where codigo ~ '^v-\d+$'
on conflict (clave) do update set valor = greatest(banco_contadores.valor, excluded.valor);

insert into banco_contadores(clave, valor)
select 'vid:ai', coalesce(max((substring(codigo from '^ai-(\d+)$'))::int), 0)
  from mailing_videos where codigo ~ '^ai-\d+$'
on conflict (clave) do update set valor = greatest(banco_contadores.valor, excluded.valor);
