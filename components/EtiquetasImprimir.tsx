'use client'
import { useCallback, useEffect, useState } from 'react'
import { Printer, RefreshCw } from 'lucide-react'
import { Card, Button } from '@/components/ui/kit'
import { FORMATOS, etiquetasHtml, type FormatoEtiqueta } from '@/lib/etiquetas-varias'
import { ajustarPapel, estadoPapel, imprimirHtml, type EstadoPapel } from '@/lib/imprimir-html'
import { useAccionUnica } from '@/lib/use-accion-unica'

/**
 * Configuración → Etiquetas: imprime etiquetas "en blanco" por cantidad (no
 * dependen de una ficha). La vista previa es EL MISMO documento que se manda a
 * la impresora, solo escalado, así que lo que se ve es lo que sale.
 *
 * La etiqueta de una ficha puntual (80 × 50, con los datos del servicio) NO vive
 * acá: se imprime desde la ficha del cliente.
 */

const CANTIDADES = [1, 5, 10, 20, 50]

/** Los tres tamaños de rollo, para el selector de papel. */
const TAMANOS: { ancho: number; alto: number; para: string }[] = [
  { ancho: 80, alto: 50, para: 'Despacho' },
  { ancho: 100, alto: 150, para: 'Ficha de retiro' },
  { ancho: 60, alto: 60, para: 'Sticker' },
]

export default function EtiquetasImprimir() {
  const [papel, setPapel] = useState<EstadoPapel | null>(null)
  const [cargado, setCargado] = useState(false)

  const refrescar = useCallback(async () => {
    setPapel(await estadoPapel())
    setCargado(true)
  }, [])

  useEffect(() => { refrescar() }, [refrescar])

  return (
    <div className="space-y-6">
      <p className="text-sm text-gray-600">
        Etiquetas que se imprimen en blanco, para dejar listas. La etiqueta de despacho
        con los datos de una mascota se imprime desde su ficha.
      </p>

      <SelectorPapel papel={papel} cargado={cargado} refrescar={refrescar} />

      {(Object.keys(FORMATOS) as FormatoEtiqueta[]).map(k => (
        <FormatoCard key={k} formato={k} alImprimir={refrescar} />
      ))}
    </div>
  )
}

/**
 * Cambiar el rollo obliga a cambiar también el tamaño de papel en Windows (si no,
 * la etiqueta sale girada o achicada). Antes eso era un comando de PowerShell;
 * acá se hace con un clic, hablando con el ayudante local que corre en el equipo.
 */
function SelectorPapel({ papel, cargado, refrescar }: {
  papel: EstadoPapel | null
  cargado: boolean
  refrescar: () => Promise<void>
}) {
  const [error, setError] = useState('')
  const { ejecutar, procesando } = useAccionUnica()

  const poner = (ancho: number, alto: number) => ejecutar(async () => {
    setError('')
    const r = await ajustarPapel(ancho, alto)
    if (r.estado === 'error') setError(r.mensaje)
    if (r.estado === 'sin-ayudante') setError('El ayudante de impresión no está corriendo en este equipo.')
    await refrescar()
  })

  if (!cargado) return null

  // Sin ayudante no tiene sentido mostrar botones que no van a hacer nada.
  if (!papel) {
    return (
      <Card className="p-4">
        <p className="text-sm text-gray-600">
          <b>El papel se cambia desde este equipo.</b> Para poder hacerlo con un clic desde acá,
          hay que instalar una vez el ayudante de impresión:
          <code className="block mt-1.5 px-2 py-1 bg-gray-100 rounded text-[11px] break-all">
            powershell -ExecutionPolicy Bypass -File scripts\ayudante-impresion.ps1 -Instalar
          </code>
          <span className="block mt-1.5 text-gray-500">
            Sin él las etiquetas se imprimen igual, pero hay que dejar el tamaño de papel a mano.
          </span>
        </p>
      </Card>
    )
  }

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Papel en la impresora</p>
          <p className="text-sm text-gray-800 mt-0.5">
            <b className="text-brand">{papel.ancho} × {papel.alto} mm</b>
            <span className="text-gray-500"> · {papel.impresora}</span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 ml-auto">
          {TAMANOS.map(t => {
            const puesto = Math.abs(papel.ancho - t.ancho) <= 2 && Math.abs(papel.alto - t.alto) <= 2
            return (
              <button key={`${t.ancho}x${t.alto}`} type="button"
                onClick={() => poner(t.ancho, t.alto)}
                disabled={procesando || puesto}
                title={puesto ? 'Es el que está puesto' : `Dejar la impresora en ${t.ancho} × ${t.alto} mm`}
                className={`px-3 py-1.5 rounded-lg text-sm font-semibold border transition-colors disabled:cursor-default ${
                  puesto
                    ? 'bg-brand text-white border-brand'
                    : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-50'
                }`}>
                {t.ancho} × {t.alto}
                <span className="block text-[10px] font-medium opacity-70">{t.para}</span>
              </button>
            )
          })}
          <button type="button" onClick={() => ejecutar(refrescar)} disabled={procesando}
            title="Volver a consultar la impresora" aria-label="Actualizar"
            className="p-2 rounded-lg border border-gray-300 text-gray-500 hover:bg-gray-50 disabled:opacity-50">
            <RefreshCw className={`w-4 h-4 ${procesando ? 'animate-spin' : ''}`} aria-hidden="true" />
          </button>
        </div>
      </div>
      {error && (
        <p className="mt-3 text-[12px] text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
      )}
      <p className="mt-3 text-[11px] text-gray-500">
        Al imprimir se pone solo el tamaño que corresponde. Estos botones son para dejarlo
        listo antes, o para volver a 80 × 50 después de una tanda.
      </p>
    </Card>
  )
}

function FormatoCard({ formato, alImprimir }: { formato: FormatoEtiqueta; alImprimir: () => Promise<void> }) {
  const f = FORMATOS[formato]
  const [cantidad, setCantidad] = useState(10)
  const [aviso, setAviso] = useState('')
  const { ejecutar, procesando } = useAccionUnica()

  // 96 dpi: 1 mm = 96/25,4 px. La previa se achica para caber en la tarjeta.
  const px = (n: number) => n * (96 / 25.4)
  const zoom = formato === 'ficha-retiro' ? 0.72 : 1.1

  const imprimir = () => ejecutar(async () => {
    setAviso('')
    const r = await imprimirHtml(etiquetasHtml(formato, cantidad), { ancho: f.ancho, alto: f.alto })
    // Sin ayudante no avisamos nada: se imprime igual, solo hay que tener el
    // papel puesto a mano. Si el ayudante está pero no pudo, eso SÍ importa —
    // significa que va a salir en el tamaño equivocado.
    if (r.estado === 'error') setAviso(r.mensaje)
    await alImprimir()   // el papel pudo haber cambiado: refrescar el selector
  })

  return (
    <Card className="p-5">
      <div className="flex flex-col lg:flex-row gap-6">
        {/* Vista previa: el mismo HTML que se imprime, en su tamaño real escalado.
            Va SIN la corrección de posición de la impresora (`ajustar: false`):
            eso compensa que la máquina estampa corrido, y en pantalla solo haría
            ver la etiqueta descuadrada. */}
        <div className="shrink-0">
          <div className="border-2 border-gray-400 rounded-lg shadow-md bg-white overflow-hidden mx-auto"
            style={{ width: px(f.ancho) * zoom, height: px(f.alto) * zoom }}>
            <iframe
              title={`Vista previa — ${f.nombre}`}
              srcDoc={etiquetasHtml(formato, 1, { ajustar: false })}
              className="border-0 block"
              style={{ width: px(f.ancho), height: px(f.alto), transform: `scale(${zoom})`, transformOrigin: 'top left' }}
            />
          </div>
          <p className="text-[11px] text-gray-500 text-center mt-1.5">{f.ancho} × {f.alto} mm</p>
        </div>

        <div className="flex-1 min-w-0 flex flex-col">
          <h3 className="text-lg font-bold text-brand">{f.nombre}</h3>
          <p className="text-sm text-gray-600 mt-1">{f.descripcion}</p>

          <div className="mt-5">
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
              Cantidad a imprimir
            </label>
            <div className="flex flex-wrap items-center gap-2">
              {CANTIDADES.map(n => (
                <button key={n} type="button" onClick={() => setCantidad(n)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-semibold border transition-colors ${
                    cantidad === n ? 'bg-brand text-white border-brand' : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50'
                  }`}>
                  {n}
                </button>
              ))}
              <input
                type="number" min={1} max={200} value={cantidad}
                onChange={e => setCantidad(Math.max(1, Math.min(200, parseInt(e.target.value, 10) || 1)))}
                className="w-20 px-3 py-1.5 rounded-lg border text-sm"
                aria-label="Cantidad a imprimir"
              />
            </div>
          </div>

          <div className="mt-5 flex items-center gap-3 flex-wrap">
            <Button onClick={imprimir} disabled={procesando}>
              <Printer className="w-4 h-4 shrink-0" aria-hidden="true" />
              {procesando ? 'Enviando…' : `Imprimir ${cantidad} ${cantidad === 1 ? 'etiqueta' : 'etiquetas'}`}
            </Button>
          </div>

          {aviso && (
            <p className="mt-3 text-[12px] text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {aviso}. Va a salir en el tamaño que tenga puesto la impresora.
            </p>
          )}
        </div>
      </div>
    </Card>
  )
}
