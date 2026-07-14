/**
 * REGLAS INVIOLABLES de voz y hechos de marca — Crematorio Alma Animal.
 *
 * Bloque CORTO y SALIENTE para inyectar al INICIO y al FINAL del system de TODOS los
 * puntos que redactan copy/piezas (chat de marketing, generador de piezas, editor de
 * placas). Son reglas BINARIAS de negocio: no pueden depender de que el LLM las
 * recuerde entre miles de tokens, así que además se validan de forma determinista a
 * la salida con el linter (lib/marketing-lint.ts, que consume TERMINOS_PROHIBIDOS).
 *
 * Si cambian las reglas de voz, se editan ACÁ (una sola fuente). Los hechos del
 * negocio viven en lib/diferenciadores.ts.
 */

export const REGLAS_INVIOLABLES = `REGLAS INVIOLABLES DE MARCA (NO las rompas — son decisiones del dueño y se validan por código a la salida; una pieza que las viole se RECHAZA y se vuelve a generar):
- A la mascota: por su NOMBRE cuando se sepa; genérico "tu mascota". PROHIBIDO: "compañero/a", "su mascota", "mascotita".
- SIN clichés del rubro: nada de "puente del arcoíris", "angelito", "tu ángel", "ya no sufre", "mejor amigo peludo". SIN humor, SIN religión.
- Español neutro de Chile; NUNCA voseo argentino.
- Lo CERTIFICADO es el HORNO. La cámara es de REFRIGERACIÓN: NUNCA escribas "cámara certificada" ni "sala certificada". NO menciones "ISO" (solo "horno certificado").
- NUNCA digas "cada cremación es individual": "Cremación Individual" es SOLO el nombre de una de las modalidades.
- Qué INCLUYE cada modalidad sale SOLO del bloque "MODALIDADES DE CREMACIÓN" que se te entrega: en tablas/comparativas usa EXACTAMENTE esos ítems, sin inventar ni omitir (ojo: Sin Devolución SÍ incluye certificado de cremación).
- Decí "ánfora", NUNCA "urna" (vocabulario de marca).
- NUNCA inventes precios, promociones ni datos. Plazos: SOLO los oficiales (entrega en 4 días hábiles, o 2 días hábiles con el Servicio Express opcional; retiro habitualmente en menos de 3 horas). Ningún otro plazo.
- Teléfono y web: usá EXACTAMENTE los datos de contacto que se te entregan; no los reescribas de memoria.
- En PLACAS/gráficos (motor satori): NO uses flechas (→), emojis (🐾 ✅) ni símbolos Unicode raros — el motor los dibuja como cajas rotas. Reemplazalos por texto.`

/** Una regla de copy validable por código (la usa el linter sobre caption + texto de placas). */
export interface ReglaCopy { patron: RegExp; mensaje: string }

/**
 * Términos/datos PROHIBIDOS, de alta confianza (poco riesgo de falso positivo).
 * El linter los corre sobre el copy generado y, si alguno matchea, rechaza la pieza
 * y la regenera inyectando el mensaje como feedback.
 */
export const TERMINOS_PROHIBIDOS: ReglaCopy[] = [
  { patron: /\bcompañer[oa]s?\b/i, mensaje: 'No uses "compañero/a": usá "tu mascota" o el nombre de la mascota.' },
  { patron: /\bsu mascota\b/i, mensaje: 'No uses el frío "su mascota": usá "tu mascota" (tuteo).' },
  { patron: /\bmascotita?s?\b/i, mensaje: 'No uses diminutivos como "mascotita".' },
  { patron: /puente del arco[ií]ris/i, mensaje: 'Cliché del rubro prohibido: "puente del arcoíris".' },
  { patron: /\bangelit[oa]s?\b/i, mensaje: 'Cliché del rubro prohibido: "angelito".' },
  { patron: /\btu[ ]ángel\b/i, mensaje: 'Cliché del rubro prohibido: "tu ángel".' },
  { patron: /ya no sufre/i, mensaje: 'Cliché del rubro prohibido: "ya no sufre".' },
  { patron: /mejor amigo peludo/i, mensaje: 'Cliché del rubro prohibido: "mejor amigo peludo".' },
  { patron: /c[áa]mara certificada|sala certificada/i, mensaje: 'Dato falso: la cámara es de REFRIGERACIÓN, no "certificada". Lo certificado es el horno.' },
  { patron: /\bISO\b/, mensaje: 'No menciones "ISO": decí solo "horno certificado".' },
  { patron: /cada cremaci[óo]n es individual|todas las cremaciones son individuales/i, mensaje: '"Cremación Individual" es solo el nombre de una modalidad, no una garantía general.' },
  { patron: /\burnas?\b/i, mensaje: 'Vocabulario de marca: decí "ánfora", no "urna".' },
]
