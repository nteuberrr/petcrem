'use client'
import { useEffect, useId, useRef } from 'react'

type ModalProps = {
  open: boolean
  onClose: () => void
  title: string
  children: React.ReactNode
  /** Ancho máximo del modal. Default 'lg' (comportamiento previo). */
  size?: 'lg' | 'xl' | '2xl' | '3xl'
}

const SIZE_CLASS: Record<NonNullable<ModalProps['size']>, string> = {
  lg: 'max-w-lg',
  xl: 'max-w-xl',
  '2xl': 'max-w-2xl',
  '3xl': 'max-w-3xl',
}

export function Modal({ open, onClose, title, children, size = 'lg' }: ModalProps) {
  const titleId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  // Elemento que tenía el foco al abrir, para devolvérselo al cerrar.
  const prevFocus = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!open) return
    prevFocus.current = document.activeElement as HTMLElement | null
    // Bloquea el scroll del fondo mientras el modal está abierto.
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    // Mueve el foco al panel al abrir (accesibilidad / lectores de pantalla).
    panelRef.current?.focus()

    const focusables = () =>
      panelRef.current
        ? Array.from(
            panelRef.current.querySelectorAll<HTMLElement>(
              'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
            ),
          )
        : []

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return }
      // Focus trap: mantiene el Tab dentro del diálogo.
      if (e.key === 'Tab') {
        const items = focusables()
        if (items.length === 0) { e.preventDefault(); return }
        const first = items[0]
        const last = items[items.length - 1]
        const active = document.activeElement
        if (e.shiftKey && active === first) { e.preventDefault(); last.focus() }
        else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus() }
      }
    }
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('keydown', handleKey)
      document.body.style.overflow = prevOverflow
      prevFocus.current?.focus?.()
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`relative bg-white rounded-2xl shadow-xl w-full ${SIZE_CLASS[size]} mx-4 max-h-[90vh] overflow-y-auto outline-none`}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h2 id={titleId} className="text-lg font-semibold text-gray-900">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="text-gray-400 hover:text-gray-600 text-xl leading-none"
          >
            ×
          </button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  )
}
