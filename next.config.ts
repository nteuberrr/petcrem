import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Render de gráficos (lib/grafico-render.ts): @resvg/resvg-js trae un binario
  // nativo (.node) → se resuelve en runtime desde node_modules en vez de bundlearse.
  serverExternalPackages: ['@resvg/resvg-js', 'satori'],
  // El route handler del sitio público lee sus plantillas HTML de disco en runtime;
  // hay que incluir la carpeta en el bundle serverless de Vercel.
  outputFileTracingIncludes: {
    '/sitio/[[...slug]]': ['./lib/sitio/templates/**/*'],
  },
};

export default nextConfig;
