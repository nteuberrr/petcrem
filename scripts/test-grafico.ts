/**
 * Render de prueba del motor de gráficos de marca → assets/test-cover.png
 *   npx tsx scripts/test-grafico.ts
 */
import './_env-preload'
import { writeFileSync } from 'node:fs'
import { renderGraficoHTML } from '../lib/grafico-render'

const R2 = (process.env.R2_PUBLIC_URL || '').replace(/\/$/, '')
const LOGO = `${R2}/brand/logo-alma-animal.png`
const navy = '#143C64', gold = '#F2B84B', cream = '#FBF8F3'

const html = `
<div style="display:flex;width:820px;height:312px;background:${cream};font-family:Inter">
  <div style="display:flex;flex-direction:column;justify-content:center;width:470px;height:312px;background:${navy};padding:0 44px">
    <div style="display:flex;flex-direction:column">
      <span style="font-family:'More Sugar';font-size:42px;color:#ffffff;line-height:1.04">Crematorio</span>
      <span style="font-family:'More Sugar';font-size:42px;color:#ffffff;line-height:1.04">Alma Animal</span>
    </div>
    <span style="font-family:Inter;font-weight:600;font-size:18px;color:${gold};margin-top:10px">Huellas que no se borran</span>
    <div style="display:flex;width:92px;height:4px;background:${gold};margin:16px 0"></div>
    <div style="display:flex;flex-direction:column">
      <span style="font-family:Inter;font-size:15px;color:#e8eef5;margin-bottom:5px">Cremación con trazabilidad total</span>
      <span style="font-family:Inter;font-size:15px;color:#e8eef5;margin-bottom:5px">Retiro a domicilio y clínicas · RM</span>
      <span style="font-family:Inter;font-size:15px;color:#e8eef5">Entrega en 4 días hábiles</span>
    </div>
  </div>
  <div style="display:flex;width:350px;height:312px;align-items:flex-end;justify-content:flex-end;padding:20px;background:${cream}">
    <img src="${LOGO}" width="130" height="130" style="object-fit:contain" />
  </div>
</div>`

async function main() {
  const { buffer } = await renderGraficoHTML({ html, width: 820, height: 312 })
  writeFileSync('assets/test-cover.png', buffer)
  console.log('OK', buffer.byteLength, 'bytes -> assets/test-cover.png')
}

main().catch((e) => { console.error(e); process.exit(1) })
