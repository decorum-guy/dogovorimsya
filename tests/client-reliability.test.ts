import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Bootstrap } from '../shared/types.js';
import { loginExpression, loginPattern } from '../shared/account-validation.js';
import { api, ApiError, json } from '../src/lib/api.js';
import { JournalSync } from '../src/lib/journal-sync.js';
import { readRating } from '../src/lib/rating-input.js';
import { lastRatingChange } from '../shared/review-history.js';

function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const state = (name = 'Первый снимок', id = 1): Bootstrap => ({
  user: { id, name, role: id === 1 ? 'reviewer' : 'recipient', avatarId: null }, users: [], reviews: [], demo: false,
  statistics: { startedAt: null, reviewCount: 0, averageRating: null, perfectCount: 0, photoCount: 0, commentCount: 0, revisedRatingCount: 0, raisedRatingCount: 0, favorites: { reviewer: 0, recipient: 0, mutual: 0 }, reactions: [], ratingDistribution: { gold: 0, rose: 0, paper: 0, ember: 0, inferno: 0 } },
});
function setup(request: (path: string, options?: RequestInit) => Promise<any>) {
  const changes: (Bootstrap | null)[] = [], warnings: string[] = [];
  let nextKey = 0;
  const sync = new JournalSync(request, value => changes.push(value), value => warnings.push(value), () => `00000000-0000-4000-8000-${String(++nextKey).padStart(12, '0')}`);
  return { sync, changes, warnings };
}

test('a slow old refresh cannot overwrite a newer snapshot or a later authenticated profile', async () => {
  const old = deferred<Bootstrap>(), recent = deferred<Bootstrap>();
  const reads = [old.promise, recent.promise];
  const { sync, changes } = setup(async () => reads.shift());
  const a = sync.refresh(), b = sync.refresh();
  recent.resolve(state('Свежий')); await b; old.resolve(state('Старый')); await a;
  assert.deepEqual(changes.map(value => value?.user.name), ['Свежий']);
  const former = deferred<Bootstrap>(), next = deferred<Bootstrap>();
  reads.push(former.promise, next.promise);
  const c = sync.refresh(); sync.reset(); const d = sync.refresh();
  next.resolve(state('Другой профиль', 2)); await d;
  former.reject(new ApiError('Old session revoked', 401)); await c;
  assert.equal(changes.at(-1)?.user.id, 2, 'a late 401 from the old scope must not log out the new account');
});

test('confirmed mutations remain successful when refresh fails, and can be synchronized later', async () => {
  let writes = 0, online = false;
  const { sync, warnings, changes } = setup(async path => {
    if (path !== '/api/bootstrap') { writes++; return { ok: true }; }
    if (!online) throw new ApiError('No network', 0);
    return state('Сохранённое изменение');
  });
  await sync.save('/api/reviews', json('POST', { title: 'Вымышленный момент' }));
  assert.equal(writes, 1); assert.match(warnings.at(-1)!, /Изменение сохранено/);
  online = true; await sync.refresh();
  assert.equal(changes.at(-1)?.user.name, 'Сохранённое изменение'); assert.equal(warnings.at(-1), '');
});

test('background reads cannot repaint over pending mutations; duplicate clicks share one request', async () => {
  const old = deferred<Bootstrap>(), write = deferred<unknown>();
  let reads = 0, writes = 0;
  const { sync, changes } = setup(async path => {
    if (path !== '/api/bootstrap') { writes++; return write.promise; }
    return ++reads === 1 ? old.promise : state('После записи');
  });
  const stale = sync.refresh();
  const a = sync.save('/api/reviews/1/favorite', json('PUT', { favorite: true }));
  const b = sync.save('/api/reviews/1/favorite', json('PUT', { favorite: true }));
  assert.equal(a, b); await sync.refresh(); assert.equal(reads, 1);
  old.resolve(state('До записи')); await stale; assert.equal(changes.length, 0);
  write.resolve({ ok: true }); await a; assert.equal(writes, 1);
  assert.equal(changes.at(-1)?.user.name, 'После записи');
});

test('retry after a lost POST response uses the same receipt key, while new content has its own key', async () => {
  const keys: string[] = []; let lose = true;
  const { sync } = setup(async (path, options) => {
    if (path === '/api/bootstrap') return state();
    keys.push(new Headers(options?.headers).get('Idempotency-Key')!);
    if (lose) { lose = false; throw new ApiError('Response lost after commit', 0); }
    return { id: 1 };
  });
  const input = json('POST', { body: 'Тестовый комментарий' });
  await assert.rejects(sync.save('/api/reviews/1/comments', input));
  await sync.save('/api/reviews/1/comments', input);
  await sync.save('/api/reviews/1/comments', json('POST', { body: 'Другой комментарий' }));
  assert.ok(keys[0]); assert.equal(keys[0], keys[1]); assert.notEqual(keys[1], keys[2]);
});

test('password rotation invalidates older in-flight results and refreshes the renewed session', async () => {
  const stale = deferred<Bootstrap>(); let reads = 0;
  const { sync, changes } = setup(async path => path === '/api/bootstrap' ? (++reads === 1 ? stale.promise : state('Новая сессия')) : { ok: true });
  const old = sync.refresh(); await sync.save('/api/profile/password', json('POST', { fictional: true }));
  stale.reject(new ApiError('Old request', 401)); await old;
  assert.equal(changes.at(-1)?.user.name, 'Новая сессия');
});

test('the API preserves Headers objects and rejects invalid successful responses instead of corrupting state', async () => {
  const original = globalThis.fetch;
  try {
    let observed: Headers | undefined;
    globalThis.fetch = async (_path, options) => { observed = new Headers(options?.headers); return new Response('{"ok":true}', { headers: { 'Content-Type': 'application/json' } }); };
    await api('/test', { ...json('POST', {}), headers: new Headers({ 'Idempotency-Key': 'fictional-key' }) });
    assert.equal(observed?.get('Idempotency-Key'), 'fictional-key'); assert.equal(observed?.get('Content-Type'), 'application/json');
    globalThis.fetch = async () => new Response('<html>temporary proxy page</html>', { status: 200 });
    await assert.rejects(api('/test'), (error: unknown) => error instanceof ApiError && error.status === 502);
  } finally { globalThis.fetch = original; }
});

test('login validation compiles under the actual HTML v flag and matches the API for valid and invalid names', () => {
  const browserPattern = new RegExp(`^(?:${loginPattern})$`, 'v');
  for (const value of ['test-user', 'a_b.c', 'AUTHOR99']) { assert.ok(browserPattern.test(value)); assert.ok(loginExpression.test(value)); }
  for (const value of ['ab', 'кириллица', 'a b', 'a@b', 'a'.repeat(41), 'a/b']) { assert.equal(browserPattern.test(value), false); assert.equal(loginExpression.test(value), false); }
});

test('rating input accepts a Russian decimal comma and temporary empty text without clamping or rounding extra precision', () => {
  for (const [input, expected] of [['4,9',49], ['4.9',49], ['5',50], ['0',0], ['4.',40], ['.5',5]] as const) assert.equal(readRating(input), expected);
  for (const input of ['', ',', '5,1', '4,99', '-1', '50', 'abc', 'NaN', '1e0']) assert.equal(readRating(input), null, input);
});

test('history labels distinguish text edits from a rating change, including returning to an original score', () => {
  const history = (rating: number, values: number[]) => ({ rating, revisions: values.map(rating => ({ rating })) });
  assert.equal(lastRatingChange(history(49, [49])), null);
  assert.equal(lastRatingChange(history(49, [49, 49])), null);
  assert.deepEqual(lastRatingChange(history(50, [49, 50, 50])), { from: 49, to: 50 });
  assert.deepEqual(lastRatingChange(history(49, [49, 50, 49])), { from: 50, to: 49 });
  assert.deepEqual(lastRatingChange(history(45, [40, 50, 45])), { from: 50, to: 45 });
});

test('isolated comment writes apply the returned journal without a second round trip', async () => {
  const paths: string[] = [];
  const { sync, changes } = setup(async (path, options) => {
    paths.push(path);
    if (path === '/api/bootstrap') return state('До комментария');
    assert.equal(new Headers(options?.headers).get('Prefer'), 'return=representation');
    return { ok: true, bootstrap: state('Комментарий уже в ленте') };
  });
  await sync.refresh();
  await sync.save('/api/reviews/1/comments', json('POST', { body: '', photos: [{ id: 'fictional-photo', caption: 'Тест' }] }));
  assert.deepEqual(paths, ['/api/bootstrap', '/api/reviews/1/comments']);
  assert.equal(changes.at(-1)?.user.name, 'Комментарий уже в ленте');
});

test('overlapping comment snapshots cannot lose a write when network and commit orders differ', async () => {
  const a = deferred<unknown>(), b = deferred<unknown>();
  let reads = 0, writes = 0;
  const { sync, changes } = setup(async path => {
    if (path === '/api/bootstrap') return state(++reads === 1 ? 'Исходное' : 'Оба комментария подтверждены');
    return ++writes === 1 ? a.promise : b.promise;
  });
  await sync.refresh();
  const first = sync.save('/api/reviews/1/comments', json('POST', { body: 'A' }));
  const second = sync.save('/api/reviews/1/comments', json('POST', { body: 'B' }));
  a.resolve({ bootstrap: state('Снимок A') }); await first;
  b.resolve({ bootstrap: state('Старый снимок B без A') }); await second;
  assert.equal(changes.at(-1)?.user.name, 'Оба комментария подтверждены');
  assert.equal(changes.some(value => value?.user.name === 'Старый снимок B без A'), false);
});

test('late inline comments from an old session cannot replace another profile', async () => {
  const write = deferred<unknown>(); let user = state('Автор');
  const { sync, changes } = setup(async path => path === '/api/bootstrap' ? user : write.promise);
  await sync.refresh();
  const pending = sync.save('/api/reviews/1/comments', json('POST', { body: 'Тест' }));
  sync.reset(); user = state('Другой профиль', 2); await sync.refresh();
  write.resolve({ bootstrap: state('Старый ответ автора') }); await pending;
  assert.equal(changes.at(-1)?.user.id, 2);
});

test('manual refresh waits for pending writes and then fetches a fresh snapshot', async () => {
  const write = deferred<unknown>(); let reads = 0;
  const { sync } = setup(async path => path === '/api/bootstrap' ? (++reads, state()) : write.promise);
  await sync.refresh();
  const pending = sync.save('/api/reviews/1/favorite', json('PUT', { favorite: true }));
  const refresh = sync.refreshAfterWrites();
  await Promise.resolve(); assert.equal(reads, 1);
  write.resolve({ ok: true }); await Promise.all([pending, refresh]);
  assert.equal(reads, 3);
});
