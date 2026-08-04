<#
  Diagnóstico del tamaño de papel de la impresora de etiquetas.

  Por qué existe: cuando la etiqueta sale girada y partida en dos, la culpa NO es
  de la orientación (vertical/horizontal). La orientación solo gira el contenido
  DENTRO de la hoja; el largo que la impresora avanza por etiqueta lo define el
  TAMAÑO DE PAPEL. Si el papel dice 50 × 80 y la etiqueta es 80 × 50, Windows la
  gira para que le calce y termina imprimiendo sobre 1,6 etiquetas.

  Uso (solo mira, no cambia nada):
      powershell -ExecutionPolicy Bypass -File scripts\diagnostico-impresora.ps1

  Para que ADEMÁS deje el papel en 80 × 50 mm si el driver lo ofrece:
      powershell -ExecutionPolicy Bypass -File scripts\diagnostico-impresora.ps1 -Aplicar

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
function Titulo($t) { Write-Host ""; Write-Host $t -ForegroundColor Cyan }

# ── Impresoras del equipo ────────────────────────────────────────────────────
Titulo 'IMPRESORAS INSTALADAS'
$todas = Get-Printer | Select-Object Name, DriverName, PortName
$predeterminada = (Get-CimInstance Win32_Printer | Where-Object { $_.Default } | Select-Object -First 1).Name
foreach ($p in $todas) {
  $marca = if ($p.Name -eq $predeterminada) { '  <-- PREDETERMINADA' } else { '' }
  Write-Host ("  {0}  [{1}]{2}" -f $p.Name, $p.DriverName, $marca)
}

if (-not $Impresora) { $Impresora = $predeterminada }
if (-not $Impresora) { throw 'No hay impresora predeterminada. Pasá -Impresora "Nombre".' }
Write-Host ""
Write-Host "Revisando: $Impresora" -ForegroundColor Yellow

# Vía .NET, no los cmdlets de PrintManagement: `Get-PrintCapability` no existe en
# Windows PowerShell 5.1 y `Get-PrintConfiguration` devuelve vacío con varios
# drivers térmicos. PrinterSettings los reporta bien, en centésimas de pulgada.
Add-Type -AssemblyName System.Drawing

# Cambiar el tamaño de papel por defecto no tiene cmdlet: hay que escribir el
# DEVMODE del driver. DocumentProperties deja el default DEL USUARIO (que es el
# que usa Chrome) y SetPrinter el de todo el equipo (ese sí pide admin).
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class Papel {
  [DllImport("winspool.drv", CharSet=CharSet.Unicode, SetLastError=true)]
  static extern bool OpenPrinter(string src, out IntPtr h, IntPtr pd);
  [DllImport("winspool.drv", SetLastError=true)] static extern bool ClosePrinter(IntPtr h);
  [DllImport("winspool.drv", CharSet=CharSet.Unicode, SetLastError=true)]
  static extern int DocumentProperties(IntPtr hwnd, IntPtr hPrinter, string dev, IntPtr outDm, IntPtr inDm, int mode);
  [DllImport("winspool.drv", CharSet=CharSet.Unicode, SetLastError=true)]
  static extern bool GetPrinter(IntPtr h, int level, IntPtr buf, int cb, out int need);
  [DllImport("winspool.drv", CharSet=CharSet.Unicode, SetLastError=true)]
  static extern bool SetPrinter(IntPtr h, int level, IntPtr buf, int cmd);

  const int DM_OUT_BUFFER = 2, DM_IN_BUFFER = 8;
  const int OFF_FIELDS = 72, OFF_ORIENT = 76, OFF_PAPER = 78;   // DEVMODEW
  const int DM_ORIENTATION = 0x1, DM_PAPERSIZE = 0x2;

  public static string Fijar(string printer, short kind, short orientacion) {
    IntPtr h;
    if (!OpenPrinter(printer, out h, IntPtr.Zero)) return "No se pudo abrir la impresora (" + Marshal.GetLastWin32Error() + ")";
    IntPtr dm = IntPtr.Zero, info = IntPtr.Zero;
    try {
      int size = DocumentProperties(IntPtr.Zero, h, printer, IntPtr.Zero, IntPtr.Zero, 0);
      if (size <= 0) return "DocumentProperties no devolvio tamano";
      dm = Marshal.AllocHGlobal(size);
      if (DocumentProperties(IntPtr.Zero, h, printer, dm, IntPtr.Zero, DM_OUT_BUFFER) < 0) return "No se pudo leer el DEVMODE";

      int fields = Marshal.ReadInt32(dm, OFF_FIELDS);
      Marshal.WriteInt32(dm, OFF_FIELDS, fields | DM_PAPERSIZE | DM_ORIENTATION);
      Marshal.WriteInt16(dm, OFF_PAPER, kind);
      Marshal.WriteInt16(dm, OFF_ORIENT, orientacion);
      // Que el driver valide/normalice, y de paso guarde el default del usuario.
      if (DocumentProperties(IntPtr.Zero, h, printer, dm, dm, DM_IN_BUFFER | DM_OUT_BUFFER) < 0) return "El driver rechazo el DEVMODE";

      int need;
      GetPrinter(h, 2, IntPtr.Zero, 0, out need);
      info = Marshal.AllocHGlobal(need);
      if (!GetPrinter(h, 2, info, need, out need)) return "GetPrinter fallo (" + Marshal.GetLastWin32Error() + ")";
      int p = IntPtr.Size;
      Marshal.WriteIntPtr(info, 7 * p, dm);            // pDevMode
      Marshal.WriteIntPtr(info, 12 * p, IntPtr.Zero);  // pSecurityDescriptor
      if (!SetPrinter(h, 2, info, 0)) return "SetPrinter fallo (" + Marshal.GetLastWin32Error() + ")";
      return "OK";
    } finally {
      if (dm != IntPtr.Zero) Marshal.FreeHGlobal(dm);
      if (info != IntPtr.Zero) Marshal.FreeHGlobal(info);
      ClosePrinter(h);
    }
  }
}
'@

$ps = New-Object System.Drawing.Printing.PrinterSettings
$ps.PrinterName = $Impresora
if (-not $ps.IsValid) { throw "Windows no reconoce la impresora '$Impresora'." }
$aMm = { param($cent) [math]::Round($cent * 0.254, 1) }   # 1/100 pulgada -> mm

# ── Cómo está configurada hoy ────────────────────────────────────────────────
Titulo 'CONFIGURACION ACTUAL'
$actualPs = $ps.DefaultPageSettings.PaperSize
$aw = & $aMm $actualPs.Width; $ah = & $aMm $actualPs.Height
Write-Host ("  Tamano de papel : {0}  ({1} x {2} mm)" -f $actualPs.PaperName, $aw, $ah)
Write-Host ("  Orientacion     : {0}" -f $(if ($ps.DefaultPageSettings.Landscape) { 'Horizontal' } else { 'Vertical' }))

# ── Qué tamaños ofrece el driver ─────────────────────────────────────────────
Titulo 'TAMANOS DE PAPEL QUE OFRECE EL DRIVER'
$medias = @()
foreach ($m in $ps.PaperSizes) {
  $medias += [pscustomobject]@{ Nombre = $m.PaperName; Ancho = (& $aMm $m.Width); Alto = (& $aMm $m.Height) }
}
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
Write-Host ("  Hoy imprime en {0} x {1} mm." -f $aw, $ah)
if ([math]::Abs($aw - $Ancho) -le 2 -and [math]::Abs($ah - $Alto) -le 2) {
  Write-Host "  Esta CORRECTO: coincide con la etiqueta." -ForegroundColor Green
} else {
  Write-Host ("  NO coincide con la etiqueta de {0} x {1} mm -> por eso sale girada / partida." -f $Ancho, $Alto) -ForegroundColor Red
}

if ($calza) {
  $destino = $calza | Select-Object -First 1
  if ($Aplicar) {
    # Se escribe el DEVMODE por usuario con DocumentProperties, que es el default
    # que después lee Chrome. `Set-PrintConfiguration -PaperSize` NO sirve acá:
    # solo acepta nombres estándar (A4, Letter…), no los del driver de etiquetas.
    # SetPrinter (el default de TODO el equipo) necesita admin; si no lo hay, el
    # del usuario ya alcanza y el script lo dice.
    $kind = ($ps.PaperSizes | Where-Object { $_.PaperName -eq $destino.Nombre } | Select-Object -First 1).RawKind
    # Papel de 80 ancho × 50 alto ⇒ la etiqueta horizontal es orientación VERTICAL
    # (1). Poner "horizontal" acá la gira y la parte: es la confusión de siempre.
    $r = [Papel]::Fijar($Impresora, [int16]$kind, [int16]1)
    $ver = New-Object System.Drawing.Printing.PrinterSettings
    $ver.PrinterName = $Impresora
    $sz = $ver.DefaultPageSettings.PaperSize
    if ([math]::Abs((& $aMm $sz.Width) - $Ancho) -le 2) {
      Write-Host ("  LISTO: papel = '{0}' ({1} x {2} mm), orientacion vertical." -f $sz.PaperName, (& $aMm $sz.Width), (& $aMm $sz.Height)) -ForegroundColor Green
      if ($r -ne 'OK') { Write-Host "  (solo para tu usuario: para dejarlo para todo el equipo, corre esto como administrador)" -ForegroundColor DarkGray }
      Write-Host "  Cerra y volve a abrir el acceso directo antes de imprimir."
    } else {
      Write-Host "  No se pudo aplicar: $r" -ForegroundColor Red
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
