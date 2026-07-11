# PetCrem — Alma Animal

Sistema de gestión para crematorio de mascotas: fichas de clientes, ciclos de cremación, control de petróleo, precios por veterinaria (general / convenio / especial), certificados PDF y dashboard con KPIs.

Stack: **Next.js 16 (App Router) · TypeScript · Tailwind v4 · NextAuth · Google Sheets API · pdf-lib · Recharts**.

## Módulos

- **Dashboard** — KPIs del mes (mascotas, ingresos, ciclos, pagos pendientes, stock petróleo), ratios de eficiencia y gráficos (ventas, especies, top veterinarias, top productos).
- **Clientes** — Fichas de mascotas con peso, especie, tipo de servicio (CI/CP/SD), veterinaria asignada, adicionales (productos + servicios), pago y notas.
- **Operaciones** — Ciclos de cremación (con mascotas, horario y litros) y control de carga de petróleo (neto/IVA/específico/total bruto).
- **Bases de datos** — Registro de veterinarios.
- **Configuración** — Precios (generales, convenio, especiales por vet con tramos reordenables), productos, especies, tipos de servicio, otros servicios y usuarios.
- **Reportes** — Exportación Excel (ejecutivo, por veterinaria).

## Setup local

```bash
npm install
cp .env.example .env.local   # completar con valores reales
npm run dev
```

### Variables de entorno

**Núcleo (requeridas):**

| Var | Uso |
| --- | --- |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | Service Account con acceso al Sheet |
| `GOOGLE_PRIVATE_KEY` | Clave privada del Service Account (con `\n` escapados) |
| `GOOGLE_SPREADSHEET_ID` | ID del Google Sheet que funciona de DB (modo Sheets) |
| `DATA_BACKEND` | `postgres` (prod/local hoy) o `sheets`; ver [lib/datastore.ts](lib/datastore.ts) |
| `SUPABASE_URL` · `SUPABASE_SERVICE_ROLE_KEY` | Proyecto Supabase principal (backend Postgres + logs de correo) |
| `NEXTAUTH_SECRET` | Secret de NextAuth (generar con `openssl rand -base64 32`); firma también los tokens HMAC de eutanasias/borradores |
| `NEXTAUTH_URL` | URL de la app (`http://localhost:3000` en dev) |
| `PUBLIC_APP_URL` | URL pública para links en correos (pixel/click tracking, botones); si falta cae a `NEXTAUTH_URL` |
| `ADMIN_EMAIL` · `ADMIN_PASSWORD` | Credenciales del admin fallback (rol admin total, id `0`) |
| `NEXT_PUBLIC_ADMIN_EMAIL` | Hint de UI para la fila del admin en Configuración |
| `CRON_SECRET` | Bearer para `/api/init-sheets`, `/api/backup` y crons |

**Correo (Resend) y seguimiento:**

| Var | Uso |
| --- | --- |
| `RESEND_API_KEY` | Requerida para todo envío de correo |
| `MAILING_FROM_EMAIL` · `MAILING_FROM_NAME` | Remitente (default sandbox `onboarding@resend.dev` / `Alma Animal`) |
| `MAILING_REPLY_TO` | Reply-To opcional |
| `RESEND_WEBHOOK_SECRET` | Verificación svix del webhook de Resend (fail-closed en prod) |
| `MAILING_DISABLE_OWN_TRACKING` | `true` desactiva el pixel/click propio |
| `MAILING_WEBHOOK_PERMISSIVE` | SOLO dev: acepta webhook sin firma (ignorada en prod) |
| `EMPRESA_TELEFONO_CONTACTO` · `EMPRESA_WEB` · `GOOGLE_REVIEW_URL` | Footer/links de los correos (con defaults; editable vía empresa_config) |

**WhatsApp / Mensajes / Agentes IA:**

| Var | Uso |
| --- | --- |
| `WHATSAPP_TOKEN` · `WHATSAPP_PHONE_NUMBER_ID` | Cloud API de Meta (envío) |
| `META_APP_SECRET` · `WHATSAPP_VERIFY_TOKEN` | Verificación del webhook (fail-closed en prod) |
| `WHATSAPP_BUSINESS_ACCOUNT_ID` · `WHATSAPP_API_VERSION` | Opcionales (default `v22.0`) |
| `ADMIN_WHATSAPP` | Número del dueño para confirmaciones/avisos (default el número real del dueño) |
| `MENSAJES_SUPABASE_URL` · `MENSAJES_SUPABASE_SERVICE_ROLE_KEY` | Proyecto Supabase SEPARADO del inbox Mensajes |
| `ANTHROPIC_API_KEY` | Agente del inbox + generador de campañas (modelos: `ANTHROPIC_MODEL`, `ANTHROPIC_MAILING_MODEL`) |
| `AGENTE_AUTO_RESPONDER` | Kill-switch del agente (default `true`) |
| `GEMINI_API_KEY` | Imágenes de campañas (opcional; `GEMINI_IMAGE_MODEL`, `GEMINI_API_VERSION`) |
| `META_GRAPH_TOKEN` · `META_PAGE_ID` · `META_IG_USER_ID` · `META_BUSINESS_ID` · `META_AD_ACCOUNT_ID` | Publicación social del módulo Campañas |

**Otros módulos:**

| Var | Uso |
| --- | --- |
| `R2_ACCOUNT_ID` · `R2_ACCESS_KEY_ID` · `R2_SECRET_ACCESS_KEY` · `R2_BUCKET_NAME` · `R2_PUBLIC_URL` | Cloudflare R2 (certificados, HTML de campañas, media) — bucket con dominio público |
| `R2_BACKUP_BUCKET_NAME` | Bucket R2 SEPARADO y SIN dominio público, solo para respaldos (`/api/backup`, `scripts/respaldo-proyecto.ts`). Sin esta var, los respaldos caen al bucket público de arriba (solo protegidos por una key inadivinable) |
| `CERT_P12_BASE64` · `CERT_P12_PASSWORD` · `CERT_SIGNER_NAME` | Firma digital PKCS#7 de certificados (opcional) |
| `GOOGLE_MAPS_API_KEY` | Geocoding + Places (server-side; cacheado en `geocoding_cache`) |
| `GOOGLE_DRIVE_FOLDER_ID` · `GOOGLE_DRIVE_CERTIFICADOS_FOLDER_ID` | Uploads a Drive (opcional) |
| `NEXT_PUBLIC_FB_APP_ID` · `NEXT_PUBLIC_FB_COEX_CONFIG_ID` | Coexistence WhatsApp (código dormido) |
| `HEALTHCHECK_URL_BACKUP` · `HEALTHCHECK_URL_ARCHIVAR` | Opcional: URL de un monitor (ej. Healthchecks.io) que hace ping `/api/backup` y `/api/mensajes/cron-archivar` al terminar (éxito y fallo), para detectar si el cron dejó de correr en silencio |

## Deploy en Vercel

1. Push el repo a GitHub.
2. En [vercel.com/new](https://vercel.com/new) importar el repo.
3. Cargar todas las variables de entorno de arriba en **Settings → Environment Variables** (usar Production + Preview).
4. En cuanto termine el build, actualizar `NEXTAUTH_URL` con la URL definitiva de Vercel.

## Estructura

```
app/
  (dashboard)/          # layout con sidebar, rutas autenticadas
    dashboard/          # KPIs + charts
    clientes/           # lista + ficha individual
    operaciones/        # ciclos + petróleo
    bases/              # veterinarios
    configuracion/      # precios, productos, especies, usuarios, etc.
    reportes/
  api/                  # endpoints de CRUD contra Google Sheets
  login/
lib/
  google-sheets.ts      # wrapper + ensureSheet / ensureColumn / moveRow
  certificate-generator.ts  # PDF con pdf-lib
  format.ts             # formateo CLP, litros, kg, fechas
components/
  ui/                   # Modal, Toggle, Badge
  Sidebar.tsx
```
