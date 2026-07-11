import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Convenio de Cremación para Veterinarias | Alma Animal',
  description: 'Convenio de cremación para clínicas veterinarias: tarifas preferentes, retiro coordinado y trazabilidad total. Inscribe tu clínica en la red de Alma Animal.',
  openGraph: {
    title: 'Convenio de Cremación para Veterinarias | Alma Animal',
    description: 'Convenio de cremación para clínicas veterinarias: tarifas preferentes, retiro coordinado y trazabilidad total. Inscribe tu clínica en la red de Alma Animal.',
    type: 'website',
  },
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
