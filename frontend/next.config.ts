import path from 'node:path';
import type { NextConfig } from 'next';
const nextConfig: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: path.resolve(process.cwd(), '..'),
  turbopack: { root: path.resolve(process.cwd(), '..') },
  experimental: { proxyClientMaxBodySize: '22mb' },
};
export default nextConfig;
