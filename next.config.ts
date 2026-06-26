import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Render de gráficos (lib/grafico-render.ts): se resuelven en runtime desde
  // node_modules en vez de bundlearse.
  //  - @resvg/resvg-js: binario nativo (.node) que no se puede bundlear.
  //  - satori: carga su WASM de Yoga por ruta; al bundlearlo el WASM no se incluye
  //    y falla en runtime con «The "input" argument must be ... ArrayBuffer».
  serverExternalPackages: ['@resvg/resvg-js', 'satori'],
};

export default nextConfig;
