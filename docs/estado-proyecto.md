# Alma Animal / Petcrem — Estado del proyecto

> Documento maestro de estado. Fuente para volcar a Notion.
> Última actualización: 2026-07-16

Sistema de gestión del Crematorio Alma Animal (Next.js 16 + React 19 + Tailwind v4,
backend Postgres/Supabase «Alma Animal», deploy en Vercel).
**Regla de deploy:** siempre por CLI (`npx vercel deploy --prod --yes`) — el auto-deploy de GitHub es poco confiable. Cuenta Hobby: `maxDuration→60s`, crons solo diarios.

---

## 1. Resumen ejecutivo

- **Núcleo operativo:** desplegado y en producción (fichas, ciclos, despachos, rendiciones, precios, certificados, correos transaccionales, EERR).
- **Backend:** cutover a Postgres HECHO (prod + local comparten la base Supabase «Alma Animal»).
- **Canales de mensajería:** inbox unificado + agente IA de WhatsApp en producción; Instagram DM con código listo, pendiente config en Meta.
- **Marketing:** todas las tandas (calidad de piezas, campañas social, gestión de Ads Meta+Google, rentabilidad+bitácora, banco, marca visual) **desplegadas**. Queda solo config del dueño (creds Meta social + Vercel Cron) y etapas 2-4 de autonomía (opt-in).
- **Facturación (OpenFactura/SII):** probada en sandbox, pendiente de cablear al flujo real.

> **Revisado contra git (2026-07-16):** `main` local == `origin/main`, nada sin pushear. Todo lo que la memoria marcaba "build verde sin deploy" ya está commiteado y en producción. Lo pendiente es config externa / decisiones del dueño, no código por desplegar.

---

## 2. Módulos — estado y próximo paso

| Módulo | Estado | Próximo paso |
|---|---|---|
| Migración a Postgres | ✅ Desplegado (cutover hecho) | Recordar: columna nueva = ALTER en Supabase (init-sheets es no-op en pg) |
| Núcleo (fichas/ciclos/despachos/rendiciones) | ✅ Desplegado | — |
| Certificados firmados (PAdES) | ✅ Desplegado | — |
| Correos transaccionales + catálogo | ✅ Desplegado | — |
| EERR (Estado de Resultados) | ✅ Desplegado (2026-06-22) | — |
| Roles y permisos dinámicos | ✅ Desplegado | — |
| Inbox Mensajes + agente WhatsApp | ✅ Desplegado | — |
| WhatsApp plantillas aprobadas | ✅ Desplegado (2026-07-11) | — |
| Agente agenda eutanasias | ✅ Desplegado (2026-07-02) | — |
| Seguimiento de leads | ✅ Desplegado (ab80a0b) | — |
| Auditorías bughunt (1/2/3) | ✅ Todas desplegadas | — |
| Landings de captación (SEO) | ✅ Desplegado (últimos commits) | — |
| **Instagram DM** | 🟡 Código listo (commit 3be211c) | Config webhook `instagram` en panel Meta + toggle en app IG + App Review |
| **Google Ads — optimización jul-2026** | 🟡 Tanda 15-07 aplicada por API | Seguimiento ~29-jul (IS meta 50-55%, evaluar tCPA); dueño: Clicks-to-call $1 + próximo escalón presupuesto |
| **OpenFactura (boletas/facturas SII)** | 🟡 Probado en sandbox (folio emitido) | Cablear: trigger al confirmar pago + DB + UI + factura convenio |
| Cobros + bot productos adicionales | ✅ Desplegado (440efd0, 3286912, 8913322) | — (incluye fix cobro indebido ánfora premium) |
| Migración web (Webflow→app + CMS) | ✅ EN VIVO desde cutover DNS 2026-07-14 | Menor: detalle servicio CMS-driven + monitorear GSC/404 |
| Marketing: calidad + autonomía | ✅ Desplegado (plantillas + autopiloto etapa 1 OFF) | Etapas 2-4 de autonomía (requieren OK dueño) |
| Marketing: campañas social + agente | ✅ Desplegado (A+B+C, 2026-06-28) | Dueño: META_PAGE_ID/META_IG_USER_ID en Vercel + Vercel Cron; App Review para DMs |
| Gestión de Ads (Meta+Google) | ✅ Desplegado (Fases A-E + rentabilidad/bitácora 888a54c + vigilancia 91e06a8) | Seguimiento operativo (landings ya publicadas) |
| Banco: códigos + rediseño galería | ✅ Desplegado | — |
| Documentos PDF (catálogo + dossier) | ✅ Desplegado (catálogo 45db754 + dossier) | Menor: dueño corrige typo del giro en Datos Personales |
| Marca visual (imágenes) | ✅ Desplegado (satori ca9aad2 + variedad 395ae17) | — |
| Diferenciadores oficiales | 🟡 Fuente única en lib | Setear `plazo_entrega_dias` = 3 en despachos |
| WhatsApp grupo admin (OBA) | ⏸️ En espera de Official Business Account | No re-proponer alternativas (decisión dueño) |
| WhatsApp Coexistence | ❌ Descartado (código dormido) | No retomar salvo pedido explícito |

Leyenda: ✅ desplegado · 🟡 en curso / listo con pendiente externo · 🟠 build verde local sin deploy · ⏸️ en espera · ❌ descartado

---

## 3. Pendientes priorizados

### Alta prioridad — desplegar lo que ya está verde
1. **Cobros + bot productos adicionales** — funcionalidad de negocio (cobra diferencias y adicionales). Deploy.
2. **Marketing (calidad + campañas social + gestión Ads)** — 3 tandas construidas sin salir. Consolidar y desplegar.
3. **Banco de imágenes (códigos + galería)** y **Docs PDF** — mejoras listas, deploy.

### Media — cablear / configurar externo
4. **OpenFactura** — cablear emisión de DTE al confirmar pago.
5. **Instagram DM** — configurar en panel de Meta + App Review.
6. **Migración web** — reproducir sitio y cutover DNS.

### Seguimiento / operativo
7. **Google Ads** — revisión ~29-jul; pendientes del dueño (clics-to-call, presupuesto).
8. **Diferenciadores** — setear `plazo_entrega_dias = 3`.

---

## 4. Notas / decisiones vigentes

- **Voz de marca:** español neutro (no voseo); mascota por su nombre, genérico "tu mascota".
- **Descuentos de convenio:** aplican solo al precio de cremación, nunca a adicionales.
- **Tramo de precio en el borde:** siempre el tramo menor (`findTramo` en lib/tramos.ts).
- **Deploy:** nunca `git push` sin aprobación explícita en el turno anterior.
- **Secret local ≠ prod:** links firmados de cara al cliente hay que generarlos en prod, no por script local.
