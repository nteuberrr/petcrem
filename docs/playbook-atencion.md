# Playbook de atención — Crematorio Alma Animal

Cómo atendemos a un tutor que nos escribe (hoy por WhatsApp). Documento derivado del análisis de **354 conversaciones reales** (209 + 145 chats históricos). Sirve para calibrar el futuro asistente de "Mensajes", redactar plantillas y medir la operación.

> Marca y tono: ver [CLAUDE.md](../CLAUDE.md) → *Marca, propósito y voz* y la biblia completa en `C:\dev\alma-animal-marketing/_docs/biblia-visual-alma-animal.md`.

## Principios (lo que funciona, observado en los chats)

- **Responder rápido.** La mediana de respuesta histórica es **~3 minutos**. La rapidez es un diferenciador real.
- **Cálido pero sobrio, con tuteo.** Saludo + pésame breve, sin dramatismo. Emoji puntual (😔), nunca en exceso.
- **La mascota por su nombre** cuando se conoce; genérico **"tu mascota"** (no "compañero/a", no "su mascota").
- **Llevar la conversación al cierre** sin presionar: peso → valor → agendar → datos → retiro. El **68%** de los chats llega a pedir datos/agendar o a pago.
- **Precios SIEMPRE desde la tabla general configurada** (ver sección Precios). Nunca improvisar montos ni reusar precios viejos de memoria.

## Flujo de atención (tutor / B2C)

1. **Saludo + pésame** y oferta de ayuda.
2. **Pedir el peso aproximado** de la mascota (define el precio).
3. **Cotizar** el servicio más elegido (**Cremación Individual**) con el valor del tramo + qué incluye. Mencionar las otras dos opciones si pregunta o busca algo más económico.
4. **Invitar a agendar:** "¿Quieres agendar el servicio?"
5. **Tomar datos:** nombre + dirección (+ comuna) y coordinar **hora de retiro**.
6. **Pago:** indicar formas de pago / datos de transferencia y confirmar con comprobante.
7. **Cierre:** confirmar retiro, recordar plazo de entrega (4 días hábiles) y que recibirá ánfora + certificado.

## Plantillas (texto base real, con variables `{{}}`)

**Saludo + pésame / pedir peso**
> De parte del equipo *Alma Animal* lamentamos tu pérdida 😔 Estamos aquí para ayudarte.
> Para darte el valor exacto y coordinar el retiro, me indicas el *peso aproximado* de {{nombre_mascota}}.

**Cotización (Cremación Individual)**
> Gracias por la información. El servicio más elegido es *Cremación Individual*.
> El valor es *{{precio_ci}}* e incluye retiro a domicilio, código de trazabilidad, entrega de mechón de pelo en botellita, huella estampada en tarjeta, entrega de cenizas en ánfora + certificado de cremación.
> ¿Te confirmo el retiro? Solo necesito *nombre + dirección*.

**Invitar a agendar**
> ¿Quieres agendar el servicio?

**Tomar datos / coordinar retiro**
> Perfecto. Para coordinar el retiro necesito *nombre, dirección y comuna*. ¿A qué hora te queda cómodo?

**Pago**
> Las formas de pago son {{formas_pago}}. Una vez realizada la transferencia, envíame el comprobante y dejamos el retiro confirmado.

**Cierre**
> Listo {{nombre_tutor}}, retiro confirmado. Cuidaremos cada detalle de la despedida de {{nombre_mascota}}. La entrega es en 4 días hábiles e incluye ánfora + certificado. Cualquier cosa, aquí estamos.

> Estas plantillas son la base de las **respuestas tipo** del asistente y de las **plantillas de WhatsApp** (que Meta debe aprobar) cuando construyamos el módulo.

## Precios — regla de oro

**Los precios se cotizan SIEMPRE desde la tabla de precios generales configurada** en *Configuración → Precios* (`precios_generales`), según **peso** y **tipo de servicio**. No se usan los montos que aparezcan en chats históricos.

Tabla general vigente (CLP), por tramo de peso:

| Peso | Individual (CI) | Premium (CP) | Sin Devolución (SD) |
|------|----------------:|-------------:|--------------------:|
| 0–2 kg | $70.000 | $115.000 | $60.000 |
| 2–5 kg | $105.000 | $150.000 | $75.000 |
| 5–10 kg | $115.000 | $160.000 | $90.000 |
| 10–15 kg | $120.000 | $165.000 | $95.000 |
| 15–25 kg | $130.000 | $175.000 | $95.000 |
| 25–35 kg | $145.000 | $190.000 | $100.000 |
| 35–45 kg | $170.000 | $215.000 | $105.000 |
| 45+ kg | $195.000 | $240.000 | $120.000 |

Adicional configurado: **Transporte por distancia** $20.000. (Eutanasia a domicilio es un servicio aparte; ver `/servicios`.)

> Cuando exista el asistente, debe leer estos valores de `precios_generales` en vivo (vía `price-calculator`), no de este documento — esta tabla es solo referencia legible.

## Tipos de servicio

- **CI · Cremación Individual** — el más elegido. Incluye retiro a domicilio, código de trazabilidad, mechón de pelo en botellita, huella estampada en tarjeta, cenizas en ánfora + certificado.
- **CP · Cremación Premium** — Individual + adicionales/materiales premium.
- **SD · Cremación Sin Devolución** — no se devuelven cenizas; la opción más económica. (Ofrecerla cuando piden "algo más económico".)

Entrega: **4 días hábiles**, en instalaciones propias, con trazabilidad total.

## FAQ (preguntas reales de clientes + respuesta sugerida)

- **"¿Cuál es el valor?"** → Pedir peso y cotizar de la tabla (CI por defecto).
- **"¿Formas de pago?"** → {{formas_pago}} (transferencia + comprobante).
- **"¿Podemos estar en la cremación?"** → Responder según política real del negocio (definir).
- **"¿En cuánto tiempo entregan las cenizas?"** → 4 días hábiles.
- **"¿A qué hora pasan a retirar / horarios de retiro?"** → Coordinar según ruta del día (atención 08:00–23:00).
- **"¿El certificado lo envían por correo?"** → Sí; también va físico con la entrega.
- **"¿De qué material es el ánfora?"** → Responder según catálogo (definir / enlazar catálogo).
- **"¿Tienen algo más económico?"** → Ofrecer Sin Devolución (SD).
- **"¿Eutanasia + cremación, cuánto sale?"** → Eutanasia a domicilio es servicio aparte; derivar a ese flujo + sumar cremación.
- **Ubicación** → Compartir dirección/mapa (Recoleta, Santiago).

> Los campos marcados **(definir)** son políticas que conviene fijar contigo para que el asistente responda con un único criterio.

## Métricas base (para la futura analítica)

Sobre los 354 chats analizados: **6.322 mensajes** (≈43% nuestros / 57% del cliente), **68%** con señal de avance/cierre, **respuesta mediana ~3 min**. Servirán de línea base cuando midamos volumen, conversión y tiempos en el módulo de Mensajes.

## Qué NO hacer

- Improvisar precios o reusar montos históricos (usar siempre `precios_generales`).
- Vocabulario prohibido (ver biblia/CLAUDE): *muerto, cadáver, restos, perdiste*; clichés del rubro ("puente del arcoíris", "angelito"); referencias religiosas; humor.
- Prometer plazos u opciones que no estén configuradas.

---

*Fuente: 354 conversaciones reales de WhatsApp (carpetas `Downloads/Whatsapp 2` + repo de marketing). Documento vivo — se actualiza al definir políticas pendientes y con datos del módulo de Mensajes en operación.*
