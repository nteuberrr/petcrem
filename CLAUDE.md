@AGENTS.md

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## ⚠️ Next.js version

This project uses **Next.js 16.2.4** (App Router) with **React 19.2.4** and **Tailwind v4**. APIs and conventions may differ from older Next.js versions in your training data. When uncertain about a Next.js API, check `node_modules/next/dist/docs/` before writing code. See [AGENTS.md](AGENTS.md).

## Commands

```bash
npm run dev     # next dev (Turbopack)
npm run build   # next build
npm run start   # next start (production)
npm run lint    # eslint
```

There is no test suite. Type errors surface via `tsc` during `next build`.

Key deps worth knowing: **`zod`** for runtime validation (use this instead of hand-rolled checks), **`xlsx-js-style`** (not vanilla `xlsx`) for Excel exports — required for the colored-cell styling in rendiciones/reportes, **`@aws-sdk/client-s3`** for the Cloudflare R2 client in [lib/cloudflare-r2.ts](lib/cloudflare-r2.ts) (R2 is S3-compatible), **`@signpdf/signpdf` + `@signpdf/signer-p12` + `@signpdf/placeholder-pdf-lib` + `node-forge`** for PKCS#7 (PAdES) digital signing of cremation certificates in [lib/sign-pdf.ts](lib/sign-pdf.ts), **`resend`** for the mailing module (HTML campaigns, batch send capped at 100) and **`standardwebhooks`** for verifying Resend's signed webhook events. The **Google Maps/Places** APIs (geocoding + address autocomplete) are wrapped in [lib/google-maps.ts](lib/google-maps.ts) with results cached in the `geocoding_cache` sheet. **`date-fns`** is available but most date handling goes through [lib/dates.ts](lib/dates.ts).

## Database: Google Sheets, not SQL

The "database" is a single Google Sheet (`GOOGLE_SPREADSHEET_ID`) accessed via a Service Account JWT. Sheets, one per entity: `clientes`, `ciclos`, `cargas_petroleo`, `vehiculo_cargas`, `despachos`, `rendiciones`, `pagos_rendicion`, `descuentos`, `veterinarios`, `informes_veterinaria`, `precios_generales` / `precios_convenio` / `precios_especiales`, `productos`, `especies`, `tipos_servicio`, `otros_servicios`, `usuarios`, `certificados` (audit log of emitted PDFs — `pdf_key` / `pdf_url` point at R2), the asistencia cluster (`asistencia`, `jornada_config`, `retiros_adicionales`, `pagos_retiros`), the mailing cluster (`mailing_veterinarios`, `mailing_campanas`, `mailing_logs` — `mailing_logs.resend_message_id` is the join key the Resend webhook uses to reconcile open/click/bounce events back to a campaign), the eutanasias cluster (`vet_convenio_eutanasia`, `precios_eutanasia`, `cotizaciones_eutanasia`, `cotizaciones_eutanasia_envios` — see the dedicated section below), `geocoding_cache` and `empresa_config`. The canonical schema lives in [app/api/init-sheets/route.ts](app/api/init-sheets/route.ts) — when adding a column or sheet, update that map and the consuming API route together.

All Sheets I/O goes through [lib/google-sheets.ts](lib/google-sheets.ts). Key conventions:

- **`getSheetData(name)`** returns rows as `Record<string,string>` keyed by the row-1 headers. Reads use `UNFORMATTED_VALUE`, so date cells come back as **Excel serial numbers** (e.g. `46131`), not strings. Always format dates through [lib/dates.ts](lib/dates.ts) `formatDate()` / `formatDateTime()`, which detect the serial range (1–73050) and convert via the `25569`-day Unix-epoch offset.
- **`appendRow` / `updateRow`** are header-driven: pass `Record<string, unknown>` and missing fields are written as `''`. `rowIndex` is 0-based over data rows (sheet row = `rowIndex + 2`).
- **`ensureSheet(name)` / `ensureColumns(name, columns[])`** are idempotent and used by `/api/init-sheets` (a public endpoint that bootstraps the whole schema). Prefer `ensureColumns` (single batched write) over multiple `ensureColumn` calls.
- **Booleans** are normalized: `TRUE`/`FALSE`/`VERDADERO`/`FALSO` all round-trip to `'TRUE'`/`'FALSE'` strings.
- **IDs** come from `getNextId(sheet)` — `max(id)+1` over the sheet, not a UUID.

There is no migration system. Schema changes happen by editing the `init-sheets` map and re-hitting `GET /api/init-sheets`, which adds missing columns without touching existing data.

**Supabase (Postgres) coexists with Sheets for two things that don't fit Sheets:** (1) the **mailing logs** (`mailing_logs`, reconciled by the Resend webhook) — project `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`, client `getSupabase()` in [lib/supabase.ts](lib/supabase.ts); (2) the **Mensajes inbox** (WhatsApp/IG/FB) — a **separate** Supabase project (`MENSAJES_SUPABASE_URL` / `MENSAJES_SUPABASE_SERVICE_ROLE_KEY`, client `getMensajesSupabase()`), tables `mensajes_contactos / mensajes_conversaciones / mensajes_mensajes` (DDL in [supabase/mensajes-schema.sql](supabase/mensajes-schema.sql), run manually in the SQL editor — no migration tool). Both use the service_role key server-side only; RLS is on with no policies (anon blocked). Sheets remains the system of record for everything else.

## Auth & route access

[proxy.ts](proxy.ts) gates everything (renamed from `middleware.ts` in Next 16; the file convention is `proxy.ts` now, named export `proxy`). **Tres roles** (modelo central en [lib/roles.ts](lib/roles.ts) — `esAdmin`/`esAdminTotal`/`normalizarRol` + `MATRIZ_ACCESOS`):

- **`admin`** (nivel 1) — acceso total, incluida **Configuración Avanzada** (Datos Personales, Agentes, Mantenimiento) y el **Informe de accesos**.
- **`admin2`** — igual que `admin` PERO sin Configuración Avanzada: el proxy le bloquea las APIs avanzadas (`APIS_AVANZADAS` = `/api/empresa-config`, `/api/mensajes/agente`, `/api/sync-database`), la página de Configuración le oculta esa pestaña, y en Usuarios **solo puede gestionar operadores** (no crea/edita admins — reforzado en [app/api/usuarios/route.ts](app/api/usuarios/route.ts) por `rolSesion()`). Ve el resto (Mensajes, Servicios, Mailing, Reportes, etc.) como admin.
- **`operador`** — solo `/dashboard`, `/clientes`, `/operaciones`, `/asistencia`, y una allowlist de prefijos `/api/*` (dashboard, clientes, ciclos, petroleo, vehiculo, despachos, especies, servicios, productos, veterinarios, precios, descuentos, upload, init-sheets, places, asistencia, jornada-config, retiros-adicionales). Visitar `/` redirige a `/dashboard`. El **Informe de accesos** (Configuración → Usuarios, solo `admin`) renderiza `MATRIZ_ACCESOS` (módulo × rol) — actualizarla al sumar módulos.

Public routes: `/login`, `/api/auth/*`, `/api/init-sheets`, `/api/reorder-columns`, `/api/mailing/webhooks/resend` (called by Resend, not a user — authenticity is verified via the `svix-*` headers against `RESEND_WEBHOOK_SECRET`; if the secret is unset the route logs a warning and accepts unverified payloads for dev), the mailing tracking endpoints `/api/mailing/pixel/*` and `/api/mailing/click/*` (hit by email clients, no session), and the **eutanasias public surface**: the `/convenio-eutanasias` landing + its `/api/eutanasias/precios`, `/api/eutanasias/vets/inscribir`, `/api/eutanasias/comunas/buscar` endpoints, plus the vet token-action pages `/eutanasia/{aceptar,confirmar,realizado,datos-pago}/<token>` and their POST endpoints under `/api/eutanasias/cotizaciones/*` and `/api/eutanasias/vets/datos-pago`. These last ones carry no session — authenticity is the HMAC token itself (see eutanasias section).

Auth uses NextAuth v4 with `CredentialsProvider` + JWT strategy. The `admin` user is **not stored in `usuarios`** — it falls back to `ADMIN_EMAIL` / `ADMIN_PASSWORD` env vars. The `configuracion` page detects this and offers an "Editar" row that materializes admin into the `usuarios` sheet on first save.

When adding a new `/api/*` route, decide whether operators need it and update the allowlist in [proxy.ts](proxy.ts).

## App layout

```
app/
  (dashboard)/        # authenticated, sidebar layout
    dashboard/        # KPIs + charts (admin)
    clientes/[id]/    # mascota fichas — peso_declarado vs peso_ingreso (price-tier delta alert)
    operaciones/      # tabs: ciclos | petroleo | vehiculo | despachos
    asistencia/       # operator-accessible: jornada + retiros-adicionales
    rendiciones/      # admin gastos + pagos (xlsx export, colored cells)
    bases/            # veterinarios
    configuracion/    # precios (3 tablas), productos, especies, tipos_servicio, usuarios
    servicios/        # admin: eutanasias-a-domicilio — tabs Cotizaciones | Veterinarios | Precios (NOT otros_servicios; that's api/servicios)
    adicionales/      # admin: otros_servicios / descuentos management
    mailing/          # admin: email campaigns to veterinarios (HTML editor, segmenting, send, metrics)
    reportes/         # xlsx export (ingresos, veterinarios, configuraciones)
  convenio-eutanasias/  # PUBLIC landing: vet self-registration form for the eutanasia network
  eutanasia/            # PUBLIC vet token-action pages: aceptar/ confirmar/ realizado/ datos-pago/ — each [token]/
  api/                # one folder per sheet/entity (incl. sync-database, pagos-retiros, usuarios)
    mailing/          # campanas/ + veterinarios/ + webhooks/resend (HTML lives in R2 under mailing/campanas/<id>.html, not in the Sheet)
    eutanasias/       # cotizaciones/ (CRUD + buscar-vets + enviar + token actions) + vets/ + precios/ + comunas/ + place-details/
  login/
lib/
  google-sheets.ts    # the only place that calls googleapis
  auth.ts             # NextAuth `authOptions` (admin env-fallback + usuarios sheet lookup)
  dates.ts            # canonical date formatting (Excel serial aware)
  dias-habiles.ts     # business-day math — drives the despachos delivery calendar
  format.ts           # CLP/kg/L formatting; re-exports formatDate as fmtFecha
  numbers.ts          # numeric parsing/coercion helpers
  price-calculator.ts # tramo lookup across precios_generales/convenio/especiales
  asistencia.ts       # jornada + retiros-adicionales calculations
  certificate-generator.ts  # pdf-lib certificates (visible "sello formal" + optional PKCS#7 placeholder)
  sign-pdf.ts         # PAdES digital signing — loads .p12 from env, signs buffers, exposes signer info (CN)
  informe-veterinaria.ts # vet statement/invoice generation (informes_veterinaria) — xlsx + pdf
  google-drive.ts     # photo uploads for cliente fichas (mascota photos) → Drive `downloadUrl`
  google-maps.ts      # Geocoding + Places autocomplete, cached in geocoding_cache sheet
  cloudflare-r2.ts    # certificate PDF + mailing-campaign HTML uploads → R2 (S3-compatible)
  codigo-generator.ts # cliente código generator (max(codigo)+1 within tipo)
  comunas.ts          # canonical Chilean comuna list + search (used by ComunaPicker + matcher)
  bancos-cl.ts        # Chilean bank list + account types (vet datos-pago form)
  route-optimizer.ts  # despachos delivery route ordering
  resend-mailer.ts    # Resend client wrapper — sendEmail / sendBatch (≤100), reads MAILING_FROM_* env, tags for webhook correlation
  email-layout.ts     # SHARED visual shell for ALL transactional emails (clientes + vets): navy header (logo right + title) + gold rule + footer (contact from empresa_config + sello bottom-right). Brand assets (logo/sello) hosted on R2 — see scripts/upload-brand-assets.ts. Exports renderEmailLayout / getContacto / escapeHtml / BRAND
  cliente-mailer.ts   # transactional emails to the tutor at 4 hitos: registro (código) / inicio cremación (ciclos POST) / inicio ruta de despacho (despachos/[id]/iniciar) / entrega confirmada + reseña Google (despachos/[id]/entregar) — best-effort, contact data from empresa_config. Uses email-layout
  mailing-render.ts   # {{var}} template substitution for campaign HTML; vars derived from a vet row (nombre, primer_nombre, email, veterinaria, comuna, telefono, categoria)
  eutanasia-tokens.ts # HMAC tokens (signed with NEXTAUTH_SECRET) for vet action links — 72h default, 90d for datos-pago
  eutanasia-matcher.ts # match a cotización to eligible vets by comuna + day/time availability
  eutanasia-mailer.ts  # email templates + sending for the eutanasia workflow (vet invites, client/vet notifications). Centralizes ALL eutanasia render fns (incl. renderCotizacionEmail/renderCoordinarEmail used by the cotizaciones routes); uses email-layout
  supabase.ts         # Supabase clients: getSupabase() (mailing project) + getMensajesSupabase() (Mensajes/inbox project, separate)
  mensajes.ts         # data layer del inbox "Mensajes" (CRUD contactos/conversaciones/mensajes en Supabase Mensajes)
  whatsapp.ts         # WhatsApp Cloud API: enviarTextoWhatsapp / verificarFirmaWebhook / descargarMedia / tipoInterno
  agente-mensajes.ts  # agente IA (Claude) que redacta la respuesta del inbox: voz de marca + playbook + precios en vivo; salida {mensaje, escalar}
  # módulo Mensajes (admin-only): UI components/MensajesView.tsx + app/(dashboard)/mensajes; API app/api/mensajes (lista, [id] GET/PATCH, [id]/mensaje POST envía por WhatsApp, webhook PÚBLICO). Importador histórico: scripts/importar-whatsapp.ts. Esquema: supabase/mensajes-schema.sql
components/
  Sidebar.tsx · TimelineStatus.tsx · VehiculoTab.tsx · DespachosTab.tsx · SessionProvider.tsx (NextAuth client wrapper in root layout) · ui/ (Modal, Badge, Toggle, ComunaPicker, AddressAutocomplete)
scripts/
  apps_script_backup.gs   # Google Apps Script — runs every 48h at 00:00 (America/Santiago), copies the Sheet into Drive folder "DataBase AlmaAnimal Systems"
  *.mjs                   # ad-hoc Node maintenance scripts run manually (`node scripts/<name>.mjs`), not wired into npm scripts:
                          #   format-fechas-sheet / format-numeros-sheet — reformat existing cells in the Sheet
                          #   normalize-telefonos — normalize phone column to 9-digit form
                          #   inspect-clientes-headers / check-peso-kg-unique / delete-col-peso-kg — one-off schema audits
                          #   verify-r2 — R2 PUT/HEAD/public-URL/DELETE health check
  *.ts                    # run with `npx tsx scripts/<name>.ts` (no auto env load — they `import './_env-preload'` first):
                          #   _env-preload — side-effect: loads .env.local into process.env BEFORE libs that read env at module-eval (e.g. google-sheets)
                          #   upload-brand-assets — trim + upload logo / sello / white-paw to R2 brand/ (the images used by every email)
                          #   preview-correos-cliente — send sample client + vet emails (real data, redirected to a test inbox) to preview templates
```

## Eutanasias a domicilio (vet network)

A separate domain from the cremation business: a marketplace matching at-home euthanasia jobs to a network of convenio vets, driven entirely by signed links in email (vets never log in). Four sheets back it (`vet_convenio_eutanasia`, `precios_eutanasia`, `cotizaciones_eutanasia`, `cotizaciones_eutanasia_envios`). Admin UI is the `/servicios` page (tabs Cotizaciones | Veterinarios | Precios).

- **Vet onboarding** is public: `/convenio-eutanasias` posts to `/api/eutanasias/vets/inscribir`, writing a `vet_convenio_eutanasia` row with `comunas` + `horarios` stored as JSON (commune coverage and AM/PM availability per weekday). Banking data is filled later via the 90-day `datos-pago` link.
- **Cotización lifecycle** — `cotizaciones_eutanasia.estado` flows `creada → enviada → aceptada → confirmada → realizada` (or `cancelada`). `precio_snapshot` (what the vet is paid) is frozen at creation from `precios_eutanasia` (by **weight tramo only**, not species). Once `realizada`, `estado_pago` goes `pendiente_pago → pago_confirmado` (admin marks after transfer).
- **Matching**: [lib/eutanasia-matcher.ts](lib/eutanasia-matcher.ts) filters vets by `activo`, comuna coverage, and the requested day/time slot. Admin picks from the matches and `/api/eutanasias/cotizaciones/[id]/enviar` emails them; each send is logged in `cotizaciones_eutanasia_envios` with its `resend_message_id` and per-vet `estado_envio`.
- **Token actions**: vet links are HMAC tokens signed with `NEXTAUTH_SECRET` ([lib/eutanasia-tokens.ts](lib/eutanasia-tokens.ts), 72h default / 90d for datos-pago) — there is no session, so the token *is* the authentication. The public pages `/eutanasia/{aceptar,confirmar,realizado,datos-pago}/<token>` post to the matching `/api/eutanasias/...` endpoints, which re-verify the signature + expiry before mutating. First vet to accept wins; `vet_id_asignado` then sticks. All these routes are whitelisted in [proxy.ts](proxy.ts).
- Emails for the whole flow live in [lib/eutanasia-mailer.ts](lib/eutanasia-mailer.ts) (uses the same Resend wrapper as mailing).

## Cross-cutting conventions

- **Dates**: ISO (`YYYY-MM-DD`) on disk and in `<input type="date">`; **DD/MM/YYYY** in any user-visible string. For new date inputs, default to `todayISO()` from [lib/dates.ts](lib/dates.ts) — never `new Date().toISOString().split('T')[0]` (UTC shift bug at night in Chile).
- **Numbers**: format via [lib/format.ts](lib/format.ts) (`fmtPrecio`, `fmtNumero`, `fmtKg`, `fmtLitros`). Litros stored/displayed as integers; ratios with 1 decimal. Wrap litros differences in `Math.abs()` (carga direction is not enforced).
- **React lists**: when a `.map()` returns multiple sibling rows (e.g. main `<tr>` + expansion `<tr>`), wrap them in `<Fragment key={...}>` — bare `<>` triggers the duplicate-key warning.
- **Peso**: `peso_ingreso` (real) takes precedence over `peso_declarado` for price/ratio math; both are persisted. The ficha shows a price-delta alert when `peso_ingreso` falls in a higher tramo. Use `||` not `??` when reading either, since the sheet returns `''` (empty string), which `??` won't bypass.
- **Despachos = rutas vivas.** A despacho is a delivery route with `estado_ruta` `guardada → en_curso → terminada`. Created from the optimizer ("Guardar ruta" → stores ordered `paradas` with coords + `origen`/`destino`) or manually. Creating a route does **not** change `clientes.estado` — the mascota stays `cremado` but is hidden from the calendar/selection/optimizer while in a non-terminada route (so it isn't re-routed; see `enRutaActiva` in DespachosTab + the exclusion in [lib/route-optimizer.ts](lib/route-optimizer.ts)). Per-stop endpoints under `/api/despachos/[id]/`: **iniciar** (sets `hora_inicio_ruta`, emails "vamos en camino" to all), **entregar** (`{cliente_id}`: records the delivery in `entregas`, flips that mascota to `despachado`+`despacho_id`, emails entrega+reseña; `deshacer:true` reverts), **terminar** (sets `hora_termino_ruta`/`fecha_realizada`). "Abrir en Maps" builds the dir URL from the **pending** stops only. Deleting a route reverts only the already-delivered mascotas (`despachado`→`cremado`).
- **Language**: all user-facing text (UI strings, email bodies, validation messages) is **neutral Spanish** — no Argentine voseo. Match the surrounding copy.
- **Responsive / móvil (obligatorio):** la app se usa **también desde el teléfono** (sobre todo el inbox de Mensajes y Operaciones). Toda pantalla nueva debe verse bien en móvil. Reglas: **tablas anchas** → envolver en `<div className="overflow-x-auto">` y dar `min-w-[Npx]` a la `<table>` (además hay una **regla global en [app/globals.css](app/globals.css)** que hace que toda `main table` scrollee en ≤768px, como red de seguridad). **Formularios/grids de inputs** → empezar SIEMPRE en una columna y escalar: `grid-cols-1 sm:grid-cols-2 lg:grid-cols-4` (nunca arrancar en `grid-cols-2`+ en móvil). El layout base ([app/(dashboard)/layout.tsx](app/(dashboard)/layout.tsx)) ya es responsive (`md:ml-60`, padding adaptativo) y el Sidebar colapsa a hamburguesa; el inbox (`MensajesView`) muestra lista **o** conversación en móvil (estilo WhatsApp).
- **The pet always has a name**: in client-facing copy (emails, UI, messages) refer to a specific pet by its `nombre_mascota` (in the subject and the body). For the generic noun use **"tu mascota"** (tuteo) — not the cold "su mascota" / "la mascota", and not "compañero/a" (client decision; see *Marca, propósito y voz*).

## Marca, propósito y voz (copy de cara al cliente)

Fuente de verdad completa: **`C:\dev\alma-animal-marketing/_docs/biblia-visual-alma-animal.md`** (repo separado del sistema de marketing — léela antes de escribir/rediseñar piezas de cara al público). Resumen accionable para el copy que vive en este repo (correos, landing `/convenio-eutanasias`, textos de UI):

- **Qué es:** Crematorio Alma Animal — cremación de mascotas en Recoleta (Santiago), cobertura RM, todos los días 08:00–23:00. Tagline (ya en el logo): **"Huellas que no se borran"**.
- **Promesa / diferenciadores a comunicar:** servicio cercano, rápido y responsable, todo bajo control directo, con respeto absoluto. Puntos duros: **entrega en 4 días hábiles**, **instalaciones propias** (no se externaliza), **trazabilidad total**, **tecnología de punta**.
- **Dos audiencias (toda pieza declara cuál):**
  - **Tutores (B2C)** — adultos ~28–60 en duelo, serios y sensibles; buscan información y confianza, no consuelo. Voz: **tuteo, cercano pero contenido, profesional y humano**; nunca infantil ni solemne en exceso.
  - **Veterinarios (B2B)** — clínicas en convenio; son el motor comercial. Voz: **profesional, técnica, eficiente**, de socio confiable (datos, plazos, procesos), con menos adornos emocionales.
- **Tono:** cercano y conversacional con base profesional. **Sin humor. Sin referencias religiosas** ("alma" aquí es metafórico, no teológico). **Sin clichés del rubro** (nada de "puente del arcoíris", "angelitos", "tu ángel", "ya no sufre").
- **Vocabulario** — SÍ: ***mascota / tu mascota*** (es el genérico que usamos), *partió / falleció*, *despedida*, *recuerdos / huellas*, *en buenas manos*, *como corresponde*. NO: *muerto / cadáver / restos*, *perdiste / perdió*, eufemismos infantiles. → La mascota va **por su nombre** cuando hablamos de una en particular (en asunto y cuerpo); como genérico usamos **"tu mascota"** (tuteo), no la versión fría *"la mascota" / "su mascota"*. **Decisión del cliente:** usamos *mascota / tu mascota* aunque la biblia de marca prefiera *"compañero/a"* y evite *"mascota"* — en este sistema prima esta convención.
- **Paleta del sistema** (la que usamos aquí, canónica para el repo): Azul Alma `#143C64`, Dorado/ámbar `#F2B84B`, Crema `#FBF8F3` — definidas en `BRAND` en [lib/email-layout.ts](lib/email-layout.ts). Regla 60–70 % blanco/crema · 20–30 % azul (estructura) · 5–10 % dorado (acento). (La biblia de marca lista variantes cercanas `#F0B45A` / `#FAF6F0`, pero **por decisión del cliente mantenemos las del código**.)
- **Símbolo:** huella con halo dorado + un corazón de línea continua (el vínculo que no se corta). Vive como **sello** en la esquina inferior derecha (correos + certificado) y como **logo** en el header de correos y sidebar. Assets en R2 `brand/` + `public/brand/` (ver `scripts/upload-brand-assets.ts`).
- **Cómo atendemos al cliente:** [docs/playbook-atencion.md](docs/playbook-atencion.md) — flujo de atención, plantillas, FAQ y precios, derivado de 354 chats reales de WhatsApp. **Los precios se cotizan siempre desde `precios_generales`** (Configuración → Precios) por peso + tipo de servicio, nunca montos históricos. Insumo para el futuro módulo "Mensajes".

## Environment variables

Required (see [README.md](README.md) for the full table): `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY` (with `\n` escaped), `GOOGLE_SPREADSHEET_ID`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`. Optional: `GOOGLE_DRIVE_FOLDER_ID` (mascota photo uploads), `NEXT_PUBLIC_ADMIN_EMAIL` (UI hint for the admin-as-user row).

Cloudflare R2 (required only if certificate emission is exercised): `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `R2_PUBLIC_URL`. The certificate route throws "R2 no configurado" if any are missing; the rest of the app keeps working.

Digital signing of certificates (optional but recommended): `CERT_P12_BASE64` (the `.p12` / `.pfx` file as base64 — produce with `base64 -w 0 firma.p12` on Linux/macOS, or `[Convert]::ToBase64String([IO.File]::ReadAllBytes('firma.p12'))` on PowerShell), `CERT_P12_PASSWORD` (passphrase of the .p12). Optional: `CERT_SIGNER_NAME` to override the CN that appears on the visible seal — if omitted, the CN read from the cert is used. **If `CERT_P12_BASE64` is not set, the cert generator falls back to the visible-seal-only mode (no PKCS#7 signature, no "FIRMADO DIGITALMENTE" header — the seal degrades to a generic block).** Signing flow: route reserves the next `certificados` ID via `getNextId` → passes it as `firma_info.cert_id` to the generator so it appears inside the seal → generator adds a PKCS#7 placeholder → [lib/sign-pdf.ts](lib/sign-pdf.ts) fills the placeholder with the actual signature → R2 upload → sheet append. Signing failures hard-fail the request (because the visible seal already claims the doc is signed).

Mailing (required only if the `/mailing` module is exercised): `RESEND_API_KEY` — without it `sendEmail`/`sendBatch` throw "RESEND_API_KEY no configurada". Optional: `MAILING_FROM_EMAIL` (defaults to `onboarding@resend.dev`, the sandbox sender — use a verified domain for prod), `MAILING_FROM_NAME` (defaults to `Alma Animal`), `RESEND_WEBHOOK_SECRET` for verifying the `svix-*`-signed webhook payload that Resend POSTs to `/api/mailing/webhooks/resend`. Campaign HTML is stored in R2 (not in the Sheet — the Sheet only holds `html_key` / `html_url`); the webhook joins events back to campaigns via `mailing_logs.resend_message_id` and increments the aggregate counters on `mailing_campanas`.

Google Maps / Places (required only if address autocomplete + geocoding are exercised — used by the eutanasias address fields and the `places` API): `GOOGLE_MAPS_API_KEY`. Results are cached in the `geocoding_cache` sheet to limit billed calls.

Supabase: `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (mailing logs project) and `MENSAJES_SUPABASE_URL` + `MENSAJES_SUPABASE_SERVICE_ROLE_KEY` (the **separate** Mensajes/inbox project). The Mensajes module ([lib/mensajes.ts](lib/mensajes.ts), `/mensajes` UI, `/api/mensajes/*`, importer `scripts/importar-whatsapp.ts`) only works with the `MENSAJES_*` pair set. **The `/mensajes` UI + `/api/mensajes/*` are admin-only** (not in the operator allowlist) — except **`/api/mensajes/webhook`, which is a PUBLIC route** (Meta calls it; authenticity = `X-Hub-Signature-256` HMAC against `META_APP_SECRET` + the `hub.verify_token` on the GET challenge).

WhatsApp Cloud API (Meta directo, [lib/whatsapp.ts](lib/whatsapp.ts)): `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `META_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN` (lo elegimos nosotros, debe coincidir en el panel de Meta); opcional `WHATSAPP_BUSINESS_ACCOUNT_ID`, `WHATSAPP_API_VERSION` (default `v22.0`). El webhook vive en `/api/mensajes/webhook` (GET verifica el challenge; POST recibe → valida HMAC → upsert contacto/conversación/mensaje, media → R2). **Gotcha clave:** además de configurar el callback, hay que **suscribir la WABA a la app** (`POST /{WABA_ID}/subscribed_apps` con el token) o Meta no entrega nada. Outbound: texto libre solo dentro de la ventana de 24h; iniciar/fuera de 24h exige **plantilla aprobada** (pendiente). Hoy corre con un **número de prueba** (token temporal ~24h, solo escribe a destinatarios verificados); para producción: token permanente de System User + número real + publicar la app.

**Agente IA del inbox** ([lib/agente-mensajes.ts](lib/agente-mensajes.ts), `ANTHROPIC_API_KEY`, `AGENTE_AUTO_RESPONDER` default `true`): cuando entra un texto, el webhook responde 200 a Meta y en `after()` el agente (Claude, default `claude-sonnet-4-6`) genera y **envía** la respuesta por WhatsApp, calibrado con la voz de marca + el flujo del playbook + **precios en vivo de `precios_generales`** (nunca inventa precios). Devuelve `{mensaje, escalar}`. **Guardrails:** no responde si la conversación tiene etiqueta `pausado`; un humano que responde manual desde el inbox la **pausa automáticamente**; escala a humano (etiquetas `pausado` + `requiere-humano`) en reclamos/temas sensibles/cuando piden persona; kill-switch global `AGENTE_AUTO_RESPONDER=false`. IG/FB Messenger quedan para una fase posterior (otro app review de Meta).

Deploy target is Vercel; backups are handled out-of-band by the Apps Script in [scripts/apps_script_backup.gs](scripts/apps_script_backup.gs) (every 48h at 00:00 America/Santiago → Drive folder "DataBase AlmaAnimal Systems"), not by Vercel cron.
