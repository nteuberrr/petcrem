/**
 * Placeholders de carga (shimmer) del estándar Alma Animal. Reemplazan el texto
 * plano "Cargando…" que dejaba la tabla vacía y producía salto de layout (CLS)
 * al llegar los datos. Llevan role="status" + aria-busy para lectores de pantalla.
 */

/** Barra/bloque genérico con pulso. */
export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-gray-200 ${className}`} />
}

/** Filas de tabla simuladas (para el cuerpo de listas mientras cargan). */
export function TableSkeleton({ rows = 6, className = '' }: { rows?: number; className?: string }) {
  return (
    <div className={`p-4 space-y-2 ${className}`} role="status" aria-busy="true">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-9 rounded-lg bg-gray-200 animate-pulse" />
      ))}
      <span className="sr-only">Cargando…</span>
    </div>
  )
}
