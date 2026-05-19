import { google } from 'googleapis'
import { Readable } from 'stream'

function getAuth() {
  const privateKey = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n')
  return new google.auth.JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: privateKey,
    scopes: ['https://www.googleapis.com/auth/drive'],
  })
}

export type UploadResult = { fileId: string; viewUrl: string; downloadUrl: string }

export async function uploadFile(
  buffer: Buffer,
  filename: string,
  mimeType: string,
  folderId?: string,
): Promise<UploadResult> {
  const drive = google.drive({ version: 'v3', auth: getAuth() })
  const parent = folderId ?? process.env.GOOGLE_DRIVE_FOLDER_ID

  const stream = Readable.from(buffer)
  const res = await drive.files.create({
    requestBody: {
      name: filename,
      parents: parent ? [parent] : undefined,
    },
    media: { mimeType, body: stream },
    fields: 'id,webViewLink,webContentLink',
  })

  const fileId = res.data.id!
  await drive.permissions.create({
    fileId,
    requestBody: { role: 'reader', type: 'anyone' },
  })

  return {
    fileId,
    viewUrl: res.data.webViewLink ?? `https://drive.google.com/file/d/${fileId}/view`,
    downloadUrl: `https://drive.google.com/uc?id=${fileId}`,
  }
}

export async function uploadImage(
  buffer: Buffer,
  filename: string,
  mimeType: string
): Promise<string> {
  const { downloadUrl } = await uploadFile(buffer, filename, mimeType)
  return downloadUrl
}
