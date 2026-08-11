'use client'
import { useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/kit'
import { MOTIVOS_NO_REALIZADA, type MotivoNoRealizada } from '@/lib/eutanasia-motivos'

/**
 * "No se realizó" → ¿por qué?
 *
 * Las tres salidas cierran el caso muy distinto (pago al veterinario y suerte de
 * la cremación), así que el modal las muestra lado a lado con sus consecuencias
 * y exige elegir una antes de confirmar. Lo comparten la ficha de la eutanasia
 * (dashboard/agenda) y el panel de Servicios: la decisión tiene que ser la misma
 * se abra por donde se abra.
 */
export function NoRealizadaModal({ open, onClose, onConfirmar, vetNombre, procesando, error }: {
  open: boolean
  onClose: () => void
  onConfirmar: (motivo: MotivoNoRealizada) => void
  vetNombre?: string
  procesando?: boolean
  error?: string
}) {
  const [motivo, setMotivo] = useState<MotivoNoRealizada | null>(null)

  // Cada apertura arranca sin selección: nada preseleccionado que se confirme de
  // un enter. Se ajusta durante el render (patrón de estado derivado de props),
  // no en un efecto, para no encadenar un render de más.
  const [abiertoAntes, setAbiertoAntes] = useState(open)
  if (open !== abiertoAntes) {
    setAbiertoAntes(open)
    if (open) setMotivo(null)
  }

  return (
    <Modal open={open} onClose={onClose} title="¿Por qué no se realizó?" size="2xl">
      <p className="text-sm text-gray-600 leading-snug">
        Elige el motivo: cada uno cierra el caso distinto.
        {vetNombre ? <> La eutanasia está asignada a <strong>{vetNombre}</strong>.</> : null}
      </p>

      <div className="mt-4 space-y-3">
        {MOTIVOS_NO_REALIZADA.map(op => {
          const activo = motivo === op.valor
          // Sin veterinario asignado nadie pudo decidir no realizarla: cerrar por
          // ahí dejaría un pago de consulta pendiente sin destinatario.
          const bloqueada = op.valor === 'vet_no_realizo' && !vetNombre
          return (
            <button
              key={op.valor}
              type="button"
              onClick={() => setMotivo(op.valor)}
              aria-pressed={activo}
              disabled={bloqueada}
              title={bloqueada ? 'Requiere un veterinario asignado.' : undefined}
              className={`w-full text-left rounded-2xl border p-4 transition-colors ${
                bloqueada ? 'border-gray-200 bg-gray-50 opacity-60 cursor-not-allowed'
                  : activo ? 'border-brand bg-brand/5 ring-2 ring-brand' : 'border-gray-300 bg-white hover:bg-gray-50'
              }`}
            >
              <div className="flex items-start gap-3">
                <span
                  aria-hidden="true"
                  className={`mt-0.5 w-4 h-4 shrink-0 rounded-full border-2 ${
                    activo ? 'border-brand bg-brand' : 'border-gray-400 bg-white'
                  }`}
                />
                <div className="min-w-0">
                  <p className="text-sm font-bold text-brand">{op.titulo}</p>
                  <p className="text-xs text-gray-600 mt-0.5 leading-snug">{op.resumen}</p>
                  {bloqueada && (
                    <p className="text-[11px] font-semibold text-amber-700 mt-1">No disponible: no hay veterinario asignado.</p>
                  )}
                  <dl className="mt-2 grid grid-cols-1 sm:grid-cols-3 gap-x-4 gap-y-1.5">
                    {([['Veterinario', op.vet], ['Cremación', op.cremacion], ['Tutor', op.tutor]] as const).map(([k, v]) => (
                      <div key={k} className="min-w-0">
                        <dt className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">{k}</dt>
                        <dd className="text-xs text-gray-800 leading-snug">{v}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              </div>
            </button>
          )
        })}
      </div>

      {error && <p className="text-sm text-red-600 mt-3">{error}</p>}

      <div className="flex justify-end gap-2 mt-5">
        <Button variant="secondary" onClick={onClose} disabled={procesando}>Volver</Button>
        <Button
          onClick={() => motivo && onConfirmar(motivo)}
          disabled={!motivo || procesando}
        >
          {procesando ? 'Guardando…' : 'Confirmar'}
        </Button>
      </div>
    </Modal>
  )
}
