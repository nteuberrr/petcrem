import MensajesView from '@/components/MensajesView'

export default function MensajesPage() {
  return (
    <div>
      <div className="mb-4">
        <h1 className="text-xl font-bold text-gray-900">Mensajes</h1>
        <p className="text-sm text-gray-500">Bandeja unificada de WhatsApp, Instagram y Facebook.</p>
      </div>
      <MensajesView />
    </div>
  )
}
