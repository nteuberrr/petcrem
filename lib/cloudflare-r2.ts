import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

let cachedClient: S3Client | null = null

function getClient(): S3Client {
  if (cachedClient) return cachedClient
  const accountId = process.env.R2_ACCOUNT_ID
  const accessKeyId = process.env.R2_ACCESS_KEY_ID
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY
  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error('R2 no configurado: faltan R2_ACCOUNT_ID, R2_ACCESS_KEY_ID o R2_SECRET_ACCESS_KEY')
  }
  cachedClient = new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  })
  return cachedClient
}

export type R2UploadResult = { key: string; url: string }

export async function uploadToR2(
  buffer: Buffer,
  key: string,
  contentType: string,
): Promise<R2UploadResult> {
  const bucket = process.env.R2_BUCKET_NAME
  const publicBase = (process.env.R2_PUBLIC_URL || '').replace(/\/$/, '')
  if (!bucket) throw new Error('R2 no configurado: falta R2_BUCKET_NAME')
  if (!publicBase) throw new Error('R2 no configurado: falta R2_PUBLIC_URL')

  // El firmador del AWS SDK rechaza buffers respaldados por un SharedArrayBuffer
  // (los devuelven, p.ej., resvg y sharp en Linux/Vercel) al hashear el payload:
  // «The "input" argument must be ... ArrayBuffer ... SharedArrayBuffer». Si el body
  // viene así, lo copiamos a un ArrayBuffer normal antes de firmar/subir.
  const body: Buffer | Uint8Array =
    (typeof SharedArrayBuffer !== 'undefined' && buffer.buffer instanceof SharedArrayBuffer)
      ? new Uint8Array(buffer)
      : buffer

  const client = getClient()
  await client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: body,
    ContentType: contentType,
  }))

  return { key, url: `${publicBase}/${key}` }
}

export type R2PresignedPut = { uploadUrl: string; publicUrl: string; key: string }

/**
 * Genera una URL prefirmada para que el navegador suba un objeto a R2 con un
 * PUT directo (evita el límite de body de las funciones de Vercel — necesario
 * para videos). El bucket R2 debe tener una política CORS que permita PUT desde
 * el origen de la app. Devuelve también la URL pública final.
 */
export async function getPresignedPutUrl(
  key: string,
  contentType: string,
  expiresSeconds = 900,
): Promise<R2PresignedPut> {
  const bucket = process.env.R2_BUCKET_NAME
  const publicBase = (process.env.R2_PUBLIC_URL || '').replace(/\/$/, '')
  if (!bucket) throw new Error('R2 no configurado: falta R2_BUCKET_NAME')
  if (!publicBase) throw new Error('R2 no configurado: falta R2_PUBLIC_URL')
  const client = getClient()
  const uploadUrl = await getSignedUrl(
    client,
    new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType }),
    { expiresIn: expiresSeconds },
  )
  return { uploadUrl, publicUrl: `${publicBase}/${key}`, key }
}

/** Deriva la key de R2 a partir de su URL pública (o null si no corresponde). */
export function keyFromPublicUrl(url: string): string | null {
  const publicBase = (process.env.R2_PUBLIC_URL || '').replace(/\/$/, '')
  if (!publicBase || !url.startsWith(publicBase + '/')) return null
  return url.slice(publicBase.length + 1)
}

export async function getFromR2(key: string): Promise<Buffer | null> {
  const bucket = process.env.R2_BUCKET_NAME
  if (!bucket) throw new Error('R2 no configurado: falta R2_BUCKET_NAME')
  try {
    const client = getClient()
    const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }))
    if (!res.Body) return null
    const stream = res.Body as { transformToByteArray: () => Promise<Uint8Array> }
    const bytes = await stream.transformToByteArray()
    return Buffer.from(bytes)
  } catch {
    return null
  }
}

export async function deleteFromR2(key: string): Promise<boolean> {
  const bucket = process.env.R2_BUCKET_NAME
  if (!bucket) throw new Error('R2 no configurado: falta R2_BUCKET_NAME')
  try {
    const client = getClient()
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }))
    return true
  } catch {
    return false
  }
}
