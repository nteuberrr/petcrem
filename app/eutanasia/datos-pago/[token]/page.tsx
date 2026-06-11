'use client'
import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { Modal } from '@/components/ui/Modal'
import { BANCOS_CL, TIPOS_CUENTA } from '@/lib/bancos-cl'

const COLOR = '#143C64'

interface VetInfo {
  id: string
  nombre: string
  apellido: string
  email: string
  rut: string
  banco: string
  tipo_cuenta: string
  numero_cuenta: string
}

/**
 * Página pública para que el vet registre sus datos bancarios (una sola vez).
 * Se llega desde un link en el mail de bienvenida y/o en el de cotización.
 * El token (firmado, TTL 30d) identifica al vet — sin él no se puede acceder
 * ni se exponen datos. Si los datos ya fueron registrados, el backend responde
 * `ya_completado` y se muestra un aviso en lugar del formulario (cambios
 * posteriores se gestionan por correo).
 */
export default function DatosPagoPage() {
  const params = useParams<{ token: string }>()
  const token = params?.token ?? ''
  const [estado, setEstado] = useState<'cargando' | 'listo' | 'error' | 'ya_completado'>('cargando')
  const [errorMsg, setErrorMsg] = useState('')
  const [yaCompletadoMsg, setYaCompletadoMsg] = useState('')
  const [vet, setVet] = useState<VetInfo | null>(null)

  const [form, setForm] = useState({
    nombre: '',
    rut: '',
    banco: '',
    tipo_cuenta: '',
    numero_cuenta: '',
    email: '',
  })
  const [enviando, setEnviando] = useState(false)
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
        const r = await fetch(`/api/eutanasias/vets/datos-pago?token=${encodeURIComponent(token)}`)
        const j = await r.json()
        if (j.ya_completado) {
          setYaCompletadoMsg(j.mensaje || 'Tus datos de pago ya están registrados.')
          setEstado('ya_completado')
          return
        }
        if (!r.ok || !j.ok) {
          setErrorMsg(j.error || 'No pudimos cargar tus datos.')
          setEstado('error')
          return
        }
        const v = j.vet as VetInfo
        setVet(v)
        setForm({
          nombre: `${v.nombre} ${v.apellido}`.trim(),
          rut: v.rut || '',
          banco: v.banco || '',
          tipo_cuenta: v.tipo_cuenta || '',
          numero_cuenta: v.numero_cuenta || '',
          email: v.email || '',
        })
        setEstado('listo')
      } catch {
        setErrorMsg('Error de red. Verifica tu conexión.')
        setEstado('error')
      }
    })()
  }, [token])

  async function enviar(e: React.FormEvent) {
    e.preventDefault()
    setResultError('')
    setEnviando(true)
    try {
      const r = await fetch('/api/eutanasias/vets/datos-pago', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, ...form }),
      })
      const j = await r.json()
      if (j.ya_completado) {
        setYaCompletadoMsg(j.mensaje || 'Tus datos de pago ya están registrados.')
        setEstado('ya_completado')
      } else if (!r.ok || !j.ok) {
        setResultError(j.error || 'No pudimos guardar tus datos.')
      } else {
        setConfirmado({ mensaje: j.mensaje, email_cambio: !!j.email_cambio })
      }
    } catch {
      setResultError('Error de red. Verifica tu conexión.')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header style={{ backgroundColor: COLOR }} className="text-white py-6 sm:py-8 px-4">
        <div className="max-w-2xl mx-auto">
          <p className="text-xs sm:text-sm uppercase tracking-widest opacity-80">Alma Animal · Convenio Eutanasias</p>
          <h1 className="text-xl sm:text-2xl font-bold mt-2">Datos para tu pago</h1>
          <p className="text-sm sm:text-base mt-2 opacity-95">
            Ingresa tus datos bancarios. Los usaremos para transferirte el pago al día hábil siguiente de cada servicio realizado.
          </p>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-8">
        {estado === 'cargando' && (
          <div className="bg-white rounded-xl border border-gray-200 p-6 text-center text-gray-500 text-sm">Verificando…</div>
        )}

        {estado === 'error' && (
          <div className="bg-white rounded-xl border border-gray-200 p-6 text-center">
            <p className="text-5xl mb-3">⚠</p>
            <h2 className="text-lg font-semibold text-gray-900 mb-1">No pudimos cargar tu información</h2>
            <p className="text-sm text-gray-600">{errorMsg}</p>
            <p className="text-xs text-gray-500 mt-4">
              Si crees que esto es un error, escríbenos a{' '}
              <a className="underline text-gray-700" href="mailto:info@crematorioalmaanimal.cl">info@crematorioalmaanimal.cl</a>.
            </p>
          </div>
        )}

        {estado === 'ya_completado' && (
          <div className="bg-white rounded-xl border border-gray-200 p-6 text-center">
            <p className="text-5xl mb-3">🐾</p>
            <h2 className="text-lg font-semibold text-gray-900 mb-1">Tus datos ya están registrados</h2>
            <p className="text-sm text-gray-600">{yaCompletadoMsg}</p>
            <p className="text-xs text-gray-500 mt-4">
              Por tu seguridad, este formulario solo se puede completar una vez.
            </p>
          </div>
        )}

        {estado === 'listo' && vet && (
          <form onSubmit={enviar} className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 sm:p-6 space-y-4">
            <Field label="Nombre completo" required>
              <input type="text" required value={form.nombre} onChange={e => setForm({ ...form, nombre: e.target.value })} className={inputCls} />
            </Field>

            <Field label="RUT" required hint="Formato: 12345678-9">
              <input type="text" required value={form.rut} onChange={e => setForm({ ...form, rut: e.target.value })} placeholder="12345678-9" className={inputCls} />
            </Field>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Banco" required>
                <select required value={form.banco} onChange={e => setForm({ ...form, banco: e.target.value })} className={inputCls}>
                  <option value="">Selecciona un banco…</option>
                  {BANCOS_CL.map(b => <option key={b} value={b}>{b}</option>)}
                </select>
              </Field>

              <Field label="Tipo de cuenta" required>
                <select required value={form.tipo_cuenta} onChange={e => setForm({ ...form, tipo_cuenta: e.target.value })} className={inputCls}>
                  <option value="">Selecciona…</option>
                  {TIPOS_CUENTA.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </Field>
            </div>

            <Field label="Número de cuenta" required hint="Solo números, sin guiones ni espacios">
              <input
                type="text"
                inputMode="numeric"
                required
                value={form.numero_cuenta}
                onChange={e => setForm({ ...form, numero_cuenta: e.target.value.replace(/\D/g, '') })}
                className={inputCls}
              />
            </Field>

            <Field label="Email" required hint="Te enviaremos comprobantes y notificaciones a este correo">
              <input type="email" required value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} className={inputCls} />
            </Field>

            {resultError && (
              <div className="bg-red-50 border border-red-200 text-red-800 rounded-lg p-3 text-sm">{resultError}</div>
            )}

            <button
              type="submit"
              disabled={enviando}
              className="w-full px-6 py-3 text-white font-medium rounded-lg disabled:opacity-60 transition-opacity text-base"
              style={{ backgroundColor: COLOR }}
            >
              {enviando ? 'Enviando…' : 'Enviar datos'}
            </button>

            <p className="text-xs text-gray-500 text-center">
              Solo guardamos esta información para transferirte los pagos.
              Si necesitas hacer cambios más adelante, escríbenos a{' '}
              <a className="underline" href="mailto:info@crematorioalmaanimal.cl">info@crematorioalmaanimal.cl</a>.
            </p>
          </form>
        )}
      </main>

      {/* Pop-up de confirmación */}
      <Modal
        open={!!confirmado}
        onClose={() => setConfirmado(null)}
        title="¡Datos recibidos!"
      >
        <div className="text-center py-2">
          <div className="text-5xl mb-3">✅</div>
          <p className="text-base text-gray-800 mb-2">
            {confirmado?.mensaje}
          </p>
          {confirmado?.email_cambio && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2 mt-3">
              Detectamos que cambiaste tu email registrado. Las próximas cotizaciones te llegarán al nuevo correo.
            </p>
          )}
          <button
            onClick={() => setConfirmado(null)}
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

const inputCls = 'w-full px-3 py-2.5 border border-gray-300 rounded-lg text-base focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none'
