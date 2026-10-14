import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  const body = await request.json();

  const response = await fetch('http://localhost:3001/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const payload = await response.json();

  return NextResponse.json(payload, { status: response.status });
}
