# Etiquetas de despacho — impresión en un clic

La etiqueta es de **80 × 50 mm horizontal** y se imprime desde la ficha del cliente:
el botón **Imprimir etiqueta** la manda derecho a la impresora. El ojo de al lado
abre la vista previa, por si hay que revisarla antes.

## Por qué hace falta configurar algo en el PC

Desde una página web **el navegador siempre muestra su diálogo de impresión**. Es
un bloqueo del navegador por seguridad: ninguna web puede elegir la impresora ni
imprimir en silencio, no importa cómo esté escrita la app. Lo máximo que puede
hacer el código es abrir ese diálogo con la etiqueta ya cargada, que es lo que
hace hoy.

Para que la etiqueta salga **sin ningún diálogo**, el navegador tiene que estar
abierto con la opción `--kiosk-printing`, que imprime en la impresora
**predeterminada** de Windows sin preguntar. Eso se configura una sola vez.

## Configuración (una vez, en el PC del crematorio)

1. Abrir PowerShell en la carpeta del proyecto y correr:

   ```powershell
   powershell -ExecutionPolicy Bypass -File scripts\crear-acceso-impresion.ps1
   ```

   Crea en el Escritorio un acceso directo **«Alma Animal»**. Detecta Chrome y,
   si no está, usa Edge.

2. Abrir ese acceso e **iniciar sesión** en la app (una sola vez: usa un perfil
   de navegador propio, así que la sesión queda guardada ahí).

3. Dejar la **impresora de etiquetas como predeterminada** en Windows:
   *Configuración → Bluetooth y dispositivos → Impresoras y escáneres* → elegir
   la impresora → **Establecer como predeterminada**, y **destildar** «Permitir
   que Windows administre mi impresora predeterminada» (si no, Windows la cambia
   sola a la última que se usó).

4. **El paso que más se pasa por alto:** dejar el **tamaño de papel de la
   impresora en 80 × 50 mm** (80 de ancho, 50 de alto). Va en *Impresoras y
   escáneres → la impresora → Preferencias de impresión → Tamaño de papel*; si
   no existe ese tamaño, se crea con «Personalizado / Definir tamaño». Y la
   escala en **100 % / tamaño real**, nunca «ajustar a la página».

## Si la etiqueta sale girada o partida en dos

Es el **tamaño de papel** del driver, no la app y **no la orientación**. Cambiar
vertical/horizontal no arregla nada: la orientación solo gira el contenido dentro
de la hoja, mientras que el largo que la impresora avanza por etiqueta lo define
el tamaño de papel. Si el papel no mide 80 × 50, Windows gira la etiqueta para
que le calce y el contenido se estira sobre más de una etiqueta — sale la mitad
del texto de costado en una y el resto en la siguiente.

**Ojo con la orientación:** el papel `80mm x 50mm` ya es 80 de ancho por 50 de
alto, así que la etiqueta horizontal corresponde a orientación **vertical**.
Poner «horizontal» ahí es justamente lo que la gira.

Para verlo y arreglarlo:

```powershell
# Solo diagnostica: qué papel tiene puesto y cuáles ofrece el driver
powershell -ExecutionPolicy Bypass -File scripts\diagnostico-impresora.ps1

# Además lo deja en 80 × 50 mm vertical
powershell -ExecutionPolicy Bypass -File scripts\diagnostico-impresora.ps1 -Aplicar
```

(En el equipo del crematorio el papel estaba en **48 × 60 mm**; ahí estaba el
problema.) El script escribe el DEVMODE del driver: no hay cmdlet para esto,
`Set-PrintConfiguration -PaperSize` solo acepta tamaños estándar tipo A4 o Letter,
no los del driver de etiquetas. Deja el valor para el usuario actual, que es el
que después lee Chrome; con permisos de administrador lo deja para todo el equipo.

Del lado de la app, el trabajo de impresión ya declara `@page { size: 80mm 50mm }`,
o sea el papel correcto — pero si el driver no tiene ese tamaño puesto, manda él.

Desde ahí, **usar siempre ese acceso directo** para trabajar: un clic en
«Imprimir etiqueta» y la etiqueta sale.

> Si se abre la app desde el navegador normal, todo funciona igual pero
> aparecerá el diálogo de impresión. No se rompe nada, solo hay un clic más.

## Dónde vive esto en el código

- PDF de la etiqueta: [lib/etiqueta-despacho.ts](../lib/etiqueta-despacho.ts)
  (medidas y datos en [lib/etiqueta-datos.ts](../lib/etiqueta-datos.ts), que es
  también la fuente de la vista previa, así que lo que se ve es lo que se imprime).
- Endpoint: `GET /api/clientes/[id]/etiqueta`.
- Botón e impresión: `imprimirEtiqueta` en
  [app/(dashboard)/clientes/[id]/page.tsx](<../app/(dashboard)/clientes/[id]/page.tsx>).
