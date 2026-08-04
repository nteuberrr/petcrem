<#
  Crea en el Escritorio el acceso directo «Alma Animal» con IMPRESIÓN DIRECTA.

  Para qué: desde una página web el navegador SIEMPRE muestra su diálogo de
  impresión — no hay forma de saltárselo con código. La única manera de que la
  etiqueta salga con un solo clic es abrir el navegador con `--kiosk-printing`,
  que imprime en la impresora PREDETERMINADA de Windows sin preguntar nada.

  Uso (en el PC del crematorio, PowerShell, sin permisos de administrador):
      powershell -ExecutionPolicy Bypass -File scripts\crear-acceso-impresion.ps1

  Opcionales:
      -Url  https://petcrem.vercel.app   dirección a abrir
      -Nombre "Alma Animal"              nombre del acceso directo

  Después: abrir el acceso, iniciar sesión UNA vez y dejar la impresora de
  etiquetas como predeterminada en Windows (Configuración → Bluetooth y
  dispositivos → Impresoras y escáneres → destildar «Permitir que Windows
  administre mi impresora predeterminada»).

  Detalle importante: usa un perfil de navegador APARTE (--user-data-dir). Sin
  eso, si el navegador ya está abierto, Windows reusa esa ventana y el flag de
  impresión directa se ignora en silencio. Como es un perfil nuevo, la sesión de
  la app se inicia una sola vez ahí y queda guardada.
#>
param(
  [string]$Url = 'https://petcrem.vercel.app',
  [string]$Nombre = 'Alma Animal'
)

$ErrorActionPreference = 'Stop'

# ── Navegador: Chrome primero, Edge de respaldo ──────────────────────────────
$candidatos = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe",
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
)
$navegador = $candidatos | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $navegador) { throw 'No se encontró Chrome ni Edge instalado en este equipo.' }

# Perfil propio del acceso directo (ver el comentario de arriba).
$perfil = Join-Path $env:LOCALAPPDATA 'AlmaAnimalImpresion'
if (-not (Test-Path $perfil)) { New-Item -ItemType Directory -Path $perfil | Out-Null }

$escritorio = [Environment]::GetFolderPath('Desktop')
$lnk = Join-Path $escritorio "$Nombre.lnk"

# --app= abre la app sin barra de direcciones ni pestañas (queda como un programa).
$argumentos = "--kiosk-printing --user-data-dir=`"$perfil`" --app=$Url"

$shell = New-Object -ComObject WScript.Shell
$acceso = $shell.CreateShortcut($lnk)
$acceso.TargetPath = $navegador
$acceso.Arguments = $argumentos
$acceso.WorkingDirectory = Split-Path $navegador
$acceso.IconLocation = "$navegador,0"
$acceso.Description = "$Nombre — imprime las etiquetas sin diálogo"
$acceso.Save()

Write-Host "Listo. Acceso directo creado en el Escritorio:" -ForegroundColor Green
Write-Host "  $lnk"
Write-Host "  Navegador: $navegador"
Write-Host ""
Write-Host "Falta una sola vez:" -ForegroundColor Yellow
Write-Host "  1. Abrir el acceso e iniciar sesion en la app."
Write-Host "  2. Dejar la impresora de etiquetas como PREDETERMINADA en Windows."
Write-Host "  3. Usar SIEMPRE este acceso para imprimir etiquetas."
