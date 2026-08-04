<#
  Diagnóstico del tamaño de papel de la impresora de etiquetas.

  Por qué existe: cuando la etiqueta sale girada, partida en dos o achicada, la
  culpa NO es de la orientación (vertical/horizontal). La orientación solo gira el
  contenido DENTRO de la hoja; el largo que la impresora avanza por etiqueta lo
  define el TAMAÑO DE PAPEL. Si el papel no coincide con la etiqueta, Windows la
  gira o la escala para que le calce y sale cualquier cosa.

  Uso (solo mira, no cambia nada):
      powershell -ExecutionPolicy Bypass -File scripts\diagnostico-impresora.ps1

  Para que ADEMÁS deje el papel en el tamaño pedido, si el driver lo ofrece:
      powershell -ExecutionPolicy Bypass -File scripts\diagnostico-impresora.ps1 -Ancho 100 -Alto 150 -Aplicar

  Para el día a día es más cómodo scripts\papel.ps1 (100x150 y listo), y para que
  se ajuste solo, scripts\ayudante-impresion.ps1.

  Opcional: -Impresora "Nombre exacto"  (por defecto, la predeterminada)
#>
param(
  [string]$Impresora,
  [switch]$Aplicar,
  # Medidas de la etiqueta, en mm (ancho × alto).
  [double]$Ancho = 80,
  [double]$Alto = 50
)

$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\_impresora-comun.ps1"
function Titulo($t) { Write-Host ""; Write-Host $t -ForegroundColor Cyan }

# ── Impresoras del equipo ────────────────────────────────────────────────────
Titulo 'IMPRESORAS INSTALADAS'
$predeterminada = Get-ImpresoraPredeterminada
foreach ($p in (Get-Printer | Select-Object Name, DriverName)) {
  $marca = if ($p.Name -eq $predeterminada) { '  <-- PREDETERMINADA' } else { '' }
  Write-Host ("  {0}  [{1}]{2}" -f $p.Name, $p.DriverName, $marca)
}

if (-not $Impresora) { $Impresora = $predeterminada }
if (-not $Impresora) { throw 'No hay impresora predeterminada. Pasá -Impresora "Nombre".' }
Write-Host ""
Write-Host "Revisando: $Impresora" -ForegroundColor Yellow

# ── Cómo está configurada hoy ────────────────────────────────────────────────
Titulo 'CONFIGURACION ACTUAL'
$actual = Get-PapelActual $Impresora
Write-Host ("  Tamano de papel : {0}  ({1} x {2} mm)" -f $actual.Nombre, $actual.Ancho, $actual.Alto)
Write-Host ("  Orientacion     : {0}" -f $(if ($actual.Horizontal) { 'Horizontal' } else { 'Vertical' }))

# ── Qué tamaños ofrece el driver ─────────────────────────────────────────────
Titulo 'TAMANOS DE PAPEL QUE OFRECE EL DRIVER'
$medias = Get-PapelesDisponibles $Impresora
if (-not $medias) { Write-Host '  (el driver no reporta tamanos)' -ForegroundColor DarkGray }

# Tolerancia de 2 mm: los drivers redondean (79,8 × 50,1 y esas cosas).
$calza = $medias | Where-Object { [math]::Abs($_.Ancho - $Ancho) -le 2 -and [math]::Abs($_.Alto - $Alto) -le 2 }
$alReves = $medias | Where-Object { [math]::Abs($_.Ancho - $Alto) -le 2 -and [math]::Abs($_.Alto - $Ancho) -le 2 }

foreach ($m in $medias) {
  $nota = ''
  if ($calza -contains $m) { $nota = '   <== ESTE ES (' + $Ancho + ' x ' + $Alto + ')' }
  elseif ($alReves -contains $m) { $nota = '   (al reves: girado)' }
  Write-Host ("  {0,-34} {1,6} x {2,-6} mm{3}" -f $m.Nombre, $m.Ancho, $m.Alto, $nota)
}

# ── Veredicto ────────────────────────────────────────────────────────────────
Titulo 'RESULTADO'
Write-Host ("  Hoy imprime en {0} x {1} mm." -f $actual.Ancho, $actual.Alto)
if ([math]::Abs($actual.Ancho - $Ancho) -le 2 -and [math]::Abs($actual.Alto - $Alto) -le 2) {
  Write-Host "  Esta CORRECTO: coincide con la etiqueta." -ForegroundColor Green
} else {
  Write-Host ("  NO coincide con la etiqueta de {0} x {1} mm -> por eso sale girada / achicada." -f $Ancho, $Alto) -ForegroundColor Red
}

if ($calza) {
  $destino = $calza | Select-Object -First 1
  if ($Aplicar) {
    $r = Set-Papel $Impresora $Ancho $Alto
    if ($r.ok) {
      Write-Host ("  LISTO: papel = '{0}' ({1} x {2} mm), orientacion vertical." -f $r.papel, $r.ancho, $r.alto) -ForegroundColor Green
      if ($r.soloUsuario) { Write-Host "  (solo para tu usuario: para dejarlo para todo el equipo, corre esto como administrador)" -ForegroundColor DarkGray }
      Write-Host "  Cerra y volve a abrir el acceso directo antes de imprimir."
    } else {
      Write-Host "  No se pudo aplicar: $($r.error)" -ForegroundColor Red
      Write-Host "  Hacelo a mano: Preferencias de impresion -> Tamano de papel -> '$($destino.Nombre)'."
    }
  } else {
    Write-Host ("  El driver SI tiene el tamano correcto: '{0}'." -f $destino.Nombre) -ForegroundColor Green
    Write-Host "  Para dejarlo puesto, corre este mismo script con -Aplicar"
  }
} else {
  Write-Host ("  El driver NO ofrece un papel de {0} x {1} mm." -f $Ancho, $Alto) -ForegroundColor Yellow
  Write-Host "  Hay que crearlo: Preferencias de impresion -> Configurar pagina / Avanzadas"
  Write-Host "  -> 'Personalizado' o 'Definir tamano', ancho $Ancho mm y alto $Alto mm."
  Write-Host "  Varias impresoras termicas lo crean desde su propia utilidad, no desde Windows."
}
Write-Host ""
