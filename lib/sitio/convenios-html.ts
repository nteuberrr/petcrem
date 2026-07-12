/**
 * Sitio público — sección "Convenios con descuento" al pie de /anforas.
 * Fuente = tabla `descuentos` (Adicionales → Descuentos): visible si
 * activo != 'FALSE' y mostrar_web = 'TRUE' (el equipo lo activa por convenio).
 * `foto_url` = logo del convenio (R2 o /sitio/assets); sin logo se muestra un
 * círculo con las iniciales. Estilos inline autocontenidos con la paleta de
 * marca (navy #143C64 · dorado #F2B84B · crema #FBF8F3) — no dependen del CSS
 * de Webflow, así la sección no se rompe si cambian las clases del template.
 */

type Descuento = Record<string, string>

const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const escUrl = (s: unknown) => String(s ?? '').replace(/['"\\<>]/g, '')

function iniciales(nombre: string): string {
  return nombre.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]?.toUpperCase() || '').join('')
}

function tarjeta(d: Descuento): string {
  const nombre = d.nombre || ''
  const pct = parseInt(String(d.valor || '').replace(/\D/g, ''), 10) || 0
  const logo = d.foto_url
    ? `<img src="${escUrl(d.foto_url)}" alt="${esc(nombre)}" loading="lazy" style="width:88px;height:88px;object-fit:contain;border-radius:12px;background:#fff"/>`
    : `<div style="width:88px;height:88px;border-radius:50%;background:#143C64;color:#F2B84B;display:flex;align-items:center;justify-content:center;font-size:30px;font-weight:700">${esc(iniciales(nombre))}</div>`
  return '<div style="background:#fff;border:1px solid #e6e0d6;border-radius:16px;padding:28px 24px;display:flex;flex-direction:column;align-items:center;gap:12px;min-width:220px;max-width:280px;flex:1 1 220px;box-shadow:0 2px 10px rgba(20,60,100,.06)">'
    + logo
    + `<div style="font-size:17px;font-weight:600;color:#143C64;text-align:center">${esc(nombre)}</div>`
    + (pct > 0 ? `<div style="background:#F2B84B;color:#143C64;font-weight:700;font-size:14px;border-radius:999px;padding:4px 14px">${pct}% de descuento</div>` : '')
    + '</div>'
}

export function renderConveniosDescuento(descuentos: Descuento[]): string {
  const visibles = descuentos.filter(d => d.activo !== 'FALSE' && d.mostrar_web === 'TRUE')
  if (visibles.length === 0) return ''
  return '<section style="background:#FBF8F3;padding:56px 5% 64px">'
    + '<div style="max-width:1100px;margin:0 auto;text-align:center">'
    + '<h2 style="color:#143C64;font-size:32px;margin:0 0 8px">Convenios con descuento</h2>'
    + '<p style="color:#5b6b7a;font-size:16px;max-width:640px;margin:0 auto 32px">Si perteneces a alguna de estas instituciones u organizaciones en convenio, tienes un descuento preferente en el servicio de cremación. Menciónalo al momento de coordinar.</p>'
    + `<div style="display:flex;flex-wrap:wrap;gap:20px;justify-content:center">${visibles.map(tarjeta).join('')}</div>`
    + '</div></section>'
}
