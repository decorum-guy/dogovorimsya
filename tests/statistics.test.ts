import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../server/db.js';
import { getCoupleStatistics } from '../server/statistics.js';
import { daysInJournal, plural } from '../shared/journal-days.js';

test('journal days start on recipient registration and advance at Moscow midnight', () => {
  assert.equal(daysInJournal(null), null);
  assert.equal(daysInJournal('not-a-date'), null);
  const registered = '2026-11-06T20:59:59.000Z'; // 23:59:59 in Moscow.
  assert.equal(daysInJournal(registered, new Date(registered)), 1);
  assert.equal(daysInJournal(registered, new Date('2026-11-06T21:00:00.000Z')), 2);
  assert.equal(daysInJournal(registered, new Date('2026-11-07T20:59:59.000Z')), 2);
  assert.equal(daysInJournal(registered, new Date('2026-11-07T21:00:00.000Z')), 3);
  assert.equal(daysInJournal('2026-12-31T21:05:00Z', new Date('2027-01-01T21:01:00Z')), 2);
  assert.equal(daysInJournal(registered, new Date('2026-11-05T00:00:00Z')), 1, 'a wrong device clock must not produce negative days');
  for (const [n, expected] of [[1, 'день'], [2, 'дня'], [11, 'дней'], [21, 'день'], [112, 'дней']] as const) assert.equal(plural(n, ['день', 'дня', 'дней']), expected);
});

test('couple statistics count personal favorites, overlap, distinct photos and actual rating revisions', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dogovorimsya-statistics-'));
  const db = openDatabase(directory);
  try {
    const empty = getCoupleStatistics(db);
    assert.equal(empty.startedAt, null); assert.equal(empty.reviewCount, 0); assert.equal(empty.averageRating, null);
    assert.deepEqual(empty.favorites, { reviewer: 0, recipient: 0, mutual: 0 }); assert.deepEqual(empty.reactions, []);
    db.prepare("INSERT INTO users (id, login, password_hash, name, role, registered_at) VALUES (1, 'test-author', 'fictional', 'Автор теста', 'reviewer', '2026-10-01T00:00:00Z')").run();
    assert.equal(getCoupleStatistics(db).startedAt, null, 'author signup does not start the pair counter');
    const registered = '2026-11-06T12:00:00.000Z';
    db.prepare("INSERT INTO users (id, login, password_hash, name, role, registered_at) VALUES (2, 'test-recipient', 'fictional', 'Получатель теста', 'recipient', ?)").run(registered);
    for (const [index, rating] of [50, 49, 37, 25, 10, 0].entries()) {
      const id = index + 1;
      const photos = id === 1 ? ['photo-a'] : id === 2 ? ['photo-a', 'photo-b'] : [];
      db.prepare('INSERT INTO reviews (id, author_id, rating, title, body, event_date, photo_ids, created_at, updated_at) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?)').run(id, rating, 'Вымышленный момент', 'Текст теста', '2026-11-06', JSON.stringify(photos), registered, registered);
      const history = id === 1 ? [49, 50] : id === 2 ? [49, 49] : id === 3 ? [45, 37] : id === 4 ? [25, 30, 25] : [rating];
      for (const value of history) db.prepare("INSERT INTO revisions (review_id, user_id, rating, title, body, event_date, photo_ids, created_at) VALUES (?, 1, ?, 'Момент', 'Версия', '2026-11-06', '[]', ?)").run(id, value, registered);
    }
    db.exec("INSERT INTO favorites VALUES (1,1),(2,1),(1,2),(3,2); INSERT INTO reactions VALUES (1,1,'❤️'),(1,2,'❤️'),(2,2,'🔥');");
    for (const userId of [1, 2, 2]) db.prepare("INSERT INTO comments (review_id,user_id,body,created_at,updated_at) VALUES (1,?,'Аргумент',?,?)").run(userId, registered, registered);
    const stats = getCoupleStatistics(db);
    assert.equal(stats.startedAt, registered); assert.equal(stats.reviewCount, 6); assert.equal(stats.averageRating, 2.85);
    assert.deepEqual(stats.favorites, { reviewer: 2, recipient: 2, mutual: 1 });
    assert.equal(stats.photoCount, 2, 'reused photos count once'); assert.equal(stats.commentCount, 3); assert.equal(stats.perfectCount, 1);
    assert.equal(stats.revisedRatingCount, 3, 'text edits alone do not count, a changed-and-restored rating does');
    assert.equal(stats.raisedRatingCount, 1);
    assert.deepEqual(stats.ratingDistribution, { gold: 1, rose: 1, paper: 1, ember: 1, inferno: 2 });
    assert.equal(stats.reactions.find(r => r.emoji === '❤️')?.count, 2); assert.equal(stats.reactions.find(r => r.emoji === '🔥')?.count, 1);
  } finally { db.close(); await rm(directory, { recursive: true, force: true }); }
});

test('v2 migration recovers the original signup date without changing accounts, sessions or reviews', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dogovorimsya-migration-'));
  let db = openDatabase(directory);
  try {
    db.exec("ALTER TABLE users DROP COLUMN registered_at; PRAGMA user_version = 2;");
    db.exec("INSERT INTO users (id,login,password_hash,name,role) VALUES (1,'author-test','fictional-hash-1','Тестовый автор','reviewer'),(2,'recipient-test','fictional-hash-2','Тестовый получатель','recipient');");
    const registered = '2026-11-06T12:34:56.000Z';
    db.prepare("INSERT INTO access_codes (id,code_hash,role,user_id,created_by,created_at,claimed_at,revoked_at) VALUES ('original','fictional-code-hash','recipient',2,1,'2026-11-01T00:00:00Z',?,'2026-11-07T00:00:00Z')").run(registered);
    db.exec("INSERT INTO access_codes (id,code_hash,role,user_id,created_by,created_at) VALUES ('replacement','fictional-other-hash','recipient',2,1,'2026-11-08T00:00:00Z'); INSERT INTO sessions VALUES ('fictional-session',2,9999999999999);");
    db.exec("INSERT INTO reviews (id,author_id,rating,title,body,event_date,created_at,updated_at) VALUES (1,1,49,'Момент','Вымышленный отзыв','2026-11-01','2026-11-01T00:00:00Z','2026-11-01T00:00:00Z'); INSERT INTO favorites VALUES (1,1),(1,2);");
    db.close(); db = openDatabase(directory);
    assert.equal(db.prepare('PRAGMA user_version').get()!.user_version, 6);
    assert.equal(db.prepare('SELECT registered_at FROM users WHERE id = 2').get()!.registered_at, registered);
    assert.equal(db.prepare('SELECT registered_at FROM users WHERE id = 1').get()!.registered_at, null, 'unknown legacy dates must not be invented');
    assert.equal(db.prepare('SELECT password_hash FROM users WHERE id = 2').get()!.password_hash, 'fictional-hash-2');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sessions').get()!.n, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM access_codes').get()!.n, 2);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM reviews').get()!.n, 1);
    assert.deepEqual(getCoupleStatistics(db).favorites, { reviewer: 1, recipient: 1, mutual: 1 });
    db.close(); db = openDatabase(directory);
    assert.equal(getCoupleStatistics(db).startedAt, registered, 'subsequent starts preserve the date');
  } finally { db.close(); await rm(directory, { recursive: true, force: true }); }
});
