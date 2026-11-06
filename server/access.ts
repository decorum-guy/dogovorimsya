import type { Express, RequestHandler } from 'express';
import { randomUUID } from 'node:crypto';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { createSession, hashPassword } from './auth.js';
import { hashAccessCode, makeAccessCode } from './codes.js';
import { publicUser, transaction, type DB } from './db.js';
import { HttpError } from './errors.js';

const password = z.string().min(12).max(256);
const codeInput = z.string().trim().min(10).max(100);
export function installAccessRoutes(app: Express, db: DB, secure: boolean, authenticated: RequestHandler, admin: RequestHandler) {
  const limiter = rateLimit({ windowMs: 15 * 60_000, limit: 15, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Слишком много попыток. Попробуй через 15 минут.' } });
  const findCode = (input: string) => {
    const row = db.prepare('SELECT * FROM access_codes WHERE code_hash = ? AND revoked_at IS NULL').get(hashAccessCode(input));
    if (!row || row.expires_at !== null && Number(row.expires_at) <= Date.now()) throw new HttpError(403, 'Код не подошёл или уже отозван. Попроси новый.');
    return row;
  };
  app.post('/api/register', limiter, async (req, res) => {
    const input = z.object({ code: codeInput, login: z.string().trim().toLowerCase().regex(/^[a-z0-9_.-]{3,40}$/), name: z.string().trim().min(1).max(50), password }).parse(req.body);
    findCode(input.code);
    const hash = await hashPassword(input.password);
    const user = transaction(db, () => {
      const code = findCode(input.code);
      if (code.user_id !== null) throw new HttpError(409, 'По этому коду уже создан аккаунт. Используй его для восстановления доступа.');
      if (db.prepare('SELECT id FROM users WHERE role = ?').get(String(code.role))) throw new HttpError(409, 'Профиль для этого приглашения уже создан.');
      if (db.prepare('SELECT id FROM users WHERE login = ?').get(input.login)) throw new HttpError(409, 'Этот логин уже занят. Придумай другой.');
      const id = Number(db.prepare('INSERT INTO users (login, password_hash, name, role) VALUES (?, ?, ?, ?)').run(input.login, hash, input.name, String(code.role)).lastInsertRowid);
      const now = new Date().toISOString();
      db.prepare('UPDATE access_codes SET user_id = ?, claimed_at = ?, last_used_at = ?, expires_at = NULL WHERE id = ?').run(id, now, now, String(code.id));
      db.prepare('UPDATE access_codes SET revoked_at = ? WHERE role = ? AND user_id IS NULL AND revoked_at IS NULL').run(now, String(code.role));
      createSession(db, res, id, secure);
      return publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id)!);
    });
    res.status(201).json({ user });
  });
  app.post('/api/recover', limiter, async (req, res) => {
    const input = z.object({ code: codeInput, password }).parse(req.body);
    const initial = findCode(input.code);
    if (initial.user_id === null) throw new HttpError(400, 'По этому коду ещё нет аккаунта. Сначала зарегистрируйся.');
    const hash = await hashPassword(input.password);
    const user = transaction(db, () => {
      const code = findCode(input.code);
      if (code.user_id === null) throw new HttpError(400, 'По этому коду ещё нет аккаунта.');
      const id = Number(code.user_id);
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, id);
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
      db.prepare('UPDATE access_codes SET last_used_at = ? WHERE id = ?').run(new Date().toISOString(), String(code.id));
      createSession(db, res, id, secure);
      return publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id)!);
    });
    res.json({ user });
  });
  app.get('/api/admin/access', authenticated, admin, (_req, res) => {
    const users = db.prepare('SELECT id, name, login, role FROM users ORDER BY id').all();
    const codes = db.prepare('SELECT id, role, user_id, created_at, claimed_at, last_used_at, revoked_at, expires_at FROM access_codes ORDER BY created_at DESC LIMIT 100').all().map(c => ({
      id: c.id, role: c.role, userId: c.user_id, createdAt: c.created_at, claimedAt: c.claimed_at,
      lastUsedAt: c.last_used_at, revokedAt: c.revoked_at, expiresAt: c.expires_at,
    }));
    res.json({ users, codes });
  });
  app.post('/api/admin/codes', authenticated, admin, (req, res) => {
    const { userId } = z.object({ userId: z.number().int().positive().nullable().default(null) }).parse(req.body);
    const target = userId ? db.prepare('SELECT id, role FROM users WHERE id = ?').get(userId) : null;
    if (userId && !target) throw new HttpError(404, 'Пользователь не найден.');
    if (!target && db.prepare("SELECT id FROM users WHERE role = 'recipient'").get()) throw new HttpError(409, 'Получатель уже зарегистрирован. Выбери его аккаунт для выдачи кода восстановления.');
    const role = target ? String(target.role) : 'recipient';
    const secret = makeAccessCode();
    const id = randomUUID(), now = new Date().toISOString();
    transaction(db, () => {
      // At most one active invitation/recovery secret per role.
      db.prepare('UPDATE access_codes SET revoked_at = ? WHERE role = ? AND revoked_at IS NULL').run(now, role);
      db.prepare('INSERT INTO access_codes (id, code_hash, role, user_id, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(id, secret.hash, role, target ? Number(target.id) : null, req.user!.id, now, target ? null : Date.now() + 30 * 24 * 60 * 60_000);
    });
    res.status(201).json({ id, code: secret.code, purpose: target ? 'recovery' : 'invite' });
  });
  app.post('/api/admin/codes/:id/revoke', authenticated, admin, (req, res) => {
    const id = z.string().uuid().parse(req.params.id);
    if (!db.prepare('SELECT id FROM access_codes WHERE id = ?').get(id)) throw new HttpError(404, 'Код не найден.');
    db.prepare('UPDATE access_codes SET revoked_at = COALESCE(revoked_at, ?) WHERE id = ?').run(new Date().toISOString(), id);
    res.json({ ok: true });
  });
  app.post('/api/admin/users/:id/password', authenticated, admin, rateLimit({ windowMs: 15 * 60_000, limit: 10, message: { error: 'Слишком много изменений. Попробуй позже.' } }), async (req, res) => {
    const id = z.coerce.number().int().positive().parse(req.params.id);
    if (id === req.user!.id) throw new HttpError(400, 'Свой пароль меняй в настройках профиля.');
    if (!db.prepare('SELECT id FROM users WHERE id = ?').get(id)) throw new HttpError(404, 'Пользователь не найден.');
    const input = z.object({ password }).parse(req.body);
    const hash = await hashPassword(input.password);
    transaction(db, () => {
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, id);
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
    });
    res.json({ ok: true });
  });
}
