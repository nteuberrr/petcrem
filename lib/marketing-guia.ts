/**
 * GUÍA DE CONTENIDO (Instagram / Facebook / email / perfil) destilada de la guía
 * maestra 2026 y ADAPTADA a Crematorio Alma Animal. Es la FUENTE DE VERDAD de
 * calidad: estas reglas y checklists alimentan al redactor de piezas, al QA, al
 * generador de email y al orquestador, para que la salida sea consistente.
 *
 * Lo CUANTITATIVO y editable (frecuencia, pilares editoriales, CPA/presupuesto de
 * ads) NO vive acá sino en lib/marketing-params.ts, para poder ajustarlo sin tocar
 * código. Acá van solo las reglas cualitativas estables.
 */

/** Reglas para el redactor/diseñador de piezas sociales (IG/FB). */
export const GUIA_SOCIAL = `GUÍA DE CONTENIDO SOCIAL (Instagram/Facebook 2026 — reglas de calidad, aplicalas):
DIMENSIÓN Y ZONA SEGURA
- Todo el feed en 4:5 vertical (1080x1350). Los elementos críticos (titular, logo, cara del animal, CTA) van en el TERCIO CENTRAL y con 60-80px de aire desde cada borde: el grid del perfil recorta a 3:4 y no debe cortar nada importante.
CAPTION (Instagram funciona como buscador — keywords > hashtags)
- Los primeros ~125 caracteres son el HOOK y tienen que funcionar SOLOS (es lo único visible antes del "…"): la afirmación o el dato más fuerte, sin relleno ("¡Feliz lunes!" prohibido).
- La KEYWORD principal, escrita como la buscaría la gente ("cremación de mascotas en Santiago", "qué hacer cuando fallece tu perro"), en las primeras 2 líneas.
- 3-5 HASHTAGS nicho al final (más de 5 REDUCE el alcance). Específicos: #cremacionmascotas #veterinariasantiago #despedidamascota — nunca genéricos (#amor #mascotas).
- Cerrá con UN CTA claro (guardar / enviar por DM / comentar una palabra / escribir).
CARRUSEL (el formato de mayor engagement — usalo para educar)
- Slide 1 = portada/hook: titular de 5-8 palabras, gatillo de curiosidad que obliga a deslizar; específico y con números gana ("Las 5 preguntas antes de elegir una cremación" > "Tips de cremación"). La slide 2 NO repite la imagen de la 1.
- Slides internas: UNA idea por slide, máx. 15-20 palabras + un ancla visual (foto/ícono). Nada de párrafos.
- Penúltima = resumen/checklist (guardable). Última = UN solo CTA.
- 7-10 slides para contenido educativo; 3-5 para un tip rápido. Sistema visual consistente entre todas.
DISEÑÁ PARA LA SEÑAL QUE BUSCÁS
- Guardados → checklists, guías, precios de referencia, pasos, "qué esperar del proceso". Envíos por DM → algo útil para un tercero ("mándaselo a quien tiene un perro mayor"). Retención → carrusel con narrativa que obliga a seguir.
QUÉ NO PUBLICAR
- Nada gráfico ni sensible: JAMÁS imágenes del proceso de cremación ni de animales fallecidos (el proceso se simboliza con huellas, luz, flores, manos). Sin humor asociado a la pérdida. Sin stock genérico evidente. Sin datos ni fotos de clientes sin consentimiento.`

/** Checklist de validación que usa el QA (director de arte) antes de aprobar. */
export const GUIA_QA = `CHECKLIST DE QA (criterios de validación pre-publicación — revisá la pieza contra esto):
- Lienzo 4:5 (1080x1350) en todas las slides; elementos críticos en el tercio central, nada pegado al borde (aire ≥60px, sobrevive el recorte 3:4 del grid).
- Slide 1: titular 5-8 palabras, específico y con gancho; la slide 2 NO repite la imagen de la slide 1.
- Máx. ~15-20 palabras por slide interior; sin párrafos largos.
- Consistencia visual (paleta/tipografía/layout de marca) entre slides; en carrusel, badges/logo/fondos con un sistema, no al azar.
- Última slide con UN solo CTA claro (no varios CTA compitiendo).
- Texto legible: SIN encimados, sin cortes por el borde, sin cajas rotas, con contraste suficiente (nada de texto claro o dorado sobre una zona clara de la foto sin velo).
- Foto bien encuadrada: cara y ojos del animal visibles y NUNCA cortados por el borde.
- El velo o bloque de color NO corta ni atraviesa a la persona/animal por la mitad. Si el borde del velo le cruza el cuerpo y lo deja "partido" entre la foto y el bloque, es un DEFECTO OBJETIVO: el sujeto tiene que quedar de un lado y el texto del otro (o la foto verse completa con un degradé suave).
- Variedad de color: no todas las slides con fondo navy; alterná crema/blanco/foto — y cuando hay foto, se tiene que VER (sin un velo oscuro que la tape).`

/** Reglas para el generador y el revisor de campañas de email. */
export const GUIA_EMAIL = `GUÍA DE EMAIL (campañas 2026 — reglas de calidad):
ASUNTO Y PREHEADER (definen el 80% del resultado)
- Asunto CORTO y frontal: máximo ~8 palabras (~40 caracteres, para que no se trunque en móvil); en outreach frío a clínicas, 2-4 palabras rinden más (parecen comunicación interna, no campaña). La info clave al inicio.
- PROHIBIDO en el asunto: MAYÚSCULAS sostenidas, "!!!", "GRATIS", "URGENTE", "$$$", "RE:" falso, y prometer algo que el cuerpo no cumple (rompe la confianza y dispara bajas).
- Preheader (~40-90 caracteres): COMPLEMENTA el asunto, no lo repite; es la segunda línea de venta.
DISEÑO (mobile-first, 60-75% se abre en el teléfono)
- Columna única de 600px. 2-4 secciones máximo, párrafos de 2-3 oraciones, espacio en blanco generoso.
- UN solo CTA primario como BOTÓN grande con verbo de acción ("Agendar", "Cotizar", "Sumarme al convenio"); los links secundarios claramente subordinados.
- NUNCA un email que sea 100% una imagen (si no cargan, no se lee y lo penaliza el spam). Alt text en todas las imágenes. Probar dark mode y móvil.
- Footer con dirección física + baja (unsubscribe) visible.
CUERPO
- Hook (la 1ª oración tiene un solo objetivo: que lean la 2ª) → valor en "tú" (beneficios para el lector, no descripción de la empresa) → CTA botón.
- Escribí como si fuera a UNA persona. Concreto > hype. En B2B a clínicas, la métrica reina es la RESPUESTA, no la apertura.`

/** Reglas de perfil/grid/bio para auditar y optimizar IG y FB. */
export const GUIA_PERFIL = `GUÍA DE PERFIL (grid, identidad visual y bio — para auditar/optimizar Instagram y Facebook):
- GRID: un solo formato 4:5 para TODO el feed (nunca mezclar 1:1 / horizontal); coherencia visual de los últimos 9-12 posts vistos como conjunto; portadas de Reels DISEÑADAS (título centrado que sobreviva los recortes), no frames al azar.
- CAMPO "NOMBRE" (pesa fuerte en la búsqueda, es SEO, no decoración): marca + keyword + ubicación → "Alma Animal | Cremación de Mascotas Santiago".
- BIO (150 caracteres, cada palabra cuenta): línea 1 = qué haces y para quién con keyword + ubicación; línea 2 = diferenciador/credibilidad (cobertura RM, atención todos los días, red de clínicas); línea 3 = CTA con flecha al link.
- LINK IN BIO: a una landing de alto valor (cotizador / WhatsApp / convenio), NO a la home genérica. Revisar que no esté roto en cada campaña.
- HIGHLIGHTS como funnel: Sobre nosotros → Cómo funciona → Testimonios → Preguntas frecuentes → Contacto/Cotizar, con portadas del set visual de marca.
- POSTS FIJADOS (3): (a) quiénes somos / cómo funciona, (b) prueba social, (c) oferta o convenio vigente. Actualizarlos con cada campaña.`
