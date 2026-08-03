import { NextRequest, NextResponse } from 'next/server'
import { getSheetData } from '@/lib/datastore'
import { guard } from '@/lib/remuneraciones/auth'
import { getEmpleado, getLiquidacion } from '@/lib/remuneraciones/datos'
import { generarLiquidacionPdf } from '@/lib/remuneraciones/pdf'
import { nombreDePeriodo } from '@/lib/remuneraciones/periodo'
import { asuntoLiquidacion, renderLiquidacionEmail } from '@/lib/remuneraciones/mailer'
import { getContacto } from '@/lib/email-layout'
import { isResendConfigured, sendEmail } from '@/lib/resend-mailer'

export const dynamic = 'force-dynamic'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Envía la liquidación al correo del trabajador con el PDF adjunto.
 *
 * Exige nivel EDITAR: mandarle el sueldo a alguien no es una lectura. El PDF se
 * arma del snapshot guardado (el mismo que descarga el botón «PDF»), así que el
 * correo y lo que se ve en pantalla no pueden divergir.
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await guard('editar')
  if (g.denegado) return g.denegado
  const { id } = await params

  try {
    if (!isResendConfigured()) {
      return NextResponse.json({ error: 'El envío de correos no está configurado (falta RESEND_API_KEY).' }, { status: 500 })
    }

    const liq = await getLiquidacion(id)
    if (!liq) return NextResponse.json({ error: 'Liquidación no encontrada' }, { status: 404 })
    if (!liq.detalle) {
      return NextResponse.json({ error: 'La liquidación no tiene el detalle guardado. Recalcula el período.' }, { status: 409 })
    }

    const [empleado, empresaRows, contacto] = await Promise.all([
      getEmpleado(liq.empleado_id),
      getSheetData('empresa_config').catch(() => [] as Record<string, string>[]),
      getContacto(),
    ])

    const destino = (empleado?.email || '').trim()
    if (!EMAIL_RE.test(destino)) {
      return NextResponse.json(
        { error: `${liq.empleado_nombre || 'El empleado'} no tiene un correo válido cargado. Agrégalo en la pestaña «Empleados».` },
        { status: 400 },
      )
    }

    const empresa = empresaRows[0] || {}
    const periodoTexto = nombreDePeriodo(liq.periodo)
    const nombre = liq.empleado_nombre || empleado?.nombre_completo || ''

    const pdf = await generarLiquidacionPdf({
      periodo: liq.periodo,
      periodoTexto,
      empleador: {
        razon_social: String(empresa.nombre || 'Alma Animal'),
        rut: String(empresa.rut || ''),
        direccion: [empresa.direccion, empresa.comuna].filter(Boolean).join(', '),
      },
      trabajador: {
        nombre,
        rut: empleado?.rut || '',
        cargo: empleado?.cargo || '',
        unidad_negocio: empleado?.unidad_negocio || '',
        tipo_contrato: empleado?.tipo_contrato === 'indefinido' ? 'Indefinido' : 'Plazo fijo',
        fecha_ingreso: empleado?.fecha_ingreso || '',
        fecha_termino: empleado?.fecha_termino || '',
        sueldo_base: empleado?.sueldo_base || 0,
      },
      liquidacion: liq.detalle,
    })

    const html = renderLiquidacionEmail({
      nombre,
      periodoTexto,
      liquido: liq.liquido,
      reembolsoSalud: liq.reembolso_salud,
      totalTransferir: liq.total_a_transferir,
      cremaciones: liq.cremaciones,
      contacto,
    })

    const res = await sendEmail({
      to: destino,
      subject: asuntoLiquidacion(periodoTexto),
      html,
      preview_text: `Tu liquidación de ${periodoTexto} en PDF.`,
      attachments: [{
        filename: `Liquidacion_${liq.periodo}_${(nombre.split(' ')[0] || 'empleado').toLowerCase()}.pdf`,
        content: pdf,
        content_type: 'application/pdf',
      }],
      // El sueldo de una persona no se copia a nadie más.
      noBcc: true,
      seguimiento: { tipo: 'rrhh_liquidacion', audiencia: 'Empleado', nombre, codigo: liq.periodo },
    })
    if (!res.ok) return NextResponse.json({ error: res.error || 'No se pudo enviar el correo' }, { status: 502 })

    return NextResponse.json({ ok: true, destinatario: destino })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
