import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

test('service worker always displays a visible push, honors silent requests, and opens only same-origin review links', async () => {
  const handlers = new Map<string, (event: any) => void>();
  const shown: { title: string; options: any }[] = [], posted: unknown[] = [], opened: string[] = [], navigated: string[] = [];
  let focused = 0, closed = 0;
  const origin = 'https://fictional.invalid';
  const client = { url: origin + '/', postMessage: (value: unknown) => posted.push(value), focus: async () => { focused++; }, navigate: async (url: string) => { navigated.push(url); return null; } };
  let openClients = [client];
  const self = {
    location: { origin },
    addEventListener: (kind: string, handler: (event: any) => void) => handlers.set(kind, handler),
    registration: { showNotification: async (title: string, options: unknown) => { shown.push({ title, options }); } },
    clients: { matchAll: async () => openClients, openWindow: async (url: string) => { opened.push(url); } },
  };
  runInNewContext(await readFile(new URL('../public/sw.js', import.meta.url), 'utf8'), { self, URL, console });
  async function dispatch(kind: string, properties: Record<string, unknown>) {
    let completion: Promise<unknown> | undefined;
    handlers.get(kind)!({ ...properties, waitUntil: (promise: Promise<unknown>) => { completion = promise; } });
    assert.ok(completion); await completion;
  }
  await dispatch('push', { data: { json: () => ({ title: 'Вымышленный сигнал', body: 'Новый комментарий', silent: true, reviewId: 12, userId: 2 }) } });
  assert.equal(shown.length, 1); assert.equal(shown[0].options.silent, true); assert.equal(shown[0].options.vibrate, undefined);
  assert.equal((posted[0] as { type: string }).type, 'JOURNAL_CHANGED');
  await dispatch('push', { data: { json: () => { throw new SyntaxError('Malformed'); } } });
  assert.equal(shown.length, 2); assert.equal(shown[1].title, 'Договоримся'); assert.ok(shown[1].options.body);
  await dispatch('notificationclick', { notification: { close: () => { closed++; }, data: { reviewId: 12, userId: 2, url: 'https://evil.invalid/' } } });
  assert.equal(navigated.length, 0, 'notification clicks must not reload a page with an open draft');
  assert.deepEqual(JSON.parse(JSON.stringify(posted.at(-1))), { type: 'OPEN_REVIEW', reviewId: 12, userId: 2 });
  assert.equal(focused, 1); assert.equal(closed, 1); assert.equal(opened.length, 0);
  openClients = [];
  await dispatch('notificationclick', { notification: { close: () => {}, data: { reviewId: 12, userId: 2 } } });
  assert.equal(opened[0], origin + '/?review=12&for=2');
  await dispatch('notificationclick', { notification: { close: () => {}, data: { reviewId: 'https://evil.invalid/', userId: 2 } } });
  assert.equal(opened[1], origin + '/');
  const focus = client.focus;
  client.focus = async () => { throw new Error('Window already closed'); }; openClients = [client];
  await dispatch('notificationclick', { notification: { close: () => {}, data: { reviewId: 12, userId: 2 } } });
  assert.equal(opened[2], origin + '/?review=12&for=2', 'a vanished background window must not swallow the notification click');
  client.focus = focus;
});
