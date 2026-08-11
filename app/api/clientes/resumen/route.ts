import { NextResponse } from 'next/server'
import { getSheetData } from '@/lib/datastore'
import { cobrosPendientesTodos } from '@/lib/cobros'
import { fichasConCorreoProblema } from '@/lib/correos-problema'
import { resumirFichas, type ContextoAlertas, type TramoPrecio } from '@/lib/fichas-alertas'
import { sesionConAcceso } from '@/lib/permisos-server'

export const dynamic = 'force-dynamic'

/**
 * GET /api/clientes/resumen — los conteos de los chips de /clientes, calculados
 * sobre TODAS las fichas.
 *
 * Existe porque la lista dejó de traer el histórico completo (carga las últimas y
 * el resto en segundo plano): si los chips se calcularan sobre lo que el navegador
 * tiene cargado, dirían de menos. El servidor lee todo — que ahí es barato — y
 * devuelve ~300 bytes en vez de medio mega.
 */
export async function GET() {
  const { ok } = await sesionConAcceso('/api/clientes', 'GET')
  if (!ok) return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
  try {
    const [clientes, generales, convenio, cobros] = await Promise.all([
      getSheetData('clientes'),
      getSheetData('precios_generales') as Promise<unknown> as Promise<TramoPrecio[]>,
      getSheetData('precios_convenio') as Promise<unknown> as Promise<TramoPrecio[]>,
      cobrosPendientesTodos().catch(() => [] as { cliente_id: string; monto: string; tipo: string }[]),
    ])
    const correosMalos = await fichasConCorreoProblema(clientes).catch(() => [])

    const devolucionPorFicha = new Map<string, number>()
    const idsConCobroPendiente = new Set<string>()
    for (const c of cobros) {
      const id = String(c.cliente_id)
      if (c.tipo === 'devolucion') {
        const monto = parseFloat(String(c.monto).replace(/[^\d.-]/g, '')) || 0
        devolucionPorFicha.set(id, (devolucionPorFicha.get(id) ?? 0) + monto)
      } else {
        idsConCobroPendiente.add(id)
      }
    }

    const ctx: ContextoAlertas = {
      preciosGenerales: generales,
      preciosConvenio: convenio,
      idsConCobroPendiente,
      devolucionPorFicha,
      idsCorreoMalo: new Set(correosMalos.map(c => String(c.cliente_id))),
    }
    return NextResponse.json(resumirFichas(clientes, ctx))
  } catch (e) {
    console.error('[clientes/resumen]', e)
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
