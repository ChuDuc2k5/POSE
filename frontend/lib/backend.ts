import 'server-only';
import { cookies } from 'next/headers';
export async function backendFetch(path: string) {
  const response = await fetch(`${process.env.BACKEND_URL || 'http://127.0.0.1:3001'}${path}`, {
    headers: { Cookie: (await cookies()).toString() }, cache: 'no-store', signal: AbortSignal.timeout(10000),
  });
  return response;
}
