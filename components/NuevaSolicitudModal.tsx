'use client'
import { useEffect, useRef, useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { todayISO } from '@/lib/dates'
import { esComunaNoCubierta } from '@/lib/cobertura'

/**
 * Alta MANUAL de una solicitud de retiro (lo que antes era el botón
 * "Agendamiento manual" de /clientes; vive en la agenda del dashboard, que es
 * donde se decide el horario).
 *
 * Pide los datos MÍNIMOS de la ficha y, con eso, el endpoint crea la solicitud
 * confirmada + la ficha «Por ingresar» y le manda la confirmación por WhatsApp
 * al tutor con el link para que adelante los datos de su mascota.
 */

const VACIO = {
  cliente_nombre: '', telefono: '', nombre_mascota: '', direccion: '', comuna: '',
  codigo_servicio: 'CI', fecha_retiro: '', hora_retiro: '', peso: '',
}

const input = 'mt-1 w-full border-2 border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand'
const label = 'text-xs font-semibold text-gray-700'

export default function NuevaSolicitudModal({
  open,
  onClose,
  onCreada,
  /** Prefill de fecha/hora cuando se abre desde un hueco de la agenda. */
  inicial,
}: {
  open: boolean
  onClose: () => void
  /** Se llama tras crear, para refrescar la vista de quien lo abrió. */
  onCreada?: () => void | Promise<void>
  inicial?: { fecha_retiro?: string; hora_retiro?: string }
}) {
  const [form, setForm] = useState({ ...VACIO, fecha_retiro: todayISO() })
  const [error, setError] = useState('')
  const [guardando, setGuardando] = useState(false)
  const guardandoRef = useRef(false)

  // Reinicia el formulario cada vez que se abre (y aplica el prefill).
  const fechaIni = inicial?.fecha_retiro
  const horaIni = inicial?.hora_retiro
  useEffect(() => {
    if (!open) return
    setForm({ ...VACIO, fecha_retiro: fechaIni || todayISO(), hora_retiro: horaIni || '' })
    setError('')
  }, [open, fechaIni, horaIni])

  // ── Aviso de tope horario ────────────────────────────────────────────────
  // Al elegir fecha+hora consultamos la MISMA regla que respeta el bot (ventana
  // 09:00–21:10, bloqueos manuales y 30 min antes / 45 después de otra reserva).
  // Es solo una ADVERTENCIA: el equipo puede guardar igual.
  const [aviso, setAviso] = useState<{ motivo: string; libres: string[] } | null>(null)
  const [revisando, setRevisando] = useState(false)
  const { fecha_retiro, hora_retiro } = form

  useEffect(() => {
    if (!open || !fecha_retiro || !/^\d{2}:\d{2}$/.test(hora_retiro)) { setAviso(null); return }
    let cancelado = false
    setRevisando(true)
    // Pequeño respiro: el input de hora dispara onChange por cada dígito.
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/agenda/slot?fecha=${encodeURIComponent(fecha_retiro)}&hora=${encodeURIComponent(hora_retiro)}`, { cache: 'no-store' })
        const d = await r.json().catch(() => ({}))
        if (cancelado) return
        setAviso(r.ok && !d.ok ? { motivo: d.motivo || 'Ese horario puede chocar con otra reserva.', libres: Array.isArray(d.libres) ? d.libres : [] } : null)
      } catch {
        if (!cancelado) setAviso(null) // sin red no molestamos: el aviso es opcional
      } finally {
        if (!cancelado) setRevisando(false)
      }
    }, 400)
    return () => { cancelado = true; clearTimeout(t) }
  }, [open, fecha_retiro, hora_retiro])

  function cerrar() { setError(''); setAviso(null); onClose() }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (guardandoRef.current) return
    guardandoRef.current = true
    setGuardando(true); setError('')
    try {
      const res = await fetch('/api/clientes/agendamiento-manual', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setError(data?.error || 'No se pudo registrar el agendamiento.'); return }
      const mascota = form.nombre_mascota
      onClose()
      await onCreada?.()
      alert(`✅ Agendamiento registrado. Se creó la ficha "Por ingresar" de ${mascota} y se le envió la confirmación por WhatsApp al tutor.`)
    } catch {
      setError('Error de red. Intenta de nuevo.')
    } finally {
      guardandoRef.current = false
      setGuardando(false)
    }
  }

  return (
    <Modal open={open} onClose={cerrar} title="Nueva solicitud de retiro">
      <form onSubmit={submit} className="space-y-4">
        <p className="text-xs text-gray-600 -mt-1">
          Registra un retiro a mano. Se crea la ficha <strong>&laquo;Por ingresar&raquo;</strong> y se le envía la <strong>confirmación por WhatsApp</strong> al tutor (con el link para adelantar los datos de su mascota).
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className={label}>Tutor <span className="text-red-500">*</span></label>
            <input required value={form.cliente_nombre} onChange={e => setForm(f => ({ ...f, cliente_nombre: e.target.value }))} className={input} />
          </div>
          <div>
            <label className={label}>WhatsApp <span className="text-red-500">*</span></label>
            <input required inputMode="numeric" placeholder="56961217925" value={form.telefono} onChange={e => setForm(f => ({ ...f, telefono: e.target.value }))} className={input} />
          </div>
          <div>
            <label className={label}>Mascota <span className="text-red-500">*</span></label>
            <input required value={form.nombre_mascota} onChange={e => setForm(f => ({ ...f, nombre_mascota: e.target.value }))} className={input} />
          </div>
          <div>
            <label className={label}>Servicio <span className="text-red-500">*</span></label>
            <select required value={form.codigo_servicio} onChange={e => setForm(f => ({ ...f, codigo_servicio: e.target.value }))} className={input}>
              <option value="CI">Cremación Individual</option>
              <option value="CP">Cremación Premium</option>
              <option value="SD">Cremación Sin Devolución</option>
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className={label}>Dirección de retiro <span className="text-red-500">*</span></label>
            <input required value={form.direccion} onChange={e => setForm(f => ({ ...f, direccion: e.target.value }))} className={input} />
          </div>
          <div>
            <label className={label}>Comuna <span className="text-red-500">*</span></label>
            <input required value={form.comuna} onChange={e => setForm(f => ({ ...f, comuna: e.target.value }))} className={input} />
            {esComunaNoCubierta(form.comuna) && (
              <p className="mt-1 text-xs text-amber-700">⚠️ Fuera de cobertura de retiro a domicilio.</p>
            )}
          </div>
          <div>
            <label className={label}>Peso (kg)</label>
            <input inputMode="decimal" value={form.peso} onChange={e => setForm(f => ({ ...f, peso: e.target.value }))} className={input} />
          </div>
          <div>
            <label className={label}>Fecha de retiro <span className="text-red-500">*</span></label>
            <input required type="date" value={form.fecha_retiro} onChange={e => setForm(f => ({ ...f, fecha_retiro: e.target.value }))} className={input} />
          </div>
          <div>
            <label className={label}>Hora de retiro <span className="text-red-500">*</span></label>
            <input required type="time" value={form.hora_retiro} onChange={e => setForm(f => ({ ...f, hora_retiro: e.target.value }))} className={input} />
          </div>
        </div>

        {revisando && <p className="text-[11px] text-gray-500">Revisando el horario…</p>}
        {aviso && (
          <div className="rounded-lg border-2 border-amber-300 bg-amber-50 px-3 py-2.5 text-xs text-amber-900">
            <p className="font-semibold">⚠️ Tope de horario</p>
            <p className="mt-0.5 leading-snug">{aviso.motivo}</p>
            {aviso.libres.length > 0 && (
              <p className="mt-1.5 leading-snug">
                Horas libres ese día:{' '}
                {aviso.libres.slice(0, 8).map(h => (
                  <button key={h} type="button" onClick={() => setForm(f => ({ ...f, hora_retiro: h }))}
                    className="inline-block mr-1 mb-1 px-1.5 py-0.5 rounded border border-amber-300 bg-white font-semibold hover:bg-amber-100">
                    {h}
                  </button>
                ))}
              </p>
            )}
            <p className="mt-1 text-[11px] text-amber-800/80">Puedes guardar igual: esto es solo un aviso.</p>
          </div>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex gap-3 pt-1">
          <button type="button" onClick={cerrar}
            className="flex-1 border-2 border-gray-300 text-gray-700 rounded-lg py-2 text-sm font-semibold hover:bg-gray-50 transition-colors">Cancelar</button>
          <button type="submit" disabled={guardando}
            className="flex-1 bg-brand hover:bg-brand-dark text-white rounded-lg py-2 text-sm font-semibold disabled:opacity-50 transition-colors">
            {guardando ? 'Registrando…' : 'Registrar y avisar al tutor'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
