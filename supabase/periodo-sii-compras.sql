-- Período tributario del SII de cada compra (YYYY-MM).
--
-- El SII archiva una compra en el mes en que la REGISTRA, que no es el de
-- emisión ni el de recepción: a una factura sin acuse la registra recién al
-- vencer los 8 días. Por eso una factura del 28-07 recibida el 28-07 aparece en
-- el RCV de agosto, y su crédito fiscal se usa en el F29 de agosto.
--
-- La sincronización con OpenFactura estampa acá el dato (evento de registro, o
-- deducido de la forma de pago + los 8 días). Las filas viejas quedan en blanco
-- y `periodoSiiDe()` las deduce al leer, así que no hace falta backfill.
--
-- El EERR sigue imputando por fecha de emisión: esta columna es solo para el F29.

alter table public.eerr_gastos_sii
  add column if not exists periodo_sii text;

comment on column public.eerr_gastos_sii.periodo_sii is
  'Período tributario SII (YYYY-MM) en que la compra entra al Registro de Compras. Manda para el crédito fiscal del F29; el EERR usa fecha_documento.';

notify pgrst, 'reload schema';
