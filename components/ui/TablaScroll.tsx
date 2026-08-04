'use client'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'

/**
 * Contenedor de los HISTORIALES: muestra las primeras `filas` (10 por defecto)
 * y el resto se ve scrolleando DENTRO de la tarjeta, en vez de estirar la
 * página hacia abajo sin fin.
 *
 * El alto no se adivina en píxeles: se mide la fila N real (los altos cambian
 * entre tablas y con las filas expandidas) y se fija ese alto. Se recalcula
 * cuando cambia el contenido (ResizeObserver sobre la tabla) o la ventana.
 *
 * La cabecera de la tabla debe llevar `sticky top-0` para quedar fija al
 * scrollear (este contenedor es el que scrollea).
 *
 * EN EL TELÉFONO la tabla se muestra como TARJETAS APILADAS, una por fila: con
 * 8-10 columnas, leer de lado es inmanejable (reporte del dueño 2026-08-03). El
 * cambio lo hace el CSS de `.tabla-historial` (app/globals.css), que saca cada
 * rótulo del atributo `data-label` de la celda — y esos `data-label` los pone
 * ACÁ, copiando el texto de la cabecera por posición. Se hace así, y no a mano
 * en cada tabla, porque cubre todos los historiales de una vez y aguanta las
 * columnas condicionales (lee el `thead` realmente renderizado). Una celda que
 * ya traiga su propio `data-label` se respeta.
 */
export function TablaScroll({
  filas = 10,
  className = '',
  children,
}: {
  /** Cuántas filas se ven sin scrollear. */
  filas?: number
  className?: string
  children: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [maxH, setMaxH] = useState<number | undefined>(undefined)

  /** Marca la tabla y copia los rótulos de la cabecera a cada celda. */
  const etiquetar = useCallback(() => {
    const tabla = ref.current?.querySelector('table')
    if (!tabla) return
    tabla.classList.add('tabla-historial')
    const rotulos = Array.from(tabla.querySelectorAll('thead th')).map(th => (th.textContent || '').trim())
    tabla.querySelectorAll('tbody > tr').forEach(fila => {
      Array.from(fila.children).forEach((celda, i) => {
        const td = celda as HTMLTableCellElement
        if (td.hasAttribute('data-label')) return
        // Las celdas que abarcan varias columnas (filas expandidas) no llevan
        // rótulo: ocupan el ancho completo de la tarjeta.
        td.setAttribute('data-label', td.colSpan > 1 ? '' : (rotulos[i] ?? ''))
      })
    })
  }, [])

  const medir = useCallback(() => {
    etiquetar()
    const cont = ref.current
    if (!cont) return
    // En el teléfono cada fila es una tarjeta alta: recortar a 10 dejaría un
    // scroll interno kilométrico dentro de la página. Ahí scrollea la página.
    if (window.innerWidth <= 768) { setMaxH(undefined); return }
    const cuerpo = cont.querySelectorAll('tbody > tr')
    // Con pocas filas no hay nada que recortar: la tarjeta crece lo que necesite.
    if (cuerpo.length <= filas) { setMaxH(undefined); return }
    const ultimaVisible = cuerpo[filas - 1] as HTMLElement
    const top = cont.getBoundingClientRect().top
    const fin = ultimaVisible.getBoundingClientRect().bottom
    const alto = Math.round(fin - top + cont.scrollTop)
    if (alto > 0) setMaxH(alto)
  }, [filas, etiquetar])

  useEffect(() => {
    medir()
    const cont = ref.current
    if (!cont) return
    const tabla = cont.querySelector('table')
    // El alto del contenedor no altera el de la tabla → sin bucle de medición.
    const ro = tabla ? new ResizeObserver(() => medir()) : null
    if (tabla && ro) ro.observe(tabla)
    window.addEventListener('resize', medir)
    return () => { ro?.disconnect(); window.removeEventListener('resize', medir) }
  }, [medir, children])

  return (
    <div
      ref={ref}
      style={maxH ? { maxHeight: maxH } : undefined}
      className={`overflow-x-auto ${maxH ? 'overflow-y-auto' : ''} ${className}`}
    >
      {children}
    </div>
  )
}

/** Clases de la cabecera fija de un historial dentro de `TablaScroll`. */
export const THEAD_STICKY = 'bg-gray-50 sticky top-0 z-10 shadow-[inset_0_-1px_0_#d1d5db]'

/** Pie del historial: cuántos registros hay y el aviso de que se scrollea. */
export function HistorialPie({ total, filas = 10, singular, plural }: {
  total: number
  filas?: number
  singular: string
  plural: string
}) {
  if (total === 0) return null
  const nombre = total === 1 ? singular : plural
  return (
    <div className="px-4 py-2.5 bg-gray-50 border-t border-gray-300 text-xs text-gray-600 flex items-center justify-between gap-2">
      <span>{total} {nombre}</span>
      {total > filas && <span className="text-gray-500">Se muestran {filas}; desliza dentro de la tabla para ver el resto ↕</span>}
    </div>
  )
}
