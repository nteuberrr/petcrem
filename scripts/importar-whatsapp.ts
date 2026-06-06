/**
 * Importa los chats históricos de WhatsApp al módulo "Mensajes" (Supabase).
 *
 * Requiere las tablas creadas (supabase/mensajes-schema.sql) y un directorio
 * con los `_chat.txt` ya extraídos, un archivo por chat, nombrado por el zip
 * original (ej. "WhatsApp Chat - +56 9 2202 8591.txt").
 *
 * Extraer primero (git-bash):
 *   WORK=/c/Users/Nicolas/wa_import; rm -rf "$WORK"; mkdir -p "$WORK"
 *   for d in "/c/Users/Nicolas/Downloads/Whatsapp 2" "/c/dev/alma-animal-marketing/conversaciones_whatsapp"; do
 *     find "$d" -name "*.zip" | while IFS= read -r f; do
 *       n=$(basename "$f" .zip); unzip -p "$f" "*_chat.txt" 2>/dev/null > "$WORK/$n.txt"; done; done
 *
 * Luego:
 *   npx tsx scripts/importar-whatsapp.ts "C:/Users/Nicolas/wa_import"
 */
import './_env-preload'
import { readFileSync, readdirSync } from 'node:fs'
import { getMensajesSupabase } from '../lib/supabase'
import { upsertContacto, getOrCreateConversacion, getMensajes, type Audiencia } from '../lib/mensajes'

const US = 'Crematorio Alma Animal'
const LINE = /^‎?\[(\d{2})-(\d{2})-(\d{2}),\s(\d{2}):(\d{2}):(\d{2})\]\s([^:]+?):\s?([\s\S]*)$/

function isVet(nombre: string): boolean {
  return /\bvet\b|veterinar|cl[ií]nica|dr\.|dra\.|petvet/i.test(nombre)
}
function tipoDe(body: string): string {
  if (/<adjunto:.*audio|audio omitido|\.opus/i.test(body)) return 'audio'
  if (/<adjunto:.*(jpg|jpeg|png|webp)|imagen omitida|PHOTO-/i.test(body)) return 'imagen'
  if (/<adjunto:|adjunto omitido|documento omitido/i.test(body)) return 'documento'
  return 'texto'
}
function esSistema(body: string): boolean {
  return /servicio seguro de Meta|Los mensajes y las llamadas est|cifrad|Llamada perdida|se eliminó|eliminaste este mensaje/i.test(body)
}

async function main() {
  const dir = process.argv[2]
  if (!dir) { console.error('Falta el directorio de chats extraídos. Ver cabecera del script.'); process.exit(1) }
  const files = readdirSync(dir).filter(f => f.toLowerCase().endsWith('.txt'))
  console.log(`Encontrados ${files.length} chats en ${dir}`)
  const sb = getMensajesSupabase()
  let okChats = 0, okMsgs = 0, skip = 0

  for (const f of files) {
    const raw = readFileSync(`${dir}/${f}`, 'utf8').split(/\r?\n/)
    const parsed: Array<{ ts: string; who: string; body: string }> = []
    for (const ln of raw) {
      const x = ln.match(LINE)
      if (x) {
        const [, dd, mm, yy, h, mi, s] = x
        const d = new Date(2000 + (+yy), (+mm) - 1, +dd, +h, +mi, +s)
        parsed.push({ ts: d.toISOString(), who: x[7].trim(), body: (x[8] || '').trim() })
      } else if (parsed.length) {
        parsed[parsed.length - 1].body += ' ' + ln.trim()
      }
    }
    const msgs = parsed.filter(m => !esSistema(m.body))
    if (msgs.length === 0) { skip++; continue }

    // Nombre/teléfono del contacto: del nombre del archivo + el display name del cliente.
    const base = f.replace(/\.txt$/i, '').replace(/^WhatsApp Chat - /i, '').trim()
    const telefono = /^\+?\d[\d\s]+$/.test(base) ? base : null
    const cliName = msgs.find(m => m.who !== US)?.who || base
    const nombre = telefono ? cliName : base
    const audiencia: Audiencia = isVet(nombre + ' ' + base) ? 'B' : 'A'

    const contacto = await upsertContacto({ telefono, nombre, audiencia })
    const conv = await getOrCreateConversacion(contacto.id, 'whatsapp', audiencia, 'historico')

    // Idempotencia: si la conversación ya tiene mensajes, no reimportar.
    const existentes = await getMensajes(conv.id)
    if (existentes.length > 0) { skip++; continue }

    const rows = msgs.map(m => ({
      conversacion_id: conv.id,
      direccion: m.who === US ? 'saliente' : 'entrante',
      cuerpo: m.body || null,
      tipo: tipoDe(m.body),
      estado: m.who === US ? 'enviado' : null,
      ts: m.ts,
    }))
    // Insert en lotes de 500
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await sb.from('mensajes_mensajes').insert(rows.slice(i, i + 500))
      if (error) { console.error(`  error en ${f}:`, error.message); break }
    }
    await sb.from('mensajes_conversaciones').update({ ultimo_mensaje_at: rows[rows.length - 1].ts }).eq('id', conv.id)
    okChats++; okMsgs += rows.length
    if (okChats % 25 === 0) console.log(`  ${okChats} chats importados…`)
  }
  console.log(`Listo. Chats importados: ${okChats} · mensajes: ${okMsgs} · saltados: ${skip}`)
}
main().catch(e => { console.error('ERROR:', e instanceof Error ? e.message : e); process.exit(1) })
