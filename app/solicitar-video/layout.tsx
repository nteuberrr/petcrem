import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Solicitar el video del proceso | Alma Animal',
  description: 'Solicita el video del proceso de cremación de tu mascota.',
  robots: { index: false, follow: false },
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
