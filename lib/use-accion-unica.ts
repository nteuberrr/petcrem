'use client'
import { useRef, useState, useCallback } from 'react'

/**
 * REGLA GENERAL DEL SITIO — guard anti doble-click / doble-submit.
 *
 * Envuelve una acción async (crear/editar/duplicar/emitir/enviar): mientras una
 * ejecución está EN VUELO, ignora las siguientes. Evita que un doble-click rápido
 * dispare la misma mutación dos veces (pasó con los precios especiales, que se
 * duplicaron). Usa un `ref` (bloqueo inmediato, antes del re-render — más confiable
 * que depender solo de un estado `disabled`) + un `procesando` para deshabilitar el
 * botón visualmente.
 *
 * Uso:
 *   const { ejecutar, procesando } = useAccionUnica()
 *   <button disabled={procesando} onClick={() => ejecutar(async () => { await guardar() })}>Guardar</button>
 */
export function useAccionUnica() {
  const inFlight = useRef(false)
  const [procesando, setProcesando] = useState(false)

  const ejecutar = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    if (inFlight.current) return
    inFlight.current = true
    setProcesando(true)
    try {
      return await fn()
    } finally {
      inFlight.current = false
      setProcesando(false)
    }
  }, [])

  return { ejecutar, procesando }
}
