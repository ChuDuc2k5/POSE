export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    throw new Error('Request failed');
  }

  return response.json() as Promise<T>;
}

export const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
