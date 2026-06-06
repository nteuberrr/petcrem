-- Esquema del módulo "Mensajes" (inbox unificado WhatsApp/IG/FB).
-- Correr una vez en Supabase → SQL Editor (proyecto compartido con mailing).
-- Tablas con prefijo mensajes_ para convivir con el resto. RLS activado sin
-- policies: bloquea acceso anónimo; solo entra el service_role desde el server.

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
  estado                   text not null default 'abierta',  -- abierta | cerrada
  etiquetas                text[] not null default '{}',
  fuente                   text not null default 'whatsapp', -- historico | whatsapp
  provider_conversation_id text,
  ultimo_mensaje_at        timestamptz,
  created_at               timestamptz not null default now()
);
create index if not exists idx_mconv_contacto on mensajes_conversaciones(contacto_id);
create index if not exists idx_mconv_ultimo    on mensajes_conversaciones(ultimo_mensaje_at desc nulls last);

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

alter table mensajes_contactos      enable row level security;
alter table mensajes_conversaciones enable row level security;
alter table mensajes_mensajes       enable row level security;
