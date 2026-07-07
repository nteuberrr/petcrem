import { getSheetData } from './datastore'
import { formatDateForSheet } from './dates'
import { parsePeso } from './numbers'
import { calcularPrecioFicha, type Tramo } from './ficha-precio'

/**
 * Propuesta mensual de "Facturar Veterinarios": agrupa por veterinaria las
 * fichas de convenio/especiales de un mes (driver: fecha_retiro, igual que
 * lib/informe-veterinaria.ts — MISMA función de precio compartida, así lo que
 * el vet ve en su informe es exactamente lo que se le factura).
 *
 * Excluye: fichas 'borrador', fichas SIN veterinaria (son "General", no se
 * facturan a nadie), y fichas ya cubiertas por una factura anterior
 * (`clientes.factura_vet_id` no vacío — se libera automáticamente si esa
 * factura se anula, ver lib/facturacion.ts `anularDocumento`).
 */

export interface FichaPropuesta {
  id: string
  codigo: string
  fecha_retiro: string
  nombre_mascota: string
  especie: string
  peso: number
  codigo_servicio: string
  /** Precio total (bruto, IVA incluido) — lo que se le cobra al vet por esta ficha. */
  monto: number
}

export interface VetPropuesta {
  veterinaria_id: string
  nombre: string
  rut: string
  razon_social: string
  giro: string
  direccion: string
  comuna: string
  correo: string
  tipo_precios: string
  fichas: FichaPropuesta[]
  total: number
}

export interface PropuestaMes {
  mes: string // YYYY-MM
  vets: VetPropuesta[]
}

function rangoDelMes(mes: string): { desde: string; hasta: string } {
  const [y, m] = mes.split('-').map(n => parseInt(n, 10))
  const ultimoDia = new Date(y, m, 0).getDate()
  return { desde: `${mes}-01`, hasta: `${mes}-${String(ultimoDia).padStart(2, '0')}` }
}

export async function construirPropuestaMes(mes: string): Promise<PropuestaMes> {
  if (!/^\d{4}-\d{2}$/.test(mes)) throw new Error('Mes inválido (esperado YYYY-MM)')
  const { desde, hasta } = rangoDelMes(mes)

  const [vets, clientes, preciosG, preciosC, preciosE] = await Promise.all([
    getSheetData('veterinarios'),
    getSheetData('clientes'),
    getSheetData('precios_generales'),
    getSheetData('precios_convenio'),
    getSheetData('precios_especiales').catch(() => [] as Record<string, string>[]),
  ])
  const tramosG = preciosG as unknown as Tramo[]
  const tramosC = preciosC as unknown as Tramo[]
  const tramosE = preciosE as unknown as Tramo[]
  const vetById = new Map(vets.map(v => [v.id, v]))

  const porVet = new Map<string, VetPropuesta>()

  for (const c of clientes) {
    if (!c.veterinaria_id?.trim()) continue
    if (c.estado === 'borrador') continue
    if (c.factura_vet_id?.trim()) continue // ya facturada a su vet
    const fISO = formatDateForSheet(c.fecha_retiro)
    if (!fISO || fISO < desde || fISO > hasta) continue

    const vet = vetById.get(c.veterinaria_id)
    if (!vet) continue // veterinaria eliminada/no encontrada

    let entry = porVet.get(c.veterinaria_id)
    if (!entry) {
      entry = {
        veterinaria_id: vet.id,
        nombre: vet.nombre,
        rut: vet.rut || '',
        razon_social: vet.razon_social || vet.nombre,
        giro: vet.giro || '',
        direccion: vet.direccion || '',
        comuna: vet.comuna || '',
        correo: vet.correo || '',
        tipo_precios: vet.tipo_precios || '',
        fichas: [],
        total: 0,
      }
      porVet.set(c.veterinaria_id, entry)
    }

    const tramosEDeEstaVet = tramosE.filter(t => t.veterinaria_id === c.veterinaria_id)
    const precio = calcularPrecioFicha(c, vet.tipo_precios, { generales: tramosG, convenio: tramosC, especialesDeVet: tramosEDeEstaVet })

    entry.fichas.push({
      id: c.id,
      codigo: c.codigo,
      fecha_retiro: fISO,
      nombre_mascota: c.nombre_mascota,
      especie: c.especie,
      peso: parsePeso(c.peso_ingreso) || parsePeso(c.peso_declarado),
      codigo_servicio: (c.codigo_servicio || 'CI').toUpperCase(),
      monto: precio.total,
    })
    entry.total += precio.total
  }

  const vetsArr = Array.from(porVet.values()).sort((a, b) => a.nombre.localeCompare(b.nombre))
  for (const v of vetsArr) v.fichas.sort((a, b) => a.fecha_retiro.localeCompare(b.fecha_retiro))

  return { mes, vets: vetsArr }
}
