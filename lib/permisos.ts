/**
 * Motor de permisos por MÓDULO × PERFIL, con tres niveles: none | ver | editar.
 *
 * Modelo (reemplaza al gateo booleano por rol):
 *   usuario → perfil → nivel por módulo   (+ excepción puntual por usuario)
 *
 *  - El admin (dueño) SIEMPRE tiene todo en nivel `editar` (no se edita → no puede
 *    auto-bloquearse) y es el único que entra a Configuración Avanzada.
 *  - Los demás usuarios llevan un PERFIL (`usuarios.perfil_id`). El perfil define el
 *    nivel de cada módulo. Se puede sobrescribir un módulo suelto para UNA persona
 *    (tabla `usuario_permisos`) sin tener que inventar un perfil nuevo.
 *  - El nivel exigido sale del MÉTODO HTTP: GET/HEAD → `ver`; POST/PUT/PATCH/DELETE
 *    → `editar`. Así "visualizador" y "editor" son el mismo permiso en dos niveles,
 *    sin duplicar rutas.
 *  - Compatibilidad: si la base todavía no tiene las tablas nuevas (o el usuario no
 *    tiene perfil), se cae al modelo viejo por rol (`permisos_modulos`) para no dejar
 *    a nadie afuera durante el despliegue.
 *
 * Apto para middleware (edge): lee Supabase por REST con `fetch` (sin supabase-js
 * ni datastore, que arrastrarían googleapis y romperían el bundle del edge).
 */

import { APIS_AVANZADAS } from './roles'

// ─── Niveles ────────────────────────────────────────────────────────────────

export type Nivel = 'none' | 'ver' | 'editar'

const RANGO: Record<Nivel, number> = { none: 0, ver: 1, editar: 2 }

export const NIVEL_LABEL: Record<Nivel, string> = {
  none: 'Sin acceso',
  ver: 'Visualizador',
  editar: 'Editor',
}

export function normalizarNivel(v: unknown): Nivel {
  const s = String(v ?? '').trim().toLowerCase()
  if (s === 'editar' || s === 'edit' || s === 'true' || s === 'verdadero' || s === '1') return 'editar'
  if (s === 'ver' || s === 'lectura' || s === 'read') return 'ver'
  return 'none'
}

export function alcanza(actual: Nivel, requerido: Nivel): boolean {
  return RANGO[actual] >= RANGO[requerido]
}

/** Nivel que exige un método HTTP. Los métodos de lectura piden `ver`. */
export function nivelDeMetodo(method: string): Nivel {
  const m = (method || 'GET').toUpperCase()
  return m === 'GET' || m === 'HEAD' || m === 'OPTIONS' ? 'ver' : 'editar'
}

// ─── Perfiles ───────────────────────────────────────────────────────────────

/** Perfiles semilla. `administrador` es el dueño y no se edita ni se borra. */
export const PERFIL_ADMIN = 'administrador'
export type PerfilBase = 'general' | 'operario-n1' | 'operario-n2'
export const PERFILES_SISTEMA: string[] = [PERFIL_ADMIN, 'general', 'operario-n1', 'operario-n2']

/** Rol legacy → slug del perfil semilla equivalente (migración + fallback). */
export function perfilDeRol(rol?: string | null): string {
  if (rol === 'admin') return PERFIL_ADMIN
  if (rol === 'admin2') return 'general'
  if (rol === 'operador2') return 'operario-n2'
  return 'operario-n1'
}

// ─── Módulos ────────────────────────────────────────────────────────────────

export type GrupoKey = 'operacion' | 'comercial' | 'administracion' | 'sistema'

export const GRUPOS: { key: GrupoKey; label: string }[] = [
  { key: 'operacion', label: 'Operación diaria' },
  { key: 'comercial', label: 'Comercial y marketing' },
  { key: 'administracion', label: 'Administración y finanzas' },
  { key: 'sistema', label: 'Configuración del sistema' },
]

export interface Modulo {
  key: string
  label: string
  grupo: GrupoKey
  /** Qué habilita, en criollo (se muestra en el editor de perfiles). */
  descripcion?: string
  /** Prefijos de páginas que cubre el módulo. */
  pages: string[]
  /** Prefijos de API que el módulo controla por completo (ver Y editar). */
  apis: string[]
  /**
   * Prefijos de API que este módulo solo puede LEER, por más que tenga nivel
   * `editar`. Sirve para los catálogos compartidos: la ficha del cliente necesita
   * leer precios/veterinarios/productos, pero editarlos es de Configuración.
   */
  soloLectura?: string[]
  /** Prefijos donde POST es en realidad una lectura (autocomplete, búsquedas). */
  postLectura?: string[]
  /** Nivel por defecto de los perfiles semilla (reproduce el gateo histórico). */
  def: Record<PerfilBase, Nivel>
}

/**
 * Registro ÚNICO de módulos, agrupado para que el editor se lea ordenado.
 *
 * Los `def` reproducen el comportamiento histórico (lo que hoy era `true` pasa a
 * `editar`), así nada cambia hasta que el dueño ajusta un perfil.
 *
 * Un prefijo compartido puede aparecer en varios módulos: gana el match más
 * ESPECÍFICO (prefijo más largo) y, entre empates, basta con que UNO conceda el
 * nivel pedido — por eso los catálogos compartidos van en `soloLectura`, que nunca
 * alcanza para escribir.
 */
export const MODULOS: Modulo[] = [
  // ── Operación diaria ──────────────────────────────────────────────────────
  // solicitudes-retiro también está en 'mensajes'; acá se lista para que TODOS
  // los perfiles con Dashboard vean las notificaciones de eutanasias (el GET del
  // route devuelve SOLO eutanasias a los no-admin; el POST sigue siendo admin).
  {
    key: 'dashboard', label: 'Dashboard', grupo: 'operacion',
    descripcion: 'Panel de inicio: KPIs, agenda del día y notificaciones.',
    pages: ['/dashboard'], apis: ['/api/dashboard', '/api/solicitudes-retiro', '/api/agenda'],
    def: { general: 'editar', 'operario-n1': 'editar', 'operario-n2': 'editar' },
  },
  {
    key: 'clientes', label: 'Clientes y fichas', grupo: 'operacion',
    descripcion: 'Fichas de mascotas, cobros, fotos y certificados.',
    pages: ['/clientes'], apis: ['/api/clientes', '/api/cobros', '/api/upload'],
    // Catálogos que la ficha LEE pero no debe poder modificar (editarlos es de
    // Configuración / Veterinarios). Antes estaban en `apis` y eso dejaba a un
    // operario borrar precios o veterinarios pegándole a la API directo.
    soloLectura: ['/api/places', '/api/veterinarios', '/api/precios', '/api/descuentos', '/api/especies', '/api/productos', '/api/categorias-productos', '/api/servicios'],
    postLectura: ['/api/places'],
    def: { general: 'editar', 'operario-n1': 'editar', 'operario-n2': 'editar' },
  },
  {
    key: 'operaciones', label: 'Operaciones', grupo: 'operacion',
    descripcion: 'Ciclos de cremación, petróleo, vehículo y despachos.',
    pages: ['/operaciones'], apis: ['/api/ciclos', '/api/petroleo', '/api/vehiculo', '/api/despachos'],
    def: { general: 'editar', 'operario-n1': 'editar', 'operario-n2': 'editar' },
  },
  // pagos-retiros se usa desde la página de Asistencia pero es plata: va como
  // soloLectura acá y lo edita quien tenga Rendiciones.
  {
    key: 'asistencia', label: 'Asistencia', grupo: 'operacion',
    descripcion: 'Marcaje de jornada y retiros adicionales del equipo.',
    pages: ['/asistencia'], apis: ['/api/asistencia', '/api/retiros-adicionales'],
    soloLectura: ['/api/jornada-config', '/api/pagos-retiros'],
    def: { general: 'editar', 'operario-n1': 'editar', 'operario-n2': 'editar' },
  },
  {
    key: 'mensajes', label: 'Mensajes (WhatsApp / Instagram)', grupo: 'operacion',
    descripcion: 'Inbox unificado y respuestas a clientes.',
    pages: ['/mensajes', '/wa-coexistence'], apis: ['/api/mensajes', '/api/solicitudes-retiro', '/api/whatsapp'],
    def: { general: 'editar', 'operario-n1': 'none', 'operario-n2': 'none' },
  },
  // Ficha de UNA eutanasia (la que se abre desde el dashboard / la agenda): ver
  // sus datos y confirmar si se realizó o no. La tienen TODOS los perfiles a
  // propósito — el veterinario muchas veces no marca su enlace del correo y sin
  // esto nadie más puede cerrar el caso. NO abre Precios ni Veterinarios de
  // convenio: sus prefijos son más específicos que los de 'servicios', así que
  // ganan solo para la ficha.
  {
    key: 'eutanasia-ficha', label: 'Ficha de eutanasia', grupo: 'operacion',
    descripcion: 'Abrir una eutanasia desde el dashboard y confirmar su resultado.',
    pages: ['/eutanasias'], apis: ['/api/eutanasias/ficha'],
    def: { general: 'editar', 'operario-n1': 'editar', 'operario-n2': 'editar' },
  },

  // ── Comercial y marketing ─────────────────────────────────────────────────
  {
    key: 'bases', label: 'Veterinarios (convenios)', grupo: 'comercial',
    descripcion: 'Clínicas en convenio, sus tarifas e informes.',
    pages: ['/bases'], apis: ['/api/veterinarios'],
    def: { general: 'editar', 'operario-n1': 'none', 'operario-n2': 'none' },
  },
  {
    key: 'servicios', label: 'Eutanasias a domicilio', grupo: 'comercial',
    descripcion: 'Cotizaciones, red de veterinarios y precios de eutanasia.',
    pages: ['/servicios'], apis: ['/api/eutanasias', '/api/servicios'],
    def: { general: 'editar', 'operario-n1': 'none', 'operario-n2': 'none' },
  },
  {
    key: 'mailing', label: 'Marketing', grupo: 'comercial',
    descripcion: 'Campañas, agente de marketing, calendario, embudo y Ads.',
    pages: ['/mailing'], apis: ['/api/mailing'],
    def: { general: 'editar', 'operario-n1': 'none', 'operario-n2': 'none' },
  },
  {
    key: 'web', label: 'Web (sitio público)', grupo: 'comercial',
    descripcion: 'Panel del sitio crematorioalmaanimal.cl: productos, blog y páginas.',
    pages: ['/web'], apis: ['/api/web'],
    def: { general: 'none', 'operario-n1': 'none', 'operario-n2': 'none' },
  },

  // ── Administración y finanzas ─────────────────────────────────────────────
  {
    key: 'rendiciones', label: 'Rendiciones', grupo: 'administracion',
    descripcion: 'Gastos del equipo, pagos y pago de retiros adicionales.',
    // /api/equipo = listado básico del equipo (para elegir de quién es el gasto).
    // Va acá porque /api/usuarios es Configuración Avanzada (solo el dueño).
    pages: ['/rendiciones'], apis: ['/api/rendiciones', '/api/equipo', '/api/pagos-retiros'],
    def: { general: 'editar', 'operario-n1': 'none', 'operario-n2': 'none' },
  },
  {
    key: 'facturacion', label: 'Facturación (SII)', grupo: 'administracion',
    descripcion: 'Boletas, facturas, notas de crédito y comisiones de convenio.',
    pages: ['/facturacion'], apis: ['/api/facturacion', '/api/comisiones'],
    def: { general: 'none', 'operario-n1': 'none', 'operario-n2': 'none' },
  },
  {
    key: 'eerr', label: 'Estado de Resultados', grupo: 'administracion',
    descripcion: 'EERR integral, compras del SII, partidas y proveedores.',
    pages: ['/estado-resultados'], apis: ['/api/eerr'],
    def: { general: 'editar', 'operario-n1': 'none', 'operario-n2': 'none' },
  },
  // Sueldos del equipo: dato sensible. Arranca cerrado para todos los perfiles
  // semilla (solo el dueño) y se abre desde el editor a quien corresponda.
  // Sus rutas no traen gate propio: dependen enteramente de este módulo.
  {
    key: 'remuneraciones', label: 'Remuneraciones', grupo: 'administracion',
    descripcion: 'Empleados, liquidaciones de sueldo, parámetros previsionales e histórico.',
    pages: ['/remuneraciones'], apis: ['/api/remuneraciones'],
    def: { general: 'none', 'operario-n1': 'none', 'operario-n2': 'none' },
  },
  {
    key: 'reportes', label: 'Reportes', grupo: 'administracion',
    descripcion: 'Exportables de ingresos, veterinarios y configuraciones.',
    pages: ['/reportes'], apis: ['/api/reportes'],
    def: { general: 'editar', 'operario-n1': 'none', 'operario-n2': 'none' },
  },

  // ── Configuración del sistema ─────────────────────────────────────────────
  {
    key: 'configuracion', label: 'Configuración', grupo: 'sistema',
    descripcion: 'Precios, artículos, especies, descuentos y jornada.',
    pages: ['/configuracion'],
    apis: ['/api/precios', '/api/productos', '/api/categorias-productos', '/api/especies', '/api/servicios', '/api/descuentos', '/api/tipos-servicio', '/api/jornada-config', '/api/empresa/informe'],
    def: { general: 'editar', 'operario-n1': 'none', 'operario-n2': 'none' },
  },
]

export const MODULOS_POR_KEY: Record<string, Modulo> = Object.fromEntries(MODULOS.map(m => [m.key, m]))

/** Nivel por defecto de un módulo para un perfil semilla. */
export function nivelPorDefecto(modulo: string, perfilSlug: string): Nivel {
  if (perfilSlug === PERFIL_ADMIN) return 'editar'
  const m = MODULOS_POR_KEY[modulo]
  if (!m) return 'none'
  return m.def[perfilSlug as PerfilBase] ?? 'none'
}

/** Config completa de un perfil semilla (para sembrar / resetear). */
export function permisosPorDefecto(perfilSlug: string): Record<string, Nivel> {
  const out: Record<string, Nivel> = {}
  for (const m of MODULOS) out[m.key] = nivelPorDefecto(m.key, perfilSlug)
  return out
}

// ─── Resolución de rutas ────────────────────────────────────────────────────

/** ¿La ruta pertenece a Configuración Avanzada (siempre solo admin)? */
export function esRutaAvanzada(pathname: string): boolean {
  return APIS_AVANZADAS.some(p => pathname === p || pathname.startsWith(p + '/') || pathname.startsWith(p))
}

function matchLen(pathname: string, prefijos?: string[]): number {
  let best = -1
  for (const p of prefijos || []) {
    if (pathname === p || pathname.startsWith(p + '/')) best = Math.max(best, p.length)
  }
  return best
}

interface Candidato { modulo: Modulo; len: number; soloLectura: boolean }

/**
 * Módulos de MÁXIMA especificidad que cubren la ruta (prefijo coincidente más
 * largo, para que /api/eutanasias/ficha gane sobre /api/eutanasias). Cada
 * candidato recuerda si el match vino de un prefijo de solo-lectura.
 */
function candidatos(pathname: string): Candidato[] {
  let best = -1
  let out: Candidato[] = []
  for (const m of MODULOS) {
    const plenos = Math.max(matchLen(pathname, m.pages), matchLen(pathname, m.apis))
    const lectura = matchLen(pathname, m.soloLectura)
    const len = Math.max(plenos, lectura)
    if (len < 0) continue
    const cand: Candidato = { modulo: m, len, soloLectura: lectura === len && plenos < len }
    if (len > best) { best = len; out = [cand] }
    else if (len === best) out.push(cand)
  }
  return out
}

/** Módulos que cubren la ruta (compat: solo las claves, sin el detalle). */
export function modulosDeRuta(pathname: string): Modulo[] {
  return candidatos(pathname).map(c => c.modulo)
}

// ─── Snapshot de permisos (leído de la base, cacheado) ──────────────────────

export interface PerfilRow { id: string; slug: string; nombre: string; activo: boolean }

export interface PermisosSnapshot {
  /** perfiles por id */
  perfiles: Record<string, PerfilRow>
  /** perfilId → módulo → nivel */
  porPerfil: Record<string, Record<string, Nivel>>
  /** usuarioId → módulo → nivel (excepción puntual, pisa al perfil) */
  porUsuario: Record<string, Record<string, Nivel>>
  /** Modelo viejo por rol; solo se usa si el usuario no tiene perfil. */
  legacy: Record<string, Record<string, Nivel>>
  /** false = la base todavía no tiene las tablas nuevas (se usa el legacy). */
  conPerfiles: boolean
}

const SNAPSHOT_VACIO: PermisosSnapshot = { perfiles: {}, porPerfil: {}, porUsuario: {}, legacy: {}, conPerfiles: false }

const TTL_MS = 5000 // cambios visibles en ~5s sin pegarle a la base en cada request
let cache: { data: PermisosSnapshot; exp: number } | null = null

async function rest<T>(url: string, key: string, path: string): Promise<T[] | null> {
  try {
    const res = await fetch(`${url}/rest/v1/${path}`, { headers: { apikey: key, Authorization: `Bearer ${key}` } })
    if (!res.ok) return null
    return (await res.json()) as T[]
  } catch {
    return null
  }
}

export async function getPermisosSnapshot(): Promise<PermisosSnapshot> {
  if (cache && Date.now() < cache.exp) return cache.data
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return SNAPSHOT_VACIO

  const [perfilesRows, permisosRows, usuarioRows, legacyRows] = await Promise.all([
    rest<{ id: string | number; slug: string; nombre: string; activo: string }>(url, key, 'perfiles?select=id,slug,nombre,activo'),
    rest<{ perfil_id: string | number; modulo: string; nivel: string }>(url, key, 'perfil_permisos?select=perfil_id,modulo,nivel'),
    rest<{ usuario_id: string | number; modulo: string; nivel: string }>(url, key, 'usuario_permisos?select=usuario_id,modulo,nivel'),
    rest<{ modulo: string; rol: string; permitido: string }>(url, key, 'permisos_modulos?select=modulo,rol,permitido'),
  ])

  const snap: PermisosSnapshot = {
    perfiles: {}, porPerfil: {}, porUsuario: {}, legacy: {},
    conPerfiles: Array.isArray(perfilesRows) && perfilesRows.length > 0,
  }

  for (const p of perfilesRows || []) {
    snap.perfiles[String(p.id)] = {
      id: String(p.id), slug: p.slug, nombre: p.nombre,
      activo: !/^(false|falso|0)$/i.test(String(p.activo ?? 'TRUE').trim()),
    }
  }
  for (const r of permisosRows || []) {
    const k = String(r.perfil_id)
    ;(snap.porPerfil[k] ||= {})[r.modulo] = normalizarNivel(r.nivel)
  }
  for (const r of usuarioRows || []) {
    const k = String(r.usuario_id)
    ;(snap.porUsuario[k] ||= {})[r.modulo] = normalizarNivel(r.nivel)
  }
  // Modelo viejo (booleano por rol) → nivel, solo como red de seguridad.
  for (const r of legacyRows || []) {
    const permitido = /^(true|verdadero|1)$/i.test((r.permitido || '').trim())
    ;(snap.legacy[r.rol] ||= {})[r.modulo] = permitido ? 'editar' : 'none'
  }

  cache = { data: snap, exp: Date.now() + TTL_MS }
  return snap
}

/** Invalida el cache (lo llama el editor tras guardar para acelerar el efecto). */
export function invalidarPermisosCache(): void {
  cache = null
}

// ─── Decisión ───────────────────────────────────────────────────────────────

/** Quién pregunta: sale del JWT (proxy) o de la sesión (route handlers). */
export interface Actor {
  rol?: string | null
  usuarioId?: string | null
  perfilId?: string | null
}

/** Nivel que el actor tiene sobre un módulo. */
export function nivelDeModulo(actor: Actor, modulo: string, snap: PermisosSnapshot): Nivel {
  if (actor.rol === 'admin') return 'editar'

  // 1) Excepción puntual de esta persona.
  const uid = actor.usuarioId ? String(actor.usuarioId) : ''
  const propio = uid ? snap.porUsuario[uid]?.[modulo] : undefined
  if (propio) return propio

  // 2) Su perfil.
  const pid = actor.perfilId ? String(actor.perfilId) : ''
  const perfil = pid ? snap.perfiles[pid] : undefined
  if (perfil) {
    if (!perfil.activo) return 'none'
    if (perfil.slug === PERFIL_ADMIN) return 'editar'
    const n = snap.porPerfil[pid]?.[modulo]
    if (n) return n
    // Módulo no configurado: los perfiles semilla caen a su default; los perfiles
    // creados a mano quedan cerrados hasta que se los marque explícitamente.
    return PERFILES_SISTEMA.includes(perfil.slug) ? nivelPorDefecto(modulo, perfil.slug) : 'none'
  }

  // 3) Sin perfil (o base sin migrar): modelo viejo por rol.
  const rol = actor.rol || 'operador'
  const legacy = snap.legacy[rol]?.[modulo]
  if (legacy) return legacy
  return nivelPorDefecto(modulo, perfilDeRol(rol))
}

/**
 * ¿El actor puede ejecutar `method` sobre `pathname`?
 *
 * Reglas:
 *  - Ruta sin módulo → solo el admin (fail-closed: una API nueva sin registrar no
 *    queda abierta por accidente; antes se le abría a admin2).
 *  - Entre módulos igual de específicos alcanza con que UNO conceda el nivel.
 *  - Un match que vino de `soloLectura` nunca alcanza para escribir.
 */
export function puedeAcceder(actor: Actor, pathname: string, method: string, snap: PermisosSnapshot): boolean {
  if (actor.rol === 'admin') return true
  const cands = candidatos(pathname)
  if (cands.length === 0) return false
  return cands.some(c => {
    const requerido: Nivel = matchLen(pathname, c.modulo.postLectura) >= 0 && method.toUpperCase() === 'POST'
      ? 'ver'
      : nivelDeMetodo(method)
    if (c.soloLectura && requerido !== 'ver') return false
    return alcanza(nivelDeModulo(actor, c.modulo.key, snap), requerido)
  })
}

/** Niveles del actor módulo por módulo (para el sidebar y la UI). */
export function nivelesDeActor(actor: Actor, snap: PermisosSnapshot): Record<string, Nivel> {
  const out: Record<string, Nivel> = {}
  for (const m of MODULOS) out[m.key] = nivelDeModulo(actor, m.key, snap)
  return out
}

/**
 * Rol legacy que le corresponde a un perfil, derivado de sus permisos.
 *
 * ⚠️ Transitorio. Todavía hay ~89 route handlers que deciden con `esAdmin(rol)` en
 * vez de consultar el módulo (ver lib/permisos-server). Mientras eso exista, el
 * `usuarios.rol` se mantiene sincronizado con el perfil para que esas rutas se
 * comporten igual que antes: un perfil que administra (finanzas, marketing,
 * convenios, configuración…) necesita el rol amplio; uno puramente operativo no,
 * porque varias pantallas usan ese rol para distinguir supervisor de operario
 * (Asistencia muestra solo lo propio, Retiros adicionales aprueba, etc.).
 *
 * El gateo REAL lo hace el módulo (proxy + permisos-server); esto es solo para que
 * las rutas sin migrar no queden más permisivas ni más restrictivas de la cuenta.
 * Cuando se migren todas, esta función y el campo `rol` se pueden borrar.
 */
/**
 * Módulos INEQUÍVOCAMENTE administrativos. Deliberadamente NO incluye `bases`,
 * `servicios` ni `mensajes`: hoy el Operario Nivel 2 los tiene en `editar`, y
 * meterlos acá lo ascendería a `admin2` — con eso Asistencia le mostraría la
 * jornada de TODO el equipo y podría aprobar retiros. La regla es conservadora a
 * propósito: ante la duda, el rol legacy queda BAJO (deniega de más, nunca de
 * menos), y lo que falte se resuelve migrando el handler a `puedeNivel`.
 *
 * Efecto conocido de esa elección: un perfil con `bases: editar` pero sin ningún
 * módulo administrativo no puede bajar los informes de veterinaria en PDF/Excel
 * (`/api/veterinarios/[id]/informe/*` todavía gatea con `esAdmin`). Se destraba
 * migrando esos dos handlers.
 */
const MODULOS_ADMINISTRATIVOS = ['rendiciones', 'eerr', 'facturacion', 'mailing', 'web', 'reportes', 'configuracion', 'remuneraciones']

export function rolBaseDePerfil(permisos: Record<string, Nivel>, slug?: string): string {
  if (slug === PERFIL_ADMIN) return 'admin'
  return MODULOS_ADMINISTRATIVOS.some(k => permisos[k] === 'editar') ? 'admin2' : 'operador'
}

/**
 * Clase del rol legacy: es lo que miran `esAdmin`/`esAdminTotal`. `operador` y
 * `operador2` son la MISMA clase — se distinguen solo por su perfil, así que la
 * sincronización no debe convertir uno en otro (perdería el Nivel 2).
 */
export function claseDeRol(rol?: string | null): 'admin' | 'admin2' | 'operador' {
  if (rol === 'admin') return 'admin'
  if (rol === 'admin2') return 'admin2'
  return 'operador'
}

/** Claves de módulos que el actor puede al menos VER (para el sidebar). */
export function modulosPermitidos(actor: Actor, snap: PermisosSnapshot): Set<string> {
  if (actor.rol === 'admin') return new Set(MODULOS.map(m => m.key))
  return new Set(MODULOS.filter(m => alcanza(nivelDeModulo(actor, m.key, snap), 'ver')).map(m => m.key))
}
