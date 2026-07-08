# Plan: Agente de gestión de Google Ads de principio a fin

> Aprobado 2026-07-07. Primera tanda = **Fases A + B**. Fuente: 8 guías de un experto
> (docx en `C:\Users\Nicolas\Downloads\Nueva carpeta (2)`; textos extraídos en el
> scratchpad de la sesión bajo `gads-docs/`) + auditoría real de la cuenta corrida
> con `scripts/audit-gads-quick.ts` (dejar ese script: es la semilla de la Fase B).

## Contexto: qué existe ya (no rehacer)

- **Conexión total a la API** (v23, REST/GAQL): `lib/google-ads.ts` con lecturas
  (`resumenCampanas`, `listarKeywords` con resourceName/status, `terminosBusqueda` con
  campanaId, `listarCampanasGestion` con presupuesto/compartido) y escrituras probadas
  (`pausar/activarCampanaGoogle`, `ajustarPresupuestoGoogle` — bloquea presupuestos
  compartidos, `pausar/activarKeywordGoogle`, `agregarNegativaCampana` phrase a nivel
  campaña). `gaqlMutate` soporta `validateOnly` (dry-run real de Google — usarlo para
  probar toda mutación nueva antes de habilitarla).
- **Credenciales**: 7 vars `GOOGLE_ADS_*` en `.env.local` **y** en Vercel prod.
  MCC 8495609209, cuenta operativa 8650361913. OAuth app en modo "Prueba" → si aparece
  `invalid_grant`, correr `scripts/google-ads-refresh-token.ts` y actualizar env local+Vercel.
- **Panel** en Campañas → Métricas (`GoogleAdsPanel` en `app/(dashboard)/mailing/page.tsx`):
  KPIs, campañas con pausar/activar + presupuesto inline, keywords con pausar/activar,
  términos con botón 🚫 Negativa. API: `/api/mailing/google-ads` (GET datos, POST acciones).
- **Agente de marketing** (`lib/marketing-agente.ts`, chat en Campañas → Agente): 18 tools,
  ninguna de Google Ads (solo Meta vía `reporte_metricas`). Conoce voz de marca,
  diferenciadores y precios.
- **Meta Ads**: lectura + gestión ya deployadas (no tocar).

## Hallazgos de la auditoría real (2026-07-07) — el agente debe detectarlos

1. **Eutanasia usa TARGET_SPEND (Maximize Clicks)** — playbook: Max Conversions →
   +tCPA a las 30 conv/30d → tROAS a las 50 conv con valores. Es la 2ª campaña en gasto.
2. **Valores de conversión incoherentes**: `Join Chat`=$10.000 (primary), `Calls from ads`=$1
   (primary), `Clicks to call`=$1 (primary), `Click Mail/Teléfono/Whatsapp Footer`=$2.000,
   `Escríbenos ahora`=$4.000 → una llamada "vale" $1 vs chat $10.000: Smart Bidding
   distorsionado. Corregible por API (`ConversionActionService`, `value_settings`).
3. **RSAs con 13-14 headlines (no 15) y 0 pinned** → keyword no garantizada en slot 1;
   Ad Strength GOOD (no EXCELLENT) en Cremación y Eutanasia.
4. **Cremación apunta a la HOME** de crematorioalmaanimal.cl; pierde **45% de impresiones
   por ranking** (IS 39%); Eutanasia pierde 50%; Marca pierde 16% **por presupuesto** con
   QS 10 y CPC $502 (la plata barata).
5. **Keywords basura activas**: "happy", "cuanto", "valor", "vacuna", "sale", "curico",
   "buin zoo", "eutanasia gatos argentina", "la eutanasia en gatos es dolorosa" (broad
   genéricas de 1 palabra / informacionales / geo equivocada; todas sin QS = sin datos).
6. **2.010 negativas a nivel campaña, 0 listas compartidas.** Assets: 23 sitelinks,
   7 callouts (recomendado 8-12), 3 snippets.
7. Lo BUENO (no alarmar): Search Partners OFF, Display OFF, geo PRESENCE only,
   QS 7-10 en las keywords principales, "crematorio alma animal" QS 10.

## Decisiones del dueño

- Primera tanda: **A + B**. C/D/E después, por tandas.
- El sitio público crematorioalmaanimal.cl está en **Webflow** y se **migrará a Petcrem**
  (proyecto futuro separado). Las **landing pages dedicadas por keyword** (fix del
  hallazgo 4) se harán EN ESTE repo como parte de esa migración (tanda 2); el form de la
  LP podrá crear el lead directo en el sistema.
- El repo `alma-animal-marketing` está **dado de baja** — no referenciarlo. La marca
  canónica vive en `lib/email-layout.ts` (BRAND) y `lib/marca-visual.ts`.

---

## FASE A — Cerebro + agente conversacional (tanda 1)

### A.1 `lib/google-ads-guia.ts` (nuevo) — los 8 docs destilados, en español de Chile

Bloques exportados (mismo patrón que `lib/marketing-guia.ts`):

- `GUIA_GADS_ESTRUCTURA` — los "9 defaults" correctos: Search only (sin Display/Search
  Partners/PMax), bidding según playbook, schedule, Presence-only, exclusión de países,
  sin audiencias en Search, auto-applied recommendations SIEMPRE OFF, ad rotation Optimize.
  + los "prompts de Google a rechazar" (AI Max, DSA, auto-assets, broad inclusion...).
- `GUIA_GADS_BIDDING` — playbook: MaxConv sin target → +tCPA con 30 conv/30d →
  MaxConvValue+tROAS con 50 conv y valores coherentes. No tocar la estrategia por 14 días
  tras un cambio. Presupuesto diario ≈ 3-5× el CPA objetivo.
- `GUIA_GADS_RSA` — anatomía: 15 headlines (≤30 chars) con 3 variantes de keyword
  **pinned slot 1** (solo slot 1 — dual-pin pierde 10-15%), 4 descripciones (≤90, ideal
  61-70), 6 ángulos (keyword/oferta/confianza/urgencia/garantía/CTA), reglas editoriales
  duras (máx 1 «!» por aviso y nunca en headlines, sin MAYÚSCULAS sostenidas, sin
  símbolos/emoji, sin superlativos sin prueba, sin teléfonos en el texto).
- `GUIA_GADS_ASSETS` — sitelinks 4-8 (título 12-15 chars, página distinta c/u, nada de
  "Ver más"), callouts 8-12 (diferenciados, no repetir headlines), snippets 2 headers
  (Servicios/Tipos), business name+logo. Con los specs de caracteres.
- `GUIA_GADS_NEGATIVAS` — lista universal **ES-CL adaptada al rubro** (~100-150 términos:
  empleo/trabajo/sueldo/cuánto gana/curso/certificación/escuela veterinaria/como cremar/
  hazlo tú mismo/gratis/segunda mano/wikipedia/que significa/…) + **NO-negativar**
  (precio, valor, cuánto cuesta, cotización, cerca de mí, urgente, mejor — son alta
  intención; en los términos reales de la cuenta "crematorio de mascotas valor" convierte).
  + criterio shared-list (intención mala universal) vs campaña (geo/intención específica).
- `GUIA_GADS_TERMINOS` — workflow términos sangrantes: candidato = ≥100 impresiones
  (nunca <50) + ≥$10.000 CLP gastados sin conversión; verdicto BAD/KEEP/UNCERTAIN según
  intención (empleo/DIY/informacional/geo = BAD; páginas de competidores del rubro =
  KEEP); SIEMPRE mostrar la tabla y esperar aprobación; UNCERTAIN requiere sí explícito
  término por término; phrase match por defecto.
- `GUIA_GADS_QS` — QS = CTR esperado + relevancia del aviso + experiencia de la LP;
  qué mueve cada uno; Ad Strength ≠ QS.

### A.2 Herramientas Google Ads en el agente de marketing (`lib/marketing-agente.ts`)

Nuevas tools (handlers llaman a `lib/google-ads.ts`, ampliado según A.3):

| Tool | Tipo | Qué hace |
|---|---|---|
| `gads_resumen` | lectura | campañas + KPIs + presupuestos + Impression Share (periodo param) |
| `gads_keywords` | lectura | keywords con QS, gasto, estado |
| `gads_terminos` | lectura | términos de búsqueda con campanaId (para el workflow de negativas) |
| `gads_auditar` | lectura | corre la auditoría de Fase B y devuelve hallazgos con $ |
| `gads_pausar_campana` / `gads_activar_campana` | escritura | requiere param `confirmado: true` |
| `gads_presupuesto` | escritura | monto CLP diario; bloquea compartidos; `confirmado: true` |
| `gads_keyword_estado` | escritura | pausar/activar keyword; `confirmado: true` |
| `gads_negativa` | escritura | agrega negativa(s) phrase a campaña; `confirmado: true` |

**Confirmation gate (regla dura, patrón de los docs):** el system prompt instruye — antes
de CUALQUIER escritura, el agente resume la acción exacta ("Voy a pausar X que gastó $Y
este mes, ¿procedo?") y solo llama la tool con `confirmado: true` después de un sí
explícito del usuario en el chat. Las tools rechazan `confirmado != true`. Nunca
escrituras en cadena sin confirmar cada una (o el lote explícito).

Inyectar en el systemPrompt del agente: `GUIA_GADS_*` relevantes + una nota de contexto
de cuenta (nombres/ids de campañas se leen en vivo, no hardcodear).

### A.3 Ampliar `lib/google-ads.ts` (lecturas que faltan)

- `listarKeywords`: agregar `ad_group_criterion.quality_info.quality_score` (+ sub-scores
  si se quiere: creative_quality_score, post_click_quality_score, search_predicted_ctr).
- `resumenCampanas` o función nueva: `metrics.search_impression_share`,
  `search_budget_lost_impression_share`, `search_rank_lost_impression_share`,
  `metrics.conversions_value`, costo/conversión.
- `listarConversionActions()`: nombre, categoría, tipo, primary_for_goal, default_value.
- `listarAds()`: por ad group — headlines (count + pinned), descripciones, ad_strength,
  final_urls.
- `contarAssets()`: sitelink/callout/snippet.
- (Opcional para B-acción) `actualizarValorConversion(resourceName, valor)` — mutación
  `conversionActions:mutate` con updateMask `value_settings.default_value`; probar con
  `validateOnly` primero como siempre.

## FASE B — Auditoría con $ recuperable (tanda 1)

### B.1 `lib/google-ads-audit.ts` (nuevo)

`auditarCuenta(): Promise<Hallazgo[]>` con
`Hallazgo = { id, severidad: 'alta'|'media'|'baja', area, titulo, detalle, accionSugerida,
dolaresEstimados?: number, accionAplicable?: {...} }`.

Checks (basados en los docs + lo detectado):
1. **Bidding vs playbook**: campaña con TARGET_SPEND/clicks teniendo conversiones →
   sugerir MaxConversions (con el dato de conversiones 30d para decidir tCPA).
2. **Coherencia de valores de conversión**: primary actions con valor 1 o valores con
   ratio >10x entre acciones equivalentes → listar y sugerir valores (valor lead =
   ticket × tasa de cierre; preguntar al dueño los números — NO inventarlos).
3. **RSAs**: headlines <15, pinned == 0, ad_strength != EXCELLENT, final_url == home.
4. **Assets**: callouts <8, snippets <2 headers, sitelinks <4 por campaña.
5. **Keywords basura**: activas broad de 1 palabra genérica (lista heurística: cuanto,
   valor, coste, vacuna, sale, happy, opiniones, requisitos, cuando, consiste, sufre,
   medicamento[s]…), geo incorrecta (argentina, curico si no se sirve), informacionales
   ("es dolorosa", "aplicar…"). Acción: pausarlas (con confirmación).
6. **Impression share**: budget_lost > 10% → "sube presupuesto de X en ~$Y/día"
   ($ recuperable ≈ gasto × budget_lost/IS); rank_lost > 30% → explica QS/LP (y referencia
   a la tanda 2 de landing pages).
7. **Config**: search partners/display ON (hoy OK, vigilar), geo != PRESENCE,
   sin exclusión de países (ver si agregar), listas compartidas == 0 (referir a Fase C).
8. **Higiene**: campañas ENABLED con gasto 0 en 30d, keywords ENABLED con 0 impresiones.

Estimación $: best-effort, marcar como estimado. Orden: severidad + $ desc.

### B.2 API + UI

- `GET /api/mailing/google-ads/audit` (admin-total; mismo módulo mailing del proxy —
  el prefijo ya cubre subrutas, verificar).
- UI en `GoogleAdsPanel`: card "Auditoría de cuenta" con botón "Auditar ahora" →
  hallazgos con semáforo (🔴🟠🟢), $ estimado, acción sugerida; donde la acción sea
  segura y esté implementada (pausar keyword basura, ajustar presupuesto), botón directo
  con `window.confirm` (mismo patrón del panel actual).
- El chat del agente usa la misma auditoría vía `gads_auditar` y puede ejecutar las
  correcciones conversacionalmente (con el gate).

### Verificación de la tanda 1

1. `npm run build` verde + tsc.
2. Toda mutación nueva probada primero con `validateOnly: true` contra la cuenta real.
3. Script temporal que ejercite los handlers de las tools (lectura real, escrituras solo
   validateOnly), luego borrarlo.
4. Probar el chat en local: "¿cómo va google ads?", "audita la cuenta", "pausa la keyword
   happy" (flujo de confirmación completo).
5. Deploy solo con OK del dueño (commit → push → `npx vercel deploy --prod --yes`).

---

## BACKLOG (tandas siguientes, en orden)

### Fase C — Negativas pro
- Lista universal ES-CL como **shared negative list** por API (`sharedSets` +
  `sharedCriteria` + `campaignSharedSets`) adjunta a todas las campañas; dedupe contra
  las 2.010 existentes.
- Workflow términos sangrantes completo en el chat (candidatos → verdictos → tabla →
  aprobación → alta en lote → log en una nota/registro).

### Fase D — Creación
- Generador de RSAs ES: usa GUIA_GADS_RSA + voz de marca + **linter editorial
  determinista** (límites 30/90, exclamaciones, caps, símbolos, superlativos, teléfonos)
  estilo `marketing-lint`; crea los avisos **PAUSED** vía `adGroupAds:mutate`; el dueño
  revisa en el panel/UI de Google y activa.
- Completar callouts a 10-12 y snippets (Servicios/Tipos) en español.
- Wizard "campaña nueva" (SKAG): las 7 preguntas del doc (servicio, geo, presupuesto,
  CPA objetivo, URL) → resumen → confirmación → crea TODO en PAUSED (budget, campaña
  Search-only, geo presence + exclusión de países, idioma es, negativas, ad group,
  keyword phrase, 3 RSAs).

### Fase E — Panel robusto
- QS por keyword e Impression Share/perdido en el panel (ya leídos para B, exponerlos).
- Costo/conversión y valor/conversión por campaña; comparación vs período anterior.
- Detección de `invalid_grant` → banner "token vencido: correr
  scripts/google-ads-refresh-token.ts".

### Tanda 2 (proyecto aparte) — Migración del sitio Webflow a Petcrem + LPs
- Reconstruir crematorioalmaanimal.cl como páginas Next.js públicas en este repo
  (patrón de los landings de convenios existentes), apuntar el dominio a Vercel.
- **Landing pages dedicadas por keyword** (`/cremacion-de-mascotas`, `/eutanasia-a-domicilio`):
  H1 = keyword exacta, tap-to-call, form ≤4 campos que crea lead en el sistema
  (borrador/aviso WhatsApp), carga <2s, señales de confianza arriba. Actualizar
  final_urls de los ads. Gtag/conversiones controlados por nosotros.
- Es el fix del hallazgo mayor (45-50% de impresiones perdidas por ranking).

## Guardrails permanentes

- Nada se crea/activa sin quedar **PAUSED** + confirmación del dueño.
- Toda escritura del agente exige confirmación explícita en el chat (param `confirmado`).
- Nunca activar recomendaciones automáticas de Google ni AI Max/DSA/broad-inclusion.
- Mutaciones nuevas: primero `validateOnly: true` contra la cuenta real.
- No inventar valores de negocio (valor de lead, CPA objetivo): preguntarlos.
