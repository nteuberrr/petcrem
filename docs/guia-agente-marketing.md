# Guía definitiva del Agente de Marketing — Alma Animal

> Actualizada: 2026-07-13. Cubre el agente de chat (Campañas → Agente), el calendario de campañas, el autopiloto semanal y la gestión de Google Ads / Meta.

---

## 1. Qué es y dónde vive

Un solo agente (Claude, `lib/marketing-agente.ts`) con tres áreas de trabajo:

| Área | Qué hace | Dónde |
|---|---|---|
| **Contenido orgánico** | Planifica el calendario, genera posts/carruseles/correos, diseña placas y fotos, publica en IG/FB | `/mailing` → pestaña **Agente** (chat) + **Campañas** (calendario) |
| **Google Ads** | Lee campañas/keywords/términos reales, audita la cuenta, y con tu aprobación pausa/activa, cambia presupuestos, agrega negativas, crea RSAs y campañas nuevas | El mismo chat (herramientas `gads_*`) |
| **Métricas Meta** | Reporta gasto, alcance, CTR/CPC y rendimiento orgánico reales de Facebook/Instagram | El mismo chat (`reporte_metricas`) + pestaña **Métricas** |

Reglas de seguridad que ya trae de fábrica:
- **Nada se publica solo.** El agente propone y genera; publicar, programar y editar el perfil requieren tu pedido explícito.
- **Toda escritura en Google Ads exige confirmación**: el agente te resume la acción exacta (campaña, monto anterior → nuevo, gasto reciente) y espera tu "sí" antes de ejecutar.
- **Lo que crea en Google Ads nace EN PAUSA** (RSAs y campañas nuevas): nada gasta hasta que lo actives tú.
- **Nunca inventa precios ni métricas**: tarifas en vivo desde Configuración → Precios; métricas solo de las APIs reales.

---

## 2. El flujo de publicación (memorizá esta cadena)

```
propuesta → generada → aprobada → programada → publicada
```

- **propuesta**: solo la idea (fecha + canal + audiencia + objetivo). Barato.
- **generada**: ya tiene copy + imagen (o asunto + HTML si es email). Acá revisás.
- **aprobada**: le diste el visto bueno.
- **programada**: tiene fecha/hora y **se publica sola** cuando llega el momento (cron).
- Alternativas: **descartada** (queda en el historial) o archivada. Borrar es permanente — preferí descartar.

No se puede aprobar sin generar, ni programar sin aprobar. Si le pedís "programá X para el viernes", el agente hace la cadena completa en un solo turno.

---

## 3. Cómo pedirle cosas (recetario de prompts)

### Contenido suelto (verlo en el chat, sin agendar)
- «Hazme una placa con los horarios de atención» → usa plantillas maestras (layout probado, no se rompe).
- «Genera una foto de un golden retriever adulto en un living cálido» → foto sin texto.
- «Edita la i-3: cambia el collar a rojo» → edición puntual conservando el resto.
- «Muéstrame qué hay en el banco de fotos de mascotas».

### Publicaciones (agendar/publicar)
- «Crea un post para Instagram sobre la entrega en 3 días y prográmalo para el jueves a las 19:00» → hace propuesta + pieza + aprobación + programación de una vez.
- «Haz un carrusel de 5 láminas "por qué elegirnos" para IG».
- «Reutiliza la C-4 y súbela a Facebook» → copia el post completo con todas sus placas.
- «Publica la #23 ahora» → publicación inmediata (irreversible, pídelo solo cuando estés seguro).

### Correos a veterinarios
- «Propón el email del mes a la base de veterinarios sobre el convenio de eutanasias».
- Para retocar uno ya hecho: «En el correo #31 mete la tabla de precios después de los servicios» (usa el ajuste, no lo rehace).
- El envío final se hace desde Mailing, no desde el chat.

### Planificación
- «Planifica la próxima semana» → revisa el calendario, respeta la cadencia y los pilares configurados, y deja propuestas.
- «¿Qué hay agendado para esta semana?» / «Mueve la #18 al sábado» / «Descarta la #12».

### Google Ads — lectura (sin riesgo, pedilo cuando quieras)
- «¿Cómo van los anuncios de Google?» → gasto, CTR, CPC, conversiones, Impression Share.
- «Muéstrame las keywords con su Quality Score».
- «Revisa los términos de búsqueda del último mes» → tabla con veredicto BAD / KEEP / UNCERTAIN para limpiar gasto.
- «Audita la cuenta» → diagnóstico completo con severidad y $ estimado en juego.
- «Busca ideas de keywords nuevas para eutanasia a domicilio» → Keyword Planner real (volumen, competencia, puja).

### Google Ads — escritura (siempre con tu confirmación)
- «Pausa la campaña X» / «Sube el presupuesto de X a $25.000 diarios».
- «Agrega como negativas todos los BAD de la tabla».
- «Crea la lista de negativas universal» (afecta TODAS las campañas — te lo va a advertir).
- «Crea un RSA nuevo para el grupo Y» → redacta 15 titulares + 4 descripciones según el playbook, te muestra todo, y lo crea EN PAUSA.
- «Arma una campaña nueva para "crematorio de mascotas urgente"» → wizard completo (presupuesto + campaña + geo + negativas + keyword + RSA), todo en pausa hasta que la actives.

### Métricas, rentabilidad y bitácora
- «¿Cómo vamos en redes este mes?» → Meta Ads + orgánico con recomendaciones.
- **«¿Es rentable el marketing?» / «Dame el reporte de rentabilidad del mes»** → la métrica que manda: cruza el gasto real (Google + Meta) contra los leads del inbox, las fichas nuevas y los ingresos reales del sistema → CPA, CPL, ROAS, ticket promedio y tasa de cierre REALES, comparados con tus objetivos. La atribución es blended (aproximada) y el agente lo declara.
- **«¿Qué cambiamos este mes?» / «Muéstrame la bitácora»** → historial de todos los cambios ejecutados con aprobación (qué, cuándo, por qué, quién aprobó). La auditoría de Google Ads también la incluye automáticamente ("cambios recientes").
- «Audita el perfil de Facebook e Instagram» → revisa bio, datos, portada y recomienda.

---

## 4. Códigos del banco de imágenes

Toda imagen tiene un código estable — usalo para referirte a ellas:

- **i-N** — foto suelta (ej. `i-3`)
- **C-X.Y** — pieza de campaña: X = campaña, Y = lámina (ej. `C-12.1` = primera placa de la campaña 12)
- **v-N** — video · **ai-N** — video animado desde una foto

«Edita la i-3», «usa la C-2.1 en la pieza #21», «pon las 7 placas de la C-4 en el post de Facebook».

---

## 5. Parámetros: qué controla cada uno y cómo tenerlos

**Dónde:** Configuración → Configuración Avanzada → **Agentes** → agente de Marketing (solo el admin principal). Se guardan en `marketing_config.parametros` y el agente los lee en vivo — cambiarlos surte efecto al instante, sin deploy.

### Cadencia (usada por el planner y el autopiloto)
| Parámetro | Default | Recomendación |
|---|---|---|
| Posts IG / semana | 4 | 3–4 es sano; bajalo antes que publicar relleno |
| Carruseles IG / semana | 2 | 1–2; son las piezas que más retienen |
| Posts FB / semana | 2 | 2 está bien (FB tolera copy más largo) |
| Emails a vets / mes | 2 | **No subir de 2**: saturar la base B2B genera bajas y rebotes |
| Horarios | 13:00, 19:00 | Ajustalos cuando Métricas muestre tus horas reales de engagement |

### Pilares editoriales (mix del calendario)
Educación ~35% · Prueba social ~18% · Humanización ~15% · Comunidad ~15% · Servicio/oferta ~12% · Valores ~5%, con **tope de venta directa 20%** (regla 80/20). Está bien calibrado para un rubro sensible: el contenido de valor construye la confianza que después convierte. No lo toques salvo que un pilar demuestre rendir mucho más en Métricas.

### Números económicos (⚠️ completarlos es la mejora nº 1)
| Parámetro | Estado | Para qué sirve |
|---|---|---|
| Ticket promedio (CLP) | `null` | Base del valor del lead. El agente puede calcularlo con datos reales: pedile un «reporte de rentabilidad». |
| Tasa de cierre (%) | `null` | Fichas ÷ leads. También sale del reporte de rentabilidad. |
| Presupuesto mensual de pauta | `null` | Sin esto el agente NO propone gasto en ads (a propósito). Fijalo cuando decidas invertir. |
| CPA objetivo (CLP) | `null` | Costo máximo aceptable por venta. Referencia: el presupuesto diario sano es 3–5× este número. |
| CPL objetivo (CLP) | `null` | Costo máximo por lead. Techo racional: valor del lead (ticket × cierre). |
| Reparto de pauta | 45/32/13/10 | Google Search / Meta prospección / remarketing / testeo. Razonable como punto de partida. |

**Atajo:** pedile al agente «reporte de rentabilidad de los últimos 30 días» — devuelve ticket promedio y tasa de cierre reales del período; guarda esos valores en los parámetros (con eso la UI te muestra el valor del lead calculado, ej. ticket $150.000 × cierre 25% = lead $37.500). Son los números que el playbook de bidding usa para los valores de conversión en Google Ads — el agente los pide y nunca los inventa.

### Autopiloto (default: apagado)
Si lo activás: cada semana **planifica** la semana siguiente según cadencia y pilares, **genera** las piezas de a poco y te avisa por WhatsApp cuando el plan está listo para revisar. Todo queda en propuesta/generada — **nada se publica sin tu aprobación**. Recomendado: activarlo y adoptar la rutina de abajo; te ahorra la planificación en frío y vos solo aprobás/ajustás.

---

## 6. Rutina de operación recomendada

**Semanal (15–20 min) — lunes o martes:**
1. Revisar en Campañas el plan que dejó el autopiloto: aprobar lo que va, ajustar o descartar lo que no («cambia el título de la #40», «mueve la #41 al jueves»).
2. Programar las aprobadas (o pedírselo al agente de una vez).
3. Un vistazo a métricas: «¿cómo rindieron los posts de la semana?».

**Quincenal (10 min) — limpieza de Google Ads:**
1. «Revisa los términos de búsqueda de los últimos 14 días».
2. Aprobar los BAD → «agrega todos los BAD como negativas».
3. Los UNCERTAIN se deciden uno por uno (el agente lo exige, está bien así).

**Mensual (30 min) — control de resultados:**
1. **«Reporte de rentabilidad del último mes»** → el veredicto: CPA/CPL/ROAS reales vs tus objetivos. Si el CPA real supera el objetivo, la conversación es sobre calidad de leads y landing, no sobre subir presupuesto.
2. «Audita la cuenta de Google Ads» → hallazgos priorizados + los cambios recientes de la bitácora.
3. «Reporte de métricas de Meta del último mes» para el lado orgánico/social.
4. Email del mes a veterinarios si corresponde.

**Regla de oro al escalar:** no subas presupuesto solo porque hay conversiones. Antes: ¿los leads son de calidad (cierran)?, ¿la operación aguanta más retiros?, ¿el rendimiento lleva ≥2 semanas estable? Subí gradual (20–30% por vez) y no toques la campaña por 14 días después de cada cambio de puja (el algoritmo se reinicia).

---

## 7. Qué NO hace todavía (límites conocidos)

- **La atribución es blended, no exacta**: el reporte de rentabilidad cruza gasto total vs fichas de tutores del período, pero no rastrea qué clic produjo qué ficha (no hay gclid/UTM por lead todavía). Sirve como techo/piso confiable; no como CPA por campaña. *(Mejora futura: conversiones offline por lead.)*
- **No evalúa landing pages** (velocidad, mobile, coincidencia H1↔anuncio) — la auditoría solo detecta anuncios que apuntan al home. Se resuelve con la migración del sitio (landings por keyword).
- **No corre experimentos formales** (A/B con hipótesis y criterio de corte): la rotación de RSAs la optimiza Google, pero no hay registro estructurado de tests propios.
- **No hace remarketing** (decisión consciente: solo Search por ahora; además es un rubro sensible para perseguir gente con anuncios).
- **Instagram**: el perfil no se edita por API (te entrega los textos para pegar); TikTok fuera de alcance.

---

## 8. Chuleta de emergencia

| Quiero… | Digo… |
|---|---|
| Parar el gasto YA | «Pausa la campaña X» (confirma y listo) |
| Frenar el autopiloto | Configuración → Agentes → apagar autopiloto |
| Que no publique algo programado | «Descarta la #N» antes de su fecha/hora |
| Saber si algo se publicó | «¿Qué se publicó esta semana?» o mirar Campañas |
| Deshacer una negativa | «Quita X de las negativas de la campaña Y» / revisar en Google Ads |
| Un cambio que hizo y no recuerdo | «Muéstrame la bitácora de los últimos N días» |
| Saber si la plata rinde | «Reporte de rentabilidad del mes» |
