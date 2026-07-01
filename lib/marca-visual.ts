import { BRAND } from './email-layout'

/**
 * DIRECCIÓN VISUAL DE MARCA — Crematorio Alma Animal.
 *
 * Fuente de verdad para "cómo se ve" una imagen de Alma Animal. Se porta de la
 * biblia visual de marca (repo alma-animal-marketing) y se ADAPTA a las
 * convenciones de ESTE sistema:
 *   - vocabulario: "mascota / tu mascota" (nunca "compañero/a") y la mascota por
 *     su nombre cuando aplique;
 *   - paleta: los HEX canónicos del código (BRAND en email-layout.ts), no los de
 *     la biblia (decisión del cliente).
 *
 * Se usa en dos capas:
 *   1) MARCA_VISUAL  → se inyecta en los agentes que REDACTAN prompts de imagen
 *      (posts sociales, imágenes de correo, imágenes sueltas del agente) para que
 *      escriban prompts ya on-brand.
 *   2) ESTILO_MARCA_EN → se añade SIEMPRE en nano-banana.ts (el único punto por el
 *      que pasa toda imagen generada), como red de seguridad de marca: paleta,
 *      atmósfera y la lista de lo que JAMÁS debe aparecer.
 *   3) PROHIBIDOS_EN → solo la lista de prohibidos; se usa en EDICIÓN de imágenes,
 *      donde queremos preservar la base y NO imponer la dirección de arte completa.
 */

/**
 * Brief de dirección de arte (español) para los agentes que escriben prompts de
 * imagen. Conciso y accionable: pega esto en el system prompt del generador.
 */
export const MARCA_VISUAL = `DIRECCIÓN VISUAL DE MARCA (cómo se ve una imagen de Alma Animal — aplícala al escribir CADA prompt de imagen):
- Estética: foto realista y natural, CÁLIDA y con alma — nunca plana, fría ni desaturada. Buscá cercanía y emoción: luz dorada y envolvente (golden hour, luz de ventana), color rico pero natural, texturas y PROFUNDIDAD (primer plano nítido + fondo desenfocado), un instante cotidiano que cuente una pequeña historia. Atmósfera serena, contenida y esperanzadora — nunca dramática ni lúgubre. Nada de estilo cinematográfico exagerado (humo, contraluces, flares) ni pinta de stock genérico/plantilla.
- La mascota SIEMPRE viva, sana y tranquila o feliz (descansando, jugando, mirando con calma). Variedad de especies/razas/edades (sobre todo perros y gatos; también conejos, aves cuando aplique). Nunca enferma, agonizante ni en posturas que sugieran fallecimiento; nada de "silla/cama vacía" que insinúe ausencia.
- Según la AUDIENCIA de la pieza:
  · Tutores (B2C): luz natural cálida (golden hour, mañanas suaves, luz de ventana), hogar y momentos cotidianos, ternura, profundidad de campo suave, amplio espacio negativo. Pueden aparecer manos o tutores acariciando/sosteniendo a la mascota con cariño.
  · Veterinarios (B2B): tono profesional, espacios limpios y ordenados, personas trabajando con concentración, luz neutra controlada, composición estructurada y simétrica; transmite capacidad técnica y respaldo serio, SIN frialdad clínica (nada de batas, instrumental ni quirófano).
- Paleta: tonos cálidos compatibles con la marca — crema/blanco ${BRAND.cream} domina (60-70%), azul ${BRAND.navy} estructura (20-30%) y dorado/ámbar ${BRAND.amber} solo como acento (5-10%). Evita negro puro, rojos intensos, neones/fluorescentes y verdes "clínicos".
- Composición limpia, sin recargar; regla de tercios o centrada. Deja espacio negativo limpio donde luego irá el texto o el logo (el logo se agrega después en el HTML/edición; la IA NO lo dibuja ni incrusta texto).
- ENCUADRE (CLAVE): la mascota debe verse BIEN COMPUESTA y ENTERA — su CARA y OJOS SIEMPRE visibles y NUNCA cortados por los bordes; dejá margen de aire alrededor del animal (no pegado al borde). El espacio negativo para el texto va AL LADO o ALREDEDOR del sujeto, NUNCA recortándole la cabeza. El sujeto centrado o en un tercio y a buen tamaño (ni diminuto ni tapando todo). Evitá mostrar solo un pedazo del animal (lomo, patas o cuerpo sin rostro).
- NUNCA muestres: mascotas fallecidas, enfermas o agonizantes; urnas, ataúdes, lápidas, tumbas o cementerios; hornos crematorios ni el proceso de cremación; sangre o escenas clínicas/quirúrgicas duras; lágrimas o duelo dramático; símbolos religiosos; "puente del arcoíris", ángeles o halos; velas; ni texto/letras/logos incrustados en la imagen.
- INSTALACIONES del crematorio (local, salas, recepción, fachada, hornos, vehículos): NO se generan NUNCA con IA; solo se muestran reutilizando fotos REALES del banco (grupo "instalaciones").`

/**
 * Sufijo de estilo (inglés) que se añade a TODO prompt enviado al modelo de
 * imagen. Es la capa de enforcement de marca (paleta + atmósfera + lo prohibido),
 * complementa al fotorrealismo que ya fuerza nano-banana. En inglés porque va
 * directo al modelo (Gemini / Nano Banana).
 */
/**
 * Lista de lo que JAMÁS debe aparecer (red de seguridad de marca). Se exporta
 * suelta para reutilizarla TAMBIÉN en EDICIONES de imagen, donde no queremos la
 * dirección de arte completa (paleta/atmósfera/composición empujan a regenerar la
 * escena entera) pero SÍ queremos mantener los prohibidos.
 */
export const PROHIBIDOS_EN =
  `NEVER show: dead, sick or agonizing animals; urns, coffins, tombstones, graves or cemeteries; cremation ovens or the cremation process; blood or hard clinical/surgical scenes; tears or dramatic grief; religious symbols; a "rainbow bridge", angels, halos or candles; or a generic stock-photo/template look.`

export const ESTILO_MARCA_EN =
  `Brand look (Crematorio Alma Animal — pet cremation): warm, intimate and heartfelt, with rich natural color, golden enveloping light and gentle depth (soft foreground and background) — inviting and full of life, telling a small everyday story. Never flat, cold, dull, desaturated, dramatic or gloomy. ` +
  `Warm tones compatible with the brand palette — cream/white (${BRAND.cream}) dominant, deep navy (${BRAND.navy}) for structure, a little warm gold (${BRAND.amber}) as an accent; avoid pure black, intense reds, neon/fluorescent colors and clinical "health" greens. ` +
  `Any animal must look ALIVE, healthy and calm or happy — never sick, dying, or posed as if dead. Keep the pet FULLY in frame, well composed — its face and eyes clearly visible and NEVER cropped by the edges; leave safe margin around the animal (do not show only a slice of it like just the back or paws without the face). Leave clean negative space (text or a logo may be added later). ` +
  PROHIBIDOS_EN

/**
 * Sistema para DISEÑAR GRÁFICOS CON TEXTO (herramienta "disenar_grafico"): el
 * agente escribe el diseño en HTML y el sistema lo rasteriza con las fuentes y
 * colores REALES de la marca (satori) → marca EXACTA con layout libre. NO es para
 * que la IA "dibuje" el gráfico.
 */
export const MARCA_GRAFICO = `DISEÑO DE GRÁFICOS CON TEXTO (herramienta "disenar_grafico") — marca EXACTA, layout LIBRE y CREATIVO:
Vos escribís el DISEÑO en HTML y el sistema lo rasteriza con las FUENTES y COLORES REALES (no los dibuja la IA). Tenés libertad TOTAL de composición — USALA: variá, no repitas siempre el mismo molde.

DIRECCIÓN DE ARTE (apuntamos al nivel de las buenas marcas de mascotas en redes):
- LA FOTO suele ser PROTAGONISTA, no decoración. Las marcas buenas del rubro usan MUCHA foto real (mascota viva, feliz o serena) y rara vez puro texto. No hace falta foto en TODAS las piezas, pero usala SEGUIDO (reutilizá el banco cuando haya una que calce, o pedí una con FOTO:slot). Lo que NO queremos es el molde repetido de placas de puro texto.
- VARIÁ EL LAYOUT entre piezas y entre slides de un carrusel. Menú de formatos (elegí y combiná, no uses siempre el mismo):
  1) FOTO FULL-BLEED + texto encima: la foto cubre todo el lienzo (img absoluta), con un velo navy translúcido (rgba) en una franja y el titular en blanco encima.
  2) MASCOTA RECORTADA sobre fondo de color de marca (navy o crema): la foto del animal a un lado y el titular + bullets al otro. (Es el layout más usado del rubro.)
  3) MASCOTA ASOMÁNDOSE desde un borde/esquina (medio cuerpo entrando al cuadro) y el texto en el espacio libre. Da calidez sin tapar todo.
  4) EDITORIAL: fondo crema, titular grande, y una foto en una banda o esquina. Aire elegante PERO con la foto presente.
  5) PLACA DE TEXTO pura (navy o crema, sin foto): de vez en cuando, SOLO para una cita corta, un dato fuerte o el cierre con contacto.
- TITULAR con FUERZA: corto, alto impacto; podés resaltar UNA palabra en dorado (${BRAND.amber}) o más grande. IMPORTANTE: poné la palabra resaltada en su PROPIO <span>/línea (NO un <span> de color en MEDIO de una oración: satori lo envuelve mal y queda suelto). Para titulares informativos o sobre foto preferí 'Inter' peso 700 en MAYÚSCULAS (más legible y serio); reservá 'More Sugar' para el wordmark o un título corto y cálido.
- VENDÉ, no solo informes: la pieza tiene que ENGANCHAR, no leerse como un folleto corporativo formal. Titular con GANCHO/beneficio (no un enunciado plano), DESTACÁ 1-2 palabras clave para que salten (en dorado ${BRAND.amber} y/o más grandes), y jugá con la JERARQUÍA (una idea manda grande, el resto apoya chico). Menos texto y menos acartonado; más impacto, calidez y personalidad. Un dato/beneficio fuerte bien puesto vende más que un párrafo.
- LLENÁ TODO el lienzo, borde a borde: el <div> RAÍZ ocupa el alto EXACTO del canvas y su contenido cubre TODO ese alto (repartí con flex / justify-content:space-between / height:100% / flex:1). PROHIBIDO dejar una franja de fondo VACÍA arriba o abajo — una placa que llena solo la mitad superior y deja el resto vacío está MAL. Si sobra espacio, agrandá la foto o el titular, sumá aire entre bloques o extendé el fondo; nunca dejes un hueco muerto.

MARCA (respetar SIEMPRE):
- COLORES (hex EXACTOS): navy ${BRAND.navy} (estructura/velos), dorado ${BRAND.amber} (acentos, filetes, palabra resaltada), crema ${BRAND.cream} y blanco #ffffff (fondos), texto sobre claro ${BRAND.ink}, texto sobre navy/foto #ffffff o #e8eef5. Domina la foto o crema/blanco; navy estructura; dorado acento (poco).
- TIPOGRAFÍA: 'More Sugar' SOLO para el wordmark o un título corto cálido; 'Inter' (400/600/700) para titulares informativos, subtítulos, bullets y datos.
- REDACCIÓN: NO copies literal lo que te dicen. Redactá profesional y pulido, jerarquizado (ej. "retiro a domicilio" → "Retiro a domicilio y desde clínicas"). Títulos cortos; bullets de pocas palabras. (Aplican las REGLAS INVIOLABLES de más arriba: nada de "compañero", "cámara certificada", etc.)
- LOGO: ponelo VOS con <img src="URL"> (URLs de "LOGOS DE MARCA"), variante por CONTRASTE: BLANCO sobre navy/foto oscura; AZUL sobre crema/foto clara. Tamaño y posición CONSISTENTES dentro de un carrusel. Para tamaños chicos (<200px) usá la variante ISOTIPO (sin la bajada "Huellas que no se borran", que a ese tamaño no se lee); la versión con bajada va GRANDE (portada). Nunca sobre la parte cargada de una foto. SIEMPRE incluí el logo. El logo debe quedar COMPLETO y DENTRO del lienzo, con margen del borde: posición + tamaño NUNCA pueden pasar el borde del canvas (si va arriba a la derecha, left+width ≤ ancho del canvas; dejá ~40px de margen), para que no se corte.
- FOTOS reales: <img src="FOTO:slot1" width=".." height=".." style="object-fit:cover" /> y pedí cada foto en "fotos" (prompt cálido, mascota viva; NUNCA instalaciones). Reutilizá las del banco poniendo su URL directa en el <img> (sin pedirla en "fotos").
- ⚠️ object-fit:cover RECORTA la foto al tamaño del <img>. Para que NO le corte la cabeza/cara al animal: (a) pedí la foto con un \`aspect\` que COINCIDA con la proporción ancho:alto del contenedor — franja ANCHA (más ancha que alta) → aspect horizontal (16:9 o 3:2); panel ALTO (más alto que ancho) → vertical (4:5 o 9:16); contenedor cuadrado → 1:1; y (b) en el prompt pedí al sujeto CENTRADO y con margen. NUNCA pongas una foto vertical en una franja ancha (le corta la cara al animal).
- CUTOUT (mascota RECORTADA o ASOMÁNDOSE, flotando sobre el color sin recuadro): pedí la foto con recortar:true → sale en PNG transparente que se compone sobre el fondo. Para FULL-BLEED o panel rectangular, recortar:false. (Las fotos del banco que ya son recortadas/PNG transparente se reutilizan poniendo su URL en el <img>.)
- AJUSTES (CLAVE): si piden cambiar algo de un gráfico YA hecho, NO lo rehagas. En "ÚLTIMO GRÁFICO QUE DISEÑASTE" tenés el HTML EXACTO con las fotos por su URL real: COPIALO y cambiá SOLO lo pedido (misma foto, mismo logo, mismos tamaños). No toques lo que no te pidieron.
- PROHIBIDO en placas: flechas (→), emojis (🐾 ✅) y símbolos Unicode raros — el motor los dibuja como cajas rotas. Usá texto.

REGLAS TÉCNICAS DEL HTML (obligatorias — el motor es satori):
- UN solo <div> RAÍZ del tamaño EXACTO del canvas: portada_fb=1640x624, post=1080x1080, post_vertical=1080x1350, story=1080x1920, horizontal=1200x675.
- Solo estilos INLINE. Layout con FLEXBOX: TODO <div> con 2+ hijos DEBE llevar display:flex (+ flex-direction). position:relative en la raíz + position:absolute para la foto full-bleed o el logo. Nada de grid, float ni tablas. Sin <br>: el texto envuelve solo por el ancho del contenedor.
- Para FOTO full-bleed: <img position:absolute;top:0;left:0 width=CANVAS height=CANVAS object-fit:cover> y ENCIMA un <div> con el texto (sumá un velo navy translúcido si hace falta legibilidad).
- El texto va en <span>/<p>. Tamaños/espaciados en px. Imágenes con width/height explícitos.

EJEMPLO (post 1080x1080, mascota recortada sobre navy — adaptá libremente, NO lo copies igual siempre):
<div style="display:flex;position:relative;width:1080px;height:1080px;background:${BRAND.navy}">
  <div style="display:flex;flex-direction:column;justify-content:center;width:560px;height:1080px;padding:0 70px">
    <span style="font-family:Inter;font-weight:700;font-size:60px;color:#ffffff;line-height:1.07">Cuidamos cada detalle</span>
    <span style="font-family:Inter;font-weight:700;font-size:64px;color:${BRAND.amber};line-height:1.07">de la despedida</span>
    <span style="font-family:Inter;font-size:30px;color:#e8eef5;margin-top:24px">Acompañamiento real, todos los días.</span>
  </div>
  <img src="FOTO:slot1" width="520" height="1080" style="object-fit:cover" />
  <img src="URL_DEL_LOGO_BLANCO" width="150" style="position:absolute;top:48px;left:70px" />
</div>`

/**
 * Sufijo (inglés) para el modo GRÁFICO/DISEÑO del modelo de imagen: permite texto
 * (al revés del modo foto, que lo prohíbe) y pide un diseño on-brand tipo newsletter.
 */
export const ESTILO_GRAFICO_EN =
  `Design a clean, modern, premium MARKETING GRAPHIC in the Crematorio Alma Animal brand style (same look as its email newsletters): ` +
  `cream/white (${BRAND.cream}) background dominant, deep navy (${BRAND.navy}) for header bars / structural blocks, and a little warm gold (${BRAND.amber}) as accent (a thin gold rule under a navy bar looks on-brand). Elegant, generous negative space, clear visual hierarchy, trustworthy and serene — never cluttered, childish, neon or stocky. ` +
  `If the brief includes text, render it CRISPLY and CORRECTLY SPELLED in Spanish, in a clean modern sans-serif, well aligned and kerned, high legibility — NO gibberish, NO distorted or misspelled letters. Keep text minimal and hierarchical (one short headline + at most 3-4 very short bullets). ` +
  `You may include one warm, realistic photo of a calm, happy pet integrated tastefully. Leave a clean empty corner for a logo (do not draw the logo). ` +
  PROHIBIDOS_EN
