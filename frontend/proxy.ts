import { NextResponse, type NextRequest } from 'next/server';

export function proxy(request: NextRequest) {
  const backend = process.env.BACKEND_URL || 'http://127.0.0.1:3001';
  return NextResponse.rewrite(new URL(request.nextUrl.pathname + request.nextUrl.search, backend));
}

export const config = {
  matcher: ['/api/:path*', '/auth/confirm', '/auth/refresh', '/socket.io/:path*'],
};
