-- Esquema del módulo "Mensajes" (inbox unificado WhatsApp/IG/FB).
-- ⚠️ Desde 2026-07-12 estas tablas viven en el proyecto PRINCIPAL («Alma
-- Animal», ixqharypfqlooogoctdp) — el proyecto separado petcrem-mensajes se
-- fusionó para ahorrar costo (migración fusion_mensajes_inbox, con identity
-- BY DEFAULT para preservar ids). Las env MENSAJES_SUPABASE_* apuntan al
-- principal. Tablas con prefijo mensajes_ para convivir con el resto. RLS
-- activado sin policies: bloquea anónimo; solo entra el service_role.

create table if not exists mensajes_contactos (
  id          bigint generated always as identity primary key,
  nombre      text,
  telefono    text,
  wa_id       text,            -- id de WhatsApp del proveedor (phone)
  instagram   text,
  facebook_id text,
  audiencia   text not null default 'A',   -- 'A' tutor | 'B' vet | 'mixed'
  cliente_id  text,            -- id de la ficha en Sheets (clientes), si se vincula
  notas       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists idx_mcontactos_wa  on mensajes_contactos(wa_id);
create index if not exists idx_mcontactos_tel on mensajes_contactos(telefono);

create table if not exists mensajes_conversaciones (
  id                       bigint generated always as identity primary key,
  contacto_id              bigint not null references mensajes_contactos(id) on delete cascade,
  canal                    text not null,                    -- whatsapp | instagram | facebook
  audiencia                text not null default 'A',
  estado                   text not null default 'activo',   -- activo|cliente|veterinario|archivado|cerrado (legacy: abierta/cerrada)
  etiquetas                text[] not null default '{}',
  fuente                   text not null default 'whatsapp', -- historico | whatsapp
  provider_conversation_id text,
  ultimo_mensaje_at        timestamptz,
  created_at               timestamptz not null default now()
);
create index if not exists idx_mconv_contacto on mensajes_conversaciones(contacto_id);
create index if not exists idx_mconv_ultimo    on mensajes_conversaciones(ultimo_mensaje_at desc nulls last);
-- Idempotente para entornos ya creados:
alter table mensajes_conversaciones add column if not exists no_leido boolean not null default false;
-- Cuándo se envió el seguimiento automático al lead (null = nunca). Idempotencia
-- del barrido diario de seguimiento (lib/seguimiento-leads).
alter table mensajes_conversaciones add column if not exists seguimiento_at timestamptz;

create table if not exists mensajes_mensajes (
  id                  bigint generated always as identity primary key,
  conversacion_id     bigint not null references mensajes_conversaciones(id) on delete cascade,
  direccion           text not null,                  -- entrante | saliente
  cuerpo              text,
  tipo                text not null default 'texto',  -- texto|imagen|audio|documento|sistema
  media_url           text,
  provider_message_id text,
  estado              text,                           -- enviado|entregado|leido|fallido
  enviado_por         text,                           -- operador (email) en salientes manuales
  ts                  timestamptz not null,           -- timestamp real (histórico o live)
  created_at          timestamptz not null default now()
);
create index if not exists idx_mmsg_conv on mensajes_mensajes(conversacion_id, ts);

-- Configuración del agente IA del inbox (fila única, id=1).
-- instrucciones: ajustes del operador en lenguaje natural (efecto inmediato).
-- calibracion: guía de estilo extraída de conversaciones reales (históricas + nuevas).
create table if not exists agente_config (
  id                  int primary key default 1,
  instrucciones       text not null default '',
  calibracion         text not null default '',
  calibracion_at      timestamptz,
  calibracion_muestra int,
  updated_at          timestamptz not null default now(),
  constraint agente_config_singleton check (id = 1)
);
insert into agente_config (id) values (1) on conflict (id) do nothing;
-- Marca de tiempo del último barrido de seguimiento a leads tibios (throttle del
-- barrido oportunista que cuelga del cron de 10 min). Idempotente:
alter table agente_config add column if not exists seguimiento_barrido_at timestamptz not null default '1970-01-01T00:00:00Z';

alter table mensajes_contactos      enable row level security;
alter table mensajes_conversaciones enable row level security;
alter table mensajes_mensajes       enable row level security;
alter table agente_config           enable row level security;
