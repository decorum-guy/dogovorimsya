export class ApiError extends Error { constructor(message: string, public status: number) { super(message); } }
export async function api<T = { ok: boolean }>(path: string, options: RequestInit = {}): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (options.signal?.aborted) controller.abort();
  options.signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, options.body instanceof FormData ? 180_000 : 30_000);
  const headers = new Headers(options.headers);
  if (!(options.body instanceof FormData) && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  try {
    const response = await fetch(path, { credentials: 'same-origin', ...options, signal: controller.signal, headers });
    let data: any;
    try { data = await response.json(); }
    catch {
      if (response.ok) throw new ApiError('Не получилось прочитать ответ сервера. Проверь связь и повтори запрос.', 502);
      throw new ApiError('Сервер временно недоступен. Попробуй ещё раз.', response.status);
    }
    if (!response.ok) throw new ApiError(typeof data?.error === 'string' ? data.error : 'Не получилось сохранить. Попробуй ещё раз.', response.status);
    return data;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(controller.signal.aborted ? 'Запрос занял слишком много времени. Проверь связь и попробуй ещё раз.' : 'Нет связи. Проверь интернет и попробуй ещё раз.', 0);
  } finally { clearTimeout(timer); options.signal?.removeEventListener('abort', abort); }
}
export const json = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body) });
export async function uploadPhotos(files: File[], kind: 'photo' | 'avatar') {
  const body = new FormData();
  body.set('kind', kind);
  files.forEach(file => body.append('photos', file));
  return (await api<{ ids: string[] }>('/api/uploads', { method: 'POST', body })).ids;
}
