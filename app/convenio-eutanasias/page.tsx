'use client'
import { useState, useEffect } from 'react'
import ComunaPicker from '@/components/ui/ComunaPicker'
import { Modal } from '@/components/ui/Modal'
import { fmtPrecio } from '@/lib/format'

type Tramo = { id: string; peso_min: string; peso_max: string; precio: string }

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

const COLOR = '#143C64'

export default function ConvenioEutanasiasPage() {
  const [tramos, setTramos] = useState<Tramo[]>([])

  // form
  const [form, setForm] = useState({
    nombre: '',
    apellido: '',
    email: '',
    telefono: '',
    rut: '',
    notas: '',
    website: '', // honeypot
  })
  const [comunas, setComunas] = useState<string[]>([])
  const [horarios, setHorarios] = useState<Horarios>({})
  const [enviando, setEnviando] = useState(false)
  const [resultado, setResultado] = useState<{
    tipo: 'ok' | 'error' | 'duplicado'
    mensaje: string
    bienvenida_estado?: string
    bienvenida_error?: string
  } | null>(null)

  useEffect(() => {
    fetch('/api/eutanasias/precios').then(r => r.json()).then(d => setTramos(Array.isArray(d) ? d : []))
  }, [])

  function toggleHorario(dia: DiaKey, slot: 'am' | 'pm') {
    setHorarios(prev => {
      const actual = prev[dia] ?? { am: false, pm: false }
      const nuevo: Horarios = { ...prev, [dia]: { ...actual, [slot]: !actual[slot] } }
      if (!nuevo[dia]?.am && !nuevo[dia]?.pm) delete nuevo[dia]
      return nuevo
    })
  }

  function marcarTodaLaSemana() {
    setHorarios({
      lun: { am: true, pm: true },
      mar: { am: true, pm: true },
      mie: { am: true, pm: true },
      jue: { am: true, pm: true },
      vie: { am: true, pm: true },
      sab: { am: true, pm: true },
      dom: { am: true, pm: true },
    })
  }

  async function enviar(e: React.FormEvent) {
    e.preventDefault()
    setResultado(null)
    setEnviando(true)
    try {
      const r = await fetch('/api/eutanasias/vets/inscribir', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          comunas,
          horarios,
        }),
      })
      const j = await r.json()
      if (!r.ok) {
        setResultado({ tipo: 'error', mensaje: j.error || 'No pudimos procesar tu inscripción. Intenta de nuevo.' })
      } else if (j.ya_inscrito) {
        setResultado({ tipo: 'duplicado', mensaje: j.mensaje })
      } else {
        setResultado({
          tipo: 'ok',
          mensaje: j.mensaje,
          bienvenida_estado: j.bienvenida_estado,
          bienvenida_error: j.bienvenida_error,
        })
        // Reset
        setForm({ nombre: '', apellido: '', email: '', telefono: '', rut: '', notas: '', website: '' })
        setComunas([])
        setHorarios({})
      }
    } catch (e) {
      console.error(e)
      setResultado({ tipo: 'error', mensaje: 'Error de red. Verifica tu conexión.' })
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header style={{ backgroundColor: COLOR }} className="text-white py-8 sm:py-10 px-4">
        <div className="max-w-4xl mx-auto">
          <p className="text-xs sm:text-sm uppercase tracking-widest opacity-80">Alma Animal Crematorio · Convenio Veterinarios</p>
          <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold mt-2">Eutanasias a Domicilio</h1>
          <p className="text-base sm:text-lg mt-3 opacity-95 max-w-2xl">
            Únete a nuestra red de veterinarios para ofrecer un acompañamiento digno y cercano en el último momento de las mascotas.
          </p>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8 sm:py-10 space-y-10 sm:space-y-12">

        {/* Cómo funciona */}
        <section>
          <h2 className="text-xl sm:text-2xl font-bold text-gray-900 mb-4">¿Cómo funciona el convenio?</h2>
          <div className="grid gap-4 md:grid-cols-3">
            <Card num="1" titulo="Te inscribes">
              Llenas este formulario indicando tus datos, las comunas en las que puedes atender y tus horarios de disponibilidad.
            </Card>
            <Card num="2" titulo="Recibes cotizaciones">
              Cuando una familia nos llama por una eutanasia en tu zona y horario, te enviamos un correo con los datos del caso.
            </Card>
            <Card num="3" titulo="Confirmas y atiendes">
              Si puedes tomar el caso, confirmas en un clic, te contactas con la familia y recibes el pago acordado por el servicio.
            </Card>
          </div>
        </section>

        {/* Precios */}
        <section>
          <h2 className="text-xl sm:text-2xl font-bold text-gray-900 mb-3">Precio que pagamos por servicio</h2>
          <p className="text-sm sm:text-base text-gray-600 mb-4">
            Estos son los montos fijos que <strong>te pagamos a ti</strong> por cada eutanasia a domicilio realizada, según el peso de la mascota.
            Son los mismos para todos los veterinarios del convenio.
          </p>
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden max-w-xl">
            {tramos.length === 0 ? (
              <div className="p-6 text-center text-gray-400 text-sm">Cargando tarifas…</div>
            ) : (
              <table className="w-full text-sm sm:text-base">
                <thead style={{ backgroundColor: COLOR }} className="text-white">
                  <tr>
                    <th className="px-3 sm:px-4 py-3 text-left text-xs sm:text-sm">Peso de la mascota</th>
                    <th className="px-3 sm:px-4 py-3 text-right text-xs sm:text-sm">Pago por servicio</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {tramos.map(t => (
                    <tr key={t.id}>
                      <td className="px-3 sm:px-4 py-3 text-gray-700">{t.peso_min} – {t.peso_max} kg</td>
                      <td className="px-3 sm:px-4 py-3 text-right font-semibold text-gray-900">{fmtPrecio(parseInt(t.precio, 10) || 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>

        {/* Formulario */}
        <section id="inscripcion">
          <h2 className="text-2xl font-bold text-gray-900 mb-3">Inscríbete al convenio</h2>
          <p className="text-gray-600 mb-6">Es gratis y solo te tomará un minuto. Te contactaremos por correo cuando llegue una solicitud que coincida con tus comunas y horarios.</p>

          {/* Banner inline solo para errores. El éxito se muestra en pop-up. */}
          {resultado && resultado.tipo === 'error' && (
            <div className="mb-6 p-4 rounded-lg border bg-red-50 border-red-200 text-red-800">
              {resultado.mensaje}
            </div>
          )}

          <form onSubmit={enviar} className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 sm:p-6 space-y-5 sm:space-y-6">
            {/* Honeypot — invisible a usuarios humanos, los bots lo llenan */}
            <input
              type="text"
              name="website"
              value={form.website}
              onChange={e => setForm({ ...form, website: e.target.value })}
              tabIndex={-1}
              autoComplete="off"
              style={{ position: 'absolute', left: '-9999px', width: 1, height: 1 }}
              aria-hidden="true"
            />

            <div className="grid md:grid-cols-2 gap-4">
              <FormField label="Nombre" required>
                <input
                  type="text" required
                  value={form.nombre}
                  onChange={e => setForm({ ...form, nombre: e.target.value })}
                  className={inputCls}
                />
              </FormField>
              <FormField label="Apellido" required>
                <input
                  type="text" required
                  value={form.apellido}
                  onChange={e => setForm({ ...form, apellido: e.target.value })}
                  className={inputCls}
                />
              </FormField>
              <FormField label="Email" required hint="Aquí te llegarán las cotizaciones">
                <input
                  type="email" required
                  value={form.email}
                  onChange={e => setForm({ ...form, email: e.target.value })}
                  className={inputCls}
                />
              </FormField>
              <FormField label="Teléfono" required hint="9 dígitos, sin +56">
                <input
                  type="tel" required
                  value={form.telefono}
                  onChange={e => setForm({ ...form, telefono: e.target.value.replace(/\D/g, '').slice(0, 9) })}
                  placeholder="912345678"
                  className={inputCls}
                />
              </FormField>
              <FormField label="RUT" required hint="Para emitir tu pago y factura">
                <input
                  type="text" required
                  value={form.rut}
                  onChange={e => setForm({ ...form, rut: e.target.value })}
                  placeholder="12345678-9"
                  className={inputCls}
                />
              </FormField>
            </div>

            {/* Comunas */}
            <div>
              <label className="block text-sm font-medium text-gray-900 mb-2">
                Comunas donde puedes atender <span className="text-red-500">*</span>
              </label>
              <p className="text-xs text-gray-500 mb-2">Toca <strong>+ Agregar comuna</strong> y escribe el nombre. Se sugerirán mientras tipees. Puedes agregar tantas como quieras.</p>
              <ComunaPicker value={comunas} onChange={setComunas} color={COLOR} />
            </div>

            {/* Horarios */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-sm font-medium text-gray-900">Días y horarios de disponibilidad <span className="text-red-500">*</span></label>
                <button
                  type="button"
                  onClick={marcarTodaLaSemana}
                  className="text-xs font-medium hover:underline"
                  style={{ color: COLOR }}
                >
                  Marcar toda la semana
                </button>
              </div>
              <p className="text-xs text-gray-500 mb-2">Marca los turnos en los que podrías tomar una solicitud (AM = mañana / PM = tarde-noche).</p>
              <div className="border border-gray-300 rounded-lg overflow-hidden">
                <table className="w-full text-sm sm:text-base">
                  <thead className="bg-gray-50 text-xs uppercase text-gray-600">
                    <tr>
                      <th className="px-3 py-2.5 text-left">Día</th>
                      <th className="px-3 py-2.5 text-center">AM</th>
                      <th className="px-3 py-2.5 text-center">PM</th>
                    </tr>
                  </thead>
                  <tbody>
                    {DIAS.map(d => {
                      const h = horarios[d.key] ?? { am: false, pm: false }
                      return (
                        <tr key={d.key} className="border-t border-gray-100">
                          <td className="px-3 py-3 font-medium text-gray-800">{d.label}</td>
                          <td className="px-3 py-3 text-center">
                            <input type="checkbox" checked={h.am} onChange={() => toggleHorario(d.key, 'am')} className="w-5 h-5 cursor-pointer" />
                          </td>
                          <td className="px-3 py-3 text-center">
                            <input type="checkbox" checked={h.pm} onChange={() => toggleHorario(d.key, 'pm')} className="w-5 h-5 cursor-pointer" />
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <FormField label="Comentarios (opcional)" hint="Otra info que quieras compartir: años de experiencia, áreas, etc.">
              <textarea
                value={form.notas}
                onChange={e => setForm({ ...form, notas: e.target.value })}
                rows={3}
                className={inputCls}
              />
            </FormField>

            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-2 border-t border-gray-100">
              <p className="text-xs text-gray-500 sm:flex-1">
                Al enviar aceptas que te contactemos cuando llegue una solicitud que coincida con tu zona.
              </p>
              <button
                type="submit"
                disabled={enviando}
                className="w-full sm:w-auto px-6 py-3 text-white font-medium rounded-lg disabled:opacity-60 transition-opacity text-base"
                style={{ backgroundColor: COLOR }}
              >
                {enviando ? 'Enviando…' : 'Enviar inscripción'}
              </button>
            </div>
          </form>
        </section>

        <footer className="text-center text-xs text-gray-500 pt-6 border-t border-gray-200">
          ¿Dudas? Escríbenos a <a href="mailto:info@crematorioalmaanimal.cl" className="text-gray-700 underline">info@crematorioalmaanimal.cl</a>
        </footer>
      </main>

      {/* Pop-up de bienvenida tras inscripción exitosa */}
      <Modal
        open={!!resultado && (resultado.tipo === 'ok' || resultado.tipo === 'duplicado')}
        onClose={() => setResultado(null)}
        title={resultado?.tipo === 'duplicado' ? 'Ya estás inscrito' : '¡Bienvenido a la comunidad!'}
      >
        <div className="text-center py-2">
          <div className="text-5xl mb-3">{resultado?.tipo === 'duplicado' ? '👋' : '🎉'}</div>
          <p className="text-base text-gray-800 mb-2">
            {resultado?.tipo === 'duplicado'
              ? resultado.mensaje
              : 'Nos pondremos en contacto contigo cuando llegue una solicitud que coincida con tus comunas y horarios.'}
          </p>
          {resultado?.tipo === 'ok' && resultado.bienvenida_estado === 'enviado' && (
            <p className="text-sm text-gray-500 mt-3">
              Revisa tu correo: te enviamos los detalles del convenio (si no lo ves, mira la carpeta de spam).
            </p>
          )}
          {resultado?.tipo === 'ok' && resultado.bienvenida_estado && resultado.bienvenida_estado !== 'enviado' && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3 mt-3 text-left">
              Tu inscripción quedó registrada, pero no pudimos enviarte el correo de bienvenida automáticamente.
              Te contactaremos manualmente.<br/>
              <span className="text-[10px] text-amber-600 mt-1 block">
                (debug: {resultado.bienvenida_estado}{resultado.bienvenida_error ? ` — ${resultado.bienvenida_error}` : ''})
              </span>
            </p>
          )}
          <button
            onClick={() => setResultado(null)}
            className="mt-6 px-6 py-2.5 text-white font-medium rounded-lg"
            style={{ backgroundColor: COLOR }}
          >
            Entendido
          </button>
        </div>
      </Modal>
    </div>
  )
}

function Card({ num, titulo, children }: { num: string; titulo: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl p-5 border border-gray-200 shadow-sm">
      <div className="text-3xl font-bold mb-2" style={{ color: COLOR }}>{num}</div>
      <h3 className="font-semibold text-gray-900 mb-1">{titulo}</h3>
      <p className="text-sm text-gray-600">{children}</p>
    </div>
  )
}

function FormField({ label, required, hint, children }: { label: string; required?: boolean; hint?: string; children: React.ReactNode }) {
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

const inputCls = 'w-full px-3 py-2.5 border border-gray-300 rounded-lg text-base focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none'
