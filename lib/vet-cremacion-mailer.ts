import { sendEmail, isResendConfigured, type SendOpts } from './resend-mailer'
import { renderEmailLayout, getContacto, escapeHtml, BRAND, type Contacto } from './email-layout'
import { getSheetData } from './datastore'

/**
 * Correos transaccionales al VETERINARIO DE CONVENIO (cremación B2B), enganchados
 * en los cuatro hitos del proceso cuando la ficha tiene un veterinario asociado
 * (clientes.veterinaria_id, hoja `veterinarios`):
 *
 *  1. Confirmación del retiro (al confirmar la solicitud del bot)  → enviarRetiroConfirmadoVet
 *  2. Registro de la ficha + código                               → enviarCodigoVet
 *  3. Inicio de la ruta de despacho                               → enviarInicioRutaVet
 *  4. Entrega del ánfora                                          → enviarEntregaVet
 *
 * Voz B2B: profesional, eficiente, de socio confiable (menos adornos emocionales
 * que los correos al tutor). Igual a la mascota la nombramos por su nombre.
 * Reutiliza el layout visual compartido (lib/email-layout.ts).
 *
 * Best-effort: si Resend no está configurado o el envío falla, se loggea pero NO
 * rompe la operación principal. Estos correos NO se registran en correos_cliente
 * (esa tabla es del tutor); se taguean en Resend (tipo=vet_cremacion_*).
 */

export interface VetCorreoArgs {
  /** Correo del veterinario (veterinarios.correo). */
  email: string
  /** Nombre de la clínica/veterinaria (veterinarios.nombre). */
  vetNombre: string
  /** Persona de contacto, si la hay (veterinarios.nombre_contacto). */
  contacto?: string
  nombreMascota: string
  /** Código de la mascota (en código/inicio ruta/entrega). */
  codigo?: string
  /** Fecha ya formateada DD/MM/YYYY (confirmación de retiro). */
  fecha?: string
  /** Hora HH:MM (confirmación de retiro). */
  hora?: string
}

/** Saludo B2B: "Hola Dra. X," / "Hola equipo de Clínica," / "Hola,". */
function saludoVet(args: VetCorreoArgs): string {
  const c = (args.contacto || '').trim()
  if (c) return `Hola <strong>${escapeHtml(c)}</strong>,`
  const v = (args.vetNombre || '').trim()
  return v ? `Hola equipo de <strong>${escapeHtml(v)}</strong>,` : 'Hola,'
}

function cajaCodigo(mascota: string, codigo: string): string {
  return `
      <div style="background:${BRAND.cream};border:1px solid ${BRAND.hairline};border-radius:12px;padding:20px;margin:18px 0;text-align:center">
        <p style="margin:0 0 6px;font-size:12px;text-transform:uppercase;letter-spacing:1.5px;color:${BRAND.muted}">Código de seguimiento de ${mascota}</p>
        <p style="margin:0;font-size:28px;font-weight:700;letter-spacing:1px;color:${BRAND.navy}">${escapeHtml(codigo)}</p>
      </div>`
}

// ─── 0. Bienvenida al convenio (al registrar una veterinaria nueva) ───────────

export interface BienvenidaConvenioArgs {
  /** Correo destinatario (en producción = correo de la veterinaria). */
  email: string
  /** Nombre de la veterinaria/clínica (veterinarios.nombre). */
  vetNombre: string
  contacto?: string
  cargoContacto?: string
  razonSocial?: string
  rut?: string
  giro?: string
  direccion?: string
  comuna?: string
  telefono?: string
  /** Correo a MOSTRAR en la tabla de datos; default = email. (Útil en pruebas.) */
  correoMostrar?: string
}

/** Fila de la tabla de datos; se omite si el valor está vacío. */
function filaDato(label: string, valor?: string): string {
  const v = (valor || '').trim()
  if (!v) return ''
  return `
        <tr>
          <td style="padding:7px 14px 7px 0;font-size:13px;color:${BRAND.muted};white-space:nowrap;vertical-align:top">${escapeHtml(label)}</td>
          <td style="padding:7px 0;font-size:14px;color:${BRAND.navy};font-weight:600">${escapeHtml(v)}</td>
        </tr>`
}

export function buildBienvenidaConvenioVet(args: BienvenidaConvenioArgs, contacto: Contacto): SendOpts {
  const saludo = args.contacto?.trim()
    ? `Hola <strong>${escapeHtml(args.contacto.trim())}</strong>,`
    : (args.vetNombre?.trim() ? `Hola equipo de <strong>${escapeHtml(args.vetNombre.trim())}</strong>,` : 'Hola,')
  const contactoLinea = args.contacto ? `${args.contacto}${args.cargoContacto ? ` — ${args.cargoContacto}` : ''}` : ''
  const filas = [
    filaDato('Veterinaria', args.vetNombre),
    filaDato('Razón social', args.razonSocial),
    filaDato('RUT', args.rut),
    filaDato('Giro', args.giro),
    filaDato('Dirección', args.direccion),
    filaDato('Comuna', args.comuna),
    filaDato('Teléfono', args.telefono),
    filaDato('Correo', args.correoMostrar || args.email),
    filaDato('Contacto', contactoLinea),
  ].filter(Boolean).join('')
  const cuerpo = `
      <p style="margin:0 0 14px;font-size:15px">${saludo}</p>
      <p style="margin:0 0 16px;font-size:14px;line-height:1.6">
        ¡Bienvenidos al <strong>convenio de Crematorio Alma Animal</strong>! Estamos muy contentos de comenzar a trabajar junto a ustedes.
      </p>
      <p style="margin:0 0 12px;font-size:14px;line-height:1.6">
        Ingresamos su veterinaria en nuestras bases con los siguientes datos. Si necesita corregir o actualizar alguno, solo <strong>responda a este mismo correo</strong> y lo ajustamos:
      </p>
      <div style="background:${BRAND.cream};border:1px solid ${BRAND.hairline};border-radius:12px;padding:14px 20px;margin:6px 0 18px">
        <table style="width:100%;border-collapse:collapse">${filas}</table>
      </div>
      <p style="margin:0;font-size:14px;line-height:1.6">
        Agradecemos su preferencia y la confianza en nosotros. Quedamos atentos a cualquier consulta y con muchas ganas de cuidar, como corresponde, a las mascotas que nos deriven.
      </p>`
  return {
    to: args.email,
    subject: 'Bienvenidos al convenio — Crematorio Alma Animal',
    html: renderEmailLayout({ titulo: 'Bienvenidos al convenio', bodyHtml: cuerpo, contacto, contexto: 'Convenio veterinarios' }),
    preview_text: 'Ingresamos su veterinaria al convenio. Confirme o corrija sus datos respondiendo este correo.',
    tags: [{ name: 'tipo', value: 'vet_convenio_bienvenida' }],
    seguimiento: { tipo: 'vet_convenio_bienvenida', audiencia: 'Veterinario', nombre: args.vetNombre },
  }
}

/** Envía la bienvenida al convenio (best-effort). */
export async function enviarBienvenidaConvenioVet(args: BienvenidaConvenioArgs): Promise<void> {
  if (!args.email) return
  if (!isResendConfigured()) {
    console.warn('[vet-mailer] Resend no configurado, salto bienvenida convenio a', args.email)
    return
  }
  const contacto = await getContacto()
  try {
    const res = await sendEmail(buildBienvenidaConvenioVet(args, contacto))
    if (res.ok) console.log(`[vet-mailer] OK bienvenida convenio a ${args.email}, message_id=${res.message_id}`)
    else console.error(`[vet-mailer] FAIL bienvenida convenio a ${args.email}: ${res.error}`)
  } catch (e) {
    console.error(`[vet-mailer] EXC bienvenida convenio a ${args.email}:`, e instanceof Error ? e.message : String(e))
  }
}

// ─── 1. Confirmación del retiro ───────────────────────────────────────────────

export function buildRetiroConfirmadoVet(args: VetCorreoArgs, contacto: Contacto): SendOpts {
  const mascota = escapeHtml(args.nombreMascota)
  const cuando = args.fecha ? ` para el <strong>${escapeHtml(args.fecha)}</strong>${args.hora ? ` a las <strong>${escapeHtml(args.hora)}</strong>` : ''}` : ''
  const cuerpo = `
      <p style="margin:0 0 14px;font-size:15px">${saludoVet(args)}</p>
      <p style="margin:0 0 16px;font-size:14px;line-height:1.6">
        Confirmamos que agendamos el retiro de <strong>${mascota}</strong>${cuando}.
        Pasaremos a retirarla en nuestro vehículo habilitado y la cuidaremos con el respeto que corresponde.
      </p>
      <p style="margin:0;font-size:14px;line-height:1.6">
        Te mantendremos al tanto en cada etapa del proceso. Gracias por tu preferencia y por confiar en nosotros.
      </p>`
  return {
    to: args.email,
    subject: `Retiro agendado — ${args.nombreMascota}`,
    html: renderEmailLayout({ titulo: 'Retiro agendado', bodyHtml: cuerpo, contacto, contexto: 'Convenio veterinarios' }),
    preview_text: `Agendamos el retiro de ${args.nombreMascota}.`,
    tags: [{ name: 'tipo', value: 'vet_cremacion_retiro' }],
    seguimiento: { tipo: 'vet_cremacion_retiro', audiencia: 'Veterinario', nombre: args.nombreMascota },
  }
}

export async function enviarRetiroConfirmadoVet(args: VetCorreoArgs): Promise<void> {
  await enviarVet(args, buildRetiroConfirmadoVet, 'retiro confirmado')
}

// ─── 2. Registro de la ficha + código ─────────────────────────────────────────

export function buildCodigoVet(args: VetCorreoArgs, contacto: Contacto): SendOpts {
  const mascota = escapeHtml(args.nombreMascota)
  const caja = args.codigo ? cajaCodigo(mascota, args.codigo) : ''
  const cuerpo = `
      <p style="margin:0 0 14px;font-size:15px">${saludoVet(args)}</p>
      <p style="margin:0 0 16px;font-size:14px;line-height:1.6">
        Ya ingresamos a <strong>${mascota}</strong> en nuestro proceso de cremación.
      </p>
      ${caja}
      <p style="margin:0;font-size:14px;line-height:1.6">
        Con este código pueden hacer seguimiento del servicio. Te avisaremos cuando el ánfora salga en ruta y al momento de la entrega.
      </p>`
  return {
    to: args.email,
    subject: `Código de seguimiento — ${args.nombreMascota}`,
    html: renderEmailLayout({ titulo: 'Ingresamos a la mascota al proceso', bodyHtml: cuerpo, contacto, contexto: 'Convenio veterinarios' }),
    preview_text: `Código de seguimiento de ${args.nombreMascota}.`,
    tags: [{ name: 'tipo', value: 'vet_cremacion_codigo' }],
    seguimiento: { tipo: 'vet_cremacion_codigo', audiencia: 'Veterinario', nombre: args.nombreMascota, codigo: args.codigo },
  }
}

export async function enviarCodigoVet(args: VetCorreoArgs): Promise<void> {
  await enviarVet(args, buildCodigoVet, 'código')
}

// ─── 3. Inicio de la ruta de despacho ─────────────────────────────────────────

export function buildInicioRutaVet(args: VetCorreoArgs, contacto: Contacto): SendOpts {
  const mascota = escapeHtml(args.nombreMascota)
  const mascotaCodigo = args.codigo ? `${mascota} (${escapeHtml(args.codigo)})` : mascota
  const cuerpo = `
      <p style="margin:0 0 14px;font-size:15px">${saludoVet(args)}</p>
      <p style="margin:0 0 16px;font-size:14px;line-height:1.6">
        Iniciamos la ruta de entrega del ánfora de <strong>${mascotaCodigo}</strong>.
        Llegará a destino dentro de las próximas horas.
      </p>
      <p style="margin:0;font-size:14px;line-height:1.6">
        Te confirmaremos apenas se concrete la entrega.
      </p>`
  return {
    to: args.email,
    subject: `${args.nombreMascota} va en camino`,
    html: renderEmailLayout({ titulo: 'El ánfora va en camino', bodyHtml: cuerpo, contacto, contexto: 'Convenio veterinarios' }),
    preview_text: `El ánfora de ${args.nombreMascota} salió en ruta.`,
    tags: [{ name: 'tipo', value: 'vet_cremacion_ruta' }],
    seguimiento: { tipo: 'vet_cremacion_ruta', audiencia: 'Veterinario', nombre: args.nombreMascota, codigo: args.codigo },
  }
}

export async function enviarInicioRutaVet(args: VetCorreoArgs): Promise<void> {
  await enviarVet(args, buildInicioRutaVet, 'inicio ruta')
}

// ─── 4. Entrega del ánfora ────────────────────────────────────────────────────

export function buildEntregaVet(args: VetCorreoArgs, contacto: Contacto): SendOpts {
  const mascota = escapeHtml(args.nombreMascota)
  const mascotaCodigo = args.codigo ? `${mascota} (${escapeHtml(args.codigo)})` : mascota
  const cuerpo = `
      <p style="margin:0 0 14px;font-size:15px">${saludoVet(args)}</p>
      <p style="margin:0 0 16px;font-size:14px;line-height:1.6">
        Confirmamos la entrega del ánfora de <strong>${mascotaCodigo}</strong>.
        Fue un honor acompañar este proceso junto a ustedes.
      </p>
      <p style="margin:0;font-size:14px;line-height:1.6">
        Gracias por confiar en nosotros y por preferirnos.
      </p>`
  return {
    to: args.email,
    subject: `Entrega confirmada — ${args.nombreMascota}`,
    html: renderEmailLayout({ titulo: 'Entrega confirmada', bodyHtml: cuerpo, contacto, contexto: 'Convenio veterinarios' }),
    preview_text: `El ánfora de ${args.nombreMascota} fue entregada.`,
    tags: [{ name: 'tipo', value: 'vet_cremacion_entrega' }],
    seguimiento: { tipo: 'vet_cremacion_entrega', audiencia: 'Veterinario', nombre: args.nombreMascota, codigo: args.codigo },
  }
}

export async function enviarEntregaVet(args: VetCorreoArgs): Promise<void> {
  await enviarVet(args, buildEntregaVet, 'entrega')
}

// ─── resolución del veterinario asociado a una ficha ──────────────────────────

export interface VetContacto {
  email: string
  /** Nombre de la clínica/veterinaria. */
  vetNombre: string
  /** Persona de contacto, si la hay. */
  contacto: string
}

/**
 * Dado el `veterinaria_id` de una ficha, devuelve los datos del vet para enviarle
 * un correo del ciclo. null si no hay vet, no existe, o no tiene correo. Acepta un
 * arreglo de filas de `veterinarios` ya leído (para no releer la hoja N veces).
 */
export async function resolverVet(
  veterinariaId: string | undefined,
  vetsRows?: Record<string, string>[],
): Promise<VetContacto | null> {
  const id = (veterinariaId || '').trim()
  if (!id) return null
  try {
    const vets = vetsRows ?? await getSheetData('veterinarios')
    const v = vets.find(r => r.id === id)
    if (!v || !v.correo) return null
    return { email: v.correo, vetNombre: v.nombre || '', contacto: v.nombre_contacto || '' }
  } catch {
    return null
  }
}

// ─── helper de envío best-effort ──────────────────────────────────────────────

async function enviarVet(
  args: VetCorreoArgs,
  build: (a: VetCorreoArgs, c: Contacto) => SendOpts,
  etiqueta: string,
): Promise<void> {
  if (!args.email) return
  if (!isResendConfigured()) {
    console.warn(`[vet-mailer] Resend no configurado, salto mail ${etiqueta} a`, args.email)
    return
  }
  const contacto = await getContacto()
  try {
    const res = await sendEmail(build(args, contacto))
    if (res.ok) console.log(`[vet-mailer] OK ${etiqueta} a ${args.email}, message_id=${res.message_id}`)
    else console.error(`[vet-mailer] FAIL ${etiqueta} a ${args.email}: ${res.error}`)
  } catch (e) {
    console.error(`[vet-mailer] EXC ${etiqueta} a ${args.email}:`, e instanceof Error ? e.message : String(e))
  }
}
