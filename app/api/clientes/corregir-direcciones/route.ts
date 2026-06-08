import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { getSheetData, updateRow } from '@/lib/google-sheets'
import { geocodeAddress } from '@/lib/google-maps'
import { esAdmin } from '@/lib/roles'

interface CambioRegistro {
  id: string
  codigo: string
  campo: 'direccion_retiro' | 'direccion_despacho'
  original: string
  corregida: string
}

function normalizarParaComparar(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ').replace(/[.,]/g, '')
}

async function intentarCorregir(direccion: string, comuna: string): Promise<string | null> {
  if (!direccion || !direccion.trim()) return null
  const query = comuna ? `${direccion.trim()}, ${comuna.trim()}, Chile` : `${direccion.trim()}, Chile`
  const geo = await geocodeAddress(query)
  if (!geo) return null
  return geo.formatted_address
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!esAdmin((session?.user as { role?: string })?.role)) {
      return NextResponse.json({ error: 'Solo admin' }, { status: 403 })
    }

    const url = new URL(req.url)
    const dryRun = url.searchParams.get('dry_run') !== 'false'

    const clientes = await getSheetData('clientes')
    const cambios: CambioRegistro[] = []
    const sin_resultado: Array<{ id: string; codigo: string; campo: string; valor: string }> = []
    let total_revisados = 0

    for (let i = 0; i < clientes.length; i++) {
      const c = clientes[i]
      if (c.estado === 'despachado') continue
      total_revisados++

      for (const campo of ['direccion_retiro', 'direccion_despacho'] as const) {
        const original = (c[campo] || '').trim()
        if (!original) continue

        const corregida = await intentarCorregir(original, c.comuna || '')
        if (!corregida) {
          sin_resultado.push({ id: c.id, codigo: c.codigo, campo, valor: original })
          continue
        }
        if (normalizarParaComparar(corregida) === normalizarParaComparar(original)) continue

        cambios.push({ id: c.id, codigo: c.codigo, campo, original, corregida })

        if (!dryRun) {
          await updateRow('clientes', i, { ...c, [campo]: corregida })
          // Refrescar la copia local para que si direccion_retiro cambió, no se sobreescriba al actualizar despacho
          c[campo] = corregida
        }
      }
    }

    return NextResponse.json({
      dry_run: dryRun,
      total_revisados,
      cambios_totales: cambios.length,
      retiro_cambiados: cambios.filter(c => c.campo === 'direccion_retiro').length,
      despacho_cambiados: cambios.filter(c => c.campo === 'direccion_despacho').length,
      sin_geocoding: sin_resultado.length,
      cambios,
      sin_resultado,
    })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[corregir-direcciones] error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
