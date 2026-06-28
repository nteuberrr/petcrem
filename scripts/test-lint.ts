import { lintCopy } from '../lib/marketing-lint'

const TEL = '+56 9 9437 0745'
const casos: { nombre: string; args: Parameters<typeof lintCopy>[0]; esperaHallazgo: boolean }[] = [
  {
    nombre: 'caption C-6 real (compañero + teléfono truncado)',
    args: { caption: '...para que sepas dónde está tu compañero en cada momento. +56 9 9437 074', telefono: TEL },
    esperaHallazgo: true,
  },
  {
    nombre: 'placa C-6.4 real (cámara certificada + compañero)',
    args: { placas: ['Resguardo en cámara certificada. Tu compañero permanece en refrigeración en una cámara certificada hasta el momento de la cremación.'] },
    esperaHallazgo: true,
  },
  {
    nombre: 'placa portada con flecha → (glifo roto)',
    args: { placas: ['Desliza para conocer las 5 etapas →'] },
    esperaHallazgo: true,
  },
  {
    nombre: 'placa con emoji 🐾 (glifo roto)',
    args: { placas: ['Te acompañamos 🐾'] },
    esperaHallazgo: true,
  },
  {
    nombre: 'caption limpio + teléfono correcto',
    args: { caption: 'Cuidamos cada detalle de la despedida de tu mascota. Escríbenos: +56 9 9437 0745', telefono: TEL },
    esperaHallazgo: false,
  },
  {
    nombre: 'placa limpia (no debe marcar acentos ni puntuación normal)',
    args: { placas: ['Entrega de cenizas y certificado. Recibes las cenizas junto al certificado digital de cremación, en un máximo de 3 días hábiles. ¿Dudas? Estamos aquí — todos los días.'] },
    esperaHallazgo: false,
  },
  {
    nombre: 'falso positivo? "acompañarte"/"acompañamiento" NO debe marcar compañero',
    args: { placas: ['Estamos para acompañarte. Si necesitas acompañamiento, escríbenos.'] },
    esperaHallazgo: false,
  },
]

let ok = 0
for (const c of casos) {
  const h = lintCopy(c.args)
  const paso = (h.length > 0) === c.esperaHallazgo
  if (paso) ok++
  console.log(`${paso ? 'OK ' : 'FALLA'} | ${c.nombre}`)
  for (const x of h) console.log(`        - [${x.campo}] ${x.problema}`)
}
console.log(`\n${ok}/${casos.length} casos correctos`)
process.exit(ok === casos.length ? 0 : 1)
