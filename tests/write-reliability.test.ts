import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createApp } from '../server/app.js';
import { hashPassword, requireLiveSession, tokenHash } from '../server/auth.js';

test('write receipts prevent duplicate reviews/comments and explicit reaction state survives retries', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'dogovorimsya-retries-'));
  const options = { dataDir: directory, origin: '', secure: false, demo: false };
  const { app, db } = createApp(options), server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  options.origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const hash = await hashPassword('fictional-test-password-123');
  db.prepare("INSERT INTO users (id,login,password_hash,name,role) VALUES (1,'author-test',?,'Тестовый автор','reviewer'),(2,'recipient-test',?,'Тестовая получательница','recipient')").run(hash, hash);
  const cookies: Record<string, string> = {};
  async function request(path: string, method: string, body: unknown, who = 'reviewer', key?: string) {
    return fetch(options.origin + path, { method, headers: { Origin: options.origin, 'Content-Type': 'application/json', ...(cookies[who] ? { Cookie: cookies[who] } : {}), ...(key ? { 'Idempotency-Key': key } : {}) }, body: JSON.stringify(body) });
  }
  const review = { rating: 49, title: 'Вымышленный повтор', body: 'Проверка потерянного ответа.', eventDate: '2026-11-06', photoIds: [] };
  let id = 0;
  try {
    for (const [who, login] of [['reviewer', 'author-test'], ['recipient', 'recipient-test']]) {
      const response = await request('/api/login', 'POST', { login, password: 'fictional-test-password-123' }); cookies[who] = response.headers.get('set-cookie')!.split(';')[0];
    }
    await t.test('concurrent retries return one review ID and preserve its one original revision', async () => {
      const key = randomUUID();
      const responses = await Promise.all([request('/api/reviews', 'POST', review, 'reviewer', key), request('/api/reviews', 'POST', review, 'reviewer', key)]);
      for (const response of responses) assert.equal(response.status, 201);
      const results = await Promise.all(responses.map(response => response.json()));
      assert.equal(results[0].id, results[1].id); id = results[0].id;
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM reviews').get()!.n, 1);
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM revisions').get()!.n, 1);
      assert.equal((await request('/api/reviews', 'POST', { ...review, rating: 10 }, 'reviewer', key)).status, 409);
      assert.equal((await request(`/api/reviews/${id}/comments`, 'POST', { body: 'Другой тип запроса' }, 'reviewer', key)).status, 409);
      assert.equal((await request('/api/reviews', 'POST', review, 'recipient', key)).status, 403);
    });
    await t.test('comment receipts are private to a user and reject changed content under an old key', async () => {
      const key = randomUUID(), path = `/api/reviews/${id}/comments`, body = { body: 'Первый тестовый ответ' };
      for (let i = 0; i < 2; i++) assert.equal((await request(path, 'POST', body, 'recipient', key)).status, 201);
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM comments').get()!.n, 1);
      assert.equal((await request(path, 'POST', { body: 'Изменённый текст' }, 'recipient', key)).status, 409);
      assert.equal((await request(path, 'POST', body, 'reviewer', key)).status, 201);
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM comments').get()!.n, 2);
      assert.equal((await request(path, 'POST', body, 'recipient', 'not-a-uuid')).status, 400);
    });
    await t.test('setting a reaction on/off twice is idempotent; legacy toggles remain compatible', async () => {
      const path = `/api/reviews/${id}/reactions`;
      for (let i = 0; i < 2; i++) assert.equal((await request(path, 'PUT', { emoji: '❤️', active: true }, 'recipient')).status, 200);
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM reactions').get()!.n, 1);
      for (let i = 0; i < 2; i++) await request(path, 'PUT', { emoji: '❤️', active: false }, 'recipient');
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM reactions').get()!.n, 0);
      await request(path, 'PUT', { emoji: '❤️' }, 'recipient'); assert.equal(db.prepare('SELECT COUNT(*) AS n FROM reactions').get()!.n, 1);
    });
    await t.test('stale comment edits cannot overwrite a newer text, and no-op edits do not mark a comment as changed', async () => {
      const comment = db.prepare('SELECT * FROM comments WHERE user_id = 2 ORDER BY id LIMIT 1').get()!;
      const path = `/api/comments/${comment.id}`;
      assert.equal((await request(path, 'PATCH', { body: 'Правка из первого окна', revision: 1 }, 'recipient')).status, 200);
      assert.equal((await request(path, 'PATCH', { body: 'Устаревший черновик второго окна', revision: 1 }, 'recipient')).status, 409);
      const fresh = db.prepare('SELECT * FROM comments WHERE id = ?').get(Number(comment.id))!;
      assert.equal(fresh.body, 'Правка из первого окна'); assert.equal(fresh.revision, 2);
      await request(path, 'PATCH', { body: fresh.body, revision: 2 }, 'recipient');
      assert.deepEqual(db.prepare('SELECT * FROM comments WHERE id = ?').get(Number(comment.id)), fresh);
    });
    await t.test('a new revision explanation is retained even when the rating and main text stay unchanged', async () => {
      const path = `/api/reviews/${id}`, note = 'Пояснение к уже выставленной оценке';
      assert.equal((await request(path, 'PATCH', { ...review, revision: 1, note })).status, 200);
      assert.equal(db.prepare('SELECT note FROM revisions ORDER BY id DESC LIMIT 1').get()!.note, note);
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM revisions').get()!.n, 2);
      await request(path, 'PATCH', { ...review, revision: 2, note });
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM revisions').get()!.n, 2, 'repeating an identical explanation is a no-op');
    });
    await t.test('an already verified request must re-check that its original session is still live', () => {
      const token = cookies.reviewer.split('=')[1];
      assert.doesNotThrow(() => requireLiveSession(db, token, 1));
      assert.throws(() => requireLiveSession(db, token, 2));
      db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash(token));
      assert.throws(() => requireLiveSession(db, token, 1), (error: unknown) => (error as { status: number }).status === 401);
    });
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); db.close(); await rm(directory, { recursive: true, force: true }); }
});
