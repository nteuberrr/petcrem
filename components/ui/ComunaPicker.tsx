'use client'
import { useEffect, useRef, useState } from 'react'

interface Sugerencia {
  nombre: string
  region: string
  source: 'local' | 'google' | 'google_extra'
}

interface Props {
  value: string[]
  onChange: (v: string[]) => void
  /** Color principal de los chips. Default indigo. Para el landing público usamos #143C64. */
  color?: string
  placeholder?: string
}

const DEBOUNCE_MS = 250
const MIN_CHARS = 2

/**
 * Selector de comunas con autocomplete. Muestra cada comuna seleccionada
 * como chip removible, y un botón "+ Agregar" que abre un input flotante
 * que consulta /api/eutanasias/comunas/buscar (que a su vez consulta
 * Google Places si está configurado, o la lista local).
 *
 * Al seleccionar una sugerencia, se agrega al value y queda lista para
 * agregar otra. Es la misma UI en /servicios y en /convenio-eutanasias.
 */
export default function ComunaPicker({ value, onChange, color, placeholder }: Props) {
  const colorChip = color ?? '#4f46e5' // indigo-600
  const [adding, setAdding] = useState(false)
  const [q, setQ] = useState('')
  const [sugs, setSugs] = useState<Sugerencia[]>([])
  const [loading, setLoading] = useState(false)
  const debRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (debRef.current) clearTimeout(debRef.current)
    if (q.trim().length < MIN_CHARS) {
      setSugs([])
      return
    }
    debRef.current = setTimeout(async () => {
      setLoading(true)
      try {
        const r = await fetch(`/api/eutanasias/comunas/buscar?q=${encodeURIComponent(q.trim())}`)
        const d = await r.json()
        if (Array.isArray(d)) {
          // Excluir las que ya están seleccionadas
          setSugs(d.filter((s: Sugerencia) => !value.includes(s.nombre)))
        } else {
          setSugs([])
        }
      } catch {
        setSugs([])
      } finally {
        setLoading(false)
      }
    }, DEBOUNCE_MS)
    return () => { if (debRef.current) clearTimeout(debRef.current) }
  }, [q, value])

  useEffect(() => {
    if (adding) inputRef.current?.focus()
  }, [adding])

  useEffect(() => {
    function onClickOut(e: MouseEvent) {
      if (!containerRef.current) return
      if (!containerRef.current.contains(e.target as Node)) {
        cerrar()
      }
    }
    if (adding) document.addEventListener('mousedown', onClickOut)
    return () => document.removeEventListener('mousedown', onClickOut)
  }, [adding])

  function cerrar() {
    setAdding(false)
    setQ('')
    setSugs([])
  }

  function agregar(nombre: string) {
    if (!nombre) return
    if (value.includes(nombre)) {
      cerrar()
      return
    }
    onChange([...value, nombre])
    setQ('')
    setSugs([])
    inputRef.current?.focus()
  }

  function remover(nombre: string) {
    onChange(value.filter(c => c !== nombre))
  }

  return (
    <div ref={containerRef} className="space-y-2">
      <div className="flex flex-wrap gap-2 items-center">
        {value.map(c => (
          <span
            key={c}
            className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full text-white"
            style={{ backgroundColor: colorChip }}
          >
            {c}
            <button
              type="button"
              onClick={() => remover(c)}
              className="hover:bg-black/20 rounded-full w-4 h-4 flex items-center justify-center text-sm leading-none"
              aria-label={`Quitar ${c}`}
            >
              ×
            </button>
          </span>
        ))}

        {!adding && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full border-2 border-dashed border-gray-400 text-gray-600 hover:border-gray-600 hover:text-gray-800 transition-colors"
          >
            + Agregar comuna
          </button>
        )}

        {adding && (
          <div className="relative inline-block">
            <input
              ref={inputRef}
              type="text"
              value={q}
              onChange={e => setQ(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Escape') cerrar()
                else if (e.key === 'Enter' && sugs.length > 0) {
                  e.preventDefault()
                  agregar(sugs[0].nombre)
                }
              }}
              placeholder={placeholder ?? 'Escribe una comuna…'}
              className="px-2 py-1 border border-gray-300 rounded-lg text-xs focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none min-w-[160px]"
            />
            {(loading || sugs.length > 0 || q.trim().length >= MIN_CHARS) && (
              <ul className="absolute left-0 top-full mt-1 z-50 bg-white border border-gray-200 rounded-lg shadow-lg w-64 max-h-64 overflow-y-auto">
                {loading && (
                  <li className="px-3 py-2 text-xs text-gray-500">Buscando…</li>
                )}
                {!loading && sugs.length === 0 && q.trim().length >= MIN_CHARS && (
                  <li className="px-3 py-2 text-xs text-gray-500">Sin coincidencias</li>
                )}
                {!loading && sugs.map(s => (
                  <li key={s.nombre + s.region}>
                    <button
                      type="button"
                      onMouseDown={e => e.preventDefault()}
                      onClick={() => agregar(s.nombre)}
                      className="w-full text-left px-3 py-2 hover:bg-gray-50 flex items-center justify-between gap-2"
                    >
                      <span className="text-sm text-gray-900">{s.nombre}</span>
                      {s.region && <span className="text-[10px] text-gray-500 truncate">{s.region}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
      {value.length === 0 && !adding && (
        <p className="text-xs text-gray-500">Aún no agregaste ninguna comuna.</p>
      )}
    </div>
  )
}
