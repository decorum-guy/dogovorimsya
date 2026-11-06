import { randomBytes, scrypt as scryptCallback, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import type { Response } from 'express';
import type { DB } from './db.js';
import { HttpError } from './errors.js';

const scrypt = promisify(scryptCallback);
export async function hashPassword(password: string) {
  const salt = randomBytes(24).toString('hex');
  const key = await scrypt(password, salt, 64) as Buffer;
  return `scrypt:${salt}:${key.toString('hex')}`;
}
export async function verifyPassword(password: string, stored: string) {
  const [algorithm, salt, encoded] = stored.split(':');
  if (algorithm !== 'scrypt' || !salt || !encoded) return false;
  const expected = Buffer.from(encoded, 'hex');
  const actual = await scrypt(password, salt, 64) as Buffer;
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
export const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');
export const sessionCookie = 'dogovorimsya_session';
export function requireLiveSession(db: DB, token: unknown, userId: number) {
  if (typeof token !== 'string' || !db.prepare('SELECT 1 FROM sessions WHERE token_hash = ? AND user_id = ? AND expires_at > ?').get(tokenHash(token), userId, Date.now())) throw new HttpError(401, 'Сессия завершилась. Войди ещё раз — твои записи на месте.');
}
export const sessionDuration = 180 * 24 * 60 * 60 * 1000;
export function setSessionCookie(res: Response, token: string, secure: boolean) {
  res.cookie(sessionCookie, token, { httpOnly: true, secure, sameSite: 'strict', maxAge: sessionDuration, path: '/' });
}
export function createSession(db: DB, res: Response, userId: number, secure: boolean) {
  const token = randomBytes(32).toString('hex');
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(tokenHash(token), userId, Date.now() + sessionDuration);
  setSessionCookie(res, token, secure);
}
