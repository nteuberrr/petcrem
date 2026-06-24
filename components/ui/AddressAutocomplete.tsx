'use client'
import { useEffect, useRef, useState } from 'react'

interface Suggestion {
  text: string
  placeId: string
}

interface Props {
  value: string
  onChange: (v: string) => void
  /** Cuando el usuario selecciona una sugerencia (vs solo tipear). */
  onSelect?: (v: string) => void
  /**
   * Variante que recibe también el placeId de Google. Útil cuando el caller
   * quiere consultar /api/eutanasias/place-details para extraer comuna/región.
   */
  onSelectPlace?: (place: { text: string; placeId: string }) => void
  placeholder?: string
  className?: string
  required?: boolean
  disabled?: boolean
  name?: string
  id?: string
  autoComplete?: string
}

const DEBOUNCE_MS = 300
const MIN_CHARS = 3
const MAX_SUGGESTIONS = 5

export default function AddressAutocomplete({
  value, onChange, onSelect, onSelectPlace,
  placeholder = 'Buscar dirección…',
  className = '',
  required,
  disabled,
  name,
  id,
  autoComplete = 'off',
}: Props) {
  const [sugs, setSugs] = useState<Suggestion[]>([])
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState(-1)
  const [loading, setLoading] = useState(false)
  const lastQueriedRef = useRef<string>('')
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const justSelectedRef = useRef(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // No buscar si acabamos de seleccionar (evita reabrir el dropdown)
    if (justSelectedRef.current) {
      justSelectedRef.current = false
      return
    }
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (!value || value.trim().length < MIN_CHARS) {
      setSugs([])
      setOpen(false)
      return
    }
    debounceRef.current = setTimeout(async () => {
      const q = value.trim()
      if (q === lastQueriedRef.current) return
      lastQueriedRef.current = q
      setLoading(true)
      try {
        const res = await fetch('/api/places/autocomplete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ input: q }),
        })
        const j = await res.json()
        const items: Suggestion[] = Array.isArray(j.suggestions) ? j.suggestions.slice(0, MAX_SUGGESTIONS) : []
        setSugs(items)
        setOpen(items.length > 0)
        setHighlight(-1)
      } catch {
        setSugs([])
        setOpen(false)
      } finally {
        setLoading(false)
      }
    }, DEBOUNCE_MS)

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [value])

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [])

  function pick(s: Suggestion) {
    justSelectedRef.current = true
    onChange(s.text)
    onSelect?.(s.text)
    onSelectPlace?.({ text: s.text, placeId: s.placeId })
    setSugs([])
    setOpen(false)
    setHighlight(-1)
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || sugs.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlight(h => (h + 1) % sugs.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlight(h => (h - 1 + sugs.length) % sugs.length)
    } else if (e.key === 'Enter') {
      if (highlight >= 0 && highlight < sugs.length) {
        e.preventDefault()
        pick(sugs[highlight])
      }
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        onFocus={() => { if (sugs.length > 0) setOpen(true) }}
        placeholder={placeholder}
        className={className}
        required={required}
        disabled={disabled}
        name={name}
        id={id}
        autoComplete={autoComplete}
      />
      {loading && (
        <div className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-400 pointer-events-none">
          <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.25" />
            <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
          </svg>
        </div>
      )}
      {open && sugs.length > 0 && (
        <ul className="absolute z-20 mt-1 w-full bg-white border border-gray-300 rounded-lg shadow-lg max-h-64 overflow-y-auto">
          {sugs.map((s, i) => (
            <li
              key={s.placeId || i}
              onMouseDown={e => { e.preventDefault(); pick(s) }}
              onMouseEnter={() => setHighlight(i)}
              className={`px-3 py-2 text-sm cursor-pointer ${i === highlight ? 'bg-brand/10 text-brand' : 'text-gray-800 hover:bg-gray-50'}`}
            >
              <div className="flex items-start gap-2">
                <svg className="w-4 h-4 mt-0.5 text-gray-400 shrink-0" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clipRule="evenodd" />
                </svg>
                <span className="leading-tight">{s.text}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
