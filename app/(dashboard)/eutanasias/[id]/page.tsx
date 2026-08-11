'use client'
import { Stethoscope } from 'lucide-react'
import { use, useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { PageHeader, Card, Button } from '@/components/ui/kit'
import { Badge } from '@/components/ui/Badge'
import { NoRealizadaModal } from '@/components/eutanasias/NoRealizadaModal'
import type { MotivoNoRealizada } from '@/lib/eutanasia-motivos'
import { fmtPrecio } from '@/lib/format'
import { formatDate, formatHoraDia } from '@/lib/dates'
import { useAccionUnica } from '@/lib/use-accion-unica'
import { usePuedeModulo } from '@/lib/use-modulos'

/**
 * FICHA DE UNA EUTANASIA — la que se abre desde el dashboard (notificaciones) y
 * desde la agenda semanal. La ven TODOS los roles: además de los datos del
 * servicio, permite confirmar si la eutanasia se realizó o no sin depender de
 * que el veterinario marque el enlace que le llega por correo (pasa seguido que
 * no lo hace y el caso queda trabado: no se libera la ficha de cremación ni el
 * pago). El panel completo (precios, veterinarios, envíos) sigue en /servicios.
 */

type Ficha = {
  id: string
  estado: string
  estado_pago: string
  mascota_nombre: string
  especie: string
  peso: string
  cliente_nombre: string
  cliente_telefono: string
  cliente_email: string
  cliente_id: string
  direccion: string
  comuna: string
  fecha_servicio: string
  hora_servicio: string
  hora_retiro_crematorio: string
  incluye_cremacion: boolean
  notas: string
  vet_nombre: string
  vet_email: string
  vet_telefono: string
  fecha_realizacion: string
  cobro: { concepto: string; base: number; recargo: number; total: number }
  /** Advertencia del cierre (ej. la ficha de cremación ya estaba registrada). */
  aviso?: string
}

type ColorBadge = 'gray' | 'blue' | 'yellow' | 'green' | 'red'
const ESTADO_LABEL: Record<string, { texto: string; color: ColorBadge }> = {
  creada: { texto: 'Creada — buscando veterinario', color: 'gray' },
  enviada: { texto: 'Enviada a veterinarios', color: 'blue' },
  aceptada: { texto: 'Aceptada — en curso', color: 'yellow' },
  realizada: { texto: 'Realizada', color: 'green' },
  no_realizada: { texto: 'No se realizó (se cobra la consulta)', color: 'gray' },
  cancelada: { texto: 'Cancelada', color: 'red' },
}

function Dato({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{label}</p>
      <div className="text-sm text-gray-900 mt-0.5 break-words">{children || '—'}</div>
    </div>
  )
}

export default function FichaEutanasiaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const puedeServicios = usePuedeModulo('servicios')
  const [ficha, setFicha] = useState<Ficha | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [modalNoRealizada, setModalNoRealizada] = useState(false)
  const [aviso, setAviso] = useState('')
  const { ejecutar, procesando } = useAccionUnica()

  const cargar = useCallback(async () => {
    setCargando(true)
    try {
      const r = await fetch(`/api/eutanasias/ficha/${id}`, { cache: 'no-store' })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) { setError(d?.error || 'No se pudo cargar la eutanasia.'); return }
      setFicha(d as Ficha)
      setError('')
    } catch {
      setError('Error de red al cargar la eutanasia.')
    } finally {
      setCargando(false)
    }
  }, [id])

  useEffect(() => { cargar() }, [cargar])

  function confirmarRealizada() {
    if (!confirm('¿Confirmar que la eutanasia SÍ se realizó?\n\nSe le envía al tutor el agradecimiento con la reseña y el pago al veterinario queda pendiente.')) return
    enviarResultado({ resultado: 'realizada' })
  }

  /**
   * NO SE REALIZÓ → el motivo elegido en el modal decide el cierre: si se cae
   * también la cremación, si hay pago fijo al veterinario y si la ficha sigue
   * viva (ver lib/eutanasia-motivos).
   */
  function confirmarNoRealizada(motivo: MotivoNoRealizada) {
    enviarResultado({ resultado: 'no_realizada', motivo }, () => setModalNoRealizada(false))
  }

  function enviarResultado(body: Record<string, unknown>, alGuardar?: () => void) {
    ejecutar(async () => {
      setError('')
      setAviso('')
      try {
        const r = await fetch(`/api/eutanasias/ficha/${id}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        const d = await r.json().catch(() => ({}))
        if (!r.ok) { setError(d?.error || 'No se pudo guardar el resultado.'); return }
        setFicha(d as Ficha)
        if (typeof d?.aviso === 'string') setAviso(d.aviso)
        alGuardar?.()
      } catch {
        setError('Error de red. Intenta de nuevo.')
      }
    })
  }

  if (cargando && !ficha) return <p className="text-sm text-gray-500">Cargando…</p>

  if (!ficha) {
    return (
      <div className="space-y-4">
        <PageHeader title="Eutanasia a domicilio" subtitle={`N° ${id}`} icon={<Stethoscope className="w-7 h-7 text-brand" aria-hidden="true" />} />
        <Card className="p-6">
          <p className="text-sm text-red-600">{error || 'No encontramos esta eutanasia.'}</p>
          <Button variant="secondary" className="mt-3" onClick={() => router.push('/dashboard')}>Volver al dashboard</Button>
        </Card>
      </div>
    )
  }

  const est: { texto: string; color: ColorBadge } = ESTADO_LABEL[ficha.estado] || { texto: ficha.estado || '—', color: 'gray' }
  const abierta = !['realizada', 'no_realizada', 'cancelada'].includes(ficha.estado)
  const direccionCompleta = [ficha.direccion, ficha.comuna].filter(Boolean).join(', ')

  return (
    <div className="space-y-4">
      <PageHeader
        title={ficha.mascota_nombre || 'Eutanasia a domicilio'}
        subtitle={`Eutanasia a domicilio · N° ${ficha.id}${ficha.especie ? ` · ${ficha.especie}` : ''}${ficha.peso ? ` · ${ficha.peso} kg` : ''}`}
        icon={<Stethoscope className="w-7 h-7 text-brand" aria-hidden="true" />}
        actions={
          <>
            <Button variant="secondary" onClick={() => router.push('/dashboard')}>← Dashboard</Button>
            {ficha.cliente_id && (
              <Button variant="secondary" onClick={() => router.push(`/clientes/${ficha.cliente_id}`)}>
                Ficha de cremación →
              </Button>
            )}
            {puedeServicios && (
              <Button variant="ghost" onClick={() => router.push(`/servicios?coti=${ficha.id}`)}>
                Abrir en Servicios
              </Button>
            )}
          </>
        }
      />

      {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-2">{error}</p>}
      {aviso && <p className="text-sm text-amber-900 bg-amber-50 border border-amber-300 rounded-xl px-4 py-2">⚠️ {aviso}</p>}

      <Card className="p-5">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <Badge variant={est.color}>{est.texto}</Badge>
          {!ficha.incluye_cremacion && (
            <span className="text-xs font-semibold text-gray-600 bg-gray-100 border border-gray-300 rounded-lg px-2 py-1">
              Sin cremación
            </span>
          )}
        </div>
      </Card>

      {/* Confirmación del resultado: el motivo de que esta ficha exista. */}
      {abierta && (
        <Card className="p-5 border-brand/40">
          <h2 className="text-base font-bold text-brand">¿Se realizó la eutanasia?</h2>
          <p className="text-xs text-gray-600 mt-1 leading-snug">
            Confírmalo acá si el veterinario no lo marcó desde su enlace.
            {ficha.vet_nombre ? <> Asignada a <strong>{ficha.vet_nombre}</strong>.</> : <> Todavía no hay veterinario asignado.</>}
          </p>
          <div className="flex flex-wrap gap-2 mt-3">
            <button
              onClick={confirmarRealizada}
              disabled={procesando}
              className="px-4 py-2 text-sm bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-semibold rounded-xl">
              {procesando ? 'Guardando…' : '✓ Sí, se realizó'}
            </button>
            <button
              onClick={() => setModalNoRealizada(true)}
              disabled={procesando}
              className="px-4 py-2 text-sm bg-slate-600 hover:bg-slate-700 disabled:opacity-50 text-white font-semibold rounded-xl">
              ✗ No se realizó
            </button>
          </div>
          <p className="text-[11px] text-gray-500 mt-2 leading-snug">
            Al marcar que no se realizó te preguntamos por qué: se canceló · el veterinario decidió no realizarla ·
            la mascota falleció antes. De eso dependen el pago al veterinario y si la cremación sigue.
          </p>
        </Card>
      )}

      <NoRealizadaModal
        open={modalNoRealizada}
        onClose={() => setModalNoRealizada(false)}
        onConfirmar={confirmarNoRealizada}
        vetNombre={ficha.vet_nombre}
        procesando={procesando}
        error={error}
      />

      {ficha.estado === 'realizada' && (
        <Card className="p-5 bg-emerald-50 border-emerald-300">
          <p className="text-sm text-emerald-900">
            ✓ Eutanasia realizada{ficha.fecha_realizacion ? ` el ${formatDate(ficha.fecha_realizacion.slice(0, 10))}` : ''}.
            {ficha.estado_pago === 'pago_confirmado'
              ? ' Pago al veterinario confirmado.'
              : ' El pago al veterinario queda pendiente (se confirma en Servicios).'}
          </p>
        </Card>
      )}
      {ficha.estado === 'no_realizada' && (
        <Card className="p-5 bg-slate-50 border-slate-300">
          <p className="text-sm text-slate-800">✗ Evaluada: no correspondía realizarla. Se le paga la consulta al veterinario.</p>
        </Card>
      )}
      {ficha.estado === 'cancelada' && (
        <Card className="p-5 bg-red-50 border-red-300">
          <p className="text-sm text-red-900">
            🚫 Eutanasia cancelada: no se le paga al veterinario ni se le cobra al tutor.
            {ficha.cliente_id
              ? ' La ficha de cremación sigue abierta (revísala si tampoco corresponde).'
              : ' Sin ficha de cremación asociada.'}
          </p>
        </Card>
      )}

      <Card className="p-5">
        <h2 className="text-base font-bold text-gray-900 mb-3">Servicio</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <Dato label="Fecha y hora">
            {ficha.fecha_servicio ? `${formatDate(ficha.fecha_servicio)} · ${formatHoraDia(ficha.hora_servicio)}` : '—'}
          </Dato>
          <Dato label="Hora de retiro (crematorio)">
            {ficha.incluye_cremacion ? (ficha.hora_retiro_crematorio || 'Por confirmar con el veterinario') : 'Sin retiro (sin cremación)'}
          </Dato>
          <Dato label="Dirección">
            {direccionCompleta ? (
              <a
                href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${direccionCompleta}, Chile`)}`}
                target="_blank" rel="noreferrer" className="text-brand-soft hover:underline">
                {direccionCompleta}
              </a>
            ) : ''}
          </Dato>
          {ficha.cobro.total > 0 && (
            <Dato label={ficha.cobro.concepto === 'consulta' ? 'A cobrar al cliente (consulta)' : 'A cobrar al cliente'}>
              <span className="font-semibold">{fmtPrecio(ficha.cobro.total)}</span>
              {ficha.cobro.recargo > 0 && (
                <span className="block text-[11px] text-gray-500">
                  {fmtPrecio(ficha.cobro.base)} + {fmtPrecio(ficha.cobro.recargo)} fuera de horario
                </span>
              )}
            </Dato>
          )}
          {ficha.notas && <Dato label="Notas">{ficha.notas}</Dato>}
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="p-5">
          <h2 className="text-base font-bold text-gray-900 mb-3">Tutor</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Dato label="Nombre">{ficha.cliente_nombre}</Dato>
            <Dato label="Teléfono">
              {ficha.cliente_telefono
                ? <a href={`tel:+56${ficha.cliente_telefono}`} className="text-brand-soft hover:underline">+56 {ficha.cliente_telefono}</a>
                : ''}
            </Dato>
            <Dato label="Email">
              {ficha.cliente_email
                ? <a href={`mailto:${ficha.cliente_email}`} className="text-brand-soft hover:underline">{ficha.cliente_email}</a>
                : ''}
            </Dato>
          </div>
        </Card>

        <Card className="p-5">
          <h2 className="text-base font-bold text-gray-900 mb-3">Veterinario asignado</h2>
          {ficha.vet_nombre ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Dato label="Nombre">{ficha.vet_nombre}</Dato>
              <Dato label="Teléfono">
                {ficha.vet_telefono
                  ? <a href={`tel:+56${ficha.vet_telefono}`} className="text-brand-soft hover:underline">+56 {ficha.vet_telefono}</a>
                  : ''}
              </Dato>
              <Dato label="Email">
                {ficha.vet_email
                  ? <a href={`mailto:${ficha.vet_email}`} className="text-brand-soft hover:underline">{ficha.vet_email}</a>
                  : ''}
              </Dato>
            </div>
          ) : (
            <p className="text-sm text-gray-500">Todavía ningún veterinario tomó el caso.</p>
          )}
        </Card>
      </div>
    </div>
  )
}
