import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createApp } from '../server/app.js';
import { createSession } from '../server/auth.js';
import { journalDate } from '../shared/journal-days.js';
import type { Bootstrap } from '../shared/types.js';

test('publication date uses the shared Moscow calendar, including midnight and leap days', () => {
  assert.equal(journalDate(new Date('2026-11-06T20:59:59.999Z')), '2026-11-06');
  assert.equal(journalDate(new Date('2026-11-06T21:00:00.000Z')), '2026-11-07');
  assert.equal(journalDate(new Date('2028-02-28T21:00:00.000Z')), '2028-02-29');
  assert.equal(journalDate(new Date('2026-12-31T21:00:00.000Z')), '2027-01-01');
});

test('new notes get a server publication date; only author edits can change it with history', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-06T20:59:59.000Z') });
  const directory = await mkdtemp(join(tmpdir(), 'dogovorimsya-dates-'));
  const options = { dataDir: directory, origin: '', secure: false, demo: false };
  const { app, db } = createApp(options), server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  options.origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  db.prepare("INSERT INTO users (id,login,password_hash,name,role) VALUES (1,'author-test','unused','Тестовый автор','reviewer'),(2,'recipient-test','unused','Тестовая получательница','recipient')").run();
  const cookies: Record<string, string> = {};
  for (const [who, userId] of [['reviewer', 1], ['recipient', 2]] as const) {
    createSession(db, { cookie: (name: string, token: string) => { cookies[who] = `${name}=${token}`; } } as Parameters<typeof createSession>[1], userId, false);
  }
  async function request(path: string, method = 'GET', body?: unknown, who = 'reviewer', key?: string) {
    return fetch(options.origin + path, { method, headers: { Origin: options.origin, Cookie: cookies[who], 'Content-Type': 'application/json', ...(key ? { 'Idempotency-Key': key } : {}) }, body: body ? JSON.stringify(body) : undefined });
  }
  const state = async () => (await (await request('/api/bootstrap')).json()) as Bootstrap;
  const input = { rating: 49, title: 'Вымышленная записка', body: 'Тестовая история без личных данных.', photoIds: [] };
  const key = randomUUID();
  let id = 0, originalCreatedAt = '';
  try {
    await t.test('publishes without a date field and snapshots the publication day', async () => {
      const response = await request('/api/reviews', 'POST', input, 'reviewer', key);
      assert.equal(response.status, 201); id = (await response.json()).id;
      const note = (await state()).reviews[0];
      originalCreatedAt = note.createdAt;
      assert.equal(originalCreatedAt, '2026-11-06T20:59:59.000Z');
      assert.equal(note.eventDate, '2026-11-06');
      assert.equal(note.revisions[0].eventDate, note.eventDate);
    });
    await t.test('a retry after midnight keeps the original date and one record', async () => {
      t.mock.timers.setTime(new Date('2026-11-06T21:00:01.000Z').getTime());
      const response = await request('/api/reviews', 'POST', input, 'reviewer', key);
      assert.equal(response.status, 201); assert.equal((await response.json()).id, id);
      const notes = (await state()).reviews;
      assert.equal(notes.length, 1); assert.equal(notes[0].eventDate, '2026-11-06');
      assert.equal(notes[0].revisions.length, 1); assert.equal(notes[0].createdAt, originalCreatedAt);
    });
    await t.test('a stale date from an old client cannot override the new publication day', async () => {
      assert.equal((await request('/api/reviews', 'POST', { ...input, eventDate: '2000-01-01' })).status, 201);
      const newest = (await state()).reviews[0];
      assert.equal(newest.eventDate, '2026-11-07');
      assert.equal(newest.revisions[0].eventDate, '2026-11-07');
      assert.equal((await request('/api/reviews', 'POST', { ...input, eventDate: '2026-02-30' })).status, 400);
    });
    await t.test('date-only edits are validated, authorized, versioned and reorder the feed', async () => {
      const path = `/api/reviews/${id}`, edit = { ...input, eventDate: '2026-11-08', revision: 1 };
      assert.equal((await request(path, 'PATCH', { ...input, revision: 1 })).status, 400);
      assert.equal((await request(path, 'PATCH', { ...edit, eventDate: '2026-02-30' })).status, 400);
      assert.equal((await request(path, 'PATCH', edit, 'recipient')).status, 403);
      assert.equal((await request(path, 'PATCH', edit)).status, 200);
      assert.equal((await request(path, 'PATCH', { ...edit, eventDate: '2026-11-09' })).status, 409);
      const note = (await state()).reviews[0];
      assert.equal(note.id, id); assert.equal(note.eventDate, edit.eventDate);
      assert.equal(note.revision, 2); assert.equal(note.createdAt, originalCreatedAt);
      assert.deepEqual(note.revisions.map(version => version.eventDate), ['2026-11-06', '2026-11-08']);
      assert.equal(note.updatedAt, '2026-11-06T21:00:01.000Z');
    });
    await t.test('unchanged edits preserve the chosen date and do not add a false revision', async () => {
      t.mock.timers.setTime(new Date('2026-11-07T21:00:01.000Z').getTime());
      const before = (await state()).reviews[0];
      assert.equal((await request(`/api/reviews/${id}`, 'PATCH', { ...input, eventDate: before.eventDate, revision: before.revision })).status, 200);
      assert.deepEqual((await state()).reviews[0], before);
    });
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve())); db.close();
    await rm(directory, { recursive: true, force: true });
  }
});
