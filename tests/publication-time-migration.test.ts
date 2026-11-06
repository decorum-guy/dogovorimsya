import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getReviews, openDatabase } from '../server/db.js';

test('v5 time migration restores actual publication clocks, preserves all old columns and never uses edit time', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dogovorimsya-time-migration-'));
  let db = openDatabase(directory);
  try {
    db.exec('ALTER TABLE reviews DROP COLUMN event_time; ALTER TABLE revisions DROP COLUMN event_time; PRAGMA user_version = 5;');
    db.exec("INSERT INTO users (id,login,password_hash,name,role) VALUES (1,'fictional','fictional-hash','Тестовый автор','reviewer'); INSERT INTO sessions VALUES ('fictional-session',1,9999999999999);");
    const insert = db.prepare("INSERT INTO reviews (id,author_id,rating,title,body,event_date,created_at,updated_at,revision) VALUES (?,1,49,'Тестовая записка','Вымышленный текст',?,?,?,?)");
    insert.run(1, '2026-11-01', '2026-11-06T20:59:59.000Z', '2026-11-07T10:21:00.000Z', 2);
    insert.run(2, '2026-11-07', '2026-11-06T21:10:00.000Z', '2026-11-06T21:10:00.000Z', 1);
    insert.run(3, '2026-11-06', '2026-11-06', '2026-11-06', 1);
    const revision = db.prepare("INSERT INTO revisions (review_id,user_id,rating,title,body,event_date,photo_ids,created_at) VALUES (?,1,49,'Тестовая записка','Вымышленный текст',?,'[]',?)");
    revision.run(1, '2026-11-06', '2026-11-06T20:59:59.000Z');
    revision.run(1, '2026-11-01', '2026-11-07T10:21:00.000Z');
    revision.run(2, '2026-11-07', '2026-11-06T21:10:00.000Z');
    revision.run(3, '2026-11-06', '2026-11-06');
    db.exec('INSERT INTO favorites VALUES (1,1);');
    const before = new Map(['users', 'sessions', 'reviews', 'revisions', 'favorites'].map(table => [table, db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all().map(row => ({ ...row }))]));
    db.close(); db = openDatabase(directory);
    assert.equal(db.prepare('PRAGMA user_version').get()!.user_version, 7);
    for (const [table, previous] of before) {
      const current = db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all().map(({ event_time, ...row }) => row);
      assert.deepEqual(current, previous, `all previous ${table} values must survive`);
    }
    const notes = getReviews(db, 1);
    assert.equal(notes.find(note => note.id === 1)!.eventTime, '23:59');
    assert.deepEqual(notes.find(note => note.id === 1)!.revisions.map(version => version.eventTime), ['23:59', '23:59']);
    assert.equal(notes.find(note => note.id === 2)!.eventTime, '00:10');
    assert.equal(notes.find(note => note.id === 3)!.eventTime, null, 'a date-only timestamp must not invent a time');
    db.prepare("UPDATE reviews SET event_time = '07:18' WHERE id = 1").run();
    db.close(); db = openDatabase(directory);
    assert.equal(getReviews(db, 1).find(note => note.id === 1)!.eventTime, '07:18', 'restart must not overwrite a chosen clock');
    assert.equal(getReviews(db, 1).find(note => note.id === 3)!.eventTime, null);
    assert.throws(() => db.prepare("UPDATE reviews SET event_time = '24:00' WHERE id = 1").run());
    assert.equal(db.prepare('PRAGMA integrity_check').get()!.integrity_check, 'ok');
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  } finally { db.close(); await rm(directory, { recursive: true, force: true }); }
});
