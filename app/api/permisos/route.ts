import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { esAdminTotal } from '@/lib/roles'
import { getSupabase } from '@/lib/supabase'
import { MODULOS, defaultPermisos, invalidarPermisosCache, type PermisosConfig } from '@/lib/permisos'

/**
 * /api/permisos  (solo admin principal — gateada por APIS_AVANZADAS en el proxy)
 *  GET  → { modulos:[{key,label,def}], config:{ [modulo]: {admin2,operador} } }
 *  PUT  { cambios:[{modulo,rol,permitido}] }  o  { modulo, rol, permitido }
 *        → upsert de overrides; aplica (casi) al instante.
 *
 * El admin (dueño) siempre tiene todo y NO se guarda acá. Configuración Avanzada no
 * es un módulo editable (es siempre del dueño).
 */

async function requireOwner() {
  const session = await getServerSession(authOptions)
  if (!esAdminTotal((session?.user as { role?: string })?.role)) {
    return NextResponse.json({ error: 'Solo el administrador principal.' }, { status: 403 })
  }
  return null
}

const isTrue = (v: string) => /^(true|verdadero|1)$/i.test((v || '').trim())

/** Config fresca desde la base (sin cache) para el editor. */
async function leerConfigFresca(): Promise<PermisosConfig> {
  const config = defaultPermisos()
  try {
    const { data } = await getSupabase().from('permisos_modulos').select('modulo,rol,permitido')
    for (const r of (data || []) as Array<{ modulo: string; rol: string; permitido: string }>) {
      if (config[r.modulo] && (r.rol === 'admin2' || r.rol === 'operador')) {
        config[r.modulo][r.rol] = isTrue(r.permitido)
      }
    }
  } catch { /* defaults */ }
  return config
}

export async function GET() {
  const denied = await requireOwner()
  if (denied) return denied
  const config = await leerConfigFresca()
  return NextResponse.json({
    modulos: MODULOS.map(m => ({ key: m.key, label: m.label, def: m.def })),
    config,
  })
}

export async function PUT(req: NextRequest) {
  const denied = await requireOwner()
  if (denied) return denied
  try {
    const body = (await req.json()) as
      | { cambios?: Array<{ modulo: string; rol: string; permitido: boolean }> }
      | { modulo: string; rol: string; permitido: boolean }
    const cambios = 'cambios' in body && Array.isArray(body.cambios)
      ? body.cambios
      : ('modulo' in body ? [body] : [])
    const claves = new Set(MODULOS.map(m => m.key))
    const rows = cambios
      .filter(c => claves.has(c.modulo) && (c.rol === 'admin2' || c.rol === 'operador'))
      .map(c => ({ modulo: c.modulo, rol: c.rol, permitido: c.permitido ? 'TRUE' : 'FALSE', updated_at: new Date().toISOString() }))
    if (rows.length === 0) return NextResponse.json({ error: 'Nada que actualizar.' }, { status: 400 })
    const { error } = await getSupabase().from('permisos_modulos').upsert(rows, { onConflict: 'modulo,rol' })
    if (error) throw new Error(error.message)
    invalidarPermisosCache()
    return NextResponse.json({ config: await leerConfigFresca() })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[permisos PUT]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
