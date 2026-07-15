import { NextResponse } from 'next/server'
import { getSheetData } from '@/lib/datastore'
import { problemasGlobal } from '@/lib/correos-log'

export const dynamic = 'force-dynamic'

/**
 * GET /api/clientes/correos-problema — clientes cuyo email VIGENTE tiene
 * problemas de entrega (rebotó / spam / falló en algún correo transaccional).
 * Alimenta el aviso de control en la lista /clientes, para corregir la
 * dirección en la ficha. Si el operador ya corrigió el email (la ficha tiene
 * otra dirección que la que rebotó), el cliente deja de aparecer.
 */
export async function GET() {
  try {
    const [problemas, clientes] = await Promise.all([
      problemasGlobal(),
      getSheetData('clientes'),
    ])
    if (problemas.length === 0) return NextResponse.json([])

    const norm = (s: string | undefined) => (s || '').trim().toLowerCase()
    const porId = new Map(clientes.map(c => [String(c.id), c]))

    const vistos = new Set<string>()
    const out: Array<{
      cliente_id: string; codigo: string; nombre_mascota: string; nombre_tutor: string
      email: string; estado: string; tipo: string; fecha: string
    }> = []
    for (const p of problemas) {
      // El rebote es propiedad del EMAIL: alertamos a todo cliente cuya ficha
      // siga usando esa dirección (el registro puede venir de otra ficha del
      // mismo tutor). Dedupe por cliente (queda el problema más reciente).
      const email = norm(p.email)
      if (!email) continue
      const afectados = p.cliente_id && norm(porId.get(String(p.cliente_id))?.email) === email
        ? [porId.get(String(p.cliente_id))!]
        : clientes.filter(c => norm(c.email) === email)
      for (const cli of afectados) {
        const key = String(cli.id)
        if (vistos.has(key)) continue
        vistos.add(key)
        out.push({
          cliente_id: key,
          codigo: cli.codigo || '',
          nombre_mascota: cli.nombre_mascota || '',
          nombre_tutor: cli.nombre_tutor || '',
          email: cli.email || '',
          estado: p.estado,
          tipo: p.tipo || '',
          fecha: p.fecha_actualizacion || p.fecha_envio || '',
        })
      }
    }
    return NextResponse.json(out)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
