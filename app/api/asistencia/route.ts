import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { getSheetData, appendRow, updateRow, getNextId, deleteRow, ensureColumns, ensureSheet } from '@/lib/google-sheets'
import { todayISO, formatDateForSheet, formatHora } from '@/lib/dates'
import { calcularMinutos, configVigente, type JornadaConfig } from '@/lib/asistencia'

export const dynamic = 'force-dynamic'

const HOJA = 'asistencia'
const COLS = [
  'id', 'usuario_id', 'usuario_nombre', 'fecha', 'dia_semana', 'es_findesemana',
  'hora_entrada', 'hora_salida', 'minutos_trabajados', 'minutos_normales', 'minutos_extra',
  'estado_aprobacion', 'aprobado_por', 'comentario', 'fecha_creacion',
]

async function ensure() {
  await ensureSheet(HOJA)
  await ensureColumns(HOJA, COLS)
}

async function getConfigs(): Promise<JornadaConfig[]> {
  await ensureSheet('jornada_config')
  await ensureColumns('jornada_config', ['id', 'vigente_desde', 'hora_entrada', 'hora_salida', 'precio_hora_extra', 'tolerancia_minutos', 'creado_por', 'fecha_creacion'])
  const rows = await getSheetData('jornada_config')
  return rows.map(r => ({
    id: r.id,
    vigente_desde: formatDateForSheet(r.vigente_desde) || r.vigente_desde,
    hora_entrada: formatHora(r.hora_entrada),
    hora_salida: formatHora(r.hora_salida),
    precio_hora_extra: parseFloat(r.precio_hora_extra) || 0,
    tolerancia_minutos: parseInt(r.tolerancia_minutos || '0', 10) || 0,
  }))
}

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    await ensure()
    const { searchParams } = new URL(req.url)
    const usuarioId = searchParams.get('usuario_id')
    const desde = searchParams.get('desde')
    const hasta = searchParams.get('hasta')

    const rows = await getSheetData(HOJA)
    let filtered = rows

    // Operador solo ve sus propios registros
    const role = (session.user as { role?: string })?.role
    if (role !== 'admin') {
      const myId = (session.user as { id?: string })?.id ?? ''
      // Si el JWT no trae id (sesión vieja), no devolver nada en vez de filtrar por '0'
      if (!myId) return NextResponse.json([])
      filtered = filtered.filter(r => r.usuario_id === myId)
    } else if (usuarioId) {
      filtered = filtered.filter(r => r.usuario_id === usuarioId)
    }

    if (desde) filtered = filtered.filter(r => (formatDateForSheet(r.fecha) || r.fecha) >= desde)
    if (hasta) filtered = filtered.filter(r => (formatDateForSheet(r.fecha) || r.fecha) <= hasta)

    // Ordenar por fecha desc
    filtered.sort((a, b) => (formatDateForSheet(b.fecha) || b.fecha).localeCompare(formatDateForSheet(a.fecha) || a.fecha))

    // Normalizar fecha (ISO) y horas (HH:MM) antes de mandar al cliente
    const normalized = filtered.map(r => ({
      ...r,
      fecha: formatDateForSheet(r.fecha) || r.fecha,
      hora_entrada: formatHora(r.hora_entrada),
      hora_salida: formatHora(r.hora_salida),
    }))

    return NextResponse.json(normalized)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    const body = await req.json()
    const { fecha, hora_entrada, hora_salida, comentario } = body
    if (!fecha || !hora_entrada) {
      return NextResponse.json({ error: 'fecha y hora_entrada son requeridos' }, { status: 400 })
    }
    await ensure()

    const usuarioId = (session.user as { id?: string })?.id ?? '0'
    const usuarioNombre = session.user?.name ?? session.user?.email ?? ''

    // Verificar que no haya un registro previo para este usuario+fecha
    const rows = await getSheetData(HOJA)
    const existeIdx = rows.findIndex(r => r.usuario_id === usuarioId && (formatDateForSheet(r.fecha) || r.fecha) === fecha)
    if (existeIdx !== -1) {
      return NextResponse.json({ error: 'Ya existe un registro para este día. Editalo en vez de crear otro.' }, { status: 409 })
    }

    const configs = await getConfigs()
    const cfg = configVigente(configs, fecha)
    if (!cfg) {
      return NextResponse.json({ error: 'No hay configuración de jornada vigente. Pedile al admin que la cree en Configuración → Jornada.' }, { status: 400 })
    }

    // Si no hay hora_salida, dejamos el día abierto (minutos en 0, sin horas extra calculadas)
    const tieneSalida = !!hora_salida
    const calc = tieneSalida
      ? calcularMinutos(fecha, hora_entrada, hora_salida, cfg)
      : { trabajados: 0, normales: 0, extra: 0, esFindesemana: false, diaSemana: '' }
    const id = await getNextId(HOJA)
    const row = {
      id,
      usuario_id: usuarioId,
      usuario_nombre: usuarioNombre,
      fecha: String(fecha),
      dia_semana: calc.diaSemana,
      es_findesemana: calc.esFindesemana ? 'TRUE' : 'FALSE',
      hora_entrada: String(hora_entrada),
      hora_salida: tieneSalida ? String(hora_salida) : '',
      minutos_trabajados: calc.trabajados,
      minutos_normales: calc.normales,
      minutos_extra: calc.extra,
      estado_aprobacion: !tieneSalida ? 'abierto' : (calc.extra > 0 ? 'pendiente' : 'aprobado'),
      aprobado_por: !tieneSalida ? '' : (calc.extra > 0 ? '' : 'auto'),
      comentario: comentario ?? '',
      fecha_creacion: todayISO(),
    }
    await appendRow(HOJA, row)
    return NextResponse.json(row, { status: 201 })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    const body = await req.json()
    const { id, ...updates } = body
    if (!id) return NextResponse.json({ error: 'id requerido' }, { status: 400 })
    await ensure()
    const rows = await getSheetData(HOJA)
    const idx = rows.findIndex(r => r.id === id)
    if (idx === -1) return NextResponse.json({ error: 'No encontrado' }, { status: 404 })

    const role = (session.user as { role?: string })?.role
    const isAdmin = role === 'admin'
    const myId = (session.user as { id?: string })?.id ?? '0'
    if (!isAdmin && rows[idx].usuario_id !== myId) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
    }

    const updated: Record<string, unknown> = { ...rows[idx], ...updates }

    // Si cambian fecha o hora, recalcular minutos
    if (updates.fecha !== undefined || updates.hora_entrada !== undefined || updates.hora_salida !== undefined) {
      const configs = await getConfigs()
      const cfg = configVigente(configs, String(updated.fecha))
      if (cfg) {
        const tieneSalida = !!String(updated.hora_salida || '')
        const calc = tieneSalida
          ? calcularMinutos(String(updated.fecha), String(updated.hora_entrada), String(updated.hora_salida), cfg)
          : { trabajados: 0, normales: 0, extra: 0, esFindesemana: false, diaSemana: '' }
        updated.dia_semana = calc.diaSemana
        updated.es_findesemana = calc.esFindesemana ? 'TRUE' : 'FALSE'
        updated.minutos_trabajados = calc.trabajados
        updated.minutos_normales = calc.normales
        updated.minutos_extra = calc.extra
        if (!tieneSalida) {
          updated.estado_aprobacion = 'abierto'
          updated.aprobado_por = ''
        } else if (calc.extra === 0 && (updated.estado_aprobacion === 'pendiente' || updated.estado_aprobacion === 'abierto')) {
          updated.estado_aprobacion = 'aprobado'
          updated.aprobado_por = 'auto'
        } else if (calc.extra > 0 && updated.estado_aprobacion === 'abierto') {
          updated.estado_aprobacion = 'pendiente'
          updated.aprobado_por = ''
        }
      }
    }

    // Si admin aprueba/rechaza, registrar quién
    if (isAdmin && (updates.estado_aprobacion === 'aprobado' || updates.estado_aprobacion === 'rechazado')) {
      updated.aprobado_por = session.user?.email ?? 'admin'
    }

    // Normalizar fecha y horas a formato canónico antes de escribir.
    // CRÍTICO: si la celda guarda un serial como "0.28819..." (string), Sheets en
    // locale es-CL interpreta el punto como separador de miles → corrompe el valor
    // (ej. "0.28819" → 28819, mostrado como número enorme). Convertir a "HH:MM" y
    // "YYYY-MM-DD" evita que Sheets re-parsee con la locale.
    if (updated.hora_entrada !== undefined && updated.hora_entrada !== '') {
      updated.hora_entrada = formatHora(String(updated.hora_entrada))
    }
    if (updated.hora_salida !== undefined && updated.hora_salida !== '') {
      updated.hora_salida = formatHora(String(updated.hora_salida))
    }
    if (updated.fecha !== undefined && updated.fecha !== '') {
      updated.fecha = formatDateForSheet(String(updated.fecha)) || String(updated.fecha)
    }
    if (updated.fecha_creacion !== undefined && updated.fecha_creacion !== '') {
      updated.fecha_creacion = formatDateForSheet(String(updated.fecha_creacion)) || String(updated.fecha_creacion)
    }

    await updateRow(HOJA, idx, updated)
    return NextResponse.json(updated)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    const { searchParams } = new URL(req.url)
    const id = searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'id requerido' }, { status: 400 })
    const rows = await getSheetData(HOJA)
    const idx = rows.findIndex(r => r.id === id)
    if (idx === -1) return NextResponse.json({ error: 'No encontrado' }, { status: 404 })
    // El operador puede eliminar sus propios registros; admin puede eliminar cualquiera
    const role = (session.user as { role?: string })?.role
    const myId = (session.user as { id?: string })?.id ?? '0'
    if (role !== 'admin' && rows[idx].usuario_id !== myId) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
    }
    await deleteRow(HOJA, idx)
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
