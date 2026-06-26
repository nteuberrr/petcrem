import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Render de gráficos (lib/grafico-render.ts): @resvg/resvg-js trae un binario
  // nativo (.node) → se resuelve en runtime desde node_modules en vez de bundlearse.
  serverExternalPackages: ['@resvg/resvg-js', 'satori'],
};

export default nextConfig;
