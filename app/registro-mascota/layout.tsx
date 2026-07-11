import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Registro de tu mascota | Alma Animal',
  description: 'Completa los datos de tu mascota para su servicio de cremación.',
  robots: { index: false, follow: false },
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
