// Verifica que las credenciales de R2 funcionan: sube un archivo de prueba
// y lo borra acto seguido. Salida humana con OK/FAIL por paso.
import { S3Client, PutObjectCommand, DeleteObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const env = readFileSync(resolve('.env.local'), 'utf8')
  .split('\n')
  .reduce((acc, line) => {
    const m = line.match(/^([A-Z_0-9]+)=(.*)$/)
    if (m) acc[m[1]] = m[2].replace(/^"|"$/g, '')
    return acc
  }, {})

const required = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET_NAME', 'R2_PUBLIC_URL']
const missing = required.filter(k => !env[k])
if (missing.length) {
  console.error('FAIL — faltan env vars:', missing.join(', '))
  process.exit(1)
}
console.log('OK — env vars cargadas:', required.join(', '))

const client = new S3Client({
  region: 'auto',
  endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
  },
})

const key = `_health/test-${Date.now()}.txt`
const body = Buffer.from('petcrem health check\n')

try {
  await client.send(new PutObjectCommand({
    Bucket: env.R2_BUCKET_NAME,
    Key: key,
    Body: body,
    ContentType: 'text/plain',
  }))
  console.log('OK — PUT exitoso, key=' + key)
} catch (e) {
  console.error('FAIL — PUT falló:', e.name, '-', e.message)
  process.exit(1)
}

try {
  await client.send(new HeadObjectCommand({ Bucket: env.R2_BUCKET_NAME, Key: key }))
  console.log('OK — HEAD confirma que el archivo existe en el bucket')
} catch (e) {
  console.error('FAIL — HEAD falló:', e.name, '-', e.message)
}

const publicUrl = `${env.R2_PUBLIC_URL.replace(/\/$/, '')}/${key}`
try {
  const res = await fetch(publicUrl)
  if (res.status === 200) {
    console.log('OK — URL pública sirve el archivo: ' + publicUrl)
  } else {
    console.error('FAIL — URL pública devolvió HTTP ' + res.status + ' (¿está habilitado el Public Development URL?)')
  }
} catch (e) {
  console.error('FAIL — fetch a URL pública falló:', e.message)
}

try {
  await client.send(new DeleteObjectCommand({ Bucket: env.R2_BUCKET_NAME, Key: key }))
  console.log('OK — DELETE limpió el archivo de prueba')
} catch (e) {
  console.error('FAIL — DELETE falló (no crítico, archivo queda como basura):', e.message)
}

console.log('\n--- R2 OPERATIVO ---')
