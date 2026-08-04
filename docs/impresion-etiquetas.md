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

4. En las propiedades de la impresora, dejar el papel en **80 × 50 mm** y la
   escala en **100 % / tamaño real** (nunca «ajustar a la página»).

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
