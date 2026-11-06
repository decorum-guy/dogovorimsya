import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { createApp } from '../server/app.js';
import { hashPassword, tokenHash } from '../server/auth.js';
import { getReviews, openDatabase } from '../server/db.js';
import { commentVersion } from '../shared/comments.js';
import type { Bootstrap } from '../shared/types.js';

test('comment photos, captions, ownership, retries and live revision checks', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'dogovorimsya-comment-photos-'));
  const options = { dataDir: directory, origin: 'https://fictional.invalid', secure: false, demo: false, pushSender: async () => {} };
  const { app, db } = createApp(options), server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  options.origin = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
  const hash = await hashPassword('fictional-comment-test-123');
  db.prepare("INSERT INTO users (id,login,password_hash,name,role) VALUES (1,'photo-author',?,'Тестовый автор','reviewer'),(2,'photo-recipient',?,'Тестовый получатель','recipient')").run(hash, hash);
  const cookies: Record<string, string> = {};
  async function request(path: string, method = 'GET', body?: unknown, user = 'recipient', key?: string, snapshot = false) {
    return fetch(options.origin + path, {
      method, headers: { Origin: options.origin, ...(cookies[user] ? { Cookie: cookies[user] } : {}),
        ...(!(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
        ...(key ? { 'Idempotency-Key': key } : {}), ...(snapshot ? { Prefer: 'return=representation' } : {}) },
      body: body instanceof FormData ? body : body === undefined ? undefined : JSON.stringify(body),
    });
  }
  const bootstrap = async () => await (await request('/api/bootstrap')).json() as Bootstrap;
  const bytes = await sharp({ create: { width: 60, height: 40, channels: 3, background: '#e9c7cf' } }).jpeg().toBuffer();
  async function upload(user: string, kind = 'photo') {
    const body = new FormData(); body.set('kind', kind);
    body.append('photos', new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' }), 'fictional.jpg');
    const response = await request('/api/uploads', 'POST', body, user);
    assert.equal(response.status, 201);
    return String((await response.json()).ids[0]);
  }
  let reviewId = 0, commentId = 0, recipientPhoto = '', authorPhoto = '';
  try {
    for (const [user, login] of [['reviewer', 'photo-author'], ['recipient', 'photo-recipient']]) {
      const response = await request('/api/login', 'POST', { login, password: 'fictional-comment-test-123' });
      cookies[user] = response.headers.get('set-cookie')!.split(';')[0];
    }
    // Isolated fixture only: the injected sender never contacts a push service.
    db.prepare('INSERT INTO push_subscriptions VALUES (?, ?, ?, ?, ?)').run(
      'https://fcm.googleapis.com/fictional-comment-fixture', 1,
      tokenHash(cookies.reviewer.split('=')[1]), '{}', Date.now(),
    );
    const response = await request('/api/reviews', 'POST', { rating: 50, title: 'Вымышленная записка', body: 'Тестовые данные.', photoIds: [] }, 'reviewer');
    reviewId = (await response.json()).id;
    const path = '/api/reviews/' + reviewId + '/comments';
    await t.test('both profiles can upload; attaching a photo does not grant review-edit rights', async () => {
      recipientPhoto = await upload('recipient'); authorPhoto = await upload('reviewer');
      assert.equal((await request('/api/reviews', 'POST', { rating: 50, title: 'Недоступно', body: 'Тест.', photoIds: [recipientPhoto] })).status, 403);
      assert.equal((await request('/api/reviews/' + reviewId, 'PATCH', { rating: 50, title: 'Недоступно', body: 'Тест.', eventDate: '2026-11-06', photoIds: [recipientPhoto], revision: 1 })).status, 403);
      assert.equal((await request('/media/' + recipientPhoto, 'GET', undefined, 'anonymous')).status, 401);
      assert.equal((await request('/media/' + recipientPhoto)).headers.get('cache-control'), 'no-store');
    });
    await t.test('photo-only comments have individual captions, a fresh inline journal and one push on retry', async () => {
      const key = randomUUID(), input = { body: '', photos: [{ id: recipientPhoto, caption: '  Улика с сердечком ♡  ' }] };
      const before = await (await request(path + '/version')).json();
      const first = await request(path, 'POST', input, 'recipient', key, true);
      assert.equal(first.status, 201);
      assert.equal(first.headers.get('preference-applied'), 'return=representation');
      const result = await first.json();
      const state = result.bootstrap as Bootstrap;
      const comment = state.reviews[0].comments[0]; commentId = comment.id;
      assert.equal(comment.body, '');
      assert.deepEqual(comment.photos, [{ id: recipientPhoto, caption: 'Улика с сердечком ♡' }]);
      assert.equal(state.statistics.photoCount, 1);
      assert.equal(state.statistics.commentCount, 1);
      assert.equal((await request(path, 'POST', input, 'recipient', key, true)).status, 201);
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM comments').get()!.n, 1);
      assert.equal(db.prepare("SELECT COUNT(*) AS n FROM push_outbox WHERE kind = 'comment'").get()!.n, 1);
      const after = await (await request(path + '/version')).json();
      assert.notEqual(after.version, before.version);
      assert.equal(after.version, commentVersion(state.reviews[0].comments));
      assert.deepEqual(Object.keys(after), ['version']);
    });
    await t.test('captions and photos edit atomically, legacy edits retain attachments, stale edits fail', async () => {
      const endpoint = '/api/comments/' + commentId;
      assert.equal((await request(endpoint, 'PATCH', { body: 'Чужая правка', revision: 1 }, 'reviewer')).status, 403);
      const before = await (await request(path + '/version')).json();
      const update = { body: '', photos: [{ id: recipientPhoto, caption: 'Новая подпись' }], revision: 1 };
      assert.equal((await request(endpoint, 'PATCH', update, 'recipient', undefined, true)).status, 200);
      const after = await (await request(path + '/version')).json(); assert.notEqual(before.version, after.version);
      const row = db.prepare('SELECT * FROM comments WHERE id = ?').get(commentId)!;
      assert.equal(row.revision, 2);
      assert.equal((await request(endpoint, 'PATCH', { ...update, revision: 2 })).status, 200);
      assert.deepEqual(db.prepare('SELECT * FROM comments WHERE id = ?').get(commentId), row, 'identical content must not create a false edit');
      assert.equal((await request(endpoint, 'PATCH', { body: 'Правка из старого окна', photos: [], revision: 1 })).status, 409);
      assert.equal((await request(endpoint, 'PATCH', { body: 'Правка старым клиентом', revision: 2 })).status, 200);
      assert.deepEqual((await bootstrap()).reviews[0].comments[0].photos, update.photos, 'missing photos in legacy PATCH must not erase them');
      assert.equal((await request(endpoint, 'PATCH', { body: '', photos: [], revision: 3 })).status, 400);
    });
    await t.test('invalid, foreign, avatar and duplicate attachments cannot be published', async () => {
      const avatar = await upload('recipient', 'avatar');
      const invalid = [
        { body: '  ', photos: [] },
        { photos: [{ id: authorPhoto }] },
        { photos: [{ id: avatar }] },
        { photos: [{ id: randomUUID() }] },
        { photos: [{ id: recipientPhoto }, { id: recipientPhoto }] },
        { photos: [{ id: recipientPhoto, caption: 'x'.repeat(501) }] },
        { photos: Array.from({ length: 6 }, () => ({ id: randomUUID() })) },
      ];
      for (const input of invalid) assert.equal((await request(path, 'POST', input)).status, 400);
      assert.equal((await request('/api/comments/' + commentId, 'PATCH', { body: 'Текст', photos: [{ id: authorPhoto }], revision: 3 })).status, 400);
      assert.equal((await request(path, 'POST', { photos: [{ id: authorPhoto, caption: 'Вымышленное фото автора' }] }, 'reviewer')).status, 201);
    });
    await t.test('caption-only PATCH preserves the existing text', async () => {
      const endpoint = '/api/comments/' + commentId;
      const before = (await bootstrap()).reviews[0].comments.find(comment => comment.id === commentId)!;
      const response = await request(endpoint, 'PATCH', {
        photos: [{ id: recipientPhoto, caption: 'Только подпись меняется' }], revision: before.revision,
      });
      assert.equal(response.status, 200);
      const after = (await bootstrap()).reviews[0].comments.find(comment => comment.id === commentId)!;
      assert.equal(after.body, before.body);
      assert.equal(after.photos[0].caption, 'Только подпись меняется');
      assert.equal(after.revision, before.revision + 1);
    });
    await t.test('text-only receipt keys survive requests that explicitly include an empty photo list', async () => {
      const key = randomUUID();
      assert.equal((await request(path, 'POST', { body: 'Прежний формат' }, 'recipient', key)).status, 201);
      const count = db.prepare('SELECT COUNT(*) AS n FROM comments').get()!.n;
      assert.equal((await request(path, 'POST', { body: 'Прежний формат', photos: [] }, 'recipient', key)).status, 201);
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM comments').get()!.n, count);
      assert.equal((await request(path, 'POST', { body: 'Прежний формат', photos: [{ id: recipientPhoto }] }, 'recipient', key)).status, 409);
      assert.equal((await request(path + '/version', 'GET', undefined, 'anonymous')).status, 401);
      assert.equal((await request('/api/reviews/999999/comments/version')).status, 404);
      assert.equal((await (await request(path + '/version')).json()).version, commentVersion((await bootstrap()).reviews[0].comments));
    });
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); db.close(); await rm(directory, { recursive: true, force: true }); }
});

test('v6 migration keeps old comments, clocks, sessions and revisions; repeated startup retains new photos', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dogovorimsya-comment-migration-'));
  let db = openDatabase(directory);
  try {
    db.exec("INSERT INTO users (id,login,password_hash,name,role) VALUES (1,'fictional','fictional-hash','Вымышленный автор','reviewer');");
    db.exec("INSERT INTO sessions VALUES ('fictional-session',1,9999999999999);");
    db.exec("INSERT INTO reviews (id,author_id,rating,title,body,event_date,event_time,created_at,updated_at) VALUES (1,1,49,'Вымышленный момент','Тест','2026-11-06','14:32','2026-11-06T11:32:00.000Z','2026-11-06T11:32:00.000Z');");
    db.exec("INSERT INTO comments (id,review_id,user_id,body,created_at,updated_at,revision) VALUES (1,1,1,'Прежний комментарий','2026-11-06T11:33:00.000Z','2026-11-06T11:34:00.000Z',2);");
    db.exec('ALTER TABLE comments DROP COLUMN photos; PRAGMA user_version = 6;');
    const before = ['users', 'sessions', 'reviews', 'comments'].map(table => [table, db.prepare('SELECT * FROM ' + table).all().map(row => ({ ...row }))] as const);
    db.close(); db = openDatabase(directory);
    assert.equal(db.prepare('PRAGMA user_version').get()!.user_version, 7);
    for (const [table, rows] of before) {
      const current = db.prepare('SELECT * FROM ' + table).all().map(({ photos, ...row }) => row);
      assert.deepEqual(current, rows, table + ' must keep all original values');
    }
    assert.deepEqual(getReviews(db, 1)[0].comments[0].photos, []);
    const photos = [{ id: randomUUID(), caption: 'Тестовая подпись' }];
    db.prepare('UPDATE comments SET photos = ? WHERE id = 1').run(JSON.stringify(photos));
    db.close(); db = openDatabase(directory);
    assert.deepEqual(getReviews(db, 1)[0].comments[0].photos, photos);
    assert.equal(db.prepare('PRAGMA integrity_check').get()!.integrity_check, 'ok');
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  } finally { db.close(); await rm(directory, { recursive: true, force: true }); }
});
