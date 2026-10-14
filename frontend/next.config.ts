import type { NextConfig } from 'next';
const backend = process.env.BACKEND_URL || 'http://127.0.0.1:3001';
const nextConfig: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: process.cwd(),
  turbopack: { root: process.cwd() },
  experimental: { proxyClientMaxBodySize: '22mb' },
  async rewrites() {
    return [
      { source: '/socket.io/:path*', destination: `${backend}/socket.io/:path*` },
      { source: '/api/:path*', destination: `${backend}/api/:path*` },
      { source: '/auth/confirm', destination: `${backend}/auth/confirm` },
      { source: '/auth/refresh', destination: `${backend}/auth/refresh` },
    ];
  },
};
export default nextConfig;
