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

The "database" is a single Google Sheet (`GOOGLE_SPREADSHEET_ID`) accessed via a Service Account JWT. Sheets, one per entity: `clientes`, `ciclos`, `cargas_petroleo`, `vehiculo_cargas`, `despachos`, `rendiciones`, `pagos_rendicion`, `descuentos`, `veterinarios`, `informes_veterinaria`, `precios_generales` / `precios_convenio` / `precios_especiales`, `productos`, `especies`, `tipos_servicio`, `otros_servicios`, `usuarios`, `certificados` (audit log of emitted PDFs — `pdf_key` / `pdf_url` point at R2), the asistencia cluster (`asistencia`, `jornada_config`, `retiros_adicionales`, `pagos_retiros`), the mailing cluster (`mailing_veterinarios`, `mailing_campanas`, `mailing_logs` — `mailing_logs.resend_message_id` is the join key the Resend webhook uses to reconcile open/click/bounce events back to a campaign), the eutanasias cluster (`vet_convenio_eutanasia`, `precios_eutanasia`, `cotizaciones_eutanasia`, `cotizaciones_eutanasia_envios` — see the dedicated section below), the WhatsApp-agent cluster (`solicitudes_retiro` — retiro requests the agent registers for admin confirmation; `relay_retiro` — pending "¿cuánto falta para el retiro?" relays, matched back by the admin's reply), `correos_cliente` (per-tutor transactional-email tracking: registro/inicio cremación/inicio despacho/entrega/certificado, reconciled by the Resend webhook via the `tipo=cliente_*` tag — feeds the ficha's "Correos al tutor" block + the email-field bounce alert), `mailing_imagenes` (campaign image bank, see the mailing-generator paragraph; the `whatsapp` boolean column flags images the WhatsApp agent may send to a client on request — see `enviar_fotos`), `geocoding_cache` and `empresa_config`. The canonical schema lives in [lib/sheets-schema.ts](lib/sheets-schema.ts) (the `SHEETS` map, consumed by [app/api/init-sheets/route.ts](app/api/init-sheets/route.ts)) — when adding a column or sheet, update that map and the consuming API route together.

All Sheets I/O goes through [lib/google-sheets.ts](lib/google-sheets.ts). Key conventions:

- **`getSheetData(name)`** returns rows as `Record<string,string>` keyed by the row-1 headers. Reads use `UNFORMATTED_VALUE`, so date cells come back as **Excel serial numbers** (e.g. `46131`), not strings. Always format dates through [lib/dates.ts](lib/dates.ts) `formatDate()` / `formatDateTime()`, which detect the serial range (1–73050) and convert via the `25569`-day Unix-epoch offset.
- **`appendRow` / `updateRow`** are header-driven: pass `Record<string, unknown>` and missing fields are written as `''`. `rowIndex` is 0-based over data rows (sheet row = `rowIndex + 2`).
- **`ensureSheet(name)` / `ensureColumns(name, columns[])`** are idempotent and used by `/api/init-sheets` (bootstraps the whole schema). **`/api/init-sheets` is auth-gated** (admin-total session **or** `Authorization: Bearer <CRON_SECRET>`; fail-closed — if `CRON_SECRET` is unset, only an admin session works). Prefer `ensureColumns` (single batched write) over multiple `ensureColumn` calls.
- **Booleans** are normalized: `TRUE`/`FALSE`/`VERDADERO`/`FALSO` all round-trip to `'TRUE'`/`'FALSE'` strings.
- **IDs** come from `getNextId(sheet)` — `max(id)+1` over the sheet, not a UUID.

### ⚠️ El backend EN VIVO (local + producción) es Postgres, NO Sheets

Aunque el código habla de "Sheets", el sistema corre con **`DATA_BACKEND=postgres`**: toda la I/O pasa por [lib/datastore.ts](lib/datastore.ts) (mismas firmas que `google-sheets`, ver el header de ese archivo) contra el **proyecto Supabase «Alma Animal»** (`ixqharypfqlooogoctdp`, env `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`). La base es **compartida entre local y producción**. Las tablas son las del `SHEETS` map pero como tablas Postgres (columnas `text`, `id` identity, función `next_id`); el DDL canónico vive en [supabase/schema-principal.sql](supabase/schema-principal.sql).

**Consecuencia crítica al agregar una columna o tabla** (esto ya nos mordió con `mailing_imagenes.whatsapp`): en Postgres **`ensureSheet`/`ensureColumns` son NO-OP** ([lib/datastore.ts](lib/datastore.ts) las cortocircuita), así que **editar el `init-sheets` map y re-pegar `/api/init-sheets` NO crea la columna** — el insert falla con *"Could not find the 'X' column ... in the schema cache"* (PostgREST). Para sumar un campo hay que, en este orden:

1. **Correr el `ALTER TABLE ... ADD COLUMN IF NOT EXISTS ...` contra Supabase** (SQL editor o MCP) sobre `ixqharypfqlooogoctdp`. Booleans van como `text` default `'FALSE'`.
2. `notify pgrst, 'reload schema';` (o esperar a que PostgREST recargue solo ~30 s) para que el cache vea la columna.
3. **Actualizar [supabase/schema-principal.sql](supabase/schema-principal.sql)** (CREATE + un `ALTER ... IF NOT EXISTS` idempotente) para que entornos nuevos la tengan.
4. **Y TAMBIÉN** el `SHEETS` map en [lib/sheets-schema.ts](lib/sheets-schema.ts), para mantener la paridad si algún día se vuelve a Sheets.

Si el flag se quitara (`DATA_BACKEND=sheets`), el sistema vuelve a la planilla de Google y ahí sí aplica el camino de `/api/init-sheets`. Hoy ese camino es solo para el modo Sheets — en prod no se usa.

**Dos Supabase distintos:** además del principal (arriba), el **inbox de Mensajes** (WhatsApp/IG/FB) vive en un **proyecto SEPARADO** (`petcrem-mensajes` = `jknkwsulktfbdooyekaf`, env `MENSAJES_SUPABASE_URL` / `MENSAJES_SUPABASE_SERVICE_ROLE_KEY`, client `getMensajesSupabase()`), tablas `mensajes_contactos / mensajes_conversaciones / mensajes_mensajes` + `agente_config` (DDL en [supabase/mensajes-schema.sql](supabase/mensajes-schema.sql), corrido a mano). Las tablas reconciliadas por webhooks de Resend (`mailing_logs`, `correos_cliente`) usan `getSupabase()` (proyecto principal) directo, no `datastore`. Ambos proyectos usan el service_role key solo server-side; RLS on sin políticas (anon bloqueado).

## Auth & route access

[proxy.ts](proxy.ts) gates everything (renamed from `middleware.ts` in Next 16; the file convention is `proxy.ts` now, named export `proxy`). **Tres roles** (modelo central en [lib/roles.ts](lib/roles.ts) — `esAdmin`/`esAdminTotal`/`normalizarRol` + `MATRIZ_ACCESOS`):

- **`admin`** (nivel 1) — acceso total, incluida **Configuración Avanzada** (Datos Personales, Agentes, Correos, Mantenimiento) y el **Informe de accesos**.
- **`admin2`** — igual que `admin` PERO sin Configuración Avanzada: el proxy le bloquea las APIs avanzadas (`APIS_AVANZADAS` = `/api/empresa-config`, `/api/mensajes/agente`, `/api/sync-database`, `/api/correos`), la página de Configuración le oculta esa pestaña, y en Usuarios **solo puede gestionar operadores** (no crea/edita admins — reforzado en [app/api/usuarios/route.ts](app/api/usuarios/route.ts) por `rolSesion()`). Ve el resto (Mensajes, Servicios, Mailing, Reportes, etc.) como admin.
- **`operador`** — solo `/dashboard`, `/clientes`, `/operaciones`, `/asistencia`, y una allowlist de prefijos `/api/*` (dashboard, clientes, ciclos, petroleo, vehiculo, despachos, especies, servicios, productos, veterinarios, precios, descuentos, upload, places, asistencia, jornada-config, retiros-adicionales). Visitar `/` redirige a `/dashboard`. El **Informe de accesos** (Configuración → Usuarios, solo `admin`) renderiza `MATRIZ_ACCESOS` (módulo × rol) — actualizarla al sumar módulos.

Public routes (gateadas a nivel `proxy`, pero `init-sheets`/`backup` traen su propia auth interna): `/login`, `/api/auth/*`, `/api/init-sheets` (auth interna: admin-total o `Bearer CRON_SECRET`), `/api/reorder-columns`, `/api/mailing/webhooks/resend` (called by Resend, not a user — authenticity is verified via the `svix-*` headers against `RESEND_WEBHOOK_SECRET`; **en producción, si el secret falta el route responde 503 fail-closed**; en dev loguea un warning y acepta sin verificar), the mailing tracking endpoints `/api/mailing/pixel/*` and `/api/mailing/click/*` (hit by email clients, no session), and the **eutanasias public surface**: the `/convenio-eutanasias` landing + its `/api/eutanasias/precios`, `/api/eutanasias/vets/inscribir`, `/api/eutanasias/comunas/buscar` endpoints, plus the vet token-action pages `/eutanasia/{aceptar,confirmar,realizado,datos-pago}/<token>` and their POST endpoints under `/api/eutanasias/cotizaciones/*` and `/api/eutanasias/vets/datos-pago`. These last ones carry no session — authenticity is the HMAC token itself (see eutanasias section).

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
  cliente-mailer.ts   # transactional emails to the tutor: registro (código + botón subir foto) / inicio cremación (ciclos POST) / inicio ruta de despacho (despachos/[id]/iniciar) / entrega confirmada + reseña Google (despachos/[id]/entregar) / certificado de cremación (clientes/[id]/certificado/enviar). Cada uno expone un render puro build* (subject+html) que reusan el sender Y el catálogo de correos — best-effort, contact data from empresa_config. Uses email-layout. Cada envío se REGISTRA en correos_cliente (lib/correos-log) para el seguimiento por cliente; los envíos en lote (inicio cremación/despacho) activan el BCC de seguimiento con el flag opt-in `bccSeguimiento` de sendBatch (las campañas masivas NO).
  vet-cremacion-mailer.ts # correos B2B al VETERINARIO DE CONVENIO asociado a una ficha (clientes.veterinaria_id → hoja `veterinarios`): retiro confirmado / código / inicio ruta / entrega. build* puros reusados por el catálogo; voz B2B; NO se registran en correos_cliente (son del vet), solo se taguean (tipo=vet_cremacion_*). `resolverVet(veterinaria_id)` resuelve correo/nombre/contacto del vet. Best-effort, uses email-layout.
  correos-log.ts      # capa de correos_cliente (Supabase): registrarEnvio(s) / aplicarEventoCorreo (lo llama el webhook de Resend) / listarPorCliente / problemaPorEmail. Best-effort.
  correos-catalogo.ts # CATÁLOGO central de TODOS los correos transaccionales (cliente + vet). Única fuente para Configuración → Correos (preview + "Enviar prueba"). Referencia los render reales (build*/render* de los mailers), NO duplica HTML. ⚠️ Al crear un correo nuevo: exporta su render desde el mailer y AGRÉGALO aquí.
  mailing-render.ts   # {{var}} template substitution for campaign HTML; vars derived from a vet row (nombre, primer_nombre, email, veterinaria, comuna, telefono, categoria)
  eutanasia-tokens.ts # HMAC tokens (signed with NEXTAUTH_SECRET) for vet action links — 72h default, 30d for datos-pago (single-use: the endpoint rejects re-submission once datos_pago_completos)
  eutanasia-matcher.ts # match a cotización to eligible vets by comuna + day/time availability
  eutanasia-mailer.ts  # email templates + sending for the eutanasia workflow (vet invites, client/vet notifications). Centralizes ALL eutanasia render fns (incl. renderCotizacionEmail/renderCoordinarEmail used by the cotizaciones routes); uses email-layout
  supabase.ts         # Supabase clients: getSupabase() (mailing project) + getMensajesSupabase() (Mensajes/inbox project, separate)
  mensajes.ts         # data layer del inbox "Mensajes" (CRUD contactos/conversaciones/mensajes en Supabase Mensajes)
  whatsapp.ts         # WhatsApp Cloud API: enviarTextoWhatsapp / verificarFirmaWebhook / descargarMedia / tipoInterno
  agente-mensajes.ts  # agente IA (Claude) que redacta la respuesta del inbox: voz de marca + playbook + precios en vivo + HORA/fecha actual de Chile (resuelve "mañana", "lo antes posible"); las INSTRUCCIONES del operador (agente_config) REEMPLAZAN el guion base ante conflicto (excepto: no inventar precios + escalar). Tools: escalar_a_humano (incl. solicitudes especiales/postventa), solicitar_retiro_cremacion, cotizar/agendar_eutanasia, consultar_eta_retiro. También exporta redactarRelayCliente (redacta al cliente la respuesta del admin en el relay de ETA). Inyecta si el cliente ya tiene una ficha "borrador" en proceso (para no duplicar retiros)
  agente-acciones.ts  # handlers de las tools (los inyecta el webhook): solicitarRetiro (bloquea 2º retiro si el cliente ya tiene ficha borrador visible) · cotizar/agendarEutanasia · consultarEtaRetiro (avisa al admin por WhatsApp y crea un relay pendiente)
  relay-retiro.ts     # crear/buscar/marcar relays pendientes (tabla relay_retiro) para reenviar la respuesta del admin al cliente
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

- **Vet onboarding** is public: `/convenio-eutanasias` posts to `/api/eutanasias/vets/inscribir`, writing a `vet_convenio_eutanasia` row with `comunas` + `horarios` stored as JSON (commune coverage and AM/PM availability per weekday). Banking data is filled later via the 30-day `datos-pago` link — **single-use**: once `datos_pago_completos` is TRUE the endpoint refuses to expose or overwrite the bank data (changes go through the team by email).
- **Cotización lifecycle** — `cotizaciones_eutanasia.estado` flows `creada → enviada → aceptada → confirmada → realizada` (or `cancelada`). `precio_snapshot` (what the vet is paid) is frozen at creation from `precios_eutanasia` (by **weight tramo only**, not species). Once `realizada`, `estado_pago` goes `pendiente_pago → pago_confirmado` (admin marks after transfer).
- **Matching**: [lib/eutanasia-matcher.ts](lib/eutanasia-matcher.ts) filters vets by `activo`, comuna coverage, and the requested day/time slot. Admin picks from the matches and `/api/eutanasias/cotizaciones/[id]/enviar` emails them; each send is logged in `cotizaciones_eutanasia_envios` with its `resend_message_id` and per-vet `estado_envio`.
- **Token actions**: vet links are HMAC tokens signed with `NEXTAUTH_SECRET` ([lib/eutanasia-tokens.ts](lib/eutanasia-tokens.ts), 72h default / 30d for datos-pago, which is also single-use) — there is no session, so the token *is* the authentication. The public pages `/eutanasia/{aceptar,confirmar,realizado,datos-pago}/<token>` post to the matching `/api/eutanasias/...` endpoints, which re-verify the signature + expiry before mutating. First vet to accept wins; `vet_id_asignado` then sticks. All these routes are whitelisted in [proxy.ts](proxy.ts).
- Emails for the whole flow live in [lib/eutanasia-mailer.ts](lib/eutanasia-mailer.ts) (uses the same Resend wrapper as mailing).

## Cross-cutting conventions

- **Dates**: ISO (`YYYY-MM-DD`) on disk and in `<input type="date">`; **DD/MM/YYYY** in any user-visible string. For new date inputs, default to `todayISO()` from [lib/dates.ts](lib/dates.ts) — never `new Date().toISOString().split('T')[0]` (UTC shift bug at night in Chile).
- **Numbers**: format via [lib/format.ts](lib/format.ts) (`fmtPrecio`, `fmtNumero`, `fmtKg`, `fmtLitros`). Litros stored/displayed as integers; ratios with 1 decimal. Wrap litros differences in `Math.abs()` (carga direction is not enforced).
- **React lists**: when a `.map()` returns multiple sibling rows (e.g. main `<tr>` + expansion `<tr>`), wrap them in `<Fragment key={...}>` — bare `<>` triggers the duplicate-key warning.
- **Peso**: `peso_ingreso` (real) takes precedence over `peso_declarado` for price/ratio math; both are persisted. The ficha shows a price-delta alert when `peso_ingreso` falls in a higher tramo. Use `||` not `??` when reading either, since the sheet returns `''` (empty string), which `??` won't bypass.
- **Tramo de precio en el límite exacto → tramo MAYOR**: cuando un peso cae justo en el borde entre dos tramos (ej. 15 kg entre `10–15` y `15–25`), se usa **siempre el tramo superior** (15–25). Aplica al `price-calculator`, al formulario público de registro y al bot al cotizar.
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

**Generador de campañas con IA** ("Generar con IA" en `/mailing` → Nueva campaña): **Claude** ([lib/mailing-generator.ts](lib/mailing-generator.ts), `ANTHROPIC_API_KEY`, modelo `ANTHROPIC_MAILING_MODEL` / `ANTHROPIC_MODEL`, default `claude-sonnet-4-6`) redacta asunto/preview + el HTML completo del correo (libertad total de diseño, según `formato`) y planifica las imágenes; **Nano Banana Pro** (Gemini 3 Pro Image, [lib/nano-banana.ts](lib/nano-banana.ts), `GEMINI_API_KEY` de Google AI Studio — opcional `GEMINI_IMAGE_MODEL` default `gemini-3-pro-image-preview`, `GEMINI_API_VERSION` default `v1beta`) genera las imágenes **fotorrealistas** (sin texto incrustado). Las imágenes (generadas en `mailing/ai-images/`, subidas en `mailing/uploads/`) se registran en el **banco** (`mailing_imagenes`, [lib/mailing-images.ts](lib/mailing-images.ts)): el generador revisa el banco SIEMPRE primero y RECICLA una imagen existente cuando calza (`descripcion`/`tags`/`grupo` alimentan el match) en vez de generar otra. Cada imagen tiene un **`grupo`** (mascotas | personas | productos | instalaciones | otro) que asigna el equipo. **Regla dura: la IA NUNCA genera fotos de instalaciones** — esas solo se muestran reutilizando imágenes del banco con grupo `instalaciones`, que el equipo sube a mano. Antes de entregar, el generador hace un **pase de revisión** (director de arte + QA, con visión sobre las imágenes generadas) que verifica consistencia visual y composición, ajusta el tamaño del logo y pule el HTML. La pestaña **Imágenes** de `/mailing` administra el banco (generar/subir, asignar grupo, eliminar) separando «Generadas» y «Subidas»; el editor puede insertar imágenes del banco. Endpoints: `POST /api/mailing/generar` (`maxDuration=300`, devuelve `{asunto, preview_text, html, imagenes, avisos}`) y `/api/mailing/imagenes` (GET lista · POST `{generar}`/`{data_url}` con `grupo` · PATCH `?id=` reasigna grupo · DELETE `?id=`). Sin `GEMINI_API_KEY` el generador degrada: solo recicla del banco / arma el correo sin fotos nuevas (el texto siempre funciona con `ANTHROPIC_API_KEY`).

Google Maps / Places (required only if address autocomplete + geocoding are exercised — used by the eutanasias address fields and the `places` API): `GOOGLE_MAPS_API_KEY`. Results are cached in the `geocoding_cache` sheet to limit billed calls.

Supabase: `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (mailing logs project) and `MENSAJES_SUPABASE_URL` + `MENSAJES_SUPABASE_SERVICE_ROLE_KEY` (the **separate** Mensajes/inbox project). The Mensajes module ([lib/mensajes.ts](lib/mensajes.ts), `/mensajes` UI, `/api/mensajes/*`, importer `scripts/importar-whatsapp.ts`) only works with the `MENSAJES_*` pair set. **The `/mensajes` UI + `/api/mensajes/*` are admin-only** (not in the operator allowlist) — except **`/api/mensajes/webhook`, which is a PUBLIC route** (Meta calls it; authenticity = `X-Hub-Signature-256` HMAC against `META_APP_SECRET` + the `hub.verify_token` on the GET challenge).

WhatsApp Cloud API (Meta directo, [lib/whatsapp.ts](lib/whatsapp.ts)): `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `META_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN` (lo elegimos nosotros, debe coincidir en el panel de Meta); opcional `WHATSAPP_BUSINESS_ACCOUNT_ID`, `WHATSAPP_API_VERSION` (default `v22.0`), `ADMIN_WHATSAPP` (número del dueño que confirma retiros por botones, recibe avisos de escalamiento y responde el relay de ETA; default `56978640811`). El webhook vive en `/api/mensajes/webhook` (GET verifica el challenge; POST recibe → valida HMAC → upsert contacto/conversación/mensaje, media → R2). **Gotcha clave:** además de configurar el callback, hay que **suscribir la WABA a la app** (`POST /{WABA_ID}/subscribed_apps` con el token) o Meta no entrega nada. Outbound: texto libre solo dentro de la ventana de 24h; iniciar/fuera de 24h exige **plantilla aprobada** (pendiente — el envío de plantillas no está implementado aún). Corre con **número real propio + token permanente de System User** (producción). 

**WhatsApp Coexistence (en preparación):** objetivo = usar el número en la **WhatsApp Business app** (+ escritorio) Y la Cloud API a la vez, para ver/responder las conversaciones en WhatsApp nativo manteniendo el agente. Requiere que el número esté en la Business app (no en Cloud API), así que implica migrar (liberar el número de la API → registrarlo en la Business app → onboarding por *Embedded Signup* con `featureType: 'whatsapp_business_app_onboarding'`). **Ya implementado (inerte hasta activar los webhook fields):** en `/api/mensajes/webhook`, el field **`smb_message_echoes`** (mensajes que el negocio envía DESDE la app, no por la API) → `procesarEcho` los registra como salientes (`enviado_por:'humano'`) y **pausa la conversación** (etiqueta `pausado`) para que el agente no responda encima (mismo guardrail que responder desde el inbox); los fields **`account_offboarded`/`account_reconnected`** avisan al `ADMIN_WHATSAPP`. Falta (lado Meta): suscribir esos webhook fields + el onboarding de coexistence; y construir/confirmar la página de Embedded Signup al migrar.

**Agente IA del inbox** ([lib/agente-mensajes.ts](lib/agente-mensajes.ts), `ANTHROPIC_API_KEY`, `AGENTE_AUTO_RESPONDER` default `true`): cuando entra un texto, el webhook responde 200 a Meta y en `after()` el agente (Claude, default `claude-sonnet-4-6`) genera y **envía** la respuesta por WhatsApp, calibrado con la voz de marca + el flujo del playbook + **precios en vivo de `precios_generales`** (nunca inventa precios). Devuelve `{mensaje, escalar, imagenes?}` (ver `enviar_fotos` abajo). **Guardrails:** no responde si la conversación tiene etiqueta `pausado`; un humano que responde manual desde el inbox la **pausa automáticamente**; escala a humano (etiquetas `pausado` + `requiere-humano`) en reclamos/temas sensibles/cuando piden persona **o ante cualquier solicitud especial/postventa**, y al escalar **avisa al admin por WhatsApp** (`ADMIN_WHATSAPP`); kill-switch global `AGENTE_AUTO_RESPONDER=false`. IG/FB Messenger quedan para una fase posterior (otro app review de Meta).

Flujos del agente que pasan por el webhook ([app/api/mensajes/webhook/route.ts](app/api/mensajes/webhook/route.ts)):
- **Retiro de cremación (Flujo A):** `solicitar_retiro_cremacion` escribe en `solicitudes_retiro` y manda botones ✅/❌ al `ADMIN_WHATSAPP`. `procesarBotonAdmin` confirma → crea **cliente borrador** ("Por ingresar", sin código) y le manda al tutor un **link FIRMADO** `/registro-mascota?ficha=<token>` ([lib/borrador-token.ts](lib/borrador-token.ts)) que SOLO completa ese borrador (no genera código; el código + correo de bienvenida los crea el operador al "Registrar ficha"). El agente NO toma un 2º retiro si el cliente ya tiene una ficha borrador visible (dedup por lo que se ve en /clientes, no por el log interno).
- **Retiro de veterinario de convenio (Flujo A-vet):** en el saludo el agente invita "si eres veterinario, avísame y agendamos el retiro directamente". En **MODO VETERINARIO** SOLO agenda: pide el **nombre de la clínica/vet** + mascota, peso, dirección/comuna y fecha/hora, y registra con `solicitar_retiro_vet`. El handler ([lib/agente-acciones.ts](lib/agente-acciones.ts) `solicitarRetiroVet`) identifica al vet por **nombre** en la hoja `veterinarios` (activos): si no lo encuentra → NO agenda, escala (`escalar_a_humano`, que avisa al admin); si lo encuentra → solicitud `origen='bot_vet'` con `veterinaria_id`/`vet_nombre`/`vet_email` + botones ✅/❌ al admin. NO aplica el dedup de "una ficha en proceso" (un vet agenda muchos retiros). Al confirmar, `procesarBotonAdmin` crea el borrador asociado al vet (con `tipo_precios` del convenio → el snapshot usa esas tarifas, **no se le muestra precio**) y, en vez del link de tutor, le manda al vet un **correo de confirmación** ("Hemos agendado el retiro de XX…"). Ante CUALQUIER otra cosa del veterinario (precios, dudas, postventa) el agente escala. Los correos al vet viven en [lib/vet-cremacion-mailer.ts](lib/vet-cremacion-mailer.ts) (4 hitos B2B: confirmación / código / inicio ruta / entrega; registrados en `correos-catalogo`); los del ciclo (código/ruta/entrega) se disparan para **cualquier ficha con `veterinaria_id` y vet con correo** (`resolverVet`), enganchados en `clientes` POST, `despachos/[id]/iniciar` y `.../entregar`.
- **Relay de ETA:** si el cliente con retiro confirmado pregunta cuánto falta, `consultar_eta_retiro` avisa al admin y crea un `relay_retiro` pendiente; cuando el admin responde (normal o citando), `procesarRelayAdmin` redacta al cliente la respuesta con la voz de marca (`redactarRelayCliente`) y se la envía. Respeta la ventana de 24h de Meta.
- **Enviar fotos (`enviar_fotos`):** el agente puede mandarle al cliente imágenes del **banco de mailing** que el equipo habilitó marcándolas con el flag `whatsapp` (columna `mailing_imagenes.whatsapp`, checkbox en `/mailing` → Imágenes). Solo esas se le inyectan al modelo (id + descripción + grupo) y solo esas puede enviar — nunca inventa ni describe fotos que no estén en la lista. `generarRespuesta` devuelve `imagenes:[{url,alt}]` y el webhook las manda con `enviarMediaWhatsapp` (tras el re-chequeo de `pausado`) y las registra en el inbox como mensajes de imagen. Útil para "¿tienen fotos de las ánforas?".
- El inbox muestra las horas en zona Chile (los ts se guardan en UTC).

Deploy target is Vercel; backups are handled out-of-band by the Apps Script in [scripts/apps_script_backup.gs](scripts/apps_script_backup.gs) (every 48h at 00:00 America/Santiago → Drive folder "DataBase AlmaAnimal Systems"), not by Vercel cron.
