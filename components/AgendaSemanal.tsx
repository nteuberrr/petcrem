'use client'
import { Fragment, useState, useEffect, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { Stethoscope, Hospital, PawPrint, CalendarDays } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import NuevaSolicitudModal from '@/components/NuevaSolicitudModal'
import { useAccionUnica } from '@/lib/use-accion-unica'
import { fmtPrecio } from '@/lib/format'

type Item = {
  id: string; tipo: 'retiro' | 'eutanasia'; fecha: string; hora: string; bloque: number
  estado: 'pendiente' | 'confirmada'; mascota: string; quien: string; esVet: boolean
  comuna: string; direccion: string; tipo_servicio?: string; clienteId?: string
  horaEutanasia?: string; esperandoHoraVet?: boolean; sinCremacion?: boolean
  /** Valor a cobrar por lo agendado (lo calcula /api/agenda). */
  valor?: number; valorEstimado?: boolean
}

// Bloqueo manual de la agenda (tabla agenda_bloqueos): rango fecha/hora en el que
// el bot no puede agendar. Rango [inicio, fin): la hora de término ya es agendable.
type Bloqueo = {
  id: string; desde: string; horaDesde: string; hasta: string; horaHasta: string
  motivo: string; creadoPor: string; fechaCreacion: string
}

const HORAS = Array.from({ length: 16 }, (_, i) => 8 + i) // 8..23 (la agenda muestra de 08:00 a 24:00)
const DIAS_LBL = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
const SERVICIO: Record<string, string> = { CI: 'Individual', CP: 'Premium', SD: 'Sin Devolución' }

// Grilla estilo Google Calendar: cada hora mide HOUR_PX y los eventos se
// posicionan por su minuto real, con alto proporcional a la duración del bloque.
const HOUR_PX = 56                 // alto en px de una hora de la grilla
const START_MIN = 8 * 60           // 08:00 (primera línea de la agenda)
const END_MIN = 24 * 60            // 24:00 (última línea)
const TOTAL_PX = HORAS.length * HOUR_PX
const DURACION_MIN = 45            // alto del bloque hacia abajo = bloqueo DESPUÉS de la reserva (45 min)
const SOMBRA_ANTES_MIN = 30        // bloqueo ANTES de la reserva (dueño 2026-07-24): 30 min
// Si no es null, fuerza la hora que muestra la línea roja de "ahora" (para
// previsualizar). En producción va en null → usa la hora real de Chile.
const DEMO_LINEA_AHORA: { h: number; m: number } | null = null
// Trama diagonal para la "sombra" de bloqueo (los 30 min previos a una reserva en
// los que el bot no puede agendar otra; ver SEP_ANTES en lib/agenda).
const SOMBRA_BG = 'repeating-linear-gradient(45deg, rgba(100,116,139,0.10) 0, rgba(100,116,139,0.10) 5px, rgba(100,116,139,0.22) 5px, rgba(100,116,139,0.22) 10px)'
// Trama roja para los BLOQUEOS manuales de agenda (el bot no agenda ahí).
const BLOQUEO_BG = 'repeating-linear-gradient(45deg, rgba(220,38,38,0.10) 0, rgba(220,38,38,0.10) 6px, rgba(220,38,38,0.20) 6px, rgba(220,38,38,0.20) 12px)'

/** Minutos desde medianoche del inicio de un item (fallback: bloque, luego 08:00). */
function minutosDe(it: Item): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(it.hora || '')
  if (m) return Number(m[1]) * 60 + Number(m[2])
  if (it.bloque >= 0) return it.bloque * 60
  return START_MIN
}

type Colocado = { it: Item; startMin: number; endMin: number; col: number; cols: number }

/**
 * Posiciona los eventos de un día y reparte los que se solapan en columnas
 * lado a lado (como Google Calendar). Agrupa en "clusters" de eventos que se
 * encadenan por solapamiento; dentro de cada cluster cada evento toma la primera
 * columna libre y todos comparten el mismo número total de columnas.
 */
function layoutDia(itemsDia: Item[]): Colocado[] {
  const evs = itemsDia
    .map(it => {
      const start = Math.min(END_MIN, Math.max(START_MIN, minutosDe(it)))
      return { it, startMin: start, endMin: Math.min(END_MIN, start + DURACION_MIN) }
    })
    .sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin)

  const out: Colocado[] = []
  let cluster: Array<Colocado> = []
  let clusterEnd = -1
  const flush = () => {
    const cols = cluster.reduce((mx, c) => Math.max(mx, c.col + 1), 1)
    for (const c of cluster) out.push({ ...c, cols })
    cluster = []
    clusterEnd = -1
  }
  for (const e of evs) {
    if (cluster.length && e.startMin >= clusterEnd) flush()
    const usados = new Set(cluster.filter(c => c.endMin > e.startMin).map(c => c.col))
    let col = 0
    while (usados.has(col)) col++
    cluster.push({ ...e, col, cols: 1 })
    clusterEnd = Math.max(clusterEnd, e.endMin)
  }
  if (cluster.length) flush()
  return out
}

/** "HH:MM" → minutos desde medianoche (null si no calza). */
function hhmmMin(s: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec((s || '').trim())
  return m ? Number(m[1]) * 60 + Number(m[2]) : null
}

/**
 * Minutos que un bloqueo tapa de UNA fecha (null si no la toca). Un bloqueo de
 * varios días tapa completos los días intermedios. Espejo de rangosDelDia en lib/agenda.
 */
function rangoBloqueoEnDia(b: Bloqueo, iso: string): { ini: number; fin: number } | null {
  if (iso < b.desde || iso > b.hasta) return null
  const ini = iso === b.desde ? (hhmmMin(b.horaDesde) ?? 0) : 0
  const fin = iso === b.hasta ? (hhmmMin(b.horaHasta) ?? 24 * 60) : 24 * 60
  return fin > ini ? { ini, fin } : null
}

/** Texto legible de un bloqueo para la lista del modal. */
function rotuloBloqueo(b: Bloqueo): string {
  const dia = (iso: string) => { const [y, m, d] = iso.split('-'); return `${d}/${m}/${y.slice(2)}` }
  const todoElDia = b.horaDesde <= '00:00' && b.horaHasta >= '23:59'
  if (b.desde === b.hasta) return todoElDia ? `${dia(b.desde)} · todo el día` : `${dia(b.desde)} · ${b.horaDesde}–${b.horaHasta}`
  return `${dia(b.desde)} ${b.horaDesde} → ${dia(b.hasta)} ${b.horaHasta}`
}

/** YYYY-MM-DD en horario local (evita el corrimiento UTC). */
function isoLocal(d: Date): string {
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}
/** Hora actual en Chile (para la línea de "ahora"). */
function nowChile(): { iso: string; h: number; m: number } {
  const now = new Date()
  const iso = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
  const hhmm = new Intl.DateTimeFormat('es-CL', { timeZone: 'America/Santiago', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now)
  const [h, m] = hhmm.split(':').map(Number)
  return { iso, h: h || 0, m: m || 0 }
}

/** Lunes de la semana de hoy + offset (en semanas). */
function lunesDe(offsetSemanas: number): Date {
  const d = new Date()
  d.setHours(12, 0, 0, 0)
  const dow = (d.getDay() + 6) % 7 // 0 = lunes
  d.setDate(d.getDate() - dow + offsetSemanas * 7)
  return d
}
/** Ícono del tipo de agendamiento (SVG, no emoji: se ve igual en todo equipo). */
function IconoTipo({ it, className = 'w-3 h-3 shrink-0' }: { it: Item; className?: string }) {
  if (it.tipo === 'eutanasia') return <Stethoscope className={className} aria-hidden="true" />
  return it.esVet ? <Hospital className={className} aria-hidden="true" /> : <PawPrint className={className} aria-hidden="true" />
}
function detalle(it: Item): string {
  const eutSinCrem = it.tipo === 'eutanasia' && it.sinCremacion
  const partes = [
    it.tipo === 'eutanasia'
      ? (eutSinCrem ? `Eutanasia · SIN cremación (solo recordatorio)` : `Eutanasia · retiro del crematorio`)
      : `Retiro de cremación`,
    it.mascota && `Mascota: ${it.mascota}`,
    it.quien && `${it.esVet ? 'Veterinario' : 'Tutor'}: ${it.quien}`,
    it.tipo_servicio && `Servicio: ${SERVICIO[it.tipo_servicio] || it.tipo_servicio}`,
    it.valor != null && (it.valor > 0
      ? `Valor a cobrar: ${fmtPrecio(it.valor)}${it.valorEstimado ? ' (estimado)' : ''}`
      : 'Valor a cobrar: falta el peso para calcularlo'),
    (it.direccion || it.comuna) && `${[it.direccion, it.comuna].filter(Boolean).join(', ')}`,
    eutSinCrem
      ? 'Sin retiro del crematorio: el chofer no pasa a buscarla. No bloquea la agenda.'
      : it.tipo === 'eutanasia' && it.esperandoHoraVet
      ? `⏳ Esperando que el veterinario informe la hora de retiro (se muestra en la hora de la eutanasia${it.horaEutanasia ? ` ${it.horaEutanasia}` : ''})`
      : it.estado === 'pendiente' ? 'Pendiente de confirmación' : 'Confirmado',
    it.tipo === 'eutanasia' ? '→ Clic: abre la ficha de la eutanasia' : null,
  ].filter(Boolean)
  return partes.join('\n')
}

/**
 * Agenda semanal en el Dashboard (entre las notificaciones y el Timeline).
 * Grilla días × horas (08:00–24:00) con los retiros de cremación y los retiros
 * de eutanasia coordinados. AMARILLO = por confirmar (retiro pendiente, o
 * eutanasia esperando la hora del veterinario); VERDE = confirmado. Se refresca
 * sola cada 30s. Solo lectura (confirmar/rechazar vive en las notificaciones).
 */
export default function AgendaSemanal() {
  const router = useRouter()
  const [offset, setOffset] = useState(0)
  const [items, setItems] = useState<Item[]>([])
  const [bloqueos, setBloqueos] = useState<Bloqueo[]>([])
  const [cargado, setCargado] = useState(false)
  // Hora actual (Chile) para la línea de "ahora"; null hasta montar (evita
  // desajuste de hidratación con el SSR). Se refresca cada minuto.
  const [ahora, setAhora] = useState<{ iso: string; h: number; m: number } | null>(null)
  useEffect(() => {
    setAhora(nowChile())
    const t = setInterval(() => setAhora(nowChile()), 60000)
    return () => clearInterval(t)
  }, [])

  const lunes = useMemo(() => lunesDe(offset), [offset])
  const dias = useMemo(() => Array.from({ length: 7 }, (_, i) => {
    const d = new Date(lunes); d.setDate(lunes.getDate() + i)
    return { iso: isoLocal(d), num: d.getDate(), mes: d.getMonth() }
  }), [lunes])
  const hoyIso = isoLocal(new Date())

  const cargar = useCallback(async () => {
    try {
      const from = dias[0].iso, to = dias[6].iso
      const r = await fetch(`/api/agenda?from=${from}&to=${to}`, { cache: 'no-store' })
      if (!r.ok) return
      const d = await r.json()
      setItems(Array.isArray(d?.items) ? d.items : [])
      setBloqueos(Array.isArray(d?.bloqueos) ? d.bloqueos : [])
    } catch { /* reintenta al próximo tick */ } finally { setCargado(true) }
  }, [dias])

  useEffect(() => {
    cargar()
    const t = setInterval(cargar, 30000)
    return () => clearInterval(t)
  }, [cargar])

  const rango = `${dias[0].num} ${MESES[dias[0].mes]} – ${dias[6].num} ${MESES[dias[6].mes]}`
  const total = items.length

  // Edición rápida de la hora directamente desde la agenda (sin abrir la ficha,
  // para no arriesgar un "Registrar ficha" accidental que avise al tutor). Solo
  // para retiros; las eutanasias abren su ficha en Servicios (la hora la coordina
  // el veterinario, pero ahí se confirma si se realizó o no).
  const [editando, setEditando] = useState<Item | null>(null)
  const [nuevaHora, setNuevaHora] = useState('')
  const [errorEdit, setErrorEdit] = useState('')
  const { ejecutar, procesando } = useAccionUnica()

  const abrir = (it: Item) => {
    if (it.tipo === 'retiro') {
      setEditando(it)
      setNuevaHora(it.hora || '')
      setErrorEdit('')
    } else {
      // Eutanasia: abre SU ficha, donde se confirma si se realizó o no (la ven
      // todos los roles). El id del item viene como `e<idCotizacion>`.
      router.push(`/eutanasias/${encodeURIComponent(it.id.replace(/^e/, ''))}`)
    }
  }

  async function guardarHora(forzar = false) {
    if (!editando) return
    const hora = nuevaHora.trim()
    if (!/^([01]?\d|2[0-3]):[0-5]\d$/.test(hora)) { setErrorEdit('Indica una hora válida (HH:MM).'); return }
    setErrorEdit('')
    try {
      // Mover la hora es un cambio que el cliente tiene que saber: se pregunta
      // antes de mandarle nada (nunca se avisa por sorpresa al corregir un dato).
      const avisar = window.confirm(
        `¿Le avisamos del cambio de horario a ${editando.mascota || 'la mascota'}?\n\n` +
        'Aceptar: le mandamos el mensaje con la hora nueva.\nCancelar: solo cambio la hora.',
      )
      const r = await fetch('/api/agenda', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: editando.id, hora, avisar, forzar }),
      })
      const d = await r.json().catch(() => ({}))
      // 409 = choca con otra reserva; se muestra y se deja decidir.
      if (r.status === 409) {
        if (window.confirm(`${d?.error || 'Esa hora choca con otra reserva.'}\n\n¿La dejamos igual?`)) {
          await guardarHora(true)
        }
        return
      }
      if (!r.ok) { setErrorEdit(d?.error || 'No se pudo actualizar la hora.'); return }
      if (avisar && d?.aviso && !d.aviso.enviado) {
        alert(`La hora quedó cambiada, pero NO se pudo avisar: ${d.aviso.motivo || 'error desconocido'}. Avísale tú.`)
      }
      setEditando(null)
      await cargar()
    } catch { setErrorEdit('Error de red. Intenta de nuevo.') }
  }

  // Alta manual de una solicitud de retiro (antes vivía en /clientes como
  // "Agendamiento manual"): se decide acá, mirando los huecos de la semana.
  const [modalSolicitud, setModalSolicitud] = useState(false)

  // ── Bloqueo manual de la agenda ────────────────────────────────────────────
  // Rango fecha/hora en el que el bot NO puede agendar (mantención, viaje del
  // chofer, un día cerrado…). Se guarda en agenda_bloqueos y lo respeta
  // evaluarSlotRetiro / horaLibreEnFranja (lib/agenda).
  const [modalBloqueo, setModalBloqueo] = useState(false)
  const [bDesde, setBDesde] = useState('')
  const [bHoraDesde, setBHoraDesde] = useState('09:00')
  const [bHasta, setBHasta] = useState('')
  const [bHoraHasta, setBHoraHasta] = useState('21:10')
  const [bTodoElDia, setBTodoElDia] = useState(false)
  const [bMotivo, setBMotivo] = useState('')
  const [errorBloqueo, setErrorBloqueo] = useState('')
  // id del bloqueo que se está editando (null = el formulario crea uno nuevo).
  const [bEditando, setBEditando] = useState<string | null>(null)
  // Todos los bloqueos vigentes (desde hoy), no solo los de la semana visible.
  const [bloqueosLista, setBloqueosLista] = useState<Bloqueo[]>([])
  const { ejecutar: ejecutarBloqueo, procesando: procesandoBloqueo } = useAccionUnica()

  const cargarBloqueosLista = useCallback(async () => {
    try {
      const r = await fetch(`/api/agenda/bloqueos?from=${hoyIso}`, { cache: 'no-store' })
      if (!r.ok) return
      const d = await r.json()
      setBloqueosLista(Array.isArray(d?.bloqueos) ? d.bloqueos : [])
    } catch { /* la lista queda como estaba */ }
  }, [hoyIso])

  /** Deja el formulario en modo "nuevo bloqueo". */
  const resetFormBloqueo = useCallback(() => {
    setBEditando(null)
    setBDesde(hoyIso); setBHasta(hoyIso)
    setBHoraDesde('09:00'); setBHoraHasta('21:10')
    setBTodoElDia(false); setBMotivo(''); setErrorBloqueo('')
  }, [hoyIso])

  const abrirModalBloqueo = (editar?: Bloqueo) => {
    resetFormBloqueo()
    if (editar) cargarEnForm(editar)
    setModalBloqueo(true)
    cargarBloqueosLista()
  }

  /** Carga un bloqueo existente en el formulario para editarlo. */
  function cargarEnForm(b: Bloqueo) {
    setBEditando(b.id)
    setBDesde(b.desde); setBHasta(b.hasta)
    setBHoraDesde(b.horaDesde); setBHoraHasta(b.horaHasta)
    setBTodoElDia(b.horaDesde <= '00:00' && b.horaHasta >= '23:59')
    setBMotivo(b.motivo || ''); setErrorBloqueo('')
  }

  /** Crea el bloqueo, o guarda los cambios si se está editando uno. */
  async function guardarBloqueo() {
    if (!bDesde) { setErrorBloqueo('Indica la fecha de inicio.'); return }
    const hasta = bHasta || bDesde
    const hDesde = bTodoElDia ? '00:00' : bHoraDesde
    const hHasta = bTodoElDia ? '23:59' : bHoraHasta
    if (!/^([01]?\d|2[0-3]):[0-5]\d$/.test(hDesde) || !/^([01]?\d|2[0-3]):[0-5]\d$/.test(hHasta)) {
      setErrorBloqueo('Indica horas válidas (HH:MM).'); return
    }
    if (hasta < bDesde) { setErrorBloqueo('La fecha de término no puede ser anterior a la de inicio.'); return }
    if (hasta === bDesde && hHasta <= hDesde) { setErrorBloqueo('La hora de término debe ser posterior a la de inicio.'); return }
    setErrorBloqueo('')
    const payload = { fecha_inicio: bDesde, hora_inicio: hDesde, fecha_fin: hasta, hora_fin: hHasta, motivo: bMotivo.trim() }
    try {
      const r = await fetch('/api/agenda/bloqueos', {
        method: bEditando ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bEditando ? { id: bEditando, ...payload } : payload),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) { setErrorBloqueo(d?.error || (bEditando ? 'No se pudo actualizar el bloqueo.' : 'No se pudo bloquear la agenda.')); return }
      resetFormBloqueo()
      await Promise.all([cargar(), cargarBloqueosLista()])
    } catch { setErrorBloqueo('Error de red. Intenta de nuevo.') }
  }

  async function quitarBloqueo(id: string) {
    setErrorBloqueo('')
    try {
      const r = await fetch(`/api/agenda/bloqueos?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) { setErrorBloqueo(d?.error || 'No se pudo quitar el bloqueo.'); return }
      if (bEditando === id) resetFormBloqueo()
      await Promise.all([cargar(), cargarBloqueosLista()])
    } catch { setErrorBloqueo('Error de red. Intenta de nuevo.') }
  }

  return (
    <div className="bg-white rounded-2xl shadow-md border border-gray-300 p-4 sm:p-5">
      {/* Encabezado + navegación */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          <CalendarDays className="w-5 h-5 text-brand" aria-hidden="true" />
          <h2 className="text-sm sm:text-base font-bold text-brand">Agenda de la semana</h2>
          <span className="text-xs text-gray-500 hidden sm:inline">· {rango}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <button onClick={() => setModalSolicitud(true)} title="Registrar a mano un retiro: crea la ficha «Por ingresar» y le avisa al tutor por WhatsApp"
            className="px-3 h-8 rounded-lg bg-brand text-white text-xs font-semibold hover:bg-brand-dark shadow-md transition-colors mr-1">
            + Nueva solicitud
          </button>
          <button onClick={() => abrirModalBloqueo()} title="Cerrar un rango de fecha/hora para que el bot no agende ahí"
            className="px-3 h-8 rounded-lg border border-red-300 bg-red-50 text-xs font-semibold text-red-700 hover:bg-red-100 transition-colors mr-1">
            Bloquear agenda
          </button>
          <button onClick={() => setOffset(o => o - 1)} title="Semana anterior"
            className="w-8 h-8 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-100 transition-colors">‹</button>
          <button onClick={() => setOffset(0)} disabled={offset === 0}
            className="px-3 h-8 rounded-lg border border-gray-300 text-xs font-semibold text-gray-700 hover:bg-gray-100 disabled:opacity-40 transition-colors">Hoy</button>
          <button onClick={() => setOffset(o => o + 1)} title="Semana siguiente"
            className="w-8 h-8 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-100 transition-colors">›</button>
        </div>
      </div>

      {/* Leyenda */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mb-3 text-[11px] text-gray-600">
        <span className="sm:hidden font-medium text-gray-500">{rango}</span>
        <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded bg-amber-200 border border-amber-400" /> Por confirmar</span>
        <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded bg-emerald-200 border border-emerald-400" /> Confirmado</span>
        <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded bg-gray-200 border border-gray-400" /> Eutanasia sin cremación (recordatorio)</span>
        <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded border border-gray-300" style={{ background: SOMBRA_BG }} /> Bloqueo 30 min</span>
        <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded border border-red-300" style={{ background: BLOQUEO_BG }} /> Agenda bloqueada</span>
        <span className="inline-flex items-center gap-1"><PawPrint className="w-3 h-3" aria-hidden="true" /> Retiro · <Hospital className="w-3 h-3" aria-hidden="true" /> Vet · <Stethoscope className="w-3 h-3" aria-hidden="true" /> Eutanasia</span>
      </div>

      {/* MÓVIL: la grilla semanal no entra en 390px (se veían 3 de 7 días), así que
          acá la agenda es una lista de días hacia abajo mostrando solo las etiquetas
          de cada agendamiento. La grilla tipo calendario queda para ≥768px. */}
      <div className="md:hidden divide-y divide-gray-200 border-t border-gray-200">
        {dias.map((d, i) => {
          const esHoy = d.iso === hoyIso
          const delDia = items.filter(it => it.fecha === d.iso).sort((a, b) => minutosDe(a) - minutosDe(b))
          const bloqueosDia = bloqueos.filter(b => rangoBloqueoEnDia(b, d.iso))
          return (
            <div key={d.iso} className="py-2.5">
              <div className="flex items-baseline gap-2 mb-1.5">
                <span className={`text-sm font-bold ${esHoy ? 'text-brand' : 'text-gray-700'}`}>
                  {DIAS_LBL[i]} {d.num}
                </span>
                {esHoy && <span className="rounded-full bg-brand px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">Hoy</span>}
                {delDia.length > 0 && <span className="ml-auto text-[11px] text-gray-500">{delDia.length}</span>}
              </div>

              {bloqueosDia.map(b => (
                <button key={`mb${b.id}`} onClick={() => abrirModalBloqueo(b)}
                  className="mb-1 flex w-full items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-left min-h-11">
                  <span className="text-[11px] font-bold uppercase tracking-wide text-red-700">Bloqueada</span>
                  <span className="truncate text-xs text-red-800">{rotuloBloqueo(b)}</span>
                </button>
              ))}

              {delDia.length === 0 && bloqueosDia.length === 0 ? (
                <p className="text-xs text-gray-400">Sin agendamientos.</p>
              ) : (
                <div className="space-y-1">
                  {delDia.map(it => {
                    const gris = it.tipo === 'eutanasia' && it.sinCremacion
                    const amarillo = it.estado === 'pendiente'
                    const cls = gris
                      ? 'bg-gray-100 border-gray-300 text-gray-700'
                      : amarillo
                      ? 'bg-amber-100 border-amber-300 text-amber-900'
                      : 'bg-emerald-100 border-emerald-300 text-emerald-900'
                    return (
                      <button key={it.id} onClick={() => abrir(it)}
                        className={`flex w-full items-center gap-2 rounded-xl border px-3 py-2 text-left min-h-11 ${cls}`}>
                        <span className="text-xs font-bold tabular-nums">{it.hora}</span>
                        <IconoTipo it={it} className="w-3.5 h-3.5 shrink-0" />
                        <span className="truncate text-xs font-medium">{it.mascota || it.quien || '—'}</span>
                        {it.tipo === 'eutanasia' && it.esperandoHoraVet && <span className="ml-auto text-xs" title="Esperando hora del veterinario">⏳</span>}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Grilla estilo Google Calendar: columnas continuas, evento posicionado por
          su hora real y con alto proporcional a la duración (bloque de 45 min). */}
      <div className="hidden md:block overflow-x-auto">
        <div className="min-w-[760px]">
          {/* Encabezado de días */}
          <div className="grid" style={{ gridTemplateColumns: '52px repeat(7, minmax(96px, 1fr))' }}>
            <div />
            {dias.map((d, i) => {
              const esHoy = d.iso === hoyIso
              return (
                <div key={d.iso}
                  className={`text-center py-1.5 rounded-t-lg text-xs font-semibold ${esHoy ? 'bg-brand text-white' : 'text-gray-600'}`}>
                  <div>{DIAS_LBL[i]}</div>
                  <div className={`text-[13px] ${esHoy ? 'text-white' : 'text-gray-800'}`}>{d.num}</div>
                </div>
              )
            })}
          </div>

          {/* Cuerpo: columna de horas + 7 columnas de día (continuas) */}
          <div className="grid pt-2" style={{ gridTemplateColumns: '52px repeat(7, minmax(96px, 1fr))' }}>
            {/* Etiquetas horarias */}
            <div className="relative" style={{ height: TOTAL_PX }}>
              {HORAS.map((h, i) => (
                <div key={h} className="absolute right-1.5 -translate-y-1/2 text-right text-[11px] font-medium text-gray-400 tabular-nums"
                  style={{ top: i * HOUR_PX }}>
                  {String(h).padStart(2, '0')}:00
                </div>
              ))}
              <div className="absolute right-1.5 -translate-y-1/2 text-right text-[11px] font-medium text-gray-400 tabular-nums" style={{ top: TOTAL_PX }}>24:00</div>
            </div>

            {/* Columnas de día. La línea roja de "ahora" cruza TODAS las columnas
                (misma hora del día); el punto va solo en la columna de hoy. */}
            {dias.map(d => {
              const esHoy = d.iso === hoyIso
              const colocados = layoutDia(items.filter(it => it.fecha === d.iso))
              const nowMin = DEMO_LINEA_AHORA ? DEMO_LINEA_AHORA.h * 60 + DEMO_LINEA_AHORA.m
                : ahora ? ahora.h * 60 + ahora.m : null
              const nowTop = nowMin != null ? (nowMin - START_MIN) / 60 * HOUR_PX : null
              const nowVisible = nowTop != null && nowTop >= 0 && nowTop <= TOTAL_PX
              const esColHoy = DEMO_LINEA_AHORA ? d.iso === hoyIso : (!!ahora && ahora.iso === d.iso)
              return (
                <div key={d.iso} className={`relative border-l border-b border-gray-200 ${esHoy ? 'bg-brand/5' : ''}`} style={{ height: TOTAL_PX }}>
                  {/* Líneas de hora */}
                  {HORAS.map((h, i) => (
                    <div key={h} className="absolute left-0 right-0 border-t border-gray-200" style={{ top: i * HOUR_PX }} />
                  ))}
                  {/* Bloqueos manuales de la agenda (el bot no agenda dentro de estas franjas) */}
                  {bloqueos.map(b => {
                    const r = rangoBloqueoEnDia(b, d.iso)
                    if (!r) return null
                    const ini = Math.max(START_MIN, r.ini), fin = Math.min(END_MIN, r.fin)
                    if (fin <= ini) return null
                    const top = (ini - START_MIN) / 60 * HOUR_PX
                    const alto = (fin - ini) / 60 * HOUR_PX
                    return (
                      // Clickeable → abre el bloqueo para editarlo (los eventos van
                      // en z-10, así que siguen ganando el clic donde se encimen).
                      <button key={`b${b.id}`} onClick={() => abrirModalBloqueo(b)}
                        className="absolute left-0 right-0 z-0 border-y border-red-200 cursor-pointer"
                        style={{ top, height: alto, background: BLOQUEO_BG }}
                        title={`Agenda bloqueada${b.motivo ? `: ${b.motivo}` : ''} · clic para editar`}>
                        {alto >= 28 && (
                          <span className="absolute top-0.5 left-1 text-[9px] font-bold uppercase tracking-wide text-red-700/80">Bloqueado</span>
                        )}
                      </button>
                    )
                  })}
                  {/* Sombra de bloqueo (30 min previos a cada reserva) + evento */}
                  {colocados.map(({ it, startMin, endMin, col, cols }) => {
                    const top = (startMin - START_MIN) / 60 * HOUR_PX
                    const alto = Math.max(20, (endMin - startMin) / 60 * HOUR_PX)
                    const wPct = 100 / cols
                    const izq = `calc(${col * wPct}% + 1px)`
                    const ancho = `calc(${wPct}% - 2px)`
                    const gris = it.tipo === 'eutanasia' && it.sinCremacion
                    const amarillo = it.estado === 'pendiente'
                    // Las eutanasias SIN cremación no ocupan la agenda del chofer → sin sombra.
                    const sombraTop = (Math.max(START_MIN, startMin - SOMBRA_ANTES_MIN) - START_MIN) / 60 * HOUR_PX
                    const sombraAlto = top - sombraTop
                    const cls = gris
                      ? 'bg-gray-100 border-gray-300 text-gray-600 hover:bg-gray-200'
                      : amarillo
                      ? 'bg-amber-100 border-amber-300 text-amber-900 hover:bg-amber-200'
                      : 'bg-emerald-100 border-emerald-300 text-emerald-900 hover:bg-emerald-200'
                    return (
                      <Fragment key={it.id}>
                        {!gris && sombraAlto > 2 && (
                          <div className="absolute rounded-t-md pointer-events-none z-0"
                            style={{ top: sombraTop, height: sombraAlto, left: izq, width: ancho, background: SOMBRA_BG }}
                            title="Separación mínima: no se agenda dentro de los 30 min previos a esta reserva" />
                        )}
                        <button onClick={() => abrir(it)} title={detalle(it)}
                          className={`absolute overflow-hidden text-left rounded-md border px-1.5 py-0.5 leading-tight transition-colors z-10 cursor-pointer ${cls}`}
                          style={{ top: top + 1, height: alto - 2, left: izq, width: ancho }}>
                          <div className="flex items-center gap-1 text-[11px] font-bold">
                            <span>{it.hora}</span>
                            <IconoTipo it={it} />
                            {it.tipo === 'eutanasia' && it.esperandoHoraVet && <span title="Esperando hora del veterinario">⏳</span>}
                          </div>
                          <div className="text-[10px] font-medium truncate">{it.mascota || it.quien || '—'}</div>
                        </button>
                      </Fragment>
                    )
                  })}
                  {/* Línea de "ahora" (cruza todas las columnas; punto solo en hoy) */}
                  {nowVisible && (
                    <div className="absolute left-0 right-0 h-[2px] bg-red-500 z-30 pointer-events-none"
                      style={{ top: nowTop! }} title={`Ahora · ${String(Math.floor(nowMin! / 60)).padStart(2, '0')}:${String(nowMin! % 60).padStart(2, '0')}`}>
                      {esColHoy && <span className="absolute -left-1 -top-[3px] w-2 h-2 rounded-full bg-red-500" />}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {cargado && total === 0 && (
        <p className="text-center text-xs text-gray-400 mt-3">Sin agendamientos esta semana.</p>
      )}

      {/* Alta manual de una solicitud de retiro. Al crearla, refrescamos la
          agenda para que el nuevo bloque aparezca al instante. */}
      <NuevaSolicitudModal
        open={modalSolicitud}
        onClose={() => setModalSolicitud(false)}
        onCreada={cargar}
      />

      {/* Edición rápida de la hora del retiro (sin abrir la ficha). */}
      <Modal open={!!editando} onClose={() => setEditando(null)} title="Ajustar hora del retiro">
        {editando && (
          <div className="space-y-4">
            <div>
              <p className="font-bold text-gray-900">{editando.mascota || editando.quien || 'Retiro'}</p>
              <p className="text-xs text-gray-500 mt-0.5">
                {editando.esVet ? <Hospital className="w-3.5 h-3.5 inline-block align-[-2px] mr-1" aria-hidden="true" /> : <PawPrint className="w-3.5 h-3.5 inline-block align-[-2px] mr-1" aria-hidden="true" />}{editando.quien || '—'}
                {(editando.direccion || editando.comuna) ? ` · ${[editando.direccion, editando.comuna].filter(Boolean).join(', ')}` : ''}
              </p>
              {editando.valor != null && (
                <p className="text-xs text-gray-700 mt-1">
                  <span className="font-semibold">Valor a cobrar:</span>{' '}
                  {editando.valor > 0
                    ? <><span className="font-bold text-brand">{fmtPrecio(editando.valor)}</span>{editando.valorEstimado && <span className="text-gray-500"> (estimado)</span>}</>
                    : <span className="text-amber-800">falta el peso para calcularlo</span>}
                </p>
              )}
            </div>
            <div className="flex items-center gap-4">
              <div className="text-center">
                <p className="text-[11px] uppercase tracking-wide text-gray-400 font-semibold">Horario actual</p>
                <p className="text-2xl font-bold text-gray-500 tabular-nums">{editando.hora || '—'}</p>
              </div>
              <span className="text-gray-300 text-2xl">→</span>
              <div>
                <label className="text-[11px] uppercase tracking-wide text-brand font-semibold block mb-1">Nuevo horario</label>
                <input
                  type="time" value={nuevaHora} onChange={e => setNuevaHora(e.target.value)}
                  className="rounded-xl border border-gray-300 px-3 py-2 text-lg font-bold text-brand focus:ring-2 focus:ring-brand focus:border-brand outline-none"
                />
              </div>
            </div>
            {errorEdit && <p className="text-xs text-red-600">{errorEdit}</p>}
            <p className="text-[11px] text-gray-500">Solo cambia la hora del retiro. No registra la ficha ni envía correos al tutor.</p>
            <div className="flex items-center justify-between gap-3 pt-1">
              {editando.clienteId ? (
                <button onClick={() => router.push(`/clientes/${editando.clienteId}`)}
                  className="text-xs font-semibold text-brand-soft hover:underline">Abrir ficha completa →</button>
              ) : <span />}
              <div className="flex gap-2">
                <button onClick={() => setEditando(null)}
                  className="px-4 py-2 rounded-xl border border-gray-300 text-sm text-gray-700 hover:bg-gray-50">Cancelar</button>
                <button onClick={() => ejecutar(() => guardarHora())} disabled={procesando}
                  className="px-4 py-2 rounded-xl bg-brand hover:bg-brand-dark text-white text-sm font-semibold disabled:opacity-50">
                  {procesando ? 'Guardando…' : 'Guardar hora'}
                </button>
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* Bloquear agenda: rango fecha/hora en el que el bot no puede agendar. */}
      <Modal open={modalBloqueo} onClose={() => setModalBloqueo(false)} title={bEditando ? 'Editar bloqueo de agenda' : 'Bloquear agenda'}>
        <div className="space-y-4">
          {bEditando ? (
            <div className="flex items-center justify-between gap-3 rounded-xl bg-amber-50 border border-amber-200 px-3 py-2">
              <p className="text-xs text-amber-900">Estás <span className="font-semibold">editando</span> un bloqueo existente.</p>
              <button onClick={resetFormBloqueo} className="text-xs font-semibold text-amber-800 hover:underline shrink-0">Cancelar edición</button>
            </div>
          ) : (
            <p className="text-xs text-gray-600">
              Cierra un rango de fecha y hora: dentro de ese rango el bot <span className="font-semibold">no agenda</span> retiros
              ni eutanasias, y tampoco lo ofrece como horario disponible. Los agendamientos que ya existan no se tocan.
            </p>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] uppercase tracking-wide text-brand font-semibold block mb-1">Desde</label>
              <div className="flex gap-2">
                <input type="date" value={bDesde} onChange={e => setBDesde(e.target.value)}
                  className="flex-1 min-w-0 rounded-xl border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-brand focus:border-brand outline-none" />
                <input type="time" value={bHoraDesde} onChange={e => setBHoraDesde(e.target.value)} disabled={bTodoElDia}
                  className="w-28 rounded-xl border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-100 disabled:text-gray-400 focus:ring-2 focus:ring-brand focus:border-brand outline-none" />
              </div>
            </div>
            <div>
              <label className="text-[11px] uppercase tracking-wide text-brand font-semibold block mb-1">Hasta</label>
              <div className="flex gap-2">
                <input type="date" value={bHasta} min={bDesde} onChange={e => setBHasta(e.target.value)}
                  className="flex-1 min-w-0 rounded-xl border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-brand focus:border-brand outline-none" />
                <input type="time" value={bHoraHasta} onChange={e => setBHoraHasta(e.target.value)} disabled={bTodoElDia}
                  className="w-28 rounded-xl border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-100 disabled:text-gray-400 focus:ring-2 focus:ring-brand focus:border-brand outline-none" />
              </div>
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={bTodoElDia} onChange={e => setBTodoElDia(e.target.checked)}
              className="w-4 h-4 rounded border-gray-300 text-brand focus:ring-brand" />
            Todo el día (00:00 a 23:59)
          </label>

          <div>
            <label className="text-[11px] uppercase tracking-wide text-brand font-semibold block mb-1">Motivo (opcional, uso interno)</label>
            <input type="text" value={bMotivo} onChange={e => setBMotivo(e.target.value)} maxLength={200}
              placeholder="Ej.: mantención del horno, chofer con licencia…"
              className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-brand focus:border-brand outline-none" />
            <p className="text-[11px] text-gray-500 mt-1">El motivo no se le muestra al cliente: el bot solo dice que no hay disponibilidad y ofrece otros horarios.</p>
          </div>

          {errorBloqueo && <p className="text-xs text-red-600">{errorBloqueo}</p>}

          <div className="flex justify-end gap-2">
            <button onClick={() => setModalBloqueo(false)}
              className="px-4 py-2 rounded-xl border border-gray-300 text-sm text-gray-700 hover:bg-gray-50">Cerrar</button>
            <button onClick={() => ejecutarBloqueo(guardarBloqueo)} disabled={procesandoBloqueo}
              className={`px-4 py-2 rounded-xl text-white text-sm font-semibold disabled:opacity-50 ${bEditando ? 'bg-brand hover:bg-brand-dark' : 'bg-red-600 hover:bg-red-700'}`}>
              {procesandoBloqueo ? 'Guardando…' : bEditando ? 'Guardar cambios' : 'Bloquear'}
            </button>
          </div>

          {/* Bloqueos vigentes (de hoy en adelante) */}
          <div className="border-t border-gray-200 pt-3">
            <p className="text-[11px] uppercase tracking-wide text-gray-500 font-semibold mb-2">Bloqueos vigentes</p>
            {bloqueosLista.length === 0 ? (
              <p className="text-xs text-gray-400">No hay bloqueos activos.</p>
            ) : (
              <ul className="space-y-1.5 max-h-48 overflow-y-auto">
                {bloqueosLista.map(b => (
                  <li key={b.id}
                    className={`flex items-center justify-between gap-3 rounded-xl border px-3 py-2 ${bEditando === b.id ? 'border-brand bg-brand/5' : 'border-gray-200'}`}>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-gray-800 truncate">{rotuloBloqueo(b)}</p>
                      {b.motivo && <p className="text-[11px] text-gray-500 truncate">{b.motivo}</p>}
                    </div>
                    <div className="shrink-0 flex items-center gap-3">
                      <button onClick={() => cargarEnForm(b)}
                        className="text-xs font-semibold text-brand-soft hover:underline">Editar</button>
                      <button onClick={() => quitarBloqueo(b.id)}
                        className="text-xs font-semibold text-red-600 hover:underline">Quitar</button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </Modal>
    </div>
  )
}
