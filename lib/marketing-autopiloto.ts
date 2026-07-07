import Anthropic from '@anthropic-ai/sdk'
import { getMarketingParams, updateMarketingParams, type MarketingParams } from './marketing-params'
import { listarCalendario, crearItems, actualizarItem, type NuevoItem, type ItemCalendario } from './marketing-calendario'
import { generarPieza } from './marketing-pieza'
import { DIFERENCIADORES, MODALIDADES_SERVICIOS } from './diferenciadores'
import { avisarAdminsWhatsapp, isWhatsappConfigured } from './whatsapp'

/**
 * AUTOPILOTO DE MARKETING — Etapa 1 del roadmap de autonomía.
 *
 * Una vez por semana, PLANIFICA el calendario de la semana siguiente (respetando
 * la cadencia y los pilares de marketing-params) y va GENERANDO las piezas de a
 * poco (1 por tick del cron externo, para no exceder el tiempo). Todo queda en
 * estado 'propuesta' → 'generada': NADA se publica ni se programa solo. El dueño
 * aprueba pieza por pieza en Campañas. El QA (con best-of) actúa de gate: las
 * piezas con observaciones se marcan para que el dueño las mire.
 *
 * Kill-switch: params.autopiloto_activo (default FALSE). No corre hasta que el
 * dueño lo activa desde la UI (Configuración → agente de Marketing).
 */

const TZ = 'America/Santiago'
const MODEL = process.env.ANTHROPIC_MARKETING_MODEL || 'claude-sonnet-4-6'

let client: Anthropic | null = null
function getClient(): Anthropic {
  if (client) return client
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) throw new Error('ANTHROPIC_API_KEY no configurada')
  client = new Anthropic({ apiKey: key })
  return client
}

// ─── Fechas (Chile) ──────────────────────────────────────────────────────────
function hoyChileISO(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}
function addDaysISO(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() + n)
  return dt.toISOString().slice(0, 10)
}
/** 0 = lunes … 6 = domingo. */
function diaSemana(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number)
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7
}
/** Lunes de la PRÓXIMA semana (siempre planificamos con una semana de anticipación). */
function lunesProximo(iso: string): string {
  return addDaysISO(iso, 7 - diaSemana(iso))
}

// ─── Planificación (LLM) ─────────────────────────────────────────────────────
const TOOL_PLAN: Anthropic.Tool = {
  name: 'proponer_plan',
  description: 'Devuelve los ítems del calendario semanal propuestos.',
  input_schema: {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        description: 'Ítems propuestos para la semana, balanceados por pilar y canal.',
        items: {
          type: 'object',
          properties: {
            fecha: { type: 'string', description: 'YYYY-MM-DD, dentro de la semana indicada.' },
            hora: { type: 'string', description: 'HH:MM (24h), uno de los horarios sugeridos.' },
            canal: { type: 'string', enum: ['instagram', 'facebook', 'email'] },
            audiencia: { type: 'string', enum: ['tutores', 'veterinarios', 'ambos'] },
            objetivo: { type: 'string', enum: ['captacion_vets', 'recordacion', 'educacion_tutores', 'postventa', 'promocion'] },
            titulo: { type: 'string', description: 'Título corto/gancho.' },
            idea: { type: 'string', description: 'La idea a comunicar, 1-2 frases concretas.' },
          },
          required: ['fecha', 'canal', 'idea'],
        },
      },
    },
    required: ['items'],
  },
}

async function planificarSemana(
  params: MarketingParams,
  ventana: { lunes: string; domingo: string },
  deficit: { instagram: number; facebook: number; email: number },
): Promise<NuevoItem[]> {
  if (!process.env.ANTHROPIC_API_KEY) return []
  const fechas: string[] = []
  for (let i = 0; i < 7; i++) fechas.push(addDaysISO(ventana.lunes, i))
  const existentes = (await listarCalendario({ desde: ventana.lunes, hasta: ventana.domingo })).filter(it => it.activa !== 'FALSE')
  const ocupadas = existentes.map(it => `- ${it.fecha} ${it.canal}: ${(it.titulo || it.idea || '').slice(0, 60)}`).join('\n') || '(nada aún)'
  const pilares = params.pilares.map(p => `${p.label} (~${p.pct}%)`).join('; ')

  const system = `Sos el Director de Marketing de Crematorio Alma Animal (cremación de mascotas, Recoleta, Santiago de Chile; cobertura RM; lema "Huellas que no se borran"). Planificás un CALENDARIO semanal de contenido orgánico, balanceado y on-brand. Español neutro de Chile (NUNCA voseo argentino), sin clichés del rubro ("puente del arcoíris", "angelito"), sin humor, sin religión.
CANALES: instagram y facebook = público general (tutores y comunidad); email = B2B a la base de VETERINARIOS.
PILARES EDITORIALES (repartí las ideas según estos %): ${pilares}. Regla 80/20: MÁXIMO ${params.venta_directa_max_pct}% de venta directa; el resto entrega valor, emoción o comunidad.
${DIFERENCIADORES}
${MODALIDADES_SERVICIOS}
REGLAS: no inventes precios, promociones ni plazos; ideas CONCRETAS y accionables (no genéricas); variá temas y ángulos entre piezas; para veterinarios usá voz B2B (retiro en menos de 3 horas, atención de lunes a domingo, entrega en 3 días hábiles, precios convenientes, trazabilidad total, red de eutanasia a domicilio). Considerá fechas relevantes de Chile si caen en la semana. Devolvé SIEMPRE con la herramienta proponer_plan.`

  const instruccion = `Semana ${ventana.lunes} a ${ventana.domingo}. Días disponibles: ${fechas.join(', ')}.
Ya planificado (respetalo, NO dupliques ni satures esos días):
${ocupadas}
Proponé EXACTAMENTE: ${deficit.instagram} post(s) de Instagram, ${deficit.facebook} de Facebook y ${deficit.email} email(s) a veterinarios. Repartilos en días DISTINTOS, con hora de entre ${params.horarios_publicacion.join(' o ')}. Balanceá los pilares editoriales y las dos audiencias. Cada ítem: fecha (dentro de la semana), hora, canal, audiencia, objetivo, un título corto y una idea de 1-2 frases.`

  const res = await getClient().messages.create({
    model: MODEL,
    max_tokens: 2000,
    system,
    tools: [TOOL_PLAN],
    tool_choice: { type: 'tool', name: 'proponer_plan' },
    messages: [{ role: 'user', content: instruccion }],
  })
  const tu = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === 'proponer_plan')
  const raw = (tu?.input as { items?: Array<Record<string, string>> })?.items
  if (!Array.isArray(raw)) return []

  const canales = new Set(['instagram', 'facebook', 'email'])
  const enVentana = new Set(fechas)
  const out: NuevoItem[] = []
  for (const it of raw) {
    const canal = String(it.canal || '').trim()
    if (!canales.has(canal)) continue
    const fecha = enVentana.has(String(it.fecha)) ? String(it.fecha) : fechas[out.length % 7]
    out.push({
      fecha,
      hora: /^\d{1,2}:\d{2}$/.test(String(it.hora)) ? String(it.hora) : (params.horarios_publicacion[0] || '13:00'),
      canal,
      audiencia: String(it.audiencia || (canal === 'email' ? 'veterinarios' : 'tutores')),
      objetivo: String(it.objetivo || ''),
      titulo: String(it.titulo || '').slice(0, 120),
      idea: String(it.idea || '').slice(0, 500),
      estado: 'propuesta',
      generado_por: 'autopiloto',   // marcador: la generación incremental lo busca por acá
      creadoPor: 'autopiloto',
    })
  }
  return out
}

export interface ResultadoAutopiloto {
  semana: string
  planificadas: number
  generadas: number
  pendientes: number
  observaciones: string[]
}

/**
 * Corre el autopiloto (best-effort): planifica la semana si aún no lo hizo y genera
 * hasta `maxGenerar` piezas pendientes. Devuelve null si está desactivado.
 */
export async function correrAutopilotoSemanal(opts: { maxGenerar?: number } = {}): Promise<ResultadoAutopiloto | null> {
  const params = await getMarketingParams()
  if (!params.autopiloto_activo) return null

  const hoy = hoyChileISO()
  const lunes = lunesProximo(hoy)
  const domingo = addDaysISO(lunes, 6)
  const observaciones: string[] = []
  let planificadas = 0

  // 1) PLANIFICAR (una sola vez por semana objetivo).
  if (params.autopiloto_ultima_semana !== lunes) {
    try {
      const existentes = (await listarCalendario({ desde: lunes, hasta: domingo })).filter(it => it.activa !== 'FALSE')
      const cnt = (c: string) => existentes.filter(it => it.canal === c).length
      const deficit = {
        instagram: Math.max(0, params.ig_posts_semana - cnt('instagram')),
        facebook: Math.max(0, params.fb_posts_semana - cnt('facebook')),
        email: Math.max(0, Math.round(params.email_por_mes / 4) - cnt('email')),
      }
      if (deficit.instagram + deficit.facebook + deficit.email > 0) {
        const items = await planificarSemana(params, { lunes, domingo }, deficit)
        if (items.length) { await crearItems(items); planificadas = items.length }
      }
      // Marca la semana como planificada aunque el déficit fuera 0 (no re-evaluar).
      // Se hace ANTES de generar: si el write falla (falta la columna), abortamos
      // para no re-planificar en cada tick.
      await updateMarketingParams({ autopiloto_ultima_semana: lunes })
      if (planificadas > 0 && isWhatsappConfigured()) {
        try {
          await avisarAdminsWhatsapp(`🗓️ Autopiloto: planifiqué ${planificadas} pieza(s) para la semana del ${lunes}. Quedan como propuestas; las voy generando y te aviso cuando estén para revisar en Campañas. Nada se publica solo.`)
        } catch { /* best-effort */ }
      }
    } catch (e) {
      console.error('[autopiloto] planificación falló:', e)
      return { semana: lunes, planificadas: 0, generadas: 0, pendientes: 0, observaciones: ['No se pudo planificar la semana (revisá que la columna marketing_config.parametros exista).'] }
    }
  }

  // 2) GENERAR incrementalmente las piezas del autopiloto que siguen en 'propuesta'.
  let generadas = 0
  let pendientes = 0
  try {
    const pend = (await listarCalendario({ desde: lunes, hasta: domingo }))
      .filter(it => it.estado === 'propuesta' && it.generado_por === 'autopiloto' && it.activa !== 'FALSE')
      .sort((a, b) => (a.fecha || '').localeCompare(b.fecha || '') || (parseInt(a.id, 10) || 0) - (parseInt(b.id, 10) || 0))
    const max = Math.max(1, opts.maxGenerar ?? 1)
    for (const it of pend.slice(0, max)) {
      try {
        const r = await generarPieza(it.id)
        generadas++
        const altas = r.avisos.filter(a => /QA|encimad|cortad|ilegible|logo|contraste|foto|marca/i.test(a))
        if (altas.length) {
          observaciones.push(`#${it.id} (${it.titulo || it.canal}): ${altas[0]}`)
          try { await actualizarItem(it.id, { notas: `⚠️ Revisar (QA): ${altas.join(' · ')}`.slice(0, 400) }) } catch { /* */ }
        }
      } catch (e) {
        console.error('[autopiloto] no se pudo generar', it.id, e)
        observaciones.push(`#${it.id}: no se pudo generar automáticamente`)
        // Sacarlo de la cola automática para no reintentarlo en loop; queda como
        // propuesta para que el dueño la genere/ajuste a mano.
        try { await actualizarItem(it.id, { generado_por: 'autopiloto_fallo' }) } catch { /* */ }
      }
    }
    pendientes = Math.max(0, pend.length - generadas)

    // ¿Se terminó de generar toda la semana en este tick? Avisar que está lista.
    if (generadas > 0 && pendientes <= 0 && isWhatsappConfigured()) {
      try {
        await avisarAdminsWhatsapp(`✅ Autopiloto: el plan de la semana del ${lunes} está listo para tu revisión en Campañas${observaciones.length ? ` (${observaciones.length} pieza(s) con observaciones de QA)` : ''}. Aprobá y programá las que te gusten — nada se publica sin tu OK.`)
      } catch { /* best-effort */ }
    }
  } catch (e) {
    console.error('[autopiloto] generación falló:', e)
  }

  return { semana: lunes, planificadas, generadas, pendientes, observaciones }
}
