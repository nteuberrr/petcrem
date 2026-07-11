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
const LOGO = '/sitio/assets/68780d4f39586a806a378a9d_Logo.png'
const GTM = 'GTM-5TWVTZNM'

export interface Landing {
  slug: string
  title: string
  meta: string
  h1: string
  subtitulo: string
  intro: string
  waMsg: string
  faqs: { q: string; a: string }[]
}

export const LANDINGS: Record<string, Landing> = {
  'cremacion-de-mascotas': {
    slug: 'cremacion-de-mascotas',
    title: 'Cremación de Mascotas en Santiago | Alma Animal',
    meta: 'Cremación de mascotas en Santiago con devolución de cenizas, retiro a domicilio y entrega en 3 días hábiles. Instalaciones propias y trazabilidad total. Escríbenos por WhatsApp.',
    h1: 'Cremación de mascotas en Santiago',
    subtitulo: 'Una despedida digna para tu mascota, con retiro a domicilio y entrega de sus cenizas en 3 días hábiles.',
    intro: 'En Alma Animal acompañamos a tu familia en la despedida de tu mascota con un servicio cercano, rápido y responsable. Contamos con <strong>instalaciones propias</strong> en Recoleta, trazabilidad total del proceso y cobertura en toda la Región Metropolitana, todos los días de 09:00 a 22:00.',
    waMsg: 'Hola! Necesito información sobre la cremación de mi mascota',
    faqs: [
      { q: '¿Cuánto demora la entrega de las cenizas?', a: 'La entrega es en 3 días hábiles, con retiro a domicilio y devolución en un ánfora.' },
      { q: '¿Retiran a domicilio?', a: 'Sí, retiramos tu mascota en tu casa o en la clínica veterinaria, en toda la Región Metropolitana.' },
      { q: '¿La cremación es individual?', a: 'Ofrecemos cremación individual (con devolución de cenizas) y comunitaria. Tú eliges la modalidad.' },
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
      { q: '¿Incluye la cremación?', a: 'Podemos hacernos cargo de la cremación después del procedimiento, con devolución de cenizas si lo deseas.' },
      { q: '¿En qué comunas atienden?', a: 'Atendemos en toda la Región Metropolitana, todos los días de 09:00 a 22:00.' },
    ],
  },
  'cremacion-de-perros': {
    slug: 'cremacion-de-perros',
    title: 'Cremación de Perros en Santiago | Alma Animal',
    meta: 'Cremación de perros en Santiago con retiro a domicilio, devolución de cenizas y entrega en 3 días hábiles. Instalaciones propias y trazabilidad. Escríbenos por WhatsApp.',
    h1: 'Cremación de perros en Santiago',
    subtitulo: 'Despide a tu perro con respeto. Retiro a domicilio y entrega de sus cenizas en 3 días hábiles.',
    intro: 'Sabemos lo que significa tu perro para tu familia. En Alma Animal realizamos su cremación con <strong>instalaciones propias</strong> y trazabilidad total, y te devolvemos sus cenizas en un ánfora. Retiro a domicilio en toda la Región Metropolitana.',
    waMsg: 'Hola! Necesito información sobre la cremación de mi perro',
    faqs: [
      { q: '¿Retiran a mi perro en casa?', a: 'Sí, retiramos a domicilio o en la clínica veterinaria, en toda la Región Metropolitana.' },
      { q: '¿Me devuelven las cenizas?', a: 'En la cremación individual te devolvemos las cenizas en un ánfora en 3 días hábiles.' },
      { q: '¿Atienden perros de todo tamaño?', a: 'Sí, atendemos perros de todos los tamaños. Escríbenos y te orientamos según el caso.' },
    ],
  },
  'cremacion-de-gatos': {
    slug: 'cremacion-de-gatos',
    title: 'Cremación de Gatos en Santiago | Alma Animal',
    meta: 'Cremación de gatos en Santiago con retiro a domicilio, devolución de cenizas y entrega en 3 días hábiles. Instalaciones propias y trazabilidad. Escríbenos por WhatsApp.',
    h1: 'Cremación de gatos en Santiago',
    subtitulo: 'Despide a tu gato con respeto. Retiro a domicilio y entrega de sus cenizas en 3 días hábiles.',
    intro: 'Tu gato fue parte de tu familia y merece una despedida a su altura. Realizamos su cremación con <strong>instalaciones propias</strong> y trazabilidad total, con devolución de sus cenizas. Retiro a domicilio en toda la Región Metropolitana.',
    waMsg: 'Hola! Necesito información sobre la cremación de mi gato',
    faqs: [
      { q: '¿Retiran a mi gato en casa?', a: 'Sí, retiramos a domicilio o en la clínica veterinaria, en toda la Región Metropolitana.' },
      { q: '¿Me devuelven las cenizas?', a: 'En la cremación individual te devolvemos las cenizas en un ánfora en 3 días hábiles.' },
      { q: '¿Cómo coordino el retiro?', a: 'Escríbenos por WhatsApp y coordinamos el retiro en el horario que necesites.' },
    ],
  },
}

const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function waLink(msg: string): string {
  return `https://wa.me/${WA}?text=${encodeURIComponent(msg)}`
}

const DIFERENCIADORES = [
  { i: '📦', t: 'Entrega en 3 días hábiles', d: 'Proceso rápido y sin esperas eternas.' },
  { i: '🏭', t: 'Instalaciones propias', d: 'No externalizamos: todo bajo nuestro control en Recoleta.' },
  { i: '🔎', t: 'Trazabilidad total', d: 'Sigues cada etapa del proceso, con certificado.' },
  { i: '🚗', t: 'Retiro a domicilio', d: 'En tu casa o clínica, en toda la RM, de 09:00 a 22:00.' },
]

export function renderLanding(l: Landing): string {
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
<link rel="icon" href="/sitio/assets/6942fb32cec49d2cc665b37f_favicon.png"/>
<script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','${GTM}');</script>
<style>
.lp{font-family:Inter,system-ui,sans-serif;color:#143C64;background:#FBF8F3;margin:0}
.lp-wrap{max-width:1080px;margin:0 auto;padding:0 20px}
.lp-head{display:flex;align-items:center;justify-content:space-between;padding:16px 0}
.lp-head img{height:52px;width:auto}
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
.lp-cta2 h2{margin:0 0 10px;font-size:26px}.lp-cta2 p{margin:0 0 22px;color:#CBD9E6}
.faq{max-width:760px;margin:0 auto;padding:0 0 56px}
.faq h2{text-align:center;font-size:26px;margin:0 0 22px}
.faq details{background:#fff;border:1px solid #E7E0D6;border-radius:14px;padding:16px 20px;margin-bottom:12px}
.faq summary{font-weight:700;cursor:pointer;list-style:none}.faq summary::-webkit-details-marker{display:none}
.faq p{color:#5B7288;line-height:1.6;margin:10px 0 0}
.lp-foot{background:#0B2845;color:#B9C9D8;text-align:center;padding:28px 20px;font-size:13px}
.lp-foot a{color:#F2B84B;text-decoration:none;font-weight:600}
</style>
</head>
<body class="lp">
<noscript><iframe src="https://www.googletagmanager.com/ns.html?id=${GTM}" height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>
<div class="lp-wrap">
  <header class="lp-head">
    <a href="/"><img src="${LOGO}" alt="Crematorio Alma Animal"/></a>
    <a class="cta-sm" href="${wa}" target="_blank" rel="noopener">WhatsApp</a>
  </header>
  <section class="lp-hero">
    <h1>${esc(l.h1)}</h1>
    <p class="sub">${esc(l.subtitulo)}</p>
    <a class="cta" href="${wa}" target="_blank" rel="noopener">💬 Escríbenos por WhatsApp</a>
    <div class="trust">Atención todos los días · 09:00 a 22:00 · Cobertura Región Metropolitana</div>
  </section>
  <p class="lp-intro">${l.intro}</p>
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
  Huellas que no se borran · <a href="/">Ir al sitio</a>
</footer>
<script type="application/ld+json">${JSON.stringify(faqSchema)}</script>
</body></html>`
}
