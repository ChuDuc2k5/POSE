import { NextResponse, type NextRequest } from 'next/server';

// Temporary Next.js endpoints until the M08 ports are complete.
const nextServedApi = ['/api/admin/calls', '/api/calls', '/api/contacts', '/api/system/calls', '/api/webhooks'];

export function proxy(request: NextRequest) {
  if (nextServedApi.some(prefix => request.nextUrl.pathname === prefix || request.nextUrl.pathname.startsWith(prefix + '/'))) return NextResponse.next();
  const backend = process.env.BACKEND_URL || 'http://127.0.0.1:3001';
  return NextResponse.rewrite(new URL(request.nextUrl.pathname + request.nextUrl.search, backend));
}

export const config = {
  matcher: ['/api/:path*', '/auth/confirm', '/auth/refresh', '/socket.io/:path*'],
};
