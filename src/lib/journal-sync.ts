import type { Bootstrap } from '../../shared/types';
import { ApiError } from './api';

type Request = <T = { ok: boolean }>(path: string, options?: RequestInit) => Promise<T>;
const newScope = () => ({ userId: null as number | null, read: 0, writes: 0, pending: new Map<string, Promise<void>>(), retries: new Map<string, string>() });

// One coordinator for every read/write, including focus, push and reconnect.
// A confirmed write stays successful even if its subsequent refresh fails.
export class JournalSync {
  private scope = newScope();
  constructor(private request: Request, private changed: (state: Bootstrap | null) => void, private syncIssue: (message: string) => void, private makeKey = () => crypto.randomUUID()) {}
  reset() { this.scope = newScope(); this.syncIssue(''); }
  async refresh() {
    const scope = this.scope;
    if (scope.writes) return;
    const read = ++scope.read;
    try {
      const fresh = await this.request<Bootstrap>('/api/bootstrap');
      if (scope !== this.scope || read !== scope.read || scope.writes) return;
      if (!fresh?.user?.id || !Array.isArray(fresh.reviews) || !Array.isArray(fresh.users) || !fresh.statistics) throw new ApiError('Не получилось прочитать ленту. Обнови её ещё раз.', 502);
      if (scope.userId !== null && scope.userId !== fresh.user.id) this.reset();
      this.scope.userId = fresh.user.id;
      this.changed(fresh); this.syncIssue('');
    } catch (error) {
      if (scope !== this.scope || read !== scope.read) return;
      if (error instanceof ApiError && error.status === 401) { this.reset(); this.changed(null); }
      throw error;
    }
  }
  save(path: string, options: RequestInit): Promise<void> {
    const scope = this.scope;
    const method = (options.method || 'GET').toUpperCase();
    const signature = `${method}:${path}:${typeof options.body === 'string' ? options.body : ''}`;
    const existing = scope.pending.get(signature);
    if (existing) return existing;
    const needsReceipt = method === 'POST' && (path === '/api/reviews' || /^\/api\/reviews\/\d+\/comments$/.test(path));
    let requestOptions = options;
    if (needsReceipt) {
      if (!scope.retries.has(signature)) {
        if (scope.retries.size >= 30) scope.retries.delete(scope.retries.keys().next().value!);
        scope.retries.set(signature, this.makeKey());
      }
      const headers = new Headers(options.headers);
      headers.set('Idempotency-Key', scope.retries.get(signature)!);
      requestOptions = { ...options, headers };
    }
    scope.writes++; scope.read++;
    const operation = (async () => {
      let failure: unknown, failed = false;
      try { await this.request(path, requestOptions); scope.retries.delete(signature); }
      catch (error) {
        failure = error; failed = true;
        if (error instanceof ApiError && error.status >= 400 && error.status < 500) scope.retries.delete(signature);
        if (scope === this.scope && error instanceof ApiError && error.status === 401) { this.reset(); this.changed(null); }
      } finally { scope.writes--; }
      const rotated = !failed && path === '/api/profile/password' && scope === this.scope;
      if (rotated) this.reset();
      if (rotated || scope === this.scope && !scope.writes) {
        try { await this.refresh(); }
        catch {
          if (rotated || scope === this.scope) this.syncIssue(failed ? 'Лента пока не обновилась. Когда связь вернётся, нажми «Обновить».' : 'Изменение сохранено. Лента пока не обновилась — нажми «Обновить», когда вернётся связь.');
        }
      }
      if (failed) throw failure;
    })().finally(() => scope.pending.delete(signature));
    scope.pending.set(signature, operation);
    return operation;
  }
}
