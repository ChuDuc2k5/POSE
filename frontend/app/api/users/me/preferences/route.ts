import { NextResponse } from 'next/server';

export async function PATCH(request: Request) {
  const body = await request.json();
  const authorization = request.headers.get('authorization');

  const response = await fetch('http://localhost:3001/users/me/preferences', {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      ...(authorization ? { Authorization: authorization } : {}),
    },
    body: JSON.stringify(body),
  });

  return NextResponse.json(await response.json(), { status: response.status });
}