import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { getSheetData, appendRow, updateRow, ensureSheet, ensureColumns, isSheetsBackend } from '@/lib/datastore'
import { todayISO } from '@/lib/dates'

const SHEET = 'empresa_config'
const COLS = ['id', 'nombre', 'rut', 'giro', 'direccion', 'comuna', 'telefono', 'correo', 'web', 'instagram', 'facebook', 'google_review_url', 'email_seguimiento', 'email_seguimiento_activo', 'seguimiento_tipos', 'fecha_actualizacion']

type EmpresaConfig = {
  id?: string
  nombre?: string
  rut?: string
  giro?: string
  direccion?: string
  comuna?: string
  telefono?: string
  correo?: string
  web?: string
  instagram?: string
  facebook?: string
  /** Link directo a "escribir reseña" del Perfil de Empresa de Google (botón "Evalúanos" en el correo de entrega). */
  google_review_url?: string
  /** Correo al que se reenvía copia (BCC) de cada email transaccional, si email_seguimiento_activo='TRUE'. */
  email_seguimiento?: string
  email_seguimiento_activo?: string
  /** JSON {key_correo: bool}: activa/desactiva la copia de seguimiento POR TIPO (vacío = todos ON). */
  seguimiento_tipos?: string
  fecha_actualizacion?: string
}

const EMPTY: EmpresaConfig = {
  id: '1', nombre: '', rut: '', giro: '',
  direccion: '', comuna: '',
  telefono: '', correo: '',
  web: '', instagram: '', facebook: '',
  google_review_url: '',
  email_seguimiento: '', email_seguimiento_activo: 'FALSE',
  seguimiento_tipos: '',
  fecha_actualizacion: '',
}

export async function GET() {
  try {
    await ensureSheet(SHEET)
    await ensureColumns(SHEET, COLS)
    const rows = await getSheetData(SHEET)
    const row = rows.find(r => r.id === '1') || rows[0]
    return NextResponse.json(row || EMPTY)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function PUT(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if ((session?.user as { role?: string })?.role !== 'admin') {
      return NextResponse.json({ error: 'Solo admin' }, { status: 403 })
    }
    const body = (await req.json().catch(() => ({}))) as EmpresaConfig

    await ensureSheet(SHEET)
    await ensureColumns(SHEET, COLS)
    const rows = await getSheetData(SHEET)
    const idx = rows.findIndex(r => r.id === '1')

    // Merge: solo sobreescribe los campos presentes en el body; preserva el resto
    // de la fila existente (así guardar "Datos personales" no borra el seguimiento
    // de correos y viceversa).
    const existing: Record<string, string> = (idx === -1 ? {} : rows[idx]) as Record<string, string>
    const bodyRec = body as Record<string, unknown>
    const data: Record<string, string> = { id: '1', fecha_actualizacion: todayISO() }
    for (const col of COLS) {
      if (col === 'id' || col === 'fecha_actualizacion') continue
      const v = bodyRec[col]
      data[col] = (v !== undefined && v !== null) ? String(v) : (existing[col] ?? '')
    }

    // Sheets (valueInputOption USER_ENTERED) interpreta un valor que empieza con
    // "+", "=" o "@" como fórmula y se "come" el "+" del teléfono. Forzamos texto
    // con un apóstrofo inicial: Sheets lo guarda como texto y NO lo devuelve al
    // leer, así el "+56..." persiste y se muestra tal cual.
    // SOLO aplica a Sheets: en Postgres el apóstrofo se guardaría literal ("'+56…").
    if (data.telefono) {
      if (isSheetsBackend()) {
        if (/^[+=@]/.test(data.telefono.trim())) data.telefono = `'${data.telefono.trim()}`
      } else if (data.telefono.startsWith("'")) {
        // Postgres: limpiar el apóstrofo heredado del hack de Sheets (datos viejos).
        data.telefono = data.telefono.replace(/^'+/, '')
      }
    }

    if (idx === -1) {
      await appendRow(SHEET, data)
    } else {
      await updateRow(SHEET, idx, data)
    }
    return NextResponse.json({ ok: true, data })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
