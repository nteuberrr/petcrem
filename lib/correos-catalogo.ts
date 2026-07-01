import { type Contacto } from './email-layout'
import { todayISO, formatDate } from './dates'
import {
  buildRegistro, buildCremacion, buildDespacho, buildEntrega, buildCertificado,
} from './cliente-mailer'
import {
  renderBienvenida, renderCotizacionEmail, renderCoordinarEmail,
  renderRealizarServicio, renderAgradecimiento, renderClienteVetAsignado,
} from './eutanasia-mailer'
import { renderInformeFacturacionEmail } from './informe-mailer'
import {
  buildRetiroConfirmadoVet, buildCodigoVet, buildInicioRutaVet, buildEntregaVet,
  buildBienvenidaConvenioVet,
} from './vet-cremacion-mailer'

// ─────────────────────────────────────────────────────────────────────────────
// Catálogo central de TODOS los correos transaccionales. Es la única fuente para
// previsualizarlos en Configuración → Correos y enviar pruebas. Cada correo
// referencia su render real (build*/render* de los mailers) — NO se duplica HTML.
//
// ⚠️ Al crear un correo transaccional nuevo: exporta su render desde el mailer
// correspondiente y AGRÉGALO acá, así queda visible/probable desde Configuración.
// ─────────────────────────────────────────────────────────────────────────────

/** Datos de muestra para renderizar los correos (del último cliente real). */
export interface MuestraCorreo {
  nombreMascota: string
  nombreTutor: string
  codigo: string
  email: string
  fechaCremacion: string
}

export interface CorreoRender {
  subject: string
  html: string
}

export interface CorreoDef {
  key: string
  /** Título legible que se muestra en la lista. */
  titulo: string
  /** Módulo donde está implementado (para agrupar). */
  modulo: string
  /** A quién va dirigido. */
  audiencia: 'Tutor' | 'Veterinario'
  /** Breve descripción de cuándo se envía. */
  cuando: string
  build: (m: MuestraCorreo, contacto: Contacto) => CorreoRender
}

/** Cotización de muestra para los correos de eutanasia. */
function cMuestra(m: MuestraCorreo): Record<string, string> {
  return {
    id: '0',
    mascota_nombre: m.nombreMascota,
    especie: 'Perro',
    peso: '8',
    cliente_nombre: m.nombreTutor,
    cliente_telefono: '912345678',
    cliente_email: m.email,
    direccion: 'Av. Siempre Viva 742',
    comuna: 'Providencia',
    fecha_servicio: todayISO(),
    hora_servicio: '16:00',
    notas: 'Mascota mayor, tranquila.',
    precio_snapshot: '70000',
  }
}

const VET_MUESTRA = 'Dra. Camila Rojas'
const VET_TEL_MUESTRA = '912345678'

export const CORREOS: CorreoDef[] = [
  // ── Clientes (tutores) ──────────────────────────────────────────────────────
  {
    key: 'cliente_registro',
    titulo: 'Registro de mascota (código + subir foto)',
    modulo: 'Clientes',
    audiencia: 'Tutor',
    cuando: 'Al crear la ficha de la mascota.',
    build: (m, c) => pick(buildRegistro({ email: m.email, nombreMascota: m.nombreMascota, nombreTutor: m.nombreTutor, codigo: m.codigo, clienteId: '0' }, c)),
  },
  {
    key: 'cliente_registro_premium',
    titulo: 'Registro Premium (código + foto certificado + foto cuadro + video)',
    modulo: 'Clientes',
    audiencia: 'Tutor',
    cuando: 'Al crear la ficha de un servicio Premium (CP): pide además la foto para el cuadro.',
    build: (m, c) => pick(buildRegistro({ email: m.email, nombreMascota: m.nombreMascota, nombreTutor: m.nombreTutor, codigo: m.codigo, clienteId: '0', codigoServicio: 'CP' }, c)),
  },
  {
    key: 'cliente_inicio_cremacion',
    titulo: 'Inicio del proceso de cremación',
    modulo: 'Clientes',
    audiencia: 'Tutor',
    cuando: 'Al iniciar el ciclo de cremación.',
    build: (m, c) => pick(buildCremacion({ email: m.email, nombreMascota: m.nombreMascota, nombreTutor: m.nombreTutor }, c)),
  },
  {
    key: 'cliente_inicio_despacho',
    titulo: 'Ánfora en camino (inicio de despacho)',
    modulo: 'Clientes',
    audiencia: 'Tutor',
    cuando: 'Al iniciar la ruta de despacho.',
    build: (m, c) => pick(buildDespacho({ email: m.email, nombreMascota: m.nombreMascota, nombreTutor: m.nombreTutor }, c)),
  },
  {
    key: 'cliente_entrega',
    titulo: 'Entrega confirmada + reseña de Google',
    modulo: 'Clientes',
    audiencia: 'Tutor',
    cuando: 'Al marcar la mascota como entregada.',
    build: (m, c) => pick(buildEntrega({ email: m.email, nombreMascota: m.nombreMascota, nombreTutor: m.nombreTutor, codigo: m.codigo }, c)),
  },
  {
    key: 'cliente_certificado',
    titulo: 'Certificado de cremación (PDF / video)',
    modulo: 'Clientes',
    audiencia: 'Tutor',
    cuando: 'Al enviar el certificado por correo.',
    build: (m, c) => pick(buildCertificado({ email: m.email, nombreMascota: m.nombreMascota, nombreTutor: m.nombreTutor, fechaCremacion: m.fechaCremacion, conVideo: false }, c)),
  },

  // ── Eutanasias a domicilio (en orden del flujo) ──────────────────────────────
  {
    key: 'eutanasia_bienvenida_vet',
    titulo: 'Bienvenida al veterinario del convenio',
    modulo: 'Eutanasias',
    audiencia: 'Veterinario',
    cuando: 'Cuando un vet se inscribe al convenio.',
    build: (m, c) => ({
      subject: 'Bienvenido al convenio de eutanasias - Alma Animal',
      html: renderBienvenida({ nombreCompleto: VET_MUESTRA, baseUrl: baseUrl(), linkDatosPago: '#', contacto: c }),
    }),
  },
  {
    key: 'eutanasia_cotizacion',
    titulo: 'Nueva solicitud de eutanasia al vet',
    modulo: 'Eutanasias',
    audiencia: 'Veterinario',
    cuando: 'Al enviar una cotización a la red.',
    build: (m, c) => {
      const cot = cMuestra(m)
      return {
        subject: `Solicitud de eutanasia en ${cot.comuna} — ${formatDate(cot.fecha_servicio)} ${cot.hora_servicio}`,
        html: renderCotizacionEmail({ vetNombre: VET_MUESTRA, c: cot, linkAceptar: '#', linkDatosPago: '#', contacto: c }),
      }
    },
  },
  {
    key: 'eutanasia_cliente_vet_asignado',
    titulo: 'Aviso al tutor: un veterinario tomó el caso',
    modulo: 'Eutanasias',
    audiencia: 'Tutor',
    cuando: 'Cuando un vet acepta la cotización (en paralelo se le avisa al tutor).',
    build: (m, c) => ({
      subject: `Un veterinario confirmó la atención de ${m.nombreMascota}`,
      html: renderClienteVetAsignado({
        clienteEmail: m.email, clienteNombre: m.nombreTutor, mascotaNombre: m.nombreMascota,
        vetNombre: VET_MUESTRA, vetTelefono: VET_TEL_MUESTRA, fechaServicio: m.fechaCremacion, horaServicio: '16:00',
      }, c),
    }),
  },
  {
    key: 'eutanasia_coordinar',
    titulo: 'Coordina con la familia (post-aceptación)',
    modulo: 'Eutanasias',
    audiencia: 'Veterinario',
    cuando: 'Cuando el vet acepta y debe contactar a la familia.',
    build: (m, c) => ({
      subject: `Coordina con la familia — Eutanasia ${m.nombreMascota}`,
      html: renderCoordinarEmail({ vetNombre: VET_MUESTRA, c: cMuestra(m), linkConfirmar: '#', linkDatosPago: '#', contacto: c }),
    }),
  },
  {
    key: 'eutanasia_realizar',
    titulo: 'Confirma cuando realices el servicio',
    modulo: 'Eutanasias',
    audiencia: 'Veterinario',
    cuando: 'Tras coordinar, para que confirme la realización.',
    build: (m, c) => ({
      subject: `Confirma cuando termines el servicio — ${m.nombreMascota}`,
      html: renderRealizarServicio({
        vetEmail: m.email, vetNombre: VET_MUESTRA,
        cotizacion: { id: '0', mascota_nombre: m.nombreMascota, cliente_nombre: m.nombreTutor, cliente_telefono: '912345678', fecha_servicio: m.fechaCremacion, hora_servicio: '16:00', direccion: 'Av. Siempre Viva 742', comuna: 'Providencia', precio_snapshot: '70000' },
        linkRealizado: '#',
      }, c),
    }),
  },
  {
    key: 'eutanasia_agradecimiento',
    titulo: 'Agradecimiento + pago al veterinario',
    modulo: 'Eutanasias',
    audiencia: 'Veterinario',
    cuando: 'Cuando el vet marca el servicio como realizado.',
    build: (m, c) => ({
      subject: '¡Gracias por tu trabajo! Tu pago está coordinado',
      html: renderAgradecimiento({
        vetEmail: m.email, vetNombre: VET_MUESTRA,
        cotizacion: { id: '0', mascota_nombre: m.nombreMascota, precio_snapshot: '70000' },
        fechaRealizacionISO: todayISO(),
      }, c),
    }),
  },

  // ── Convenio de cremación (al veterinario asociado a la ficha) ───────────────
  {
    key: 'vet_convenio_bienvenida',
    titulo: 'Bienvenida al convenio (nueva veterinaria)',
    modulo: 'Convenio cremación',
    audiencia: 'Veterinario',
    cuando: 'Al registrar una nueva veterinaria en convenio.',
    build: (m, c) => pick(buildBienvenidaConvenioVet({
      email: m.email, vetNombre: 'Veterinaria San Francisco', contacto: VET_MUESTRA, cargoContacto: 'Administradora',
      razonSocial: 'Clínica Veterinaria San Francisco SpA', rut: '76.123.456-7', giro: 'Servicios veterinarios',
      direccion: 'Av. Siempre Viva 742', comuna: 'Providencia', telefono: '912345678',
    }, c)),
  },
  {
    key: 'vet_cremacion_retiro',
    titulo: 'Retiro agendado (al veterinario)',
    modulo: 'Convenio cremación',
    audiencia: 'Veterinario',
    cuando: 'Al confirmar un retiro agendado por el veterinario.',
    build: (m, c) => pick(buildRetiroConfirmadoVet({ email: m.email, vetNombre: 'Veterinaria San Francisco', contacto: VET_MUESTRA, nombreMascota: m.nombreMascota, fecha: m.fechaCremacion, hora: '16:00' }, c)),
  },
  {
    key: 'vet_cremacion_codigo',
    titulo: 'Código de seguimiento (al veterinario)',
    modulo: 'Convenio cremación',
    audiencia: 'Veterinario',
    cuando: 'Al registrar la ficha de una mascota asociada a un veterinario.',
    build: (m, c) => pick(buildCodigoVet({ email: m.email, vetNombre: 'Veterinaria San Francisco', contacto: VET_MUESTRA, nombreMascota: m.nombreMascota, codigo: m.codigo }, c)),
  },
  {
    key: 'vet_cremacion_ruta',
    titulo: 'Ánfora en camino (al veterinario)',
    modulo: 'Convenio cremación',
    audiencia: 'Veterinario',
    cuando: 'Al iniciar la ruta de despacho de una mascota asociada a un veterinario.',
    build: (m, c) => pick(buildInicioRutaVet({ email: m.email, vetNombre: 'Veterinaria San Francisco', contacto: VET_MUESTRA, nombreMascota: m.nombreMascota, codigo: m.codigo }, c)),
  },
  {
    key: 'vet_cremacion_entrega',
    titulo: 'Entrega confirmada (al veterinario)',
    modulo: 'Convenio cremación',
    audiencia: 'Veterinario',
    cuando: 'Al entregar el ánfora de una mascota asociada a un veterinario.',
    build: (m, c) => pick(buildEntregaVet({ email: m.email, vetNombre: 'Veterinaria San Francisco', contacto: VET_MUESTRA, nombreMascota: m.nombreMascota, codigo: m.codigo }, c)),
  },

  // ── Veterinarias (facturación) ───────────────────────────────────────────────
  {
    key: 'vet_informe_facturacion',
    titulo: 'Informe de facturación (adjunta xlsx/pdf)',
    modulo: 'Veterinarias',
    audiencia: 'Veterinario',
    cuando: 'Al enviar el informe de facturación a la veterinaria.',
    build: (m, c) => ({
      subject: 'Informe de facturación — Veterinaria San Francisco',
      html: renderInformeFacturacionEmail({
        nombreVet: 'Veterinaria San Francisco',
        nombreContacto: VET_MUESTRA,
        periodoHasta: m.fechaCremacion,
        contacto: c,
      }),
    }),
  },
]

function baseUrl(): string {
  return (process.env.PUBLIC_APP_URL || process.env.NEXTAUTH_URL || '').replace(/\/+$/, '')
}

/** Adapta un SendOpts (build* de cliente-mailer) a CorreoRender. */
function pick(o: { subject: string; html: string }): CorreoRender {
  return { subject: o.subject, html: o.html }
}

export function listarCorreos(): Array<Pick<CorreoDef, 'key' | 'titulo' | 'modulo' | 'audiencia' | 'cuando'>> {
  return CORREOS.map(({ key, titulo, modulo, audiencia, cuando }) => ({ key, titulo, modulo, audiencia, cuando }))
}

export function renderCorreo(key: string, m: MuestraCorreo, contacto: Contacto): CorreoRender | null {
  const def = CORREOS.find(c => c.key === key)
  if (!def) return null
  return def.build(m, contacto)
}
