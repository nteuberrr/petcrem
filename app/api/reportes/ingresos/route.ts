import { NextRequest, NextResponse } from 'next/server'
import { getSheetData } from '@/lib/datastore'
import { formatDateForSheet } from '@/lib/dates'
import { parseDecimalOr0, parsePeso } from '@/lib/numbers'
import { findTramo, precioDelTramo } from '@/lib/tramos'

export const dynamic = 'force-dynamic'

type Tramo = {
  id: string; peso_min: string; peso_max: string
  precio_ci: string; precio_cp: string; precio_sd: string
  veterinaria_id?: string
}
type AdicionalItem = { tipo: string; id: string; nombre?: string; precio?: number; qty?: number }

function parseFecha(raw: string): Date | null {
  if (!raw) return null
  const iso = formatDateForSheet(raw)
  if (!iso) return null
  const d = new Date(`${iso}T12:00:00`)
  return isNaN(d.getTime()) ? null : d
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const desdeRaw = searchParams.get('desde')
    const hastaRaw = searchParams.get('hasta')
    const desde = desdeRaw ? parseFecha(desdeRaw) : null
    const hasta = hastaRaw ? parseFecha(hastaRaw) : null
    if (hasta) hasta.setHours(23, 59, 59, 999)

    const safe = (name: string) => getSheetData(name).catch(() => [] as Record<string, string>[])
    const [clientes, vets, preciosGRaw, preciosCRaw, preciosERaw] = await Promise.all([
      safe('clientes'),
      safe('veterinarios'),
      safe('precios_generales'),
      safe('precios_convenio'),
      safe('precios_especiales'),
    ])
    const preciosG = preciosGRaw as unknown as Tramo[]
    const preciosC = preciosCRaw as unknown as Tramo[]
    const preciosE = preciosERaw as unknown as Tramo[]

    const vetById: Record<string, Record<string, string>> = {}
    vets.forEach(v => { vetById[v.id] = v })

    const preciosEByVet = new Map<string, Tramo[]>()
    for (const t of preciosE) {
      const vid = t.veterinaria_id ?? ''
      const arr = preciosEByVet.get(vid) ?? []
      arr.push(t)
      preciosEByVet.set(vid, arr)
    }

    // Tramos canónicos = precios_generales (usados como labels para bucketear).
    // Conservan peso_min/peso_max para que findTramo aplique la MISMA regla de
    // borde que el resto del sistema (límite exacto → tramo MAYOR).
    const tramosCanonicos = [...preciosG]
      .map(t => ({ id: t.id, peso_min: parseDecimalOr0(t.peso_min), peso_max: parseDecimalOr0(t.peso_max) }))
      .filter(t => t.peso_max > 0)
      .sort((a, b) => a.peso_min - b.peso_min)

    function tramoLabel(pesoKg: number): { label: string; orden: number } {
      if (!isFinite(pesoKg) || pesoKg <= 0) return { label: 'Sin peso', orden: 9999 }
      const t = findTramo(tramosCanonicos, pesoKg)
      if (!t) return { label: 'Sin peso', orden: 9999 }
      const orden = tramosCanonicos.indexOf(t)
      return { label: `${t.peso_min}–${t.peso_max} kg`, orden: orden >= 0 ? orden : 9999 }
    }

    function ingresoCliente(c: Record<string, string>): number {
      // Snapshot congelado al crear/editar la ficha → blinda el ingreso histórico
      // contra cambios en las tablas de precio (mismo criterio que el dashboard).
      const snap = parseDecimalOr0(c.precio_total)
      if (snap > 0) return snap
      // Fallback en vivo SOLO para fichas legacy sin snapshot guardado.
      const peso = parsePeso(c.peso_ingreso) || parsePeso(c.peso_declarado)
      const codigo = c.codigo_servicio || 'CI'
      let tabla: Tramo[] = preciosG
      const explicit = c.tipo_precios
      if (explicit === 'convenio') tabla = preciosC
      else if (explicit === 'especial') tabla = preciosEByVet.get(c.veterinaria_id ?? '') ?? []
      else if (explicit === 'general') tabla = preciosG
      else if (c.veterinaria_id) {
        const vet = vetById[c.veterinaria_id]
        if (vet?.tipo_precios === 'precios_especiales') tabla = preciosEByVet.get(c.veterinaria_id) ?? []
        else tabla = preciosC
      }
      const tramo = findTramo(tabla, peso)
      const servicio = precioDelTramo(tramo, codigo)
      let adicionales = 0
      try {
        const items = JSON.parse(c.adicionales || '[]') as AdicionalItem[]
        adicionales = items.reduce((s, a) => s + Math.max(0, a.precio ?? 0) * Math.max(0, a.qty ?? 1), 0)
      } catch { /* noop */ }
      return servicio + adicionales
    }

    function tipoPrecioEfectivo(c: Record<string, string>): string {
      const explicit = c.tipo_precios
      if (explicit === 'convenio') return 'Convenio'
      if (explicit === 'especial') return 'Especial'
      if (explicit === 'general') return 'General'
      if (c.veterinaria_id) {
        const vet = vetById[c.veterinaria_id]
        if (vet?.tipo_precios === 'precios_especiales') return 'Especial'
        return 'Convenio'
      }
      return 'General'
    }

    // Filtrar clientes por fecha_retiro (driver de venta). Los borradores (fichas
    // del bot aún sin registrar) no son ventas: se excluyen del reporte.
    const clientesFiltrados = clientes.filter(c => {
      if (c.estado === 'borrador') return false
      const f = parseFecha(c.fecha_retiro || c.fecha_creacion)
      if (!f) return false
      if (desde && f < desde) return false
      if (hasta && f > hasta) return false
      return true
    })

    // Acumuladores
    type Bucket = { ingresos: number; cantidad: number }
    const evolMap = new Map<string, Bucket & { mes_label: string }>()
    const tramoMap = new Map<string, Bucket & { orden: number }>()
    const servicioMap = new Map<string, Bucket>()
    const especieMap = new Map<string, Bucket>()
    const comunaMap = new Map<string, Bucket>()
    const tipoPrecioMap = new Map<string, Bucket>()

    let total = 0
    let cantidad = 0

    for (const c of clientesFiltrados) {
      const f = parseFecha(c.fecha_retiro || c.fecha_creacion)
      if (!f) continue
      const ingreso = ingresoCliente(c)
      total += ingreso
      cantidad += 1

      // Evolución mensual
      const mesKey = `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, '0')}`
      const mesLabel = f.toLocaleDateString('es-CL', { month: 'short', year: '2-digit' })
      const evol = evolMap.get(mesKey) ?? { ingresos: 0, cantidad: 0, mes_label: mesLabel }
      evol.ingresos += ingreso
      evol.cantidad += 1
      evolMap.set(mesKey, evol)

      // Por tramo (según peso del cliente, mapeado a tramo canónico)
      const peso = parsePeso(c.peso_ingreso) || parsePeso(c.peso_declarado)
      const { label: trLabel, orden } = tramoLabel(peso)
      const tr = tramoMap.get(trLabel) ?? { ingresos: 0, cantidad: 0, orden }
      tr.ingresos += ingreso
      tr.cantidad += 1
      tramoMap.set(trLabel, tr)

      // Por código de servicio
      const codigo = (c.codigo_servicio || 'CI').toUpperCase()
      const sv = servicioMap.get(codigo) ?? { ingresos: 0, cantidad: 0 }
      sv.ingresos += ingreso
      sv.cantidad += 1
      servicioMap.set(codigo, sv)

      // Por especie
      const esp = c.especie?.trim() || 'Sin especie'
      const e = especieMap.get(esp) ?? { ingresos: 0, cantidad: 0 }
      e.ingresos += ingreso
      e.cantidad += 1
      especieMap.set(esp, e)

      // Por comuna
      const com = c.comuna?.trim() || 'Sin comuna'
      const co = comunaMap.get(com) ?? { ingresos: 0, cantidad: 0 }
      co.ingresos += ingreso
      co.cantidad += 1
      comunaMap.set(com, co)

      // Por tipo de precio
      const tp = tipoPrecioEfectivo(c)
      const t = tipoPrecioMap.get(tp) ?? { ingresos: 0, cantidad: 0 }
      t.ingresos += ingreso
      t.cantidad += 1
      tipoPrecioMap.set(tp, t)
    }

    const evolucion = Array.from(evolMap.entries())
      .map(([mes_key, v]) => ({ mes_key, mes_label: v.mes_label, ingresos: v.ingresos, cantidad: v.cantidad }))
      .sort((a, b) => a.mes_key.localeCompare(b.mes_key))

    const porTramo = Array.from(tramoMap.entries())
      .map(([tramo, v]) => ({ tramo, ingresos: v.ingresos, cantidad: v.cantidad, orden: v.orden }))
      .sort((a, b) => a.orden - b.orden)

    const porServicio = Array.from(servicioMap.entries())
      .map(([codigo, v]) => ({ codigo, ingresos: v.ingresos, cantidad: v.cantidad }))
      .sort((a, b) => b.ingresos - a.ingresos)

    const porEspecie = Array.from(especieMap.entries())
      .map(([especie, v]) => ({ especie, ingresos: v.ingresos, cantidad: v.cantidad }))
      .sort((a, b) => b.ingresos - a.ingresos)

    const porComuna = Array.from(comunaMap.entries())
      .map(([comuna, v]) => ({ comuna, ingresos: v.ingresos, cantidad: v.cantidad }))
      .sort((a, b) => b.ingresos - a.ingresos)

    const porTipoPrecio = Array.from(tipoPrecioMap.entries())
      .map(([tipo, v]) => ({ tipo, ingresos: v.ingresos, cantidad: v.cantidad }))
      .sort((a, b) => b.ingresos - a.ingresos)

    return NextResponse.json({
      resumen: {
        total,
        cantidad,
        ticket_promedio: cantidad > 0 ? total / cantidad : 0,
      },
      evolucion_mensual: evolucion,
      por_tramo: porTramo,
      por_servicio: porServicio,
      por_especie: porEspecie,
      por_comuna: porComuna,
      por_tipo_precio: porTipoPrecio,
    }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
