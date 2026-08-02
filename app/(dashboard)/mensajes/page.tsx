import { PageHeader } from '@/components/ui/kit'
import MensajesView from '@/components/MensajesView'

export default function MensajesPage() {
  return (
    <div>
      <div className="mb-4">
        <PageHeader title="Mensajes" subtitle="Bandeja unificada de WhatsApp, Instagram y Facebook." />
      </div>
      <MensajesView />
    </div>
  )
}
