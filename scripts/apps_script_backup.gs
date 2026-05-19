/**
 * PetCrem — Backup automático del Google Sheet
 * -----------------------------------------------------------
 * Guarda una copia completa del Sheet en una carpeta
 * "DataBase AlmaAnimal Systems" cada 48 horas a las 00:00 (hora Chile).
 * -----------------------------------------------------------
 * Instalación: ver README debajo del código (1 click, una sola vez).
 */

const SPREADSHEET_ID = '1VRYE3ngbH4hIbXp1Cd9hXJrlAr5Ru1HGRtv3v_YrFeE'
const FOLDER_NAME = 'DataBase AlmaAnimal Systems'
const TIMEZONE = 'America/Santiago'
// Si querés mantener solo los últimos N backups, poné un número. 0 = sin límite.
const MAX_BACKUPS_A_CONSERVAR = 0

/**
 * Crea la copia del Sheet en la carpeta destino.
 * Esta es la función que dispara el trigger cada 48h.
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

  if (MAX_BACKUPS_A_CONSERVAR > 0) rotarBackups()
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
    if (f.getName().indexOf('petcrem_backup_') === 0) {
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
 * EJECUTAR UNA SOLA VEZ para programar el trigger automático.
 * Después de esto, queda corriendo solo cada 48h.
 *
 * Esquema: cada 2 días, en la ventana de 00:00 a 01:00 hora Chile.
 * Apps Script no garantiza el minuto exacto — la ventana es de ~1 hora.
 */
function setupTrigger() {
  // Limpiar triggers previos para evitar duplicados
  const triggers = ScriptApp.getProjectTriggers()
  for (let i = 0; i < triggers.length; i++) {
    const h = triggers[i].getHandlerFunction()
    if (h === 'crearBackup' || h === 'crearBackupSiCorresponde') {
      ScriptApp.deleteTrigger(triggers[i])
    }
  }

  ScriptApp.newTrigger('crearBackup')
    .timeBased()
    .atHour(0)         // 00:00 hora local
    .everyDays(2)      // cada 2 días = cada 48h
    .create()

  Logger.log('✓ Trigger programado: cada 48 horas a las 00:00 (' + TIMEZONE + ')')
}

/**
 * Sirve para testear manualmente que el backup funciona.
 * Crea backup inmediato sin esperar al trigger.
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
   INSTALACIÓN (hacer una sola vez — toma ~30 segundos):

   1. Abrí tu Google Sheet:
      https://docs.google.com/spreadsheets/d/1VRYE3ngbH4hIbXp1Cd9hXJrlAr5Ru1HGRtv3v_YrFeE

   2. Menú: Extensiones → Apps Script
      Se abre un editor en pestaña nueva (script.google.com)

   3. Borrá lo que aparece por defecto. Pegá TODO este archivo.

   4. (Importante) Configurá el TZ del proyecto:
      Engranaje ⚙ "Configuración del proyecto" → "Zona horaria" → America/Santiago.

   5. Dale nombre al proyecto: "PetCrem Backup" (arriba a la izquierda).
      Click "Guardar" (ícono disquete o Ctrl+S).

   6. Arriba, seleccioná la función "setupTrigger" del dropdown y clic en "Ejecutar".
      La primera vez te va a pedir permisos:
        - "Revisar permisos" → elegí tu cuenta Google
        - "Avanzada → Ir a PetCrem Backup (no seguro)" → Permitir
      Es porque el script no está verificado por Google, pero es tu propio código.

   7. Listo. Para verificar que quedó:
        - Ícono de reloj ⏰ (Disparadores) en la barra izquierda
        - Tiene que aparecer: "crearBackup — Basado en tiempo — Cada 2 días 0am-1am"

   8. (Opcional) Probar AHORA sin esperar 2 días:
        - Seleccioná "backupManualDePrueba" → Ejecutar
        - En Drive aparece la carpeta "DataBase AlmaAnimal Systems" con el archivo

   CRONOGRAMA:
     - Cada 48 horas, en la ventana de 00:00 a 01:00 hora Chile.
     - Apps Script triggers no son al minuto exacto — la ventana es de ~1h.

   DESACTIVAR:
     - Extensiones → Apps Script → Disparadores (ícono reloj)
     - Click en los 3 puntos del trigger → Eliminar
============================================================ */
