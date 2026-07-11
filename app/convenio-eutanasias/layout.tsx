import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Red de Veterinarios · Eutanasia a Domicilio | Alma Animal',
  description: 'Súmate a la red de veterinarios de Alma Animal para eutanasias a domicilio: recibe solicitudes en tu comuna y horario disponible, con pago garantizado por visita.',
  openGraph: {
    title: 'Red de Veterinarios · Eutanasia a Domicilio | Alma Animal',
    description: 'Súmate a la red de veterinarios de Alma Animal para eutanasias a domicilio: recibe solicitudes en tu comuna y horario disponible, con pago garantizado por visita.',
    type: 'website',
  },
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
