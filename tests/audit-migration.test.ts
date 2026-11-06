import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, getReviews } from '../server/db.js';

test('the audit migration preserves v4 data and old edited comments while adding receipts and comment versions', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dogovorimsya-audit-migration-'));
  let db = openDatabase(directory);
  try {
    db.exec('ALTER TABLE comments DROP COLUMN revision; DROP TABLE write_receipts; PRAGMA user_version = 4;');
    db.exec("INSERT INTO users (id,login,password_hash,name,role) VALUES (1,'fictional','fictional-hash','Тестовый автор','reviewer'); INSERT INTO sessions VALUES ('fictional-session',1,9999999999999);");
    db.exec("INSERT INTO reviews (id,author_id,rating,title,body,event_date,created_at,updated_at) VALUES (1,1,49,'Вымышленный отзыв','Текст','2026-11-06','2026-11-06','2026-11-06'); INSERT INTO favorites VALUES (1,1);");
    db.exec("INSERT INTO comments (review_id,user_id,body,created_at,updated_at) VALUES (1,1,'Ранее исправленный комментарий','2026-11-06T00:00:00Z','2026-11-06T00:01:00Z'); INSERT INTO notification_preferences VALUES (1,0,'{}',NULL,1);");
    const comment = db.prepare('SELECT * FROM comments').get()!;
    db.close(); db = openDatabase(directory);
    assert.equal(db.prepare('PRAGMA user_version').get()!.user_version, 7);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM write_receipts').get()!.n, 0);
    const migrated = db.prepare('SELECT * FROM comments').get()!;
    assert.equal(migrated.revision, 1);
    for (const [key, value] of Object.entries(comment)) assert.equal(migrated[key], value);
    const rendered = getReviews(db, 1)[0].comments[0];
    assert.notEqual(rendered.updatedAt, rendered.createdAt, 'the old edited marker remains derivable without inventing an edit count');
    assert.equal(db.prepare('SELECT password_hash FROM users').get()!.password_hash, 'fictional-hash');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sessions').get()!.n, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM favorites').get()!.n, 1);
    assert.equal(db.prepare('SELECT enabled FROM notification_preferences').get()!.enabled, 0);
    db.close(); db = openDatabase(directory);
    assert.deepEqual(db.prepare('SELECT * FROM comments').get(), migrated, 'restarting does not reset comment versions or content');
  } finally { db.close(); await rm(directory, { recursive: true, force: true }); }
});
