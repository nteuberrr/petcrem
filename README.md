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

| Var | Uso |
| --- | --- |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | Service Account con acceso al Sheet |
| `GOOGLE_PRIVATE_KEY` | Clave privada del Service Account (con `\n` escapados) |
| `GOOGLE_SPREADSHEET_ID` | ID del Google Sheet que funciona de DB |
| `GOOGLE_DRIVE_FOLDER_ID` | Carpeta de Drive para uploads de fotos (opcional) |
| `NEXTAUTH_SECRET` | Secret de NextAuth (generar con `openssl rand -base64 32`) |
| `NEXTAUTH_URL` | URL de la app (`http://localhost:3000` en dev) |
| `ADMIN_EMAIL` · `ADMIN_PASSWORD` | Credenciales del admin fallback |

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
