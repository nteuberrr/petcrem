import { Suspense } from 'react'
import { PageHeader } from '@/components/ui/kit'
import MensajesView from '@/components/MensajesView'

export default function MensajesPage() {
  return (
    <div>
      <div className="mb-4">
        <PageHeader title="Mensajes" subtitle="Bandeja unificada de WhatsApp, Instagram y Facebook." />
      </div>
      {/* Suspense: MensajesView lee `?tel=` (el enlace de WhatsApp de la ficha
          del cliente) con useSearchParams, que lo exige. */}
      <Suspense fallback={<p className="text-sm text-gray-500">Cargando conversaciones…</p>}>
        <MensajesView />
      </Suspense>
    </div>
  )
}
