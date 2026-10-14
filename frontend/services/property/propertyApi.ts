export async function getProperties() {
  const response = await fetch('http://localhost:3001/properties', { cache: 'no-store' });
  if (!response.ok) {
    throw new Error('Unable to load properties');
  }
  return response.json();
}

export async function getPropertyById(id: string) {
  const response = await fetch(`http://localhost:3001/properties/${id}`, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error('Unable to load property');
  }
  return response.json();
}
