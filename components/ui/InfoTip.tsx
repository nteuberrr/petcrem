'use client'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'

/**
 * Ayuda contextual en un (i): la explicación no ocupa lugar hasta que se la
 * pide. Se abre al pasar el mouse y también al pinchar, porque en el teléfono no
 * hay hover; se cierra con Escape o tocando fuera.
 */
export function InfoTip({
  children,
  titulo,
  posicion = 'derecha',
}: {
  children: ReactNode
  /** Título opcional dentro del globo. */
  titulo?: string
  /** Hacia dónde se despliega el globo cuando hay poco espacio a la derecha. */
  posicion?: 'derecha' | 'izquierda'
}) {
  const [abierto, setAbierto] = useState(false)
  const [fijado, setFijado] = useState(false)
  const cont = useRef<HTMLSpanElement>(null)
  const id = useId()

  useEffect(() => {
    if (!fijado) return
    const fuera = (e: MouseEvent) => {
      if (cont.current && !cont.current.contains(e.target as Node)) { setFijado(false); setAbierto(false) }
    }
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setFijado(false); setAbierto(false) }
    }
    document.addEventListener('mousedown', fuera)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('mousedown', fuera)
      document.removeEventListener('keydown', escape)
    }
  }, [fijado])

  const visible = abierto || fijado

  return (
    <span ref={cont} className="relative inline-flex align-middle">
      <button
        type="button"
        aria-label="Más información"
        aria-expanded={visible}
        aria-describedby={visible ? id : undefined}
        onMouseEnter={() => setAbierto(true)}
        onMouseLeave={() => !fijado && setAbierto(false)}
        onFocus={() => setAbierto(true)}
        onBlur={() => !fijado && setAbierto(false)}
        onClick={() => { setFijado(f => !f); setAbierto(true) }}
        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[11px] font-bold transition
          ${visible
            ? 'border-brand bg-brand text-white'
            : 'border-gray-400 text-gray-500 hover:border-brand hover:text-brand'}`}
      >
        i
      </button>

      {visible && (
        <span
          id={id}
          role="tooltip"
          className={`absolute top-7 z-50 w-[min(22rem,calc(100vw-2.5rem))] rounded-xl border border-gray-300 bg-white p-3 text-left text-xs leading-relaxed font-normal normal-case tracking-normal text-gray-700 shadow-lg
            ${posicion === 'derecha' ? 'left-0' : 'right-0'}`}
        >
          {titulo && <span className="mb-1 block font-bold text-brand">{titulo}</span>}
          {children}
        </span>
      )}
    </span>
  )
}
