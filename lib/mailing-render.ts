/**
 * Render de HTML con variables {{var}} reemplazadas según los datos del veterinario.
 * Variables disponibles: nombre, primer_nombre, email, veterinaria, comuna, telefono, categoria.
 * Los valores se escapan como HTML: un nombre con < > & no rompe el markup de la campaña.
 */
import { escapeHtml } from './email-layout'

export interface VetData {
  nombre?: string
  email?: string
  veterinaria?: string
  comuna?: string
  telefono?: string
  categoria?: string
}

export function deriveVars(vet: VetData): Record<string, string> {
  const nombre = (vet.nombre || '').trim()
  const primerNombre = nombre.split(/\s+/)[0] || ''
  return {
    nombre,
    primer_nombre: primerNombre,
    email: vet.email || '',
    veterinaria: vet.veterinaria || '',
    comuna: vet.comuna || '',
    telefono: vet.telefono || '',
    categoria: vet.categoria || '',
  }
}

export function renderTemplate(html: string, vars: Record<string, string>): string {
  let out = html
  // Formato canónico: {{nombre}} con doble llave (estilo Mustache/Handlebars).
  out = out.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key) => escapeHtml(vars[key] ?? ''))
  // Fallback: {nombre} con llave simple. Para no romper CSS o JSON dentro del HTML,
  // solo reemplazamos cuando la key matcheea una variable conocida y las llaves NO
  // forman parte de un par doble (negative lookaround).
  const claves = new Set(Object.keys(vars))
  out = out.replace(/(?<!\{)\{\s*(\w+)\s*\}(?!\})/g, (match, key) => {
    if (claves.has(key)) return escapeHtml(vars[key] ?? '')
    return match
  })
  return out
}

export function renderForVet(html: string, vet: VetData): string {
  return renderTemplate(html, deriveVars(vet))
}

/** Lista de variables soportadas — útil para mostrar en UI. */
export const VARIABLES_DISPONIBLES = [
  { key: 'nombre', desc: 'Nombre completo' },
  { key: 'primer_nombre', desc: 'Primer nombre (ej. María José → María)' },
  { key: 'email', desc: 'Email del destinatario' },
  { key: 'veterinaria', desc: 'Clínica veterinaria' },
  { key: 'comuna', desc: 'Comuna' },
  { key: 'telefono', desc: 'Teléfono' },
  { key: 'categoria', desc: 'Categoría (prospecto / cliente / inactivo)' },
] as const

/** Detecta variables usadas en un HTML, devuelve las que NO están en VARIABLES_DISPONIBLES. */
export function detectarVariablesDesconocidas(html: string): string[] {
  const conocidas = new Set(VARIABLES_DISPONIBLES.map(v => v.key))
  const matches = html.matchAll(/\{\{\s*(\w+)\s*\}\}/g)
  const desconocidas = new Set<string>()
  for (const m of matches) {
    if (!conocidas.has(m[1] as typeof VARIABLES_DISPONIBLES[number]['key'])) {
      desconocidas.add(m[1])
    }
  }
  return Array.from(desconocidas)
}
