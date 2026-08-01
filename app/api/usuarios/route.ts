import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { getSheetData, appendRow, updateRow, getNextId, deleteRow, ensureColumns, ensureSheet } from '@/lib/datastore'
import { todayISO } from '@/lib/dates'
import { normalizarRol } from '@/lib/roles'
import { getSupabase } from '@/lib/supabase'
import { claseDeRol, invalidarPermisosCache, normalizarNivel, nivelPorDefecto, rolBaseDePerfil, MODULOS, PERFILES_SISTEMA, type Nivel } from '@/lib/permisos'

const EXPECTED_COLS = ['id', 'nombre', 'email', 'password', 'rol', 'activo', 'fecha_creacion', 'telefono', 'avisos_whatsapp', 'perfil_id']

/**
 * Rol legacy que corresponde a un perfil. El acceso real lo decide el perfil
 * (lib/permisos), pero todavía hay rutas que gatean con `esAdmin(rol)`, así que el
 * rol se DERIVA del perfil en vez de pedirlo aparte. Ver rolBaseDePerfil().
 * Devuelve '' si el perfil no existe (se deja el rol que ya tenía).
 */
async function rolDePerfil(perfilId: string): Promise<string> {
  if (!perfilId) return ''
  try {
    const sb = getSupabase()
    const [{ data: perfil }, { data: perms }] = await Promise.all([
      sb.from('perfiles').select('slug').eq('id', perfilId).single(),
      sb.from('perfil_permisos').select('modulo,nivel').eq('perfil_id', perfilId),
    ])
    const slug = (perfil as { slug?: string } | null)?.slug
    if (!slug) return ''
    const niveles: Record<string, Nivel> = {}
    for (const r of (perms || []) as Array<{ modulo: string; nivel: string }>) niveles[r.modulo] = normalizarNivel(r.nivel)
    // Perfil semilla sin filas propias: se completa con sus defaults.
    if (PERFILES_SISTEMA.includes(slug)) {
      for (const m of MODULOS) niveles[m.key] ??= nivelPorDefecto(m.key, slug)
    }
    return rolBaseDePerfil(niveles, slug)
  } catch {
    return ''
  }
}

/** Celular a 9 dígitos (se guarda así; al enviar se antepone 56). '' si no da. */
function normalizarTelefono(v: unknown): string {
  const t = String(v ?? '').replace(/\D/g, '').slice(-9)
  return t.length === 9 ? t : ''
}

async function ensureUsuariosSheet() {
  await ensureSheet('usuarios')
  await ensureColumns('usuarios', EXPECTED_COLS)
}

/** Rol del usuario en sesión (admin / admin2 / operador). */
async function rolSesion(): Promise<string> {
  const s = await getServerSession(authOptions)
  return (s?.user as { role?: string })?.role ?? 'operador'
}

export async function GET() {
  try {
    // Gestión de usuarios = Configuración Avanzada → solo el admin principal.
    if ((await rolSesion()) !== 'admin') {
      return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
    }
    await ensureUsuariosSheet()
    const rows = await getSheetData('usuarios')
    return NextResponse.json(rows.map(u => ({
      id: u.id,
      nombre: u.nombre,
      email: u.email,
      rol: u.rol,
      activo: u.activo,
      fecha_creacion: u.fecha_creacion,
      telefono: u.telefono || '',
      avisos_whatsapp: u.avisos_whatsapp || 'FALSE',
      perfil_id: u.perfil_id || '',
    })))
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const caller = await rolSesion()
    if (caller !== 'admin') {
      return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
    }
    const body = await req.json()
    if (!body.nombre || !body.email || !body.password) {
      return NextResponse.json({ error: 'nombre, email y password requeridos' }, { status: 400 })
    }
    await ensureUsuariosSheet()
    // Evitar duplicados por email
    const existentes = await getSheetData('usuarios')
    if (existentes.some(u => u.email?.trim().toLowerCase() === String(body.email).trim().toLowerCase())) {
      return NextResponse.json({ error: 'Ya existe un usuario con ese email' }, { status: 409 })
    }
    // El perfil manda: si viene, el rol se deriva de él (ver rolDePerfil).
    const perfilId = String(body.perfil_id || '')
    const rolDerivado = await rolDePerfil(perfilId)
    const rol = rolDerivado || normalizarRol(body.rol)
    const id = await getNextId('usuarios')
    const now = todayISO()
    const telefono = normalizarTelefono(body.telefono)
    const row = {
      id,
      nombre: String(body.nombre),
      email: String(body.email),
      password: bcrypt.hashSync(String(body.password), 10),
      rol,
      activo: 'TRUE',
      fecha_creacion: now,
      telefono,
      // Sin teléfono no hay avisos. Con avisos ON: admin/admin2 reciben todo lo
      // del bot; operadores SOLO las solicitudes de retiro (ver lib/whatsapp).
      avisos_whatsapp: telefono && body.avisos_whatsapp === 'TRUE' ? 'TRUE' : 'FALSE',
      perfil_id: perfilId,
    }
    await appendRow('usuarios', row)
    invalidarPermisosCache()
    return NextResponse.json({ id, nombre: row.nombre, email: row.email, rol: row.rol, activo: row.activo, perfil_id: perfilId }, { status: 201 })
  } catch (e) {
    console.error('[usuarios POST]', e)
    return NextResponse.json({ error: String(e) }, { status: 400 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const id = searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'id requerido' }, { status: 400 })
    const rows = await getSheetData('usuarios')
    const idx = rows.findIndex(r => r.id === id)
    if (idx === -1) return NextResponse.json({ error: 'No encontrado' }, { status: 404 })
    const caller = await rolSesion()
    // Gestión de usuarios = Configuración Avanzada → solo el admin principal.
    if (caller !== 'admin') {
      return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
    }
    await deleteRow('usuarios', idx)
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json()
    const { id, ...updates } = body
    const rows = await getSheetData('usuarios')
    const idx = rows.findIndex(r => r.id === id)
    if (idx === -1) return NextResponse.json({ error: 'No encontrado' }, { status: 404 })
    const caller = await rolSesion()
    // Gestión de usuarios = Configuración Avanzada → solo el admin principal.
    if (caller !== 'admin') {
      return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
    }
    const target = rows[idx]
    // Cambio de perfil → el rol legacy se recalcula solo (no se pide por UI).
    if (updates.perfil_id !== undefined) {
      updates.perfil_id = String(updates.perfil_id || '')
      const derivado = await rolDePerfil(updates.perfil_id)
      // Al dueño no se le toca el rol: es el único que entra a Config Avanzada.
      // Y solo se escribe si cambia la CLASE: operador ↔ operador2 son la misma,
      // convertir uno en otro perdería la distinción de Nivel 1 / Nivel 2.
      if (derivado && target.rol !== 'admin' && claseDeRol(target.rol) !== claseDeRol(derivado)) {
        updates.rol = derivado
      }
    }
    if (updates.rol !== undefined) updates.rol = normalizarRol(updates.rol)
    if (updates.telefono !== undefined) updates.telefono = normalizarTelefono(updates.telefono)
    // Password vacío/omitido = no cambiar; si viene, se guarda hasheado
    if (updates.password) {
      updates.password = bcrypt.hashSync(String(updates.password), 10)
    } else {
      delete updates.password
    }
    const updated = { ...target, ...updates }
    // Sin teléfono no hay avisos por WhatsApp (coherencia servidor, no solo UI).
    if (!updated.telefono) updated.avisos_whatsapp = 'FALSE'
    await updateRow('usuarios', idx, updated)
    invalidarPermisosCache()
    return NextResponse.json({ id, nombre: updated.nombre, email: updated.email, rol: updated.rol, activo: updated.activo, perfil_id: updated.perfil_id || '' })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 })
  }
}
