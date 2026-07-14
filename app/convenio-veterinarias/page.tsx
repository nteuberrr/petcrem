'use client'
import { useState, useEffect } from 'react'
import ComunaPicker from '@/components/ui/ComunaPicker'
import { Modal } from '@/components/ui/Modal'
import { fmtPrecio } from '@/lib/format'

// Landing PÚBLICA de autoinscripción de clínicas/veterinarias al convenio de
// CREMACIÓN (hoja `veterinarios`). Postea a /api/veterinarios/inscribir, que
// crea la ficha ACTIVA con tarifas de convenio automáticamente (decisión del
// dueño). Misma identidad visual que /convenio-eutanasias.

const COLOR = '#143C64'
const AMBER = '#F2B84B'
const CREAM = '#FBF8F3'
const HAIRLINE = '#ece6db'
const LOGO = '/brand/logo-alma-animal.png'
const SELLO = '/brand/sello-alma-animal.png'

const inputCls = 'w-full border border-gray-300 rounded-lg px-3 py-2.5 text-base text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#143C64]/40'

type TramoConvenio = { id: string; peso_min: string; peso_max: string; precio_ci: string; precio_cp: string; precio_sd: string }

function rangoPeso(min: string, max: string): string {
  const mn = (min ?? '').trim()
  const mx = (max ?? '').trim()
  if (mn && mx) return `${mn} – ${mx} kg`
  if (mn && !mx) return `${mn} kg o más`
  return `${mx || mn} kg`
}
function precioNum(s: string): number { return parseInt((s ?? '').replace(/\D/g, ''), 10) || 0 }

const BENEFICIOS = [
  { icono: '⏱️', titulo: 'Retiro en menos de 3 horas', detalle: 'Retiramos directamente desde tu clínica, habitualmente en menos de 3 horas.' },
  { icono: '📅', titulo: 'Lunes a domingo', detalle: 'Operamos todos los días, de 09:00 a 22:00 h.' },
  { icono: '🚚', titulo: 'Entrega en 4 días hábiles', detalle: 'Cenizas y certificado de cremación de vuelta en máximo 4 días hábiles.' },
  { icono: '💛', titulo: 'Precios convenientes', detalle: 'Al inscribirte accedes automáticamente a las tarifas preferentes del convenio.' },
  { icono: '🔎', titulo: 'Trazabilidad total', detalle: 'Código de seguimiento y certificado digital; instalaciones propias y horno certificado.' },
]

export default function ConvenioVeterinariasPage() {
  const [form, setForm] = useState({
    nombre: '',
    rut: '',
    razon_social: '',
    giro: '',
    direccion: '',
    telefono: '',
    correo: '',
    nombre_contacto: '',
    cargo_contacto: '',
    website: '', // honeypot
  })
  const [comunas, setComunas] = useState<string[]>([])
  const [enviando, setEnviando] = useState(false)
  const [resultado, setResultado] = useState<{ tipo: 'ok' | 'error' | 'duplicado'; mensaje: string } | null>(null)
  const [tramos, setTramos] = useState<TramoConvenio[]>([])

  useEffect(() => {
    fetch('/api/veterinarios/precios-convenio')
      .then(r => r.json())
      .then(d => setTramos(Array.isArray(d?.tramos) ? d.tramos : []))
      .catch(() => {})
  }, [])

  async function enviar(e: React.FormEvent) {
    e.preventDefault()
    setResultado(null)
    if (comunas.length === 0) {
      setResultado({ tipo: 'error', mensaje: 'Indica la comuna de la clínica.' })
      return
    }
    setEnviando(true)
    try {
      const r = await fetch('/api/veterinarios/inscribir', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, comuna: comunas[0] }),
      })
      const j = await r.json()
      if (!r.ok) {
        setResultado({ tipo: 'error', mensaje: j.error || 'No pudimos procesar la inscripción. Intenta de nuevo.' })
      } else if (j.ya_inscrito) {
        setResultado({ tipo: 'duplicado', mensaje: j.mensaje })
      } else {
        setResultado({ tipo: 'ok', mensaje: j.mensaje })
        setForm({ nombre: '', rut: '', razon_social: '', giro: '', direccion: '', telefono: '', correo: '', nombre_contacto: '', cargo_contacto: '', website: '' })
        setComunas([])
      }
    } catch {
      setResultado({ tipo: 'error', mensaje: 'Error de red. Verifica tu conexión.' })
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div className="min-h-screen" style={{ backgroundColor: CREAM }}>
      {/* Header — misma identidad que los correos: barra navy + logo + filete dorado */}
      <header style={{ backgroundColor: COLOR }} className="text-white py-8 sm:py-10 px-4">
        <div className="max-w-4xl mx-auto flex items-center justify-between gap-4">
          <div>
            <p className="text-[11px] sm:text-xs uppercase tracking-[0.18em] font-bold" style={{ color: AMBER }}>🐾 Alma Animal · Convenio Clínicas y Veterinarias</p>
            <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold mt-2">Cremación de mascotas para tu clínica</h1>
            <p className="text-base sm:text-lg mt-3 opacity-95 max-w-2xl">
              Súmate a nuestro convenio y ofrece a tus clientes un servicio de cremación serio, rápido y con trazabilidad total —
              nosotros retiramos desde tu clínica y nos encargamos de todo.
            </p>
          </div>
          <img src={LOGO} alt="Alma Animal" className="hidden sm:block h-24 w-auto shrink-0" />
        </div>
      </header>
      <div style={{ backgroundColor: AMBER }} className="h-1" />

      <main className="max-w-4xl mx-auto px-4 py-8 sm:py-10 space-y-10 sm:space-y-12">

        {/* Beneficios (el valor agregado oficial para clínicas) */}
        <section>
          <h2 className="text-xl sm:text-2xl font-bold text-gray-900 mb-4">¿Por qué convenir con Alma Animal?</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {BENEFICIOS.map(b => (
              <div key={b.titulo} className="bg-white rounded-xl p-5 border shadow-md" style={{ borderColor: HAIRLINE }}>
                <div className="text-2xl mb-2">{b.icono}</div>
                <h3 className="font-semibold text-gray-900 mb-1">{b.titulo}</h3>
                <p className="text-sm text-gray-600">{b.detalle}</p>
              </div>
            ))}
            <div className="rounded-xl p-5 border shadow-md flex flex-col justify-center" style={{ backgroundColor: COLOR, borderColor: COLOR }}>
              <h3 className="font-semibold text-white mb-1">¿Cómo agendas un retiro?</h3>
              <p className="text-sm text-white/90">Por WhatsApp o teléfono, en un minuto. Coordinamos el retiro y te confirmamos por correo cada hito del proceso.</p>
            </div>
          </div>
        </section>

        {/* Cómo funciona */}
        <section>
          <h2 className="text-xl sm:text-2xl font-bold text-gray-900 mb-4">¿Cómo funciona el convenio?</h2>
          <div className="grid gap-4 sm:grid-cols-3">
            <Card num="1" titulo="Inscribes tu clínica">
              Llenas este formulario con los datos de la clínica. Quedas inscrito de inmediato, con las tarifas preferentes del convenio ya asignadas.
            </Card>
            <Card num="2" titulo="Agendas retiros">
              Cuando un paciente fallece, nos avisas por WhatsApp o teléfono y retiramos en tu clínica — habitualmente en menos de 3 horas.
            </Card>
            <Card num="3" titulo="Nosotros hacemos el resto">
              Cremación con código de seguimiento, y entrega de cenizas + certificado en máximo 4 días hábiles. Te informamos cada hito por correo.
            </Card>
          </div>
        </section>

        {/* Precios de convenio */}
        <section>
          <h2 className="text-xl sm:text-2xl font-bold text-gray-900 mb-3">Tarifas de convenio</h2>
          <p className="text-sm sm:text-base text-gray-600 mb-4">
            Estos son los valores <strong>preferentes del convenio</strong> por cremación solicitada, según el peso de la mascota y el tipo de servicio.
            Quedan asignados automáticamente al inscribir tu clínica.
          </p>
          <div className="bg-white rounded-xl shadow-md border border-gray-300 overflow-x-auto">
            {tramos.length === 0 ? (
              <div className="p-6 text-center text-gray-400 text-sm">Cargando tarifas…</div>
            ) : (
              <table className="w-full min-w-[520px] text-sm sm:text-base">
                <thead style={{ backgroundColor: COLOR }} className="text-white">
                  <tr>
                    <th className="px-3 sm:px-4 py-3 text-left text-xs sm:text-sm">Peso de la mascota</th>
                    <th className="px-3 sm:px-4 py-3 text-right text-xs sm:text-sm">Individual</th>
                    <th className="px-3 sm:px-4 py-3 text-right text-xs sm:text-sm">Premium</th>
                    <th className="px-3 sm:px-4 py-3 text-right text-xs sm:text-sm">Sin devolución</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {tramos.map(t => (
                    <tr key={t.id}>
                      <td className="px-3 sm:px-4 py-3 text-gray-700">{rangoPeso(t.peso_min, t.peso_max)}</td>
                      <td className="px-3 sm:px-4 py-3 text-right font-semibold text-gray-900">{fmtPrecio(precioNum(t.precio_ci))}</td>
                      <td className="px-3 sm:px-4 py-3 text-right text-gray-700">{fmtPrecio(precioNum(t.precio_cp))}</td>
                      <td className="px-3 sm:px-4 py-3 text-right text-gray-700">{fmtPrecio(precioNum(t.precio_sd))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <p className="text-xs text-gray-500 mt-3">
            <strong>Cremación Individual:</strong> devolvemos las cenizas de tu paciente. ·
            <strong> Premium:</strong> incluye ánfora premium. ·
            <strong> Sin devolución:</strong> cremación comunitaria, sin retorno de cenizas.
          </p>
        </section>

        {/* Formulario */}
        <section id="inscripcion">
          <h2 className="text-2xl font-bold text-gray-900 mb-3">Inscribe tu clínica al convenio</h2>
          <p className="text-gray-600 mb-6">Es gratis y toma un minuto. Al enviar, la clínica queda inscrita con las tarifas de convenio y te llega un correo con los datos.</p>

          {resultado && resultado.tipo === 'error' && (
            <div className="mb-6 p-4 rounded-lg border bg-red-50 border-red-200 text-red-800">
              {resultado.mensaje}
            </div>
          )}

          <form onSubmit={enviar} className="bg-white rounded-xl shadow-md border border-gray-300 p-4 sm:p-6 space-y-5 sm:space-y-6">
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

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField label="Nombre de la clínica / veterinaria" required>
                <input type="text" required value={form.nombre} onChange={e => setForm({ ...form, nombre: e.target.value })} className={inputCls} />
              </FormField>
              <FormField label="RUT" required hint="De la empresa o del titular">
                <input type="text" required value={form.rut} onChange={e => setForm({ ...form, rut: e.target.value })} placeholder="76123456-7" className={inputCls} />
              </FormField>
              <FormField label="Razón social">
                <input type="text" value={form.razon_social} onChange={e => setForm({ ...form, razon_social: e.target.value })} className={inputCls} />
              </FormField>
              <FormField label="Giro">
                <input type="text" value={form.giro} onChange={e => setForm({ ...form, giro: e.target.value })} placeholder="Servicios veterinarios" className={inputCls} />
              </FormField>
              <FormField label="Dirección de la clínica" required hint="Donde retiramos">
                <input type="text" required value={form.direccion} onChange={e => setForm({ ...form, direccion: e.target.value })} className={inputCls} />
              </FormField>
              <div>
                <label className="block text-sm font-medium text-gray-900 mb-1">
                  Comuna <span className="text-red-500">*</span>
                </label>
                {/* Una sola comuna: el picker conserva la última seleccionada. */}
                <ComunaPicker value={comunas} onChange={v => setComunas(v.slice(-1))} color={COLOR} />
              </div>
              <FormField label="Teléfono" required hint="9 dígitos, sin +56">
                <input
                  type="tel" required value={form.telefono}
                  onChange={e => setForm({ ...form, telefono: e.target.value.replace(/\D/g, '').slice(0, 9) })}
                  placeholder="912345678" className={inputCls}
                />
              </FormField>
              <FormField label="Correo" required hint="Aquí llegan las confirmaciones de cada retiro">
                <input type="email" required value={form.correo} onChange={e => setForm({ ...form, correo: e.target.value })} className={inputCls} />
              </FormField>
              <FormField label="Persona de contacto" required>
                <input type="text" required value={form.nombre_contacto} onChange={e => setForm({ ...form, nombre_contacto: e.target.value })} className={inputCls} />
              </FormField>
              <FormField label="Cargo del contacto" hint="Ej: médico veterinario, administrador/a">
                <input type="text" value={form.cargo_contacto} onChange={e => setForm({ ...form, cargo_contacto: e.target.value })} className={inputCls} />
              </FormField>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-2 border-t border-gray-300">
              <p className="text-xs text-gray-500 sm:flex-1">
                Al enviar, la clínica queda inscrita en el convenio y aceptas que te contactemos para coordinar los retiros.
              </p>
              <button
                type="submit"
                disabled={enviando}
                className="w-full sm:w-auto px-6 py-3 text-white font-medium rounded-lg disabled:opacity-60 transition-opacity text-base"
                style={{ backgroundColor: COLOR }}
              >
                {enviando ? 'Enviando…' : 'Inscribir mi clínica'}
              </button>
            </div>
          </form>
        </section>

        <footer className="text-center pt-8 border-t" style={{ borderColor: HAIRLINE }}>
          <img src={SELLO} alt="Sello Crematorio Alma Animal — proceso con amor y respeto" className="mx-auto h-20 w-20 mb-3" />
          <p className="text-xs text-gray-500">
            ¿Dudas? Escríbenos a <a href="mailto:contacto@crematorioalmaanimal.cl" className="underline" style={{ color: COLOR }}>contacto@crematorioalmaanimal.cl</a>
          </p>
        </footer>
      </main>

      {/* Pop-up de bienvenida tras inscripción exitosa */}
      <Modal
        open={!!resultado && (resultado.tipo === 'ok' || resultado.tipo === 'duplicado')}
        onClose={() => setResultado(null)}
        title={resultado?.tipo === 'duplicado' ? 'Clínica ya inscrita' : '¡Bienvenidos al convenio!'}
      >
        <div className="text-center py-2">
          <div className="text-5xl mb-3">{resultado?.tipo === 'duplicado' ? '👋' : '🎉'}</div>
          <p className="text-base text-gray-800 mb-2">{resultado?.mensaje}</p>
          {resultado?.tipo === 'ok' && (
            <p className="text-sm text-gray-500 mt-3">
              Revisa tu correo: te enviamos la bienvenida con los datos del convenio (si no lo ves, mira la carpeta de spam).
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
    <div className="bg-white rounded-xl p-5 border shadow-md" style={{ borderColor: HAIRLINE }}>
      <div
        className="w-9 h-9 rounded-full flex items-center justify-center font-bold text-base mb-3"
        style={{ backgroundColor: COLOR, color: AMBER }}
      >
        {num}
      </div>
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
