-- ─────────────────────────────────────────────────────────────────────────────
-- uso_whatsapp — registro de cada mensaje que SALE por la Cloud API.
--
-- Correr a mano en el SQL editor de Supabase (proyecto «Alma Animal»,
-- ixqharypfqlooogoctdp) ANTES de desplegar. Es idempotente.
--
-- Por qué: Meta sí nos dice cuánto cobra (lib/whatsapp-costos lee su
-- `pricing_analytics`), pero solo desglosa por CATEGORÍA — utility, marketing,
-- service. Eso no alcanza para saber QUÉ parte del sistema gasta. Esta tabla
-- pone esa dimensión al lado: la escribe `postMensaje` en lib/whatsapp.ts, que
-- es el único punto por donde sale todo.
--
-- Ojo con el estado: `ok` es lo que respondió la API en el momento del envío, no
-- la entrega. Meta acepta con 200 mensajes que después no entrega (incidente del
-- 11-08-2026, cuenta bloqueada por el método de pago); el estado real llega por
-- webhook y se cruza con `provider_message_id`.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists uso_whatsapp (
  id                  bigint generated always as identity primary key,
  created_at          timestamptz not null default now(),
  fecha               text not null default '',   -- YYYY-MM-DD (Chile)
  ts                  text not null default '',   -- ISO completo
  tipo                text not null default '',   -- texto | plantilla | interactivo | image | document…
  plantilla           text not null default '',   -- nombre de la plantilla, si fue una
  categoria           text not null default '',   -- SERVICE (gratis hoy) | UTILITY | MARKETING | AUTHENTICATION
  destino             text not null default '',   -- teléfono, solo dígitos
  ok                  boolean not null default false,
  error               text not null default '',
  provider_message_id text not null default ''
);

create index if not exists idx_uso_whatsapp_fecha on uso_whatsapp(fecha);
create index if not exists idx_uso_whatsapp_provider on uso_whatsapp(provider_message_id);
alter table uso_whatsapp enable row level security;

notify pgrst, 'reload schema';
