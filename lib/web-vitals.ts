/**
 * Velocidad REAL del sitio público, medida en el navegador de cada visitante
 * (Core Web Vitals: LCP, CLS, INP, TTFB) y guardada en la tabla `web_vitals`.
 *
 * Por qué medimos nosotros en vez de mirar PageSpeed:
 *  - PageSpeed/Lighthouse es LABORATORIO: un dispositivo y una red simulados. Sirve
 *    para comparar antes/después, no para saber qué vive el cliente real.
 *  - Los datos de campo de Google (CrUX, los de Search Console) exigen un mínimo de
 *    tráfico que este sitio no alcanza (~25 visitas/día) → el informe sale vacío.
 *  - Acá cada visita reporta, así que hay dato desde el primer día, y separado por
 *    móvil/escritorio y por si vino de un anuncio (gclid en la URL).
 *
 * Se reporta el p75 (lo que vive el 75% peor de las visitas), que es el criterio
 * que usa Google: LCP bueno ≤ 2,5 s · necesita mejora ≤ 4 s · malo > 4 s.
 */
import { getSupabase } from './supabase'

export interface VitalEntrada {
  ruta: string
  dispositivo: 'movil' | 'escritorio'
  fuente: 'ads' | 'organico'
  lcp?: number | null
  cls?: number | null
  inp?: number | null
  ttfb?: number | null
}

const TZ = 'America/Santiago'
const hoyChile = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())

/** Guarda una medición. Best-effort: nunca debe romper la página del visitante. */
export async function registrarVital(v: VitalEntrada): Promise<void> {
  const { error } = await getSupabase().from('web_vitals').insert({
    fecha: hoyChile(),
    ruta: v.ruta.slice(0, 120),
    dispositivo: v.dispositivo,
    fuente: v.fuente,
    lcp: v.lcp ?? null,
    cls: v.cls ?? null,
    inp: v.inp ?? null,
    ttfb: v.ttfb ?? null,
  })
  if (error) throw new Error(error.message)
}

function percentil(valores: number[], p: number): number | null {
  const xs = valores.filter(n => Number.isFinite(n)).sort((a, b) => a - b)
  if (!xs.length) return null
  const i = Math.min(xs.length - 1, Math.max(0, Math.ceil((p / 100) * xs.length) - 1))
  return xs[i]
}

export interface ResumenVitals {
  desde: string
  muestras: number
  /** p75 por dispositivo: la lectura que importa (Google evalúa con p75). */
  porDispositivo: Array<{ dispositivo: string; muestras: number; lcp: number | null; cls: number | null; inp: number | null; ttfb: number | null }>
  /** Las 5 rutas con peor LCP (mínimo 5 muestras para no leer ruido). */
  peoresRutas: Array<{ ruta: string; muestras: number; lcp: number | null }>
  veredicto: string
}

/** Etiqueta el LCP con el criterio de Google (segundos). */
export function veredictoLcp(lcpMs: number | null): string {
  if (lcpMs == null) return 'sin datos'
  const s = (lcpMs / 1000).toFixed(1).replace('.', ',')
  if (lcpMs <= 2500) return `${s} s · bueno`
  if (lcpMs <= 4000) return `${s} s · necesita mejora`
  return `${s} s · malo`
}

export async function resumenVitals(dias = 28): Promise<ResumenVitals> {
  const d = new Date(Date.now() - dias * 86400e3)
  const desde = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
  const { data, error } = await getSupabase()
    .from('web_vitals')
    .select('ruta,dispositivo,lcp,cls,inp,ttfb')
    .gte('fecha', desde)
    .limit(20000)
  if (error) throw new Error(error.message)
  const filas = (data || []) as Array<{ ruta: string; dispositivo: string; lcp: number | null; cls: number | null; inp: number | null; ttfb: number | null }>

  const porDisp = ['movil', 'escritorio'].map(dispositivo => {
    const f = filas.filter(x => x.dispositivo === dispositivo)
    return {
      dispositivo,
      muestras: f.length,
      lcp: percentil(f.map(x => Number(x.lcp)).filter(Boolean), 75),
      cls: percentil(f.map(x => Number(x.cls)).filter(n => Number.isFinite(n)), 75),
      inp: percentil(f.map(x => Number(x.inp)).filter(Boolean), 75),
      ttfb: percentil(f.map(x => Number(x.ttfb)).filter(Boolean), 75),
    }
  }).filter(x => x.muestras > 0)

  const rutas = new Map<string, number[]>()
  for (const f of filas) {
    if (!f.lcp) continue
    const arr = rutas.get(f.ruta) || []
    arr.push(Number(f.lcp))
    rutas.set(f.ruta, arr)
  }
  const peoresRutas = [...rutas.entries()]
    .filter(([, v]) => v.length >= 5)
    .map(([ruta, v]) => ({ ruta, muestras: v.length, lcp: percentil(v, 75) }))
    .sort((a, b) => (b.lcp ?? 0) - (a.lcp ?? 0))
    .slice(0, 5)

  const movil = porDisp.find(x => x.dispositivo === 'movil')
  const veredicto = !filas.length
    ? 'Sin mediciones todavía (el script reporta desde la primera visita al sitio).'
    : `LCP móvil (p75): ${veredictoLcp(movil?.lcp ?? null)} sobre ${movil?.muestras ?? 0} visitas.`

  return { desde, muestras: filas.length, porDispositivo: porDisp, peoresRutas, veredicto }
}
