-- ─────────────────────────────────────────────────────────────────────────────
-- Pausar un correo transaccional (Configuración Avanzada → Correos)
--
-- `correos_desactivados` guarda un JSON {clave_correo: true} con los correos que
-- NO se envían al destinatario. Solo lista los apagados: vacío = todos se envían.
-- Lo aplica lib/resend-mailer para cualquier transaccional (el corte está en el
-- único lugar por el que pasan todos), y el envío omitido queda registrado en
-- correos_log con estado 'omitido'.
--
-- ⚠️ Correr ANTES de desplegar: en Postgres `ensureColumns` es no-op, así que sin
-- este ALTER el guardado del interruptor falla con
-- "Could not find the 'correos_desactivados' column ... in the schema cache".
-- ─────────────────────────────────────────────────────────────────────────────

alter table empresa_config
  add column if not exists correos_desactivados text default '';

notify pgrst, 'reload schema';
