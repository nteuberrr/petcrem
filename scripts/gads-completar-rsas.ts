/**
 * Completa los 3 RSA heredados que quedaron fuera del estándar de la casa
 * (GUIA_GADS_RSA): 13-14 titulares y 0 pinneados. Los edita EN SITIO con
 * `actualizarRSA`, así conservan su id y su historial — no crea anuncios nuevos.
 *
 * Además corrige datos que violan REGLAS_INVIOLABLES (lib/marca-voz.ts) y que
 * venían corriendo en vivo:
 *   - "Retiramos dentro de 2 hrs." / "24 hrs." → el plazo OFICIAL es "menos de 3 horas".
 *   - "Entrega en Máx. 3 Días"            → el plazo OFICIAL es "4 días hábiles".
 *   - "Profesional 24/7" (Eutanasia)      → el horario real es todos los días 09:00-22:00.
 *   - "Eutanasia Veteneria" (Marca)       → typo de "Veterinaria".
 *   - "El Servicio + Rápido de la R.M"    → superlativo sin prueba (Google lo puede rechazar).
 *
 * Uso:  npx tsx scripts/gads-completar-rsas.ts           (dry-run: lint + validateOnly)
 *       npx tsx scripts/gads-completar-rsas.ts --aplicar (aplica de verdad)
 *
 * Para REVERTIR: el contenido original de cada anuncio quedó registrado en el bloque
 * ORIGINALES de abajo — volver a correr con esos arrays.
 */
import './_env-preload'
import { actualizarRSA } from '../lib/google-ads'
import { lintRSA } from '../lib/google-ads-rsa-lint'

interface Plan {
  nombre: string
  adResourceName: string
  headlines: { texto: string; pinnedSlot1?: boolean }[]
  descriptions: string[]
}

/* ORIGINALES (2026-07-27, por si hay que revertir):
 * Cremación de Mascotas (ads/785491846545) — 13 titulares, 0 pins:
 *   Crematorio de Mascotas | Crematorio Alma Animal | Cuidamos Cada Detalle |
 *   Cremación de Mascotas en la RM | Precios desde los $60.000 | Te Orientamos Gratuitamente |
 *   Retiramos dentro de 2 hrs. | Servicios Personalizados | El Servicio + Rápido de la R.M |
 *   Todo Tipo de Mascotas | Serv. Individuales y Premium | Ánfora Conmemorativa Incluida |
 *   Trazabilidad y Seguridad
 *   D3: Cotiza Nuestros Servicios y Agenda una Hora. Pasaremos por tu Mascota dentro de 2 hrs.
 *   D4: Una Despedida Respetuosa para tu Mascota con Retiro en Domicilio y Entrega en Máx. 3 Días
 * Marca (ads/803418725719) — igual que el anterior salvo "Retiramos dentro de 24 hrs." y
 *   D2: Crematorio Alma Animal. Cremación Individual, Premium y Eutanasia Veteneria a Domicilio.
 *   D3: ... Pasaremos por tu Mascota dentro de 24 hrs.
 * Eutanasia (ads/792870877163) — 14 titulares, 0 pins:
 *   Eutanasia de Mascotas | Eutanasia para Perros | Eutanasia para Gatos | Eutanasia y Cremación |
 *   Te Orientamos Gratuitamente | Servicios Dentro de 24 hrs. | Todo Tipo de Mascotas |
 *   Acompañamiento Veterinario | Despedida Digna y Respetuosa | Atención Profesional y Humana |
 *   Servicio de Eutanasia Animal | Crematorio Alma Animal | Contáctanos y Agenda Aquí |
 *   Servicios a Domicilio
 *   D1: Servicio Humano y Respetuoso. Precios Accesibles, Atención Amable y Profesional 24/7.
 */

const PLANES: Plan[] = [
  {
    nombre: 'Búsqueda - Cremación / Cremación de Mascotas',
    adResourceName: 'customers/8650361913/ads/785491846545',
    headlines: [
      // 1-3: keyword + ubicación, PINNEADOS en slot 1 (relevancia → Quality Score).
      { texto: 'Crematorio de Mascotas', pinnedSlot1: true },
      { texto: 'Cremación de Mascotas en la RM', pinnedSlot1: true },
      { texto: 'Cremación Mascotas Santiago', pinnedSlot1: true },
      // 4-15: libres, cubriendo los 6 ángulos.
      { texto: 'Crematorio Alma Animal' },
      { texto: 'Cuidamos Cada Detalle' },
      { texto: 'Precios desde los $60.000' },
      { texto: 'Te Orientamos Gratuitamente' },
      { texto: 'Retiro en Menos de 3 Horas' },
      { texto: 'Servicios Personalizados' },
      { texto: 'Instalaciones Propias en la RM' },
      { texto: 'Todo Tipo de Mascotas' },
      { texto: 'Serv. Individuales y Premium' },
      { texto: 'Ánfora Conmemorativa Incluida' },
      { texto: 'Trazabilidad y Seguridad' },
      { texto: 'Agenda tu Retiro por WhatsApp' },
    ],
    descriptions: [
      'Servicio Transparente y Respetuoso. Precios Accesibles, Atención Amable y Personalizada.',
      'Crematorio de Mascotas con Servicios Individuales y Grupales. Contáctanos y Agenda Aquí.',
      'Cotiza Nuestros Servicios y Agenda una Hora. Retiramos tu Mascota en Menos de 3 Horas.',
      'Despedida Respetuosa para tu Mascota. Retiro a Domicilio y Entrega en 4 Días Hábiles.',
    ],
  },
  {
    nombre: 'Búsqueda - Marca / Marca',
    adResourceName: 'customers/8650361913/ads/803418725719',
    headlines: [
      // En la campaña de marca los pins son variantes del NOMBRE, no del servicio.
      { texto: 'Crematorio Alma Animal', pinnedSlot1: true },
      { texto: 'Crematorio Alma Animal RM', pinnedSlot1: true },
      { texto: 'Alma Animal Cremaciones', pinnedSlot1: true },
      { texto: 'Crematorio de Mascotas' },
      { texto: 'Cuidamos Cada Detalle' },
      { texto: 'Cremación de Mascotas en la RM' },
      { texto: 'Precios desde los $60.000' },
      { texto: 'Te Orientamos Gratuitamente' },
      { texto: 'Retiro en Menos de 3 Horas' },
      { texto: 'Servicios Personalizados' },
      { texto: 'Instalaciones Propias en la RM' },
      { texto: 'Todo Tipo de Mascotas' },
      { texto: 'Serv. Individuales y Premium' },
      { texto: 'Ánfora Conmemorativa Incluida' },
      { texto: 'Trazabilidad y Seguridad' },
    ],
    descriptions: [
      'Servicio Transparente y Respetuoso. Precios Accesibles, Atención Amable y Personalizada.',
      'Crematorio Alma Animal. Cremación Individual, Premium y Eutanasia Veterinaria a Domicilio.',
      'Cotiza Nuestros Servicios y Agenda una Hora. Retiramos tu Mascota en Menos de 3 Horas.',
      'Despedida Respetuosa para tu Mascota. Retiro a Domicilio y Entrega en 4 Días Hábiles.',
    ],
  },
  {
    nombre: 'Búsqueda - Eutanasia / Eutanasia',
    adResourceName: 'customers/8650361913/ads/792870877163',
    headlines: [
      { texto: 'Eutanasia de Mascotas', pinnedSlot1: true },
      { texto: 'Eutanasia a Domicilio RM', pinnedSlot1: true },
      { texto: 'Eutanasia Mascotas Santiago', pinnedSlot1: true },
      { texto: 'Eutanasia para Perros' },
      { texto: 'Eutanasia para Gatos' },
      { texto: 'Eutanasia y Cremación' },
      { texto: 'Te Orientamos Gratuitamente' },
      { texto: 'Atención Todos los Días' },
      { texto: 'Todo Tipo de Mascotas' },
      { texto: 'Acompañamiento Veterinario' },
      { texto: 'Despedida Digna y Respetuosa' },
      { texto: 'Atención Profesional y Humana' },
      { texto: 'Crematorio Alma Animal' },
      { texto: 'Contáctanos y Agenda Aquí' },
      { texto: 'Servicios a Domicilio' },
    ],
    descriptions: [
      'Servicio Humano y Respetuoso. Precios Accesibles, Atención Profesional Todos los Días.',
      'Eutanasia y Cremación de Mascotas en la Región Metropolitana. Contáctanos y Agenda Aquí.',
      'Servicio de Eutanasia para Mascotas a Domicilio. Acompañamiento Veterinario y Cremación.',
      'Te Acompañamos con Una Despedida Respetuosa y Digna para tu Mascota. Escríbenos Aquí.',
    ],
  },
]

async function main() {
  const aplicar = process.argv.includes('--aplicar')
  let fallas = 0

  for (const p of PLANES) {
    console.log(`\n### ${p.nombre}`)
    const hallazgos = lintRSA({ headlines: p.headlines, descriptions: p.descriptions })
    if (hallazgos.length) {
      fallas++
      console.log('  LINT FALLÓ:')
      for (const h of hallazgos) console.log(`   - [${h.campo}] ${h.problema}`)
      continue
    }
    console.log(`  lint OK · ${p.headlines.length} titulares (${p.headlines.filter(h => h.pinnedSlot1).length} pinneados) · ${p.descriptions.length} descripciones`)
    p.headlines.forEach((h, i) => console.log(`   H${String(i + 1).padStart(2)}${h.pinnedSlot1 ? ' 📌' : '   '} ${h.texto.padEnd(31)}(${h.texto.length})`))
    p.descriptions.forEach((d, i) => console.log(`   D${i + 1}     ${d} (${d.length})`))

    try {
      await actualizarRSA(p.adResourceName, { headlines: p.headlines, descriptions: p.descriptions }, !aplicar)
      console.log(aplicar ? '  ✅ APLICADO en Google Ads' : '  ✔ validateOnly OK (no se aplicó nada)')
    } catch (e) {
      fallas++
      console.log(`  ❌ ${(e as Error).message}`)
    }
  }

  console.log(fallas ? `\n${fallas} anuncio(s) con problemas.` : `\nTodo OK.${aplicar ? '' : ' Correr con --aplicar para escribir en Google Ads.'}`)
  if (fallas) process.exit(1)
}

main().catch(e => { console.error(e); process.exit(1) })
