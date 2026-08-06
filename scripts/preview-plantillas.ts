import './_env-preload'
import fs from 'fs/promises'
import path from 'path'
import sharp from 'sharp'
import { construirPlantilla, PLANTILLAS, type SlotsPlantilla, type NombrePlantilla } from '../lib/marketing-plantillas'
import { renderGraficoHTML } from '../lib/grafico-render'
import { listarImagenes } from '../lib/mailing-images'
import { esLogo } from '../lib/marca-logo'

/**
 * CATÁLOGO VISUAL de las plantillas maestras: renderiza TODAS con contenido de
 * muestra y deja los PNG en `.preview-plantillas/` + un index.html para verlas
 * todas juntas.
 *
 *   npx tsx scripts/preview-plantillas.ts            → todas, post_vertical
 *   npx tsx scripts/preview-plantillas.ts story      → en otro formato
 *
 * NO genera fotos con IA (costaría plata y tarda): reutiliza fotos reales del
 * banco para los slots FOTO:*, así se ve exactamente cómo queda cada layout.
 */

const FORMATO = process.argv[2] || 'post_vertical'
const OUT = path.join(process.cwd(), '.preview-plantillas')

/** Contenido de muestra por plantilla — real, del negocio, no "lorem ipsum". */
const MUESTRAS: Record<NombrePlantilla, { titulo: string; slots: SlotsPlantilla }> = {
  portada: {
    titulo: 'Apertura con gancho + foto arriba',
    slots: {
      eyebrow: 'Cremación de mascotas', titulo: 'Una despedida', titulo_destacado: 'como corresponde',
      bajada: 'Retiro a domicilio y desde clínicas, todos los días.', fondo: 'crema',
      cta: '+56 9 7864 0811', foto: {},
    },
  },
  contenido: {
    titulo: 'Una idea + bullets de apoyo',
    slots: {
      eyebrow: 'Cómo trabajamos', titulo: 'Todo bajo', titulo_destacado: 'nuestro control',
      bullets: ['Instalaciones propias, nada se externaliza', 'Trazabilidad de principio a fin', 'Certificado de cremación firmado'],
      fondo: 'navy', foto: {},
    },
  },
  dato: {
    titulo: 'Una cifra que manda',
    slots: { eyebrow: 'Entrega express', dato: '4 días', dato_label: 'hábiles para la entrega', bajada: 'Desde el retiro hasta que sus cenizas vuelven a casa.', fondo: 'navy' },
  },
  foto: {
    titulo: 'Foto protagonista con una frase',
    slots: { titulo: 'Huellas que no se borran', foto: {} },
  },
  cierre: {
    titulo: 'Cierre con llamado a la acción',
    slots: { titulo: 'Estamos', titulo_destacado: 'para acompañarte', bajada: 'Todos los días de 09:00 a 22:00.', cta: '+56 9 7864 0811', cta_secundario: 'crematorioalmaanimal.cl', fondo: 'navy' },
  },
  cita: {
    titulo: 'Frase destacada / testimonio',
    slots: { eyebrow: 'Lo que nos dicen', titulo: 'Nos trataron con un respeto que no esperábamos en un momento así.', bajada: 'María, tutora de Rocky', fondo: 'crema' },
  },
  split: {
    titulo: 'Editorial: foto al lado del texto',
    slots: { eyebrow: 'Para clínicas', titulo: 'Convenio', titulo_destacado: 'veterinario', bullets: ['Retiro coordinado', 'Tarifas preferentes', 'Reporte mensual'], fondo: 'crema', foto: {} },
  },
  numeros: {
    titulo: 'Lista numerada (pasos o razones)',
    slots: { eyebrow: 'El proceso', titulo: 'Tres pasos', bullets: ['Nos llamas y coordinamos el retiro', 'Cremamos con trazabilidad total', 'Te entregamos sus cenizas en casa'], fondo: 'crema' },
  },
  marco: {
    titulo: 'Foto enmarcada estilo galería',
    slots: { titulo: 'Cada mascota tiene su nombre', bajada: 'Y así la tratamos, de principio a fin.', fondo: 'crema', foto: {} },
  },
  revista: {
    titulo: 'NUEVA · Portada editorial (foto a sangre + banda)',
    slots: { eyebrow: 'Alma Animal', titulo: 'El último cuidado', titulo_destacado: 'también es cuidado', bajada: 'Cremación individual con certificado y trazabilidad.', fondo: 'crema', foto: {} },
  },
  diptico: {
    titulo: 'NUEVA · Mitad foto / mitad color, centrado',
    slots: { titulo: 'Gracias por', titulo_destacado: 'tanto', bajada: 'Acompañamos a las familias de Santiago todos los días del año.', fondo: 'navy', foto: {} },
  },
  comparativa: {
    titulo: 'NUEVA · Dos columnas enfrentadas',
    slots: {
      titulo: 'La diferencia', titulo_b: 'Alma Animal',
      bullets: ['Instalaciones propias', 'Entrega en 4 días hábiles', 'Certificado firmado', 'Atención los 7 días'],
      bullets_b: ['Servicio tercerizado', 'Plazos sin fecha', 'Sin comprobante', 'Horario de oficina'],
      fondo: 'crema',
    },
  },
  timeline: {
    titulo: 'NUEVA · Hitos en un riel dorado',
    slots: { eyebrow: 'Qué pasa después de llamarnos', titulo: 'Paso a paso', bullets: ['Coordinamos el retiro a la hora que necesites', 'Retiramos en tu casa o en la clínica', 'Cremación individual con trazabilidad', 'Te entregamos sus cenizas en tu domicilio'], fondo: 'navy' },
  },
  collage: {
    titulo: 'NUEVA · Mosaico de 3 fotos',
    slots: { titulo: 'Cada historia', titulo_destacado: 'es distinta', bajada: 'Perros, gatos y cada familia que los quiso.', fondo: 'crema' },
  },
  faq: {
    titulo: 'NUEVA · Pregunta grande + respuesta',
    slots: { eyebrow: 'Preguntas frecuentes', titulo: '¿Cuánto demora la entrega?', bajada: 'Cuatro días hábiles desde el retiro. Te avisamos cuando salimos a llevártelas y te entregamos el certificado de cremación.', fondo: 'blanco' },
  },
  precio: {
    titulo: 'NUEVA · Tarjeta de plan con cifra',
    slots: {
      eyebrow: 'Cremación individual', titulo: 'Hasta 10 kg', dato: '$120.000', dato_label: 'Todo incluido, sin sorpresas',
      bullets: ['Retiro a domicilio', 'Ánfora de greda', 'Certificado firmado', 'Entrega en 4 días hábiles'],
      cta: 'Cotizar ahora', pie: 'Valor referencial: el precio final depende del peso.', fondo: 'navy',
    },
  },
  arco: {
    titulo: 'NUEVA · Foto en arco + texto abajo',
    slots: { eyebrow: 'Cremación individual', titulo: 'Vuelve a casa contigo', bajada: 'Con su certificado y su ánfora, en cuatro días hábiles.', cta: 'Cotizar ahora', fondo: 'crema', foto: {} },
  },
  bicolor: {
    titulo: 'NUEVA · Lienzo partido, titular a caballo',
    slots: { eyebrow: 'Cobertura RM', titulo: 'Vamos', titulo_destacado: 'donde estés', bullets: ['Retiro en todas las comunas de Santiago', 'Coordinación el mismo día'], cta: '+56 9 7864 0811' },
  },
  checklist: {
    titulo: 'NUEVA · Items en barras con filete',
    slots: { eyebrow: 'Qué incluye', titulo: 'Todo lo que', titulo_destacado: 'necesitas', bullets: ['Retiro a domicilio o en clínica', 'Cremación individual certificada', 'Ánfora de greda incluida', 'Entrega en tu casa'], fondo: 'navy' },
  },
  mosaico_datos: {
    titulo: 'NUEVA · Grilla 2×2 de cifras',
    slots: {
      titulo: 'Alma Animal', titulo_destacado: 'en números',
      datos: [
        { valor: '4 días', label: 'Entrega express' }, { valor: '09–22', label: 'Todos los días' },
        { valor: '100%', label: 'Cremación individual' }, { valor: 'RM', label: 'Cobertura completa' },
      ],
      pie: 'Datos de operación 2026.', fondo: 'crema',
    },
  },
  testimonio: {
    titulo: 'NUEVA · Avatar redondo + cita',
    slots: { titulo: 'Nos avisaron en cada paso. Saber dónde estaba mi perro en todo momento fue lo que más me tranquilizó.', bajada: 'Carolina, tutora de Simón', fondo: 'blanco', foto: {} },
  },
  horario: {
    titulo: 'NUEVA · Filas clave → valor',
    slots: {
      eyebrow: 'Disponibilidad', titulo: 'Cuándo', titulo_destacado: 'nos encuentras',
      filas: [
        { izq: 'Lunes a viernes', der: '09:00–22:00' }, { izq: 'Sábados y domingos', der: '09:00–22:00' },
        { izq: 'Retiro a domicilio', der: 'Todo Santiago' }, { izq: 'Entrega de cenizas', der: '4 días hábiles' },
      ],
      pie: 'Coordinamos el retiro el mismo día que nos llamas.', fondo: 'navy',
    },
  },
  overlay: {
    titulo: 'NUEVA · Foto a sangre + tarjeta flotante',
    slots: { eyebrow: 'Retiro a domicilio', titulo: 'No tienes', titulo_destacado: 'que moverte', bajada: 'Vamos a tu casa o a la clínica a la hora que necesites.', cta: '+56 9 7864 0811', fondo: 'crema', foto: {} },
  },
  tipografico: {
    titulo: 'NUEVA · Póster de una palabra',
    slots: { eyebrow: 'Crematorio Alma Animal', titulo: 'Huellas', titulo_destacado: 'que no se borran', bajada: 'Cremación de mascotas en Santiago, todos los días.', fondo: 'navy' },
  },
  memorial_medallon: {
    titulo: 'MEMORIAL · Medallón circular dorado',
    slots: { eyebrow: 'En memoria', titulo: 'Simón', fechas: '2013 — 2026', bajada: 'Gracias por cada vuelta a la manzana.', fondo: 'navy', foto: {} },
  },
  memorial_polaroid: {
    titulo: 'MEMORIAL · Instantánea de papel',
    slots: { titulo: 'Simón', fechas: '2014 — 2026', bajada: 'El que se subía a la mesa apenas mirábamos para otro lado.', foto: {} },
  },
  memorial_susurro: {
    titulo: 'MEMORIAL · Manda la dedicatoria',
    slots: { titulo: 'Kira', fechas: '2015 — 2026', bajada: 'Nos enseñó que la casa no es un lugar, son los que te esperan en ella.', foto: {} },
  },
  memorial_silueta: {
    titulo: 'MEMORIAL · Velo navy + nombre gigante',
    slots: { eyebrow: 'En memoria', titulo: 'Maya', fechas: '2016 — 2026', foto: {} },
  },
  memorial_diptico: {
    titulo: 'MEMORIAL · Mitad foto / mitad texto + banda',
    slots: { eyebrow: 'Hasta siempre', titulo: 'Pelusa', fechas: '2011 — 2026', bajada: 'Quince años durmiendo en el mismo rincón del sillón.', foto: {} },
  },
}

async function main() {
  await fs.mkdir(OUT, { recursive: true })
  const banco = await listarImagenes().catch(() => [])
  const logos = banco.filter(esLogo)
  const logoBlanco = logos.find(l => /blanc|white/i.test(`${l.descripcion} ${l.tags}`))?.url || logos[0]?.url
  const logoNavy = logos.find(l => /navy|azul/i.test(`${l.descripcion} ${l.tags}`))?.url || logos[0]?.url

  // Fotos reales del banco para los slots (sin gastar en generación IA).
  const mascotas = banco.filter(i => i.grupo === 'mascotas' && i.url && !esLogo(i)).map(i => i.url)
  if (!mascotas.length) console.warn('⚠ El banco no tiene fotos del grupo "mascotas": las plantillas con foto saldrán vacías.')
  const fotoRota = (n: number) => mascotas[n % Math.max(1, mascotas.length)] || ''

  const hechas: { nombre: string; titulo: string; archivo: string; w: number; h: number }[] = []
  let usadas = 0
  for (const nombre of PLANTILLAS) {
    const m = MUESTRAS[nombre]
    try {
      const { html, fotos } = construirPlantilla(nombre, m.slots, { formato: FORMATO, logoBlanco, logoNavy })
      // Sustituir los placeholders FOTO:slot por fotos reales del banco.
      let final = html
      for (const f of fotos) final = final.split(`FOTO:${f.slot}`).join(fotoRota(usadas++))
      const w = parseInt(final.match(/width:(\d+)px/)?.[1] || '1080', 10)
      const h = parseInt(final.match(/height:(\d+)px/)?.[1] || '1350', 10)
      const { buffer } = await renderGraficoHTML({ html: final, width: w, height: h })
      const archivo = `${nombre}.png`
      await fs.writeFile(path.join(OUT, archivo), buffer)
      hechas.push({ nombre, titulo: m.titulo, archivo, w, h })
      console.log(`✓ ${nombre}`)
    } catch (e) {
      console.error(`✗ ${nombre}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  // Miniaturas + index.html para verlas todas juntas.
  const cards: string[] = []
  for (const h of hechas) {
    const thumb = await sharp(path.join(OUT, h.archivo)).resize({ width: 460 }).jpeg({ quality: 82 }).toBuffer()
    cards.push(`<figure><img src="data:image/jpeg;base64,${thumb.toString('base64')}" alt="${h.nombre}"><figcaption><b>${h.nombre}</b><br>${h.titulo}</figcaption></figure>`)
  }
  const index = `<!doctype html><meta charset="utf-8"><title>Plantillas Alma Animal</title>
<style>body{background:#143C64;color:#fff;font:15px/1.4 system-ui;margin:0;padding:32px}
h1{font-size:24px;margin:0 0 24px}main{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:28px}
figure{margin:0}img{width:100%;border-radius:10px;display:block}figcaption{margin-top:8px;font-size:13px;color:#e8eef5}</style>
<h1>Plantillas maestras — ${hechas.length} de ${PLANTILLAS.length} (${FORMATO})</h1><main>${cards.join('')}</main>`
  await fs.writeFile(path.join(OUT, 'index.html'), index, 'utf8')
  console.log(`\n${hechas.length}/${PLANTILLAS.length} renderizadas → ${OUT}\\index.html`)
}

main().catch(e => { console.error(e); process.exit(1) })
