import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Review, Revision, User } from '../shared/types.js';
import { recordedPublicationTime } from '../shared/journal-days.js';

export function openDatabase(directory: string) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  mkdirSync(join(directory, 'uploads'), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(join(directory, 'app.db'));
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      login TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL UNIQUE CHECK(role IN ('reviewer', 'recipient')),
      avatar_id TEXT REFERENCES media(id),
      registered_at TEXT
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS media (
      id TEXT PRIMARY KEY,
      owner_id INTEGER NOT NULL REFERENCES users(id),
      kind TEXT NOT NULL CHECK(kind IN ('photo', 'avatar')),
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS reviews (
      id INTEGER PRIMARY KEY,
      author_id INTEGER NOT NULL REFERENCES users(id),
      rating INTEGER NOT NULL CHECK(rating BETWEEN 0 AND 50),
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      event_date TEXT NOT NULL,
      photo_ids TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      revision INTEGER NOT NULL DEFAULT 1,
      design_variant INTEGER NOT NULL DEFAULT 0 CHECK(design_variant BETWEEN 0 AND 4)
    );
    CREATE TABLE IF NOT EXISTS revisions (
      id INTEGER PRIMARY KEY,
      review_id INTEGER NOT NULL REFERENCES reviews(id),
      user_id INTEGER NOT NULL REFERENCES users(id),
      rating INTEGER NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      event_date TEXT NOT NULL,
      photo_ids TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS comments (
      id INTEGER PRIMARY KEY,
      review_id INTEGER NOT NULL REFERENCES reviews(id),
      user_id INTEGER NOT NULL REFERENCES users(id),
      body TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS reactions (
      review_id INTEGER NOT NULL REFERENCES reviews(id),
      user_id INTEGER NOT NULL REFERENCES users(id),
      emoji TEXT NOT NULL,
      PRIMARY KEY(review_id, user_id, emoji)
    );
    CREATE TABLE IF NOT EXISTS favorites (
      review_id INTEGER NOT NULL REFERENCES reviews(id),
      user_id INTEGER NOT NULL REFERENCES users(id),
      PRIMARY KEY(review_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS access_codes (
      id TEXT PRIMARY KEY,
      code_hash TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL CHECK(role IN ('reviewer', 'recipient')),
      user_id INTEGER REFERENCES users(id),
      created_by INTEGER NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL,
      claimed_at TEXT,
      last_used_at TEXT,
      revoked_at TEXT,
      expires_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS revisions_review ON revisions(review_id);
    CREATE INDEX IF NOT EXISTS comments_review ON comments(review_id);
    CREATE TABLE IF NOT EXISTS notification_preferences (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      enabled INTEGER NOT NULL,
      events TEXT NOT NULL,
      muted_until INTEGER,
      silent INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      endpoint TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      session_hash TEXT NOT NULL REFERENCES sessions(token_hash) ON DELETE CASCADE,
      subscription TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS push_outbox (
      id TEXT PRIMARY KEY,
      endpoint TEXT NOT NULL REFERENCES push_subscriptions(endpoint) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      review_id INTEGER REFERENCES reviews(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL,
      next_attempt INTEGER NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS push_outbox_due ON push_outbox(next_attempt);
    CREATE TABLE IF NOT EXISTS write_receipts (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      request_key TEXT NOT NULL,
      request_hash TEXT NOT NULL,
      response TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY(user_id, request_key)
    );
  `);
  transaction(db, () => {
    const columns = db.prepare('PRAGMA table_info(users)').all();
    if (!columns.some(column => column.name === 'registered_at')) db.exec('ALTER TABLE users ADD COLUMN registered_at TEXT');
    const commentColumns = db.prepare('PRAGMA table_info(comments)').all();
    if (!commentColumns.some(column => column.name === 'revision')) db.exec('ALTER TABLE comments ADD COLUMN revision INTEGER NOT NULL DEFAULT 1');
    if (!commentColumns.some(column => column.name === 'photos')) db.exec("ALTER TABLE comments ADD COLUMN photos TEXT NOT NULL DEFAULT '[]'");
    for (const table of ['reviews', 'revisions']) {
      if (db.prepare(`PRAGMA table_info(${table})`).all().some(column => column.name === 'event_time')) continue;
      db.exec(`ALTER TABLE ${table} ADD COLUMN event_time TEXT CHECK(event_time IS NULL OR event_time GLOB '[0-2][0-9]:[0-5][0-9]' AND event_time < '24:00')`);
      // Old versions had no editable clock. Every snapshot inherits the note's
      // original publication time, never the time of a subsequent edit.
      const rows = db.prepare(table === 'reviews' ? 'SELECT id, created_at FROM reviews'
        : 'SELECT v.id, r.created_at FROM revisions v JOIN reviews r ON r.id = v.review_id').all();
      const update = db.prepare(`UPDATE ${table} SET event_time = ? WHERE id = ?`);
      for (const row of rows) update.run(recordedPublicationTime(String(row.created_at)), Number(row.id));
    }
    // A claimed invitation is evidence of registration. Never substitute a review
    // date, deployment date or a later recovery-code issue date for it.
    db.exec(`
      UPDATE users SET registered_at = (
        SELECT MIN(claimed_at) FROM access_codes WHERE user_id = users.id AND claimed_at IS NOT NULL
      ) WHERE registered_at IS NULL AND EXISTS (
        SELECT 1 FROM access_codes WHERE user_id = users.id AND claimed_at IS NOT NULL
      );
      PRAGMA user_version = 7;
    `);
  });
  return db;
}

export type DB = ReturnType<typeof openDatabase>;
export type Row = Record<string, unknown>;
export const publicUser = (row: Row): User => ({
  id: Number(row.id), name: String(row.name), role: row.role as User['role'],
  avatarId: row.avatar_id as string | null,
});
export function getUsers(db: DB): User[] {
  return db.prepare('SELECT id, name, role, avatar_id FROM users ORDER BY id').all().map(publicUser);
}
export function transaction<T>(db: DB, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try { const result = fn(); db.exec('COMMIT'); return result; }
  catch (error) { db.exec('ROLLBACK'); throw error; }
}
export function getReviews(db: DB, userId: number): Review[] {
  const revisions = db.prepare('SELECT * FROM revisions ORDER BY id').all();
  const comments = db.prepare('SELECT * FROM comments ORDER BY id').all();
  const reactions = db.prepare('SELECT * FROM reactions').all();
  const favorites = new Set(db.prepare('SELECT review_id FROM favorites WHERE user_id = ?').all(userId).map(r => Number(r.review_id)));
  return db.prepare("SELECT * FROM reviews ORDER BY event_date DESC, COALESCE(event_time, '') DESC, id DESC").all().map(r => ({
    id: Number(r.id), authorId: Number(r.author_id), rating: Number(r.rating),
    title: String(r.title), body: String(r.body), eventDate: String(r.event_date),
    eventTime: r.event_time === null ? null : String(r.event_time),
    photoIds: JSON.parse(String(r.photo_ids)), createdAt: String(r.created_at),
    updatedAt: String(r.updated_at), revision: Number(r.revision), designVariant: Number(r.design_variant),
    revisions: revisions.filter(v => v.review_id === r.id).map((v): Revision => ({
      id: Number(v.id), userId: Number(v.user_id), rating: Number(v.rating),
      title: String(v.title), body: String(v.body), eventDate: String(v.event_date),
      eventTime: v.event_time === null ? null : String(v.event_time),
      photoIds: JSON.parse(String(v.photo_ids)), note: String(v.note), createdAt: String(v.created_at),
    })),
    comments: comments.filter(c => c.review_id === r.id).map(c => ({
      id: Number(c.id), userId: Number(c.user_id), body: String(c.body),
      createdAt: String(c.created_at), updatedAt: String(c.updated_at),
      revision: Number(c.revision),
      photos: JSON.parse(String(c.photos)),
    })),
    reactions: reactions.filter(v => v.review_id === r.id).map(v => ({ userId: Number(v.user_id), emoji: String(v.emoji) })),
    favorite: favorites.has(Number(r.id)),
  }));
}
