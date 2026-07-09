import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { generarInformeVeterinaria } from '@/lib/informe-veterinaria'
import { construirWorkbook } from '@/lib/informe-veterinaria-excel'
import { appendRow, ensureSheet, ensureColumns, getSheetData, getNextId } from '@/lib/datastore'
import { uploadToR2 } from '@/lib/cloudflare-r2'
import { todayISO, horaChile } from '@/lib/dates'
import { esAdmin } from '@/lib/roles'

const INFORMES_COLS = [
  'id', 'veterinaria_id', 'veterinaria_nombre',
  'version', 'formato',
  'periodo_hasta_mes', 'cantidad_meses', 'cantidad_fichas', 'monto_total_clp',
  'fecha_emision', 'hora_emision',
  'emitido_por_id', 'emitido_por_nombre',
  'archivo_key', 'archivo_url',
  'fecha_creacion',
]

async function calcularVersion(vetId: string): Promise<number> {
  try {
    await ensureSheet('informes_veterinaria')
    await ensureColumns('informes_veterinaria', INFORMES_COLS)
    const rows = await getSheetData('informes_veterinaria')
    const propios = rows.filter(r => r.veterinaria_id === vetId)
    return propios.length + 1
  } catch {
    return 1
  }
}

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions)
    const role = (session?.user as { role?: string })?.role
    if (!esAdmin(role)) {
      return NextResponse.json({ error: 'Solo administradores pueden generar informes' }, { status: 403 })
    }

    const { id } = await params
    const informe = await generarInformeVeterinaria(id)
    if (informe.totales_generales.total_fichas === 0) {
      return NextResponse.json({ error: 'Esta veterinaria aún no tiene fichas para facturar (mes cerrado)' }, { status: 400 })
    }

    const buffer = await construirWorkbook(informe)

    // Subir a R2
    const safeName = (informe.veterinaria.nombre || `vet${id}`).replace(/[^a-zA-Z0-9_-]+/g, '_')
    const version = await calcularVersion(id)
    const filename = `Informe_${safeName}_v${version}.xlsx`
    const key = `informes-veterinaria/${id}/${filename}`
    const upload = await uploadToR2(buffer, key, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').catch(err => {
      console.error('[informe/excel] uploadToR2 falló:', err)
      return null
    })

    // Registrar versión
    try {
      await ensureSheet('informes_veterinaria')
      await ensureColumns('informes_veterinaria', INFORMES_COLS)
      const informeId = await getNextId('informes_veterinaria')
      const [hh, mm] = horaChile().split(':') // hora de Chile (el server corre en UTC)
      await appendRow('informes_veterinaria', {
        id: informeId,
        veterinaria_id: id,
        veterinaria_nombre: informe.veterinaria.nombre,
        version,
        formato: 'excel',
        periodo_hasta_mes: informe.rango.hasta.slice(0, 7),
        cantidad_meses: informe.totales_generales.cantidad_meses,
        cantidad_fichas: informe.totales_generales.total_fichas,
        monto_total_clp: informe.totales_generales.monto_total,
        fecha_emision: todayISO(),
        hora_emision: `${hh}:${mm}`,
        emitido_por_id: (session?.user as { id?: string })?.id ?? '',
        emitido_por_nombre: session?.user?.name || session?.user?.email || '',
        archivo_key: upload?.key ?? '',
        archivo_url: upload?.url ?? '',
        fecha_creacion: todayISO(),
      })
    } catch (err) {
      console.error('[informe/excel] persistencia falló:', err)
    }

    return new Response(buffer as unknown as BodyInit, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    })
  } catch (e: unknown) {
    const err = e as { status?: number; message?: string }
    return NextResponse.json({ error: err.message ?? String(e) }, { status: err.status ?? 500 })
  }
}
