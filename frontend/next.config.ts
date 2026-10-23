import type { NextConfig } from 'next';
const nextConfig: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: process.cwd(),
  turbopack: { root: process.cwd() },
  experimental: { proxyClientMaxBodySize: '22mb' },
  images: { qualities: [75, 90] },
};
export default nextConfig;
