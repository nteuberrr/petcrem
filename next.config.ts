import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @resvg/resvg-js trae un binario nativo (.node) → no se puede bundlear; debe
  // resolverse en runtime desde node_modules (lo usa el render de gráficos satori).
  serverExternalPackages: ['@resvg/resvg-js'],
};

export default nextConfig;
