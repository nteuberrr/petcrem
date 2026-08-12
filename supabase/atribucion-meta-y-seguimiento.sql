-- ─────────────────────────────────────────────────────────────────────────────
-- ATRIBUCIÓN DE META (Facebook/Instagram) + SEGUNDO TOQUE DE SEGUIMIENTO
--
-- 1) ATRIBUCIÓN META. La medición de Google ya estaba cerrada (clic → teléfono →
--    ficha → conversión offline, ver migracion-ads-clicks.sql), pero la de Meta
--    no existía: `fbclid` no se guardaba en ninguna parte y las tres campañas
--    activas corrían con objetivo LINK_CLICKS. O sea, Meta pujaba por CLICS sin
--    saber cuáles traían una mascota. Se reusa la MISMA tabla y el MISMO código
--    corto que viaja en el link de WhatsApp: solo cambia el identificador y a
--    quién se le informa la conversión.
--
--    Dos marcas de subida distintas, porque son dos eventos con propósitos
--    distintos y con MUY distinta frecuencia:
--      · meta_lead_at   → evento «Lead» al aparecer el teléfono (empezó la
--        conversación). Es el que puede optimizar de verdad: con ~46 fichas al
--        mes, una campaña que solo recibe compras nunca junta señal suficiente
--        para salir de aprendizaje.
--      · meta_compra_at → evento «Purchase» con el precio real de la ficha.
--        Menos frecuente, pero es el que le enseña a Meta cuánto vale cada lead.
--
--    `ctwa_clid` es el identificador que Meta manda en el webhook de WhatsApp
--    cuando el cliente llega desde un anuncio de click-to-WhatsApp. Hoy no se
--    usan esas campañas (van a LINK_CLICKS), pero capturarlo es gratis y el día
--    que se prendan la medición ya está puesta.
--
-- 2) SEGUNDO TOQUE. `seguimiento_at` alcanzaba para UN mensaje ("¿ya se le
--    escribió?"). Con dos toques hace falta saber CUÁNTOS van, así que se agrega
--    el contador. El backfill es lo importante: sin él, cada lead que ya recibió
--    su único toque volvería a recibir el primero.
--
-- Idempotente: se puede correr varias veces.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1) Atribución de Meta ────────────────────────────────────────────────────
alter table ads_clicks add column if not exists fbclid         text;
alter table ads_clicks add column if not exists ctwa_clid      text;
alter table ads_clicks add column if not exists meta_lead_at   timestamptz;
alter table ads_clicks add column if not exists meta_compra_at timestamptz;

-- Los dos barridos nuevos del cron (pendientes de informar a Meta).
create index if not exists ads_clicks_meta_lead_idx   on ads_clicks (meta_lead_at, created_at);
create index if not exists ads_clicks_meta_compra_idx on ads_clicks (meta_compra_at, created_at);

-- ── 2) Segundo toque de seguimiento ──────────────────────────────────────────
alter table mensajes_conversaciones add column if not exists seguimiento_n integer not null default 0;

-- Backfill: las que ya tienen fecha de seguimiento recibieron exactamente uno.
update mensajes_conversaciones set seguimiento_n = 1
 where seguimiento_at is not null and seguimiento_n = 0;

notify pgrst, 'reload schema';
