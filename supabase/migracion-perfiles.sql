-- ════════════════════════════════════════════════════════════════════════════
--  Perfiles de acceso  —  proyecto «Alma Animal» (ixqharypfqlooogoctdp)
--  Correr COMPLETO en el SQL editor de Supabase. Es idempotente: se puede
--  volver a ejecutar sin romper nada ni pisar permisos ya editados a mano.
--
--  Modelo:  usuario → perfil → nivel por módulo   (+ excepción por usuario)
--  Niveles: 'none' (sin acceso) · 'ver' (visualizador) · 'editar' (editor)
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. Perfiles ─────────────────────────────────────────────────────────────
create table if not exists "perfiles" (
  "id"          bigint generated always as identity primary key,
  "slug"        text not null unique,
  "nombre"      text not null,
  "descripcion" text not null default '',
  -- 'TRUE' = perfil base del sistema (no se elimina; el de administrador
  -- tampoco se edita). Los que cree el dueño van en 'FALSE'.
  "sistema"     text not null default 'FALSE',
  "activo"      text not null default 'TRUE',
  "creado_at"   timestamptz not null default now()
);
alter table "perfiles" enable row level security;

-- ── 2. Nivel de cada módulo dentro de un perfil ─────────────────────────────
create table if not exists "perfil_permisos" (
  "perfil_id"  bigint not null references "perfiles"("id") on delete cascade,
  "modulo"     text   not null,
  "nivel"      text   not null default 'none',   -- none | ver | editar
  "updated_at" text   not null default '',
  primary key ("perfil_id", "modulo")
);
alter table "perfil_permisos" enable row level security;

-- ── 3. Excepción puntual por persona (pisa a su perfil) ─────────────────────
create table if not exists "usuario_permisos" (
  "usuario_id" text not null,
  "modulo"     text not null,
  "nivel"      text not null default 'none',
  "updated_at" text not null default '',
  primary key ("usuario_id", "modulo")
);
alter table "usuario_permisos" enable row level security;

-- ── 4. El usuario apunta a su perfil ────────────────────────────────────────
alter table "usuarios" add column if not exists "perfil_id" text not null default '';

-- ── 5. Perfiles semilla ─────────────────────────────────────────────────────
insert into "perfiles" ("slug", "nombre", "descripcion", "sistema", "activo") values
  ('administrador', 'Nicolas (Admin)',  'Dueño del sistema. Acceso total, incluida la Configuración Avanzada. No se edita ni se elimina.', 'TRUE', 'TRUE'),
  ('general',       'General',          'Acceso amplio a la operación, comercial y finanzas. Sin Configuración Avanzada.',                  'TRUE', 'TRUE'),
  ('operario-n1',   'Operario Nivel 1', 'Operación diaria: dashboard, fichas, operaciones y asistencia.',                                   'TRUE', 'TRUE'),
  ('operario-n2',   'Operario Nivel 2', 'Igual que el Nivel 1, en una fila aparte para poder diferenciarlos.',                              'TRUE', 'TRUE')
on conflict ("slug") do nothing;

-- El perfil del dueño se muestra con su nombre (decisión 2026-08-02). El `insert`
-- de arriba no lo pisa si la fila ya existe, así que se renombra explícito.
update "perfiles" set "nombre" = 'Nicolas (Admin)'
where "slug" = 'administrador' and "nombre" <> 'Nicolas (Admin)';

-- ── 6. Permisos iniciales de los perfiles semilla ───────────────────────────
--  Se siembran desde el modelo viejo (`permisos_modulos`, booleano por rol) para
--  que NADIE cambie de acceso con el despliegue; si esa tabla no tiene la fila,
--  se usa el default histórico del módulo. Booleano TRUE → 'editar'.
--  `do nothing` = si ya editaste un permiso, no se pisa al re-ejecutar.
with modulos(modulo, def_general, def_n1, def_n2) as (values
  ('dashboard',       'editar', 'editar', 'editar'),
  ('clientes',        'editar', 'editar', 'editar'),
  ('operaciones',     'editar', 'editar', 'editar'),
  ('asistencia',      'editar', 'editar', 'editar'),
  ('mensajes',        'editar', 'none',   'none'),
  ('eutanasia-ficha', 'editar', 'editar', 'editar'),
  ('bases',           'editar', 'none',   'none'),
  ('servicios',       'editar', 'none',   'none'),
  ('mailing',         'editar', 'none',   'none'),
  ('web',             'none',   'none',   'none'),
  ('rendiciones',     'editar', 'none',   'none'),
  ('facturacion',     'none',   'none',   'none'),
  ('eerr',            'editar', 'none',   'none'),
  ('reportes',        'editar', 'none',   'none'),
  ('configuracion',   'editar', 'none',   'none')
),
destinos(slug, rol_legacy, col) as (values
  ('general',     'admin2',    'general'),
  ('operario-n1', 'operador',  'n1'),
  ('operario-n2', 'operador2', 'n2')
)
insert into "perfil_permisos" ("perfil_id", "modulo", "nivel", "updated_at")
select
  p.id,
  m.modulo,
  coalesce(
    -- 1) lo que hoy dice el editor viejo, si tiene fila para ese rol
    (select case when upper(trim(pm.permitido)) in ('TRUE','VERDADERO','1') then 'editar' else 'none' end
       from permisos_modulos pm
      where pm.modulo = m.modulo and pm.rol = d.rol_legacy),
    -- 2) si no, el default histórico del módulo
    case d.col when 'general' then m.def_general when 'n1' then m.def_n1 else m.def_n2 end
  ),
  to_char(now(), 'YYYY-MM-DD')
from destinos d
join perfiles p on p.slug = d.slug
cross join modulos m
on conflict ("perfil_id", "modulo") do nothing;

-- El perfil administrador se resuelve en código (siempre 'editar'), pero se
-- deja la fila explícita para que el editor lo muestre completo.
insert into "perfil_permisos" ("perfil_id", "modulo", "nivel", "updated_at")
select p.id, m.modulo, 'editar', to_char(now(), 'YYYY-MM-DD')
from perfiles p
cross join (values
  ('dashboard'),('clientes'),('operaciones'),('asistencia'),('mensajes'),
  ('eutanasia-ficha'),('bases'),('servicios'),('mailing'),('web'),
  ('rendiciones'),('facturacion'),('eerr'),('reportes'),('configuracion')
) as m(modulo)
where p.slug = 'administrador'
on conflict ("perfil_id", "modulo") do nothing;

-- ── 7. Asignar a cada usuario el perfil que le corresponde por su rol ───────
--  Solo a los que todavía no tienen perfil (no pisa asignaciones manuales).
update "usuarios" u
   set "perfil_id" = p.id::text
  from "perfiles" p
 where coalesce(u."perfil_id", '') = ''
   and p."slug" = case u."rol"
         when 'admin'     then 'administrador'
         when 'admin2'    then 'general'
         when 'operador2' then 'operario-n2'
         else 'operario-n1'
       end;

-- ── 8. Refrescar el cache de PostgREST ──────────────────────────────────────
notify pgrst, 'reload schema';

-- ── Verificación (opcional) ─────────────────────────────────────────────────
-- select u.nombre, u.rol, p.nombre as perfil
--   from usuarios u left join perfiles p on p.id::text = u.perfil_id
--  order by u.id;
-- select p.nombre as perfil, pp.modulo, pp.nivel
--   from perfil_permisos pp join perfiles p on p.id = pp.perfil_id
--  order by p.id, pp.modulo;

-- ── 9. Módulos agregados DESPUÉS de la primera corrida ──────────────────────
--  Re-ejecutable: siembra en los perfiles semilla los módulos que se sumaron al
--  registro `MODULOS` más tarde. `do nothing` no pisa lo que ya editaste.
--  remuneraciones (sueldos): cerrado por defecto para todos menos el dueño.
insert into "perfil_permisos" ("perfil_id", "modulo", "nivel", "updated_at")
select p.id, 'remuneraciones',
       case when p.slug = 'administrador' then 'editar' else 'none' end,
       to_char(now(), 'YYYY-MM-DD')
from perfiles p
on conflict ("perfil_id", "modulo") do nothing;

notify pgrst, 'reload schema';
