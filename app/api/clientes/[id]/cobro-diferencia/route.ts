import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { getSheetData, updateById, ensureColumns } from '@/lib/datastore'
import { calcularSnapshotFicha } from '@/lib/price-calculator'
import { parsePeso } from '@/lib/numbers'
import { buildCobroDiferencia } from '@/lib/cliente-mailer'
import { sendEmail, isResendConfigured } from '@/lib/resend-mailer'
import { getContacto } from '@/lib/email-layout'
import { registrarEnvio } from '@/lib/correos-log'
import { enviarTextoWhatsapp, isWhatsappConfigured } from '@/lib/whatsapp'
import { fmtPrecio } from '@/lib/format'

/**
 * POST /api/clientes/[id]/cobro-diferencia
 *
 * Envía al tutor el correo de cobro por diferencia de peso (peso real de
 * ingreso en un tramo superior al declarado), con la ÚLTIMA foto de evidencia
 * adjunta como respaldo y los datos de transferencia de empresa_config.
 * Además le manda un WhatsApp con el mismo aviso (best-effort: requiere
 * ventana de 24h de Meta abierta).
 *
 * La diferencia se calcula SERVER-SIDE con los pesos PERSISTIDOS de la ficha
 * (misma tabla/regla de tramos que el snapshot) — la UI exige guardar antes.
 * Idempotente: si ya se envió (correo_diferencia_fecha), responde 409.
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  try {
    const { id } = await params
    await ensureColumns('clientes', ['correo_diferencia_fecha', 'correo_diferencia_monto'])
    const clientes = await getSheetData('clientes')
    const c = clientes.find(r => r.id === id)
    if (!c) return NextResponse.json({ error: 'Cliente no encontrado' }, { status: 404 })

    if ((c.correo_diferencia_fecha || '').trim()) {
      return NextResponse.json({ error: 'El correo de cobro ya fue enviado para esta ficha.' }, { status: 409 })
    }
    const email = (c.email || '').trim()
    if (!email) return NextResponse.json({ error: 'La ficha no tiene email del tutor.' }, { status: 400 })

    let fotos: string[] = []
    try { const x = JSON.parse(c.fotos_evidencia || '[]'); if (Array.isArray(x)) fotos = x } catch { /* */ }
    if (fotos.length === 0) {
      return NextResponse.json({ error: 'Sube primero la foto de evidencia del peso.' }, { status: 400 })
    }

    const pesoDeclarado = parsePeso(c.peso_declarado)
    const pesoIngreso = parsePeso(c.peso_ingreso)
    if (!(pesoDeclarado > 0) || !(pesoIngreso > 0)) {
      return NextResponse.json({ error: 'Faltan el peso declarado o el peso de ingreso en la ficha (guárdala primero).' }, { status: 400 })
    }

    // Diferencia = precio del tramo del peso REAL - precio del tramo declarado,
    // sobre la MISMA tabla del cliente (general/convenio/especial). Reutiliza el
    // cálculo canónico del snapshot, sin adicionales ni descuentos.
    const base = {
      codigo_servicio: c.codigo_servicio || 'CI',
      veterinaria_id: c.veterinaria_id || undefined,
      tipo_precios: c.tipo_precios || undefined,
      adicionales: [],
    }
    const [snapDeclarado, snapIngreso] = [
      await calcularSnapshotFicha({ ...base, peso: pesoDeclarado }),
      await calcularSnapshotFicha({ ...base, peso: pesoIngreso }),
    ]
    const monto = (snapIngreso.precio_servicio || 0) - (snapDeclarado.precio_servicio || 0)
    if (monto <= 0) {
      return NextResponse.json({ error: 'El peso real no cae en un tramo superior: no hay diferencia que cobrar.' }, { status: 400 })
    }

    if (!isResendConfigured()) {
      return NextResponse.json({ error: 'Resend no está configurado: no se puede enviar el correo.' }, { status: 503 })
    }

    // Datos de transferencia desde empresa_config (los vacíos se omiten del correo).
    const cfgRows = await getSheetData('empresa_config').catch(() => [] as Record<string, string>[])
    const cfg = cfgRows.find(r => r.id === '1') || cfgRows[0] || {}
    const contacto = await getContacto()

    const opts = buildCobroDiferencia({
      email,
      nombreMascota: c.nombre_mascota || 'tu mascota',
      nombreTutor: c.nombre_tutor || '',
      clienteId: id,
      pesoDeclarado,
      pesoIngreso,
      monto,
      transferencia: {
        titular: cfg.nombre || '',
        rut: cfg.rut || '',
        banco: cfg.banco || '',
        tipoCuenta: cfg.tipo_cuenta || '',
        numeroCuenta: cfg.numero_cuenta || '',
        correo: cfg.correo || '',
      },
    }, contacto)

    // Adjuntar la ÚLTIMA foto de evidencia como respaldo del pesaje.
    const fotoUrl = fotos[fotos.length - 1]
    const ext = (() => { const e = (fotoUrl.split('.').pop() || '').toLowerCase(); return ['jpg', 'jpeg', 'png', 'webp'].includes(e) ? e : 'jpg' })()
    const res = await sendEmail({
      ...opts,
      attachments: [{
        filename: `Evidencia_peso_${(c.nombre_mascota || 'mascota').replace(/[^\w\-]/g, '_')}.${ext}`,
        path: fotoUrl,
        content_type: ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg',
      }],
    })
    await registrarEnvio({ clienteId: id, tipo: 'cobro_diferencia', email, messageId: res.message_id, ok: res.ok, error: res.error })
    if (!res.ok) {
      return NextResponse.json({ error: `No se pudo enviar el correo: ${res.error || 'error de Resend'}` }, { status: 502 })
    }

    // Persistir el estado ANTES de los efectos secundarios (evita doble envío).
    const ahora = new Date().toISOString()
    await updateById('clientes', id, { ...c, correo_diferencia_fecha: ahora, correo_diferencia_monto: String(monto) })

    // WhatsApp al tutor (best-effort; requiere ventana de 24h abierta con Meta).
    let whatsappOk = false
    const tel = (c.telefono || '').replace(/\D/g, '').slice(-9)
    if (tel.length === 9 && isWhatsappConfigured()) {
      try {
        const wa = await enviarTextoWhatsapp(`56${tel}`,
          `Hola ${c.nombre_tutor || ''} 🐾 Al recibir a ${c.nombre_mascota || 'tu mascota'} registramos un peso real de ${pesoIngreso} kg ` +
          `(se declararon ${pesoDeclarado} kg), que corresponde a un tramo superior de la tarifa. ` +
          `La diferencia a pagar es de ${fmtPrecio(monto)}. Te enviamos un correo a ${email} con el detalle, ` +
          `la foto del pesaje como respaldo y los datos de transferencia. Cualquier duda, escríbenos por aquí.`)
        whatsappOk = !!wa?.ok
      } catch (e) { console.warn('[cobro-diferencia] WhatsApp falló:', e) }
    }

    return NextResponse.json({ ok: true, monto, fecha: ahora, whatsapp: whatsappOk })
  } catch (e) {
    console.error('[cobro-diferencia POST]', e)
    return NextResponse.json({ error: 'No se pudo enviar el cobro de la diferencia.' }, { status: 500 })
  }
}
