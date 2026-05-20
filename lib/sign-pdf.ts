import forge from 'node-forge'
import { SignPdf } from '@signpdf/signpdf'
import { P12Signer } from '@signpdf/signer-p12'

export interface SignerInfo {
  /** Nombre que se muestra en el sello visual y en el panel de Adobe */
  name: string
  /** CN del certificado tal como viene en el .p12 */
  commonName: string
  /** Issuer (autoridad certificadora) */
  issuer: string
  /** Cert vence en esta fecha; afecta la validez de firmas no-timestamped */
  notAfter: Date
}

interface LoadedCert {
  p12Buffer: Buffer
  password: string
  info: SignerInfo
}

let cached: LoadedCert | 'unavailable' | null = null

function loadCert(): LoadedCert | null {
  if (cached === 'unavailable') return null
  if (cached) return cached

  const b64 = process.env.CERT_P12_BASE64
  const password = process.env.CERT_P12_PASSWORD
  if (!b64 || !password) {
    console.warn('[sign-pdf] CERT_P12_BASE64 o CERT_P12_PASSWORD no configurados; firma cripto deshabilitada.')
    cached = 'unavailable'
    return null
  }

  try {
    const p12Buffer = Buffer.from(b64, 'base64')
    const p12Der = p12Buffer.toString('binary')
    const p12Asn1 = forge.asn1.fromDer(p12Der)
    const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, password)

    const certBags = p12.getBags({ bagType: forge.pki.oids.certBag })
    const certBag = certBags[forge.pki.oids.certBag]?.[0]
    if (!certBag?.cert) throw new Error('No se encontró un certificado dentro del .p12')

    const cert = certBag.cert
    const cnAttr = cert.subject.getField('CN')
    const issuerCnAttr = cert.issuer.getField('CN')
    const commonName = cnAttr?.value ?? '(sin CN)'
    const issuer = issuerCnAttr?.value ?? '(sin issuer CN)'

    const info: SignerInfo = {
      name: process.env.CERT_SIGNER_NAME?.trim() || commonName,
      commonName,
      issuer,
      notAfter: cert.validity.notAfter,
    }

    cached = { p12Buffer, password, info }
    console.log(`[sign-pdf] cert cargado: CN="${commonName}" issuer="${issuer}" expira=${info.notAfter.toISOString()}`)
    return cached
  } catch (err) {
    console.error('[sign-pdf] fallo al parsear .p12:', err)
    cached = 'unavailable'
    return null
  }
}

export function isSigningEnabled(): boolean {
  return loadCert() !== null
}

export function getSignerInfo(): SignerInfo | null {
  return loadCert()?.info ?? null
}

export async function firmarPDF(pdfBuffer: Buffer): Promise<Buffer> {
  const loaded = loadCert()
  if (!loaded) throw new Error('Firma cripto no disponible: cert no cargado')

  const signer = new P12Signer(loaded.p12Buffer, { passphrase: loaded.password })
  const signpdf = new SignPdf()
  return signpdf.sign(pdfBuffer, signer)
}
