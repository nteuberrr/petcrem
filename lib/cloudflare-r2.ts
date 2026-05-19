import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'

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

  const client = getClient()
  await client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: buffer,
    ContentType: contentType,
  }))

  return { key, url: `${publicBase}/${key}` }
}
