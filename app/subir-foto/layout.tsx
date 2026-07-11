import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Subir foto de tu mascota | Alma Animal',
  description: 'Sube la foto de tu mascota para el certificado de cremación o el cuadro conmemorativo.',
  robots: { index: false, follow: false },
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
