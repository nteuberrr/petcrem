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
  `Any animal must look ALIVE, healthy and calm or happy — never sick, dying, or posed as if dead. Leave clean negative space (text or a logo may be added later). ` +
  PROHIBIDOS_EN

/**
 * Sistema para DISEÑAR GRÁFICOS CON TEXTO (herramienta "disenar_grafico"): el
 * agente escribe el diseño en HTML y el sistema lo rasteriza con las fuentes y
 * colores REALES de la marca (satori) → marca EXACTA con layout libre. NO es para
 * que la IA "dibuje" el gráfico.
 */
export const MARCA_GRAFICO = `DISEÑO DE GRÁFICOS CON TEXTO (herramienta "disenar_grafico") — marca EXACTA, layout libre:
Vos escribís el DISEÑO en HTML y el sistema lo rasteriza con las FUENTES y COLORES REALES (no los dibuja la IA). Tenés libertad de composición/jerarquía/información, pero respetá SIEMPRE la marca:
- COLORES (hex EXACTOS): navy ${BRAND.navy} (bloques/estructura), dorado ${BRAND.amber} (acentos, filetes), crema ${BRAND.cream} y blanco #ffffff (fondos), texto sobre claro ${BRAND.ink}, texto sobre navy #ffffff o #e8eef5. Domina crema/blanco; navy estructura; dorado acento. Podés sumar UN color de acento puntual sin romper la línea.
- TIPOGRAFÍA: font-family:'More Sugar' SOLO para el título/wordmark grande (es la fuente del logo); font-family:'Inter' para TODO el resto (subtítulos, bullets, datos), con font-weight 400/600/700.
- LOGO: NO lo pongas; se agrega solo abajo a la derecha. Dejá esa esquina con aire.
- FOTOS reales: poné <img src="FOTO:slot1" width=".." height=".." style="object-fit:cover" /> donde quieras una foto y pedí esa foto en "fotos" (con su prompt). Las fotos son cálidas y reales (mascotas vivas), nunca instalaciones.

REGLAS TÉCNICAS DEL HTML (obligatorias — el motor es satori):
- UN solo <div> RAÍZ del tamaño EXACTO del canvas según el formato: portada_fb=1640x624, post=1080x1080, post_vertical=1080x1350, story=1080x1920, horizontal=1200x675.
- Solo estilos INLINE (style="..."). Layout con FLEXBOX: TODO <div> con 2 o más hijos DEBE llevar display:flex (y flex-direction). Nada de grid, float, position ni tablas.
- El texto va dentro de <span>/<p>. Tamaños y espaciados en px. Imágenes con width/height explícitos.

EJEMPLO (formato portada_fb, 1640x624 — adaptá libremente la composición):
<div style="display:flex;width:1640px;height:624px;background:${BRAND.cream}">
  <div style="display:flex;flex-direction:column;justify-content:center;width:940px;height:624px;background:${BRAND.navy};padding:0 88px">
    <span style="font-family:'More Sugar';font-size:84px;color:#ffffff;line-height:1.04">Alma Animal</span>
    <span style="font-family:Inter;font-weight:600;font-size:34px;color:${BRAND.amber};margin-top:14px">Huellas que no se borran</span>
    <div style="display:flex;width:180px;height:7px;background:${BRAND.amber};margin:28px 0"></div>
    <div style="display:flex;flex-direction:column">
      <span style="font-family:Inter;font-size:28px;color:#e8eef5;margin-bottom:8px">Entrega en 4 días hábiles</span>
      <span style="font-family:Inter;font-size:28px;color:#e8eef5">Retiro a domicilio y clínicas</span>
    </div>
  </div>
  <div style="display:flex;width:700px;height:624px"><img src="FOTO:slot1" width="700" height="624" style="object-fit:cover" /></div>
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
