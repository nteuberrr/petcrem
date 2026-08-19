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

export function WhatsappIcon({ className = 'w-6 h-6' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path fill="#25D366" d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.46 1.32 4.96L2 22l5.25-1.38a9.87 9.87 0 0 0 4.79 1.22h.01c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2z" />
      <path fill="#fff" d="M9.6 7.34c-.18-.42-.38-.42-.55-.43h-.47c-.16 0-.43.06-.65.31-.23.25-.86.84-.86 2.05s.88 2.38 1 2.54c.13.17 1.7 2.73 4.2 3.72 2.08.82 2.5.66 2.95.62.45-.04 1.45-.59 1.66-1.17.2-.57.2-1.06.14-1.17-.06-.1-.23-.16-.48-.29-.25-.12-1.45-.72-1.68-.8-.22-.08-.39-.12-.55.13-.16.24-.62.79-.76.95-.14.17-.28.19-.53.06-.25-.12-1.03-.38-1.97-1.22a7.4 7.4 0 0 1-1.36-1.7c-.14-.24-.01-.37.11-.5.11-.11.25-.29.37-.43.13-.15.17-.25.25-.42.09-.16.04-.31-.02-.43-.06-.13-.54-1.34-.76-1.83z" />
    </svg>
  )
}

/** Devuelve el icono de marca para un canal del calendario. */
export function CanalIcon({ canal, className = 'w-5 h-5' }: { canal: string; className?: string }) {
  if (canal === 'email') return <GmailIcon className={className} />
  if (canal === 'instagram') return <InstagramIcon className={className} />
  if (canal === 'facebook') return <FacebookIcon className={className} />
  if (canal === 'whatsapp') return <WhatsappIcon className={className} />
  return null
}
