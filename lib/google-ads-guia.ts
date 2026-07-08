/**
 * GUÍA de Google Ads destilada de 8 guías de un experto (docx del dueño, 2026-07-07)
 * y adaptada al rubro (crematorio de mascotas, RM, Chile). Es la FUENTE DE VERDAD
 * cualitativa que alimenta al agente de marketing (tools gads_*) y a la auditoría
 * (lib/google-ads-audit.ts). Mismo patrón que lib/marketing-guia.ts.
 *
 * Lo CUANTITATIVO específico de la cuenta (nombres/ids de campañas, gasto real) NO
 * vive acá — se lee en vivo con lib/google-ads.ts. Acá van solo las reglas estables.
 */

export const GUIA_GADS_ESTRUCTURA = `ESTRUCTURA DE CUENTA — los 9 defaults correctos (y qué hacer cuando Google empuja lo contrario):
1. Tipo de campaña: SOLO Red de Búsqueda (Search). Nunca Display, Search Partners ni Performance Max para este rubro — diluyen presupuesto en tráfico de peor calidad.
2. Bidding: ver GUIA_GADS_BIDDING (playbook Max Conversions → tCPA → tROAS).
3. Programación de anuncios: 24/7 solo si alguien responde llamadas fuera de horario; si no, horario comercial (el negocio atiende 09:00–22:00 todos los días — alinear el schedule a eso).
4. Ubicaciones: SOLO "Presencia" (Presence only), nunca "Presencia o interés" — si no, gente buscando "crematorio Santiago" desde otro país cuenta como impresión válida y quema presupuesto.
5. Ubicaciones EXCLUIDAS: excluir todos los países salvo Chile (mata clics de VPN/bots — India, Vietnam, Pakistán son las fuentes típicas). Sin esto, "Presencia" igual permite impresiones globales.
6. Dispositivos: todos: no segmentar todavía, hay que esperar datos.
7. Segmentos de audiencia: NINGUNO en Search — la keyword ES la audiencia. Las audiencias son para Display/Demand Gen, que no usamos.
8. Recomendaciones auto-aplicadas de Google: SIEMPRE apagadas. Cada recomendación de Google aumenta el gasto, no el ROAS.
9. Rotación de anuncios: "Optimizar" (default de Google) — el ML elige el RSA ganador solo.

PROPUESTAS DE GOOGLE A RECHAZAR SIEMPRE (aparecen como banners/toggles sugeridos en la UI; si el dueño pregunta o el agente detecta indicios, recomendar NO activarlas):
- "Activar AI Max para campañas de Búsqueda" — expande keywords de frase a amplia y reescribe los anuncios con IA de Google: rompe el control de copy y de landing page.
- "Habilitar Anuncios Dinámicos de Búsqueda (DSA)" — genera titulares desde la web sin usar keywords: se pierde el control del mensaje.
- "Agregar recursos creados automáticamente" — Google genera titulares/descripciones scrapeando el sitio: rompe el pinning y las reglas editoriales.
- "Activar personalización de texto" / "Expansión de URL final" / "Inclusión de concordancia amplia" — todas debilitan el control de keyword→anuncio→landing page.
- "Activar Socios de Búsqueda" (Search Partners) — tráfico de peor calidad (Yahoo, AOL, buscadores menores).`

export const GUIA_GADS_BIDDING = `PLAYBOOK DE BIDDING (estrategia de puja — seguir esta progresión, no saltarse pasos):
1. Día 1 — Campaña nueva: "Maximizar conversiones" SIN tCPA objetivo. Deja que el algoritmo aprenda con datos reales antes de restringirlo.
2. A las 30 conversiones en 30 días: agregar tCPA (Target CPA) — recién ahí Smart Bidding tiene suficiente señal para optimizar hacia un costo objetivo.
3. A las 50 conversiones (con valores de conversión coherentes cargados — ver más abajo): pasar a "Maximizar valor de conversión" + tROAS (Target ROAS).
4. NUNCA Manual CPC ni CPC mejorado (Enhanced CPC quedó obsoleto en 2025).
5. Presupuesto diario ≈ 3-5× el tCPA objetivo (si el costo por conversión objetivo es $10.000, el presupuesto diario debería rondar $30.000-50.000; si es menor, Smart Bidding no tiene margen para explorar).
6. Tras CUALQUIER cambio de estrategia de puja, NO tocar la campaña por 14 días — el algoritmo necesita ese período para re-estabilizarse; cambiarla antes reinicia el aprendizaje.
7. VALOR DEL LEAD (para value_settings de las conversion actions): valor de lead = ticket promedio del servicio × tasa de cierre real. Ej.: si el ticket promedio es $150.000 y 1 de cada 4 leads cierra (25%), el valor del lead es $37.500. NUNCA inventar este número — siempre preguntarlo al dueño si no está confirmado; usar el mismo criterio para TODAS las conversion actions de un mismo tipo de interacción (llamada, chat, formulario) para que sean comparables entre sí y Smart Bidding no distorsione la puja hacia la acción "más barata" en vez de la más valiosa.`

export const GUIA_GADS_RSA = `ANATOMÍA DE UN RSA (Responsive Search Ad) — la especificación que debe cumplir TODO anuncio:
ESTRUCTURA
- 15 titulares (máximo 30 caracteres cada uno) — llenar los 15 SIEMPRE. Google testea hasta 43.680 combinaciones (15×14×4); dejar slots vacíos le quita datos al algoritmo. Cuentas que llenan los 15 ven ~6% más CTR que las que solo cargan 5-8.
- 4 descripciones (máximo 90 caracteres, ideal 61-70) — llenar las 4 siempre.
- Pinning: SOLO 3 titulares con variantes de la keyword, fijados (pinned) en la POSICIÓN 1 — nunca en la 2. El resto (12 titulares) NUNCA pinneados: se deja que el Smart Bidding rote y encuentre la mejor combinación. Pinnear la posición 2 además de la 1 (dual-pin) reduce las combinaciones efectivas de ~43.000 a ~3.000 y empeora el resultado 10-15% — es una práctica de 2018-2021 ya obsoleta.
6 ÁNGULOS QUE DEBEN CUBRIR LOS 15 TITULARES (mínimo 5 de los 6, para variedad real — 15 titulares casi idénticos no le dan nada nuevo que testear al algoritmo):
1. Keyword + ubicación (los 3 pinneados en slot 1): ej. "Cremación de Mascotas RM", "Crematorio Mascotas Santiago", "Cremación Urgente Mascotas".
2. Oferta/diferenciador (sin pinnear): ej. "Entrega en 3 Días Hábiles", "Instalaciones Propias RM", "Retiro a Domicilio Incluido".
3. Confianza/prueba social (sin pinnear): ej. "Trazabilidad Total Certificada", años en el rubro, si hay reseñas reales con nota.
4. Urgencia (sin pinnear, solo si es real): ej. "Retiro en Menos de 3 Horas", "Atención Todos los Días".
5. Garantía/promesa concreta (sin pinnear): ej. "Certificado Digital Incluido", "Sin Costos Ocultos".
6. Llamado a la acción (sin pinnear): ej. "Cotiza Ahora", "Agenda tu Retiro", "Escríbenos por WhatsApp".
4 DESCRIPCIONES — cada una cubre un ángulo distinto:
1. Servicio + velocidad (qué hacemos + qué tan rápido).
2. Confianza + transparencia (instalaciones propias, trazabilidad, precios claros).
3. Diferenciador (lo que nos hace distintos, no intercambiables).
4. CTA directo (pedí explícitamente la acción: cotiza, agenda, escríbenos).
REGLAS EDITORIALES DURAS (Google rechaza el anuncio automáticamente si se violan — no son sugerencias):
- Máximo 1 signo de exclamación en TODO el anuncio (sumando titulares+descripciones), y NUNCA en un titular (solo permitido en descripciones).
- Sin MAYÚSCULAS SOSTENIDAS (una palabra entera en mayúscula, salvo siglas cortas).
- Sin espaciado artificial ("G R A T I S", "S*A*L*E") ni puntuación repetida ("Ahora... Ya").
- Sin emojis ni símbolos decorativos (★★★, →, 🔥); un solo "★" con una cifra real (ej. "4.9★") sí está permitido.
- Sin superlativos sin prueba ("el mejor", "#1", "el más barato") salvo que haya un dato verificable detrás.
- Sin afirmaciones engañosas ni promesas que el sitio no cumple.
- Sin números de teléfono en el texto del anuncio (para eso están las extensiones de llamada).
- Evitar "haz clic aquí" (no aporta nada al ML) y hablar en primera persona de la empresa ("nosotros/nuestro"); mejor hablar de lo que recibe el cliente.
POR ANUNCIO Y GRUPO: los 3 RSAs de un mismo grupo de anuncios deben compartir la MISMA landing page final (modelo SKAG: una keyword, un grupo, una landing) y cada uno puede testear un ángulo distinto (velocidad / confianza / valor).`

export const GUIA_GADS_ASSETS = `RECURSOS (ASSETS) — multiplican el CTR 20-25% en conjunto sin costo extra (no se cobra por impresión ni clic en sitelinks):
SITELINKS (el de mayor impacto individual, +10-15% CTR)
- 4-8 sitelinks por campaña. Título ≤ 15 caracteres (para que entre en mobile). Cada uno apunta a una página DISTINTA y específica — nunca "Ver más" o "Conócenos" genéricos, son CTR-killers.
- Ejemplos para el rubro: "Cómo Funciona", "Cotiza tu Servicio", "Retiro a Domicilio", "Certificado Digital", "Convenio Veterinarios", "Preguntas Frecuentes".
- Con descripción (2 líneas, ≤35 caracteres cada una) cuando aporte, no obligatorio.
CALLOUTS (alta densidad de señal, +5-15% CTR)
- 8-12 callouts (recomendado; menos de 8 es insuficiente). Texto ≤ 25 caracteres (ideal 10-20). Cada uno una afirmación DIFERENCIADA, no genérica repetida ("Servicio 24/7" ya lo dice todo el rubro; "Retiro en Menos de 3 Horas" diferencia).
- No repetir texto que ya está en titulares/descripciones — los recursos SUMAN, no sustituyen.
- Cubrir ángulos variados: velocidad, confianza, precio/valor, garantía (no 8 callouts todos de velocidad).
SNIPPETS ESTRUCTURADOS (organiza el catálogo de servicios, +3-8% CTR)
- 2 encabezados (headers) distintos, cada uno con 4-10 valores (≤25 caracteres, ideal 8-15).
- Para este rubro: header "Servicios" → valores como "Cremación Individual", "Cremación Premium", "Sin Devolución", "Eutanasia a Domicilio"; header "Cobertura" → comunas o "Toda la RM", "Retiro a Domicilio", "Retiro en Clínica".
- Cada valor debe ser verificable en la landing page (Google audita esto).
NOMBRE Y LOGO DE MARCA
- Nombre de empresa ≤ 25 caracteres, debe coincidir con el dominio o la razón social verificada.
- Logo: cuadrado 1200×1200 (mínimo 128×128), PNG con fondo transparente preferido, sin overlay de texto, sin invertir colores, con rasgos distinguibles (no un bloque de color plano).
RECURSOS A EVITAR EN ESTE RUBRO: imágenes en el anuncio (mixed results, ensucia más de lo que ayuda salvo fotografía profesional real, nunca stock), precios (servicio con tramos variables, mal fit), promociones falsas/inventadas.`

export const GUIA_GADS_NEGATIVAS = `NEGATIVAS — lista universal adaptada al rubro (ES-CL) y criterio de aplicación.
CANDIDATOS UNIVERSALES A NEGATIVAR (mala intención SIEMPRE, para lista compartida a nivel cuenta):
- Empleo/trabajo: trabajo, empleo, empleos, se busca, busco trabajo, sueldo, cuánto gana, ofertas de trabajo, postular, currículum, cv, práctica, pasantía, vacante.
- Educación/formación: curso, cursos, capacitación, certificación veterinaria, escuela veterinaria, cómo estudiar, universidad, carrera de veterinaria, título.
- Hazlo tú mismo / informacional: cómo cremar, cómo hacer, cremación casera, hazlo tú mismo, tutorial, paso a paso, wikipedia, qué significa, definición, qué es la cremación, foro, reddit.
- Gratis/regalo: gratis, regalo, sorteo, promoción gratis, muestra gratis, descuento código, cupón (OJO: "cotización" y "presupuesto" NO son gratis-intent, son alta intención — no confundir).
- Segunda mano / no aplica al rubro: usado, segunda mano, se vende, remate, liquidación.
- Empleo específico veterinario: veterinario se necesita, clínica veterinaria empleo, auxiliar veterinario trabajo.
NUNCA NEGATIVAR (alta intención de compra, aunque "suenen" a investigación — en esta cuenta términos reales como "crematorio de mascotas valor" SÍ convierten):
- precio, valor, cuánto cuesta, costo, tarifa, cotización, presupuesto — son consulta directa de compra, no investigación.
- cerca de mí, cerca, en mi comuna — altísima intención geográfica.
- urgente, ahora, hoy, inmediato — urgencia real del servicio (una mascota fallecida es urgente de verdad).
- mejor, recomendado, opiniones (con matiz: "opiniones" puede ser comparación de proveedores, evaluar caso a caso en el workflow de términos, no negativar a ciegas).
CRITERIO shared list vs campaña: la lista de arriba (mala intención universal) va en una LISTA COMPARTIDA aplicada a TODAS las campañas. Negativas de geografía específica ("argentina", "perú", comunas fuera de cobertura) o de intención específica de UNA campaña (ej. una keyword que solo confunde en la campaña de Eutanasia pero no en Cremación) van a nivel CAMPAÑA, no en la lista compartida — la lista compartida es una vía de un solo sentido: agregar algo ahí por error afecta TODAS las campañas a la vez.`

export const GUIA_GADS_TERMINOS = `WORKFLOW DE TÉRMINOS DE BÚSQUEDA SANGRANTES (limpieza de gasto desperdiciado) — seguir este proceso siempre, nunca negativar en bloque sin este filtro:
1. CANDIDATO: un término de búsqueda real (lo que la gente escribió, no la keyword que lo activó) califica como candidato SOLO si tiene ≥100 impresiones (nunca bajar de 50 — con menos, el dato es ruido estadístico, no señal) Y ≥$10.000 CLP gastados sin conversión (o costo por conversión muy por encima del promedio de la campaña).
2. VEREDICTO por intención del término (no por volumen ni costo solos):
   - BAD (negativar): intención de empleo/trabajo, DIY/"cómo hacerlo yo mismo", puramente informacional (definiciones, "qué es"), geografía fuera de cobertura (otro país, otra región que no se sirve).
   - KEEP (no tocar): términos que muestran intención real de compra del servicio, incluso si mencionan un competidor o son de comparación ("mejor crematorio santiago", "cremación vs entierro mascota" con intención de decidir).
   - UNCERTAIN (revisar caso a caso, NUNCA negativar sin aprobación explícita término por término): términos ambiguos, mezcla de señales, volumen bajo pero plausible.
3. SIEMPRE mostrar la tabla completa de candidatos con su veredicto ANTES de negativar nada — nunca negativar en lote sin que el dueño vea la lista y apruebe explícitamente ("agregá todos los BAD" es una aprobación válida; los UNCERTAIN requieren un sí explícito por término).
4. Match type por defecto al negativar: PHRASE (bloquea variantes cercanas del término sin ser tan amplio como para arriesgar intención buena).
5. Las negativas por este workflow van a nivel CAMPAÑA (son intención específica de esa campaña), salvo que el mismo patrón aparezca repetido en varias campañas — ahí evaluar subirlo a la lista compartida.`

export const GUIA_GADS_QS = `QUALITY SCORE (QS) — qué es y qué lo mueve (para explicarle al dueño y para priorizar los hallazgos de la auditoría):
El QS (1-10, visible por keyword) se calcula de 3 factores, en este orden de peso:
1. CTR esperado (a nivel anuncio): lo que más se puede influir con mejor copy — variar los 6 ángulos de titulares en vez de repetir variaciones casi idénticas del mismo mensaje.
2. Relevancia del anuncio (a nivel anuncio): que la keyword aparezca literalmente en los titulares pinneados en slot 1; un anuncio que nunca menciona la keyword tiene mala relevancia aunque el copy sea bueno.
3. Experiencia de la landing page (a nivel de la página, NO se puede arreglar con mejor copy de anuncio): que el H1 de la landing coincida palabra por palabra con el titular del anuncio, carga rápida, contenido relevante al término buscado. Si el QS es bajo por este factor, la solución es una landing dedicada (ver la migración del sitio a landing pages por keyword, fuera del alcance de esta tanda).
IMPORTANTE: Ad Strength (el medidor "Malo/Regular/Bueno/Excelente" que muestra Google al editar un anuncio) NO es lo mismo que Quality Score. Un anuncio con Ad Strength "Excelente" en una keyword con mala landing page igual puede tener QS bajo — Ad Strength solo mide variedad de recursos del anuncio, no landing page ni historial real de CTR.`

/**
 * Versión MÁQUINA-LEGIBLE (no prosa) de los "candidatos universales a negativar" de
 * GUIA_GADS_NEGATIVAS — la usa lib/google-ads.ts para crear la lista compartida real
 * por API (Fase C). Match type BROAD por defecto (mismo criterio que la fuente: un
 * negativo BROAD de una sola palabra ya bloquea cualquier búsqueda que la contenga).
 * Si se edita la prosa de GUIA_GADS_NEGATIVAS, mantené esta lista sincronizada.
 */
export const NEGATIVAS_UNIVERSALES_ES_CL: { texto: string; matchType: 'BROAD' }[] = [
  // Empleo/trabajo
  'trabajo', 'empleo', 'empleos', 'se busca', 'busco trabajo', 'sueldo', 'cuánto gana',
  'ofertas de trabajo', 'postular', 'currículum', 'cv', 'práctica', 'pasantía', 'vacante',
  // Educación/formación
  'curso', 'cursos', 'capacitación', 'certificación veterinaria', 'escuela veterinaria',
  'cómo estudiar', 'universidad', 'carrera de veterinaria', 'título',
  // Hazlo tú mismo / informacional
  'cómo cremar', 'cómo hacer', 'cremación casera', 'hazlo tú mismo', 'tutorial', 'paso a paso',
  'wikipedia', 'qué significa', 'definición', 'qué es la cremación', 'foro', 'reddit',
  // Gratis/regalo
  'gratis', 'regalo', 'sorteo', 'promoción gratis', 'muestra gratis', 'descuento código', 'cupón',
  // Segunda mano / no aplica al rubro
  'usado', 'segunda mano', 'se vende', 'remate', 'liquidación',
  // Empleo específico veterinario
  'veterinario se necesita', 'clínica veterinaria empleo', 'auxiliar veterinario trabajo',
].map(texto => ({ texto, matchType: 'BROAD' as const }))
