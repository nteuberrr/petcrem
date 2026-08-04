<#
  Piezas compartidas para hablar con la impresora de etiquetas.
  Lo usan scripts\diagnostico-impresora.ps1 y scripts\ayudante-impresion.ps1
  (dot-source: `. "$PSScriptRoot\_impresora-comun.ps1"`).

  Por qué P/Invoke y no un cmdlet: Windows no tiene forma de cambiar el tamaño de
  papel por defecto. `Set-PrintConfiguration -PaperSize` solo acepta tamaños
  estándar (A4, Letter…), no los que define el driver de etiquetas. Hay que
  escribir el DEVMODE: DocumentProperties deja el default DEL USUARIO —que es el
  que después lee Chrome— y SetPrinter el de todo el equipo, que pide admin.
#>

Add-Type -AssemblyName System.Drawing

if (-not ([System.Management.Automation.PSTypeName]'Papel').Type) {
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
}

# Centésimas de pulgada -> mm (así reporta PrinterSettings).
function ConvertTo-Mm([double]$centesimas) { [math]::Round($centesimas * 0.254, 1) }

function Get-ImpresoraPredeterminada {
  (Get-CimInstance Win32_Printer | Where-Object { $_.Default } | Select-Object -First 1).Name
}

function Get-Ajustes([string]$impresora) {
  $ps = New-Object System.Drawing.Printing.PrinterSettings
  $ps.PrinterName = $impresora
  if (-not $ps.IsValid) { throw "Windows no reconoce la impresora '$impresora'." }
  $ps
}

# Tamaño de papel puesto hoy, en mm.
function Get-PapelActual([string]$impresora) {
  $ps = Get-Ajustes $impresora
  $s = $ps.DefaultPageSettings.PaperSize
  [pscustomobject]@{
    Nombre = $s.PaperName
    Ancho  = ConvertTo-Mm $s.Width
    Alto   = ConvertTo-Mm $s.Height
    Horizontal = [bool]$ps.DefaultPageSettings.Landscape
  }
}

# Todos los tamaños que ofrece el driver, en mm.
function Get-PapelesDisponibles([string]$impresora) {
  (Get-Ajustes $impresora).PaperSizes | ForEach-Object {
    [pscustomobject]@{ Nombre = $_.PaperName; Ancho = (ConvertTo-Mm $_.Width); Alto = (ConvertTo-Mm $_.Height); Kind = $_.RawKind }
  }
}

<#
  Deja la impresora en el tamaño pedido. Tolerancia de 2 mm porque los drivers
  redondean (79,8 × 50,1 y esas cosas). Orientación SIEMPRE vertical: el papel
  ya viene declarado ancho × alto, y ponerlo "horizontal" es justo lo que gira
  la etiqueta y la parte en dos.
#>
function Set-Papel([string]$impresora, [double]$ancho, [double]$alto) {
  $medias = Get-PapelesDisponibles $impresora
  $destino = $medias | Where-Object { [math]::Abs($_.Ancho - $ancho) -le 2 -and [math]::Abs($_.Alto - $alto) -le 2 } | Select-Object -First 1
  if (-not $destino) {
    return [pscustomobject]@{ ok = $false; error = "El driver no ofrece un papel de $ancho x $alto mm"; disponibles = $medias }
  }
  $actual = Get-PapelActual $impresora
  if ($actual.Nombre -eq $destino.Nombre -and -not $actual.Horizontal) {
    return [pscustomobject]@{ ok = $true; yaEstaba = $true; papel = $destino.Nombre; ancho = $destino.Ancho; alto = $destino.Alto }
  }
  $r = [Papel]::Fijar($impresora, [int16]$destino.Kind, [int16]1)
  $ahora = Get-PapelActual $impresora
  if ([math]::Abs($ahora.Ancho - $ancho) -le 2 -and [math]::Abs($ahora.Alto - $alto) -le 2) {
    # $r distinto de OK = no se pudo dejar para TODO el equipo (pide admin), pero
    # el default del usuario sí quedó, que es el que usa Chrome.
    return [pscustomobject]@{ ok = $true; yaEstaba = $false; papel = $ahora.Nombre; ancho = $ahora.Ancho; alto = $ahora.Alto; soloUsuario = ($r -ne 'OK') }
  }
  [pscustomobject]@{ ok = $false; error = $r }
}
