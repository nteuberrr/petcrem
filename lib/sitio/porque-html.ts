/**
 * Sitio público — sección "¿Por qué elegir Alma Animal?" + FAQ con schema.org
 * (FAQPage), inyectada en el home. Es la pieza SEO central: sus H3 y respuestas
 * calcan las frases que Google y los asistentes de IA usan para recomendar
 * crematorios en Santiago (cremación individual, certificado, trazabilidad,
 * retiro a domicilio, plazos, precios transparentes — análisis competitivo del
 * dueño 2026-07-13). Los montos salen VIVOS de precios_generales vía
 * DatosPrecios, igual que las tablas de /servicios.
 *
 * Datos confirmados por el dueño (2026-07-13): autorización sanitaria,
 * patente municipal al día, personal técnicamente capacitado, hornos
 * certificados bajo normativa ISO y proceso sin emisiones contaminantes.
 */

import { type DatosPrecios, filasCremacion, desdeDe, fmtCLP } from './precios-html'

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const TARJETAS: { titulo: string; texto: string }[] = [
  {
    titulo: 'Cremación individual garantizada',
    texto: 'Tu mascota se crema completamente sola y recibes solo sus cenizas, con devolución exclusiva. También ofrecemos cremación Premium y una alternativa sin devolución, donde las cenizas se destinan a un proceso de reforestación.',
  },
  {
    titulo: 'Autorización sanitaria y patente comercial al día',
    texto: 'Somos una empresa formalmente constituida: operamos con autorización sanitaria y patente comercial al día. La tranquilidad de despedir a tu mascota en un crematorio establecido y regulado.',
  },
  {
    titulo: 'Certificado de cremación con firma digital',
    texto: 'Cada cremación incluye un certificado con firma digital verificable que respalda la identidad de tu mascota, la fecha y el proceso realizado. Te llega directo a tu correo.',
  },
  {
    titulo: 'Trazabilidad total y video de ingreso',
    texto: 'Desde el retiro hasta la entrega, tu mascota tiene un código único de seguimiento. Además, siempre incluimos un video del ingreso al proceso, para tu total tranquilidad.',
  },
  {
    titulo: 'Retiro a domicilio en unas 3 horas',
    texto: 'Retiramos a tu mascota en tu casa o en la clínica veterinaria, en toda la Región Metropolitana, coordinando el retiro dentro de las siguientes 3 horas.',
  },
  {
    titulo: 'Cenizas de vuelta en 3 días hábiles',
    texto: 'Entregamos el ánfora con las cenizas de tu mascota en un máximo de 3 días hábiles — uno de los plazos más rápidos de Santiago.',
  },
  {
    titulo: 'Atención todos los días, de 9:00 a 22:00',
    texto: 'Estos momentos no avisan. Atendemos de lunes a domingo, incluidos festivos, por WhatsApp y teléfono, con respuesta en minutos.',
  },
  {
    titulo: 'Instalaciones propias en Recoleta',
    texto: 'Hornos de cremación certificados, cámara de conservación y recepción propia: todo el proceso ocurre bajo nuestro control directo, sin intermediarios. Puedes conocer nuestras instalaciones en la sección Nosotros.',
  },
  {
    titulo: 'Precios transparentes y publicados',
    texto: 'Publicamos nuestras tarifas por tramo de peso en cada servicio, sin sorpresas ni cobros ocultos. Compara con confianza: el valor queda claro antes de contratar.',
  },
  {
    titulo: 'Recuerdos incluidos en cada despedida',
    texto: 'Junto al ánfora entregamos una placa de madera grabada con su nombre, una botella de vidrio con un mechón de pelo y una tarjeta con su huella estampada.',
  },
  {
    titulo: 'Hornos certificados y proceso ecológico',
    texto: 'Nuestros hornos de cremación están certificados bajo normativa ISO y operan sin emisiones contaminantes: una despedida respetuosa con tu mascota y también con el medio ambiente.',
  },
  {
    titulo: 'Equipo técnicamente capacitado',
    texto: 'Personal capacitado técnicamente en cada etapa: retiro, recepción, conservación, cremación y entrega. Un proceso serio, realizado como corresponde.',
  },
]

function faqs(d: DatosPrecios): { q: string; a: string }[] {
  const desdeCI = desdeDe(filasCremacion(d.tramosGen, 'precio_ci'))
  const desdeSD = desdeDe(filasCremacion(d.tramosGen, 'precio_sd'))
  return [
    {
      q: '¿Cuánto cuesta la cremación de una mascota en Santiago?',
      a: `En Alma Animal la cremación individual con devolución de cenizas parte desde ${fmtCLP(desdeCI)} y la cremación sin devolución desde ${fmtCLP(desdeSD)}, según el peso de tu mascota. Publicamos la tabla completa de precios por tramo en la página de cada servicio.`,
    },
    {
      q: '¿Cómo sé que las cenizas que recibo son realmente de mi mascota?',
      a: 'Tu mascota recibe un código único de trazabilidad desde el retiro hasta la entrega, la cremación individual se realiza completamente separada en nuestras instalaciones propias, e incluimos siempre un video del ingreso al proceso. Además, el certificado de cremación lleva firma digital verificable.',
    },
    {
      q: '¿Cuál es la diferencia entre cremación individual y colectiva?',
      a: 'En la cremación individual tu mascota se crema sola y recibes exclusivamente sus cenizas. En una cremación colectiva o comunitaria las cenizas no se devuelven. Nuestra alternativa sin devolución destina las cenizas a un proceso de reforestación, como una forma respetuosa de cerrar el ciclo.',
    },
    {
      q: '¿Entregan certificado de cremación?',
      a: 'Sí. Cada cremación incluye un certificado de cremación con firma digital verificable, que acredita la identidad de tu mascota, la fecha y el tipo de servicio. Se envía a tu correo junto con la entrega.',
    },
    {
      q: '¿Cuánto demora la entrega de las cenizas?',
      a: 'Entregamos el ánfora con las cenizas en un máximo de 3 días hábiles desde la cremación. El retiro de tu mascota lo coordinamos dentro de las siguientes 3 horas, todos los días entre 9:00 y 22:00.',
    },
    {
      q: '¿Hacen retiro a domicilio o en la clínica veterinaria?',
      a: 'Sí. Retiramos a tu mascota en tu domicilio o directamente en la clínica veterinaria, con cobertura en toda la Región Metropolitana, de lunes a domingo.',
    },
    {
      q: '¿Ofrecen eutanasia a domicilio?',
      a: 'Sí. Contamos con una red de veterinarios en convenio que realizan la eutanasia en tu hogar, con acompañamiento y coordinación directa con el servicio de cremación. Puedes ver el detalle en nuestro servicio de eutanasia a domicilio.',
    },
    {
      q: '¿El crematorio cuenta con autorización sanitaria?',
      a: 'Sí. Operamos con autorización sanitaria y patente comercial al día, en instalaciones propias en Recoleta, con hornos certificados bajo normativa ISO que funcionan sin emisiones contaminantes y un equipo técnicamente capacitado en cada etapa del proceso.',
    },
    {
      q: '¿Qué incluye el servicio de cremación individual?',
      a: 'Incluye el retiro de tu mascota en domicilio o clínica, la cremación completamente individual, un ánfora estándar con sus cenizas, una placa de madera grabada con su nombre, una botella de vidrio con un mechón de pelo, una tarjeta con su huella estampada, el video de ingreso y el certificado de cremación con firma digital.',
    },
    {
      q: '¿Puedo elegir el ánfora?',
      a: 'Sí. El servicio incluye un ánfora estándar sin costo adicional, y si quieres algo distinto puedes elegir otro modelo de nuestro catálogo de ánforas y relicarios por un valor extra.',
    },
    {
      q: '¿El retiro a domicilio tiene costo?',
      a: 'Realizamos retiros y entregas a domicilio en toda la Región Metropolitana. El servicio es gratuito dentro de un radio determinado; fuera de esa zona puede tener un costo adicional que te informamos antes de agendar.',
    },
    {
      q: '¿Qué debo hacer si mi mascota ya falleció?',
      a: 'Coloca a tu mascota en una superficie limpia y fresca, cúbrela con una manta o toalla y evita las fuentes de calor. Luego contáctanos por WhatsApp para coordinar el retiro: nos encargamos de todo el proceso de forma responsable y con cariño.',
    },
  ]
}

const CSS = '<style>'
  + '.aa-porque{background:#FBF8F3;padding:70px 24px}'
  + '.aa-porque-inner{max-width:1160px;margin:0 auto}'
  + '.aa-porque h2{color:#143C64;font-size:32px;font-weight:800;text-align:center;line-height:1.25;margin:0 0 12px}'
  + '.aa-porque-sub{color:#5b6b7a;font-size:16px;line-height:1.65;text-align:center;max-width:760px;margin:0 auto 36px}'
  + '.aa-porque-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:22px}'
  + '.aa-porque-card{background:#fff;border:1px solid #e3ddd2;border-radius:18px;box-shadow:0 4px 18px rgba(20,60,100,.07);padding:26px 26px 28px}'
  + '.aa-porque-bar{width:40px;height:5px;border-radius:999px;background:#F2B84B;margin-bottom:13px}'
  + '.aa-porque-card h3{color:#143C64;font-size:18px;font-weight:700;line-height:1.3;margin:0 0 9px}'
  + '.aa-porque-card p{color:#4a5a68;font-size:14.5px;line-height:1.7;margin:0}'
  + '.aa-faq{max-width:860px;margin:54px auto 0}'
  + '.aa-faq h2{font-size:28px}'
  + '.aa-faq details{background:#fff;border:1px solid #e3ddd2;border-radius:14px;margin-top:12px;overflow:hidden}'
  + '.aa-faq summary{cursor:pointer;padding:16px 22px;color:#143C64;font-size:16px;font-weight:700;list-style:none;display:flex;justify-content:space-between;align-items:center;gap:12px}'
  + '.aa-faq summary::-webkit-details-marker{display:none}'
  + '.aa-faq summary::after{content:"+";color:#F2B84B;font-size:24px;font-weight:800;line-height:1;flex-shrink:0}'
  + '.aa-faq details[open] summary::after{content:"–"}'
  + '.aa-faq details p{color:#4a5a68;font-size:15px;line-height:1.75;margin:0;padding:0 22px 18px}'
  + '@media (max-width:560px){.aa-porque{padding:50px 18px}.aa-porque h2{font-size:25px}.aa-faq h2{font-size:22px}}'
  + '</style>'

/**
 * Franja de confianza bajo el hero del home: los sellos clave en una línea,
 * con ancla a la sección completa de abajo (#por-que-elegirnos).
 */
export function renderConfianzaStrip(): string {
  const sellos = [
    'Autorización sanitaria y patente al día',
    'Cremación individual garantizada',
    'Retiro en ~3 horas en toda la RM',
    'Cenizas en 3 días hábiles',
    'Video de ingreso incluido',
    'Todos los días, 9:00 a 22:00',
  ]
  const css = '<style>'
    + '.aa-sellos{background:#143C64;padding:18px 24px}'
    + '.aa-sellos-inner{max-width:1200px;margin:0 auto;display:flex;flex-wrap:wrap;justify-content:center;align-items:center;gap:8px 26px}'
    + '.aa-sello{color:#FBF8F3;font-size:13.5px;font-weight:600;display:inline-flex;align-items:center;gap:7px;white-space:nowrap}'
    + '.aa-sello::before{content:"✓";color:#F2B84B;font-weight:800;font-size:15px}'
    + '.aa-sellos-link{color:#F2B84B;font-size:13.5px;font-weight:700;text-decoration:none;white-space:nowrap}'
    + '.aa-sellos-link:hover{text-decoration:underline}'
    + '@media (max-width:560px){.aa-sellos{padding:14px 16px}.aa-sellos-inner{gap:6px 16px}.aa-sello{font-size:12.5px;white-space:normal}}'
    + '</style>'
  return css
    + '<div class="aa-sellos"><div class="aa-sellos-inner">'
    + sellos.map(s => `<span class="aa-sello">${esc(s)}</span>`).join('')
    + '<a class="aa-sellos-link" href="#por-que-elegirnos">¿Por qué elegirnos? →</a>'
    + '</div></div>'
}

export function renderPorqueElegirnos(d: DatosPrecios): string {
  const preguntas = faqs(d)
  const cards = TARJETAS.map(t =>
    `<div class="aa-porque-card"><div class="aa-porque-bar"></div><h3>${esc(t.titulo)}</h3><p>${esc(t.texto)}</p></div>`
  ).join('')
  const faqHtml = preguntas.map(f =>
    `<details><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`
  ).join('')
  // FAQPage en JSON-LD: es lo que permite que Google/las IA citen las respuestas.
  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: preguntas.map(f => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  })
  return CSS
    + '<section class="aa-porque" id="por-que-elegirnos"><div class="aa-porque-inner">'
    + '<h2>¿Por qué elegir Alma Animal para la cremación de tu mascota en Santiago?</h2>'
    + '<p class="aa-porque-sub">Somos un crematorio de mascotas en Recoleta con cobertura en toda la Región Metropolitana. Cremación de perros, gatos y otras mascotas con trazabilidad total, certificado con firma digital y entrega de cenizas en 3 días hábiles.</p>'
    + `<div class="aa-porque-grid">${cards}</div>`
    + '<div class="aa-faq" id="preguntas-frecuentes">'
    + '<h2>Preguntas frecuentes sobre cremación de mascotas</h2>'
    + faqHtml
    + '</div></div></section>'
    + `<script type="application/ld+json">${jsonLd}</script>`
}
