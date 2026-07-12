import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { esAdminTotal } from '@/lib/roles'
import { generarRespuestaMarketing } from '@/lib/marketing-agente'
import { obtenerItem } from '@/lib/marketing-calendario'

/**
 * POST /api/mailing/calendario/[id]/editar-imagen  (admin)
 * Body: { instruccion, indice? } → ajusta la imagen `indice` (1-based) de la pieza.
 *
 * Pasa por el MISMO agente de marketing del chat (generarRespuestaMarketing), no
 * directo a la edición: el agente interpreta el pedido del dueño con toda la
 * dirección de arte de la marca y redacta la instrucción fina antes de llamar
 * editar_imagen_pieza. Antes este botón mandaba el texto crudo directo a la
 * edición → resultados peores que el chat (pedido del dueño 2026-07-12: mismo
 * comportamiento en ambos lados).
 */
export const maxDuration = 300

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!esAdminTotal((session?.user as { role?: string })?.role)) {
    return NextResponse.json({ error: 'Solo admin' }, { status: 403 })
  }
  const { id } = await params
  try {
    const body = await req.json() as { instruccion?: string; indice?: number }
    if (!body.instruccion?.trim()) return NextResponse.json({ error: 'Falta la instrucción.' }, { status: 400 })
    const creadoPor = session?.user?.name || session?.user?.email || ''

    const indice = body.indice && body.indice >= 1 ? Math.floor(body.indice) : 1
    const r = await generarRespuestaMarketing([{
      rol: 'usuario',
      texto:
        `Ajusta la imagen ${indice} de la pieza #${id} del calendario con la herramienta editar_imagen_pieza (id="${id}", indice=${indice}). ` +
        `El cambio que pido es: "${body.instruccion.trim()}". ` +
        `Redacta tú la instrucción fina para la edición con tu criterio de dirección de arte (marca, encuadre, composición), aplicando TODO lo que pedí y nada más. ` +
        `No toques otras imágenes ni otras piezas, no propongas ideas nuevas: solo esta edición, ahora.`,
    }], { creadoPor })

    // Si el agente no llegó a editar (p. ej. pidió una aclaración), devolver su
    // mensaje como error visible en vez de un falso "listo".
    if (!r.acciones.includes('editar_imagen_pieza')) {
      return NextResponse.json({ error: r.mensaje || 'El agente no aplicó la edición. Intenta reformular el pedido.' }, { status: 422 })
    }
    const item = await obtenerItem(id)
    return NextResponse.json({ item, avisos: r.mensaje ? [r.mensaje] : [] })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[mailing/calendario editar-imagen]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
