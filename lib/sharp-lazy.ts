export type SharpFactory = (typeof import('sharp'))['default']

/**
 * `sharp` cargado BAJO DEMANDA, no al importar el módulo.
 *
 * Por qué existe (incidente del 19-08-2026): `sharp` es una librería NATIVA y su
 * binario depende del sistema operativo. Un `import sharp from 'sharp'` arriba de
 * un archivo lo mete en el grafo estático de todo lo que lo importe, aunque esa
 * ruta no vaya a tocar una imagen jamás. Así el **webhook de WhatsApp** terminó
 * dependiendo de sharp por tres caminos distintos (agente → banco de imágenes,
 * banco → logo de marca, acciones → catálogo en PDF): cuando el binario de Linux
 * quedó desalineado con su libvips en un build de Vercel
 * (`libvips-cpp.so.8.18.3: cannot open shared object file`), el bot dejó de
 * responder — 500 en cada mensaje entrante, con Meta reintentando encima.
 *
 * Con la carga diferida, un sharp roto solo rompe lo que de verdad procesa
 * imágenes (marketing, catálogo, memorial); la operación —mensajes, retiros,
 * eutanasias— sigue en pie.
 *
 * ⚠️ No volver a poner `import sharp from 'sharp'` en un módulo que la operación
 * pueda alcanzar. Para verificarlo: `npx tsx scripts/verificar-sharp-aislado.ts`.
 */
export async function getSharp(): Promise<SharpFactory> {
  return (await import('sharp')).default
}
