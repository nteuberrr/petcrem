/**
 * PetCrem — Backup automático del Google Sheet
 * -----------------------------------------------------------
 * Guarda una copia completa del Sheet en una carpeta "Database"
 * los días: 5, 10, 15, 20, 25 y último día del mes.
 * Si el mes tiene 31 días, corre el día 30 Y el 31.
 * -----------------------------------------------------------
 * Instalación: ver README debajo del código.
 */

const SPREADSHEET_ID = '1VRYE3ngbH4hIbXp1Cd9hXJrlAr5Ru1HGRtv3v_YrFeE'
const FOLDER_NAME = 'Database'
const TIMEZONE = 'America/Santiago'
// Si querés mantener solo los últimos N backups, poné un número. 0 = sin límite.
const MAX_BACKUPS_A_CONSERVAR = 0

/**
 * Función que se ejecuta diariamente vía trigger.
 * Decide si hoy corresponde hacer backup.
 */
function crearBackupSiCorresponde() {
  const now = new Date()
  const day = now.getDate()
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
  const fixedDays = [5, 10, 15, 20, 25]

  const shouldRun =
    fixedDays.includes(day) ||
    day === lastDay ||                           // último día del mes (28/29/30/31)
    (lastDay === 31 && day === 30)               // también el 30 si el mes tiene 31

  if (!shouldRun) {
    Logger.log('Hoy es ' + day + '. No corresponde backup (días: 5, 10, 15, 20, 25, 30 y fin de mes).')
    return
  }

  crearBackup()
  if (MAX_BACKUPS_A_CONSERVAR > 0) rotarBackups()
}

/**
 * Crea la copia del Sheet en la carpeta Database.
 */
function crearBackup() {
  const folder = getOrCreateFolder(FOLDER_NAME)
  const original = DriveApp.getFileById(SPREADSHEET_ID)

  const now = new Date()
  const fecha = Utilities.formatDate(now, TIMEZONE, 'yyyy-MM-dd')
  const hora = Utilities.formatDate(now, TIMEZONE, 'HH-mm')
  const nombre = 'petcrem_backup_' + fecha + '_' + hora

  const copy = original.makeCopy(nombre, folder)
  Logger.log('✓ Backup creado: ' + copy.getName() + ' (' + copy.getId() + ')')
  return copy
}

/**
 * Borra backups más viejos que MAX_BACKUPS_A_CONSERVAR.
 */
function rotarBackups() {
  const folder = getOrCreateFolder(FOLDER_NAME)
  const files = folder.getFilesByType(MimeType.GOOGLE_SHEETS)
  const backups = []
  while (files.hasNext()) {
    const f = files.next()
    if (f.getName().startsWith('petcrem_backup_')) {
      backups.push({ file: f, date: f.getDateCreated() })
    }
  }
  backups.sort(function (a, b) { return b.date.getTime() - a.date.getTime() })
  const toDelete = backups.slice(MAX_BACKUPS_A_CONSERVAR)
  toDelete.forEach(function (b) {
    b.file.setTrashed(true)
    Logger.log('✗ Backup viejo eliminado: ' + b.file.getName())
  })
}

function getOrCreateFolder(name) {
  const folders = DriveApp.getFoldersByName(name)
  if (folders.hasNext()) return folders.next()
  return DriveApp.createFolder(name)
}

/**
 * EJECUTAR UNA SOLA VEZ para programar el trigger diario.
 * Después de esto, queda corriendo solo.
 */
function setupTrigger() {
  // Limpiar triggers previos
  const triggers = ScriptApp.getProjectTriggers()
  for (let i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'crearBackupSiCorresponde') {
      ScriptApp.deleteTrigger(triggers[i])
    }
  }

  ScriptApp.newTrigger('crearBackupSiCorresponde')
    .timeBased()
    .atHour(3)         // 03:00 hora local
    .everyDays(1)
    .create()

  Logger.log('✓ Trigger programado: diario a las 03:00 AM (' + TIMEZONE + ')')
}

/**
 * Sirve para testear manualmente que el backup funciona.
 * Ignora la lógica de fechas y crea backup inmediato.
 */
function backupManualDePrueba() {
  crearBackup()
}

/**
 * Lista los triggers activos (útil para verificar).
 */
function listarTriggers() {
  const triggers = ScriptApp.getProjectTriggers()
  triggers.forEach(function (t) {
    Logger.log(
      t.getHandlerFunction() + ' — ' +
      t.getEventType() + ' — ' +
      (t.getTriggerSource ? t.getTriggerSource() : '')
    )
  })
  if (triggers.length === 0) Logger.log('Sin triggers activos.')
}

/* ============================================================
   INSTALACIÓN (hacer una sola vez):

   1. Abre tu Google Sheet:
      https://docs.google.com/spreadsheets/d/1VRYE3ngbH4hIbXp1Cd9hXJrlAr5Ru1HGRtv3v_YrFeE

   2. Menú: Extensiones → Apps Script
      Se abre un editor en pestaña nueva (script.google.com)

   3. Borra el código que aparece por defecto. Pega TODO este archivo.

   4. Dale nombre al proyecto: "PetCrem Backup" (arriba a la izquierda).

   5. Arriba, seleccioná la función "setupTrigger" del dropdown y clic en "Ejecutar".
      La primera vez te va a pedir permisos:
        - "Revisar permisos" → elegí tu cuenta Google
        - "Avanzada → Ir a PetCrem Backup (no seguro)" → Permitir
      Esto es porque el script no está verificado por Google, pero es tu propio código.

   6. Ya quedó programado. Para verificar:
        - Vas al ícono de reloj ⏰ (Disparadores) en la barra izquierda
        - Debería aparecer "crearBackupSiCorresponde — Basado en tiempo — Cada día 03:00"

   7. (Opcional) Probar que funciona ahora mismo:
        - Seleccioná la función "backupManualDePrueba" → Ejecutar
        - En Drive debe aparecer la carpeta "Database" con un archivo "petcrem_backup_YYYY-MM-DD_HH-mm"

   CRONOGRAMA:
     - Se ejecuta todos los días a las 3:00 AM hora Chile
     - Sólo crea backup si el día es: 5, 10, 15, 20, 25, o último del mes
     - Si el mes tiene 31 días, crea backup el 30 y el 31

   DESACTIVAR:
     - Extensiones → Apps Script → Disparadores (ícono reloj)
     - Click en los 3 puntos del trigger → Eliminar
============================================================ */
