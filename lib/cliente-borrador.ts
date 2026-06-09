import { appendRow, getNextId, ensureColumns } from './datastore'
import { todayISO } from './dates'

// ─────────────────────────────────────────────────────────────────────────────
// Cliente "borrador" (estado='borrador', sin código). Lo crea el bot al agendar
// (retiro confirmado por el admin / eutanasia), cuando todavía NO tenemos todos
// los datos para generar un código. Aparece en /clientes como "Por ingresar";
// el equipo completa la ficha y al "Registrar" recién se genera el código.
//
// Se comparte entre el webhook de WhatsApp (Flujo A) y el alta de eutanasia.
// ─────────────────────────────────────────────────────────────────────────────

export interface BorradorInput {
  nombre_tutor?: string
  nombre_mascota?: string
  /** Teléfono o wa_id (se normaliza a 9 dígitos). */
  telefono?: string
  email?: string
  direccion_retiro?: string
  comuna?: string
  fecha_retiro?: string
  peso_declarado?: string | number
  /** CI | CP | SD si el cliente ya eligió. */
  codigo_servicio?: string
  /** 'bot_retiro' | 'bot_eutanasia'. */
  origen: string
  notas?: string
}

/** Crea un cliente borrador (sin código) y devuelve su id. */
export async function crearClienteBorrador(d: BorradorInput): Promise<string> {
  await ensureColumns('clientes', ['email', 'telefono', 'origen', 'notas', 'tipo_precios', 'estado_pago'])
  const id = await getNextId('clientes')
  const tel = (d.telefono || '').replace(/\D/g, '').slice(-9)
  const dir = d.direccion_retiro ?? ''
  await appendRow('clientes', {
    id,
    codigo: '',
    nombre_mascota: d.nombre_mascota ?? '',
    nombre_tutor: d.nombre_tutor ?? '',
    email: d.email ?? '',
    telefono: tel,
    direccion_retiro: dir,
    direccion_despacho: dir,
    misma_direccion: 'TRUE',
    comuna: d.comuna ?? '',
    fecha_retiro: d.fecha_retiro ?? '',
    peso_declarado: d.peso_declarado != null && d.peso_declarado !== '' ? String(d.peso_declarado) : '',
    tipo_servicio: d.codigo_servicio ?? '',
    codigo_servicio: d.codigo_servicio ?? '',
    estado: 'borrador',
    tipo_precios: 'general',
    estado_pago: 'pendiente',
    origen: d.origen,
    notas: d.notas ?? '',
    fecha_creacion: todayISO(),
  })
  return String(id)
}
