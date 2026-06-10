// ─────────────────────────────────────────────────────────────────────────────
// Normaliza nombres a "Tipo Título" (primera letra de cada palabra en mayúscula)
// para mantener la formalidad de la base — los nombres se usan tal cual en los
// correos al cliente, certificados, etc. Se aplica al GUARDAR (tutor, mascota,
// veterinario, etc.), no al escribir.
//
//   "juan PÉREZ"      → "Juan Pérez"
//   "MARÍA josé"      → "María José"
//   "ana-maría de la cruz" → "Ana-María de la Cruz"
// ─────────────────────────────────────────────────────────────────────────────

// Conectores que van en minúscula salvo cuando son la primera palabra.
const CONECTORES = new Set(['de', 'del', 'la', 'las', 'los', 'y', 'e', 'da', 'das', 'do', 'dos', 'van', 'von', 'di', 'el'])

/** Capitaliza la primera letra de cada palabra (incluye después de - y '). */
export function capitalizarNombre(raw: string | null | undefined): string {
  if (!raw) return ''
  return String(raw)
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .split(' ')
    .map((palabra, i) => {
      if (!palabra) return palabra
      if (i > 0 && CONECTORES.has(palabra)) return palabra
      // Capitaliza la inicial y la letra tras separadores internos: - ' ( / .
      return palabra.replace(/(^|[-'’(/.])([a-záéíóúñü])/g, (_m, sep: string, ch: string) => sep + ch.toUpperCase())
    })
    .join(' ')
}
