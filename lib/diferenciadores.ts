/**
 * Valor agregado y DIFERENCIADORES oficiales del negocio — FUENTE ÚNICA.
 *
 * Definidos por el dueño. Se inyectan en los agentes (marketing, WhatsApp) y en los
 * generadores de contenido (piezas, correos) para que SIEMPRE comuniquen lo mismo.
 * Si cambian, editá SOLO acá (y los textos fijos de los PDF que los repiten).
 */

export const HORARIO = 'Lunes a domingo, de 09:00 a 22:00 h'
export const HORARIO_CORTO = 'L–D 09:00–22:00'
export const ENTREGA_DIAS = 4
export const ENTREGA = 'entrega en 4 días hábiles'

/** Bloque de texto para inyectar en los prompts de los agentes/generadores. */
export const DIFERENCIADORES = `VALOR AGREGADO Y DIFERENCIADORES (oficiales — trátalos como la verdad del negocio y comunícalos cuando aporten):
- Abiertos de lunes a domingo, de 09:00 a 22:00 h.
- Instalaciones propias y certificadas, con horno certificado; no externalizamos ninguna etapa.
- Trazabilidad total durante todo el proceso, con código de seguimiento y certificado de cremación.
- Entrega de cenizas y certificado en 4 días hábiles.
- Retiro directo a domicilio o desde la clínica, habitualmente en menos de 3 horas.
- Precios convenientes, con variedad de productos y servicios adicionales.

PARA CLÍNICAS / VETERINARIOS (B2B) — cuando la pieza o el mensaje es para clínicas, ESTE es el valor agregado que manda (definido por el dueño, en este orden; construí el argumento de venta alrededor de estos puntos):
1. Retiro en menos de 3 horas (habitualmente).
2. Operamos de lunes a domingo (09:00–22:00 h).
3. Entrega en 4 días hábiles.
4. Precios convenientes.
5. Trazabilidad total (código de seguimiento + certificado de cremación).

PRECISIONES (para no cometer errores de marca):
- Lo CERTIFICADO es el HORNO. La cámara es de REFRIGERACIÓN: NO la llames "cámara certificada" ni "sala certificada".
- NO digas "cada cremación es individual": "Cremación Individual" es solo el nombre de una de las modalidades.
- Plazos oficiales que SÍ se pueden afirmar: entrega en 4 días hábiles; retiro habitualmente en menos de 3 horas. No afirmes otros plazos.`

/**
 * Qué INCLUYE cada modalidad de cremación — FUENTE ÚNICA, definida por el dueño
 * (2026-07-03). La consumen el agente de WhatsApp Y el agente de marketing, para
 * que ambos comuniquen EXACTAMENTE lo mismo. Si cambia algo, editar SOLO acá.
 */
export const MODALIDADES_SERVICIOS = `MODALIDADES DE CREMACIÓN (qué INCLUYE cada una — oficial, no inventes ni omitas ítems; los PRECIOS salen SIEMPRE de las tarifas vigentes):
- *Cremación Individual*: certificado de cremación digital, ánfora de greda marmoleada, botellita con mechón de pelo, etiqueta de madera con el nombre, retiro en domicilio o clínica y entrega en 4 días hábiles.
- *Cremación Premium*: todo lo de Individual, más un cuadro en acuarela conmemorativo y ánfora premium a elección.
- *Cremación Sin Devolución*: certificado de cremación y retiro en domicilio o clínica; NO se devuelven las cenizas (la opción más económica).`
