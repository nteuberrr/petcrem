// Iconos de marca (SVG) para la sección de Campañas. Tamaño por className.

export function GmailIcon({ className = 'w-6 h-6' }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden="true">
      <path fill="#4caf50" d="M45,16.2l-5,2.75l-5,4.75L35,40h7c1.657,0,3-1.343,3-3V16.2z" />
      <path fill="#1e88e5" d="M3,16.2l3.614,1.71L13,23.7V40H6c-1.657,0-3-1.343-3-3V16.2z" />
      <polygon fill="#e53935" points="35,11.2 24,19.45 13,11.2 12,17 13,23.7 24,31.95 35,23.7 36,17" />
      <path fill="#c62828" d="M3,12.298V16.2l10,7.5V11.2L9.876,8.859C9.132,8.301,8.228,8,7.298,8h0C4.924,8,3,9.924,3,12.298z" />
      <path fill="#fbc02d" d="M45,12.298V16.2l-10,7.5V11.2l3.124-2.341C38.868,8.301,39.772,8,40.702,8h0C43.076,8,45,9.924,45,12.298z" />
    </svg>
  )
}

export function FacebookIcon({ className = 'w-6 h-6' }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden="true">
      <path fill="#1877f2" d="M24 4C12.95 4 4 12.95 4 24c0 9.98 7.31 18.25 16.88 19.76V29.78h-5.08V24h5.08v-4.41c0-5.02 2.99-7.79 7.56-7.79 2.19 0 4.48.39 4.48.39v4.92h-2.52c-2.49 0-3.27 1.55-3.27 3.13V24h5.56l-.89 5.78h-4.67v13.98C36.69 42.25 44 33.98 44 24 44 12.95 35.05 4 24 4z" />
    </svg>
  )
}

export function InstagramIcon({ className = 'w-6 h-6' }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden="true">
      <defs>
        <radialGradient id="ig-grad" cx="0.3" cy="1.05" r="1.1">
          <stop offset="0" stopColor="#fdf497" />
          <stop offset="0.12" stopColor="#fdf497" />
          <stop offset="0.45" stopColor="#fd5949" />
          <stop offset="0.65" stopColor="#d6249f" />
          <stop offset="0.95" stopColor="#285aeb" />
        </radialGradient>
      </defs>
      <rect x="4" y="4" width="40" height="40" rx="12" fill="url(#ig-grad)" />
      <circle cx="24" cy="24" r="9" fill="none" stroke="#fff" strokeWidth="3.2" />
      <circle cx="34" cy="14" r="2.4" fill="#fff" />
    </svg>
  )
}

export function AgenteIcon({ className = 'w-6 h-6' }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="ag-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#143C64" />
          <stop offset="1" stopColor="#2a6db0" />
        </linearGradient>
      </defs>
      <rect x="4" y="4" width="40" height="40" rx="12" fill="url(#ag-grad)" />
      {/* chispa grande */}
      <path fill="#F2B84B" d="M24 12c.8 4.6 2.6 6.4 7.2 7.2-4.6.8-6.4 2.6-7.2 7.2-.8-4.6-2.6-6.4-7.2-7.2 4.6-.8 6.4-2.6 7.2-7.2z" />
      {/* chispa chica */}
      <path fill="#fff" d="M33 27c.4 2.3 1.3 3.2 3.6 3.6-2.3.4-3.2 1.3-3.6 3.6-.4-2.3-1.3-3.2-3.6-3.6 2.3-.4 3.2-1.3 3.6-3.6z" />
    </svg>
  )
}

/** Devuelve el icono de marca para un canal del calendario. */
export function CanalIcon({ canal, className = 'w-5 h-5' }: { canal: string; className?: string }) {
  if (canal === 'email') return <GmailIcon className={className} />
  if (canal === 'instagram') return <InstagramIcon className={className} />
  if (canal === 'facebook') return <FacebookIcon className={className} />
  return null
}
