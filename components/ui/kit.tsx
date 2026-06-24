import type { ButtonHTMLAttributes, ReactNode } from 'react'

/**
 * Kit de UI del estándar visual Alma Animal (paleta navy/dorado, tarjetas con
 * borde+sombra, radios consistentes). Usar SIEMPRE estos componentes + los tokens
 * de marca (bg-brand, text-brand, bg-gold, …) en pantallas nuevas y al emprolijar
 * las existentes, para que todo salga en el mismo formato.
 */

/** Encabezado de página: tarjeta con título navy + subtítulo + acciones. */
export function PageHeader({ title, subtitle, icon, actions }: {
  title: ReactNode
  subtitle?: ReactNode
  icon?: ReactNode
  actions?: ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-3 flex-wrap rounded-2xl border border-gray-300 bg-white px-5 py-4 shadow-md">
      <div className="flex items-center gap-3 min-w-0">
        {icon && <div className="shrink-0">{icon}</div>}
        <div className="min-w-0">
          <h1 className="text-2xl font-extrabold text-brand tracking-tight leading-tight">{title}</h1>
          {subtitle && <p className="text-sm text-gray-500 mt-0.5">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
    </div>
  )
}

/** Contenedor tarjeta del estándar (blanco, redondeado, borde, sombra). */
export function Card({ className = '', children }: { className?: string; children: ReactNode }) {
  return <div className={`bg-white rounded-2xl border border-gray-300 shadow-md ${className}`}>{children}</div>
}

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'gold'

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-brand text-white hover:bg-brand-dark shadow-md',
  secondary: 'border border-gray-300 text-gray-700 bg-white hover:bg-gray-50',
  ghost: 'text-brand-soft hover:bg-gray-50',
  danger: 'border border-red-200 text-red-600 bg-white hover:bg-red-50',
  gold: 'bg-gold text-brand hover:brightness-95 shadow-md',
}

/** Botón del estándar. variant: primary | secondary | ghost | danger | gold. */
export function Button({ variant = 'primary', className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-1.5 rounded-xl text-sm font-medium px-3.5 py-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${VARIANTS[variant]} ${className}`}
      {...props}
    />
  )
}

/** Pestañas tipo pill (controladas): activo = navy. */
export function Tabs<T extends string>({ tabs, value, onChange, className = '' }: {
  tabs: { key: T; label: ReactNode }[]
  value: T
  onChange: (k: T) => void
  className?: string
}) {
  return (
    <div className={`inline-flex gap-1 bg-white border border-gray-300 rounded-2xl p-1.5 shadow-md overflow-x-auto max-w-full ${className}`}>
      {tabs.map(t => (
        <button
          key={t.key}
          onClick={() => onChange(t.key)}
          className={`px-4 py-2 rounded-xl text-sm font-semibold whitespace-nowrap transition-all flex items-center gap-1.5 ${
            value === t.key ? 'bg-brand text-white shadow-md' : 'text-gray-600 hover:bg-gray-50'
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}
