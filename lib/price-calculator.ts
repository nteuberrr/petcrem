import { getSheetData } from './google-sheets'
import { PrecioTramo } from '@/types'

export async function calcularPrecio(
  peso: number,
  codigoServicio: string,
  tipoPrecios: 'general' | 'convenio',
  preciosEspeciales?: PrecioTramo[]
): Promise<number> {
  let tramos: PrecioTramo[]

  if (preciosEspeciales && preciosEspeciales.length > 0) {
    tramos = preciosEspeciales
  } else {
    const hoja = tipoPrecios === 'general' ? 'precios_generales' : 'precios_convenio'
    const rows = await getSheetData(hoja)
    tramos = rows.map((r) => ({
      id: r.id,
      peso_min: parseFloat(r.peso_min),
      peso_max: parseFloat(r.peso_max),
      precio_ci: parseFloat(r.precio_ci),
      precio_cp: parseFloat(r.precio_cp),
      precio_sd: parseFloat(r.precio_sd),
    }))
  }

  const tramo = tramos.find((t) => peso > t.peso_min && peso <= t.peso_max)
    ?? tramos[tramos.length - 1]

  if (!tramo) return 0

  const key = `precio_${codigoServicio.toLowerCase()}` as keyof PrecioTramo
  return Number(tramo[key]) || 0
}
