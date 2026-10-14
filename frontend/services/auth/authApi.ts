export async function login(email: string, password: string) {
  const response = await fetch('http://localhost:3001/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.message ?? 'Login failed');
  }

  return payload;
}
