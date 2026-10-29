export class CatalogRequestError extends Error {
  constructor(
    message: string,
    public fields: Record<string, string> = {},
    public code = '',
  ) {
    super(message);
  }
}
const timeoutMs = 20000;
export async function catalogRequest<T>(url: string, init?: RequestInit): Promise<T> {
  // A stalled backend must surface as an error with a retry button, never as an endless spinner.
  // Only reads time out: uploads and saves may legitimately take longer and must not be retried blindly.
  const read = !init?.method || init.method.toUpperCase() === 'GET';
  const timeout = read ? AbortSignal.timeout(timeoutMs) : null;
  const signal = timeout && init?.signal ? AbortSignal.any([init.signal, timeout]) : (timeout ?? init?.signal);
  let response: Response;
  try {
    response = await fetch(url, { cache: 'no-store', ...init, signal });
  } catch (cause) {
    if (init?.signal?.aborted) throw cause;
    throw new CatalogRequestError(
      timeout?.aborted
        ? 'Máy chủ phản hồi quá lâu. Vui lòng thử lại.'
        : 'Không kết nối được máy chủ. Vui lòng kiểm tra backend và thử lại.',
      {},
      timeout?.aborted ? 'TIMEOUT' : 'NETWORK',
    );
  }
  const data = await response.json().catch(() => null);
  if (!data)
    throw new CatalogRequestError(
      response.ok ? 'Phản hồi từ máy chủ không hợp lệ.' : 'Máy chủ đang gặp sự cố. Vui lòng thử lại.',
      {},
      'BAD_RESPONSE',
    );
  if (!response.ok)
    throw new CatalogRequestError(data.message || 'Không thể xử lý yêu cầu.', data.field_errors || {}, data.code || '');
  return data as T;
}
