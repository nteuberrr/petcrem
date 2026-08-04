'use client'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'

/** Ancho hasta el que la tabla se muestra como tarjetas (igual que el CSS). */
const MOVIL = 768

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
 * EN EL TELÉFONO la tabla se vuelve una lista de RESUMEN + TOCAR PARA VER TODO:
 * cada fila queda en una línea compacta con las columnas que la identifican, y
 * al tocarla se despliega el resto con su rótulo. Con 9 o 10 columnas ni la
 * tabla de lado ni la tarjeta con todo apilado se podían usar (dueño,
 * 2026-08-03/04). El aspecto lo pone el CSS de `.tabla-historial`
 * (app/globals.css); acá se marcan las celdas para que ese CSS sepa qué es
 * cada cosa. Se hace así, y no a mano en cada tabla, porque cubre todos los
 * historiales de una vez y aguanta las columnas condicionales (lee el `thead`
 * realmente renderizado). Una celda que ya traiga su `data-label` se respeta.
 */
export function TablaScroll({
  filas = 10,
  resumen = [0, 1],
  className = '',
  children,
}: {
  /** Cuántas filas se ven sin scrollear. */
  filas?: number
  /**
   * Índices de las columnas que se ven SIN desplegar en el teléfono (la línea
   * compacta). Por defecto las dos primeras, que en todos los historiales son
   * las que identifican la fila.
   */
  resumen?: number[]
  className?: string
  children: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [maxH, setMaxH] = useState<number | undefined>(undefined)
  // El array llega nuevo en cada render; la clave estable evita recrear los
  // callbacks (y con ellos el ResizeObserver) sin necesidad.
  const claveResumen = resumen.join(',')

  /** Marca filas y celdas para que el CSS de móvil sepa qué mostrar. */
  const etiquetar = useCallback(() => {
    const tabla = ref.current?.querySelector('table')
    if (!tabla) return
    tabla.classList.add('tabla-historial')
    const enResumen = new Set(claveResumen.split(',').map(Number))
    const rotulos = Array.from(tabla.querySelectorAll('thead th')).map(th => (th.textContent || '').trim())
    tabla.querySelectorAll('tbody > tr').forEach(fila => {
      const celdas = Array.from(fila.children) as HTMLTableCellElement[]
      // Una fila con una sola celda que abarca toda la tabla no es un registro:
      // es el panel que despliega la propia página para la fila de arriba.
      const ampliacion = celdas.length === 1 && celdas[0].colSpan > 1
      fila.setAttribute('data-fila', ampliacion ? 'ampliacion' : 'resumen')
      celdas.forEach((td, i) => {
        if (!td.hasAttribute('data-label')) {
          td.setAttribute('data-label', td.colSpan > 1 ? '' : (rotulos[i] ?? ''))
        }
        if (!ampliacion) td.setAttribute('data-ver', enResumen.has(i) ? 'siempre' : 'detalle')
      })
    })
  }, [claveResumen])

  const medir = useCallback(() => {
    etiquetar()
    const cont = ref.current
    if (!cont) return
    // En el teléfono la lista ya es compacta (una línea por fila) y scrollea la
    // página: recortarla dejaría un scroll dentro de otro scroll.
    if (window.innerWidth <= MOVIL) { setMaxH(undefined); return }
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

  /**
   * Tocar la fila la despliega. Va delegado en el contenedor (y no como un
   * botón inyectado en el DOM) para no meter nodos propios dentro de lo que
   * maneja React. Se ignoran los toques sobre controles: los botones de
   * acción de cada fila tienen que seguir funcionando.
   */
  const alTocar = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (window.innerWidth > MOVIL) return
    const destino = e.target as HTMLElement
    if (destino.closest('button, a, input, select, textarea, label')) return
    const fila = destino.closest('tr')
    if (!fila || fila.getAttribute('data-fila') !== 'resumen') return
    fila.setAttribute('data-abierta', fila.getAttribute('data-abierta') === '1' ? '0' : '1')
  }, [])

  return (
    <div
      ref={ref}
      onClick={alTocar}
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
      {total > filas && <span className="hidden md:inline text-gray-500">Se muestran {filas}; desliza dentro de la tabla para ver el resto ↕</span>}
    </div>
  )
}
