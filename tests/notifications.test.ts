import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createECDH, randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app.js';
import { createNotifications, isPushEndpoint } from '../server/notifications.js';
import { defaultNotificationPreferences } from '../shared/notifications.js';
import { hashPassword } from '../server/auth.js';
import webpush from 'web-push';

test('the production push library encrypts Cyrillic payloads and signs VAPID requests without exposing their content', () => {
  const ec = createECDH('prime256v1');
  const subscription = { endpoint: 'https://web.push.apple.com/fictional', keys: { p256dh: ec.generateKeys().toString('base64url'), auth: randomBytes(16).toString('base64url') } };
  const payload = JSON.stringify({ title: 'Вымышленный космический сигнал ♡', body: 'Новый комментарий' });
  const request = webpush.generateRequestDetails(subscription, payload, { TTL: 3600, vapidDetails: { subject: 'https://fictional.invalid', ...webpush.generateVAPIDKeys() } });
  assert.equal(request.method, 'POST'); assert.equal(request.endpoint, subscription.endpoint);
  assert.equal(request.headers['Content-Encoding'], 'aes128gcm');
  assert.ok(request.headers.Authorization); assert.ok(!request.body.toString().includes(payload));
  assert.ok(request.body.length < 4096);
});

test('push destinations accept real browser services and reject arbitrary or disguised network targets', () => {
  for (const url of ['https://web.push.apple.com/fictional', 'https://fcm.googleapis.com/fcm/send/test', 'https://updates.push.services.mozilla.com/wpush/v2/test', 'https://wns2.notify.windows.com/test']) assert.ok(isPushEndpoint(url), url);
  for (const url of ['http://fcm.googleapis.com/test', 'https://127.0.0.1/test', 'https://[::1]/test', 'https://example.com/test', 'https://push.apple.com.evil.example/test', 'https://fcm.googleapis.com@127.0.0.1/test', 'https://user@fcm.googleapis.com/test', 'https://fcm.googleapis.com:444/test', 'https://fcm.googleapis.com/', 'https://fcm.googleapis.com/test#fragment']) assert.equal(isPushEndpoint(url), false, url);
});

test('private push: event routing, preferences, persistence, retries and session revocation', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'dogovorimsya-push-'));
  const sent: { endpoint: string; payload: Record<string, unknown> }[] = [];
  let deliveryMode: 'ok' | 'gone' | 'retry' = 'ok';
  const options = { dataDir: directory, origin: 'https://fictional.invalid', secure: false, demo: false, pushSender: async (subscription: { endpoint: string }, payload: string) => {
    if (deliveryMode !== 'ok') throw Object.assign(new Error('Fictional push error'), { statusCode: deliveryMode === 'gone' ? 410 : 503 });
    sent.push({ endpoint: subscription.endpoint, payload: JSON.parse(payload) });
  } };
  const { app, db, notifications } = createApp(options);
  const server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  options.origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const hash = await hashPassword('fictional-test-password-123');
  db.prepare("INSERT INTO users (id,login,password_hash,name,role) VALUES (1,'author-test',?,'Тестовый автор','reviewer'),(2,'recipient-test',?,'Тестовая получательница','recipient')").run(hash, hash);
  const cookies: Record<string, string> = {};
  async function request(path: string, method = 'GET', body?: unknown, who = 'reviewer', origin = options.origin) {
    return fetch(options.origin + path, { method, headers: { Origin: origin, 'Content-Type': 'application/json', ...(cookies[who] ? { Cookie: cookies[who] } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  }
  const endpointA = 'https://fcm.googleapis.com/fcm/send/fictional-author';
  const endpointB = 'https://web.push.apple.com/fictional-recipient';
  const subscription = (endpoint: string) => { const ec = createECDH('prime256v1'); return { endpoint, keys: { p256dh: ec.generateKeys().toString('base64url'), auth: randomBytes(16).toString('base64url') } }; };
  const subscribe = (who: string, endpoint: string) => request('/api/notifications/subscriptions', 'POST', subscription(endpoint), who);
  const updatePrefs = (who: string, patch: Partial<ReturnType<typeof defaultNotificationPreferences>>) => request('/api/notifications/preferences', 'PUT', { ...defaultNotificationPreferences(), ...patch }, who);
  const countJobs = () => Number(db.prepare('SELECT COUNT(*) AS n FROM push_outbox').get()!.n);
  const review = { rating: 49, title: 'Секретный заголовок теста', body: 'Личный текст не попадает на экран блокировки.', eventDate: '2026-11-06', photoIds: [] };
  let id = 0;
  try {
    await t.test('settings require a session, keys persist privately and each profile owns its preferences', async () => {
      assert.equal((await request('/api/notifications')).status, 401);
      for (const [who, login] of [['reviewer', 'author-test'], ['recipient', 'recipient-test']]) {
        const response = await request('/api/login', 'POST', { login, password: 'fictional-test-password-123' });
        cookies[who] = response.headers.get('set-cookie')!.split(';')[0];
      }
      const state = await (await request('/api/notifications')).json();
      assert.equal(state.available, true); assert.equal(state.deviceCount, 0);
      const saved = JSON.parse(await readFile(join(directory, 'push-vapid.json'), 'utf8'));
      assert.equal(state.publicKey, saved.publicKey); assert.ok(!JSON.stringify(state).includes(saved.privateKey));
      assert.equal((await stat(join(directory, 'push-vapid.json'))).mode & 0o777, 0o600);
      const reopened = createNotifications(db, { dataDir: directory, origin: 'https://fictional.invalid', demo: false });
      assert.equal(reopened.publicKey, state.publicKey);
      assert.equal((await updatePrefs('recipient', { silent: true })).status, 200);
      assert.equal(notifications.preferences(1).silent, false); assert.equal(notifications.preferences(2).silent, true);
      assert.equal((await request('/api/notifications/preferences', 'PUT', defaultNotificationPreferences(), 'recipient', 'https://evil.invalid')).status, 403);
      assert.equal((await request('/api/notifications/preferences', 'PUT', { enabled: 'true' }, 'recipient')).status, 400);
      assert.equal((await updatePrefs('recipient', { mutedUntil: Date.now() + 40 * 24 * 60 * 60_000 })).status, 400);
    });
    await t.test('subscriptions are validated and private; connecting a device never leaks other endpoints', async () => {
      assert.equal((await subscribe('reviewer', 'https://127.0.0.1/private')).status, 400);
      assert.equal((await subscribe('reviewer', endpointA)).status, 201);
      assert.equal((await subscribe('recipient', endpointB)).status, 201);
      const state = await (await request('/api/notifications')).json();
      assert.equal(state.deviceCount, 1); assert.ok(!JSON.stringify(state).includes(endpointA)); assert.ok(!JSON.stringify(state).includes(endpointB));
      assert.deepEqual(await (await request('/api/notifications/device', 'POST', { endpoint: endpointB })).json(), { connected: false });
      assert.deepEqual(await (await request('/api/notifications/device', 'POST', { endpoint: endpointB }, 'recipient')).json(), { connected: true });
    });
    await t.test('new reviews and actual rating changes notify only her, with no intimate content in the push', async () => {
      const created = await request('/api/reviews', 'POST', review); id = (await created.json()).id;
      assert.equal(created.status, 201); assert.equal(countJobs(), 1);
      await notifications.drain();
      assert.equal(sent.length, 1); assert.equal(sent[0].endpoint, endpointB); assert.equal(sent[0].payload.userId, 2); assert.equal(sent[0].payload.silent, true);
      assert.ok(!JSON.stringify(sent[0].payload).includes(review.title)); assert.ok(!JSON.stringify(sent[0].payload).includes(review.body));
      assert.equal((await request(`/api/reviews/${id}`, 'PATCH', { ...review, body: 'Только правка текста.', revision: 1 })).status, 200); assert.equal(countJobs(), 0);
      assert.equal((await request(`/api/reviews/${id}`, 'PATCH', { ...review, rating: 50, revision: 2 })).status, 200); assert.equal(countJobs(), 1);
      await notifications.drain(); assert.equal(sent.at(-1)!.endpoint, endpointB);
      assert.equal((await request(`/api/reviews/${id}`, 'PATCH', { ...review, rating: 50, revision: 3 })).status, 200); assert.equal(countJobs(), 0);
      assert.equal((await request(`/api/reviews/${id}`, 'PATCH', { ...review, rating: 48, revision: 2 })).status, 409); assert.equal(countJobs(), 0);
    });
    await t.test('comments, new favorites and added reactions go to the other person without self-pushes or removal noise', async () => {
      let start = sent.length;
      await request(`/api/reviews/${id}/comments`, 'POST', { body: 'Вымышленный ответ.' }, 'recipient'); await notifications.drain();
      assert.equal(sent.length, start + 1); assert.equal(sent.at(-1)!.endpoint, endpointA);
      await request(`/api/reviews/${id}/comments`, 'POST', { body: 'Его ответ.' }); await notifications.drain(); assert.equal(sent.at(-1)!.endpoint, endpointB);
      start = sent.length;
      await request(`/api/reviews/${id}/favorite`, 'PUT', { favorite: true }, 'recipient');
      await request(`/api/reviews/${id}/favorite`, 'PUT', { favorite: true }, 'recipient');
      assert.equal(countJobs(), 1); await notifications.drain(); assert.equal(sent.length, start + 1); assert.equal(sent.at(-1)!.endpoint, endpointA);
      await request(`/api/reviews/${id}/favorite`, 'PUT', { favorite: false }, 'recipient'); assert.equal(countJobs(), 0);
      await request(`/api/reviews/${id}/reactions`, 'PUT', { emoji: '🔥' }, 'recipient'); assert.equal(countJobs(), 1);
      await notifications.drain(); assert.equal(sent.at(-1)!.endpoint, endpointA);
      await request(`/api/reviews/${id}/reactions`, 'PUT', { emoji: '🔥' }, 'recipient'); assert.equal(countJobs(), 0);
    });
    await t.test('category switches, global off and a timed mute cancel queued jobs and never replay muted events', async () => {
      const start = sent.length;
      await updatePrefs('reviewer', { events: { ...defaultNotificationPreferences().events, comment: false } });
      await request(`/api/reviews/${id}/comments`, 'POST', { body: 'Не присылать.' }, 'recipient'); assert.equal(countJobs(), 0);
      await request(`/api/reviews/${id}/favorite`, 'PUT', { favorite: true }, 'recipient'); assert.equal(countJobs(), 1);
      await updatePrefs('reviewer', { mutedUntil: Date.now() + 60 * 60_000 }); assert.equal(countJobs(), 0);
      await request(`/api/reviews/${id}/comments`, 'POST', { body: 'Во время паузы.' }, 'recipient'); assert.equal(countJobs(), 0);
      await updatePrefs('reviewer', {}); await notifications.drain(); assert.equal(sent.length, start);
      await request(`/api/reviews/${id}/comments`, 'POST', { body: 'Теперь присылать.' }, 'recipient'); assert.equal(countJobs(), 1);
      await updatePrefs('reviewer', { enabled: false }); assert.equal(countJobs(), 0);
      await request(`/api/reviews/${id}/reactions`, 'PUT', { emoji: '❤️' }, 'recipient'); assert.equal(countJobs(), 0);
      await updatePrefs('reviewer', {}); await notifications.drain(); assert.equal(sent.length, start);
    });
    await t.test('temporary errors persist for retry across worker recreation; expired subscriptions are removed', async () => {
      deliveryMode = 'retry';
      await request(`/api/reviews/${id}/comments`, 'POST', { body: 'Сеть вернётся.' }, 'recipient');
      await notifications.drain(); assert.equal(countJobs(), 1);
      assert.equal(db.prepare('SELECT attempts FROM push_outbox').get()!.attempts, 1);
      const later = createNotifications(db, { dataDir: directory, origin: 'https://fictional.invalid', demo: false, send: options.pushSender });
      db.exec('UPDATE push_outbox SET next_attempt = 0'); deliveryMode = 'ok'; const start = sent.length;
      await later.drain(); assert.equal(countJobs(), 0); assert.equal(sent.length, start + 1);
      deliveryMode = 'gone'; await request(`/api/reviews/${id}/comments`, 'POST', { body: 'Подписка истекла.' }, 'recipient');
      await later.drain(); assert.equal(countJobs(), 0); assert.equal(db.prepare('SELECT 1 FROM push_subscriptions WHERE endpoint = ?').get(endpointA), undefined);
      assert.ok(db.prepare('SELECT 1 FROM push_subscriptions WHERE endpoint = ?').get(endpointB)); deliveryMode = 'ok';
    });
    await t.test('device ownership changes discard old jobs, and logout revokes delivery including queued messages', async () => {
      notifications.enqueue('comment', 1, id); assert.equal(countJobs(), 1);
      await subscribe('reviewer', endpointB); assert.equal(countJobs(), 0, 'old recipient jobs cannot be sent to a re-bound device');
      assert.deepEqual(await (await request('/api/notifications/device', 'POST', { endpoint: endpointB }, 'recipient')).json(), { connected: false });
      notifications.enqueue('comment', 2, id); assert.equal(countJobs(), 1);
      await request('/api/logout', 'POST'); assert.equal(countJobs(), 0); assert.equal(db.prepare('SELECT COUNT(*) AS n FROM push_subscriptions').get()!.n, 0);
      assert.equal((await request('/api/notifications')).status, 401);
    });
  } finally { await notifications.stop(); await new Promise<void>(resolve => server.close(() => resolve())); db.close(); await rm(directory, { recursive: true, force: true }); }
});
