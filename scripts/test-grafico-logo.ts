/**
 * Prueba: render del gráfico + logo auto-elegido por contraste (con las 5 variantes
 * reales del banco). Sin subir a R2 ni tocar el banco → assets/test-grafico-logo.png
 *   npx tsx scripts/test-grafico-logo.ts
 */
import './_env-preload'
import { writeFileSync } from 'node:fs'
import { renderGraficoHTML } from '../lib/grafico-render'
import { listarImagenes } from '../lib/mailing-images'
import { aplicarLogoMarca, esLogo } from '../lib/marca-logo'

const navy = '#143C64', gold = '#F2B84B', cream = '#FBF8F3'
const html = `<div style="display:flex;width:1640px;height:624px;background:${cream}">
  <div style="display:flex;flex-direction:column;justify-content:center;width:940px;height:624px;background:${navy};padding:0 88px">
    <span style="font-family:'More Sugar';font-size:84px;color:#ffffff;line-height:1.04">Alma Animal</span>
    <span style="font-family:Inter;font-weight:600;font-size:34px;color:${gold};margin-top:14px">Huellas que no se borran</span>
    <div style="display:flex;width:180px;height:7px;background:${gold};margin:28px 0"></div>
    <div style="display:flex;flex-direction:column">
      <span style="font-family:Inter;font-size:28px;color:#e8eef5;margin-bottom:8px">Entrega en 4 días hábiles</span>
      <span style="font-family:Inter;font-size:28px;color:#e8eef5">Retiro a domicilio y clínicas · RM</span>
    </div>
  </div>
  <div style="display:flex;width:700px;height:624px;background:${cream}"></div>
</div>`

async function main() {
  const { buffer } = await renderGraficoHTML({ html, width: 1640, height: 624 })
  const banco = await listarImagenes()
  console.log('logos en grupo marca:', banco.filter(esLogo).map(m => m.descripcion || m.id))
  const r = await aplicarLogoMarca(buffer, banco, { escala: 0.14 })
  writeFileSync('assets/test-grafico-logo.png', r.buffer)
  console.log('logo aplicado:', r.aplicado, '->', 'assets/test-grafico-logo.png')
}

main().catch((e) => { console.error(e); process.exit(1) })
