'use client'
import { useState, useEffect } from 'react'
import { Modal } from '@/components/ui/Modal'
import { fmtPrecio } from '@/lib/format'
import { todayISO } from '@/lib/dates'

// ─────────────────────────────────────────────────────────────────────────────
// Formulario PÚBLICO de registro de mascota (auto-atención del tutor).
//
// Es la misma ficha que el operador llena en /clientes, pero acotada a un cliente
// GENERAL (sin veterinaria, sin adicionales, sin datos de pago). Al final muestra
// el precio del servicio según el peso, aplicando la regla de borde (tramo mayor).
// Postea a /api/clientes/publico (ruta whitelisteada, sin sesión).
// ─────────────────────────────────────────────────────────────────────────────

type Tramo = { id: string; peso_min: string; peso_max: string; precio_ci: string; precio_cp: string; precio_sd: string }
type Especie = { id: string; nombre: string; letra: string }

const COLOR = '#143C64'
const AMBER = '#F2B84B'
const CREAM = '#FBF8F3'
const HAIRLINE = '#ece6db'
const LOGO = '/brand/logo-alma-animal.png'
const SELLO = '/brand/sello-alma-animal.png'

const SERVICIOS = [
  { nombre: 'Cremación Individual', codigo: 'CI', desc: 'Devolvemos las cenizas en ánfora, con certificado y placa con su nombre.' },
  { nombre: 'Cremación Premium', codigo: 'CP', desc: 'Lo de la Individual + ánfora premium a elección y cuadro conmemorativo.' },
  { nombre: 'Cremación Sin Devolución', codigo: 'SD', desc: 'Cremación trazable, sin devolución de cenizas.' },
] as const

const FORM_DEFAULT = {
  nombre_mascota: '',
  nombre_tutor: '',
  email: '',
  telefono: '',
  direccion_retiro: '',
  direccion_despacho: '',
  misma_direccion: true,
  comuna: '',
  fecha_defuncion: '',
  fecha_retiro: '',
  especie: '',
  letra_especie: '',
  peso_declarado: '',
  tipo_servicio: 'Cremación Individual',
  codigo_servicio: 'CI' as 'CI' | 'CP' | 'SD',
}

// Regla de borde: intervalos [min, max). En el límite exacto gana el tramo MAYOR
// (ej. 15 kg entre 10–15 y 15–25 → usa 15–25). Idéntica a lib/price-calculator.
function encontrarTramo(tabla: Tramo[], peso: number): Tramo | null {
  if (!tabla.length || !isFinite(peso) || peso <= 0) return null
  const maxPesoMin = Math.max(...tabla.map(t => parseFloat(t.peso_min) || 0))
  const tramoTope = tabla.find(t => (parseFloat(t.peso_min) || 0) === maxPesoMin)
  if (tramoTope && peso >= maxPesoMin) return tramoTope
  return tabla.find(t => {
    const min = parseFloat(t.peso_min) || 0
    const max = parseFloat(t.peso_max) || 0
    return peso >= min && peso < max
  }) ?? null
}
function precioDelTramo(t: Tramo | null, codigo: string): number {
  if (!t) return 0
  const raw = codigo === 'CP' ? t.precio_cp : codigo === 'SD' ? t.precio_sd : t.precio_ci
  return parseFloat(raw) || 0
}

export default function RegistroMascotaPage() {
  const [especies, setEspecies] = useState<Especie[]>([])
  const [tramos, setTramos] = useState<Tramo[]>([])
  const [form, setForm] = useState(() => ({ ...FORM_DEFAULT, fecha_retiro: todayISO() }))
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState('')
  const [exito, setExito] = useState<{ modo: 'crear' | 'completar'; codigo?: string; nombre_mascota: string; precio_total?: number } | null>(null)
  // Modo: 'crear' (auto-atención: genera código) o 'completar' (link firmado del
  // WhatsApp de retiro confirmado: solo completa el borrador, sin código).
  const [modo, setModo] = useState<'crear' | 'completar'>('crear')
  const [token, setToken] = useState<string>('')
  const [yaIngresada, setYaIngresada] = useState(false)

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('ficha') || ''
    if (t) {
      // Modo completar: cargar el borrador y prellenar.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setToken(t)
      setModo('completar')
      fetch(`/api/clientes/completar-borrador?t=${encodeURIComponent(t)}`)
        .then(r => r.json())
        .then(d => {
          if (d?.error) { setError(d.error); return }
          setEspecies(Array.isArray(d?.especies) ? d.especies : [])
          setTramos(Array.isArray(d?.tramos) ? d.tramos : [])
          if (d?.yaIngresada) { setYaIngresada(true); return }
          const b = d?.borrador
          if (b) {
            setForm(f => ({
              ...f,
              nombre_mascota: b.nombre_mascota || '',
              nombre_tutor: b.nombre_tutor || '',
              email: b.email || '',
              telefono: b.telefono || '',
              direccion_retiro: b.direccion_retiro || '',
              direccion_despacho: b.direccion_despacho || '',
              misma_direccion: b.misma_direccion !== false,
              comuna: b.comuna || '',
              fecha_retiro: b.fecha_retiro || f.fecha_retiro,
              fecha_defuncion: b.fecha_defuncion || '',
              especie: b.especie || '',
              letra_especie: b.letra_especie || '',
              peso_declarado: b.peso_declarado || '',
              codigo_servicio: (b.codigo_servicio as 'CI' | 'CP' | 'SD') || 'CI',
              tipo_servicio: b.tipo_servicio || f.tipo_servicio,
            }))
          }
        })
        .catch(() => setError('No pudimos cargar tu ficha. Intenta nuevamente.'))
    } else {
      fetch('/api/clientes/publico')
        .then(r => r.json())
        .then(d => {
          setEspecies(Array.isArray(d?.especies) ? d.especies : [])
          setTramos(Array.isArray(d?.tramos) ? d.tramos : [])
        })
        .catch(() => {})
    }
  }, [])

  const pesoKg = parseFloat(String(form.peso_declarado).replace(',', '.')) || 0
  const tramo = encontrarTramo(tramos, pesoKg)
  const precioServicio = precioDelTramo(tramo, form.codigo_servicio)
  const rangoTramo = tramo ? (() => {
    const maxPesoMin = Math.max(...tramos.map(t => parseFloat(t.peso_min) || 0))
    const min = parseFloat(tramo.peso_min) || 0
    return min === maxPesoMin ? `${min} kg o más` : `${tramo.peso_min} – ${tramo.peso_max} kg`
  })() : null

  async function enviar(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!/^\d{9}$/.test(form.telefono)) {
      setError('El teléfono debe tener exactamente 9 dígitos (sin el +56).')
      return
    }
    setEnviando(true)
    const payload = {
      ...form,
      peso_declarado: pesoKg,
      direccion_despacho: form.misma_direccion ? form.direccion_retiro : form.direccion_despacho,
    }
    try {
      if (modo === 'completar') {
        const r = await fetch('/api/clientes/completar-borrador', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ t: token, ...payload }),
        })
        const d = await r.json().catch(() => ({}))
        if (r.ok) {
          setExito({ modo: 'completar', nombre_mascota: d.nombre_mascota || form.nombre_mascota })
        } else if (r.status === 409 || d?.yaIngresada) {
          setYaIngresada(true)
        } else {
          setError(d?.error ?? 'No pudimos guardar tus datos. Revisa e inténtalo de nuevo.')
        }
      } else {
        const r = await fetch('/api/clientes/publico', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        const d = await r.json().catch(() => ({}))
        if (r.ok) {
          setExito({ modo: 'crear', codigo: d.codigo, nombre_mascota: d.nombre_mascota, precio_total: d.precio_total })
          setForm({ ...FORM_DEFAULT, fecha_retiro: todayISO() })
        } else {
          setError(d?.error ?? 'No pudimos registrar la ficha. Revisa los datos e inténtalo de nuevo.')
        }
      }
    } catch {
      setError('Error de red. Verifica tu conexión e inténtalo de nuevo.')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div className="min-h-screen" style={{ backgroundColor: CREAM }}>
      {/* Header — misma identidad que los correos: barra navy + logo + filete dorado */}
      <header style={{ backgroundColor: COLOR }} className="text-white py-8 sm:py-10 px-4">
        <div className="max-w-3xl mx-auto flex items-center justify-between gap-4">
          <div>
            <p className="text-[11px] sm:text-xs uppercase tracking-[0.18em] font-bold" style={{ color: AMBER }}>🐾 Crematorio Alma Animal</p>
            <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold mt-2">{modo === 'completar' ? 'Completa los datos de tu mascota' : 'Registro de tu mascota'}</h1>
            <p className="text-base sm:text-lg mt-3 opacity-95 max-w-2xl">
              {modo === 'completar'
                ? 'Tu retiro ya está confirmado. Completa lo que puedas para agilizar el ingreso — y si algo no lo sabes, no te preocupes: lo coordinamos al momento del retiro.'
                : 'Completa los datos para coordinar el servicio. Es un paso simple y nos permite acompañarte con todo el cuidado que mereces.'}
            </p>
          </div>
          <img src={LOGO} alt="Alma Animal" className="hidden sm:block h-24 w-auto shrink-0" />
        </div>
      </header>
      <div style={{ backgroundColor: AMBER }} className="h-1" />

      <main className="max-w-3xl mx-auto px-4 py-8 sm:py-10">
        {error && (
          <div className="mb-6 p-4 rounded-lg border bg-red-50 border-red-200 text-red-800 text-sm">
            {error}
          </div>
        )}

        {yaIngresada ? (
          <div className="bg-white rounded-xl shadow-md border border-gray-300 p-6 sm:p-8 text-center">
            <div className="text-5xl mb-3">🐾</div>
            <p className="text-base text-gray-800">
              Esta ficha ya fue ingresada por nuestro equipo. No necesitas hacer nada más — cualquier duda, escríbenos a <a href="mailto:contacto@crematorioalmaanimal.cl" className="underline" style={{ color: COLOR }}>contacto@crematorioalmaanimal.cl</a>.
            </p>
          </div>
        ) : (
        <form onSubmit={enviar} className="bg-white rounded-xl shadow-md border border-gray-300 p-4 sm:p-6 space-y-6">
          {/* Datos del tutor */}
          <section>
            <h2 className="text-lg font-bold text-gray-900 mb-3">Tus datos</h2>
            <div className="grid sm:grid-cols-2 gap-4">
              <FormField label="Tu nombre" required>
                <input type="text" required value={form.nombre_tutor}
                  onChange={e => setForm(f => ({ ...f, nombre_tutor: e.target.value }))} className={inputCls} />
              </FormField>
              <FormField label="Email" required hint="Aquí te enviaremos el código de tu mascota">
                <input type="email" required value={form.email}
                  onChange={e => setForm(f => ({ ...f, email: e.target.value }))} className={inputCls} placeholder="ejemplo@correo.cl" />
              </FormField>
              <FormField label="Teléfono" required hint="9 dígitos, sin el +56">
                <input type="tel" required inputMode="numeric" value={form.telefono}
                  onChange={e => setForm(f => ({ ...f, telefono: e.target.value.replace(/\D/g, '').slice(0, 9) }))}
                  className={inputCls} placeholder="912345678" />
              </FormField>
              <FormField label="Comuna" required>
                <input type="text" required value={form.comuna}
                  onChange={e => setForm(f => ({ ...f, comuna: e.target.value }))} className={inputCls} placeholder="Ej: Providencia" />
              </FormField>
            </div>
          </section>

          {/* Dirección */}
          <section className="border-t border-gray-300 pt-5">
            <h2 className="text-lg font-bold text-gray-900 mb-3">Dirección de retiro</h2>
            <FormField label="Dirección donde retiramos a tu mascota" required>
              <input type="text" required value={form.direccion_retiro}
                onChange={e => setForm(f => ({ ...f, direccion_retiro: e.target.value, direccion_despacho: f.misma_direccion ? e.target.value : f.direccion_despacho }))}
                className={inputCls} placeholder="Calle, número, depto/casa" />
            </FormField>
            <label className="flex items-center gap-2 mt-3 cursor-pointer select-none">
              <input type="checkbox" checked={form.misma_direccion}
                onChange={e => setForm(f => ({ ...f, misma_direccion: e.target.checked, direccion_despacho: e.target.checked ? f.direccion_retiro : '' }))}
                className="w-4 h-4 rounded border-gray-400" />
              <span className="text-sm text-gray-700">Entregar las cenizas en la misma dirección</span>
            </label>
            {!form.misma_direccion && (
              <div className="mt-3">
                <FormField label="Dirección de entrega" required>
                  <input type="text" required value={form.direccion_despacho}
                    onChange={e => setForm(f => ({ ...f, direccion_despacho: e.target.value }))} className={inputCls} placeholder="Calle, número, depto/casa" />
                </FormField>
              </div>
            )}
          </section>

          {/* Mascota */}
          <section className="border-t border-gray-300 pt-5">
            <h2 className="text-lg font-bold text-gray-900 mb-3">Datos de tu mascota</h2>
            <div className="grid sm:grid-cols-2 gap-4">
              <FormField label="Nombre de tu mascota" required>
                <input type="text" required value={form.nombre_mascota}
                  onChange={e => setForm(f => ({ ...f, nombre_mascota: e.target.value }))} className={inputCls} />
              </FormField>
              <FormField label="Especie" required>
                <select required value={form.especie}
                  onChange={e => {
                    const esp = especies.find(es => es.nombre === e.target.value)
                    setForm(f => ({ ...f, especie: e.target.value, letra_especie: esp?.letra ?? '' }))
                  }}
                  className={inputCls}>
                  <option value="">Seleccionar…</option>
                  {especies.map(e => <option key={e.id} value={e.nombre}>{e.nombre}</option>)}
                </select>
              </FormField>
              <FormField label="Peso (kg)" required hint="Aproximado está bien">
                <input type="number" required step="0.1" min="0" value={form.peso_declarado}
                  onChange={e => setForm(f => ({ ...f, peso_declarado: e.target.value }))} className={inputCls} placeholder="Ej: 12" />
              </FormField>
              <FormField label="Fecha de fallecimiento" required>
                <input type="date" required value={form.fecha_defuncion}
                  onChange={e => setForm(f => ({ ...f, fecha_defuncion: e.target.value }))} className={inputCls} />
              </FormField>
              <FormField label="Fecha de retiro" required>
                <input type="date" required value={form.fecha_retiro}
                  onChange={e => setForm(f => ({ ...f, fecha_retiro: e.target.value }))} className={inputCls} />
              </FormField>
            </div>
          </section>

          {/* Tipo de servicio */}
          <section className="border-t border-gray-300 pt-5">
            <h2 className="text-lg font-bold text-gray-900 mb-3">Tipo de servicio</h2>
            <div className="space-y-2">
              {SERVICIOS.map(s => {
                const activo = form.codigo_servicio === s.codigo
                const precio = precioDelTramo(tramo, s.codigo)
                return (
                  <label key={s.codigo}
                    className={`flex items-start gap-3 p-3 rounded-lg border-2 cursor-pointer transition-colors ${activo ? 'bg-[#143C64]/5' : 'hover:bg-gray-50'}`}
                    style={{ borderColor: activo ? COLOR : HAIRLINE }}>
                    <input type="radio" name="servicio" checked={activo}
                      onChange={() => setForm(f => ({ ...f, codigo_servicio: s.codigo, tipo_servicio: s.nombre }))}
                      className="mt-1 w-4 h-4" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-gray-900 text-sm">{s.nombre}</span>
                        {precio > 0 && <span className="font-bold text-sm shrink-0" style={{ color: COLOR }}>{fmtPrecio(precio)}</span>}
                      </div>
                      <p className="text-xs text-gray-500 mt-0.5">{s.desc}</p>
                    </div>
                  </label>
                )
              })}
            </div>
          </section>

          {/* Resumen de precio */}
          <section className="border-t border-gray-300 pt-5">
            <div className="rounded-xl p-4" style={{ backgroundColor: CREAM, border: `1px solid ${HAIRLINE}` }}>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-gray-900">{form.tipo_servicio}</p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {pesoKg > 0 && rangoTramo
                      ? `${pesoKg} kg · tramo ${rangoTramo}`
                      : 'Ingresa el peso para ver el precio'}
                    {pesoKg > 0 && !tramo && <span className="text-red-500 ml-1">· sin tramo aplicable</span>}
                  </p>
                </div>
                <p className="text-2xl font-bold" style={{ color: COLOR }}>{fmtPrecio(precioServicio)}</p>
              </div>
            </div>
          </section>

          <button type="submit" disabled={enviando}
            className="w-full px-6 py-3.5 text-white font-semibold rounded-lg disabled:opacity-60 transition-opacity text-base"
            style={{ backgroundColor: COLOR }}>
            {enviando
              ? (modo === 'completar' ? 'Guardando…' : 'Registrando…')
              : (modo === 'completar' ? 'Guardar mis datos' : 'Registrar a mi mascota')}
          </button>
        </form>
        )}

        <footer className="text-center pt-8 mt-8 border-t" style={{ borderColor: HAIRLINE }}>
          <img src={SELLO} alt="Sello Crematorio Alma Animal" className="mx-auto h-20 w-20 mb-3" />
          <p className="text-xs text-gray-500">
            ¿Dudas? Escríbenos a <a href="mailto:contacto@crematorioalmaanimal.cl" className="underline" style={{ color: COLOR }}>contacto@crematorioalmaanimal.cl</a> · +56 9 7864 0811
          </p>
        </footer>
      </main>

      {/* Pop-up de confirmación */}
      <Modal open={!!exito} onClose={() => setExito(null)} title={exito?.modo === 'completar' ? '¡Datos recibidos!' : '¡Registro completado!'}>
        {exito && (
          <div className="text-center py-2">
            <div className="text-5xl mb-3">🐾</div>
            <p className="text-base text-gray-800 mb-3">
              Gracias por confiar en nosotros para cuidar de <strong>{exito.nombre_mascota}</strong>.
            </p>
            {exito.modo === 'completar' ? (
              <p className="text-sm text-gray-600">
                Recibimos los datos. Nuestro equipo revisará y confirmará el ingreso, y te llegará el código de tu mascota por correo. No necesitas hacer nada más.
              </p>
            ) : (
              <>
                <div className="rounded-xl p-4 my-4" style={{ backgroundColor: CREAM, border: `1px solid ${HAIRLINE}` }}>
                  <p className="text-xs uppercase tracking-wide text-gray-500">Código de tu mascota</p>
                  <p className="text-2xl font-bold mt-1" style={{ color: COLOR }}>{exito.codigo}</p>
                </div>
                <p className="text-sm text-gray-600">
                  Te enviamos este código a tu correo. Nuestro equipo se contactará contigo para coordinar el retiro.
                </p>
              </>
            )}
            <button onClick={() => setExito(null)} className="mt-6 px-6 py-2.5 text-white font-medium rounded-lg" style={{ backgroundColor: COLOR }}>
              Entendido
            </button>
          </div>
        )}
      </Modal>
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

const inputCls = 'w-full px-3 py-2.5 border border-gray-300 rounded-lg text-base focus:ring-2 focus:ring-[#143C64] focus:border-[#143C64] outline-none'
