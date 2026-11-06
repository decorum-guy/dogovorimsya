import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { DB } from './db.js';
import { HttpError } from './errors.js';

// Call inside the same transaction as the mutation and its push event.
// A lost HTTP response can then be retried without duplicating either.
export function once<T>(db: DB, userId: number, header: string | undefined, path: string, input: unknown, change: () => T): T {
  if (!header) return change(); // Old clients remain compatible until refreshed.
  const key = z.string().uuid().parse(header);
  const hash = createHash('sha256').update(JSON.stringify([path, input])).digest('hex');
  const saved = db.prepare('SELECT request_hash, response FROM write_receipts WHERE user_id = ? AND request_key = ?').get(userId, key);
  if (saved) {
    if (saved.request_hash !== hash) throw new HttpError(409, 'Этот запрос уже сохранён с другими данными. Обнови ленту перед повторной отправкой.');
    return JSON.parse(String(saved.response)) as T;
  }
  const result = change();
  db.prepare('INSERT INTO write_receipts VALUES (?, ?, ?, ?, ?)').run(userId, key, hash, JSON.stringify(result), Date.now());
  return result;
}
