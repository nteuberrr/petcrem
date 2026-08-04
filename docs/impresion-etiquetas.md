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

## El tamaño de papel se ajusta solo (ayudante de impresión)

Hay tres formatos de etiqueta y **cada uno necesita su tamaño de papel puesto en
la impresora**. Un navegador no puede tocar el driver, así que de eso se encarga
un ayudante que corre en el mismo PC:

```powershell
# Instalar: arranca ahora y queda arrancando con Windows
powershell -ExecutionPolicy Bypass -File scripts\ayudante-impresion.ps1 -Instalar

# Sacarlo
powershell -ExecutionPolicy Bypass -File scripts\ayudante-impresion.ps1 -Desinstalar
```

Con eso, cada vez que se imprime desde la app, el papel queda en el tamaño de esa
etiqueta antes de mandar el trabajo — incluido el caso importante: **volver solo a
80 × 50 al imprimir una etiqueta de despacho**, aunque antes se hayan impreso
fichas. Sin el ayudante todo sigue funcionando; solo hay que poner el papel a
mano (ver abajo).

Cómo está hecho: escucha en `127.0.0.1:47811` (nadie de la red llega), solo
responde a las páginas de Alma Animal, y lo único que sabe hacer es cambiar el
tamaño de papel de la impresora predeterminada. La app lo llama desde
[lib/imprimir-html.ts](../lib/imprimir-html.ts) con un tiempo de espera corto: si
no está, imprime igual.

Si el driver no trae un tamaño, **se crea solo** como formulario de Windows
(`AddForm`) y recién ahí se aplica — así se resolvió el 60 × 60 del sticker, que
el GD985 no traía. Si aun así no se puede, la app lo avisa en pantalla en vez de
imprimir mal en silencio.

## Cambiar el papel a mano

Sirve si no se instaló el ayudante, o para dejarlo puesto antes de una tanda:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\papel.ps1 80x50     # despacho
powershell -ExecutionPolicy Bypass -File scripts\papel.ps1 100x150   # ficha de retiro
powershell -ExecutionPolicy Bypass -File scripts\papel.ps1 60x60     # sticker del logo
powershell -ExecutionPolicy Bypass -File scripts\papel.ps1           # muestra el actual
```

Para no escribirlo nunca más, `scripts\papel.ps1 -Accesos` deja los tres como
accesos directos en el Escritorio: doble clic al que corresponda y listo. (Con el
ayudante instalado esto casi no hace falta: se hace desde la propia página.)

Si no se cambia, la etiqueta sale mal de forma llamativa: mandarle un diseño de
100 × 150 a un papel de 80 × 50 hace que Windows lo **gire y lo achique a la
mitad**, y queda un bloque chico de tinta en una esquina.

**Sobre el 60 × 60 del sticker:** el driver GD985 no lo traía (tiene 40, 48, 72,
76, 80, 94, 100 y 108 de ancho, ninguno de 60). Ya está creado como formulario de
Windows, y si algún día falta se vuelve a crear solo al pedirlo.

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
