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

## Database: Google Sheets, not SQL

The "database" is a single Google Sheet (`GOOGLE_SPREADSHEET_ID`) accessed via a Service Account JWT. There are ~16 sheets, one per entity (`clientes`, `ciclos`, `cargas_petroleo`, `vehiculo_cargas`, `despachos`, `rendiciones`, `pagos_rendicion`, `veterinarios`, `precios_generales`/`precios_convenio`/`precios_especiales`, `productos`, `especies`, `tipos_servicio`, `otros_servicios`, `usuarios`). The canonical schema lives in [app/api/init-sheets/route.ts](app/api/init-sheets/route.ts) — when adding a column or sheet, update that map and the consuming API route together.

All Sheets I/O goes through [lib/google-sheets.ts](lib/google-sheets.ts). Key conventions:

- **`getSheetData(name)`** returns rows as `Record<string,string>` keyed by the row-1 headers. Reads use `UNFORMATTED_VALUE`, so date cells come back as **Excel serial numbers** (e.g. `46131`), not strings. Always format dates through [lib/dates.ts](lib/dates.ts) `formatDate()` / `formatDateTime()`, which detect the serial range (1–73050) and convert via the `25569`-day Unix-epoch offset.
- **`appendRow` / `updateRow`** are header-driven: pass `Record<string, unknown>` and missing fields are written as `''`. `rowIndex` is 0-based over data rows (sheet row = `rowIndex + 2`).
- **`ensureSheet(name)` / `ensureColumns(name, columns[])`** are idempotent and used by `/api/init-sheets` (a public endpoint that bootstraps the whole schema). Prefer `ensureColumns` (single batched write) over multiple `ensureColumn` calls.
- **Booleans** are normalized: `TRUE`/`FALSE`/`VERDADERO`/`FALSO` all round-trip to `'TRUE'`/`'FALSE'` strings.
- **IDs** come from `getNextId(sheet)` — `max(id)+1` over the sheet, not a UUID.

There is no migration system. Schema changes happen by editing the `init-sheets` map and re-hitting `GET /api/init-sheets`, which adds missing columns without touching existing data.

## Auth & route access

[middleware.ts](middleware.ts) gates everything. Two roles:

- **`admin`** — full access.
- **`operador`** — only `/clientes`, `/operaciones`, and a hardcoded allowlist of `/api/*` prefixes (clientes, ciclos, petroleo, vehiculo, despachos, especies, servicios, productos, veterinarios, precios, upload, init-sheets). Visiting `/` or `/dashboard` redirects to `/clientes`.

Public routes: `/login`, `/api/auth/*`, `/api/init-sheets`.

Auth uses NextAuth v4 with `CredentialsProvider` + JWT strategy. The `admin` user is **not stored in `usuarios`** — it falls back to `ADMIN_EMAIL` / `ADMIN_PASSWORD` env vars. The `configuracion` page detects this and offers an "Editar" row that materializes admin into the `usuarios` sheet on first save.

When adding a new `/api/*` route, decide whether operators need it and update the allowlist in [middleware.ts](middleware.ts).

## App layout

```
app/
  (dashboard)/        # authenticated, sidebar layout
    dashboard/        # KPIs + charts (admin)
    clientes/[id]/    # mascota fichas — peso_declarado vs peso_ingreso (price-tier delta alert)
    operaciones/      # tabs: ciclos | petroleo | vehiculo | despachos
    rendiciones/      # admin gastos + pagos (xlsx export, colored cells)
    bases/            # veterinarios
    configuracion/    # precios (3 tablas), productos, especies, tipos_servicio, usuarios
    reportes/         # xlsx export
  api/                # one folder per sheet/entity
  login/
lib/
  google-sheets.ts    # the only place that calls googleapis
  dates.ts            # canonical date formatting (Excel serial aware)
  format.ts           # CLP/kg/L formatting; re-exports formatDate as fmtFecha
  price-calculator.ts # tramo lookup across precios_generales/convenio/especiales
  certificate-generator.ts  # pdf-lib certificates
  google-drive.ts     # photo uploads
  codigo-generator.ts # cliente código generator
components/
  Sidebar.tsx · TimelineStatus.tsx · VehiculoTab.tsx · DespachosTab.tsx · ui/
scripts/
  apps_script_backup.gs   # Google Apps Script — daily 03:00 trigger, copies Sheet to Drive "Database" folder on days 5/10/15/20/25 + last (and 30 if month has 31)
```

## Cross-cutting conventions

- **Dates**: ISO (`YYYY-MM-DD`) on disk and in `<input type="date">`; **DD/MM/YYYY** in any user-visible string. For new date inputs, default to `todayISO()` from [lib/dates.ts](lib/dates.ts) — never `new Date().toISOString().split('T')[0]` (UTC shift bug at night in Chile).
- **Numbers**: format via [lib/format.ts](lib/format.ts) (`fmtPrecio`, `fmtNumero`, `fmtKg`, `fmtLitros`). Litros stored/displayed as integers; ratios with 1 decimal. Wrap litros differences in `Math.abs()` (carga direction is not enforced).
- **React lists**: when a `.map()` returns multiple sibling rows (e.g. main `<tr>` + expansion `<tr>`), wrap them in `<Fragment key={...}>` — bare `<>` triggers the duplicate-key warning.
- **Peso**: `peso_ingreso` (real) takes precedence over `peso_declarado` for price/ratio math; both are persisted. The ficha shows a price-delta alert when `peso_ingreso` falls in a higher tramo. Use `||` not `??` when reading either, since the sheet returns `''` (empty string), which `??` won't bypass.
- **Despachos** mutate `clientes.estado` (`cremado` ↔ `despachado`) and write `despacho_id`. Deleting a despacho reverts the affected mascotas.

## Environment variables

Required (see [README.md](README.md) for the full table): `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY` (with `\n` escaped), `GOOGLE_SPREADSHEET_ID`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`. Optional: `GOOGLE_DRIVE_FOLDER_ID` (photo uploads), `NEXT_PUBLIC_ADMIN_EMAIL` (UI hint for the admin-as-user row).

Deploy target is Vercel; backups are handled out-of-band by the Apps Script in [scripts/apps_script_backup.gs](scripts/apps_script_backup.gs), not by Vercel cron.
