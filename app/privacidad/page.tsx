import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Política de Privacidad — Crematorio Alma Animal',
  description: 'Cómo Crematorio Alma Animal recopila, usa y protege tus datos personales.',
}

// Paleta de marca (canónica del repo).
const NAVY = '#143C64'
const AMBER = '#F2B84B'
const CREAM = '#FBF8F3'

const ACTUALIZADO = '16 de junio de 2026'
const EMAIL = 'contacto@crematorioalmaanimal.cl'
const TEL = '+56 9 7864 0811'
const WEB = 'www.crematorioalmaanimal.cl'

function Seccion({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="text-lg font-bold" style={{ color: NAVY }}>{titulo}</h2>
      <div className="mt-2 space-y-3 text-[15px] leading-relaxed text-gray-700">{children}</div>
    </section>
  )
}

export default function PoliticaPrivacidad() {
  return (
    <main className="min-h-screen" style={{ background: CREAM }}>
      <div className="mx-auto max-w-3xl px-5 py-10 sm:py-14">
        <header className="border-b pb-6" style={{ borderColor: '#e7e1d8' }}>
          <p className="text-xs font-semibold uppercase tracking-[1.5px]" style={{ color: AMBER }}>Crematorio Alma Animal</p>
          <h1 className="mt-2 text-2xl sm:text-3xl font-bold" style={{ color: NAVY }}>Política de Privacidad</h1>
          <p className="mt-2 text-sm text-gray-500">Última actualización: {ACTUALIZADO}</p>
        </header>

        <p className="mt-6 text-[15px] leading-relaxed text-gray-700">
          En <strong>Crematorio Alma Animal</strong> cuidamos tu información con el mismo respeto con
          que cuidamos a tu mascota. Esta política explica qué datos recopilamos, para qué los usamos
          y cómo los protegemos cuando coordinas con nosotros un servicio de cremación o nos contactas
          por nuestros canales (sitio web, correo, teléfono o WhatsApp).
        </p>

        <Seccion titulo="1. Responsable del tratamiento">
          <p>
            El responsable de tus datos es <strong>Crematorio Alma Animal</strong>, con domicilio en
            Recoleta, Santiago de Chile. Para cualquier consulta sobre privacidad puedes escribirnos a{' '}
            <a href={`mailto:${EMAIL}`} style={{ color: NAVY }} className="underline">{EMAIL}</a>.
          </p>
        </Seccion>

        <Seccion titulo="2. Qué información recopilamos">
          <p>Recopilamos únicamente la información necesaria para prestar el servicio:</p>
          <ul className="list-disc pl-5 space-y-1.5">
            <li><strong>Datos del tutor:</strong> nombre, teléfono, correo electrónico y dirección de retiro/entrega.</li>
            <li><strong>Datos de la mascota:</strong> nombre, especie, peso y, si la compartes, una fotografía para el certificado.</li>
            <li><strong>Datos del servicio:</strong> tipo de servicio, fechas, código de seguimiento y estado del proceso.</li>
            <li><strong>Comunicaciones:</strong> los mensajes que intercambias con nosotros por WhatsApp, correo o teléfono.</li>
            <li><strong>Datos de pago:</strong> el medio y estado del pago (no almacenamos datos completos de tarjetas).</li>
          </ul>
          <p>Obtenemos estos datos directamente de ti, a través de nuestros formularios, llamadas o conversaciones.</p>
        </Seccion>

        <Seccion titulo="3. Para qué usamos tu información">
          <ul className="list-disc pl-5 space-y-1.5">
            <li>Coordinar y prestar el servicio de cremación, incluyendo el retiro y la entrega.</li>
            <li>Emitir el certificado de cremación y, si lo solicitas, el material conmemorativo.</li>
            <li>Mantenerte informado del estado del proceso mediante correo y WhatsApp.</li>
            <li>Responder tus consultas y brindarte atención antes, durante y después del servicio.</li>
            <li>Cumplir obligaciones legales y de facturación.</li>
          </ul>
          <p>No vendemos tu información ni la usamos para fines distintos a los aquí descritos.</p>
        </Seccion>

        <Seccion titulo="4. Comunicaciones por correo y WhatsApp">
          <p>
            Utilizamos la <strong>Plataforma de WhatsApp Business</strong> (Meta) y el correo electrónico para
            coordinar el servicio y enviarte avisos relacionados con tu solicitud (por ejemplo, la confirmación
            de un retiro o el aviso de entrega). Solo te escribimos en el contexto del servicio que estás
            coordinando con nosotros, y puedes pedirnos en cualquier momento que dejemos de contactarte por
            estos medios. El uso de WhatsApp se rige además por las políticas de Meta.
          </p>
        </Seccion>

        <Seccion titulo="5. Con quién compartimos la información">
          <p>
            No vendemos ni cedemos tus datos a terceros con fines comerciales. Compartimos la información
            mínima necesaria con proveedores tecnológicos que nos ayudan a operar, que la tratan solo por
            nuestra instrucción y bajo sus propias políticas de seguridad (por ejemplo: servicios de
            infraestructura y bases de datos en la nube, almacenamiento de archivos, envío de correos,
            mensajería de WhatsApp y servicios de mapas para validar direcciones).
          </p>
          <p>
            También podremos compartir información cuando la ley lo exija o para proteger nuestros derechos.
          </p>
        </Seccion>

        <Seccion titulo="6. Conservación de los datos">
          <p>
            Conservamos tu información durante el tiempo necesario para prestar el servicio y cumplir las
            obligaciones legales, contables y tributarias aplicables. Cuando ya no sea necesaria, la
            eliminamos o anonimizamos de forma segura.
          </p>
        </Seccion>

        <Seccion titulo="7. Tus derechos">
          <p>
            De acuerdo con la Ley N° 19.628 sobre Protección de la Vida Privada de Chile, puedes solicitar en
            cualquier momento el <strong>acceso</strong>, la <strong>rectificación</strong>, la{' '}
            <strong>eliminación</strong> o la <strong>oposición</strong> al tratamiento de tus datos
            personales. Para ejercer estos derechos, escríbenos a{' '}
            <a href={`mailto:${EMAIL}`} style={{ color: NAVY }} className="underline">{EMAIL}</a> y
            responderemos a la brevedad.
          </p>
        </Seccion>

        <Seccion titulo="8. Seguridad">
          <p>
            Aplicamos medidas técnicas y organizativas razonables para proteger tu información contra el acceso
            no autorizado, la pérdida o la alteración. El acceso a los datos está restringido a personal
            autorizado y a los proveedores estrictamente necesarios para operar el servicio.
          </p>
        </Seccion>

        <Seccion titulo="9. Menores de edad">
          <p>
            Nuestros servicios están dirigidos a personas mayores de edad. No recopilamos de forma intencional
            datos de menores.
          </p>
        </Seccion>

        <Seccion titulo="10. Cambios a esta política">
          <p>
            Podemos actualizar esta política para reflejar mejoras o cambios legales. Publicaremos siempre la
            versión vigente en esta página, indicando la fecha de última actualización.
          </p>
        </Seccion>

        <Seccion titulo="11. Contacto">
          <p>
            ¿Dudas sobre tu privacidad? Estamos para ayudarte:
          </p>
          <ul className="list-none space-y-1">
            <li>Correo: <a href={`mailto:${EMAIL}`} style={{ color: NAVY }} className="underline">{EMAIL}</a></li>
            <li>Teléfono / WhatsApp: {TEL}</li>
            <li>Sitio web: {WEB}</li>
          </ul>
        </Seccion>

        <footer className="mt-12 border-t pt-6 text-center text-xs text-gray-400" style={{ borderColor: '#e7e1d8' }}>
          © Crematorio Alma Animal · Huellas que no se borran
        </footer>
      </div>
    </main>
  )
}
