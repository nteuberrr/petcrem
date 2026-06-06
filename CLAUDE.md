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

## Auth & route access

[proxy.ts](proxy.ts) gates everything (renamed from `middleware.ts` in Next 16; the file convention is `proxy.ts` now, named export `proxy`). Two roles:

- **`admin`** — full access.
- **`operador`** — only `/dashboard`, `/clientes`, `/operaciones`, `/asistencia`, and a hardcoded allowlist of `/api/*` prefixes (dashboard, clientes, ciclos, petroleo, vehiculo, despachos, especies, servicios, productos, veterinarios, precios, descuentos, upload, init-sheets, places, asistencia, jornada-config, retiros-adicionales). Visiting `/` redirects to `/dashboard`. The mailing **and** eutanasias dashboard routes are **not** in the operator allowlist — `/mailing`, `/servicios`, and their `/api/*` are admin-only.

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
  mailing-render.ts   # {{var}} template substitution for campaign HTML; vars derived from a vet row (nombre, primer_nombre, email, veterinaria, comuna, telefono, categoria)
  eutanasia-tokens.ts # HMAC tokens (signed with NEXTAUTH_SECRET) for vet action links — 72h default, 90d for datos-pago
  eutanasia-matcher.ts # match a cotización to eligible vets by comuna + day/time availability
  eutanasia-mailer.ts  # email templates + sending for the eutanasia workflow (vet invites, client/vet notifications)
components/
  Sidebar.tsx · TimelineStatus.tsx · VehiculoTab.tsx · DespachosTab.tsx · SessionProvider.tsx (NextAuth client wrapper in root layout) · ui/ (Modal, Badge, Toggle, ComunaPicker, AddressAutocomplete)
scripts/
  apps_script_backup.gs   # Google Apps Script — runs every 48h at 00:00 (America/Santiago), copies the Sheet into Drive folder "DataBase AlmaAnimal Systems"
  *.mjs                   # ad-hoc Node maintenance scripts run manually (`node scripts/<name>.mjs`), not wired into npm scripts:
                          #   format-fechas-sheet / format-numeros-sheet — reformat existing cells in the Sheet
                          #   normalize-telefonos — normalize phone column to 9-digit form
                          #   inspect-clientes-headers / check-peso-kg-unique / delete-col-peso-kg — one-off schema audits
                          #   verify-r2 — R2 PUT/HEAD/public-URL/DELETE health check
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
- **Despachos** mutate `clientes.estado` (`cremado` ↔ `despachado`) and write `despacho_id`. Deleting a despacho reverts the affected mascotas.
- **Language**: all user-facing text (UI strings, email bodies, validation messages) is **neutral Spanish** — no Argentine voseo. Match the surrounding copy.

## Environment variables

Required (see [README.md](README.md) for the full table): `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY` (with `\n` escaped), `GOOGLE_SPREADSHEET_ID`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`. Optional: `GOOGLE_DRIVE_FOLDER_ID` (mascota photo uploads), `NEXT_PUBLIC_ADMIN_EMAIL` (UI hint for the admin-as-user row).

Cloudflare R2 (required only if certificate emission is exercised): `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `R2_PUBLIC_URL`. The certificate route throws "R2 no configurado" if any are missing; the rest of the app keeps working.

Digital signing of certificates (optional but recommended): `CERT_P12_BASE64` (the `.p12` / `.pfx` file as base64 — produce with `base64 -w 0 firma.p12` on Linux/macOS, or `[Convert]::ToBase64String([IO.File]::ReadAllBytes('firma.p12'))` on PowerShell), `CERT_P12_PASSWORD` (passphrase of the .p12). Optional: `CERT_SIGNER_NAME` to override the CN that appears on the visible seal — if omitted, the CN read from the cert is used. **If `CERT_P12_BASE64` is not set, the cert generator falls back to the visible-seal-only mode (no PKCS#7 signature, no "FIRMADO DIGITALMENTE" header — the seal degrades to a generic block).** Signing flow: route reserves the next `certificados` ID via `getNextId` → passes it as `firma_info.cert_id` to the generator so it appears inside the seal → generator adds a PKCS#7 placeholder → [lib/sign-pdf.ts](lib/sign-pdf.ts) fills the placeholder with the actual signature → R2 upload → sheet append. Signing failures hard-fail the request (because the visible seal already claims the doc is signed).

Mailing (required only if the `/mailing` module is exercised): `RESEND_API_KEY` — without it `sendEmail`/`sendBatch` throw "RESEND_API_KEY no configurada". Optional: `MAILING_FROM_EMAIL` (defaults to `onboarding@resend.dev`, the sandbox sender — use a verified domain for prod), `MAILING_FROM_NAME` (defaults to `Alma Animal`), `RESEND_WEBHOOK_SECRET` for verifying the `svix-*`-signed webhook payload that Resend POSTs to `/api/mailing/webhooks/resend`. Campaign HTML is stored in R2 (not in the Sheet — the Sheet only holds `html_key` / `html_url`); the webhook joins events back to campaigns via `mailing_logs.resend_message_id` and increments the aggregate counters on `mailing_campanas`.

Google Maps / Places (required only if address autocomplete + geocoding are exercised — used by the eutanasias address fields and the `places` API): `GOOGLE_MAPS_API_KEY`. Results are cached in the `geocoding_cache` sheet to limit billed calls.

Deploy target is Vercel; backups are handled out-of-band by the Apps Script in [scripts/apps_script_backup.gs](scripts/apps_script_backup.gs) (every 48h at 00:00 America/Santiago → Drive folder "DataBase AlmaAnimal Systems"), not by Vercel cron.
