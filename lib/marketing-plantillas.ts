import { BRAND } from './email-layout'
import type { FotoGrafico } from './marketing-grafico'

/**
 * PLANTILLAS MAESTRAS de marca (Capa 2). En vez de que el modelo escriba HTML de
 * layout a mano (frágil: encimados, velos que cortan al sujeto, sobrecarga), elige
 * UNA plantilla y llena SLOTS estructurados. El layout sale de código PROBADO y
 * satori-safe: flex-column, zona segura, tipografía auto-ajustada al texto, y un
 * PRESUPUESTO de contenido fijo por plantilla (no se puede sobrecargar).
 *
 * Cada plantilla devuelve { html, fotos }: el HTML listo para generarGraficoMarca
 * (que lo rasteriza con las fuentes reales) y las fotos a generar (FOTO:slot).
 * Esto reusa TODO el pipeline existente (foto IA, logo, render con el fix de
 * flex-shrink, QA, banco). La marca (color/tipografía/logo) queda EXACTA.
 */

const NAVY = BRAND.navy
const GOLD = BRAND.amber
const CREAM = BRAND.cream
const WHITE = '#ffffff'
const INK = '#22303f'
const SOFT = '#e8eef5' // texto claro sobre navy/foto

const DIMS: Record<string, { w: number; h: number }> = {
  post_vertical: { w: 1080, h: 1350 },
  post: { w: 1080, h: 1080 },
  story: { w: 1080, h: 1920 },
  horizontal: { w: 1200, h: 675 },
}

const PAD = 72 // zona segura lateral

function esc(s: unknown): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
function clampText(s: string, max: number): string {
  const t = (s || '').trim()
  if (t.length <= max) return t
  // Corta en el último espacio dentro del límite para no partir una palabra
  // al medio (ej. "exposición d…"); si no hay espacio razonable, corta seco.
  const cut = t.slice(0, max - 1)
  const lastSpace = cut.lastIndexOf(' ')
  const safe = lastSpace > max * 0.5 ? cut.slice(0, lastSpace) : cut
  return safe.trimEnd() + '…'
}
/** Tamaño de fuente que hace CABER `text` en `maxW` (Inter bold ≈ 0.60×fs por glifo).
 *  Nunca deja que la palabra más larga se desborde a lo ancho. */
function fitFont(text: string, maxW: number, fsMax: number, fsMin: number, factor = 0.60): number {
  const t = (text || '').trim()
  if (!t) return fsMax
  const longest = t.split(/\s+/).reduce((m, w) => Math.max(m, w.length), 1)
  const fsWhole = maxW / (t.length * factor)   // todo en una línea
  const fsWord = maxW / (longest * factor)      // que la palabra más larga no desborde
  const fs = Math.min(fsMax, Math.max(fsWhole, fsMin), fsWord)
  return Math.round(Math.max(fsMin, Math.min(fsMax, fs)))
}

export interface SlotsPlantilla {
  eyebrow?: string
  titulo?: string
  /** 2ª línea del titular, en dorado (va en su propia línea). */
  titulo_destacado?: string
  bajada?: string
  bullets?: string[]
  /** Plantilla 'dato': el número/palabra protagonista. */
  dato?: string
  dato_label?: string
  /** CTA (teléfono o acción corta) + secundario (web). */
  cta?: string
  cta_secundario?: string
  fondo?: 'navy' | 'crema' | 'blanco'
  foto?: { prompt?: string; url?: string }

  // ── Slots de las plantillas nuevas (2026-08) ────────────────────────────────
  /** Encabezado del SEGUNDO lado/columna ('comparativa'). */
  titulo_b?: string
  /** Items del SEGUNDO lado/columna ('comparativa'). */
  bullets_b?: string[]
  /** Pares clave→valor ('horario', 'comparativa' en modo tabla). */
  filas?: { izq: string; der: string }[]
  /** Varias cifras ('mosaico_datos'): 2 a 4 celdas. */
  datos?: { valor: string; label: string }[]
  /** Varias fotos ('collage'): 1 grande + 2 chicas. */
  fotos?: { prompt?: string; url?: string }[]
  /** Nota al pie / aclaración chica ('precio', 'horario', 'mosaico_datos'). */
  pie?: string
  /** Años de la mascota en las plantillas 'memorial_*' (ej. "2014 — 2026"). */
  fechas?: string
}

export interface OpcionesPlantilla {
  formato?: string
  logoBlanco?: string  // logo variante blanca (para fondos oscuros/foto)
  logoNavy?: string    // logo variante navy (para fondos claros)
}

export interface ResultadoPlantilla { html: string; fotos: FotoGrafico[] }

export const PLANTILLAS = [
  // base
  'portada', 'contenido', 'dato', 'foto', 'cierre', 'cita', 'split', 'numeros', 'marco',
  // 2026-08: estructuras nuevas para romper la monotonía del feed
  'revista', 'diptico', 'comparativa', 'timeline', 'collage', 'faq', 'precio',
  'arco', 'bicolor', 'checklist', 'mosaico_datos', 'testimonio', 'horario',
  'overlay', 'tipografico',
  // MEMORIAL: homenaje a UNA mascota por su nombre. 15 estructuras distintas
  // (2026-08: de 5 a 15, para que las historias de despedida no se repitan).
  'memorial_placa', 'memorial_retrato', 'memorial_medallon', 'memorial_cuadro', 'memorial_cinta',
  'memorial_horizonte', 'memorial_polaroid', 'memorial_orla', 'memorial_susurro', 'memorial_estela',
  'memorial_alba', 'memorial_carta', 'memorial_silueta', 'memorial_diptico', 'memorial_huella',
] as const
export type NombrePlantilla = (typeof PLANTILLAS)[number]

/** Las QUINCE de homenaje: el agente DEBE rotarlas, no usar siempre la misma.
 *  Es también el pozo del que sale al azar la historia de despedida de cada
 *  mascota entregada (lib/memorial.ts). Todas llevan foto. */
export const PLANTILLAS_MEMORIAL: NombrePlantilla[] = [
  'memorial_placa', 'memorial_retrato', 'memorial_medallon', 'memorial_cuadro', 'memorial_cinta',
  'memorial_horizonte', 'memorial_polaroid', 'memorial_orla', 'memorial_susurro', 'memorial_estela',
  'memorial_alba', 'memorial_carta', 'memorial_silueta', 'memorial_diptico', 'memorial_huella',
]

/** Plantillas que llevan al menos una FOTO (para equilibrar una tanda). */
export const PLANTILLAS_CON_FOTO: NombrePlantilla[] = [
  'foto', 'marco', 'split', 'revista', 'diptico', 'collage', 'arco', 'testimonio', 'overlay',
  ...PLANTILLAS_MEMORIAL,
]

export type FamiliaPlantilla = 'apiladas' | 'foto' | 'listas' | 'cifras' | 'texto' | 'memorial'

/**
 * FAMILIA de cada plantilla. Es la unidad que se controla para la rotación: dos
 * piezas de la misma familia se ven parecidas aunque la plantilla sea distinta
 * (dos listas siguen siendo dos listas). Fuente única — la consume el validador
 * determinista de `generar_pieza`, no solo el prompt.
 */
export const FAMILIA: Record<NombrePlantilla, FamiliaPlantilla> = {
  portada: 'apiladas', contenido: 'apiladas', cierre: 'apiladas',
  foto: 'foto', marco: 'foto', split: 'foto', revista: 'foto', diptico: 'foto',
  collage: 'foto', arco: 'foto', overlay: 'foto',
  numeros: 'listas', checklist: 'listas', timeline: 'listas', comparativa: 'listas',
  dato: 'cifras', mosaico_datos: 'cifras', precio: 'cifras',
  cita: 'texto', testimonio: 'texto', faq: 'texto', tipografico: 'texto',
  bicolor: 'texto', horario: 'texto',
  memorial_placa: 'memorial', memorial_retrato: 'memorial', memorial_medallon: 'memorial',
  memorial_cuadro: 'memorial', memorial_cinta: 'memorial', memorial_horizonte: 'memorial',
  memorial_polaroid: 'memorial', memorial_orla: 'memorial', memorial_susurro: 'memorial',
  memorial_estela: 'memorial', memorial_alba: 'memorial', memorial_carta: 'memorial',
  memorial_silueta: 'memorial', memorial_diptico: 'memorial', memorial_huella: 'memorial',
}

export const familiaDe = (p?: string): FamiliaPlantilla | null =>
  (p && FAMILIA[p as NombrePlantilla]) || null

/** ¿Esta plantilla muestra una foto? (para exigir fotos en una tanda). */
export const llevaFoto = (p?: string): boolean =>
  !!p && PLANTILLAS_CON_FOTO.includes(p as NombrePlantilla)

/**
 * Descripción del enum `plantilla` para las TOOLS del modelo. Fuente única: la
 * usan `disenar_plantilla` (chat) y `generar_pieza` (calendario), así que sumar
 * una plantilla no deja una de las dos desactualizada.
 */
export const PLANTILLA_TOOL_DESC =
  'Qué plantilla usar. BASE: portada (apertura/gancho) · contenido (idea + bullets) · dato (una cifra grande) · ' +
  'foto (foto protagonista con una frase) · cierre (CTA final) · cita (frase destacada, sin foto) · ' +
  'split (foto al lado del texto) · numeros (lista numerada) · marco (foto enmarcada). ' +
  'ESTRUCTURAS NUEVAS (usalas seguido): revista (portada editorial: foto a sangre + banda con el titular) · ' +
  'diptico (mitad foto / mitad color, titular centrado) · comparativa (dos columnas: nosotros vs lo habitual) · ' +
  'timeline (hitos en un riel dorado) · collage (3 fotos) · faq (pregunta grande + respuesta) · ' +
  'precio (tarjeta de plan con cifra y qué incluye) · arco (foto en un arco, editorial) · ' +
  'bicolor (lienzo partido navy/claro con el titular a caballo) · checklist (items en barras con filete) · ' +
  'mosaico_datos (grilla 2×2 de cifras) · testimonio (avatar redondo + cita) · horario (filas clave→valor) · ' +
  'overlay (foto a sangre + tarjeta flotante) · tipografico (póster de una palabra). ' +
  'MEMORIAL (homenaje a una mascota, titulo = su nombre + fechas = sus años; ROTÁ las cinco, nunca dos seguidas iguales): ' +
  'memorial_placa (foto a sangre + placa crema) · memorial_retrato (foto vertical + columna) · ' +
  'memorial_medallon (medallón circular dorado — la foto REDONDA es EXCLUSIVA de los homenajes, en piezas comerciales usá "arco") · memorial_cuadro (retrato enmarcado) · ' +
  'memorial_cinta (foto arriba + banda navy con el nombre en dorado) · memorial_horizonte (foto + franja crema con nombre y fechas) · ' +
  'memorial_polaroid (instantánea de papel) · memorial_orla (marco dorado + placa navy) · memorial_susurro (manda la dedicatoria, foto chica) · ' +
  'memorial_estela (banda vertical + foto a sangre) · memorial_alba (degradé cálido + arco) · memorial_carta (tarjeta con nota) · ' +
  'memorial_silueta (velo navy + nombre gigante) · memorial_diptico (mitad foto / mitad texto + banda) · memorial_huella (nombre enorme de fondo). ' +
  'ROTÁ: no repitas plantilla ni familia dentro de una misma tanda; al menos 1 de cada 3 piezas con FOTO.'

/**
 * Propiedades del objeto `slots` para el input_schema de las tools. Compartido
 * por las dos herramientas por la misma razón que `PLANTILLA_TOOL_DESC`.
 */
export const SLOTS_TOOL_PROPS: Record<string, unknown> = {
  eyebrow: { type: 'string', description: 'Etiqueta corta arriba (ej. "PARA VETERINARIOS"). En "precio" es el nombre del plan; en "tipografico" la línea chica de arriba.' },
  titulo: { type: 'string', description: 'Titular (2-4 palabras). En "foto"/"cita"/"testimonio" es la frase; en "faq" la pregunta; en "tipografico" la palabra grande.' },
  titulo_destacado: { type: 'string', description: '2ª línea del titular; sale en DORADO, en su propia línea. En "bicolor" es la línea que cae en el bloque claro.' },
  bajada: { type: 'string', description: 'Frase de apoyo corta. En "faq" es la RESPUESTA (hasta ~260 car); en "cita"/"testimonio" el autor.' },
  bullets: { type: 'array', items: { type: 'string' }, description: 'Items cortos: "contenido" (2-4) · "numeros" (pasos) · "timeline" (hitos) · "checklist" (2-5) · "comparativa" (lo nuestro) · "precio" (qué incluye) · "split"/"bicolor" (2-3).' },
  bullets_b: { type: 'array', items: { type: 'string' }, description: 'Solo "comparativa": items de la columna de enfrente ("lo habitual").' },
  titulo_b: { type: 'string', description: 'Solo "comparativa": encabezado de NUESTRA columna (ej. "Alma Animal").' },
  filas: {
    type: 'array',
    description: 'Solo "horario": 2-5 pares clave→valor (ej. izq "Lunes a domingo", der "09:00–22:00").',
    items: { type: 'object', properties: { izq: { type: 'string' }, der: { type: 'string' } } },
  },
  datos: {
    type: 'array',
    description: 'Solo "mosaico_datos": 2-4 cifras (valor = el número, label = qué es).',
    items: { type: 'object', properties: { valor: { type: 'string' }, label: { type: 'string' } } },
  },
  dato: { type: 'string', description: '"dato": el número/palabra grande (ej. "4 días"). "precio": la cifra (ej. "$120.000").' },
  dato_label: { type: 'string', description: 'Qué es esa cifra (acompaña a "dato").' },
  pie: { type: 'string', description: 'Letra chica al pie ("precio", "horario", "mosaico_datos").' },
  fechas: { type: 'string', description: 'Solo "memorial_*": los años de la mascota (ej. "2014 — 2026").' },
  cta: { type: 'string', description: 'CTA corto o teléfono.' },
  cta_secundario: { type: 'string', description: 'Web o dato secundario del CTA.' },
  fondo: { type: 'string', enum: ['navy', 'crema', 'blanco'], description: 'Fondo dominante (alterná entre piezas). En "overlay" es el color de la tarjeta.' },
  foto: {
    type: 'object',
    description: 'Foto de la plantilla. prompt para generar una nueva, o url para reutilizar una del banco.',
    properties: { prompt: { type: 'string', description: 'Descripción fotográfica cálida y CONCRETA (especie, escena, hora, ángulo). Mascota viva; NUNCA instalaciones.' }, url: { type: 'string', description: 'URL exacta del banco para reutilizar.' } },
  },
  fotos: {
    type: 'array',
    description: 'Solo "collage": 3 fotos (la 1ª va grande arriba). Cada una con prompt o url.',
    items: { type: 'object', properties: { prompt: { type: 'string' }, url: { type: 'string' } } },
  },
}

/** Guía de slots por plantilla, para el prompt/tool del modelo. */
export const PLANTILLAS_INFO = `PLANTILLAS DISPONIBLES (elegí UNA y llená sus slots; el layout ya es on-brand y no se rompe):
- "portada": gancho/apertura. slots: eyebrow (corto, ej. "PARA VETERINARIOS"), titulo (2-4 palabras), titulo_destacado (2ª línea, sale en dorado), bajada (1 frase corta, máx ~120 car), foto {prompt} (opcional; va en banda arriba), fondo (navy/crema/blanco), cta + cta_secundario (opcional). NO lleva bullets.
- "contenido": una idea con apoyos. slots: eyebrow (opcional), titulo, bullets (2-4, MUY cortos), bajada (opcional), foto {prompt} (opcional), fondo. Para láminas de carrusel educativas.
- "dato": una cifra/palabra fuerte. slots: dato (el número/palabra grande, ej. "4 días"), dato_label (qué es), bajada (1 línea de apoyo), fondo.
- "foto": foto protagonista, casi sin texto. slots: foto {prompt} (obligatoria), titulo (UNA frase corta encima), fondo. Para piezas emocionales/estéticas.
- "cierre": llamado a la acción final. slots: titulo, cta (ej. teléfono), cta_secundario (web), bajada (opcional), fondo, foto {prompt} (opcional, banda arriba).
- "cita": testimonio o frase destacada (gran comilla dorada). slots: titulo (la frase/testimonio, ~1-2 líneas), bajada (autor: "María, tutora de Rocky" o "Clínica X"), eyebrow (opcional), fondo (default crema/claro). SIN foto. Ideal para PRUEBA SOCIAL y frases de marca.
- "split": editorial lado-a-lado — foto a la izquierda, texto a la derecha (layout DISTINTO a los apilados). slots: foto {prompt} (obligatoria), titulo, titulo_destacado (opcional, dorado), bajada (opcional), bullets (2-3, opcional), cta (opcional), fondo (del panel de texto; default crema). Para una idea con una foto potente, con aire de revista.
- "numeros": lista NUMERADA (pasos o razones) con números dorados grandes — otro ritmo visual que los bullets. slots: eyebrow (opcional), titulo, bajada (opcional), bullets (2-4, cada uno es un paso/razón, MUY cortos), fondo (default crema). Ideal para "los pasos del proceso", "3 razones para…". SIN foto.
- "marco": foto ENMARCADA (estilo galería) centrada, con aire alrededor + pie de foto. slots: foto {prompt} (obligatoria), titulo (frase/pie centrado), bajada (opcional, autor/contexto), fondo (default crema). Distinta de "foto" (full-bleed): acá la foto respira sobre el color de marca. Cálida para homenajes, humanización y prueba social.

ESTRUCTURAS NUEVAS (romper el molde apilado — usalas SEGUIDO, no son "de repuesto"):
- "revista": portada editorial. Foto A SANGRE arriba (2/3 del alto) y una BANDA sólida abajo con el titular. slots: foto {prompt} (obligatoria), eyebrow, titulo, titulo_destacado, bajada, cta, fondo (de la banda). La más linda para abrir una campaña.
- "diptico": mitad foto / mitad color, con el titular CENTRADO (el resto de las plantillas alinea a la izquierda → cambia el ritmo). slots: foto {prompt} (obligatoria), titulo, titulo_destacado, bajada, fondo.
- "comparativa": DOS columnas enfrentadas. La izquierda (dorada, destacada) somos nosotros; la derecha, "lo habitual". slots: titulo, titulo_b (encabezado de la columna nuestra, ej. "Alma Animal"), bullets (2-4, lo nuestro), bullets_b (2-4, lo otro), fondo. Ideal para diferenciadores.
- "timeline": hitos enlazados por un riel dorado vertical. slots: eyebrow, titulo, bullets (2-4 = los hitos), fondo. Para "cómo es el proceso", "qué pasa después de llamarnos".
- "collage": mosaico de 3 fotos (1 grande + 2 chicas) + titular abajo. slots: fotos [{prompt} ×3], titulo, titulo_destacado, bajada, fondo. Muy vivo para "un día en Alma Animal" o variedad de mascotas.
- "faq": una PREGUNTA grande con signo dorado + su respuesta. slots: eyebrow (default "Preguntas frecuentes"), titulo (la pregunta), bajada (la respuesta, hasta ~260 car), cta, fondo. Formato que la gente lee.
- "precio": tarjeta de plan/servicio. slots: eyebrow (nombre del plan), titulo, dato (la cifra, ej. "$120.000"), dato_label ("Cremación individual hasta 10 kg"), bullets (2-4 = qué incluye), cta, pie (letra chica), fondo.
- "arco": la foto dentro de un ARCO (rectángulo con la parte de arriba redondeada) y el texto abajo. slots: foto {prompt} (obligatoria), eyebrow, titulo, bajada, cta, fondo. Cálida y editorial para retratos y presentaciones. ⚠️ La foto REDONDA tipo foto de perfil quedó RESERVADA para los homenajes ("memorial_medallon"): en una pieza comercial se lee como memorial, así que acá usá el arco.
- "bicolor": el lienzo partido en dos bloques (navy arriba / claro abajo) y el titular a caballo: titulo va en el navy y titulo_destacado en el claro. slots: eyebrow, titulo, titulo_destacado, bajada, bullets (2-3), cta.
- "checklist": cada item en su propia BARRA con filete dorado (más contundente que los bullets). slots: eyebrow, titulo, bullets (2-5), fondo. Para "qué incluye", "lo que sí hacemos".
- "mosaico_datos": grilla de 2×2 con cifras. slots: titulo, datos [{valor, label} ×2-4], pie, fondo. Para varios números juntos (dato = uno solo).
- "testimonio": foto del tutor en cuadrado redondeado + comilla + la cita. Prueba social CON cara (cita es solo tipografía). slots: foto {prompt} (obligatoria: retrato cálido de un tutor con su mascota), titulo (el testimonio), bajada (autor), fondo.
- "horario": filas clave→valor con líneas. slots: eyebrow, titulo, filas [{izq, der} ×2-5] (ej. izq "Lunes a domingo" / der "09:00–22:00"), pie, cta, fondo. Para horarios, cobertura por comuna, plazos.
- "overlay": foto A SANGRE + una TARJETA clara flotando encima abajo (no un velo). slots: foto {prompt} (obligatoria), eyebrow, titulo, titulo_destacado, bajada, cta, fondo (color de la tarjeta). Se ve moderna y deja ver la foto entera.
- "tipografico": póster de UNA idea, la palabra manda (tipografía gigante). slots: eyebrow (línea chica arriba), titulo (la palabra/frase grande), titulo_destacado (2ª línea en dorado), bajada. SIN foto. Para una frase de marca con impacto.

MEMORIAL — homenaje a UNA mascota por su nombre (5 estructuras; ROTALAS, es lo que más se publica y no puede salir siempre igual). En las cinco: titulo = el NOMBRE de la mascota, fechas = sus años ("2014 — 2026"), bajada = la dedicatoria (una frase concreta y cotidiana, no un lugar común), eyebrow = "En memoria" / "Hasta siempre" / etc., foto = retrato CÁLIDO de la mascota VIVA y en calma (jamás enferma ni "ausente"; nada de urnas, lápidas, velas, arcoíris ni símbolos religiosos):
- "memorial_placa": foto a sangre + una placa color crema centrada abajo con el nombre. La más sobria y la más linda para el feed.
- "memorial_retrato": foto vertical a sangre a la izquierda y una columna de homenaje a la derecha. Aire de página de revista.
- "memorial_medallon": foto en un medallón CIRCULAR con anillo dorado, centrado, con el nombre gigante de fondo. Solemne sin ser fúnebre.
- "memorial_cuadro": la foto enmarcada como un retrato colgado (passe-partout blanco grueso) y el nombre debajo. Cálida, de living.
- "memorial_cinta": foto arriba y una banda navy abajo con el nombre en dorado. La más gráfica.
- "memorial_horizonte": foto a sangre arriba y una franja crema abajo con el nombre a la izquierda y las fechas a la derecha. Limpia y editorial.
- "memorial_polaroid": la foto como una instantánea de papel blanco, con el nombre en el borde de abajo. Íntima y de álbum familiar.
- "memorial_orla": foto a sangre con un marco dorado fino por dentro y una placa navy con el nombre. Solemne y elegante.
- "memorial_susurro": casi sin foto (un medallón chico arriba); manda la DEDICATORIA en grande. Para cuando el texto del tutor es lo lindo.
- "memorial_estela": banda vertical navy a la izquierda con el nombre y foto a sangre a la derecha. Moderna y con carácter.
- "memorial_alba": fondo con degradé cálido y la foto en un arco alto. Luminosa y esperanzadora.
- "memorial_carta": una tarjeta crema con filete dorado sobre navy, con la dedicatoria como una nota escrita. La más personal.
- "memorial_silueta": foto a sangre bajo un velo navy parejo y el nombre GIGANTE centrado encima. La más impactante.
- "memorial_diptico": mitad foto y mitad bloque crema con la dedicatoria; el nombre cruza abajo en una banda navy.
- "memorial_huella": el nombre enorme de fondo sobre navy y la foto en una tarjeta desplegada abajo. Contemporánea.

ENCUADRE DE LAS FOTOS (regla dura — el dueño rebotó una pieza donde la placa le tapaba el hocico al gato): en las plantillas que apoyan TEXTO ENCIMA de la foto ("foto", "overlay", "memorial_placa", y las bandas de "portada" y "revista"), el prompt de la foto DEBE dejar despejada la zona donde va el texto: mascota en la mitad de arriba y la mitad de abajo libre (piso, manta, pasto, fondo liso). El sistema ya le agrega esa exigencia al prompt, pero escribilo vos también en la descripción de la escena. Y en TODAS: la cara y los ojos de la mascota se ven COMPLETOS, nunca cortados por el borde ni tapados por un bloque de texto, un velo o el logo.

Reglas: textos CORTOS (si no caben, se recortan). El fondo alterna navy/crema/blanco entre piezas — la PORTADA también (ya NO es siempre navy): NO dejes todas las portadas en navy, variá a crema o blanco (o con la foto mandando) para que el feed no se vea "todo azul". Regla práctica: máximo ~1 de cada 3 piezas de una misma tanda con fondo navy dominante. La foto: mascota viva y feliz o tutor con su mascota, cálida; NUNCA instalaciones. El logo se coloca solo.
ROTACIÓN (regla dura, feedback del dueño "los posts son siempre parecidos"): hay 29 plantillas. En una misma tanda/carrusel NO repitas plantilla, y NO uses dos veces seguidas la misma FAMILIA (apiladas: portada/contenido/cierre · foto protagonista: foto/marco/revista/diptico/overlay/arco/collage · listas: numeros/checklist/timeline/comparativa · cifras: dato/mosaico_datos/precio · texto: cita/testimonio/faq/tipografico/bicolor · memorial: las cinco memorial_*). Al menos 1 de cada 3 piezas tiene que llevar FOTO. En los HOMENAJES: nunca dos memoriales seguidos con la misma plantilla — llevá la cuenta y andá rotando las cinco. Si te pasan las "ÚLTIMAS PIEZAS GENERADAS", elegí plantillas de familias que NO aparezcan ahí.`

// ─── helpers de bloque ────────────────────────────────────────────────────────
function eyebrowChip(text: string, abs?: { top: number; left: number }): string {
  const pos = abs ? `position:absolute;top:${abs.top}px;left:${abs.left}px;` : 'align-self:flex-start;margin-bottom:24px;'
  return `<div style="display:flex;${pos}background:${GOLD};border-radius:8px;padding:9px 22px"><span style="font-family:Inter;font-weight:700;font-size:24px;color:${NAVY};letter-spacing:1px">${esc((text || '').toUpperCase())}</span></div>`
}
function tituloBloque(s: SlotsPlantilla, colorPrincipal: string, maxW: number, fsMax: number): string {
  const largo = [s.titulo, s.titulo_destacado].filter((x): x is string => !!x).reduce((m, l) => (l.length > m.length ? l : m), '')
  const fs = fitFont(largo, maxW, fsMax, 40)
  const l1 = s.titulo ? `<span style="font-family:Inter;font-weight:700;font-size:${fs}px;color:${colorPrincipal};line-height:1.06">${esc(s.titulo)}</span>` : ''
  const l2 = s.titulo_destacado ? `<span style="font-family:Inter;font-weight:700;font-size:${fs}px;color:${GOLD};line-height:1.06">${esc(s.titulo_destacado)}</span>` : ''
  return `<div style="display:flex;flex-direction:column">${l1}${l2}</div>`
}
function ruleGold(): string {
  return `<div style="width:64px;height:5px;background:${GOLD};border-radius:3px;margin-top:28px"></div>`
}
function ctaRow(s: SlotsPlantilla, oscuro: boolean): string {
  if (!s.cta && !s.cta_secundario) return ''
  const chip = s.cta ? `<div style="display:flex;background:${GOLD};border-radius:10px;padding:16px 32px"><span style="font-family:Inter;font-weight:700;font-size:28px;color:${NAVY}">${esc(clampText(s.cta, 24))}</span></div>` : ''
  const sec = s.cta_secundario ? `<span style="font-family:Inter;font-weight:400;font-size:26px;color:${oscuro ? SOFT : INK}">${esc(clampText(s.cta_secundario, 32))}</span>` : ''
  return `<div style="display:flex;flex-direction:row;align-items:center;gap:20px;margin-top:36px">${chip}${sec}</div>`
}
function logoImg(url: string | undefined, abs: string, w = 168): string {
  return url ? `<img src="${esc(url)}" width="${w}" style="position:absolute;${abs}" />` : ''
}
/** Logo EN FLUJO (no absoluto): para apilarlo debajo del texto sin encimarse. */
function logoFlow(url: string | undefined, w = 168): string {
  return url ? `<div style="display:flex"><img src="${esc(url)}" width="${w}" /></div>` : ''
}
/**
 * Alto reservado abajo para el logo. El lockup (huella + "ALMA ANIMAL" + bajada)
 * es casi cuadrado: a 150-168px de ancho mide ~150px de alto, y con su margen
 * inferior ocupa hasta ~200px. Con los 120px que había antes, un cuerpo largo se
 * le metía encima. Es padding, así que solo agrega aire.
 */
const ZONA_LOGO = 200
function bgColor(fondo?: string): string {
  return fondo === 'crema' ? CREAM : fondo === 'blanco' ? WHITE : NAVY
}

// ─── capas gráficas (lo que separa una placa de un documento de Word) ─────────
// Las plantillas de SOLO TEXTO se veían planas: tipografía centrada sobre un
// color liso. Estos helpers agregan profundidad sin romper nada — todo es flex
// + position:absolute + opacity, que es lo único que satori entiende bien.

/**
 * Tipografía GIGANTE y tenue de fondo (un número, una palabra, una comilla).
 * Es el recurso editorial clásico para que una placa de texto tenga capas: se
 * ve la trama, no se lee, y el contenido real queda encima.
 */
function ghost(texto: string, o: {
  size: number; color: string; opacidad?: number
  top?: number; left?: number; right?: number; bottom?: number
}): string {
  if (!texto) return ''
  const pos = [
    o.top !== undefined ? `top:${o.top}px` : '', o.bottom !== undefined ? `bottom:${o.bottom}px` : '',
    o.left !== undefined ? `left:${o.left}px` : '', o.right !== undefined ? `right:${o.right}px` : '',
  ].filter(Boolean).join(';')
  return `<div style="display:flex;position:absolute;${pos};opacity:${o.opacidad ?? 0.09}"><span style="font-family:Inter;font-weight:700;font-size:${o.size}px;color:${o.color};line-height:0.78">${esc(texto)}</span></div>`
}

/** Filete dorado vertical: ancla el bloque de texto al margen izquierdo. */
function rielGold(alto: number | 'auto' = 'auto'): string {
  return `<div style="display:flex;width:6px;${alto === 'auto' ? 'align-self:stretch' : `height:${alto}px`};background:${GOLD};border-radius:3px;flex-shrink:0"></div>`
}

/** Banda de color a sangre (arriba o abajo) para cerrar la composición. */
function bandaBorde(C: { w: number; h: number }, alto: number, color: string, abajo = true): string {
  return `<div style="display:flex;position:absolute;${abajo ? 'bottom' : 'top'}:0;left:0;width:${C.w}px;height:${alto}px;background:${color}"></div>`
}

// ─── plantillas ───────────────────────────────────────────────────────────────
function portada(s: SlotsPlantilla, C: { w: number; h: number }, o: OpcionesPlantilla): ResultadoPlantilla {
  const fotos: FotoGrafico[] = []
  const conFoto = !!(s.foto && (s.foto.url || s.foto.prompt))
  const bandaH = conFoto ? Math.round(C.h * 0.44) : 0
  // El fondo del bloque de texto ya NO es siempre navy: honra el slot `fondo`
  // (navy/crema/blanco) para que las portadas —lo que se ve en el grid— varíen.
  const bg = bgColor(s.fondo)
  const oscuro = bg === NAVY // texto claro sobre navy; navy sobre crema/blanco
  let banda = ''
  if (conFoto) {
    const src = s.foto!.url ? esc(s.foto!.url) : 'FOTO:principal'
    if (!s.foto!.url) fotos.push({ slot: 'principal', prompt: `${s.foto!.prompt || 'una mascota viva y feliz junto a su tutor, luz cálida natural'}. ${ZONA_LIBRE.arriba}`, aspect: '3:2' })
    const eb = s.eyebrow ? eyebrowChip(s.eyebrow, { top: 44, left: PAD - 16 }) : ''
    const lg = logoImg(o.logoBlanco, `top:40px;right:${PAD - 16}px`, 150)
    banda = `<div style="display:flex;position:relative;width:${C.w}px;height:${bandaH}px;overflow:hidden;flex-shrink:0"><img src="${src}" width="${C.w}" height="${bandaH}" style="object-fit:cover;object-position:center 35%;display:block" />${eb}${lg}</div>`
  }
  const eyebrowText = !conFoto && s.eyebrow ? eyebrowChip(s.eyebrow) : ''
  const tit = tituloBloque(s, oscuro ? WHITE : NAVY, C.w - PAD * 2, 86)
  const bajada = s.bajada ? `<span style="font-family:Inter;font-weight:400;font-size:32px;color:${oscuro ? SOFT : INK};line-height:1.4;margin-top:26px">${esc(clampText(s.bajada, 130))}</span>` : ''
  const cta = ctaRow(s, oscuro)
  const lgBottom = logoImg(oscuro ? o.logoBlanco : o.logoNavy, `bottom:52px;right:${PAD - 16}px`, 168)
  const textBlock = `<div style="display:flex;flex-direction:column;flex:1;justify-content:center;padding:64px ${PAD}px ${ZONA_LOGO}px ${PAD}px">${eyebrowText}${tit}${bajada}${ruleGold()}${cta}</div>`
  const html = `<div style="display:flex;flex-direction:column;position:relative;width:${C.w}px;height:${C.h}px;background:${bg}">${banda}${textBlock}${lgBottom}</div>`
  return { html, fotos }
}

function contenido(s: SlotsPlantilla, C: { w: number; h: number }, o: OpcionesPlantilla): ResultadoPlantilla {
  const fotos: FotoGrafico[] = []
  const conFoto = !!(s.foto && (s.foto.url || s.foto.prompt))
  const bandaH = conFoto ? Math.round(C.h * 0.34) : 0
  const bg = bgColor(s.fondo)
  const oscuro = bg === NAVY
  const col = oscuro ? WHITE : NAVY
  let banda = ''
  if (conFoto) {
    const src = s.foto!.url ? esc(s.foto!.url) : 'FOTO:principal'
    if (!s.foto!.url) fotos.push({ slot: 'principal', prompt: s.foto!.prompt || 'una mascota viva y tranquila, luz cálida natural', aspect: '16:9' })
    banda = `<div style="display:flex;width:${C.w}px;height:${bandaH}px;overflow:hidden;flex-shrink:0"><img src="${src}" width="${C.w}" height="${bandaH}" style="object-fit:cover;object-position:center 40%;display:block" /></div>`
  }
  const eb = s.eyebrow ? eyebrowChip(s.eyebrow) : ''
  // tituloBloque (no un <span> suelto): si el modelo manda titulo_destacado
  // (2ª línea en dorado) acá se perdía en silencio, dejando títulos cortados
  // a la mitad (ej. "Elige la" sin "modalidad que te acomode").
  const tit = (s.titulo || s.titulo_destacado) ? tituloBloque(s, col, C.w - PAD * 2, 62) : ''
  const bajada = s.bajada ? `<span style="font-family:Inter;font-weight:400;font-size:30px;color:${oscuro ? SOFT : INK};line-height:1.4;margin-top:20px">${esc(clampText(s.bajada, 120))}</span>` : ''
  // Los bullets van dentro de un PANEL con filete dorado, no sueltos sobre el
  // fondo: le da peso y estructura a la lámina más usada de todas (era la más
  // plana del set — puro texto flotando en el medio del color).
  const panelBg = oscuro ? '#1c4c7c' : (bg === CREAM ? WHITE : '#f4f6f9')
  const items = (s.bullets || []).slice(0, 4).map(b =>
    `<div style="display:flex;flex-direction:row;align-items:flex-start;gap:16px"><div style="display:flex;width:11px;height:11px;border-radius:6px;background:${GOLD};margin-top:12px;flex-shrink:0"></div><span style="font-family:Inter;font-weight:600;font-size:30px;color:${col};line-height:1.3">${esc(clampText(b, 90))}</span></div>`).join('')
  const bullets = items
    ? `<div style="display:flex;flex-direction:row;gap:26px;margin-top:34px;background:${panelBg};border-radius:16px;padding:30px 30px">${rielGold()}<div style="display:flex;flex-direction:column;gap:20px;flex:1">${items}</div></div>`
    : ''
  // Marca de agua con la 1ª palabra del titular: trama de fondo, no se lee.
  const primera = (s.titulo || s.titulo_destacado || '').split(/\s+/)[0] || ''
  const marca = conFoto ? '' : ghost(primera, { size: Math.round(C.h * 0.30), color: oscuro ? WHITE : NAVY, opacidad: 0.055, bottom: Math.round(C.h * 0.04), right: -Math.round(C.w * 0.08) })
  const lg = logoImg(oscuro ? o.logoBlanco : o.logoNavy, `bottom:52px;right:${PAD - 16}px`, 150)
  const body = `<div style="display:flex;flex-direction:column;flex:1;justify-content:center;padding:56px ${PAD}px ${ZONA_LOGO}px ${PAD}px">${eb}${tit}${bajada}${bullets}</div>`
  const html = `<div style="display:flex;flex-direction:column;position:relative;width:${C.w}px;height:${C.h}px;background:${bg}">${banda}${marca}${body}${lg}</div>`
  return { html, fotos }
}

function dato(s: SlotsPlantilla, C: { w: number; h: number }, o: OpcionesPlantilla): ResultadoPlantilla {
  // Póster de cifra: la cifra grande apoyada sobre una COPIA fantasma enorme que
  // sangra por el borde, y una banda inferior que cierra la composición. Antes
  // era un número solo en el medio de un rectángulo liso.
  const bg = bgColor(s.fondo || 'navy')
  const oscuro = bg === NAVY
  const col = oscuro ? WHITE : NAVY
  const bandaBg = oscuro ? '#0f3054' : (bg === CREAM ? '#f2ece1' : '#f4f6f9')
  const bandaH = Math.round(C.h * 0.26)
  const fondo = ghost(s.dato || '', {
    size: Math.round(C.h * 0.36), color: GOLD, opacidad: oscuro ? 0.11 : 0.14,
    top: Math.round(C.h * 0.10), left: -Math.round(C.w * 0.05),
  })
  const eb = s.eyebrow ? eyebrowChip(s.eyebrow) : ''
  const big = s.dato ? `<span style="font-family:Inter;font-weight:700;font-size:${fitFont(s.dato, C.w - PAD * 2, 210, 90, 0.55)}px;color:${GOLD};line-height:0.94">${esc(s.dato)}</span>` : ''
  const label = s.dato_label ? `<span style="font-family:Inter;font-weight:700;font-size:${fitFont(s.dato_label, C.w - PAD * 2, 56, 34)}px;color:${col};line-height:1.15;margin-top:18px">${esc(clampText(s.dato_label, 40))}</span>` : ''
  const arriba = `<div style="display:flex;flex-direction:column;flex:1;justify-content:center;align-items:flex-start;padding:64px ${PAD}px 40px ${PAD}px">${eb}${big}${label}</div>`
  const bajada = s.bajada ? `<span style="font-family:Inter;font-weight:400;font-size:30px;color:${oscuro ? SOFT : INK};line-height:1.4">${esc(clampText(s.bajada, 120))}</span>` : ''
  const banda = `<div style="display:flex;flex-direction:row;align-items:center;gap:26px;width:${C.w}px;height:${bandaH}px;background:${bandaBg};padding:0 ${PAD}px;flex-shrink:0">${rielGold(72)}${bajada}</div>`
  const lg = logoImg(oscuro ? o.logoBlanco : o.logoNavy, `top:${PAD - 16}px;right:${PAD - 16}px`, 140)
  const html = `<div style="display:flex;flex-direction:column;position:relative;width:${C.w}px;height:${C.h}px;background:${bg}">${fondo}${arriba}${banda}${lg}</div>`
  return { html, fotos: [] }
}

function foto(s: SlotsPlantilla, C: { w: number; h: number }, o: OpcionesPlantilla): ResultadoPlantilla {
  const fotos: FotoGrafico[] = []
  const src = s.foto?.url ? esc(s.foto.url) : 'FOTO:principal'
  if (!s.foto?.url) fotos.push({ slot: 'principal', prompt: `${s.foto?.prompt || 'una mascota viva, feliz y serena, retrato cálido con luz dorada'}. ${ZONA_LIBRE.abajo}`, aspect: '4:5' })
  const frase = s.titulo ? `<span style="font-family:Inter;font-weight:700;font-size:${fitFont(s.titulo, C.w - PAD * 2, 58, 34)}px;color:${WHITE};line-height:1.15">${esc(clampText(s.titulo, 70))}</span>` : ''
  // velo SOLO en la franja inferior (degradé que se desvanece) — no tapa la foto.
  const velo = `<div style="display:flex;position:absolute;bottom:0;left:0;width:${C.w}px;height:${Math.round(C.h * 0.42)}px;background:linear-gradient(to bottom, rgba(20,60,100,0) 0%, rgba(20,60,100,0.82) 78%)"></div>`
  // Frase y logo APILADOS en una sola columna anclada abajo. Antes iban los dos
  // como absolutos abajo-izquierda (texto en bottom:150 y logo en bottom:52) y,
  // como el logo mide ~150px de alto, el titular le caía justo encima: el "logo
  // montado" que reportó el dueño (2026-07-28). Apilados no pueden pisarse,
  // cualquiera sea el alto del logo o el largo de la frase.
  const bloqueTexto = frase ? `<div style="display:flex;flex-direction:column;margin-bottom:36px">${frase}</div>` : ''
  const pie = `<div style="display:flex;flex-direction:column;align-items:flex-start;position:absolute;left:${PAD}px;bottom:52px;width:${C.w - PAD * 2}px">${bloqueTexto}${logoFlow(o.logoBlanco, 168)}</div>`
  const html = `<div style="display:flex;position:relative;width:${C.w}px;height:${C.h}px;background:${NAVY}"><img src="${src}" width="${C.w}" height="${C.h}" style="object-fit:cover;display:block" />${velo}${pie}</div>`
  return { html, fotos }
}

function cierre(s: SlotsPlantilla, C: { w: number; h: number }, o: OpcionesPlantilla): ResultadoPlantilla {
  const fotos: FotoGrafico[] = []
  const conFoto = !!(s.foto && (s.foto.url || s.foto.prompt))
  const bandaH = conFoto ? Math.round(C.h * 0.42) : 0
  const bg = bgColor(s.fondo) // honra navy/crema/blanco (antes era navy fijo)
  const oscuro = bg === NAVY
  let banda = ''
  if (conFoto) {
    const src = s.foto!.url ? esc(s.foto!.url) : 'FOTO:principal'
    if (!s.foto!.url) fotos.push({ slot: 'principal', prompt: s.foto!.prompt || 'una mascota viva y feliz con su tutor, luz cálida', aspect: '3:2' })
    banda = `<div style="display:flex;width:${C.w}px;height:${bandaH}px;overflow:hidden;flex-shrink:0"><img src="${src}" width="${C.w}" height="${bandaH}" style="object-fit:cover;object-position:center 35%;display:block" /></div>`
  }
  const tit = tituloBloque(s, oscuro ? WHITE : NAVY, C.w - PAD * 2, 76)
  const bajada = s.bajada ? `<span style="font-family:Inter;font-weight:400;font-size:30px;color:${oscuro ? SOFT : INK};line-height:1.4;margin-top:22px">${esc(clampText(s.bajada, 120))}</span>` : ''
  const lg = logoImg(oscuro ? o.logoBlanco : o.logoNavy, `top:${PAD - 16}px;right:${PAD - 16}px`, 150)
  const body = `<div style="display:flex;flex-direction:column;flex:1;justify-content:flex-end;padding:${conFoto ? 60 : 120}px ${PAD}px 56px ${PAD}px">${tit}${bajada}</div>`
  // El CTA es una BANDA DORADA a sangre abajo, no un chip perdido en el medio:
  // en un cierre el teléfono tiene que ser lo primero que se ve.
  const tel = s.cta ? `<span style="font-family:Inter;font-weight:700;font-size:${fitFont(s.cta, C.w - PAD * 2, 62, 34)}px;color:${NAVY};line-height:1.05">${esc(clampText(s.cta, 26))}</span>` : ''
  const web = s.cta_secundario ? `<span style="font-family:Inter;font-weight:600;font-size:27px;color:${NAVY};opacity:0.78;margin-top:10px">${esc(clampText(s.cta_secundario, 40))}</span>` : ''
  const bandaCta = (tel || web)
    ? `<div style="display:flex;flex-direction:column;justify-content:center;width:${C.w}px;height:${Math.round(C.h * 0.20)}px;background:${GOLD};padding:0 ${PAD}px;flex-shrink:0">${tel}${web}</div>`
    : ''
  const html = `<div style="display:flex;flex-direction:column;position:relative;width:${C.w}px;height:${C.h}px;background:${bg}">${banda}${body}${bandaCta}${lg}</div>`
  return { html, fotos }
}

function cita(s: SlotsPlantilla, C: { w: number; h: number }, o: OpcionesPlantilla): ResultadoPlantilla {
  // Testimonio / frase destacada. Por defecto en CLARO (crema) para romper el navy.
  const bg = bgColor(s.fondo || 'crema')
  const oscuro = bg === NAVY
  const col = oscuro ? WHITE : NAVY
  // La comilla ya no es un caracterito arriba: es una MARCA DE AGUA enorme que
  // sangra por el borde y sobre la que se apoya la frase. Da capas a una placa
  // que si no es tipografía suelta sobre un color liso.
  const marca = ghost('“', { size: Math.round(C.h * 0.62), color: GOLD, opacidad: oscuro ? 0.16 : 0.20, top: -Math.round(C.h * 0.06), left: PAD - 30 })
  const eb = s.eyebrow ? eyebrowChip(s.eyebrow) : ''
  const frase = s.titulo ? `<span style="font-family:Inter;font-weight:700;font-size:${fitFont(s.titulo, C.w - PAD * 2, 70, 40, 0.53)}px;color:${col};line-height:1.24">${esc(clampText(s.titulo, 200))}</span>` : ''
  const autor = s.bajada ? `<div style="display:flex;flex-direction:row;align-items:center;gap:20px;margin-top:36px">${rielGold(46)}<span style="font-family:Inter;font-weight:600;font-size:30px;color:${oscuro ? SOFT : INK}">${esc(clampText(s.bajada, 60))}</span></div>` : ''
  const lg = logoImg(oscuro ? o.logoBlanco : o.logoNavy, `bottom:52px;right:${PAD - 16}px`, 150)
  const body = `<div style="display:flex;flex-direction:column;flex:1;justify-content:center;padding:${Math.round(C.h * 0.30)}px ${PAD}px ${Math.round(C.h * 0.12)}px ${PAD}px">${eb}${frase}${autor}</div>`
  const html = `<div style="display:flex;flex-direction:column;position:relative;width:${C.w}px;height:${C.h}px;background:${bg}">${marca}${body}${lg}</div>`
  return { html, fotos: [] }
}

function split(s: SlotsPlantilla, C: { w: number; h: number }, o: OpcionesPlantilla): ResultadoPlantilla {
  // Editorial lado-a-lado: foto a la izquierda, panel de texto a la derecha.
  // Estructura DISTINTA a las apiladas → variedad real de layout.
  const fotos: FotoGrafico[] = []
  const src = s.foto?.url ? esc(s.foto.url) : 'FOTO:principal'
  if (!s.foto?.url) fotos.push({ slot: 'principal', prompt: s.foto?.prompt || 'una mascota viva y serena junto a su tutor, luz cálida natural', aspect: '3:4' })
  const bg = bgColor(s.fondo || 'crema')
  const oscuro = bg === NAVY
  const col = oscuro ? WHITE : NAVY
  const fotoW = Math.round(C.w * 0.46)
  const eb = s.eyebrow ? eyebrowChip(s.eyebrow) : ''
  const tit = (s.titulo || s.titulo_destacado) ? tituloBloque(s, col, C.w - fotoW - 112, 54) : ''
  const bajada = s.bajada ? `<span style="font-family:Inter;font-weight:400;font-size:28px;color:${oscuro ? SOFT : INK};line-height:1.4;margin-top:18px">${esc(clampText(s.bajada, 140))}</span>` : ''
  const items = (s.bullets || []).slice(0, 3).map(b =>
    `<div style="display:flex;flex-direction:row;align-items:flex-start;gap:14px"><div style="display:flex;width:10px;height:10px;border-radius:6px;background:${GOLD};margin-top:11px;flex-shrink:0"></div><span style="font-family:Inter;font-weight:600;font-size:27px;color:${col};line-height:1.3">${esc(clampText(b, 80))}</span></div>`).join('')
  const bullets = items ? `<div style="display:flex;flex-direction:column;gap:14px;margin-top:26px">${items}</div>` : ''
  const cta = ctaRow(s, oscuro)
  const lg = logoImg(oscuro ? o.logoBlanco : o.logoNavy, `bottom:44px;right:44px`, 120)
  const fotoCol = `<div style="display:flex;width:${fotoW}px;height:${C.h}px;overflow:hidden;flex-shrink:0"><img src="${src}" width="${fotoW}" height="${C.h}" style="object-fit:cover;display:block" /></div>`
  // 170 abajo: el logo del panel (120px de ancho ≈ 107 de alto + 44 de margen)
  // llega hasta ~150px desde el borde; con 100 se le encimaban los bullets/CTA.
  const textCol = `<div style="display:flex;flex-direction:column;flex:1;justify-content:center;padding:64px 56px 170px 56px">${eb}${tit}${bajada}${bullets}${cta}</div>`
  const html = `<div style="display:flex;flex-direction:row;position:relative;width:${C.w}px;height:${C.h}px;background:${bg}">${fotoCol}${textCol}${lg}</div>`
  return { html, fotos }
}

function numeros(s: SlotsPlantilla, C: { w: number; h: number }, o: OpcionesPlantilla): ResultadoPlantilla {
  // Lista NUMERADA (pasos / razones): números dorados grandes → ritmo visual
  // distinto a los bullets de "contenido". Sin foto. Default en claro.
  const bg = bgColor(s.fondo || 'crema')
  const oscuro = bg === NAVY
  const col = oscuro ? WHITE : NAVY
  const eb = s.eyebrow ? eyebrowChip(s.eyebrow) : ''
  const tit = (s.titulo || s.titulo_destacado) ? tituloBloque(s, col, C.w - PAD * 2, 60) : ''
  const bajada = s.bajada ? `<span style="font-family:Inter;font-weight:400;font-size:30px;color:${oscuro ? SOFT : INK};line-height:1.4;margin-top:18px">${esc(clampText(s.bajada, 120))}</span>` : ''
  // Numerales EDITORIALES: cifra dorada enorme al margen + hairline que separa
  // cada paso. El circulito de 66px con el número adentro era el recurso más
  // genérico del set.
  const linea = oscuro ? '#2a5c8d' : '#e2dace'
  const rows = (s.bullets || []).slice(0, 4).map((b, i) =>
    `<div style="display:flex;flex-direction:row;align-items:center;gap:28px;padding:26px 0;border-top:${i === 0 ? '0px' : '2px'} solid ${linea}"><span style="font-family:Inter;font-weight:700;font-size:86px;color:${GOLD};line-height:0.9;width:110px;flex-shrink:0">${i + 1}</span><span style="font-family:Inter;font-weight:600;font-size:32px;color:${col};line-height:1.25">${esc(clampText(b, 76))}</span></div>`).join('')
  const lista = rows ? `<div style="display:flex;flex-direction:column;margin-top:34px">${rows}</div>` : ''
  const lg = logoImg(oscuro ? o.logoBlanco : o.logoNavy, `bottom:52px;right:${PAD - 16}px`, 150)
  const body = `<div style="display:flex;flex-direction:column;flex:1;justify-content:center;padding:60px ${PAD}px ${ZONA_LOGO}px ${PAD}px">${eb}${tit}${bajada}${lista}</div>`
  const html = `<div style="display:flex;flex-direction:column;position:relative;width:${C.w}px;height:${C.h}px;background:${bg}">${body}${lg}</div>`
  return { html, fotos: [] }
}

function marco(s: SlotsPlantilla, C: { w: number; h: number }, o: OpcionesPlantilla): ResultadoPlantilla {
  // Foto ENMARCADA (estilo galería/editorial) centrada + pie de foto. Distinta de
  // "foto" (full-bleed) y "split" (lado a lado): la foto respira sobre el fondo de
  // marca, con aire. Cálida para homenajes/humanización.
  const fotos: FotoGrafico[] = []
  const src = s.foto?.url ? esc(s.foto.url) : 'FOTO:principal'
  if (!s.foto?.url) fotos.push({ slot: 'principal', prompt: s.foto?.prompt || 'una mascota viva y feliz, retrato cálido con luz natural', aspect: '1:1' })
  const bg = bgColor(s.fondo || 'crema')
  const oscuro = bg === NAVY
  const col = oscuro ? WHITE : NAVY
  const marcoW = C.w - PAD * 2
  const fotoH = Math.round(C.h * 0.50)
  const cuadro = `<div style="display:flex;background:${WHITE};padding:20px;border-radius:8px"><img src="${src}" width="${marcoW - 40}" height="${fotoH}" style="object-fit:cover;display:block;border-radius:2px" /></div>`
  const tit = s.titulo ? `<span style="font-family:Inter;font-weight:700;font-size:${fitFont(s.titulo, marcoW, 50, 34)}px;color:${col};line-height:1.22;margin-top:40px">${esc(clampText(s.titulo, 90))}</span>` : ''
  const bajada = s.bajada ? `<span style="font-family:Inter;font-weight:400;font-size:28px;color:${oscuro ? SOFT : INK};line-height:1.4;margin-top:14px">${esc(clampText(s.bajada, 120))}</span>` : ''
  const lg = logoImg(oscuro ? o.logoBlanco : o.logoNavy, `bottom:46px;right:${PAD - 16}px`, 130)
  const body = `<div style="display:flex;flex-direction:column;flex:1;justify-content:center;padding:72px ${PAD}px ${ZONA_LOGO}px ${PAD}px">${cuadro}${tit}${bajada}</div>`
  const html = `<div style="display:flex;flex-direction:column;position:relative;width:${C.w}px;height:${C.h}px;background:${bg}">${body}${lg}</div>`
  return { html, fotos }
}

// ─── plantillas nuevas (2026-08) ──────────────────────────────────────────────
// Objetivo del dueño: que el feed deje de verse "siempre igual". Cada una rompe
// el molde apilado (eyebrow → título → bajada → bullets) con una ESTRUCTURA
// distinta: bandas sólidas, dos columnas, rieles, grillas, tarjetas flotantes,
// círculos y póster tipográfico. Todas satori-safe (solo flex, sin transform).

/**
 * Exigencia de encuadre para las plantillas que APOYAN TEXTO SOBRE LA FOTO.
 *
 * Bug real (2026-08, reportado por el dueño): en `memorial_placa` la placa le
 * tapaba el hocico al gato. La plantilla no sabe dónde está el animal, así que
 * la única solución robusta es PEDIR la foto ya compuesta con la zona del texto
 * despejada. Se le suma al prompt venga de donde venga (del modelo o del
 * fallback), porque el modelo se olvida de decirlo.
 */
const ZONA_LIBRE: Record<'abajo' | 'arriba', string> = {
  abajo: 'Composición OBLIGATORIA: la mascota en la MITAD SUPERIOR del encuadre, con su cara y ojos completos y bien visibles, y la MITAD INFERIOR despejada (piso, manta, pasto o fondo liso) porque ahí va a ir un bloque de texto que no puede taparle la cara.',
  arriba: 'Composición OBLIGATORIA: la mascota en la MITAD INFERIOR del encuadre, con su cara y ojos completos y bien visibles, y el TERCIO SUPERIOR despejado (pared, cielo o fondo liso) porque ahí va a ir texto que no puede taparle la cara.',
}

/** Pide una foto para un slot y devuelve el `src` a usar en el <img>. */
function pedirFoto(
  fotos: FotoGrafico[],
  f: { prompt?: string; url?: string } | undefined,
  slot: string,
  fallback: string,
  aspect: string,
  zonaLibre?: 'abajo' | 'arriba',
): string {
  if (f?.url) return esc(f.url)
  const base = f?.prompt || fallback
  fotos.push({ slot, prompt: zonaLibre ? `${base}. ${ZONA_LIBRE[zonaLibre]}` : base, aspect })
  return `FOTO:${slot}`
}

/** 1. Portada de REVISTA: foto a sangre + banda sólida abajo con el titular. */
function revista(s: SlotsPlantilla, C: { w: number; h: number }, o: OpcionesPlantilla): ResultadoPlantilla {
  const fotos: FotoGrafico[] = []
  const src = pedirFoto(fotos, s.foto, 'principal', 'un perro tranquilo mirando a cámara junto a la ventana de su casa, luz cálida de mañana', '4:5', 'arriba')
  const bg = bgColor(s.fondo || 'crema')
  const oscuro = bg === NAVY
  const col = oscuro ? WHITE : NAVY
  const bandaH = Math.round(C.h * 0.34)
  const fotoH = C.h - bandaH
  const eb = s.eyebrow ? eyebrowChip(s.eyebrow, { top: 48, left: PAD - 16 }) : ''
  const lgFoto = logoImg(o.logoBlanco, `top:44px;right:${PAD - 16}px`, 150)
  const zona = `<div style="display:flex;position:relative;width:${C.w}px;height:${fotoH}px;overflow:hidden;flex-shrink:0"><img src="${src}" width="${C.w}" height="${fotoH}" style="object-fit:cover;object-position:center 45%;display:block" />${eb}${lgFoto}</div>`
  const tit = tituloBloque(s, col, C.w - PAD * 2, 70)
  const bajada = s.bajada ? `<span style="font-family:Inter;font-weight:400;font-size:29px;color:${oscuro ? SOFT : INK};line-height:1.35;margin-top:18px">${esc(clampText(s.bajada, 130))}</span>` : ''
  const cta = ctaRow(s, oscuro)
  const banda = `<div style="display:flex;flex-direction:column;flex:1;justify-content:center;padding:0 ${PAD}px">${tit}${bajada}${cta}</div>`
  const html = `<div style="display:flex;flex-direction:column;position:relative;width:${C.w}px;height:${C.h}px;background:${bg}">${zona}${banda}</div>`
  return { html, fotos }
}

/** 2. DÍPTICO: mitad foto / mitad color, con el titular CENTRADO. */
function diptico(s: SlotsPlantilla, C: { w: number; h: number }, o: OpcionesPlantilla): ResultadoPlantilla {
  const fotos: FotoGrafico[] = []
  const src = pedirFoto(fotos, s.foto, 'principal', 'un gato descansando sobre una manta de lana en un sillón, luz suave de tarde', '1:1')
  const bg = bgColor(s.fondo || 'navy')
  const oscuro = bg === NAVY
  const col = oscuro ? WHITE : NAVY
  const mitad = Math.round(C.h / 2)
  const arriba = `<div style="display:flex;width:${C.w}px;height:${mitad}px;overflow:hidden;flex-shrink:0"><img src="${src}" width="${C.w}" height="${mitad}" style="object-fit:cover;object-position:center 40%;display:block" /></div>`
  const largo = [s.titulo, s.titulo_destacado].filter((x): x is string => !!x).reduce((m, l) => (l.length > m.length ? l : m), '')
  const fs = fitFont(largo, C.w - PAD * 2, 78, 40)
  const l1 = s.titulo ? `<span style="font-family:Inter;font-weight:700;font-size:${fs}px;color:${col};line-height:1.08;text-align:center">${esc(s.titulo)}</span>` : ''
  const l2 = s.titulo_destacado ? `<span style="font-family:Inter;font-weight:700;font-size:${fs}px;color:${GOLD};line-height:1.08;text-align:center">${esc(s.titulo_destacado)}</span>` : ''
  const regla = `<div style="display:flex;width:70px;height:5px;background:${GOLD};border-radius:3px;margin-top:26px"></div>`
  const bajada = s.bajada ? `<span style="font-family:Inter;font-weight:400;font-size:29px;color:${oscuro ? SOFT : INK};line-height:1.4;margin-top:24px;text-align:center">${esc(clampText(s.bajada, 130))}</span>` : ''
  const lg = logoImg(oscuro ? o.logoBlanco : o.logoNavy, `bottom:44px;left:${Math.round(C.w / 2) - 75}px`, 150)
  const abajo = `<div style="display:flex;flex-direction:column;flex:1;align-items:center;justify-content:center;padding:44px ${PAD}px ${ZONA_LOGO}px ${PAD}px">${l1}${l2}${regla}${bajada}</div>`
  const html = `<div style="display:flex;flex-direction:column;position:relative;width:${C.w}px;height:${C.h}px;background:${bg}">${arriba}${abajo}${lg}</div>`
  return { html, fotos }
}

/** 3. COMPARATIVA: dos columnas enfrentadas (nosotros / lo habitual). */
function comparativa(s: SlotsPlantilla, C: { w: number; h: number }, o: OpcionesPlantilla): ResultadoPlantilla {
  const bg = bgColor(s.fondo || 'crema')
  const oscuro = bg === NAVY
  const col = oscuro ? WHITE : NAVY
  const tit = (s.titulo || s.titulo_destacado) ? tituloBloque(s, col, C.w - PAD * 2, 54) : ''
  const colW = Math.round((C.w - PAD * 2 - 24) / 2)
  const columna = (encabezado: string, items: string[], destacada: boolean) => {
    const head = `<div style="display:flex;align-items:center;justify-content:center;height:${destacada ? 92 : 78}px;background:${destacada ? GOLD : (oscuro ? '#1d4f7f' : '#dfe6ee')};border-radius:14px 14px 0 0"><span style="font-family:Inter;font-weight:700;font-size:${destacada ? 28 : 24}px;color:${destacada ? NAVY : (oscuro ? SOFT : INK)};letter-spacing:0.5px">${esc(clampText((encabezado || '').toUpperCase(), 22))}</span></div>`
    const rows = items.slice(0, 4).map(b =>
      `<div style="display:flex;flex-direction:row;align-items:flex-start;gap:12px"><div style="display:flex;width:9px;height:9px;border-radius:5px;background:${destacada ? GOLD : (oscuro ? SOFT : '#9aa8b6')};margin-top:10px;flex-shrink:0"></div><span style="font-family:Inter;font-weight:600;font-size:25px;color:${destacada ? col : (oscuro ? SOFT : '#5c6b7a')};line-height:1.3">${esc(clampText(b, 64))}</span></div>`).join('')
    const body = `<div style="display:flex;flex-direction:column;gap:20px;padding:30px 24px;background:${destacada ? (oscuro ? '#1a4a78' : WHITE) : 'transparent'};border-radius:0 0 14px 14px">${rows}</div>`
    return `<div style="display:flex;flex-direction:column;width:${colW}px">${head}${body}</div>`
  }
  // `align-items:stretch` (sin flex:1): las dos columnas quedan del MISMO alto y
  // ese alto lo manda el contenido. Con flex:1 la columna blanca se estiraba
  // hasta abajo y dejaba medio lienzo en blanco vacío.
  // Insignia "VS" pisando el medio: convierte dos listas paralelas en una
  // comparación de verdad. Va absoluta para que no empuje el layout.
  const vs = `<div style="display:flex;align-items:center;justify-content:center;position:absolute;top:${Math.round(C.h * 0.455)}px;left:${Math.round(C.w / 2) - 42}px;width:84px;height:84px;border-radius:44px;background:${bg};border:5px solid ${GOLD}"><span style="font-family:Inter;font-weight:700;font-size:30px;color:${oscuro ? WHITE : NAVY}">VS</span></div>`
  const cols = `<div style="display:flex;flex-direction:row;align-items:stretch;gap:24px;margin-top:38px">${columna(s.titulo_b || 'Alma Animal', s.bullets || [], true)}${columna('Lo habitual', s.bullets_b || [], false)}</div>`
  const lg = logoImg(oscuro ? o.logoBlanco : o.logoNavy, `bottom:50px;right:${PAD - 16}px`, 140)
  const body = `<div style="display:flex;flex-direction:column;flex:1;justify-content:center;padding:60px ${PAD}px ${ZONA_LOGO}px ${PAD}px">${tit}${cols}</div>`
  const html = `<div style="display:flex;flex-direction:column;position:relative;width:${C.w}px;height:${C.h}px;background:${bg}">${body}${vs}${lg}</div>`
  return { html, fotos: [] }
}

/** 4. TIMELINE: hitos enlazados por un riel vertical dorado. */
function timeline(s: SlotsPlantilla, C: { w: number; h: number }, o: OpcionesPlantilla): ResultadoPlantilla {
  const bg = bgColor(s.fondo || 'navy')
  const oscuro = bg === NAVY
  const col = oscuro ? WHITE : NAVY
  const eb = s.eyebrow ? eyebrowChip(s.eyebrow) : ''
  const tit = (s.titulo || s.titulo_destacado) ? tituloBloque(s, col, C.w - PAD * 2, 56) : ''
  const items = (s.bullets || []).slice(0, 4)
  const rows = items.map((b, i) => {
    const ultimo = i === items.length - 1
    const riel = ultimo ? '' : `<div style="display:flex;width:4px;flex:1;background:${GOLD};border-radius:2px;margin-top:6px"></div>`
    const punto = `<div style="display:flex;align-items:center;justify-content:center;width:34px;height:34px;border-radius:18px;background:${GOLD};flex-shrink:0"></div>`
    const carril = `<div style="display:flex;flex-direction:column;align-items:center;width:34px;flex-shrink:0">${punto}${riel}</div>`
    const texto = `<div style="display:flex;flex-direction:column;flex:1;padding-bottom:${ultimo ? 0 : 30}px"><span style="font-family:Inter;font-weight:600;font-size:31px;color:${col};line-height:1.28">${esc(clampText(b, 90))}</span></div>`
    // flex:1 por fila → los hitos se REPARTEN a lo alto y el riel dorado recorre
    // el lienzo. Sin esto quedaban apretados arriba con medio afiche vacío.
    return `<div style="display:flex;flex-direction:row;gap:22px;align-items:stretch;flex:1">${carril}${texto}</div>`
  }).join('')
  const lista = rows ? `<div style="display:flex;flex-direction:column;flex:1;margin-top:40px">${rows}</div>` : ''
  const lg = logoImg(oscuro ? o.logoBlanco : o.logoNavy, `bottom:52px;right:${PAD - 16}px`, 150)
  const body = `<div style="display:flex;flex-direction:column;flex:1;justify-content:center;padding:60px ${PAD}px ${ZONA_LOGO}px ${PAD}px">${eb}${tit}${lista}</div>`
  const html = `<div style="display:flex;flex-direction:column;position:relative;width:${C.w}px;height:${C.h}px;background:${bg}">${body}${lg}</div>`
  return { html, fotos: [] }
}

/** 5. COLLAGE: una foto grande + dos chicas + titular. */
function collage(s: SlotsPlantilla, C: { w: number; h: number }, o: OpcionesPlantilla): ResultadoPlantilla {
  const fotos: FotoGrafico[] = []
  const list = s.fotos && s.fotos.length ? s.fotos : [s.foto || {}, {}, {}]
  const bg = bgColor(s.fondo || 'crema')
  const oscuro = bg === NAVY
  const col = oscuro ? WHITE : NAVY
  const anchoUtil = C.w - PAD * 2
  const grandeH = Math.round(C.h * 0.34)
  const chicaW = Math.round((anchoUtil - 18) / 2)
  const chicaH = Math.round(C.h * 0.20)
  const s1 = pedirFoto(fotos, list[0], 'foto1', 'un perro jugando en el pasto de un parque a media tarde', '3:2')
  const s2 = pedirFoto(fotos, list[1], 'foto2', 'primer plano de la cara de un gato atigrado descansando, luz de ventana', '1:1')
  const s3 = pedirFoto(fotos, list[2], 'foto3', 'las manos de una persona acariciando a su perro sentado en el sillón', '1:1')
  const grande = `<div style="display:flex;width:${anchoUtil}px;height:${grandeH}px;overflow:hidden;border-radius:12px"><img src="${s1}" width="${anchoUtil}" height="${grandeH}" style="object-fit:cover;display:block" /></div>`
  const fila = `<div style="display:flex;flex-direction:row;gap:18px;margin-top:18px"><div style="display:flex;width:${chicaW}px;height:${chicaH}px;overflow:hidden;border-radius:12px"><img src="${s2}" width="${chicaW}" height="${chicaH}" style="object-fit:cover;display:block" /></div><div style="display:flex;width:${chicaW}px;height:${chicaH}px;overflow:hidden;border-radius:12px"><img src="${s3}" width="${chicaW}" height="${chicaH}" style="object-fit:cover;display:block" /></div></div>`
  const tit = (s.titulo || s.titulo_destacado) ? tituloBloque(s, col, anchoUtil, 56) : ''
  const bajada = s.bajada ? `<span style="font-family:Inter;font-weight:400;font-size:28px;color:${oscuro ? SOFT : INK};line-height:1.4;margin-top:16px">${esc(clampText(s.bajada, 120))}</span>` : ''
  const texto = `<div style="display:flex;flex-direction:column;margin-top:36px">${tit}${bajada}</div>`
  const lg = logoImg(oscuro ? o.logoBlanco : o.logoNavy, `bottom:50px;right:${PAD - 16}px`, 140)
  const body = `<div style="display:flex;flex-direction:column;flex:1;justify-content:center;padding:60px ${PAD}px ${ZONA_LOGO}px ${PAD}px">${grande}${fila}${texto}</div>`
  const html = `<div style="display:flex;flex-direction:column;position:relative;width:${C.w}px;height:${C.h}px;background:${bg}">${body}${lg}</div>`
  return { html, fotos }
}

/** 6. FAQ: pregunta grande + respuesta, con signo dorado de fondo. */
function faq(s: SlotsPlantilla, C: { w: number; h: number }, o: OpcionesPlantilla): ResultadoPlantilla {
  const bg = bgColor(s.fondo || 'blanco')
  const oscuro = bg === NAVY
  const col = oscuro ? WHITE : NAVY
  // El "?" es una marca de agua gigante que sangra por la derecha; la pregunta
  // se apoya encima y la respuesta va sobre un panel. Antes el signo era un
  // caracter suelto más y la placa quedaba en tres bloques de texto apilados.
  const marca = ghost('?', { size: Math.round(C.h * 0.72), color: GOLD, opacidad: oscuro ? 0.16 : 0.20, top: -Math.round(C.h * 0.05), right: -Math.round(C.w * 0.04) })
  const panelBg = oscuro ? '#1c4c7c' : (bg === CREAM ? WHITE : '#f4f6f9')
  const eb = eyebrowChip(s.eyebrow || 'Preguntas frecuentes')
  const preg = s.titulo ? `<span style="font-family:Inter;font-weight:700;font-size:${fitFont(s.titulo, C.w - PAD * 2, 64, 38)}px;color:${col};line-height:1.18;margin-top:26px">${esc(clampText(s.titulo, 120))}</span>` : ''
  const resp = s.bajada
    ? `<div style="display:flex;flex-direction:row;gap:26px;margin-top:34px;background:${panelBg};border-radius:16px;padding:30px">${rielGold()}<span style="font-family:Inter;font-weight:400;font-size:30px;color:${oscuro ? SOFT : INK};line-height:1.42;flex:1">${esc(clampText(s.bajada, 260))}</span></div>`
    : ''
  const cta = ctaRow(s, oscuro)
  const lg = logoImg(oscuro ? o.logoBlanco : o.logoNavy, `bottom:52px;right:${PAD - 16}px`, 150)
  const body = `<div style="display:flex;flex-direction:column;flex:1;justify-content:center;padding:60px ${PAD}px ${ZONA_LOGO}px ${PAD}px">${eb}${preg}${resp}${cta}</div>`
  const html = `<div style="display:flex;flex-direction:column;position:relative;width:${C.w}px;height:${C.h}px;background:${bg}">${marca}${body}${lg}</div>`
  return { html, fotos: [] }
}

/** 7. PRECIO: tarjeta de plan (nombre + cifra + incluye + CTA). */
function precio(s: SlotsPlantilla, C: { w: number; h: number }, o: OpcionesPlantilla): ResultadoPlantilla {
  const bg = bgColor(s.fondo || 'navy')
  const oscuro = bg === NAVY
  const cardBg = oscuro ? WHITE : NAVY
  const cardCol = oscuro ? NAVY : WHITE
  const cardSub = oscuro ? INK : SOFT
  const cardW = C.w - PAD * 2
  const plan = s.eyebrow ? `<div style="display:flex;align-self:flex-start;background:${GOLD};border-radius:8px;padding:8px 20px"><span style="font-family:Inter;font-weight:700;font-size:23px;color:${NAVY};letter-spacing:1px">${esc((s.eyebrow || '').toUpperCase())}</span></div>` : ''
  const nombre = s.titulo ? `<span style="font-family:Inter;font-weight:700;font-size:${fitFont(s.titulo, cardW - 96, 46, 30)}px;color:${cardCol};line-height:1.15;margin-top:20px">${esc(clampText(s.titulo, 60))}</span>` : ''
  const cifra = s.dato ? `<span style="font-family:Inter;font-weight:700;font-size:${fitFont(s.dato, cardW - 96, 112, 56)}px;color:${GOLD};line-height:1.0;margin-top:16px">${esc(s.dato)}</span>` : ''
  const label = s.dato_label ? `<span style="font-family:Inter;font-weight:600;font-size:26px;color:${cardSub};margin-top:8px">${esc(clampText(s.dato_label, 46))}</span>` : ''
  const items = (s.bullets || []).slice(0, 4).map(b =>
    `<div style="display:flex;flex-direction:row;align-items:flex-start;gap:14px"><div style="display:flex;width:18px;height:4px;border-radius:2px;background:${GOLD};margin-top:14px;flex-shrink:0"></div><span style="font-family:Inter;font-weight:600;font-size:27px;color:${cardCol};line-height:1.3">${esc(clampText(b, 70))}</span></div>`).join('')
  const lista = items ? `<div style="display:flex;flex-direction:column;gap:14px;margin-top:28px">${items}</div>` : ''
  const ctaChip = s.cta ? `<div style="display:flex;align-items:center;justify-content:center;height:74px;background:${GOLD};border-radius:12px;margin-top:32px"><span style="font-family:Inter;font-weight:700;font-size:29px;color:${NAVY}">${esc(clampText(s.cta, 28))}</span></div>` : ''
  // La tarjeta OCUPA la zona segura (flex:1 + contenido centrado): una card de
  // plan que llena el lienzo se lee como diseño; flotando arriba parecía cortada.
  const card = `<div style="display:flex;flex-direction:column;justify-content:center;flex:1;width:${cardW}px;background:${cardBg};border-radius:22px;padding:48px 48px">${plan}${nombre}${cifra}${label}${lista}${ctaChip}</div>`
  const pie = s.pie ? `<span style="font-family:Inter;font-weight:400;font-size:22px;color:${oscuro ? SOFT : INK};margin-top:20px">${esc(clampText(s.pie, 90))}</span>` : ''
  const lg = logoImg(oscuro ? o.logoBlanco : o.logoNavy, `bottom:46px;right:${PAD - 16}px`, 132)
  const body = `<div style="display:flex;flex-direction:column;flex:1;padding:56px ${PAD}px ${ZONA_LOGO}px ${PAD}px">${card}${pie}</div>`
  const html = `<div style="display:flex;flex-direction:column;position:relative;width:${C.w}px;height:${C.h}px;background:${bg}">${body}${lg}</div>`
  return { html, fotos: [] }
}

/**
 * 8. ARCO: la foto dentro de un arco (rectángulo con la parte de arriba
 * redondeada) que llega hasta el borde superior, y el texto abajo.
 *
 * Antes esto era un CÍRCULO con anillo dorado y el dueño lo bajó (2026-08): una
 * foto redonda tipo foto de perfil se lee como HOMENAJE y competía con
 * `memorial_medallon`. El círculo con anillo queda RESERVADO para los
 * memoriales; para las piezas comerciales el arco da la misma calidez sin
 * ninguna connotación fúnebre.
 */
function arco(s: SlotsPlantilla, C: { w: number; h: number }, o: OpcionesPlantilla): ResultadoPlantilla {
  const fotos: FotoGrafico[] = []
  const src = pedirFoto(fotos, s.foto, 'principal', 'un perro mestizo sentado en el pasillo de su casa mirando a cámara con calma, luz de mañana', '3:4')
  const bg = bgColor(s.fondo || 'crema')
  const oscuro = bg === NAVY
  const col = oscuro ? WHITE : NAVY
  const arcoW = C.w - PAD * 2
  const arcoH = Math.round(C.h * 0.52)
  const radio = Math.round(arcoW / 2)
  const marco = `<div style="display:flex;width:${arcoW}px;height:${arcoH}px;overflow:hidden;border-radius:${radio}px ${radio}px 20px 20px;flex-shrink:0"><img src="${src}" width="${arcoW}" height="${arcoH}" style="object-fit:cover;object-position:center 30%;display:block" /></div>`
  const eb = s.eyebrow ? `<div style="display:flex;background:${GOLD};border-radius:8px;padding:8px 20px;margin-bottom:26px"><span style="font-family:Inter;font-weight:700;font-size:23px;color:${NAVY};letter-spacing:1px">${esc((s.eyebrow || '').toUpperCase())}</span></div>` : ''
  const tit = s.titulo ? `<span style="font-family:Inter;font-weight:700;font-size:${fitFont(s.titulo, arcoW, 58, 36)}px;color:${col};line-height:1.16;margin-top:38px">${esc(clampText(s.titulo, 90))}</span>` : ''
  const bajada = s.bajada ? `<span style="font-family:Inter;font-weight:400;font-size:28px;color:${oscuro ? SOFT : INK};line-height:1.4;margin-top:16px">${esc(clampText(s.bajada, 130))}</span>` : ''
  const cta = ctaRow(s, oscuro)
  const lg = logoImg(oscuro ? o.logoBlanco : o.logoNavy, `bottom:46px;right:${PAD - 16}px`, 132)
  const body = `<div style="display:flex;flex-direction:column;flex:1;padding:${PAD}px ${PAD}px ${ZONA_LOGO}px ${PAD}px">${eb}${marco}${tit}${bajada}${cta}</div>`
  const html = `<div style="display:flex;flex-direction:column;position:relative;width:${C.w}px;height:${C.h}px;background:${bg}">${body}${lg}</div>`
  return { html, fotos }
}

/** 9. BICOLOR: el lienzo partido en dos bloques de color, titular a caballo. */
function bicolor(s: SlotsPlantilla, C: { w: number; h: number }, o: OpcionesPlantilla): ResultadoPlantilla {
  const claro = bgColor(s.fondo === 'blanco' ? 'blanco' : 'crema')
  const altoTop = Math.round(C.h * 0.46)
  const fs = fitFont([s.titulo, s.titulo_destacado].filter((x): x is string => !!x).reduce((m, l) => (l.length > m.length ? l : m), ''), C.w - PAD * 2, 78, 40)
  const l1 = s.titulo ? `<span style="font-family:Inter;font-weight:700;font-size:${fs}px;color:${WHITE};line-height:1.08">${esc(s.titulo)}</span>` : ''
  const eb = s.eyebrow ? eyebrowChip(s.eyebrow) : ''
  const top = `<div style="display:flex;flex-direction:column;justify-content:flex-end;width:${C.w}px;height:${altoTop}px;background:${NAVY};padding:0 ${PAD}px 52px ${PAD}px;flex-shrink:0">${eb}${l1}</div>`
  const l2 = s.titulo_destacado ? `<span style="font-family:Inter;font-weight:700;font-size:${fs}px;color:${NAVY};line-height:1.08">${esc(s.titulo_destacado)}</span>` : ''
  const bajada = s.bajada ? `<span style="font-family:Inter;font-weight:400;font-size:29px;color:${INK};line-height:1.4;margin-top:22px">${esc(clampText(s.bajada, 150))}</span>` : ''
  const items = (s.bullets || []).slice(0, 3).map(b =>
    `<div style="display:flex;flex-direction:row;align-items:flex-start;gap:14px"><div style="display:flex;width:10px;height:10px;border-radius:5px;background:${GOLD};margin-top:11px;flex-shrink:0"></div><span style="font-family:Inter;font-weight:600;font-size:27px;color:${NAVY};line-height:1.3">${esc(clampText(b, 72))}</span></div>`).join('')
  const bullets = items ? `<div style="display:flex;flex-direction:column;gap:14px;margin-top:24px">${items}</div>` : ''
  const cta = ctaRow(s, false)
  const bottom = `<div style="display:flex;flex-direction:column;flex:1;justify-content:flex-start;padding:52px ${PAD}px ${ZONA_LOGO}px ${PAD}px">${l2}${bajada}${bullets}${cta}</div>`
  const lg = logoImg(o.logoNavy, `bottom:50px;right:${PAD - 16}px`, 150)
  const html = `<div style="display:flex;flex-direction:column;position:relative;width:${C.w}px;height:${C.h}px;background:${claro}">${top}${bottom}${lg}</div>`
  return { html, fotos: [] }
}

/** 10. CHECKLIST: cada item en su propia barra con filete dorado. */
function checklist(s: SlotsPlantilla, C: { w: number; h: number }, o: OpcionesPlantilla): ResultadoPlantilla {
  const bg = bgColor(s.fondo || 'navy')
  const oscuro = bg === NAVY
  const col = oscuro ? WHITE : NAVY
  const filaBg = oscuro ? '#1c4c7c' : WHITE
  const eb = s.eyebrow ? eyebrowChip(s.eyebrow) : ''
  const tit = (s.titulo || s.titulo_destacado) ? tituloBloque(s, col, C.w - PAD * 2, 56) : ''
  const rows = (s.bullets || []).slice(0, 5).map(b =>
    `<div style="display:flex;flex-direction:row;align-items:stretch;background:${filaBg};border-radius:12px;overflow:hidden"><div style="display:flex;width:10px;background:${GOLD};flex-shrink:0"></div><div style="display:flex;flex:1;padding:26px"><span style="font-family:Inter;font-weight:600;font-size:28px;color:${col};line-height:1.28">${esc(clampText(b, 78))}</span></div></div>`).join('')
  const lista = rows ? `<div style="display:flex;flex-direction:column;gap:16px;margin-top:36px">${rows}</div>` : ''
  const lg = logoImg(oscuro ? o.logoBlanco : o.logoNavy, `bottom:50px;right:${PAD - 16}px`, 140)
  const body = `<div style="display:flex;flex-direction:column;flex:1;justify-content:center;padding:60px ${PAD}px ${ZONA_LOGO}px ${PAD}px">${eb}${tit}${lista}</div>`
  const html = `<div style="display:flex;flex-direction:column;position:relative;width:${C.w}px;height:${C.h}px;background:${bg}">${body}${lg}</div>`
  return { html, fotos: [] }
}

/** 11. MOSAICO DE DATOS: grilla de 2×2 con cifras. */
function mosaico_datos(s: SlotsPlantilla, C: { w: number; h: number }, o: OpcionesPlantilla): ResultadoPlantilla {
  const bg = bgColor(s.fondo || 'crema')
  const oscuro = bg === NAVY
  const col = oscuro ? WHITE : NAVY
  const celdaBg = oscuro ? '#1c4c7c' : WHITE
  const tit = (s.titulo || s.titulo_destacado) ? tituloBloque(s, col, C.w - PAD * 2, 52) : ''
  const ds = (s.datos || []).slice(0, 4)
  const celdaW = Math.round((C.w - PAD * 2 - 18) / 2)
  // Tablero en DAMERO: una de cada dos celdas va en dorado con el texto en navy.
  // Cuatro cajitas idénticas se leían como una tabla; el damero le da ritmo.
  const celda = (d: { valor: string; label: string }, i: number) => {
    const inv = i % 3 === 0
    const fondoC = inv ? GOLD : celdaBg
    const valorC = inv ? NAVY : GOLD
    const labelC = inv ? NAVY : col
    return `<div style="display:flex;flex-direction:column;justify-content:center;width:${celdaW}px;flex:1;background:${fondoC};border-radius:16px;padding:0 28px"><span style="font-family:Inter;font-weight:700;font-size:${fitFont(d.valor, celdaW - 56, 78, 40)}px;color:${valorC};line-height:1.0">${esc(d.valor)}</span><span style="font-family:Inter;font-weight:600;font-size:24px;color:${labelC};line-height:1.25;margin-top:12px;opacity:${inv ? 0.82 : 1}">${esc(clampText(d.label, 46))}</span></div>`
  }
  const filas: string[] = []
  for (let i = 0; i < ds.length; i += 2) {
    filas.push(`<div style="display:flex;flex-direction:row;gap:18px;flex:1">${ds.slice(i, i + 2).map((d, j) => celda(d, i + j)).join('')}</div>`)
  }
  const grilla = filas.length ? `<div style="display:flex;flex-direction:column;gap:18px;flex:1;margin-top:38px">${filas.join('')}</div>` : ''
  const pie = s.pie ? `<span style="font-family:Inter;font-weight:400;font-size:23px;color:${oscuro ? SOFT : INK};margin-top:24px">${esc(clampText(s.pie, 90))}</span>` : ''
  const lg = logoImg(oscuro ? o.logoBlanco : o.logoNavy, `bottom:50px;right:${PAD - 16}px`, 140)
  const body = `<div style="display:flex;flex-direction:column;flex:1;padding:70px ${PAD}px ${ZONA_LOGO}px ${PAD}px">${tit}${grilla}${pie}</div>`
  const html = `<div style="display:flex;flex-direction:column;position:relative;width:${C.w}px;height:${C.h}px;background:${bg}">${body}${lg}</div>`
  return { html, fotos: [] }
}

/** 12. TESTIMONIO: avatar redondo + cita. Prueba social CON cara. */
function testimonio(s: SlotsPlantilla, C: { w: number; h: number }, o: OpcionesPlantilla): ResultadoPlantilla {
  const fotos: FotoGrafico[] = []
  const src = pedirFoto(fotos, s.foto, 'principal', 'retrato cálido de una mujer sonriendo suave abrazando a su perro en el living de su casa', '1:1')
  const bg = bgColor(s.fondo || 'blanco')
  const oscuro = bg === NAVY
  const col = oscuro ? WHITE : NAVY
  // Foto en cuadrado redondeado, NO en círculo con anillo: la foto redonda tipo
  // foto de perfil se lee como homenaje (pedido del dueño). El círculo queda
  // solo para `memorial_medallon`.
  const d = 300
  const avatar = `<div style="display:flex;width:${d}px;height:${d}px;overflow:hidden;border-radius:28px;flex-shrink:0"><img src="${src}" width="${d}" height="${d}" style="object-fit:cover;display:block" /></div>`
  const comilla = `<div style="display:flex;font-family:Inter;font-weight:700;font-size:180px;color:${GOLD};line-height:0.75">“</div>`
  const cabecera = `<div style="display:flex;flex-direction:row;align-items:center;gap:30px">${avatar}${comilla}</div>`
  // Cita en grande: es EL contenido de la pieza. Con 52px máx quedaba un bloque
  // chico flotando y medio lienzo vacío.
  const frase = s.titulo ? `<span style="font-family:Inter;font-weight:700;font-size:${fitFont(s.titulo, C.w - PAD * 2, 70, 38, 0.50)}px;color:${col};line-height:1.26;margin-top:44px">${esc(clampText(s.titulo, 220))}</span>` : ''
  const autor = s.bajada ? `<span style="font-family:Inter;font-weight:600;font-size:29px;color:${oscuro ? SOFT : INK};margin-top:32px">— ${esc(clampText(s.bajada, 60))}</span>` : ''
  const lg = logoImg(oscuro ? o.logoBlanco : o.logoNavy, `bottom:50px;right:${PAD - 16}px`, 140)
  const body = `<div style="display:flex;flex-direction:column;flex:1;justify-content:center;padding:58px ${PAD}px ${ZONA_LOGO}px ${PAD}px">${cabecera}${frase}${autor}</div>`
  const html = `<div style="display:flex;flex-direction:column;position:relative;width:${C.w}px;height:${C.h}px;background:${bg}">${body}${lg}</div>`
  return { html, fotos }
}

/** 13. HORARIO: filas clave→valor (días, cobertura, plazos). */
function horario(s: SlotsPlantilla, C: { w: number; h: number }, o: OpcionesPlantilla): ResultadoPlantilla {
  const bg = bgColor(s.fondo || 'navy')
  const oscuro = bg === NAVY
  const col = oscuro ? WHITE : NAVY
  const linea = oscuro ? '#2a5c8d' : '#dfe6ee'
  const eb = s.eyebrow ? eyebrowChip(s.eyebrow) : ''
  const tit = (s.titulo || s.titulo_destacado) ? tituloBloque(s, col, C.w - PAD * 2, 56) : ''
  // Filas con flex:1 → la tabla se REPARTE a lo alto y llena el lienzo (con las
  // filas apretadas quedaba media pieza vacía abajo).
  // Cada valor en un CHIP dorado y las filas en franjas alternadas: se lee como
  // un tablero de horarios, no como una lista de texto con guiones.
  const franja = oscuro ? '#1a4675' : (bg === CREAM ? '#f3ede2' : '#f4f6f9')
  const rows = (s.filas || []).slice(0, 5).map((f, i) =>
    `<div style="display:flex;flex-direction:row;align-items:center;justify-content:space-between;gap:20px;flex:1;padding:0 22px;background:${i % 2 === 0 ? franja : 'transparent'};border-radius:12px"><span style="font-family:Inter;font-weight:600;font-size:29px;color:${col}">${esc(clampText(f.izq, 34))}</span><div style="display:flex;background:${GOLD};border-radius:8px;padding:9px 18px"><span style="font-family:Inter;font-weight:700;font-size:27px;color:${NAVY}">${esc(clampText(f.der, 26))}</span></div></div>`).join('')
  const tabla = rows ? `<div style="display:flex;flex-direction:column;flex:1;margin-top:34px">${rows}</div>` : ''
  const pie = s.pie ? `<span style="font-family:Inter;font-weight:400;font-size:24px;color:${oscuro ? SOFT : INK};line-height:1.4;margin-top:26px">${esc(clampText(s.pie, 110))}</span>` : ''
  const cta = ctaRow(s, oscuro)
  const lg = logoImg(oscuro ? o.logoBlanco : o.logoNavy, `bottom:50px;right:${PAD - 16}px`, 140)
  const body = `<div style="display:flex;flex-direction:column;flex:1;padding:70px ${PAD}px ${ZONA_LOGO}px ${PAD}px">${eb}${tit}${tabla}${pie}${cta}</div>`
  const html = `<div style="display:flex;flex-direction:column;position:relative;width:${C.w}px;height:${C.h}px;background:${bg}">${body}${lg}</div>`
  return { html, fotos: [] }
}

/** 14. OVERLAY: foto a sangre + tarjeta clara flotando encima. */
function overlay(s: SlotsPlantilla, C: { w: number; h: number }, o: OpcionesPlantilla): ResultadoPlantilla {
  const fotos: FotoGrafico[] = []
  const src = pedirFoto(fotos, s.foto, 'principal', 'un perro golden retriever echado en la terraza de una casa al atardecer, luz cálida', '4:5', 'abajo')
  const cardBg = s.fondo === 'navy' ? NAVY : s.fondo === 'blanco' ? WHITE : CREAM
  const oscuro = cardBg === NAVY
  const col = oscuro ? WHITE : NAVY
  const cardW = C.w - PAD * 2
  const eb = s.eyebrow ? `<div style="display:flex;align-self:flex-start;background:${GOLD};border-radius:8px;padding:8px 20px;margin-bottom:22px"><span style="font-family:Inter;font-weight:700;font-size:23px;color:${NAVY};letter-spacing:1px">${esc((s.eyebrow || '').toUpperCase())}</span></div>` : ''
  const tit = (s.titulo || s.titulo_destacado) ? tituloBloque(s, col, cardW - 88, 52) : ''
  const bajada = s.bajada ? `<span style="font-family:Inter;font-weight:400;font-size:27px;color:${oscuro ? SOFT : INK};line-height:1.4;margin-top:16px">${esc(clampText(s.bajada, 140))}</span>` : ''
  const cta = ctaRow(s, oscuro)
  // El logo va EN EL FLUJO de la tarjeta, no absoluto: antes había que reservarle
  // 150px de padding muerto abajo y eso estiraba la tarjeta hasta media foto —
  // le tapaba la cara al animal (lo reportó el dueño con un gato).
  const lg = (oscuro ? o.logoBlanco : o.logoNavy)
    ? `<div style="display:flex;justify-content:flex-end;margin-top:26px"><img src="${esc((oscuro ? o.logoBlanco : o.logoNavy) as string)}" width="120" /></div>`
    : ''
  const card = `<div style="display:flex;flex-direction:column;position:absolute;left:${PAD}px;bottom:${PAD}px;width:${cardW}px;background:${cardBg};border-radius:22px;padding:40px 44px 34px 44px">${eb}${tit}${bajada}${cta}${lg}</div>`
  const html = `<div style="display:flex;position:relative;width:${C.w}px;height:${C.h}px;background:${NAVY}"><img src="${src}" width="${C.w}" height="${C.h}" style="object-fit:cover;object-position:center 16%;display:block" />${card}</div>`
  return { html, fotos }
}

/** 15. TIPOGRÁFICO: póster de una sola idea, la palabra manda. */
function tipografico(s: SlotsPlantilla, C: { w: number; h: number }, o: OpcionesPlantilla): ResultadoPlantilla {
  const bg = bgColor(s.fondo || 'navy')
  const oscuro = bg === NAVY
  const col = oscuro ? WHITE : NAVY
  const arriba = s.eyebrow ? `<span style="font-family:Inter;font-weight:700;font-size:26px;color:${GOLD};letter-spacing:3px">${esc((s.eyebrow || '').toUpperCase())}</span>` : ''
  const palabra = s.titulo ? `<span style="font-family:Inter;font-weight:700;font-size:${fitFont(s.titulo, C.w - PAD * 2, 190, 64, 0.56)}px;color:${col};line-height:0.98">${esc(s.titulo)}</span>` : ''
  const segunda = s.titulo_destacado ? `<span style="font-family:Inter;font-weight:700;font-size:${fitFont(s.titulo_destacado, C.w - PAD * 2, 190, 64, 0.56)}px;color:${GOLD};line-height:0.98">${esc(s.titulo_destacado)}</span>` : ''
  const regla = `<div style="display:flex;width:110px;height:7px;background:${GOLD};border-radius:4px;margin-top:34px"></div>`
  const abajo = s.bajada ? `<span style="font-family:Inter;font-weight:400;font-size:30px;color:${oscuro ? SOFT : INK};line-height:1.4;margin-top:30px">${esc(clampText(s.bajada, 130))}</span>` : ''
  const lg = logoImg(oscuro ? o.logoBlanco : o.logoNavy, `bottom:52px;right:${PAD - 16}px`, 150)
  const body = `<div style="display:flex;flex-direction:column;flex:1;justify-content:center;padding:64px ${PAD}px ${ZONA_LOGO}px ${PAD}px">${arriba}${palabra}${segunda}${regla}${abajo}</div>`
  const html = `<div style="display:flex;flex-direction:column;position:relative;width:${C.w}px;height:${C.h}px;background:${bg}">${body}${lg}</div>`
  return { html, fotos: [] }
}

// ─── MEMORIAL: homenaje a UNA mascota por su nombre ───────────────────────────
// Cinco estructuras distintas para lo mismo, porque es lo que más se publica y
// era siempre la misma pieza. Reglas de marca que aplican acá sí o sí: la
// mascota se ve VIVA y en calma (nunca enferma ni "ausente"), nada de urnas,
// lápidas, velas, arcoíris ni símbolos religiosos. `titulo` = el nombre de la
// mascota, `fechas` = sus años, `bajada` = la dedicatoria.

/** Nombre + años, el bloque tipográfico que comparten las cinco. */
/**
 * Logo de los MEMORIALES: SIEMPRE arriba a la derecha (decisión del dueño
 * 2026-08-06). Antes cada plantilla lo ponía donde le convenía —abajo al centro,
 * abajo a la derecha, arriba a la izquierda— y eso hacía dos cosas malas: el
 * homenaje se veía distinto en cada pieza, y el logo de abajo obligaba a
 * reservarle 200 px (ZONA_LOGO) que le robaban altura a la foto.
 *
 * CONTRASTE: sobre una foto no se puede saber qué hay detrás (la mitad de las
 * fotos son claras y el logo blanco desaparecía). Cuando va sobre foto se dibuja
 * un velo suave en la esquina, así el blanco se lee sobre cualquier imagen.
 * Sobre un fondo plano se usa la variante que contrasta con ese color.
 */
function logoMemorial(o: OpcionesPlantilla, C: { w: number; h: number }, opts: { sobreFoto?: boolean; claro?: boolean } = {}): string {
  const url = opts.sobreFoto || !opts.claro ? o.logoBlanco : o.logoNavy
  if (!url) return ''
  const velo = opts.sobreFoto
    ? `<div style="display:flex;position:absolute;top:0;right:0;width:${Math.round(C.w * 0.42)}px;height:${Math.round(C.h * 0.16)}px;background:linear-gradient(to bottom left, rgba(20,60,100,0.55) 0%, rgba(20,60,100,0) 72%)"></div>`
    : ''
  return `${velo}<img src="${esc(url)}" width="138" style="position:absolute;top:${PAD - 12}px;right:${PAD - 12}px" />`
}

function bloqueNombre(s: SlotsPlantilla, maxW: number, col: string, sub: string, fsMax: number, centrado = false): string {
  const alinear = centrado ? 'align-items:center;text-align:center' : 'align-items:flex-start'
  const nombre = s.titulo ? `<span style="font-family:Inter;font-weight:700;font-size:${fitFont(s.titulo, maxW, fsMax, 40, 0.55)}px;color:${col};line-height:1.02">${esc(clampText(s.titulo, 26))}</span>` : ''
  const fechas = s.fechas ? `<span style="font-family:Inter;font-weight:600;font-size:27px;letter-spacing:3px;color:${GOLD};margin-top:16px">${esc(clampText(s.fechas, 26))}</span>` : ''
  const dedic = s.bajada ? `<span style="font-family:Inter;font-weight:400;font-size:28px;color:${sub};line-height:1.45;margin-top:${s.fechas ? 20 : 16}px">${esc(clampText(s.bajada, 150))}</span>` : ''
  return `<div style="display:flex;flex-direction:column;${alinear}">${nombre}${fechas}${dedic}</div>`
}

/** M1. PLACA: foto a sangre y una placa clara centrada con el nombre. */
function memorial_placa(s: SlotsPlantilla, C: { w: number; h: number }, o: OpcionesPlantilla): ResultadoPlantilla {
  const fotos: FotoGrafico[] = []
  const src = pedirFoto(fotos, s.foto, 'principal', 'retrato cálido de un perro tranquilo mirando a cámara en el living de su casa, luz suave de ventana', '4:5', 'abajo')
  const placaW = Math.round(C.w * 0.78)
  const placa = `<div style="display:flex;flex-direction:column;align-items:center;position:absolute;left:${Math.round((C.w - placaW) / 2)}px;bottom:${Math.round(C.h * 0.07)}px;width:${placaW}px;background:${CREAM};border-radius:6px;padding:40px 40px">${s.eyebrow ? `<span style="font-family:Inter;font-weight:700;font-size:20px;letter-spacing:4px;color:${GOLD};margin-bottom:18px">${esc((s.eyebrow || '').toUpperCase())}</span>` : ''}${bloqueNombre(s, placaW - 80, NAVY, INK, 68, true)}</div>`
  const velo = `<div style="display:flex;position:absolute;bottom:0;left:0;width:${C.w}px;height:${Math.round(C.h * 0.5)}px;background:linear-gradient(to bottom, rgba(20,60,100,0) 0%, rgba(20,60,100,0.55) 70%)"></div>`
  const lg = logoMemorial(o, C, { sobreFoto: true })
  const html = `<div style="display:flex;position:relative;width:${C.w}px;height:${C.h}px;background:${NAVY}"><img src="${src}" width="${C.w}" height="${C.h}" style="object-fit:cover;object-position:center 18%;display:block" />${velo}${placa}${lg}</div>`
  return { html, fotos }
}

/** M2. RETRATO: foto vertical a sangre a un lado, columna de homenaje al otro. */
function memorial_retrato(s: SlotsPlantilla, C: { w: number; h: number }, o: OpcionesPlantilla): ResultadoPlantilla {
  const fotos: FotoGrafico[] = []
  const src = pedirFoto(fotos, s.foto, 'principal', 'retrato vertical de un gato sentado y sereno junto a una ventana, luz cálida lateral', '3:4')
  const bg = bgColor(s.fondo || 'crema')
  const oscuro = bg === NAVY
  const fotoW = Math.round(C.w * 0.52)
  const colW = C.w - fotoW
  const marca = ghost(s.titulo || '', { size: Math.round(C.h * 0.26), color: oscuro ? WHITE : NAVY, opacidad: 0.06, bottom: Math.round(C.h * 0.04), left: fotoW - 40 })
  const eb = s.eyebrow ? `<div style="display:flex;margin-bottom:26px"><span style="font-family:Inter;font-weight:700;font-size:19px;letter-spacing:4px;color:${GOLD}">${esc((s.eyebrow || '').toUpperCase())}</span></div>` : ''
  const texto = `<div style="display:flex;flex-direction:column;justify-content:center;width:${colW}px;height:${C.h}px;padding:56px 48px 160px 48px">${eb}${bloqueNombre(s, colW - 96, oscuro ? WHITE : NAVY, oscuro ? SOFT : INK, 58)}</div>`
  const foto = `<div style="display:flex;width:${fotoW}px;height:${C.h}px;overflow:hidden;flex-shrink:0"><img src="${src}" width="${fotoW}" height="${C.h}" style="object-fit:cover;display:block" /></div>`
  const lg = logoMemorial(o, C, { claro: !oscuro })
  const html = `<div style="display:flex;flex-direction:row;position:relative;width:${C.w}px;height:${C.h}px;background:${bg}">${foto}${marca}${texto}${lg}</div>`
  return { html, fotos }
}

/** M3. MEDALLÓN: foto circular con anillo dorado sobre un fondo con su nombre de fondo. */
function memorial_medallon(s: SlotsPlantilla, C: { w: number; h: number }, o: OpcionesPlantilla): ResultadoPlantilla {
  const fotos: FotoGrafico[] = []
  const src = pedirFoto(fotos, s.foto, 'principal', 'primer plano de la cara de un perro viejo de mirada tranquila, fondo de hogar desenfocado, luz cálida', '1:1')
  const bg = bgColor(s.fondo || 'navy')
  const oscuro = bg === NAVY
  const d = Math.min(C.w - PAD * 2, Math.round(C.h * 0.50))
  const marca = ghost(s.titulo || '', { size: Math.round(C.h * 0.34), color: oscuro ? WHITE : NAVY, opacidad: 0.07, top: Math.round(C.h * 0.10), left: -Math.round(C.w * 0.05) })
  const medallon = `<div style="display:flex;align-items:center;justify-content:center;width:${d + 26}px;height:${d + 26}px;border-radius:${Math.round((d + 26) / 2)}px;background:${GOLD}"><img src="${src}" width="${d}" height="${d}" style="object-fit:cover;border-radius:${Math.round(d / 2)}px;display:block" /></div>`
  const eb = s.eyebrow ? `<div style="display:flex;margin-bottom:30px"><span style="font-family:Inter;font-weight:700;font-size:20px;letter-spacing:4px;color:${GOLD}">${esc((s.eyebrow || '').toUpperCase())}</span></div>` : ''
  const nombre = `<div style="display:flex;margin-top:44px">${bloqueNombre(s, C.w - PAD * 2, oscuro ? WHITE : NAVY, oscuro ? SOFT : INK, 66, true)}</div>`
  const lg = logoMemorial(o, C, { claro: !oscuro })
  const body = `<div style="display:flex;flex-direction:column;flex:1;align-items:center;justify-content:center;padding:${ZONA_LOGO}px ${PAD}px 64px ${PAD}px">${eb}${medallon}${nombre}</div>`
  const html = `<div style="display:flex;flex-direction:column;position:relative;width:${C.w}px;height:${C.h}px;background:${bg}">${marca}${body}${lg}</div>`
  return { html, fotos }
}

/** M4. CUADRO: foto con passe-partout blanco grueso, como un retrato colgado. */
function memorial_cuadro(s: SlotsPlantilla, C: { w: number; h: number }, o: OpcionesPlantilla): ResultadoPlantilla {
  const fotos: FotoGrafico[] = []
  const src = pedirFoto(fotos, s.foto, 'principal', 'retrato de una mascota echada en su lugar favorito de la casa, luz natural suave de la tarde', '1:1')
  const bg = bgColor(s.fondo || 'crema')
  const oscuro = bg === NAVY
  const marcoW = Math.round(C.w * 0.72)
  const fotoLado = marcoW - 96
  const cuadro = `<div style="display:flex;align-items:center;justify-content:center;width:${marcoW}px;background:${WHITE};padding:48px;border-radius:4px"><img src="${src}" width="${fotoLado}" height="${fotoLado}" style="object-fit:cover;display:block" /></div>`
  const filete = `<div style="display:flex;width:90px;height:4px;background:${GOLD};border-radius:2px;margin-top:38px"></div>`
  const nombre = `<div style="display:flex;margin-top:30px">${bloqueNombre(s, C.w - PAD * 2, oscuro ? WHITE : NAVY, oscuro ? SOFT : INK, 58, true)}</div>`
  const lg = logoMemorial(o, C, { claro: !oscuro })
  const body = `<div style="display:flex;flex-direction:column;flex:1;align-items:center;justify-content:center;padding:${ZONA_LOGO}px ${PAD}px 64px ${PAD}px">${cuadro}${filete}${nombre}</div>`
  const html = `<div style="display:flex;flex-direction:column;position:relative;width:${C.w}px;height:${C.h}px;background:${bg}">${body}${lg}</div>`
  return { html, fotos }
}

/** M5. CINTA: foto arriba y una banda navy abajo con el nombre en dorado. */
function memorial_cinta(s: SlotsPlantilla, C: { w: number; h: number }, o: OpcionesPlantilla): ResultadoPlantilla {
  const fotos: FotoGrafico[] = []
  const src = pedirFoto(fotos, s.foto, 'principal', 'una mascota caminando por el jardín de su casa al atardecer, plano entero, luz dorada baja', '3:2')
  const fotoH = Math.round(C.h * 0.58)
  const bandaH = C.h - fotoH
  const foto = `<div style="display:flex;width:${C.w}px;height:${fotoH}px;overflow:hidden;flex-shrink:0"><img src="${src}" width="${C.w}" height="${fotoH}" style="object-fit:cover;object-position:center 35%;display:block" /></div>`
  // Ojo: satori NO recorta el desborde, así que un fantasma grande dentro de la
  // banda se derrama sobre la foto. Se mantiene chico y anclado adentro.
  const marca = ghost(s.fechas || '', { size: Math.round(bandaH * 0.44), color: WHITE, opacidad: 0.07, bottom: 24, right: PAD })
  const eb = s.eyebrow ? `<div style="display:flex;margin-bottom:16px"><span style="font-family:Inter;font-weight:700;font-size:19px;letter-spacing:4px;color:${GOLD}">${esc((s.eyebrow || '').toUpperCase())}</span></div>` : ''
  const nombre = s.titulo ? `<span style="font-family:Inter;font-weight:700;font-size:${fitFont(s.titulo, C.w - PAD * 2 - 180, 76, 40, 0.55)}px;color:${GOLD};line-height:1.02">${esc(clampText(s.titulo, 24))}</span>` : ''
  const fechas = s.fechas ? `<span style="font-family:Inter;font-weight:600;font-size:26px;letter-spacing:3px;color:${SOFT};margin-top:14px">${esc(clampText(s.fechas, 26))}</span>` : ''
  const dedic = s.bajada ? `<span style="font-family:Inter;font-weight:400;font-size:27px;color:${SOFT};line-height:1.42;margin-top:18px">${esc(clampText(s.bajada, 130))}</span>` : ''
  const banda = `<div style="display:flex;flex-direction:column;justify-content:center;position:relative;width:${C.w}px;height:${bandaH}px;background:${NAVY};padding:0 ${PAD}px;flex-shrink:0">${marca}${eb}${nombre}${fechas}${dedic}</div>`
  const lg = logoMemorial(o, C, { sobreFoto: true })
  const html = `<div style="display:flex;flex-direction:column;position:relative;width:${C.w}px;height:${C.h}px;background:${NAVY}">${foto}${banda}${lg}</div>`
  return { html, fotos }
}

/** M6. HORIZONTE: foto a sangre arriba y una franja crema abajo con el nombre a la izquierda y las fechas a la derecha. */
function memorial_horizonte(s: SlotsPlantilla, C: { w: number; h: number }, o: OpcionesPlantilla): ResultadoPlantilla {
  const fotos: FotoGrafico[] = []
  const src = pedirFoto(fotos, s.foto, 'principal', 'una mascota mirando el horizonte desde la terraza de su casa, plano medio, luz cálida de tarde', '4:5')
  const franjaH = Math.round(C.h * 0.26)
  const fotoH = C.h - franjaH
  const foto = `<div style="display:flex;width:${C.w}px;height:${fotoH}px;overflow:hidden;flex-shrink:0"><img src="${src}" width="${C.w}" height="${fotoH}" style="object-fit:cover;object-position:center 30%;display:block" /></div>`
  const filete = `<div style="display:flex;position:absolute;top:${fotoH}px;left:0;width:${C.w}px;height:6px;background:${GOLD}"></div>`
  const izq = `<div style="display:flex;flex-direction:column;justify-content:center;flex:1">${s.eyebrow ? `<span style="font-family:Inter;font-weight:700;font-size:18px;letter-spacing:4px;color:${GOLD};margin-bottom:12px">${esc((s.eyebrow || '').toUpperCase())}</span>` : ''}${s.titulo ? `<span style="font-family:Inter;font-weight:700;font-size:${fitFont(s.titulo, C.w * 0.55, 72, 40, 0.55)}px;color:${NAVY};line-height:1.02">${esc(clampText(s.titulo, 22))}</span>` : ''}</div>`
  const der = s.fechas ? `<div style="display:flex;flex-direction:column;justify-content:center;align-items:flex-end;width:${Math.round(C.w * 0.3)}px"><span style="font-family:Inter;font-weight:600;font-size:25px;letter-spacing:3px;color:${INK};text-align:right">${esc(clampText(s.fechas, 26))}</span></div>` : ''
  const franja = `<div style="display:flex;flex-direction:row;width:${C.w}px;height:${franjaH}px;background:${CREAM};padding:0 ${PAD}px;flex-shrink:0">${izq}${der}</div>`
  const lg = logoMemorial(o, C, { sobreFoto: true })
  const html = `<div style="display:flex;flex-direction:column;position:relative;width:${C.w}px;height:${C.h}px;background:${CREAM}">${foto}${franja}${filete}${lg}</div>`
  return { html, fotos }
}

/** M7. POLAROID: la foto como una instantánea de papel, con el nombre escrito en el borde blanco de abajo. */
function memorial_polaroid(s: SlotsPlantilla, C: { w: number; h: number }, o: OpcionesPlantilla): ResultadoPlantilla {
  const fotos: FotoGrafico[] = []
  const src = pedirFoto(fotos, s.foto, 'principal', 'una mascota jugando en el pasto del patio de su casa, instante espontáneo, luz de mediodía suave', '1:1')
  const cardW = Math.round(Math.min(C.w * 0.74, C.h * 0.52))
  const fotoLado = cardW - 64
  const marca = ghost(s.titulo || '', { size: Math.round(C.h * 0.30), color: WHITE, opacidad: 0.06, top: Math.round(C.h * 0.06), left: -Math.round(C.w * 0.04) })
  const pie = `<div style="display:flex;flex-direction:column;align-items:center;width:${fotoLado}px;margin-top:26px">${s.titulo ? `<span style="font-family:Inter;font-weight:700;font-size:${fitFont(s.titulo, fotoLado, 52, 32, 0.55)}px;color:${NAVY};line-height:1.05">${esc(clampText(s.titulo, 20))}</span>` : ''}${s.fechas ? `<span style="font-family:Inter;font-weight:600;font-size:22px;letter-spacing:3px;color:${GOLD};margin-top:10px">${esc(clampText(s.fechas, 26))}</span>` : ''}</div>`
  const card = `<div style="display:flex;flex-direction:column;align-items:center;width:${cardW}px;background:${WHITE};padding:32px 32px 44px 32px;border-radius:4px"><img src="${src}" width="${fotoLado}" height="${fotoLado}" style="object-fit:cover;display:block" />${pie}</div>`
  const dedic = s.bajada ? `<div style="display:flex;width:${Math.round(C.w * 0.78)}px;margin-top:44px"><span style="font-family:Inter;font-weight:400;font-size:27px;color:${SOFT};line-height:1.45;text-align:center">${esc(clampText(s.bajada, 130))}</span></div>` : ''
  const lg = logoMemorial(o, C)
  const body = `<div style="display:flex;flex-direction:column;flex:1;align-items:center;justify-content:center;padding:${ZONA_LOGO}px ${PAD}px 64px ${PAD}px">${card}${dedic}</div>`
  const html = `<div style="display:flex;flex-direction:column;position:relative;width:${C.w}px;height:${C.h}px;background:${NAVY}">${marca}${body}${lg}</div>`
  return { html, fotos }
}

/** M8. ORLA: foto a sangre con un marco dorado fino por dentro y el nombre en una placa navy abajo. */
function memorial_orla(s: SlotsPlantilla, C: { w: number; h: number }, o: OpcionesPlantilla): ResultadoPlantilla {
  const fotos: FotoGrafico[] = []
  const src = pedirFoto(fotos, s.foto, 'principal', 'retrato sereno de una mascota echada sobre una manta, mirada tranquila a cámara, luz suave de ventana', '4:5', 'abajo')
  const velo = `<div style="display:flex;position:absolute;bottom:0;left:0;width:${C.w}px;height:${Math.round(C.h * 0.46)}px;background:linear-gradient(to bottom, rgba(20,60,100,0) 0%, rgba(20,60,100,0.62) 72%)"></div>`
  const m = 34
  const orla = `<div style="display:flex;position:absolute;top:${m}px;left:${m}px;width:${C.w - m * 2 - 4}px;height:${C.h - m * 2 - 4}px;border:2px solid ${GOLD};border-radius:3px"></div>`
  const placaW = Math.round(C.w * 0.7)
  const placa = `<div style="display:flex;flex-direction:column;align-items:center;position:absolute;left:${Math.round((C.w - placaW) / 2)}px;bottom:${Math.round(C.h * 0.10)}px;width:${placaW}px;background:${NAVY};border-radius:4px;padding:34px 36px">${bloqueNombre(s, placaW - 72, WHITE, SOFT, 60, true)}</div>`
  const lg = logoMemorial(o, C, { sobreFoto: true })
  const html = `<div style="display:flex;position:relative;width:${C.w}px;height:${C.h}px;background:${NAVY}"><img src="${src}" width="${C.w}" height="${C.h}" style="object-fit:cover;object-position:center 22%;display:block" />${velo}${orla}${placa}${lg}</div>`
  return { html, fotos }
}

/** M9. SUSURRO: casi sin foto — la dedicatoria en grande y un medallón pequeño arriba. */
function memorial_susurro(s: SlotsPlantilla, C: { w: number; h: number }, o: OpcionesPlantilla): ResultadoPlantilla {
  const fotos: FotoGrafico[] = []
  const src = pedirFoto(fotos, s.foto, 'principal', 'primer plano de la cara de una mascota, mirada dulce, fondo claro desenfocado', '1:1')
  const bg = bgColor(s.fondo || 'crema')
  const oscuro = bg === NAVY
  const d = Math.round(Math.min(C.w * 0.52, C.h * 0.34))
  const medallon = `<div style="display:flex;align-items:center;justify-content:center;width:${d + 16}px;height:${d + 16}px;border-radius:${Math.round((d + 16) / 2)}px;background:${GOLD}"><img src="${src}" width="${d}" height="${d}" style="object-fit:cover;border-radius:${Math.round(d / 2)}px;display:block" /></div>`
  const frase = s.bajada
    ? `<span style="font-family:Inter;font-weight:400;font-size:${fitFont(s.bajada, C.w - PAD * 2, 54, 30, 0.42)}px;color:${oscuro ? WHITE : NAVY};line-height:1.34;text-align:center">${esc(clampText(s.bajada, 160))}</span>`
    : ''
  const filete = `<div style="display:flex;width:80px;height:3px;background:${GOLD};border-radius:2px;margin:36px 0"></div>`
  const nombre = s.titulo ? `<span style="font-family:Inter;font-weight:700;font-size:${fitFont(s.titulo, C.w - PAD * 2, 54, 32, 0.55)}px;color:${oscuro ? WHITE : NAVY};line-height:1.05;text-align:center">${esc(clampText(s.titulo, 24))}</span>` : ''
  const fechas = s.fechas ? `<span style="font-family:Inter;font-weight:600;font-size:24px;letter-spacing:3px;color:${GOLD};margin-top:12px">${esc(clampText(s.fechas, 26))}</span>` : ''
  const lg = logoMemorial(o, C, { claro: !oscuro })
  const body = `<div style="display:flex;flex-direction:column;flex:1;align-items:center;justify-content:center;padding:${ZONA_LOGO}px ${PAD}px 64px ${PAD}px">${medallon}<div style="display:flex;margin-top:40px">${frase}</div>${filete}${nombre}${fechas}</div>`
  const html = `<div style="display:flex;flex-direction:column;position:relative;width:${C.w}px;height:${C.h}px;background:${bg}">${body}${lg}</div>`
  return { html, fotos }
}

/** M10. ESTELA: banda vertical de color a la izquierda con el nombre, foto a sangre a la derecha. */
function memorial_estela(s: SlotsPlantilla, C: { w: number; h: number }, o: OpcionesPlantilla): ResultadoPlantilla {
  const fotos: FotoGrafico[] = []
  const src = pedirFoto(fotos, s.foto, 'principal', 'una mascota descansando junto a la puerta de su casa, plano medio, luz natural cálida', '3:4')
  const bandaW = Math.round(C.w * 0.40)
  const fotoW = C.w - bandaW
  const banda = `<div style="display:flex;flex-direction:column;justify-content:center;width:${bandaW}px;height:${C.h}px;background:${NAVY};padding:48px 40px 64px 40px;flex-shrink:0">${s.eyebrow ? `<span style="font-family:Inter;font-weight:700;font-size:18px;letter-spacing:4px;color:${GOLD};margin-bottom:20px">${esc((s.eyebrow || '').toUpperCase())}</span>` : ''}${bloqueNombre(s, bandaW - 80, WHITE, SOFT, 62)}</div>`
  const foto = `<div style="display:flex;width:${fotoW}px;height:${C.h}px;overflow:hidden;flex-shrink:0"><img src="${src}" width="${fotoW}" height="${C.h}" style="object-fit:cover;display:block" /></div>`
  const filete = `<div style="display:flex;position:absolute;top:0;left:${bandaW - 5}px;width:5px;height:${C.h}px;background:${GOLD}"></div>`
  const lg = logoMemorial(o, C, { sobreFoto: true })
  const html = `<div style="display:flex;flex-direction:row;position:relative;width:${C.w}px;height:${C.h}px;background:${NAVY}">${banda}${foto}${filete}${lg}</div>`
  return { html, fotos }
}

/** M11. ALBA: fondo con degradé cálido, la foto en un arco alto y el nombre debajo. */
function memorial_alba(s: SlotsPlantilla, C: { w: number; h: number }, o: OpcionesPlantilla): ResultadoPlantilla {
  const fotos: FotoGrafico[] = []
  const src = pedirFoto(fotos, s.foto, 'principal', 'una mascota de pie en el jardín al amanecer, luz dorada y suave, plano entero', '3:4')
  const arcoW = Math.round(C.w * 0.62)
  const arcoH = Math.round(C.h * 0.46)
  const arco = `<div style="display:flex;width:${arcoW}px;height:${arcoH}px;overflow:hidden;border-radius:${Math.round(arcoW / 2)}px ${Math.round(arcoW / 2)}px 8px 8px"><img src="${src}" width="${arcoW}" height="${arcoH}" style="object-fit:cover;display:block" /></div>`
  const fondo = `<div style="display:flex;position:absolute;top:0;left:0;width:${C.w}px;height:${C.h}px;background:linear-gradient(to bottom, ${CREAM} 0%, #f6e6c8 100%)"></div>`
  const nombre = `<div style="display:flex;margin-top:44px">${bloqueNombre(s, C.w - PAD * 2, NAVY, INK, 62, true)}</div>`
  const lg = logoMemorial(o, C, { claro: true })
  const body = `<div style="display:flex;flex-direction:column;flex:1;align-items:center;justify-content:center;padding:${ZONA_LOGO}px ${PAD}px 64px ${PAD}px">${arco}${nombre}</div>`
  const html = `<div style="display:flex;flex-direction:column;position:relative;width:${C.w}px;height:${C.h}px;background:${CREAM}">${fondo}${body}${lg}</div>`
  return { html, fotos }
}

/** M12. CARTA: una tarjeta crema con filete dorado sobre navy, con la dedicatoria como una nota escrita. */
function memorial_carta(s: SlotsPlantilla, C: { w: number; h: number }, o: OpcionesPlantilla): ResultadoPlantilla {
  const fotos: FotoGrafico[] = []
  const src = pedirFoto(fotos, s.foto, 'principal', 'retrato cálido de una mascota en su casa, mirada serena, fondo hogareño desenfocado', '1:1')
  const cardW = Math.round(C.w * 0.80)
  const d = Math.round(Math.min(cardW * 0.56, C.h * 0.30))
  const medallon = `<div style="display:flex;align-items:center;justify-content:center;width:${d + 14}px;height:${d + 14}px;border-radius:${Math.round((d + 14) / 2)}px;background:${GOLD}"><img src="${src}" width="${d}" height="${d}" style="object-fit:cover;border-radius:${Math.round(d / 2)}px;display:block" /></div>`
  const nombre = s.titulo ? `<span style="font-family:Inter;font-weight:700;font-size:${fitFont(s.titulo, cardW - 110, 56, 34, 0.55)}px;color:${NAVY};line-height:1.05;text-align:center;margin-top:28px">${esc(clampText(s.titulo, 22))}</span>` : ''
  const fechas = s.fechas ? `<span style="font-family:Inter;font-weight:600;font-size:23px;letter-spacing:3px;color:${GOLD};margin-top:12px">${esc(clampText(s.fechas, 26))}</span>` : ''
  const filete = `<div style="display:flex;width:70px;height:3px;background:${GOLD};border-radius:2px;margin:26px 0"></div>`
  const dedic = s.bajada ? `<span style="font-family:Inter;font-weight:400;font-size:28px;color:${INK};line-height:1.5;text-align:center">${esc(clampText(s.bajada, 170))}</span>` : ''
  const card = `<div style="display:flex;flex-direction:column;align-items:center;width:${cardW}px;background:${CREAM};border:2px solid ${GOLD};border-radius:8px;padding:48px 55px">${medallon}${nombre}${fechas}${filete}${dedic}</div>`
  const lg = logoMemorial(o, C)
  const body = `<div style="display:flex;flex-direction:column;flex:1;align-items:center;justify-content:center;padding:${ZONA_LOGO}px ${PAD}px 64px ${PAD}px">${card}</div>`
  const html = `<div style="display:flex;flex-direction:column;position:relative;width:${C.w}px;height:${C.h}px;background:${NAVY}">${body}${lg}</div>`
  return { html, fotos }
}

/**
 * M13. SILUETA: foto a sangre bajo un velo navy y el nombre GIGANTE abajo a la
 * izquierda. Antes iba centrado en la mitad de la pieza, justo encima de la cara
 * de la mascota (el dueño lo rebotó con el caso "Maya"): bajarlo a la esquina
 * despeja el retrato y deja el nombre más grande todavía, anclado en una
 * diagonal de lectura natural (logo arriba a la derecha → nombre abajo a la
 * izquierda).
 */
function memorial_silueta(s: SlotsPlantilla, C: { w: number; h: number }, o: OpcionesPlantilla): ResultadoPlantilla {
  const fotos: FotoGrafico[] = []
  const src = pedirFoto(fotos, s.foto, 'principal', 'una mascota recortada contra la luz de una ventana, atmósfera serena y cálida, plano medio', '4:5', 'abajo')
  // El velo carga abajo: sostiene el texto sin apagar la foto en la parte alta.
  const velo = `<div style="display:flex;position:absolute;top:0;left:0;width:${C.w}px;height:${C.h}px;background:linear-gradient(to bottom, rgba(20,60,100,0.28) 0%, rgba(20,60,100,0.42) 45%, rgba(20,60,100,0.86) 100%)"></div>`
  const eb = s.eyebrow ? `<span style="font-family:Inter;font-weight:700;font-size:20px;letter-spacing:5px;color:${GOLD};margin-bottom:18px">${esc((s.eyebrow || '').toUpperCase())}</span>` : ''
  const anchoTexto = C.w - PAD * 2
  const nombre = s.titulo ? `<span style="font-family:Inter;font-weight:700;font-size:${fitFont(s.titulo, anchoTexto, 132, 56, 0.55)}px;color:${WHITE};line-height:0.98">${esc(clampText(s.titulo, 18))}</span>` : ''
  const fechas = s.fechas ? `<span style="font-family:Inter;font-weight:600;font-size:29px;letter-spacing:4px;color:${GOLD};margin-top:20px">${esc(clampText(s.fechas, 26))}</span>` : ''
  const dedic = s.bajada ? `<span style="font-family:Inter;font-weight:400;font-size:29px;color:${SOFT};line-height:1.42;margin-top:20px">${esc(clampText(s.bajada, 120))}</span>` : ''
  const filete = `<div style="display:flex;width:96px;height:4px;background:${GOLD};border-radius:2px;margin-bottom:30px"></div>`
  const pie = `<div style="display:flex;flex-direction:column;align-items:flex-start;justify-content:flex-end;position:absolute;top:0;left:0;width:${C.w}px;height:${C.h}px;padding:${PAD}px ${PAD}px 76px ${PAD}px">${filete}${eb}${nombre}${fechas}${dedic}</div>`
  const lg = logoMemorial(o, C, { sobreFoto: true })
  const html = `<div style="display:flex;position:relative;width:${C.w}px;height:${C.h}px;background:${NAVY}"><img src="${src}" width="${C.w}" height="${C.h}" style="object-fit:cover;object-position:center 25%;display:block" />${velo}${pie}${lg}</div>`
  return { html, fotos }
}

/** M14. DÍPTICO: mitad foto y mitad bloque crema con la dedicatoria; el nombre cruza abajo en una banda. */
function memorial_diptico(s: SlotsPlantilla, C: { w: number; h: number }, o: OpcionesPlantilla): ResultadoPlantilla {
  const fotos: FotoGrafico[] = []
  const src = pedirFoto(fotos, s.foto, 'principal', 'una mascota acurrucada en el sillón de la casa, luz cálida de tarde, plano cercano', '1:1')
  const bandaH = Math.round(C.h * 0.22)
  const arribaH = C.h - bandaH
  const mitad = Math.round(C.w / 2)
  const foto = `<div style="display:flex;width:${mitad}px;height:${arribaH}px;overflow:hidden;flex-shrink:0"><img src="${src}" width="${mitad}" height="${arribaH}" style="object-fit:cover;display:block" /></div>`
  const texto = `<div style="display:flex;flex-direction:column;justify-content:center;width:${C.w - mitad}px;height:${arribaH}px;background:${CREAM};padding:0 52px;flex-shrink:0">${s.eyebrow ? `<span style="font-family:Inter;font-weight:700;font-size:18px;letter-spacing:4px;color:${GOLD};margin-bottom:20px">${esc((s.eyebrow || '').toUpperCase())}</span>` : ''}${s.bajada ? `<span style="font-family:Inter;font-weight:400;font-size:30px;color:${INK};line-height:1.45">${esc(clampText(s.bajada, 160))}</span>` : ''}</div>`
  const arriba = `<div style="display:flex;flex-direction:row;width:${C.w}px;height:${arribaH}px;flex-shrink:0">${foto}${texto}</div>`
  const nombre = s.titulo ? `<span style="font-family:Inter;font-weight:700;font-size:${fitFont(s.titulo, C.w - PAD * 2 - 170, 68, 38, 0.55)}px;color:${GOLD};line-height:1.02">${esc(clampText(s.titulo, 22))}</span>` : ''
  const fechas = s.fechas ? `<span style="font-family:Inter;font-weight:600;font-size:24px;letter-spacing:3px;color:${SOFT};margin-top:12px">${esc(clampText(s.fechas, 26))}</span>` : ''
  const banda = `<div style="display:flex;flex-direction:column;justify-content:center;width:${C.w}px;height:${bandaH}px;background:${NAVY};padding:0 ${PAD}px;flex-shrink:0">${nombre}${fechas}</div>`
  // La esquina superior derecha SIEMPRE es el bloque crema (la foto va a la
  // izquierda), así que el logo va navy y sin velo: acá el contraste está
  // garantizado y el velo solo ensuciaba un fondo plano.
  const lg = logoMemorial(o, C, { claro: true })
  const html = `<div style="display:flex;flex-direction:column;position:relative;width:${C.w}px;height:${C.h}px;background:${CREAM}">${arriba}${banda}${lg}</div>`
  return { html, fotos }
}

/** M15. HUELLA: fondo navy con el nombre enorme de fondo y la foto en una tarjeta baja, desplazada. */
function memorial_huella(s: SlotsPlantilla, C: { w: number; h: number }, o: OpcionesPlantilla): ResultadoPlantilla {
  const fotos: FotoGrafico[] = []
  const src = pedirFoto(fotos, s.foto, 'principal', 'una mascota mirando a cámara desde su cama, expresión tranquila, luz cálida de interior', '4:5')
  const marca = ghost(s.titulo || '', { size: Math.round(C.h * 0.32), color: WHITE, opacidad: 0.08, top: Math.round(C.h * 0.07), left: -Math.round(C.w * 0.06) })
  const fotoW = Math.round(C.w * 0.66)
  const fotoH = Math.round(C.h * 0.44)
  const tarjeta = `<div style="display:flex;width:${fotoW}px;height:${fotoH}px;overflow:hidden;border-radius:6px"><img src="${src}" width="${fotoW}" height="${fotoH}" style="object-fit:cover;object-position:center 25%;display:block" /></div>`
  const eb = s.eyebrow ? `<span style="font-family:Inter;font-weight:700;font-size:19px;letter-spacing:5px;color:${GOLD};margin-bottom:22px">${esc((s.eyebrow || '').toUpperCase())}</span>` : ''
  const pie = `<div style="display:flex;flex-direction:column;align-items:flex-start;width:${fotoW}px;margin-top:36px">${eb}${bloqueNombre(s, fotoW, WHITE, SOFT, 64)}</div>`
  const lg = logoMemorial(o, C)
  const body = `<div style="display:flex;flex-direction:column;flex:1;align-items:flex-start;justify-content:center;padding:${ZONA_LOGO}px ${PAD}px 64px ${PAD}px">${tarjeta}${pie}</div>`
  const html = `<div style="display:flex;flex-direction:column;position:relative;width:${C.w}px;height:${C.h}px;background:${NAVY}">${marca}${body}${lg}</div>`
  return { html, fotos }
}

const BUILDERS: Record<NombrePlantilla, (s: SlotsPlantilla, C: { w: number; h: number }, o: OpcionesPlantilla) => ResultadoPlantilla> = {
  portada, contenido, dato, foto, cierre, cita, split, numeros, marco,
  revista, diptico, comparativa, timeline, collage, faq, precio, arco,
  bicolor, checklist, mosaico_datos, testimonio, horario, overlay, tipografico,
  memorial_placa, memorial_retrato, memorial_medallon, memorial_cuadro, memorial_cinta,
  memorial_horizonte, memorial_polaroid, memorial_orla, memorial_susurro, memorial_estela,
  memorial_alba, memorial_carta, memorial_silueta, memorial_diptico, memorial_huella,
}

/** Construye el HTML on-brand de una plantilla + las fotos a generar. */
export function construirPlantilla(nombre: string, slots: SlotsPlantilla, opts: OpcionesPlantilla = {}): ResultadoPlantilla {
  const builder = BUILDERS[(nombre || '').trim() as NombrePlantilla] || portada
  const C = DIMS[opts.formato || 'post_vertical'] || DIMS.post_vertical
  return builder(slots || {}, C, opts)
}
