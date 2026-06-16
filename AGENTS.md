<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## PetCrem — AI agent guide

Use this file as the primary workspace customization guide.
Also consult `CLAUDE.md` for expanded repo-specific architecture, Google Sheets conventions, and auth behavior.

### Commands

- `npm install`
- `npm run dev` — development server
- `npm run build` — production build and type-checking
- `npm run start` — production start
- `npm run lint` — lint rules

> There is no automated test suite in this repo. Use `npm run build` to catch type errors.

### Key architecture

- Framework: **Next.js 16 App Router** with **React 19.2.4** and **Tailwind v4**.
- Auth: **NextAuth v4** with `CredentialsProvider` + JWT.
- Database: el código está modelado como **Google Sheets**, pero el backend EN VIVO (local + prod) es **Postgres** (`DATA_BACKEND=postgres`, Supabase «Alma Animal»). Toda la I/O pasa por `lib/datastore.ts`. **Agregar una columna requiere un `ALTER TABLE` en Supabase** — editar `init-sheets` NO basta (en Postgres `ensureColumns` es no-op). Ver la sección "El backend EN VIVO es Postgres" en `CLAUDE.md`.
- Sheet access is centralized in `lib/google-sheets.ts` (camino Sheets); en prod se usa la capa `lib/datastore.ts`.
- API routes are one folder per entity under `app/api/`.
- Auth guard is implemented in `proxy.ts` (Next.js 16 replacement for middleware).

### Important repo conventions

- All Google Sheets read/write goes through `lib/google-sheets.ts`.
  - `getSheetData(name)` returns rows as `Record<string,string>` keyed by headers.
  - Dates from Sheets can be Excel serial numbers; use `lib/dates.ts` helpers.
  - `appendRow` / `updateRow` are header-driven; missing fields are written as empty strings.
  - `ensureSheet(name)` / `ensureColumns(name, columns[])` are idempotent.
  - `getNextId(sheet)` uses `max(id)+1` over the sheet.

- Schema changes must be reflected in `app/api/init-sheets/route.ts`.
  - No migrations; re-running `/api/init-sheets` adds missing columns only.

- Auth roles:
  - `admin` has full access.
  - `operador` is limited to specific dashboard and API prefixes in `proxy.ts`.
  - The admin fallback account is configured via `ADMIN_EMAIL` / `ADMIN_PASSWORD` and is not stored in the `usuarios` sheet until first edited.

- Date handling:
  - Persist ISO dates (`YYYY-MM-DD`) and HTML `date` inputs use ISO.
  - UI display uses `DD/MM/YYYY`.
  - Prefer `todayISO()` from `lib/dates.ts` over `new Date().toISOString().split('T')[0]`.

- Number formatting:
  - Use `lib/format.ts` helpers: `fmtPrecio`, `fmtNumero`, `fmtKg`, `fmtLitros`.
  - `litros` are integers; ratio values may use one decimal.

- `clientes` pricing logic:
  - `peso_ingreso` should take precedence over `peso_declarado`.
  - Use `||` not `??` because empty strings are returned from Sheets.

- React list rendering:
  - When a `.map()` emits sibling rows, wrap them in `<Fragment key={...}>`.

### Working with API routes

- Add routes under `app/api/` in one folder per sheet / entity.
- Consider operator access before adding a new API route; update `proxy.ts` allowlist accordingly.
- Public routes (gateadas en `proxy`): `/login`, `/api/auth/*`, `/api/init-sheets` (con auth interna: sesión admin-total o `Bearer CRON_SECRET`), `/api/reorder-columns`.

### Helpful files

- `README.md` — setup, env vars, high-level structure.
- `CLAUDE.md` — deeper repo rules, Google Sheets details, route auth behavior, and environment expectations.
- `lib/dates.ts` — canonical date parsing/formatting.
- `lib/google-sheets.ts` — single source of truth for all Sheets I/O.
- `proxy.ts` — auth gating and operator route allowlist.
- `app/api/init-sheets/route.ts` — canonical sheet schema.
- `app/(dashboard)` — authenticated app layout.

### What not to assume

- This repo is not a typical database-backed app. Do not add direct DB or SQL-like abstractions.
- Do not modify Google Sheets schema without updating `init-sheets` and validating the sheet structure.
- Avoid legacy Next.js App Router assumptions; use the current `app/` routing and `proxy.ts` conventions.
