'use client'
import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { Modal } from '@/components/ui/Modal'
import ComunaPicker from '@/components/ui/ComunaPicker'
import { BANCOS_CL, TIPOS_CUENTA } from '@/lib/bancos-cl'

const COLOR = '#143C64'

const DIAS = [
  { key: 'lun', label: 'Lunes' },
  { key: 'mar', label: 'Martes' },
  { key: 'mie', label: 'Miércoles' },
  { key: 'jue', label: 'Jueves' },
  { key: 'vie', label: 'Viernes' },
  { key: 'sab', label: 'Sábado' },
  { key: 'dom', label: 'Domingo' },
] as const

type DiaKey = typeof DIAS[number]['key']
type Horarios = Partial<Record<DiaKey, { am: boolean; pm: boolean }>>

interface VetInfo {
  id: string
  nombre: string
  apellido: string
  email: string
  telefono: string
  rut: string
  comunas: string[]
  horarios: Horarios
  banco: string
  tipo_cuenta: string
  numero_cuenta: string
  datos_pago_completos: boolean
}

/**
 * Página pública donde el veterinario del convenio de eutanasias revisa y
 * ACTUALIZA su ficha completa: contacto, comunas donde atiende, días/horarios
 * y datos de transferencia. Se llega desde el botón "Enviar datos a Vet" de
 * Servicios → Veterinarios, que le manda el link firmado por correo.
 *
 * El token (HMAC, 30 días) identifica al vet — sin él no se ve nada. A
 * diferencia del formulario de alta de datos bancarios (consumo único), éste
 * se puede volver a usar mientras no expire: su propósito es mantener la ficha
 * al día. Cada cambio de cuenta le llega al equipo por WhatsApp.
 */
export default function MisDatosVetPage() {
  const params = useParams<{ token: string }>()
  const token = params?.token ?? ''
  const [estado, setEstado] = useState<'cargando' | 'listo' | 'error'>('cargando')
  const [errorMsg, setErrorMsg] = useState('')
  const [form, setForm] = useState<VetInfo | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [resultError, setResultError] = useState('')
  const [confirmado, setConfirmado] = useState<{ mensaje: string; email_cambio: boolean } | null>(null)

  useEffect(() => {
    ;(async () => {
      if (!token) {
        setErrorMsg('Falta el token en la URL.')
        setEstado('error')
        return
      }
      try {
        const r = await fetch(`/api/eutanasias/vets/mis-datos?token=${encodeURIComponent(token)}`)
        const j = await r.json()
        if (!r.ok || !j.ok) {
          setErrorMsg(j.error || 'No pudimos cargar tus datos.')
          setEstado('error')
          return
        }
        setForm(j.vet as VetInfo)
        setEstado('listo')
      } catch {
        setErrorMsg('Error de red. Verifica tu conexión.')
        setEstado('error')
      }
    })()
  }, [token])

  function toggleHorario(dia: DiaKey, slot: 'am' | 'pm') {
    setForm(f => {
      if (!f) return f
      const actual = f.horarios[dia] ?? { am: false, pm: false }
      return { ...f, horarios: { ...f.horarios, [dia]: { ...actual, [slot]: !actual[slot] } } }
    })
  }

  function marcarSemana() {
    setForm(f => {
      if (!f) return f
      const todos: Horarios = {}
      for (const d of DIAS) todos[d.key] = { am: true, pm: true }
      return { ...f, horarios: todos }
    })
  }

  async function guardar(e: React.FormEvent) {
    e.preventDefault()
    if (!form || guardando) return
    setResultError('')
    setGuardando(true)
    try {
      const r = await fetch('/api/eutanasias/vets/mis-datos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, ...form }),
      })
      const j = await r.json()
      if (!r.ok || !j.ok) setResultError(j.error || 'No pudimos guardar tus datos.')
      else setConfirmado({ mensaje: j.mensaje, email_cambio: !!j.email_cambio })
    } catch {
      setResultError('Error de red. Verifica tu conexión.')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header style={{ backgroundColor: COLOR }} className="text-white py-6 sm:py-8 px-4">
        <div className="max-w-2xl mx-auto">
          <p className="text-xs sm:text-sm uppercase tracking-widest opacity-80">Alma Animal · Convenio Eutanasias</p>
          <h1 className="text-xl sm:text-2xl font-bold mt-2">Tus datos del convenio</h1>
          <p className="text-sm sm:text-base mt-2 opacity-95">
            Revisa que todo esté correcto y corrige lo que haga falta. De estos datos dependen las
            solicitudes que te llegan y el pago de cada servicio.
          </p>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-8">
        {estado === 'cargando' && (
          <div className="bg-white rounded-xl border border-gray-300 p-6 text-center text-gray-500 text-sm">Verificando…</div>
        )}

        {estado === 'error' && (
          <div className="bg-white rounded-xl border border-gray-300 p-6 text-center">
            <p className="text-5xl mb-3">⚠</p>
            <h2 className="text-lg font-semibold text-gray-900 mb-1">No pudimos cargar tu información</h2>
            <p className="text-sm text-gray-600">{errorMsg}</p>
            <p className="text-xs text-gray-500 mt-4">
              Si crees que esto es un error, escríbenos a{' '}
              <a className="underline text-gray-700" href="mailto:info@crematorioalmaanimal.cl">info@crematorioalmaanimal.cl</a>.
            </p>
          </div>
        )}

        {estado === 'listo' && form && (
          <form onSubmit={guardar} className="space-y-5">
            {/* Datos de contacto */}
            <section className="bg-white rounded-xl shadow-md border border-gray-300 p-4 sm:p-6">
              <h2 className="text-base font-semibold text-gray-900 mb-4">Tus datos</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Nombre" required>
                  <input type="text" required value={form.nombre} onChange={e => setForm({ ...form, nombre: e.target.value })} className={inputCls} />
                </Field>
                <Field label="Apellido" required>
                  <input type="text" required value={form.apellido} onChange={e => setForm({ ...form, apellido: e.target.value })} className={inputCls} />
                </Field>
                <Field label="Email" required hint="Aquí te llegan las solicitudes">
                  <input type="email" required value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} className={inputCls} />
                </Field>
                <Field label="Teléfono" required hint="9 dígitos, sin +56">
                  <input
                    type="tel"
                    inputMode="numeric"
                    required
                    value={form.telefono}
                    onChange={e => setForm({ ...form, telefono: e.target.value.replace(/\D/g, '').slice(0, 9) })}
                    className={inputCls}
                  />
                </Field>
                <Field label="RUT" required hint="Formato: 12345678-9">
                  <input type="text" required value={form.rut} onChange={e => setForm({ ...form, rut: e.target.value })} placeholder="12345678-9" className={inputCls} />
                </Field>
              </div>
            </section>

            {/* Comunas */}
            <section className="bg-white rounded-xl shadow-md border border-gray-300 p-4 sm:p-6">
              <h2 className="text-base font-semibold text-gray-900">Comunas donde atiendes</h2>
              <p className="text-xs text-gray-500 mt-1 mb-3">
                Solo te enviaremos solicitudes de estas comunas. Agrega o quita las que necesites.
              </p>
              <ComunaPicker value={form.comunas} onChange={v => setForm({ ...form, comunas: v })} color={COLOR} />
            </section>

            {/* Horarios */}
            <section className="bg-white rounded-xl shadow-md border border-gray-300 p-4 sm:p-6">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-base font-semibold text-gray-900">Días y horarios disponibles</h2>
                <button type="button" onClick={marcarSemana} className="text-xs font-medium hover:underline" style={{ color: COLOR }}>
                  Marcar toda la semana
                </button>
              </div>
              <p className="text-xs text-gray-500 mt-1 mb-3">AM es antes de las 13:00 y PM desde las 13:00.</p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm border border-gray-300 rounded-lg">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-3 py-2 text-left text-xs text-gray-600 font-medium">Día</th>
                      <th className="px-3 py-2 text-center text-xs text-gray-600 font-medium">AM</th>
                      <th className="px-3 py-2 text-center text-xs text-gray-600 font-medium">PM</th>
                    </tr>
                  </thead>
                  <tbody>
                    {DIAS.map(d => {
                      const h = form.horarios[d.key] ?? { am: false, pm: false }
                      return (
                        <tr key={d.key} className="border-t border-gray-200">
                          <td className="px-3 py-2.5 font-medium text-gray-800">{d.label}</td>
                          <td className="px-3 py-2.5 text-center">
                            <input type="checkbox" className="w-5 h-5 accent-[#143C64]" checked={h.am} onChange={() => toggleHorario(d.key, 'am')} />
                          </td>
                          <td className="px-3 py-2.5 text-center">
                            <input type="checkbox" className="w-5 h-5 accent-[#143C64]" checked={h.pm} onChange={() => toggleHorario(d.key, 'pm')} />
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </section>

            {/* Transferencia */}
            <section className="bg-white rounded-xl shadow-md border border-gray-300 p-4 sm:p-6">
              <h2 className="text-base font-semibold text-gray-900">Datos para transferirte</h2>
              <p className="text-xs text-gray-500 mt-1 mb-4">
                {form.datos_pago_completos
                  ? 'Ya tenemos tu cuenta registrada. Si cambió, actualízala aquí.'
                  : 'Todavía no tenemos tu cuenta. Complétala para poder pagarte al día hábil siguiente de cada servicio.'}
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Banco">
                  <select value={form.banco} onChange={e => setForm({ ...form, banco: e.target.value })} className={inputCls}>
                    <option value="">Selecciona un banco…</option>
                    {BANCOS_CL.map(b => <option key={b} value={b}>{b}</option>)}
                  </select>
                </Field>
                <Field label="Tipo de cuenta">
                  <select value={form.tipo_cuenta} onChange={e => setForm({ ...form, tipo_cuenta: e.target.value })} className={inputCls}>
                    <option value="">Selecciona…</option>
                    {TIPOS_CUENTA.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </Field>
              </div>
              <div className="mt-4">
                <Field label="Número de cuenta" hint="Solo números, sin guiones ni espacios">
                  <input
                    type="text"
                    inputMode="numeric"
                    value={form.numero_cuenta}
                    onChange={e => setForm({ ...form, numero_cuenta: e.target.value.replace(/\D/g, '') })}
                    className={inputCls}
                  />
                </Field>
              </div>
            </section>

            {resultError && (
              <div className="bg-red-50 border border-red-200 text-red-800 rounded-lg p-3 text-sm">{resultError}</div>
            )}

            <button
              type="submit"
              disabled={guardando}
              className="w-full px-6 py-3 text-white font-medium rounded-lg disabled:opacity-60 transition-opacity text-base"
              style={{ backgroundColor: COLOR }}
            >
              {guardando ? 'Guardando…' : 'Guardar'}
            </button>

            <p className="text-xs text-gray-500 text-center">
              Este enlace es personal, no lo reenvíes. Si necesitas ayuda, escríbenos a{' '}
              <a className="underline" href="mailto:info@crematorioalmaanimal.cl">info@crematorioalmaanimal.cl</a>.
            </p>
          </form>
        )}
      </main>

      <Modal open={!!confirmado} onClose={() => setConfirmado(null)} title="¡Datos actualizados!">
        <div className="text-center py-2">
          <div className="text-5xl mb-3">✅</div>
          <p className="text-base text-gray-800 mb-2">{confirmado?.mensaje}</p>
          {confirmado?.email_cambio && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2 mt-3">
              Cambiaste tu correo registrado. Las próximas solicitudes te llegarán al nuevo.
            </p>
          )}
          <button onClick={() => setConfirmado(null)} className="mt-6 px-6 py-2.5 text-white font-medium rounded-lg" style={{ backgroundColor: COLOR }}>
            Entendido
          </button>
        </div>
      </Modal>
    </div>
  )
}

function Field({ label, required, hint, children }: { label: string; required?: boolean; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-900 mb-1">
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      {children}
      {hint && <p className="text-xs text-gray-500 mt-1">{hint}</p>}
    </div>
  )
}

const inputCls = 'w-full px-3 py-2.5 border border-gray-300 rounded-lg text-base focus:ring-2 focus:ring-brand focus:border-brand outline-none'
