-- ─────────────────────────────────────────────────────────────────────────────
-- ATRIBUCIÓN DE GOOGLE ADS: del clic en el anuncio a la ficha real.
--
-- Por qué existe: hasta agosto de 2026 Google optimizaba hacia «Join Chat» (un
-- clic en el botón de WhatsApp del sitio) — 848 de 903 conversiones del histórico
-- contra 358 fichas reales. La puja perseguía un evento que no distingue un clic
-- bueno de uno malo y no conoce el valor del servicio.
--
-- Cómo se cierra el círculo:
--   1. La landing recibe ?gclid=… y lo registra acá, devolviendo un CÓDIGO corto.
--   2. El código viaja dentro del texto prellenado del link de WhatsApp.
--   3. El webhook lo lee del primer mensaje y le pega el teléfono a la fila.
--   4. Al crear la ficha (bot o alta manual) se vincula por teléfono → cliente_id.
--   5. El cron sube la conversión offline a Ads con el precio_total real.
--
-- Idempotente: se puede correr varias veces.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists ads_clicks (
  id          bigint generated always as identity primary key,
  -- Código corto que viaja en el mensaje de WhatsApp (alfabeto sin caracteres
  -- ambiguos, ver lib/ads-clicks.ts).
  codigo      text not null unique,
  -- Identificadores de clic de Google. gclid es el habitual; gbraid/wbraid llegan
  -- en campañas con consentimiento restringido en iOS.
  gclid       text,
  gbraid      text,
  wbraid      text,
  -- Página donde aterrizó, para diagnóstico.
  landing     text,
  -- Se completa cuando el visitante escribe por WhatsApp con el código.
  telefono    text,
  -- Se completa cuando ese teléfono termina en una ficha.
  cliente_id  text,
  -- Momento exacto en que se cerró el círculo. Es el `conversion_date_time` que
  -- se le informa a Google: tiene que ser posterior al clic y no puede inventarse
  -- (fecha_creacion de la ficha es solo un día, sin hora).
  vinculado_at timestamptz,
  -- Cuándo se subió la conversión offline a Google Ads (null = pendiente).
  subido_at   timestamptz,
  created_at  timestamptz not null default now()
);

-- Por si la tabla ya existía de una corrida anterior incompleta.
alter table ads_clicks add column if not exists gbraid     text;
alter table ads_clicks add column if not exists wbraid     text;
alter table ads_clicks add column if not exists landing    text;
alter table ads_clicks add column if not exists telefono   text;
alter table ads_clicks add column if not exists cliente_id text;
alter table ads_clicks add column if not exists vinculado_at timestamptz;
alter table ads_clicks add column if not exists subido_at  timestamptz;

create index if not exists ads_clicks_telefono_idx   on ads_clicks (telefono);
create index if not exists ads_clicks_cliente_idx    on ads_clicks (cliente_id);
-- Los dos barridos del cron: pendientes de subir y limpieza de clics viejos.
create index if not exists ads_clicks_pendientes_idx on ads_clicks (subido_at, created_at);

alter table ads_clicks enable row level security;

notify pgrst, 'reload schema';
