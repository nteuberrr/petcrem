<#
  Cambia el tamaño de papel de la impresora de etiquetas, corto y al grano.

      powershell -ExecutionPolicy Bypass -File scripts\papel.ps1 80x50     <- despacho
      powershell -ExecutionPolicy Bypass -File scripts\papel.ps1 100x150   <- ficha de retiro
      powershell -ExecutionPolicy Bypass -File scripts\papel.ps1 60x60     <- sticker del logo
      powershell -ExecutionPolicy Bypass -File scripts\papel.ps1           <- solo muestra el actual

  Hay que correrlo al cambiar de rollo: la app le declara el tamaño al trabajo de
  impresión, pero si el driver está en otro, manda el driver y la etiqueta sale
  girada o achicada. Con -Accesos deja un acceso directo por tamaño en el
  Escritorio, para hacerlo con doble clic.

  Es un envoltorio de scripts\diagnostico-impresora.ps1, que es el que hace el
  trabajo (y el que explica qué ofrece el driver si el tamaño no existe).
#>
param(
  [Parameter(Position = 0)][string]$Tamano,
  [switch]$Accesos
)

$ErrorActionPreference = 'Stop'
$aqui = Split-Path -Parent $MyInvocation.MyCommand.Path
$diag = Join-Path $aqui 'diagnostico-impresora.ps1'

# ── Accesos directos en el Escritorio, uno por tamaño ────────────────────────
if ($Accesos) {
  $escritorio = [Environment]::GetFolderPath('Desktop')
  $shell = New-Object -ComObject WScript.Shell
  foreach ($t in @(
      @{ n = 'Papel 80x50 (despacho)';   a = 80;  b = 50 },
      @{ n = 'Papel 100x150 (ficha)';    a = 100; b = 150 },
      @{ n = 'Papel 60x60 (sticker)';    a = 60;  b = 60 }
    )) {
    $lnk = $shell.CreateShortcut((Join-Path $escritorio "$($t.n).lnk"))
    $lnk.TargetPath = 'powershell.exe'
    $lnk.Arguments = "-ExecutionPolicy Bypass -File `"$diag`" -Ancho $($t.a) -Alto $($t.b) -Aplicar"
    $lnk.WorkingDirectory = $aqui
    $lnk.Description = "Deja la impresora de etiquetas en $($t.a) x $($t.b) mm"
    $lnk.Save()
    Write-Host "  creado: $($t.n)" -ForegroundColor Green
  }
  Write-Host "Listo: doble clic en el acceso del tamano que vayas a imprimir."
  return
}

if (-not $Tamano) { & $diag; return }

if ($Tamano -notmatch '^\s*(\d+)\s*[xX*]\s*(\d+)\s*$') {
  throw "Tamano invalido: '$Tamano'. Se escribe ANCHOxALTO en mm, por ejemplo 100x150."
}
& $diag -Ancho ([double]$Matches[1]) -Alto ([double]$Matches[2]) -Aplicar
