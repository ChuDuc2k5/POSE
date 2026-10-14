import { NextResponse } from 'next/server';

export async function GET() {
  const response = await fetch('http://localhost:3001/properties');
  const payload = await response.json();
  return NextResponse.json(payload, { status: response.status });
}
