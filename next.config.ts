import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Render de gráficos (lib/grafico-render.ts): @resvg/resvg-js trae un binario
  // nativo (.node) → se resuelve en runtime desde node_modules en vez de bundlearse.
  // @napi-rs/canvas y ffmpeg-static también traen binarios (el canvas de Skia y
  // el ejecutable de ffmpeg) que arma el video del servidor.
  serverExternalPackages: ['@resvg/resvg-js', 'satori', '@napi-rs/canvas', 'ffmpeg-static'],
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
