<#
  Ayudante de impresión de Alma Animal.

  Qué resuelve: la app sabe qué etiqueta estás imprimiendo (despacho 80 × 50,
  ficha de retiro 100 × 150, sticker 60 × 60), pero un navegador NO puede tocar
  la impresora. Si el papel del driver quedó en otro tamaño, la etiqueta sale
  girada o achicada — y el caso feo es olvidarse de volver a 80 × 50 después de
  imprimir fichas, porque ahí se arruinan todas las de despacho del día.

  Este programita escucha en la propia máquina (127.0.0.1) y deja el papel en el
  tamaño que le pidan. La app lo llama justo antes de imprimir; si no está
  corriendo, imprime igual (no bloquea nada, solo pierde el automatismo).

  Uso:
      # Instalar: arranca ahora y queda arrancando con Windows
      powershell -ExecutionPolicy Bypass -File scripts\ayudante-impresion.ps1 -Instalar

      # Sacarlo
      powershell -ExecutionPolicy Bypass -File scripts\ayudante-impresion.ps1 -Desinstalar

      # Correrlo a mano, viendo lo que hace (Ctrl+C para cortar)
      powershell -ExecutionPolicy Bypass -File scripts\ayudante-impresion.ps1

  Seguridad: escucha SOLO en 127.0.0.1 (nadie de la red llega), y solo responde a
  las páginas de Alma Animal (-Origenes). Lo único que sabe hacer es cambiar el
  tamaño de papel de la impresora predeterminada.
#>
param(
  [switch]$Instalar,
  [switch]$Desinstalar,
  [int]$Puerto = 47811,
  [string]$Impresora,
  [string[]]$Origenes = @('https://petcrem.vercel.app', 'http://localhost:3000')
)

$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\_impresora-comun.ps1"

$nombreAcceso = 'Alma Animal - ayudante de impresion.lnk'
$inicio = [Environment]::GetFolderPath('Startup')
$lnk = Join-Path $inicio $nombreAcceso

# ── Instalar / desinstalar ───────────────────────────────────────────────────
function Detener {
  # Solo los que están SIRVIENDO (sin -Instalar/-Desinstalar en la línea), y
  # nunca este mismo proceso.
  Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue |
    Where-Object {
      $_.CommandLine -like '*ayudante-impresion.ps1*' -and
      $_.CommandLine -notmatch '-(Instalar|Desinstalar)' -and
      $_.ProcessId -ne $PID
    } |
    ForEach-Object {
      try { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop; Write-Host "  detenido (PID $($_.ProcessId))" } catch { }
    }
}

if ($Desinstalar) {
  if (Test-Path $lnk) {
    Remove-Item $lnk -Force -ErrorAction SilentlyContinue
    Write-Host "Sacado del inicio de Windows." -ForegroundColor Green
  } else {
    Write-Host "No estaba en el inicio de Windows."
  }
  Detener
  Write-Host "Listo."
  exit 0
}

if ($Instalar) {
  Detener   # si ya había uno, el puerto queda libre para el nuevo
  $shell = New-Object -ComObject WScript.Shell
  $a = $shell.CreateShortcut($lnk)
  $a.TargetPath = 'powershell.exe'
  # -WindowStyle Hidden: corre sin ventana, no molesta al operador.
  $a.Arguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$PSCommandPath`" -Puerto $Puerto"
  $a.WorkingDirectory = $PSScriptRoot
  $a.Description = 'Deja la impresora en el tamano de etiqueta que corresponda'
  $a.Save()
  Write-Host "Instalado: arranca con Windows." -ForegroundColor Green
  Write-Host "  $lnk"
  # Arrancarlo ya, sin esperar al proximo login.
  Start-Process powershell -ArgumentList "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$PSCommandPath`" -Puerto $Puerto"
  Start-Sleep -Milliseconds 800
  try {
    $r = Invoke-RestMethod "http://127.0.0.1:$Puerto/estado" -TimeoutSec 3
    Write-Host "Andando. Papel actual: $($r.papel) ($($r.ancho) x $($r.alto) mm)" -ForegroundColor Green
  } catch {
    Write-Host "Instalado, pero no respondio todavia. Revisalo corriendo el script a mano." -ForegroundColor Yellow
  }
  exit 0
}

# ── El servidor ──────────────────────────────────────────────────────────────
if (-not $Impresora) { $Impresora = Get-ImpresoraPredeterminada }
if (-not $Impresora) { throw 'No hay impresora predeterminada.' }

$listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, $Puerto)
try { $listener.Start() } catch { throw "No se pudo escuchar en el puerto $Puerto (¿ya hay otro ayudante corriendo?): $($_.Exception.Message)" }
Write-Host "Ayudante de impresion escuchando en http://127.0.0.1:$Puerto  ·  impresora: $Impresora" -ForegroundColor Green

function Responder($stream, [int]$codigo, [string]$cuerpo, [string]$origen) {
  $texto = if ($codigo -eq 204) { '' } else { $cuerpo }
  $bytes = [Text.Encoding]::UTF8.GetBytes($texto)
  $estado = @{ 200 = 'OK'; 204 = 'No Content'; 400 = 'Bad Request'; 403 = 'Forbidden'; 404 = 'Not Found'; 500 = 'Internal Server Error' }[$codigo]
  $cabeceras = @(
    "HTTP/1.1 $codigo $estado",
    "Content-Type: application/json; charset=utf-8",
    "Content-Length: $($bytes.Length)",
    "Cache-Control: no-store",
    # CORS. `Allow-Private-Network` es lo que pide Chrome para dejar que una
    # página pública hable con algo de la red local (Private Network Access).
    "Access-Control-Allow-Origin: $origen",
    "Access-Control-Allow-Methods: GET, OPTIONS",
    "Access-Control-Allow-Headers: content-type",
    "Access-Control-Allow-Private-Network: true",
    "Access-Control-Max-Age: 86400",
    "Connection: close",
    "", ""
  ) -join "`r`n"
  $todo = [Text.Encoding]::UTF8.GetBytes($cabeceras)
  $stream.Write($todo, 0, $todo.Length)
  if ($bytes.Length) { $stream.Write($bytes, 0, $bytes.Length) }
  $stream.Flush()
}

while ($true) {
  $cliente = $null
  try {
    $cliente = $listener.AcceptTcpClient()
    $cliente.ReceiveTimeout = 2000
    $stream = $cliente.GetStream()

    # Leer la petición (son cortitas: request line + cabeceras).
    $buffer = New-Object byte[] 4096
    $leidos = $stream.Read($buffer, 0, $buffer.Length)
    if ($leidos -le 0) { continue }
    $pedido = [Text.Encoding]::UTF8.GetString($buffer, 0, $leidos)
    $lineas = $pedido -split "`r`n"
    $partes = $lineas[0] -split ' '
    $metodo = $partes[0]
    $ruta = if ($partes.Length -gt 1) { $partes[1] } else { '/' }
    $origen = ($lineas | Where-Object { $_ -match '^(?i)Origin:\s*(.+)$' } | ForEach-Object { $Matches[1].Trim() } | Select-Object -First 1)

    # Solo las páginas de Alma Animal. Sin Origin (curl, pruebas) también pasa.
    if ($origen -and ($Origenes -notcontains $origen)) {
      Responder $stream 403 '{"ok":false,"error":"origen no permitido"}' '*'
      continue
    }
    $permitido = if ($origen) { $origen } else { '*' }

    if ($metodo -eq 'OPTIONS') { Responder $stream 204 '' $permitido; continue }

    $camino = ($ruta -split '\?')[0]
    $query = @{}
    if ($ruta -match '\?(.+)$') {
      foreach ($p in ($Matches[1] -split '&')) {
        $kv = $p -split '=', 2
        if ($kv.Length -eq 2) { $query[$kv[0]] = [uri]::UnescapeDataString($kv[1]) }
      }
    }

    switch ($camino) {
      '/estado' {
        $a = Get-PapelActual $Impresora
        Responder $stream 200 (@{ ok = $true; impresora = $Impresora; papel = $a.Nombre; ancho = $a.Ancho; alto = $a.Alto } | ConvertTo-Json -Compress) $permitido
      }
      '/papel' {
        $an = [double]($query['ancho']); $al = [double]($query['alto'])
        if (-not $an -or -not $al) { Responder $stream 400 '{"ok":false,"error":"faltan ancho y alto"}' $permitido; continue }
        $r = Set-Papel $Impresora $an $al
        # `disponibles` es una lista larga que no le sirve al navegador.
        $salida = $r | Select-Object * -ExcludeProperty disponibles | ConvertTo-Json -Compress
        Write-Host ("{0}  {1} x {2} -> {3}" -f (Get-Date -Format 'HH:mm:ss'), $an, $al, $(if ($r.ok) { 'ok' } else { $r.error }))
        Responder $stream $(if ($r.ok) { 200 } else { 400 }) $salida $permitido
      }
      default { Responder $stream 404 '{"ok":false,"error":"no existe"}' $permitido }
    }
  } catch {
    Write-Host "Error atendiendo: $($_.Exception.Message)" -ForegroundColor DarkYellow
  } finally {
    if ($cliente) { $cliente.Close() }
  }
}
