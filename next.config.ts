import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Render de gráficos (lib/grafico-render.ts): @resvg/resvg-js trae un binario
  // nativo (.node) → se resuelve en runtime desde node_modules en vez de bundlearse.
  // @napi-rs/canvas y ffmpeg-static también traen binarios (el canvas de Skia y
  // el ejecutable de ffmpeg) que arma el video del servidor.
  // `sharp` va acá por lo MISMO: trae un .node que a su vez carga libvips
  // (libvips-cpp.so) desde su propia carpeta. Si el bundler se lo lleva, el
  // binario queda sin su biblioteca y TODA llamada a sharp falla en runtime con
  // "libvips-cpp.so.8.x: cannot open shared object file" — mientras en local,
  // que resuelve desde node_modules, funciona perfecto.
  //
  // ⚠️ Faltaba, y el 19-08-2026 pasar sharp a import DINÁMICO (lib/sharp-lazy,
  // para que no arrastrara al webhook) lo destapó: con el import estático el
  // trazado de Next igual lo dejaba resolver; con el dinámico, no. Rompió en
  // silencio tres cosas a la vez y ninguna dio error visible — las historias de
  // despedida dejaron de publicarse, los gráficos de marketing quedaron en PNG
  // (que Instagram RECHAZA) y el catálogo salió sin sus fotos.
  serverExternalPackages: ['@resvg/resvg-js', 'satori', '@napi-rs/canvas', 'ffmpeg-static', 'sharp'],
  // El route handler del sitio público lee sus plantillas HTML de disco en runtime;
  // hay que incluir la carpeta en el bundle serverless de Vercel.
  outputFileTracingIncludes: {
    '/sitio/[[...slug]]': ['./lib/sitio/templates/**/*'],
    // El render del video necesita el BINARIO de ffmpeg (el trazado no lo ve,
    // porque la ruta sale de una variable) y la tipografía de marca + el logo,
    // que se leen de public/ en runtime.
    '/api/marketing/**': [
      './node_modules/ffmpeg-static/ffmpeg*',
      './public/sitio/assets/*Inter-*.woff',
      './public/brand/*.png',
    ],
    '/api/mailing/agente': [
      './node_modules/ffmpeg-static/ffmpeg*',
      './public/sitio/assets/*Inter-*.woff',
      './public/brand/*.png',
    ],
  },
};

export default nextConfig;
