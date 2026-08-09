-- Conciliación de ventas SII vs sistema (Facturación → Conciliación).
-- Idempotente: se puede correr varias veces.
--
-- Un registro por PERÍODO (YYYY-MM). Guarda lo que dijo el SII —el hecho fechado,
-- tal como se descargó— en dos formas: `docs_json` con los documentos crudos (para
-- poder re-resumir y para fusionar el archivo de facturas con el de boletas, que
-- se suben por separado) y `sii_json` con el resumen ya calculado.
--
-- El lado del SISTEMA no se guarda a propósito: se recalcula en vivo desde
-- lib/eerr-ingresos en cada consulta, para que una corrección en una ficha vieja
-- se refleje en el histórico en vez de quedar congelada en un número obsoleto.

create table if not exists public.conciliacion_sii (
  id             bigint generated always as identity primary key,
  periodo        text not null,
  sii_json       text,
  docs_json      text,
  fecha_carga    text,
  fecha_creacion text
);

-- Un solo registro por período: la carga hace upsert sobre él.
create unique index if not exists conciliacion_sii_periodo_uk
  on public.conciliacion_sii (periodo);

alter table public.conciliacion_sii enable row level security;

notify pgrst, 'reload schema';
