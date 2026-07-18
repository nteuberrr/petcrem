import { getSheetData } from './datastore'

/**
 * Estructura visual compartida por TODOS los correos (clientes, veterinarios,
 * convenio de eutanasias, etc.). Centraliza:
 *  - El header navy con el nombre "Alma Animal" + el título del correo + el logo
 *    a la derecha, y un filete dorado debajo.
 *  - El footer con datos de contacto (leídos de empresa_config) + el sello abajo
 *    a la derecha + la firma.
 *  - La paleta de marca y helpers (escapeHtml, getContacto).
 *
 * Cada correo solo aporta su `titulo` y su `bodyHtml` (el contenido interno);
 * el resto lo pone renderEmailLayout para que todos se vean igual.
 *
 * Convención: en copy de cara al cliente, referirse a la mascota por su nombre.
 */

// ─── Paleta de marca ──────────────────────────────────────────────────────────
export const BRAND = {
  navy: '#143C64',
  amber: '#F2B84B', // amarillo del logo
  cream: '#FBF8F3', // fondo cálido del correo
  ink: '#1f2937',
  muted: '#475569',
  hairline: '#ece6db',
}

// Imágenes de marca hospedadas en R2 (ver scripts/upload-brand-assets.ts).
const R2_BASE = (process.env.R2_PUBLIC_URL || 'https://pub-9ca489d9f825495b83375f6e526f354e.r2.dev').replace(/\/$/, '')
export const LOGO_URL = `${R2_BASE}/brand/logo-alma-animal.png`
export const SELLO_URL = `${R2_BASE}/brand/sello-alma-animal.png`
// Huella blanca (PNG) para el eyebrow — el emoji 🐾 sale a color y no se ve sobre el navy.
export const PAW_URL = `${R2_BASE}/brand/paw-white.png`

const FONT = `-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif`

// ─── Contacto (footer) ──────────────────────────────────────────────────────
const TELEFONO_FALLBACK = process.env.EMPRESA_TELEFONO_CONTACTO || '+56 9 4053 8499'
const EMAIL_FALLBACK = 'info@crematorioalmaanimal.cl'
const WEB_FALLBACK = process.env.EMPRESA_WEB || 'crematorioalmaanimal.cl'
const NOMBRE_FALLBACK = process.env.MAILING_FROM_NAME || 'Alma Animal'

export interface Contacto {
  nombre: string
  telefono: string
  correo: string
  web: string
  /** Link a "escribir reseña" del Perfil de Empresa de Google (botón "Evalúanos"). Puede venir vacío. */
  googleReviewUrl: string
}

/**
 * Datos de contacto desde la hoja empresa_config (id='1'), con fallback a
 * constantes/env. Best-effort: si falla la lectura, usa fallbacks.
 */
export async function getContacto(): Promise<Contacto> {
  try {
    const rows = await getSheetData('empresa_config')
    const r = rows.find(x => x.id === '1') || rows[0]
    if (r) {
      return {
        nombre: r.nombre || NOMBRE_FALLBACK,
        telefono: r.telefono || TELEFONO_FALLBACK,
        correo: r.correo || EMAIL_FALLBACK,
        web: r.web || WEB_FALLBACK,
        googleReviewUrl: r.google_review_url || process.env.GOOGLE_REVIEW_URL || '',
      }
    }
  } catch (e) {
    console.warn('[email-layout] no se pudo leer empresa_config, uso fallback:', e)
  }
  return { nombre: NOMBRE_FALLBACK, telefono: TELEFONO_FALLBACK, correo: EMAIL_FALLBACK, web: WEB_FALLBACK, googleReviewUrl: process.env.GOOGLE_REVIEW_URL || '' }
}

export function escapeHtml(s: string | undefined | null): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// ─── Layout ─────────────────────────────────────────────────────────────────
export interface LayoutArgs {
  /** Título grande dentro de la barra navy (específico de cada correo). */
  titulo: string
  /** Contenido interno del correo (HTML ya escapado donde corresponda). */
  bodyHtml: string
  /** Datos de contacto para el footer. */
  contacto: Contacto
  /**
   * Contexto opcional que se anexa a la marca en el eyebrow, ej. "Convenio
   * Eutanasias" → "🐾 ALMA ANIMAL · CONVENIO EUTANASIAS".
   */
  contexto?: string
}

function renderFooter(c: Contacto): string {
  const telLink = (c.telefono || '').replace(/[^\d+]/g, '')
  return `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td valign="top" style="font-family:${FONT};font-size:13px;color:${BRAND.muted};line-height:1.7">
            <p style="margin:0 0 12px;font-weight:700;color:${BRAND.navy}">¿Cualquier duda? Estamos para acompañarte.</p>
            <p style="margin:0">Correo &nbsp;<a href="mailto:${escapeHtml(c.correo)}" style="color:${BRAND.navy};text-decoration:none;font-weight:600">${escapeHtml(c.correo)}</a></p>
            <p style="margin:4px 0 0">Teléfono &nbsp;<a href="tel:${escapeHtml(telLink)}" style="color:${BRAND.navy};text-decoration:none;font-weight:600">${escapeHtml(c.telefono)}</a></p>
            <p style="margin:16px 0 0;color:${BRAND.ink}">Con cariño,<br/><strong>Equipo ${escapeHtml(c.nombre)}</strong></p>
            <p style="margin:12px 0 0;font-size:12px;font-style:italic;color:${BRAND.amber}">Huellas que no se borran.</p>
          </td>
          <td valign="bottom" align="right" width="88" style="width:88px">
            <img src="${SELLO_URL}" alt="Sello Crematorio Alma Animal — proceso con amor y respeto" width="78" height="78" style="width:78px;height:78px;display:block;border:0;outline:none" />
          </td>
        </tr>
      </table>`
}

/**
 * Arma el HTML completo de un correo con header + cuerpo + footer unificados.
 */
export function renderEmailLayout(a: LayoutArgs): string {
  const paw = `<img src="${PAW_URL}" alt="" width="15" height="15" style="display:inline-block;vertical-align:-2px;margin-right:5px;border:0" />`
  const eyebrow = a.contexto
    ? `${paw}ALMA ANIMAL · ${escapeHtml(a.contexto.toUpperCase())}`
    : `${paw}ALMA ANIMAL`
  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <meta name="color-scheme" content="light only" />
</head>
<body style="margin:0;padding:0;background:${BRAND.cream};color:${BRAND.ink}">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BRAND.cream}">
    <tr>
      <td align="center" style="padding:32px 12px">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;box-shadow:0 10px 30px rgba(20,60,100,0.10);border-radius:16px">

          <!-- Header navy -->
          <tr>
            <td style="background:${BRAND.navy};border-radius:16px 16px 0 0;padding:26px 30px">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="left" valign="middle" style="font-family:${FONT}">
                    <p style="margin:0;font-size:12px;font-weight:700;letter-spacing:2px;color:${BRAND.amber}">${eyebrow}</p>
                    <h1 style="margin:12px 0 0;font-size:25px;font-weight:800;color:#ffffff;line-height:1.22;letter-spacing:-0.2px">${escapeHtml(a.titulo)}</h1>
                  </td>
                  <td align="right" valign="middle" width="78" style="width:78px">
                    <img src="${LOGO_URL}" alt="Alma Animal" height="66" style="height:66px;width:auto;display:block;border:0;outline:none" />
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Filete dorado -->
          <tr><td style="height:4px;line-height:4px;font-size:0;background:${BRAND.amber}">&nbsp;</td></tr>

          <!-- Cuerpo -->
          <tr>
            <td style="background:#ffffff;padding:36px 34px 30px;font-family:${FONT};color:${BRAND.ink}">
${a.bodyHtml}
            </td>
          </tr>

          <!-- Footer en panel crema -->
          <tr>
            <td style="background:${BRAND.cream};border-radius:0 0 16px 16px;border-top:1px solid ${BRAND.hairline};padding:24px 34px">
${renderFooter(a.contacto)}
            </td>
          </tr>

          <!-- Pie legal -->
          <tr>
            <td style="padding:16px 8px 0;text-align:center;font-family:${FONT};font-size:11px;color:#9aa3af">
              ${escapeHtml(a.contacto.nombre)} · ${escapeHtml(a.contacto.web)}
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}
