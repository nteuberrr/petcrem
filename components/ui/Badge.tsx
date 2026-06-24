type BadgeProps = {
  children: React.ReactNode
  variant?: 'green' | 'yellow' | 'gray' | 'blue' | 'red' | 'purple' | 'gold'
}

const colors = {
  green: 'bg-green-100 text-green-800',
  yellow: 'bg-yellow-100 text-yellow-800',
  gray: 'bg-gray-100 text-gray-600',
  blue: 'bg-brand/10 text-brand',
  red: 'bg-red-100 text-red-800',
  purple: 'bg-purple-100 text-purple-800',
  gold: 'bg-gold/20 text-amber-800',
}

export function Badge({ children, variant = 'gray' }: BadgeProps) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${colors[variant]}`}>
      {children}
    </span>
  )
}
