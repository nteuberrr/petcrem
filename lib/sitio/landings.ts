/**
 * Landings de captación (Google Ads + SEO) — crematorioalmaanimal.cl/<slug>.
 * Data-driven: los slugs/H1/keywords salen de los términos reales del Ads
 * (cremación de mascotas, eutanasia a domicilio, cremación de perros/gatos).
 *
 * Diseño enfocado a conversión (sin nav completa que distraiga), reutilizando el
 * CSS del sitio (/sitio/site.css → misma tipografía Inter) + paleta de marca, con
 * CTA directo a WhatsApp y el pixel (GTM) para medir. FAQ con schema para SEO.
 */

const BASE = 'https://www.crematorioalmaanimal.cl'
const WA = '56963126603'
const LOGO = '/sitio/assets/693382370d947890b33787fd_Logotipo-editable-Alma-Animal.ai-1-.png'
const GTM = 'GTM-5TWVTZNM'
// Mismos IDs que el resto del sitio (parity con el Webflow original): GA4 directo
// + Meta Pixel inline — en las páginas espejo vienen embebidos; las landings son
// nuestras y hay que inyectarlos explícitos (laguna detectada post-cutover 2026-07-14).
const GA4 = 'G-NLQBGW0RTP'
const META_PIXEL = '1324716849538772'

export interface Landing {
  slug: string
  title: string
  meta: string
  h1: string
  subtitulo: string
  intro: string
  waMsg: string
  faqs: { q: string; a: string }[]
  /** Inyecta tarjetas de precios VIVOS (desdePorSlug): 'cremacion' = 3 modalidades. */
  bloquePrecios?: 'cremacion'
}

export const LANDINGS: Record<string, Landing> = {
  'cremacion-de-mascotas': {
    slug: 'cremacion-de-mascotas',
    title: 'Cremación de Mascotas en Santiago | Alma Animal',
    meta: 'Cremación de mascotas en Santiago con devolución de cenizas, retiro a domicilio y entrega en 4 días hábiles. Instalaciones propias y trazabilidad total. Escríbenos por WhatsApp.',
    h1: 'Cremación de mascotas en Santiago',
    subtitulo: 'Una despedida digna para tu mascota, con retiro a domicilio y entrega de sus cenizas en 4 días hábiles.',
    intro: 'En Alma Animal acompañamos a tu familia en la despedida de tu mascota con un servicio cercano, rápido y responsable. Contamos con <strong>instalaciones propias</strong> en Recoleta, trazabilidad total del proceso y cobertura en toda la Región Metropolitana, todos los días de 09:00 a 22:00.',
    waMsg: 'Hola! Necesito información sobre la cremación de mi mascota',
    faqs: [
      { q: '¿Cuánto demora la entrega de las cenizas?', a: 'La entrega es en 4 días hábiles, con retiro a domicilio y devolución en un ánfora.' },
      { q: '¿Retiran a domicilio?', a: 'Sí, retiramos tu mascota en tu casa o en la clínica veterinaria, en toda la Región Metropolitana.' },
      { q: '¿Qué modalidades de cremación ofrecen?', a: 'Tres: Cremación Individual (con devolución de cenizas), Cremación Premium (incluye ánfora a elección y cuadro conmemorativo) y Cremación Sin Devolución, la opción más económica. Tú eliges la modalidad.' },
    ],
  },
  'eutanasia-a-domicilio': {
    slug: 'eutanasia-a-domicilio',
    title: 'Eutanasia a Domicilio para Mascotas en Santiago | Alma Animal',
    meta: 'Eutanasia veterinaria a domicilio para perros y gatos en Santiago, con acompañamiento y opción de cremación. Una despedida tranquila en casa. Escríbenos por WhatsApp.',
    h1: 'Eutanasia a domicilio para perros y gatos',
    subtitulo: 'Una despedida tranquila y con amor, en la comodidad de tu hogar, con acompañamiento veterinario.',
    intro: 'Cuando llega el momento, te acompañamos con un servicio de <strong>eutanasia veterinaria a domicilio</strong> respetuoso y sin apuros, y nos hacemos cargo también de la cremación si lo necesitas. Cobertura en la Región Metropolitana, todos los días.',
    waMsg: 'Hola! Necesito información sobre la eutanasia a domicilio de mi mascota',
    faqs: [
      { q: '¿La eutanasia se realiza en mi casa?', a: 'Sí, un médico veterinario acude a tu domicilio para que la despedida sea tranquila y sin trasladar a tu mascota.' },
      { q: '¿El veterinario evalúa antes de realizar el procedimiento?', a: 'Sí. Es un servicio con evaluación profesional: el veterinario examina a tu mascota en tu casa y confirma si corresponde realizar la eutanasia. Si al evaluar no corresponde, se cobra solo la consulta.' },
      { q: '¿Incluye la cremación?', a: 'Podemos hacernos cargo de la cremación después del procedimiento, con devolución de cenizas si lo deseas.' },
      { q: '¿En qué comunas atienden?', a: 'Atendemos en toda la Región Metropolitana, todos los días de 09:00 a 22:00.' },
    ],
  },
  'cremacion-de-perros': {
    slug: 'cremacion-de-perros',
    title: 'Cremación de Perros en Santiago | Alma Animal',
    meta: 'Cremación de perros en Santiago con retiro a domicilio, devolución de cenizas y entrega en 4 días hábiles. Instalaciones propias y trazabilidad. Escríbenos por WhatsApp.',
    h1: 'Cremación de perros en Santiago',
    subtitulo: 'Despide a tu perro con respeto. Retiro a domicilio y entrega de sus cenizas en 4 días hábiles.',
    intro: 'Sabemos lo que significa tu perro para tu familia. En Alma Animal realizamos su cremación con <strong>instalaciones propias</strong> y trazabilidad total, y te devolvemos sus cenizas en un ánfora. Retiro a domicilio en toda la Región Metropolitana.',
    waMsg: 'Hola! Necesito información sobre la cremación de mi perro',
    faqs: [
      { q: '¿Retiran a mi perro en casa?', a: 'Sí, retiramos a domicilio o en la clínica veterinaria, en toda la Región Metropolitana.' },
      { q: '¿Me devuelven las cenizas?', a: 'En la cremación individual te devolvemos las cenizas en un ánfora en 4 días hábiles.' },
      { q: '¿Atienden perros de todo tamaño?', a: 'Sí, atendemos perros de todos los tamaños. Escríbenos y te orientamos según el caso.' },
    ],
  },
  'precios-cremacion-mascotas': {
    slug: 'precios-cremacion-mascotas',
    title: 'Precios de Cremación de Mascotas en Santiago | Alma Animal',
    meta: 'Precios claros de cremación de mascotas en Santiago, según peso y modalidad: Individual, Premium y Sin Devolución. Retiro a domicilio en la RM. Cotiza por WhatsApp.',
    h1: 'Precios de cremación de mascotas',
    subtitulo: 'Valores claros según el peso de tu mascota y la modalidad que elijas. Sin costos ocultos.',
    intro: 'Trabajamos con <strong>precios publicados por peso y modalidad</strong>, para que decidas con toda la información. El servicio incluye el retiro en tu domicilio o clínica, la cremación con trazabilidad total y el certificado. Escríbenos por WhatsApp con el peso aproximado de tu mascota y te cotizamos de inmediato.',
    waMsg: 'Hola! Quiero cotizar la cremación de mi mascota',
    bloquePrecios: 'cremacion',
    faqs: [
      { q: '¿De qué depende el precio?', a: 'Del peso de tu mascota y de la modalidad: Cremación Individual (con devolución de cenizas), Premium (ánfora a elección y cuadro conmemorativo) o Sin Devolución, la opción más económica.' },
      { q: '¿El precio incluye el ánfora?', a: 'La Cremación Individual incluye ánfora de greda marmoleada, botellita con mechón de pelo y etiqueta de madera con el nombre. En la Premium eliges un ánfora premium.' },
      { q: '¿El retiro tiene costo extra?', a: 'El retiro en domicilio o clínica está incluido en la Región Metropolitana; según la comuna puede aplicar un recargo por distancia, que te informamos antes de agendar.' },
    ],
  },
  'eutanasia-de-perros': {
    slug: 'eutanasia-de-perros',
    title: 'Eutanasia para Perros a Domicilio en Santiago | Alma Animal',
    meta: 'Eutanasia para perros a domicilio en Santiago, con evaluación veterinaria previa y opción de cremación. Una despedida tranquila en casa. Escríbenos por WhatsApp.',
    h1: 'Eutanasia para perros a domicilio',
    subtitulo: 'Una despedida tranquila para tu perro, en la comodidad de su casa, con acompañamiento veterinario.',
    intro: 'Cuando tu perro está sufriendo y llega el momento de despedirlo, te acompañamos con un servicio de <strong>eutanasia a domicilio</strong> respetuoso y sin apuros: un veterinario de nuestra red lo evalúa primero en tu casa y, si corresponde, realiza el procedimiento ahí mismo, sin traslados estresantes. Después podemos encargarnos también de la cremación.',
    waMsg: 'Hola! Necesito información sobre la eutanasia a domicilio para mi perro',
    faqs: [
      { q: '¿El veterinario evalúa a mi perro antes?', a: 'Sí. El veterinario lo examina en tu casa y confirma si corresponde realizar la eutanasia. Si al evaluar no corresponde, se cobra solo la consulta.' },
      { q: '¿Puedo estar presente?', a: 'Sí, puedes acompañar a tu perro durante todo el procedimiento — la idea es justamente que la despedida sea en su entorno, con su familia.' },
      { q: '¿Incluye la cremación?', a: 'Podemos hacernos cargo de la cremación después del procedimiento, con devolución de cenizas si lo deseas.' },
      { q: '¿En qué horario atienden?', a: 'Todos los días de 09:00 a 22:00, en toda la Región Metropolitana.' },
    ],
  },
  'eutanasia-de-gatos': {
    slug: 'eutanasia-de-gatos',
    title: 'Eutanasia para Gatos a Domicilio en Santiago | Alma Animal',
    meta: 'Eutanasia para gatos a domicilio en Santiago, con evaluación veterinaria previa y opción de cremación. Sin traslados que lo estresen. Escríbenos por WhatsApp.',
    h1: 'Eutanasia para gatos a domicilio',
    subtitulo: 'Una despedida tranquila para tu gato, en su casa y sin traslados que lo estresen.',
    intro: 'Los traslados estresan especialmente a los gatos. Por eso realizamos la <strong>eutanasia a domicilio</strong>: un veterinario de nuestra red evalúa a tu gato en tu casa y, si corresponde, realiza el procedimiento ahí mismo, con respeto y sin apuros. Después podemos encargarnos también de la cremación.',
    waMsg: 'Hola! Necesito información sobre la eutanasia a domicilio para mi gato',
    faqs: [
      { q: '¿El veterinario evalúa a mi gato antes?', a: 'Sí. El veterinario lo examina en tu casa y confirma si corresponde realizar la eutanasia. Si al evaluar no corresponde, se cobra solo la consulta.' },
      { q: '¿Por qué a domicilio?', a: 'Para los gatos, salir de su territorio es muy estresante. En casa la despedida es tranquila, en su entorno y con su familia.' },
      { q: '¿Incluye la cremación?', a: 'Podemos hacernos cargo de la cremación después del procedimiento, con devolución de cenizas si lo deseas.' },
    ],
  },
  'incineracion-de-mascotas': {
    slug: 'incineracion-de-mascotas',
    title: 'Incineración de Mascotas en Santiago | Alma Animal',
    meta: 'Incineración de mascotas en Santiago con retiro a domicilio, devolución de cenizas y entrega en 4 días hábiles. Instalaciones propias con horno certificado.',
    h1: 'Incineración de mascotas en Santiago',
    subtitulo: 'Incineración con trazabilidad total, retiro a domicilio y entrega de las cenizas en 4 días hábiles.',
    intro: 'La incineración —también llamada cremación— es la forma más digna y responsable de despedir a tu mascota. En Alma Animal la realizamos en <strong>instalaciones propias con horno certificado</strong>, con trazabilidad total del proceso y devolución de las cenizas en un ánfora. Retiro en tu casa o clínica, en toda la Región Metropolitana.',
    waMsg: 'Hola! Necesito información sobre la incineración de mi mascota',
    faqs: [
      { q: '¿Incineración y cremación son lo mismo?', a: 'Sí, son el mismo proceso. En Alma Animal lo realizamos en instalaciones propias con horno certificado, sin externalizar ninguna etapa.' },
      { q: '¿Me devuelven las cenizas?', a: 'En la modalidad Individual te devolvemos las cenizas en un ánfora en 4 días hábiles, junto al certificado.' },
      { q: '¿Retiran a domicilio?', a: 'Sí, retiramos tu mascota en tu casa o en la clínica veterinaria, todos los días de 09:00 a 22:00 en toda la RM.' },
    ],
  },
  'funeraria-de-mascotas': {
    slug: 'funeraria-de-mascotas',
    title: 'Funeraria de Mascotas en Santiago | Alma Animal',
    meta: 'Funeraria de mascotas en Santiago: nos encargamos de todo — retiro a domicilio, cremación con trazabilidad y entrega de las cenizas con certificado. Todos los días de 9:00 a 22:00.',
    h1: 'Funeraria de mascotas en Santiago',
    subtitulo: 'Nos hacemos cargo de todo el servicio funerario de tu mascota: retiro, cremación y entrega de sus cenizas.',
    intro: 'Cuando tu mascota parte, hay muchas decisiones que tomar en un momento difícil. En Alma Animal nos encargamos del servicio completo: retiro en tu casa o clínica, cremación en <strong>instalaciones propias</strong> con trazabilidad total, y entrega de sus cenizas en un ánfora junto al certificado de cremación. Cobertura en toda la Región Metropolitana, todos los días de 09:00 a 22:00.',
    waMsg: 'Hola! Necesito información sobre el servicio funerario para mi mascota',
    faqs: [
      { q: '¿Qué incluye el servicio funerario?', a: 'Retiro de tu mascota a domicilio o en la clínica veterinaria, cremación en la modalidad que elijas y entrega de las cenizas en un ánfora, con certificado de cremación.' },
      { q: '¿Cuánto cuesta?', a: 'Depende del peso de tu mascota y de la modalidad de cremación (Individual, Premium o Sin Devolución). Escríbenos por WhatsApp y te cotizamos de inmediato.' },
      { q: '¿Atienden fines de semana y festivos?', a: 'Sí, atendemos todos los días de 09:00 a 22:00, en toda la Región Metropolitana. El retiro habitualmente se coordina en menos de 3 horas.' },
      { q: '¿Me entregan un certificado?', a: 'Sí. Cada cremación incluye certificado y código de seguimiento, con trazabilidad total durante el proceso.' },
    ],
  },
  'cremacion-de-gatos': {
    slug: 'cremacion-de-gatos',
    title: 'Cremación de Gatos en Santiago | Alma Animal',
    meta: 'Cremación de gatos en Santiago con retiro a domicilio, devolución de cenizas y entrega en 4 días hábiles. Instalaciones propias y trazabilidad. Escríbenos por WhatsApp.',
    h1: 'Cremación de gatos en Santiago',
    subtitulo: 'Despide a tu gato con respeto. Retiro a domicilio y entrega de sus cenizas en 4 días hábiles.',
    intro: 'Tu gato fue parte de tu familia y merece una despedida a su altura. Realizamos su cremación con <strong>instalaciones propias</strong> y trazabilidad total, con devolución de sus cenizas. Retiro a domicilio en toda la Región Metropolitana.',
    waMsg: 'Hola! Necesito información sobre la cremación de mi gato',
    faqs: [
      { q: '¿Retiran a mi gato en casa?', a: 'Sí, retiramos a domicilio o en la clínica veterinaria, en toda la Región Metropolitana.' },
      { q: '¿Me devuelven las cenizas?', a: 'En la cremación individual te devolvemos las cenizas en un ánfora en 4 días hábiles.' },
      { q: '¿Cómo coordino el retiro?', a: 'Escríbenos por WhatsApp y coordinamos el retiro en el horario que necesites.' },
    ],
  },
}

const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function waLink(msg: string): string {
  return `https://wa.me/${WA}?text=${encodeURIComponent(msg)}`
}

const DIFERENCIADORES = [
  { i: '📦', t: 'Entrega en 4 días hábiles', d: 'Proceso rápido y sin esperas eternas.' },
  { i: '🏭', t: 'Instalaciones propias', d: 'No externalizamos: todo bajo nuestro control en Recoleta.' },
  { i: '🔎', t: 'Trazabilidad total', d: 'Sigues cada etapa del proceso, con certificado.' },
  { i: '🚗', t: 'Retiro a domicilio', d: 'En tu casa o clínica, en toda la RM, de 09:00 a 22:00.' },
]

const fmtCLP = (n: number) => '$' + Math.round(n).toLocaleString('es-CL')

/** Tarjetas de precios "Desde" (tarifas VIVAS de precios_generales, misma fuente que /servicios). */
function bloquePreciosHtml(desde: Record<string, number>): string {
  const cards = [
    { slug: 'cremacion-individual', n: 'Cremación Individual', d: 'Con devolución de cenizas en ánfora de greda, mechón de pelo y certificado.' },
    { slug: 'cremacion-premium', n: 'Cremación Premium', d: 'Todo lo de Individual, más ánfora premium a elección y cuadro conmemorativo.' },
    { slug: 'cremacion-sin-devolucion-de-cenizas', n: 'Cremación Sin Devolución', d: 'Con certificado y retiro incluido; sin devolución de cenizas. La opción más económica.' },
  ]
  return `<section class="precios">
    <h2>Nuestras modalidades y precios</h2>
    ${cards.map(c => `<div class="pre-card"><h3>${c.n}</h3><div class="pre-desde">Desde ${desde[c.slug] > 0 ? fmtCLP(desde[c.slug]) : 'Consultar'}</div><p>${c.d}</p></div>`).join('')}
    <p class="pre-nota">El valor final depende del peso de tu mascota. <a href="/servicios">Ver la tabla completa de precios</a></p>
  </section>`
}

export function renderLanding(l: Landing, desde?: Record<string, number>): string {
  const wa = waLink(l.waMsg)
  const url = `${BASE}/${l.slug}`
  const faqSchema = {
    '@context': 'https://schema.org', '@type': 'FAQPage',
    mainEntity: l.faqs.map(f => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })),
  }
  return `<!DOCTYPE html><html lang="es"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${esc(l.title)}</title>
<meta name="description" content="${esc(l.meta)}"/>
<link rel="canonical" href="${url}"/>
<meta property="og:type" content="website"/><meta property="og:title" content="${esc(l.title)}"/>
<meta property="og:description" content="${esc(l.meta)}"/><meta property="og:url" content="${url}"/>
<meta property="og:image" content="${BASE}${LOGO}"/><meta property="og:locale" content="es_CL"/>
<link rel="stylesheet" href="/sitio/site.css"/>
<link rel="icon" type="image/png" sizes="96x96" href="/sitio/assets/favicon-96.png"/>
<script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','${GTM}');</script>
<script async src="https://www.googletagmanager.com/gtag/js?id=${GA4}"></script>
<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${GA4}');</script>
<script>!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','${META_PIXEL}');fbq('track','PageView');</script>
<noscript><img height="1" width="1" style="display:none" src="https://www.facebook.com/tr?id=${META_PIXEL}&ev=PageView&noscript=1"/></noscript>
<style>
.lp{font-family:Inter,system-ui,sans-serif;color:#143C64;background:#FBF8F3;margin:0}
.lp-wrap{max-width:1080px;margin:0 auto;padding:0 20px}
.lp-head{display:flex;align-items:center;justify-content:space-between;padding:16px 0}
.lp-brand{display:flex;align-items:center;gap:10px;text-decoration:none;color:#143C64}
.lp-brand img{height:46px;width:auto}
.lp-brand b{font-weight:800;font-size:17px;letter-spacing:.01em;line-height:1.15}
.lp-brand small{display:block;font-weight:500;font-size:11px;color:#5B7288;letter-spacing:.04em}
.lp-head a.cta-sm{background:#143C64;color:#fff;padding:10px 18px;border-radius:999px;text-decoration:none;font-weight:600;font-size:14px}
.lp-hero{text-align:center;padding:48px 0 40px}
.lp-hero h1{font-size:clamp(28px,5vw,46px);line-height:1.1;margin:0 0 16px;font-weight:800;letter-spacing:-.02em;text-wrap:balance}
.lp-hero p.sub{font-size:clamp(16px,2.4vw,20px);color:#2A4A66;max-width:640px;margin:0 auto 28px}
.cta{display:inline-flex;align-items:center;gap:10px;background:#F2B84B;color:#143C64;padding:16px 30px;border-radius:999px;text-decoration:none;font-weight:800;font-size:18px;box-shadow:0 6px 20px rgba(20,60,100,.18)}
.cta:hover{filter:brightness(.97)}
.trust{margin-top:16px;font-size:13px;color:#5B7288}
.lp-intro{max-width:760px;margin:0 auto;font-size:17px;line-height:1.7;color:#2A4A66;text-align:center;padding:8px 0 40px}
.difs{display:grid;grid-template-columns:1fr;gap:16px;padding:8px 0 48px}
@media(min-width:640px){.difs{grid-template-columns:repeat(2,1fr)}}
@media(min-width:960px){.difs{grid-template-columns:repeat(4,1fr)}}
.dif{background:#fff;border:1px solid #E7E0D6;border-radius:18px;padding:22px}
.dif .ic{font-size:26px}.dif h3{margin:10px 0 6px;font-size:16px}.dif p{margin:0;font-size:14px;color:#5B7288;line-height:1.5}
.lp-cta2{text-align:center;background:#143C64;color:#fff;border-radius:24px;padding:44px 24px;margin:0 0 48px}
.lp-cta2 h2{margin:0 0 10px;font-size:26px;color:#fff}.lp-cta2 p{margin:0 0 22px;color:#CBD9E6}
.faq{max-width:760px;margin:0 auto;padding:0 0 56px}
.faq h2{text-align:center;font-size:26px;margin:0 0 22px}
.faq details{background:#fff;border:1px solid #E7E0D6;border-radius:14px;padding:16px 20px;margin-bottom:12px}
.faq summary{font-weight:700;cursor:pointer;list-style:none}.faq summary::-webkit-details-marker{display:none}
.faq p{color:#5B7288;line-height:1.6;margin:10px 0 0}
.precios{max-width:860px;margin:0 auto;padding:0 0 48px;display:grid;grid-template-columns:1fr;gap:14px}
@media(min-width:760px){.precios{grid-template-columns:repeat(3,1fr)}}
.precios h2{grid-column:1/-1;text-align:center;font-size:26px;margin:0 0 8px}
.pre-card{background:#fff;border:1px solid #E7E0D6;border-radius:18px;padding:22px;text-align:center}
.pre-card h3{margin:0 0 6px;font-size:16px}
.pre-desde{font-size:24px;font-weight:800;color:#143C64;margin:4px 0 10px}
.pre-card p{margin:0;font-size:13.5px;color:#5B7288;line-height:1.55}
.pre-nota{grid-column:1/-1;text-align:center;font-size:13px;color:#5B7288;margin:4px 0 0}
.pre-nota a{color:#2A6DB0;font-weight:600}
.lp-foot{background:#0B2845;color:#B9C9D8;text-align:center;padding:28px 20px;font-size:13px}
.lp-foot a{color:#F2B84B;text-decoration:none;font-weight:600}
</style>
</head>
<body class="lp">
<noscript><iframe src="https://www.googletagmanager.com/ns.html?id=${GTM}" height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>
<div class="lp-wrap">
  <header class="lp-head">
    <a class="lp-brand" href="/"><img src="${LOGO}" alt="Crematorio Alma Animal"/><b>Alma Animal<small>Huellas que no se borran</small></b></a>
    <a class="cta-sm" href="${wa}" target="_blank" rel="noopener">WhatsApp</a>
  </header>
  <section class="lp-hero">
    <h1>${esc(l.h1)}</h1>
    <p class="sub">${esc(l.subtitulo)}</p>
    <a class="cta" href="${wa}" target="_blank" rel="noopener">💬 Escríbenos por WhatsApp</a>
    <div class="trust">Atención todos los días · 09:00 a 22:00 · Cobertura Región Metropolitana</div>
  </section>
  <p class="lp-intro">${l.intro}</p>
  ${l.bloquePrecios && desde ? bloquePreciosHtml(desde) : ''}
  <section class="difs">
    ${DIFERENCIADORES.map(d => `<div class="dif"><div class="ic">${d.i}</div><h3>${d.t}</h3><p>${d.d}</p></div>`).join('')}
  </section>
  <section class="lp-cta2">
    <h2>Estamos para acompañarte</h2>
    <p>Escríbenos y te orientamos en cada paso, sin compromiso.</p>
    <a class="cta" href="${wa}" target="_blank" rel="noopener">💬 Hablar por WhatsApp</a>
  </section>
  <section class="faq">
    <h2>Preguntas frecuentes</h2>
    ${l.faqs.map(f => `<details><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`).join('')}
  </section>
</div>
<footer class="lp-foot">
  Crematorio Alma Animal · Recoleta, Santiago · <a href="${wa}" target="_blank" rel="noopener">WhatsApp ${WA}</a><br/>
  Huellas que no se borran · <a href="/">Ir al sitio</a><br/>
  ${Object.values(LANDINGS).filter(x => x.slug !== l.slug).map(x => `<a href="/${x.slug}">${esc(x.h1.replace(/ en Santiago| para perros y gatos/g, ''))}</a>`).join(' · ')}
</footer>
<script type="application/ld+json">${JSON.stringify(faqSchema)}</script>
</body></html>`
}
