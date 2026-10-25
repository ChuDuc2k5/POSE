import path from 'node:path';
import type { NextConfig } from 'next';
const nextConfig: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: path.resolve(process.cwd(), '..'),
  turbopack: { root: path.resolve(process.cwd(), '..') },
  experimental: { proxyClientMaxBodySize: '22mb', proxyTimeout: 250000 },
  images: { qualities: [75, 90] },
  // Browsers still probe /favicon.ico; answer with the brand icon instead of a 404.
  async rewrites() { return [{ source: '/favicon.ico', destination: '/brand/terava-icon-navy.svg' }]; },
};
export default nextConfig;
