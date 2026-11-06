import { randomBytes } from 'node:crypto';
import { tokenHash } from './auth.js';
import { HttpError } from './errors.js';

export function hashAccessCode(value: string) {
  const normalized = value.toUpperCase().replace(/[\s-]/g, '');
  if (!/^DG[A-F0-9]{36}$/.test(normalized)) throw new HttpError(403, 'Код не подошёл. Проверь его или попроси новый.');
  return tokenHash(normalized);
}
export function makeAccessCode() {
  const code = 'DG-' + randomBytes(18).toString('hex').toUpperCase().match(/.{6}/g)!.join('-');
  return { code, hash: hashAccessCode(code) };
}
