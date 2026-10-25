import path from 'node:path';
import type { NextConfig } from 'next';
const nextConfig: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: path.resolve(process.cwd(), '..'),
  turbopack: { root: path.resolve(process.cwd(), '..') },
  experimental: { proxyClientMaxBodySize: '22mb', proxyTimeout: 250000 },
  images: { qualities: [75, 90] },
};
export default nextConfig;
