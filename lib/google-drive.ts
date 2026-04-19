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

export async function uploadImage(
  buffer: Buffer,
  filename: string,
  mimeType: string
): Promise<string> {
  const drive = google.drive({ version: 'v3', auth: getAuth() })
  const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID

  const stream = Readable.from(buffer)
  const res = await drive.files.create({
    requestBody: {
      name: filename,
      parents: folderId ? [folderId] : undefined,
    },
    media: { mimeType, body: stream },
    fields: 'id,webViewLink,webContentLink',
  })

  const fileId = res.data.id!
  await drive.permissions.create({
    fileId,
    requestBody: { role: 'reader', type: 'anyone' },
  })

  return `https://drive.google.com/uc?id=${fileId}`
}
