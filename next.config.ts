import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Render de gráficos (lib/grafico-render.ts): se resuelven en runtime desde
  // node_modules en vez de bundlearse (binario nativo / WASM).
  serverExternalPackages: ['@resvg/resvg-js', 'satori'],
  // Asegura que los .wasm de satori/yoga y el binario de resvg viajen a la función
  // serverless (en Vercel, si no se trazan, falla con «input ... ArrayBuffer»).
  outputFileTracingIncludes: {
    '/api/**': [
      './node_modules/@resvg/resvg-js-linux-x64-gnu/**',
      './node_modules/yoga-layout/**',
      './node_modules/satori/**',
    ],
  },
};

export default nextConfig;
