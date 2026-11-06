import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { createApp } from '../server/app.js';
import { hashPassword } from '../server/auth.js';
import { getReviews, openDatabase } from '../server/db.js';
import type { Bootstrap } from '../shared/types.js';

test('private two-person journal: permissions, history, uploads and sessions', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'dogovorimsya-test-'));
  const options = { dataDir: directory, origin: '', secure: false, demo: false };
  const { app, db } = createApp(options);
  const server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  options.origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const hash = await hashPassword('fictional-test-password-123');
  db.prepare('INSERT INTO users (id, login, password_hash, name, role) VALUES (1, ?, ?, ?, ?), (2, ?, ?, ?, ?)').run('author-test', hash, 'Автор теста', 'reviewer', 'recipient-test', hash, 'Получатель теста', 'recipient');
  const cookies: Record<string, string> = {};
  async function request(path: string, method = 'GET', body?: unknown, who = 'reviewer', origin = options.origin) {
    const headers: Record<string, string> = { Origin: origin };
    if (cookies[who]) headers.Cookie = cookies[who];
    if (body && !(body instanceof FormData)) headers['Content-Type'] = 'application/json';
    return fetch(options.origin + path, { method, headers, body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined });
  }
  const bootstrap = async (who = 'reviewer') => (await (await request('/api/bootstrap', 'GET', undefined, who)).json()) as Bootstrap;
  let id = 0, photoId = '';
  const initial = { rating: 49, title: 'Вымышленный момент', body: 'Первоначальная версия для проверки истории.', eventDate: '2026-11-06', photoIds: [] as string[] };
  try {
    await t.test('anonymous access and demo login are denied; login creates HttpOnly sessions', async () => {
      assert.equal((await request('/api/bootstrap')).status, 401);
      assert.equal((await request('/media/00000000-0000-4000-8000-000000000000')).status, 401);
      assert.equal((await request('/api/demo/login', 'POST', { role: 'reviewer' })).status, 404);
      for (const [role, login] of [['reviewer', 'author-test'], ['recipient', 'recipient-test']]) {
        const response = await request('/api/login', 'POST', { login, password: 'fictional-test-password-123' });
        assert.equal(response.status, 200);
        assert.match(response.headers.get('set-cookie')!, /HttpOnly/);
        assert.match(response.headers.get('set-cookie')!, /SameSite=Strict/);
        cookies[role] = response.headers.get('set-cookie')!.split(';')[0];
      }
      const state = await bootstrap();
      assert.equal(state.user.role, 'reviewer');
      assert.equal(JSON.stringify(state).includes('password_hash'), false);
      assert.equal(state.reviews.length, 0);
    });
    await t.test('only the author can create a valid review; forged roles and CSRF fail', async () => {
      assert.equal((await request('/api/reviews', 'POST', { ...initial, role: 'reviewer' }, 'recipient')).status, 403);
      assert.equal((await request('/api/reviews', 'POST', initial, 'reviewer', 'https://untrusted.example')).status, 403);
      for (const rating of [-1, 51, 4.9]) assert.equal((await request('/api/reviews', 'POST', { ...initial, rating })).status, 400);
      assert.equal((await request('/api/reviews', 'POST', { ...initial, eventDate: '2026-02-30' })).status, 400);
      const response = await request('/api/reviews', 'POST', initial);
      assert.equal(response.status, 201);
      id = (await response.json()).id;
      const r = (await bootstrap()).reviews[0];
      assert.equal(r.revisions[0].rating, 49);
      assert.equal(r.revisions[0].body, initial.body);
      assert.ok(r.designVariant >= 0 && r.designVariant < 5);
    });
    await t.test('images are decoded, resized and stripped of metadata; media remains private', async () => {
      const bytes = await sharp({ create: { width: 2400, height: 1200, channels: 3, background: '#efccdd' } }).withMetadata({ exif: { IFD0: { Artist: 'Fictional test marker' } } }).jpeg().toBuffer();
      const form = new FormData(); form.set('kind', 'photo'); form.append('photos', new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' }), 'test.jpg');
      const response = await request('/api/uploads', 'POST', form);
      assert.equal(response.status, 201);
      photoId = (await response.json()).ids[0];
      const image = await request(`/media/${photoId}`);
      assert.equal(image.status, 200);
      assert.equal(image.headers.get('cache-control'), 'no-store');
      const metadata = await sharp(Buffer.from(await image.arrayBuffer())).metadata();
      assert.equal(metadata.width, 2000); assert.equal(metadata.height, 1000); assert.equal(metadata.exif, undefined);
      assert.equal((await request(`/media/${photoId}`, 'GET', undefined, 'anonymous')).status, 401);
      const bad = new FormData(); bad.set('kind', 'photo'); bad.append('photos', new Blob(['not an image']), 'fake.jpg');
      assert.equal((await request('/api/uploads', 'POST', bad)).status, 415);
      const denied = new FormData(); denied.set('kind', 'photo'); denied.append('photos', new Blob([new Uint8Array(bytes)]), 'test.jpg');
      assert.equal((await request('/api/uploads', 'POST', denied, 'recipient')).status, 403);
    });
    await t.test('edits preserve every snapshot, prevent stale overwrites and retain the style variant', async () => {
      const original = (await bootstrap()).reviews[0];
      const updated = { ...initial, rating: 50, body: 'Новая версия с объяснением.', photoIds: [photoId], note: 'Новые обстоятельства.', revision: 1 };
      assert.equal((await request(`/api/reviews/${id}`, 'PATCH', updated, 'recipient')).status, 403);
      assert.equal((await request(`/api/reviews/${id}`, 'PATCH', updated)).status, 200);
      assert.equal((await request(`/api/reviews/${id}`, 'PATCH', updated)).status, 409);
      const review = (await bootstrap()).reviews[0];
      assert.equal(review.revisions.length, 2); assert.equal(review.revisions[0].rating, 49); assert.equal(review.revisions[0].body, initial.body);
      assert.equal(review.revisions[1].rating, 50); assert.equal(review.revisions[1].note, updated.note); assert.deepEqual(review.revisions[1].photoIds, [photoId]);
      assert.equal(review.designVariant, original.designVariant);
      assert.equal((await request(`/api/reviews/${id}`, 'PATCH', { ...updated, revision: 2 })).status, 200);
      assert.equal((await bootstrap()).reviews[0].revisions.length, 2, 'no-op edit creates no false history');
    });
    await t.test('both can discuss; each edits only their own comment', async () => {
      assert.equal((await request(`/api/reviews/${id}/comments`, 'POST', { body: 'Моя версия событий.' }, 'recipient')).status, 201);
      assert.equal((await request(`/api/reviews/${id}/comments`, 'POST', { body: 'Принимается к обсуждению.' })).status, 201);
      const commentId = (await bootstrap()).reviews[0].comments[0].id;
      assert.equal((await request(`/api/comments/${commentId}`, 'PATCH', { body: 'Чужая правка.' })).status, 403);
      assert.equal((await request(`/api/comments/${commentId}`, 'PATCH', { body: 'Уточнённая версия.' }, 'recipient')).status, 200);
      assert.equal((await bootstrap()).reviews[0].comments[0].body, 'Уточнённая версия.');
      assert.equal((await request(`/api/reviews/${id}/comments`, 'POST', { body: '  ' })).status, 400);
    });
    await t.test('reactions toggle and favorites are personal', async () => {
      assert.equal((await request(`/api/reviews/${id}/reactions`, 'PUT', { emoji: '❤️' }, 'recipient')).status, 200);
      assert.equal((await bootstrap()).reviews[0].reactions.length, 1);
      await request(`/api/reviews/${id}/reactions`, 'PUT', { emoji: '❤️' }, 'recipient');
      assert.equal((await bootstrap()).reviews[0].reactions.length, 0);
      await request(`/api/reviews/${id}/favorite`, 'PUT', { favorite: true });
      assert.equal((await bootstrap()).reviews[0].favorite, true);
      assert.equal((await bootstrap('recipient')).reviews[0].favorite, false);
      assert.deepEqual((await bootstrap()).statistics.favorites, { reviewer: 1, recipient: 0, mutual: 0 });
      await request(`/api/reviews/${id}/favorite`, 'PUT', { favorite: true, userId: 1 }, 'recipient');
      assert.equal((await bootstrap('recipient')).reviews[0].favorite, true);
      assert.deepEqual((await bootstrap()).statistics.favorites, { reviewer: 1, recipient: 1, mutual: 1 });
      await request(`/api/reviews/${id}/favorite`, 'PUT', { favorite: false });
      assert.equal((await bootstrap()).reviews[0].favorite, false);
      assert.equal((await bootstrap('recipient')).reviews[0].favorite, true);
      assert.deepEqual((await bootstrap('recipient')).statistics.favorites, { reviewer: 0, recipient: 1, mutual: 0 });
    });
    await t.test('profile ownership and logout invalidate access to private data', async () => {
      assert.equal((await request('/api/profile', 'PATCH', { name: 'Новое тестовое имя', avatarId: photoId })).status, 400);
      assert.equal((await request('/api/profile', 'PATCH', { name: 'Новое тестовое имя', avatarId: null, role: 'recipient' })).status, 200);
      assert.equal((await bootstrap()).user.role, 'reviewer');
      assert.equal((await bootstrap('recipient')).user.name, 'Получатель теста');
      assert.equal((await request('/api/logout', 'POST')).status, 200);
      assert.equal((await request('/api/bootstrap')).status, 401);
      assert.equal((await request(`/media/${photoId}`)).status, 401);
      assert.equal((await bootstrap('recipient')).reviews.length, 1);
    });
    await t.test('the journal and its complete history persist on disk', () => {
      const second = openDatabase(directory);
      try { const reviews = getReviews(second, 2); assert.equal(reviews.length, 1); assert.equal(reviews[0].rating, 50); assert.equal(reviews[0].revisions[0].rating, 49); assert.equal(reviews[0].revisions.length, 2); }
      finally { second.close(); }
    });
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve())); db.close(); await rm(directory, { recursive: true, force: true });
  }
});
