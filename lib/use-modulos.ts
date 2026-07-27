'use client'
import { useEffect, useState } from 'react'

/**
 * ¿El usuario actual puede entrar a este módulo? (permisos dinámicos, ver
 * lib/permisos + /api/mis-modulos). Devuelve `null` mientras carga, para poder
 * evitar enlaces que terminarían en un redirect del proxy.
 *
 * Se usa en las piezas del dashboard que enlazan a secciones no siempre
 * permitidas — p. ej. las eutanasias enlazan a `/servicios`, que el operador
 * normalmente no tiene.
 */
export function usePuedeModulo(modulo: string): boolean | null {
  const [puede, setPuede] = useState<boolean | null>(null)
  useEffect(() => {
    let cancel = false
    fetch('/api/mis-modulos')
      .then(r => (r.ok ? r.json() : { modulos: [] }))
      .then(d => { if (!cancel) setPuede(Array.isArray(d.modulos) && d.modulos.includes(modulo)) })
      .catch(() => { if (!cancel) setPuede(false) })
    return () => { cancel = true }
  }, [modulo])
  return puede
}
