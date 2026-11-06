export class ApiError extends Error { constructor(message: string, public status: number) { super(message); } }
export async function api<T = { ok: boolean }>(path: string, options: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { credentials: 'same-origin', ...options, headers: options.body instanceof FormData ? options.headers : { 'Content-Type': 'application/json', ...options.headers } });
  } catch { throw new ApiError('Нет связи. Проверь интернет и попробуй ещё раз.', 0); }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(data.error || 'Не получилось сохранить. Попробуй ещё раз.', response.status);
  return data;
}
export const json = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body) });
export async function uploadPhotos(files: File[], kind: 'photo' | 'avatar') {
  const body = new FormData();
  body.set('kind', kind);
  files.forEach(file => body.append('photos', file));
  return (await api<{ ids: string[] }>('/api/uploads', { method: 'POST', body })).ids;
}
