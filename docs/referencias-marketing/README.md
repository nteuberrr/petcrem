# Referencias de marketing (material externo)

Cuatro documentos tomados del paquete **[marketingskills](https://github.com/coreyhaines31/marketingskills)** de Corey Haines (MIT, © 2025 Corey Haines). Están acá como **material de consulta**, NO como skills: el paquete completo son 49 skills escritas para SaaS B2B (120 archivos mencionan SaaS, 118 B2B, 49 churn, 35 "free trial") y casi nada aplica a un crematorio local. Instalarlo entero metía 49 descripciones de skills inaplicables compitiendo por atención en cada sesión, a cambio de valor ocasional — así que se copió solo lo que sirve.

**Lo que NO cubren y acá importa**: negocio local (Google Business Profile, local pack, reseñas) y WhatsApp como canal, que en Alma Animal es *el* canal. Para eso no hay nada en el paquete; se resuelve con lo propio ([docs/playbook-atencion.md](../playbook-atencion.md), [docs/guia-agente-marketing.md](../guia-agente-marketing.md)).

| Archivo | Para qué lo tenemos |
|---|---|
| [conversion-tracking.md](conversion-tracking.md) | Cómo montar el seguimiento de conversiones y, sobre todo, las **conversiones offline**. Es el problema abierto de la cuenta: la conversión offline (gclid → `ads_clicks` → ficha con `precio_total`) nació SECUNDARIA, así que el 94% de lo que Google cuenta son clics a WhatsApp y el algoritmo puja a ciegas. |
| [google-search-playbook.md](google-search-playbook.md) | Estructura de cuenta, match types, negativas, ritual semanal de términos de búsqueda y la sección **Offline conversions**. ⚠️ Está escrito para B2B (su escalera de intención ejemplifica con "cold email software"): sirve la mecánica, no los ejemplos ni los benchmarks. |
| [measurement-paradigms.md](measurement-paradigms.md) | Criterio para no confundir la **señal de plataforma** con el resultado del negocio. Es el sesgo que se detectó en el informe de ads del 10-08-2026: celebraba que las conversiones pasaran de 36 a 119 con gasto plano, cuando las fichas reales solo fueron de 39 a 53 — eso es un cambio de medición, no de rendimiento. |
| [rsa-output-spec.md](rsa-output-spec.md) | Spec estricto para generar RSAs (límites de caracteres, sidecars, self-check). Hoy los titulares se arman a mano. |

Son textos de referencia para las personas y para el agente cuando se trabaje sobre la cuenta: **no** los lee ningún proceso automático. Si alguno se usa para calibrar un prompt (por ejemplo el del informe de ads), déjalo dicho en el prompt, no acá.
