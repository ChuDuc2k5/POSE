export class CatalogRequestError extends Error {
  constructor(message: string, public fields: Record<string,string> = {}, public code = '') { super(message); }
}
export async function catalogRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: 'no-store', ...init });
  const data = await response.json();
  if (!response.ok) throw new CatalogRequestError(data.message || 'Không thể xử lý yêu cầu.', data.field_errors || {}, data.code || '');
  return data as T;
}
