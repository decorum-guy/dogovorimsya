import express, { type Request, type Response, type NextFunction } from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import multer from 'multer';
import sharp from 'sharp';
import { randomUUID } from 'node:crypto';
import { writeFile, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { openDatabase, getReviews, getUsers, publicUser, transaction, type Row } from './db.js';
import { createSession, sessionCookie, sessionDuration, setSessionCookie, tokenHash, verifyPassword } from './auth.js';
import { installAccessRoutes } from './access.js';
import { HttpError } from './errors.js';
import { getCoupleStatistics } from './statistics.js';
import type { User } from '../shared/types.js';

declare global { namespace Express { interface Request { user?: User } } }
export interface AppOptions { dataDir: string; origin: string; secure: boolean; demo: boolean; trustProxy?: boolean }
const idSchema = z.string().regex(/^\d+$/).transform(Number).refine(Number.isSafeInteger);
const mediaId = z.string().uuid();
const reviewSchema = z.object({
  rating: z.number().int().min(0).max(50),
  title: z.string().trim().min(1).max(140),
  body: z.string().trim().min(1).max(10000),
  eventDate: z.iso.date(),
  photoIds: z.array(mediaId).max(5).refine(ids => new Set(ids).size === ids.length),
  note: z.string().trim().max(1000).default(''),
  revision: z.number().int().positive().optional(),
  designVariant: z.number().int().min(0).max(4).optional(),
});
const commentSchema = z.object({ body: z.string().trim().min(1).max(3000) });
const emojis = ['❤️', '🔥', '😂', '🥺'] as const;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 16 * 1024 * 1024, files: 5, fields: 2 } });

export function createApp(options: AppOptions) {
  if (options.demo && process.env.NODE_ENV === 'production') throw new Error('Demo mode is not allowed in production');
  const db = openDatabase(options.dataDir);
  const app = express();
  app.disable('x-powered-by');
  if (options.trustProxy) app.set('trust proxy', 1);
  app.use(helmet({
    contentSecurityPolicy: process.env.NODE_ENV === 'production' ? {
      directives: { defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"], imgSrc: ["'self'", 'blob:', 'data:'], fontSrc: ["'self'"], connectSrc: ["'self'"], frameAncestors: ["'none'"], upgradeInsecureRequests: options.secure ? [] : null },
    } : false,
    strictTransportSecurity: options.secure ? undefined : false,
  }));
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());
  app.use(['/api', '/media'], (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  app.use('/api', (req, res, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.get('origin') !== options.origin) {
      return res.status(403).json({ error: 'Открой приложение по его основному адресу и попробуй ещё раз.' });
    }
    next();
  });
  app.use((req, res, next) => {
    const token = req.cookies[sessionCookie];
    if (typeof token === 'string' && token.length === 64) {
      const row = db.prepare('SELECT u.*, s.expires_at AS session_expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?').get(tokenHash(token), Date.now());
      if (row) {
        req.user = publicUser(row);
        if (Number(row.session_expires_at) < Date.now() + sessionDuration - 24 * 60 * 60_000) {
          db.prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?').run(Date.now() + sessionDuration, tokenHash(token));
          setSessionCookie(res, token, options.secure);
        }
      }
    }
    next();
  });
  const authenticated = (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) throw new HttpError(401, 'Нужно войти в вашу историю.');
    next();
  };
  const reviewer = (req: Request, _res: Response, next: NextFunction) => {
    if (req.user?.role !== 'reviewer') throw new HttpError(403, 'Оценки может менять только их автор.');
    next();
  };
  const findReview = (value: unknown) => {
    const id = idSchema.parse(value);
    const row = db.prepare('SELECT * FROM reviews WHERE id = ?').get(id);
    if (!row) throw new HttpError(404, 'Этот момент не найден.');
    return row;
  };
  const checkPhotos = (ids: string[], user: User) => {
    for (const id of ids) {
      if (!db.prepare("SELECT id FROM media WHERE id = ? AND owner_id = ? AND kind = 'photo'").get(id, user.id)) {
        throw new HttpError(400, 'Одна из фотографий недоступна. Загрузите её ещё раз.');
      }
    }
  };
  const insertRevision = (id: number, userId: number, data: z.infer<typeof reviewSchema>, now: string) => {
    db.prepare('INSERT INTO revisions (review_id, user_id, rating, title, body, event_date, photo_ids, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, userId, data.rating, data.title, data.body, data.eventDate, JSON.stringify(data.photoIds), data.note, now);
  };
  app.get('/api/status', (_req, res) => res.json({ demo: options.demo }));
  app.post('/api/login', rateLimit({ windowMs: 15 * 60_000, limit: 15, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Слишком много попыток. Вернись через 15 минут.' } }), async (req, res) => {
    const input = z.object({ login: z.string().trim().min(1).max(100), password: z.string().min(1).max(256) }).parse(req.body);
    const row = db.prepare('SELECT * FROM users WHERE login = ?').get(input.login.toLowerCase());
    // A real scrypt operation also runs for unknown logins.
    const dummy = 'scrypt:000000000000000000000000000000000000000000000000:' + '00'.repeat(64);
    const matches = await verifyPassword(input.password, row ? String(row.password_hash) : dummy);
    if (!row || !matches) throw new HttpError(401, 'Логин или пароль не подошёл. Попробуем ещё раз?');
    createSession(db, res, Number(row.id), options.secure);
    res.json({ user: publicUser(row) });
  });
  if (options.demo) app.post('/api/demo/login', (req, res) => {
    const role = z.enum(['reviewer', 'recipient']).parse(req.body.role);
    const row = db.prepare('SELECT * FROM users WHERE role = ?').get(role)!;
    createSession(db, res, Number(row.id), options.secure);
    res.json({ user: publicUser(row) });
  });
  app.post('/api/logout', (req, res) => {
    const token = req.cookies[sessionCookie];
    if (typeof token === 'string') db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash(token));
    res.clearCookie(sessionCookie, { path: '/', httpOnly: true, sameSite: 'strict', secure: options.secure });
    res.json({ ok: true });
  });
  app.get('/api/bootstrap', authenticated, (req, res) => res.json({ user: req.user, users: getUsers(db), reviews: getReviews(db, req.user!.id), statistics: getCoupleStatistics(db), demo: options.demo }));
  installAccessRoutes(app, db, options.secure, authenticated, (req, _res, next) => {
    if (req.user?.role !== 'reviewer') throw new HttpError(403, 'Коды доступа может выдавать только администратор.');
    next();
  });
  app.post('/api/reviews', authenticated, reviewer, (req, res) => {
    const data = reviewSchema.parse(req.body);
    checkPhotos(data.photoIds, req.user!);
    const now = new Date().toISOString();
    const id = transaction(db, () => {
      const result = db.prepare('INSERT INTO reviews (author_id, rating, title, body, event_date, photo_ids, created_at, updated_at, design_variant) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(req.user!.id, data.rating, data.title, data.body, data.eventDate, JSON.stringify(data.photoIds), now, now, Math.floor(Math.random() * 5));
      const id = Number(result.lastInsertRowid);
      insertRevision(id, req.user!.id, data, now);
      return id;
    });
    res.status(201).json({ id });
  });
  app.patch('/api/reviews/:id', authenticated, reviewer, (req, res) => {
    const data = reviewSchema.extend({ revision: z.number().int().positive() }).parse(req.body);
    checkPhotos(data.photoIds, req.user!);
    transaction(db, () => {
      const row = findReview(req.params.id);
      if (row.author_id !== req.user!.id) throw new HttpError(403, 'Этот отзыв может изменить только его автор.');
      if (row.revision !== data.revision) throw new HttpError(409, 'Отзыв уже изменён в другом окне. Закрой редактор и обнови ленту.');
      if (row.rating === data.rating && row.title === data.title && row.body === data.body && row.event_date === data.eventDate && row.photo_ids === JSON.stringify(data.photoIds)) return;
      const now = new Date().toISOString();
      db.prepare('UPDATE reviews SET rating = ?, title = ?, body = ?, event_date = ?, photo_ids = ?, updated_at = ?, revision = revision + 1 WHERE id = ?')
        .run(data.rating, data.title, data.body, data.eventDate, JSON.stringify(data.photoIds), now, Number(row.id));
      insertRevision(Number(row.id), req.user!.id, data, now);
    });
    res.json({ ok: true });
  });
  app.post('/api/reviews/:id/comments', authenticated, (req, res) => {
    const row = findReview(req.params.id);
    const { body } = commentSchema.parse(req.body);
    const now = new Date().toISOString();
    db.prepare('INSERT INTO comments (review_id, user_id, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(Number(row.id), req.user!.id, body, now, now);
    res.status(201).json({ ok: true });
  });
  app.patch('/api/comments/:id', authenticated, (req, res) => {
    const id = idSchema.parse(req.params.id);
    const row = db.prepare('SELECT * FROM comments WHERE id = ?').get(id);
    if (!row) throw new HttpError(404, 'Комментарий не найден.');
    if (row.user_id !== req.user!.id) throw new HttpError(403, 'Можно редактировать только свой комментарий.');
    const { body } = commentSchema.parse(req.body);
    db.prepare('UPDATE comments SET body = ?, updated_at = ? WHERE id = ?').run(body, new Date().toISOString(), id);
    res.json({ ok: true });
  });
  app.put('/api/reviews/:id/reactions', authenticated, (req, res) => {
    const row = findReview(req.params.id);
    const { emoji } = z.object({ emoji: z.enum(emojis) }).parse(req.body);
    const id = Number(row.id), userId = req.user!.id;
    transaction(db, () => {
      const exists = db.prepare('SELECT 1 FROM reactions WHERE review_id = ? AND user_id = ? AND emoji = ?').get(id, userId, emoji);
      if (exists) db.prepare('DELETE FROM reactions WHERE review_id = ? AND user_id = ? AND emoji = ?').run(id, userId, emoji);
      else db.prepare('INSERT INTO reactions VALUES (?, ?, ?)').run(id, userId, emoji);
    });
    res.json({ ok: true });
  });
  app.put('/api/reviews/:id/favorite', authenticated, (req, res) => {
    const row = findReview(req.params.id);
    const { favorite } = z.object({ favorite: z.boolean() }).parse(req.body);
    if (favorite) db.prepare('INSERT OR IGNORE INTO favorites VALUES (?, ?)').run(Number(row.id), req.user!.id);
    else db.prepare('DELETE FROM favorites WHERE review_id = ? AND user_id = ?').run(Number(row.id), req.user!.id);
    res.json({ ok: true });
  });
  app.patch('/api/profile', authenticated, (req, res) => {
    const data = z.object({ name: z.string().trim().min(1).max(50), avatarId: mediaId.nullable() }).parse(req.body);
    if (data.avatarId && !db.prepare("SELECT id FROM media WHERE id = ? AND owner_id = ? AND kind = 'avatar'").get(data.avatarId, req.user!.id)) throw new HttpError(400, 'Аватар недоступен.');
    db.prepare('UPDATE users SET name = ?, avatar_id = ? WHERE id = ?').run(data.name, data.avatarId, req.user!.id);
    res.json({ ok: true });
  });
  app.post('/api/profile/password', authenticated, rateLimit({ windowMs: 15 * 60_000, limit: 10, message: { error: 'Слишком много попыток. Попробуй позже.' } }), async (req, res) => {
    const input = z.object({ current: z.string().min(1).max(256), password: z.string().min(12).max(256) }).parse(req.body);
    const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user!.id)!;
    if (!await verifyPassword(input.current, String(row.password_hash))) throw new HttpError(400, 'Текущий пароль не подошёл.');
    const { hashPassword } = await import('./auth.js');
    const hash = await hashPassword(input.password);
    transaction(db, () => {
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, req.user!.id);
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(req.user!.id);
      createSession(db, res, req.user!.id, options.secure);
    });
    res.json({ ok: true });
  });
  app.post('/api/uploads', authenticated, upload.array('photos', 5), async (req, res) => {
    const kind = z.enum(['photo', 'avatar']).parse(req.body.kind);
    if (kind === 'photo' && req.user!.role !== 'reviewer') throw new HttpError(403, 'Фотографии к отзывам добавляет автор.');
    const files = req.files as Express.Multer.File[];
    if (!files?.length || (kind === 'avatar' && files.length !== 1)) throw new HttpError(400, 'Выбери фотографию.');
    const staged: { id: string; buffer: Buffer }[] = [];
    for (const file of files) {
      try {
        const image = sharp(file.buffer, { limitInputPixels: 40_000_000, animated: false });
        const metadata = await image.metadata();
        if (!['jpeg', 'png', 'webp', 'avif', 'heif'].includes(metadata.format || '')) throw new Error('format');
        const buffer = await image.rotate().resize(kind === 'avatar' ? { width: 400, height: 400, fit: 'cover' } : { width: 2000, height: 2000, fit: 'inside', withoutEnlargement: true }).webp({ quality: 85 }).toBuffer();
        staged.push({ id: randomUUID(), buffer });
      } catch { throw new HttpError(415, 'Не получилось прочитать фото. Выбери JPEG, PNG или WebP. Для HEIC на iPhone выбери «Наиболее совместимые» при передаче.'); }
    }
    const written: string[] = [];
    try {
      for (const file of staged) {
        const path = join(options.dataDir, 'uploads', `${file.id}.webp`);
        await writeFile(path, file.buffer, { mode: 0o600 }); written.push(path);
      }
      transaction(db, () => {
        for (const file of staged) db.prepare('INSERT INTO media VALUES (?, ?, ?, ?)').run(file.id, req.user!.id, kind, new Date().toISOString());
      });
    } catch (error) { await Promise.all(written.map(path => unlink(path).catch(() => {}))); throw error; }
    res.status(201).json({ ids: staged.map(file => file.id) });
  });
  app.get('/media/:id', authenticated, (req, res) => {
    const id = mediaId.parse(req.params.id);
    if (!db.prepare('SELECT id FROM media WHERE id = ?').get(id)) throw new HttpError(404, 'Фотография не найдена.');
    res.type('webp').sendFile(resolve(options.dataDir, 'uploads', `${id}.webp`));
  });
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Такой страницы нет.' }));
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (res.headersSent) return;
    if (error instanceof z.ZodError) {
      const message = _req.path === '/api/register' ? 'Проверь имя, код и логин латиницей. Пароль — от 12 символов.'
        : _req.path === '/api/recover' || _req.path.endsWith('/password') ? 'Проверь код или текущий пароль. Новый пароль — от 12 символов.'
        : _req.path === '/api/login' ? 'Проверь логин и пароль.'
        : 'Проверь заполненные поля: текст, дату, оценку и фотографии.';
      return res.status(400).json({ error: message });
    }
    if (error instanceof multer.MulterError) return res.status(400).json({ error: 'Можно загрузить до 5 фотографий, каждая не больше 16 МБ.' });
    if (error instanceof HttpError) return res.status(error.status).json({ error: error.message });
    if (error instanceof SyntaxError) return res.status(400).json({ error: 'Не получилось прочитать запрос.' });
    console.error('Request failed:', error instanceof Error ? error.name : 'Unknown error');
    res.status(500).json({ error: 'Что-то пошло не так. Попробуй ещё раз.' });
  });
  return { app, db };
}
