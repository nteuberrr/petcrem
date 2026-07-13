import { appendRow, getNextId, ensureColumns } from './datastore'
import { todayISO } from './dates'
import { capitalizarNombre } from './nombres'

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
  /** HH:MM — junto con la fecha determina el recargo "fuera de horario". */
  hora_retiro?: string
  peso_declarado?: string | number
  /** CI | CP | SD si el cliente ya eligió. */
  codigo_servicio?: string
  /** 'bot_retiro' | 'bot_eutanasia' | 'bot_vet'. */
  origen: string
  /** Id del veterinario de convenio (hoja `veterinarios`) que originó el retiro. */
  veterinaria_id?: string
  /** Snapshot del tipo de precios del vet ('convenio' | 'especial'); default 'general'. */
  tipo_precios?: string
  notas?: string
}

/** Nombre legible de cada tipo de servicio — el que se persiste en clientes.tipo_servicio. */
export const NOMBRE_SERVICIO: Record<string, string> = {
  CI: 'Cremación Individual',
  CP: 'Cremación Premium',
  SD: 'Cremación Sin Devolución',
}

/** Crea un cliente borrador (sin código) y devuelve su id. */
export async function crearClienteBorrador(d: BorradorInput): Promise<string> {
  await ensureColumns('clientes', ['email', 'telefono', 'origen', 'notas', 'tipo_precios', 'estado_pago', 'veterinaria_id', 'hora_retiro'])
  const id = await getNextId('clientes')
  // Para retiros de VET no guardamos el teléfono del vet en la ficha: así el
  // anti-duplicado por teléfono (bloqueFichaEnProceso) no bloquea a un vet que
  // agenda varios retiros distintos. Su contacto vive en `veterinarios`.
  const esVet = d.origen === 'bot_vet'
  const tel = esVet ? '' : (d.telefono || '').replace(/\D/g, '').slice(-9)
  const dir = d.direccion_retiro ?? ''
  await appendRow('clientes', {
    id,
    codigo: '',
    nombre_mascota: capitalizarNombre(d.nombre_mascota),
    nombre_tutor: capitalizarNombre(d.nombre_tutor),
    email: d.email ?? '',
    telefono: tel,
    direccion_retiro: dir,
    direccion_despacho: dir,
    misma_direccion: 'TRUE',
    comuna: d.comuna ?? '',
    fecha_retiro: d.fecha_retiro ?? '',
    hora_retiro: d.hora_retiro ?? '',
    peso_declarado: d.peso_declarado != null && d.peso_declarado !== '' ? String(d.peso_declarado) : '',
    tipo_servicio: NOMBRE_SERVICIO[(d.codigo_servicio || '').toUpperCase()] ?? '',
    codigo_servicio: d.codigo_servicio ?? '',
    estado: 'borrador',
    veterinaria_id: d.veterinaria_id ?? '',
    tipo_precios: d.tipo_precios || 'general',
    estado_pago: 'pendiente',
    origen: d.origen,
    notas: d.notas ?? '',
    fecha_creacion: todayISO(),
  })
  return String(id)
}
