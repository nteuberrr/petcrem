/**
 * Previsualización: envía a un correo de prueba TODOS los correos que el
 * sistema manda (clientes + veterinarios), usando datos reales del último
 * proceso completo de cada flujo. Solo cambia el destinatario.
 *
 *   npx tsx scripts/preview-correos-cliente.ts [correo_destino]
 *
 * Si no se pasa correo, usa nicoteuber@gmail.com.
 */
import './_env-preload' // DEBE ir primero: carga env antes de evaluar las libs
import { getSheetData } from '../lib/google-sheets'
import { sendEmail } from '../lib/resend-mailer'
import { createToken, createVetToken } from '../lib/eutanasia-tokens'
import { fmtFecha } from '../lib/format'
import {
  enviarRegistroMascota,
  enviarInicioCremacion,
  enviarInicioDespacho,
} from '../lib/cliente-mailer'
import {
  enviarBienvenidaVet,
  enviarMailAgradecimiento,
  renderCotizacionEmail,
  renderCoordinarEmail,
  nombreCompletoVet,
} from '../lib/eutanasia-mailer'
import { renderEmailLayout, getContacto, escapeHtml } from '../lib/email-layout'

const DESTINO = process.argv[2] || 'nicoteuber@gmail.com'
const BASE = (process.env.PUBLIC_APP_URL || process.env.NEXTAUTH_URL || 'https://crematorioalmaanimal.cl').replace(/\/+$/, '')

// periodo_hasta_mes en la planilla suele ser un serial Excel; lo mostramos como
// fecha DD/MM/YYYY con fmtFecha (= formatDate, serial-aware), igual que el route.
function fmtPeriodo(raw: string): string {
  if (!raw) return '—'
  if (/^\d{4}-\d{2}$/.test(raw)) return fmtFecha(`${raw}-01`)
  return fmtFecha(raw)
}

async function main() {
  const [clientes, ciclos, certs, cotis, vets, informes] = await Promise.all([
    getSheetData('clientes'),
    getSheetData('ciclos'),
    getSheetData('certificados').catch(() => []),
    getSheetData('cotizaciones_eutanasia').catch(() => []),
    getSheetData('vet_convenio_eutanasia').catch(() => []),
    getSheetData('informes_veterinaria').catch(() => []),
  ])
  const contacto = await getContacto()
  const byId = new Map(clientes.map(c => [c.id, c]))

  // ── Mascota del último ciclo (flujo clientes) ──
  const ultimoCiclo = [...ciclos].sort((a, b) => (parseInt(b.numero_ciclo || '0') || 0) - (parseInt(a.numero_ciclo || '0') || 0))[0]
  let ids: string[] = []
  try { ids = JSON.parse(ultimoCiclo?.mascotas_ids || '[]') } catch {}
  const mascota = ids.map(i => byId.get(i)).find(c => c && c.nombre_mascota) || clientes.find(c => c.nombre_mascota)
  if (!mascota) throw new Error('No hay mascotas en clientes')
  console.log(`Mascota (clientes): "${mascota.nombre_mascota}" — tutor ${mascota.nombre_tutor} — código ${mascota.codigo}`)

  console.log(`\nEnviando a ${DESTINO}…\n`)
  const log = (n: string, etiqueta: string) => console.log(`  ✓ ${n}. ${etiqueta}`)

  // 1-3. Clientes: registro, cremación, despacho
  await enviarRegistroMascota({ email: DESTINO, nombreMascota: mascota.nombre_mascota, nombreTutor: mascota.nombre_tutor, codigo: mascota.codigo })
  log('1', 'Cliente · registro + código')
  await enviarInicioCremacion([{ email: DESTINO, nombreMascota: mascota.nombre_mascota, nombreTutor: mascota.nombre_tutor }])
  log('2', 'Cliente · inicio cremación')
  await enviarInicioDespacho([{ email: DESTINO, nombreMascota: mascota.nombre_mascota, nombreTutor: mascota.nombre_tutor }])
  log('3', 'Cliente · inicio despacho')

  // 4. Certificado de cremación (con PDF adjunto real)
  const cert = certs.filter(c => c.pdf_url).sort((a, b) => (parseInt(b.id) || 0) - (parseInt(a.id) || 0))[0]
  if (cert) {
    const cli = byId.get(cert.cliente_id)
    const nombreMascota = cert.nombre_mascota || cli?.nombre_mascota || 'tu mascota'
    const nombreTutor = cli?.nombre_tutor || ''
    const ciclo = ciclos.find(c => c.id === cli?.ciclo_id)
    const fechaCremacion = ciclo ? fmtFecha(ciclo.fecha) : '—'
    const m = escapeHtml(nombreMascota)
    const cuerpo = `
      <p style="margin:0 0 14px;font-size:15px">Estimado(a) ${nombreTutor ? `<strong>${escapeHtml(nombreTutor)}</strong>` : 'tutor(a)'},</p>
      <p style="margin:0 0 14px;font-size:14px;line-height:1.6">Reciba nuestro más sentido pésame por la partida de <strong>${m}</strong>. Fue un privilegio para nuestro equipo acompañarles en este momento y brindar el servicio de cremación con el cuidado y respeto que ${m} merecía.</p>
      <p style="margin:0 0 14px;font-size:14px;line-height:1.6">Adjunto a este correo encontrará el <strong>Certificado de Cremación</strong> de ${m}, correspondiente al servicio realizado el ${escapeHtml(fechaCremacion)}. Este documento queda registrado para sus archivos.</p>
      <p style="margin:0;font-size:14px;line-height:1.6">Si necesita una copia adicional o tiene cualquier consulta posterior, no dude en escribirnos.</p>`
    await sendEmail({
      to: DESTINO,
      subject: `Certificado de cremación — ${nombreMascota}`,
      html: renderEmailLayout({ titulo: `Certificado de cremación de ${nombreMascota}`, bodyHtml: cuerpo, contacto }),
      from: 'Crematorio Alma Animal <contacto@crematorioalmaanimal.cl>',
      preview_text: `Adjuntamos el certificado de cremación de ${nombreMascota}.`,
      attachments: [{ filename: `Certificado_${nombreMascota}.pdf`, path: cert.pdf_url, content_type: 'application/pdf' }],
    })
    log('4', `Cliente · certificado de cremación (adjunto PDF de ${nombreMascota})`)
  } else {
    console.log('  – 4. Certificado: no hay certificados generados, omitido')
  }

  // ── Cotización de eutanasia más avanzada (flujo vets) ──
  const orden = ['realizada', 'aceptada', 'enviada', 'creada']
  const coti = [...cotis].sort((a, b) => orden.indexOf(a.estado) - orden.indexOf(b.estado) || (parseInt(b.id) || 0) - (parseInt(a.id) || 0))[0]
  const vetAsignado = coti ? vets.find(v => v.id === coti.vet_id_asignado) : undefined
  const vet = vetAsignado || vets.find(v => (v.activo || '').toUpperCase() === 'TRUE') || vets[0]
  const vetNombre = vet ? nombreCompletoVet(vet.nombre, vet.apellido) : 'Dr/a.'

  if (vet) {
    await enviarBienvenidaVet({ vetId: vet.id, nombre: vet.nombre, apellido: vet.apellido, email: DESTINO })
    log('5', 'Vet · bienvenida al convenio')
  } else { console.log('  – 5. Bienvenida vet: no hay vets, omitido') }

  if (coti && vet) {
    const linkAceptar = `${BASE}/eutanasia/aceptar/${createToken(coti.id, vet.id, 'aceptar')}`
    const linkRealizado = `${BASE}/eutanasia/realizado/${createToken(coti.id, vet.id, 'realizado')}`
    const linkNoRealizado = `${BASE}/eutanasia/no-realizado/${createToken(coti.id, vet.id, 'no_realizado')}`
    const linkDatosPago = `${BASE}/eutanasia/datos-pago/${createVetToken(vet.id, 'datos_pago')}`

    await sendEmail({
      to: DESTINO,
      subject: `Solicitud de eutanasia en ${coti.comuna} — ${coti.mascota_nombre}`,
      html: renderCotizacionEmail({ vetNombre, c: coti, linkAceptar, linkDatosPago, contacto }),
      preview_text: `Solicitud de eutanasia para ${coti.mascota_nombre} en ${coti.comuna}.`,
    })
    log('6', 'Vet · nueva solicitud de eutanasia')

    await sendEmail({
      to: DESTINO,
      subject: `Coordina con la familia — Eutanasia ${coti.mascota_nombre}`,
      html: renderCoordinarEmail({ vetNombre, c: coti, linkRealizado, linkNoRealizado, linkDatosPago, linkHoraRetiro: '#', contacto }),
      preview_text: `Datos de contacto de la familia de ${coti.mascota_nombre}.`,
    })
    log('7', 'Vet · coordina con la familia (realizada / no realizada)')

    await enviarMailAgradecimiento({
      vetEmail: DESTINO,
      vetNombre,
      cotizacion: { id: coti.id, mascota_nombre: coti.mascota_nombre, precio_snapshot: coti.precio_snapshot },
      fechaRealizacionISO: coti.fecha_realizacion || coti.fecha_servicio || '2026-06-06',
    })
    log('9', 'Vet · agradecimiento + pago coordinado')
  } else { console.log('  – 6-9. Cotización de eutanasia: no hay datos, omitido') }

  // 10. Informe de facturación (con archivo adjunto real)
  const informe = informes.filter(r => r.archivo_url).sort((a, b) => (parseInt(b.id) || 0) - (parseInt(a.id) || 0))[0]
  if (informe) {
    const vetsBase = await getSheetData('veterinarios')
    const v = vetsBase.find(x => x.id === informe.veterinaria_id)
    const nombreVet = informe.veterinaria_nombre || v?.nombre || 'Veterinaria'
    const nombreContacto = v?.nombre_contacto || ''
    const periodo = fmtPeriodo(informe.periodo_hasta_mes)
    const saludo = nombreContacto ? `Estimado(a) <strong>${escapeHtml(nombreContacto)}</strong>` : 'Estimados'
    const cuerpo = `
      <p style="margin:0 0 14px;font-size:15px">${saludo},</p>
      <p style="margin:0 0 14px;font-size:14px;line-height:1.6">Adjuntamos el informe de facturación correspondiente a <strong>${escapeHtml(nombreVet)}</strong>, con el detalle de los servicios prestados hasta el cierre de <strong>${escapeHtml(periodo)}</strong>.</p>
      <p style="margin:0 0 14px;font-size:14px;line-height:1.6">En el archivo adjunto encontrarán el detalle por mes con su desglose semanal y el total a facturar correspondiente a cada uno, junto con un resumen histórico por especie, tramo de peso y tipo de servicio.</p>
      <p style="margin:0;font-size:14px;line-height:1.6">Para cualquier consulta sobre este informe pueden responder directamente a este correo o escribirnos por los medios de abajo.</p>`
    const ext = informe.formato === 'excel' ? 'xlsx' : 'pdf'
    const ct = informe.formato === 'excel' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'application/pdf'
    await sendEmail({
      to: DESTINO,
      subject: `Informe de facturación — ${nombreVet}`,
      html: renderEmailLayout({ titulo: 'Informe de facturación', bodyHtml: cuerpo, contacto }),
      from: 'Crematorio Alma Animal <contacto@crematorioalmaanimal.cl>',
      preview_text: `Informe de facturación de ${nombreVet}.`,
      attachments: [{ filename: `Informe_${nombreVet}.${ext}`, path: informe.archivo_url, content_type: ct }],
    })
    log('10', `Vet · informe de facturación (adjunto ${ext})`)
  } else {
    console.log('  – 10. Informe: no hay informes generados, omitido')
  }

  console.log(`\nListo. Revisa la bandeja de ${DESTINO}`)
}

main().catch(e => { console.error('ERROR:', e instanceof Error ? e.message : e); process.exit(1) })
