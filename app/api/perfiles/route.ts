import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { esAdminTotal } from '@/lib/roles'
import { getSupabase } from '@/lib/supabase'
import {
  GRUPOS, MODULOS, PERFILES_SISTEMA, PERFIL_ADMIN,
  invalidarPermisosCache, normalizarNivel, nivelPorDefecto, permisosPorDefecto,
  claseDeRol, rolBaseDePerfil, type Nivel,
} from '@/lib/permisos'

/**
 * /api/perfiles  (solo admin principal — gateada por APIS_AVANZADAS en el proxy)
 *
 *  GET    → { grupos, modulos, perfiles:[{id,slug,nombre,descripcion,sistema,activo,permisos,usuarios}], overrides }
 *  POST   { nombre, descripcion?, copiar_de? }        → crea un perfil
 *  PUT    { perfil_id, cambios:[{modulo,nivel}] }     → setea niveles del perfil
 *         { perfil_id, nombre?, descripcion?, activo? } → renombra / activa
 *         { usuario_id, modulo, nivel|null }          → excepción puntual de una persona
 *  DELETE ?id=                                        → borra un perfil (no del sistema)
 *
 * El perfil `administrador` es el dueño: no se edita, no se borra, siempre tiene todo.
 */

const TABLA = 'perfiles'
const TABLA_PERMISOS = 'perfil_permisos'
const TABLA_OVERRIDES = 'usuario_permisos'

async function requireOwner() {
  const session = await getServerSession(authOptions)
  if (!esAdminTotal((session?.user as { role?: string })?.role)) {
    return NextResponse.json({ error: 'Solo el administrador principal.' }, { status: 403 })
  }
  return null
}

function slugify(nombre: string): string {
  return nombre.trim().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'perfil'
}

const esVerdadero = (v: unknown) => !/^(false|falso|0)$/i.test(String(v ?? 'TRUE').trim())

interface PerfilFila { id: number | string; slug: string; nombre: string; descripcion: string; sistema: string; activo: string }

/** Estado completo del editor, leído fresco (sin cache) desde la base. */
async function leerEstado() {
  const sb = getSupabase()
  const [perfilesRes, permisosRes, overridesRes, usuariosRes] = await Promise.all([
    sb.from(TABLA).select('id,slug,nombre,descripcion,sistema,activo'),
    sb.from(TABLA_PERMISOS).select('perfil_id,modulo,nivel'),
    sb.from(TABLA_OVERRIDES).select('usuario_id,modulo,nivel'),
    sb.from('usuarios').select('id,nombre,email,rol,activo,perfil_id'),
  ])

  const filas = ((perfilesRes.data || []) as PerfilFila[])
    .sort((a, b) => Number(a.id) - Number(b.id))
  const permisos = (permisosRes.data || []) as Array<{ perfil_id: number | string; modulo: string; nivel: string }>
  const usuarios = (usuariosRes.data || []) as Array<{ id: string; nombre: string; email: string; rol: string; activo: string; perfil_id: string }>

  const perfiles = filas.map(p => {
    const id = String(p.id)
    const sistema = esVerdadero(p.sistema) && PERFILES_SISTEMA.includes(p.slug)
    const nivelesGuardados: Record<string, Nivel> = {}
    for (const r of permisos) {
      if (String(r.perfil_id) === id) nivelesGuardados[r.modulo] = normalizarNivel(r.nivel)
    }
    // Módulo sin fila: los perfiles semilla caen a su default; los creados a
    // mano arrancan cerrados (el dueño abre lo que quiera).
    const niveles: Record<string, Nivel> = {}
    for (const m of MODULOS) {
      niveles[m.key] = p.slug === PERFIL_ADMIN
        ? 'editar'
        : nivelesGuardados[m.key] ?? (sistema ? nivelPorDefecto(m.key, p.slug) : 'none')
    }
    return {
      id, slug: p.slug, nombre: p.nombre, descripcion: p.descripcion || '',
      sistema, editable: p.slug !== PERFIL_ADMIN, activo: esVerdadero(p.activo),
      permisos: niveles,
      usuarios: usuarios
        .filter(u => String(u.perfil_id || '') === id)
        .map(u => ({ id: String(u.id), nombre: u.nombre, email: u.email, activo: esVerdadero(u.activo) })),
    }
  })

  // Excepciones por persona: usuario_id → módulo → nivel.
  const overrides: Record<string, Record<string, Nivel>> = {}
  for (const r of (overridesRes.data || []) as Array<{ usuario_id: string; modulo: string; nivel: string }>) {
    ;(overrides[String(r.usuario_id)] ||= {})[r.modulo] = normalizarNivel(r.nivel)
  }

  return {
    grupos: GRUPOS,
    modulos: MODULOS.map(m => ({ key: m.key, label: m.label, grupo: m.grupo, descripcion: m.descripcion })),
    perfiles,
    overrides,
    usuariosSinPerfil: usuarios
      .filter(u => !u.perfil_id && esVerdadero(u.activo) && u.rol !== 'admin')
      .map(u => ({ id: String(u.id), nombre: u.nombre, email: u.email })),
  }
}

/**
 * Deja `usuarios.rol` en línea con el perfil de cada persona.
 *
 * Transitorio: mientras haya route handlers que gaten con `esAdmin(rol)` en vez
 * de consultar el módulo, el rol tiene que reflejar el perfil o esas rutas
 * quedarían desalineadas con lo que muestra el editor. Ver rolBaseDePerfil().
 */
async function sincronizarRoles(estado: Awaited<ReturnType<typeof leerEstado>>) {
  const sb = getSupabase()
  const { data: filas } = await sb.from('usuarios').select('id,rol')
  const rolActual = new Map(((filas || []) as Array<{ id: string; rol: string }>).map(u => [String(u.id), u.rol]))

  const cambios = estado.perfiles.flatMap(p => {
    const rol = rolBaseDePerfil(p.permisos, p.slug)
    return p.usuarios
      .filter(u => {
        const actual = rolActual.get(String(u.id))
        // El dueño no se toca nunca. Y solo se escribe si cambia la CLASE:
        // operador ↔ operador2 son la misma clase, convertir uno en otro
        // borraría la distinción de Nivel 1 / Nivel 2 sin cambiar ningún acceso.
        if (actual === 'admin') return false
        return claseDeRol(actual) !== claseDeRol(rol)
      })
      .map(u => ({ id: u.id, rol }))
  })

  await Promise.all(cambios.map(c => sb.from('usuarios').update({ rol: c.rol }).eq('id', c.id)))
}

export async function GET() {
  const denied = await requireOwner()
  if (denied) return denied
  try {
    return NextResponse.json(await leerEstado())
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[perfiles GET]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const denied = await requireOwner()
  if (denied) return denied
  try {
    const body = await req.json() as { nombre?: string; descripcion?: string; copiar_de?: string }
    const nombre = String(body.nombre || '').trim()
    if (!nombre) return NextResponse.json({ error: 'El nombre del perfil es obligatorio.' }, { status: 400 })

    const sb = getSupabase()
    const { data: existentes } = await sb.from(TABLA).select('id,slug')
    const usados = new Set(((existentes || []) as Array<{ slug: string }>).map(p => p.slug))
    let slug = slugify(nombre)
    if (usados.has(slug)) {
      let n = 2
      while (usados.has(`${slug}-${n}`)) n++
      slug = `${slug}-${n}`
    }

    const { data: creado, error } = await sb.from(TABLA)
      .insert({ slug, nombre, descripcion: String(body.descripcion || ''), sistema: 'FALSE', activo: 'TRUE' })
      .select('id').single()
    if (error) throw new Error(error.message)
    const perfilId = String((creado as { id: number | string }).id)

    // Niveles iniciales: copia de otro perfil, o todo cerrado.
    let niveles: Record<string, Nivel> = {}
    if (body.copiar_de) {
      const origen = ((existentes || []) as Array<{ id: number | string; slug: string }>)
        .find(p => String(p.id) === String(body.copiar_de))
      const { data: perms } = await sb.from(TABLA_PERMISOS).select('modulo,nivel').eq('perfil_id', body.copiar_de)
      for (const r of (perms || []) as Array<{ modulo: string; nivel: string }>) niveles[r.modulo] = normalizarNivel(r.nivel)
      // Si el origen es un perfil semilla sin filas propias, se copian sus defaults.
      if (origen && PERFILES_SISTEMA.includes(origen.slug)) {
        const def = permisosPorDefecto(origen.slug)
        for (const m of MODULOS) niveles[m.key] ??= def[m.key]
      }
    }
    if (Object.keys(niveles).length === 0) {
      niveles = Object.fromEntries(MODULOS.map(m => [m.key, 'none' as Nivel]))
    }
    await sb.from(TABLA_PERMISOS).upsert(
      MODULOS.map(m => ({ perfil_id: perfilId, modulo: m.key, nivel: niveles[m.key] || 'none', updated_at: new Date().toISOString() })),
      { onConflict: 'perfil_id,modulo' },
    )

    invalidarPermisosCache()
    const estado = await leerEstado()
    await sincronizarRoles(estado)
    return NextResponse.json(estado, { status: 201 })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[perfiles POST]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function PUT(req: NextRequest) {
  const denied = await requireOwner()
  if (denied) return denied
  try {
    const body = await req.json() as {
      perfil_id?: string
      cambios?: Array<{ modulo: string; nivel: string }>
      nombre?: string; descripcion?: string; activo?: boolean
      usuario_id?: string; modulo?: string; nivel?: string | null
    }
    const sb = getSupabase()
    const claves = new Set(MODULOS.map(m => m.key))

    // ── Excepción puntual de una persona ──────────────────────────────────
    if (body.usuario_id && body.modulo) {
      if (!claves.has(body.modulo)) return NextResponse.json({ error: 'Módulo desconocido.' }, { status: 400 })
      if (body.nivel === null || body.nivel === '') {
        // Quitar la excepción → vuelve a mandar el perfil.
        const { error } = await sb.from(TABLA_OVERRIDES).delete()
          .eq('usuario_id', body.usuario_id).eq('modulo', body.modulo)
        if (error) throw new Error(error.message)
      } else {
        const { error } = await sb.from(TABLA_OVERRIDES).upsert(
          { usuario_id: String(body.usuario_id), modulo: body.modulo, nivel: normalizarNivel(body.nivel), updated_at: new Date().toISOString() },
          { onConflict: 'usuario_id,modulo' },
        )
        if (error) throw new Error(error.message)
      }
      invalidarPermisosCache()
      return NextResponse.json(await leerEstado())
    }

    if (!body.perfil_id) return NextResponse.json({ error: 'perfil_id requerido.' }, { status: 400 })

    const { data: fila } = await sb.from(TABLA).select('id,slug,sistema').eq('id', body.perfil_id).single()
    if (!fila) return NextResponse.json({ error: 'Perfil no encontrado.' }, { status: 404 })
    const slug = (fila as { slug: string }).slug
    if (slug === PERFIL_ADMIN) {
      return NextResponse.json({ error: 'El perfil Nicolas (Admin) no se puede modificar.' }, { status: 400 })
    }

    // ── Datos del perfil ──────────────────────────────────────────────────
    const patch: Record<string, string> = {}
    if (typeof body.nombre === 'string' && body.nombre.trim()) patch.nombre = body.nombre.trim()
    if (typeof body.descripcion === 'string') patch.descripcion = body.descripcion
    if (typeof body.activo === 'boolean') patch.activo = body.activo ? 'TRUE' : 'FALSE'
    if (Object.keys(patch).length > 0) {
      const { error } = await sb.from(TABLA).update(patch).eq('id', body.perfil_id)
      if (error) throw new Error(error.message)
    }

    // ── Niveles por módulo ────────────────────────────────────────────────
    const cambios = (body.cambios || []).filter(c => claves.has(c.modulo))
    if (cambios.length > 0) {
      const { error } = await sb.from(TABLA_PERMISOS).upsert(
        cambios.map(c => ({
          perfil_id: String(body.perfil_id), modulo: c.modulo,
          nivel: normalizarNivel(c.nivel), updated_at: new Date().toISOString(),
        })),
        { onConflict: 'perfil_id,modulo' },
      )
      if (error) throw new Error(error.message)
    }

    invalidarPermisosCache()
    const estado = await leerEstado()
    await sincronizarRoles(estado)
    return NextResponse.json(estado)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[perfiles PUT]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  const denied = await requireOwner()
  if (denied) return denied
  try {
    const id = new URL(req.url).searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'id requerido' }, { status: 400 })
    const sb = getSupabase()

    const { data: fila } = await sb.from(TABLA).select('id,slug').eq('id', id).single()
    if (!fila) return NextResponse.json({ error: 'Perfil no encontrado.' }, { status: 404 })
    if (PERFILES_SISTEMA.includes((fila as { slug: string }).slug)) {
      return NextResponse.json({ error: 'Los perfiles base del sistema no se pueden eliminar. Podés desactivarlos.' }, { status: 400 })
    }

    // No dejar usuarios huérfanos sin permisos resueltos.
    const { data: conPerfil } = await sb.from('usuarios').select('id,nombre').eq('perfil_id', id)
    if ((conPerfil || []).length > 0) {
      const nombres = ((conPerfil || []) as Array<{ nombre: string }>).map(u => u.nombre).join(', ')
      return NextResponse.json(
        { error: `No se puede eliminar: todavía lo usan ${nombres}. Cambiales el perfil primero.` },
        { status: 409 },
      )
    }

    await sb.from(TABLA_PERMISOS).delete().eq('perfil_id', id)
    const { error } = await sb.from(TABLA).delete().eq('id', id)
    if (error) throw new Error(error.message)

    invalidarPermisosCache()
    const estado = await leerEstado()
    await sincronizarRoles(estado)
    return NextResponse.json(estado)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[perfiles DELETE]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
