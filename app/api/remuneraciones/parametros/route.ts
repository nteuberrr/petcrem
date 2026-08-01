import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { guard } from '@/lib/remuneraciones/auth'
import {
  getParametros, guardarParametros, listarFilasParametros, overridesCalendario,
  parsearParametros, periodoAnterior,
} from '@/lib/remuneraciones/parametros'
import { parametrosPorDefecto } from '@/lib/remuneraciones/tablas'
import { esPeriodoValido } from '@/lib/remuneraciones/periodo'

export const dynamic = 'force-dynamic'

const TramoSchema = z.object({
  desde_utm: z.number(),
  hasta_utm: z.number().nullable(),
  tasa: z.number(),
  rebaja_utm: z.number(),
})

const ParametrosSchema = z.object({
  periodo: z.string(),
  valor_uf: z.number().optional(),
  valor_utm: z.number().optional(),
  imm: z.number().optional(),
  tope_afp_uf: z.number().optional(),
  tope_afc_uf: z.number().optional(),
  tasas_afp: z.record(z.string(), z.number()).optional(),
  tramos_impuesto: z.array(TramoSchema).optional(),
  tasa_afc_trabajador: z.number().optional(),
  tasa_afc_empleador_indefinido: z.number().optional(),
  tasa_afc_empleador_plazo_fijo: z.number().optional(),
  tasa_mutual: z.number().optional(),
  tasa_sis: z.number().optional(),
  tasa_cuenta_individual: z.number().optional(),
  tasa_fapp: z.number().optional(),
  tasa_seguro_social: z.number().optional(),
  factor_gratificacion: z.number().optional(),
  tope_gratificacion_imm: z.number().optional(),
  dias_habiles: z.number().nullable().optional(),
  dias_descanso: z.number().nullable().optional(),
  notas: z.string().optional(),
  /** Copia los valores de otro período como punto de partida. */
  duplicar_de: z.string().optional(),
})

export async function GET(req: NextRequest) {
  const g = await guard('ver')
  if (g.denegado) return g.denegado
  try {
    const periodo = (req.nextUrl.searchParams.get('periodo') || '').trim()
    const filas = await listarFilasParametros()
    if (periodo) {
      const fila = filas.find(f => String(f.periodo) === periodo)
      return NextResponse.json({
        parametros: fila ? parsearParametros(fila) : null,
        calendario: fila ? overridesCalendario(fila) : { dias_habiles: null, dias_descanso: null },
        notas: fila?.notas || '',
        // Sugerencia para crear el período que falta: lo del mes anterior.
        sugerido: fila ? null : parametrosPorDefecto(periodo),
        periodo_anterior: periodoAnterior(periodo),
      })
    }
    return NextResponse.json({
      periodos: filas.map(f => ({
        ...parsearParametros(f),
        ...overridesCalendario(f),
        notas: f.notas || '',
      })),
    })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

/** Crea o pisa los parámetros de un período. */
export async function POST(req: NextRequest) {
  const g = await guard('editar')
  if (g.denegado) return g.denegado
  try {
    const body = ParametrosSchema.parse(await req.json())
    if (!esPeriodoValido(body.periodo)) {
      return NextResponse.json({ error: 'El período debe tener el formato YYYY-MM' }, { status: 400 })
    }

    let base = {}
    if (body.duplicar_de) {
      const previo = await getParametros(body.duplicar_de)
      if (!previo) {
        return NextResponse.json({ error: `No hay parámetros cargados para ${body.duplicar_de}` }, { status: 400 })
      }
      // El período es del mes nuevo, no del que se copia.
      base = { ...previo, periodo: body.periodo }
    }

    const { duplicar_de: _ignorado, ...cambios } = body
    const parametros = await guardarParametros(body.periodo, { ...base, ...cambios })
    return NextResponse.json({ parametros }, { status: 201 })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 })
  }
}
