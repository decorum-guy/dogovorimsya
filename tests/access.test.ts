import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app.js';
import { hashPassword, sessionDuration } from '../server/auth.js';

test('invitation and recovery codes are private, single-account and revocable', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'dogovorimsya-access-'));
  const options = { dataDir: directory, origin: '', secure: false, demo: false };
  const { app, db } = createApp(options), server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  options.origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  db.prepare("INSERT INTO users (id, login, password_hash, name, role) VALUES (1, 'test-owner', ?, 'Тестовый автор', 'reviewer')").run(await hashPassword('fictional-owner-password'));
  const cookies: Record<string, string> = {};
  const request = async (path: string, method = 'GET', body?: unknown, who = 'owner', origin = options.origin) => fetch(options.origin + path, { method, headers: { 'Content-Type': 'application/json', Origin: origin, ...(cookies[who] ? { Cookie: cookies[who] } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const remember = (who: string, response: Response) => { cookies[who] = response.headers.get('set-cookie')!.split(';')[0]; };
  const registration = { login: 'test-recipient', name: 'Тестовый получатель', password: 'fictional-recipient-password' };
  let code = '', codeId = '', recipientId = 0;
  try {
    remember('owner', await request('/api/login', 'POST', { login: 'test-owner', password: 'fictional-owner-password' }));
    await t.test('only the author-admin can issue codes; secrets are shown once and stored as hashes', async () => {
      assert.equal((await request('/api/admin/access', 'GET', undefined, 'anonymous')).status, 401);
      const response = await request('/api/admin/codes', 'POST', {}); assert.equal(response.status, 201);
      const result = await response.json(); code = result.code; codeId = result.id;
      assert.match(code, /^DG-(?:[A-F0-9]{6}-){5}[A-F0-9]{6}$/);
      const list = JSON.stringify(await (await request('/api/admin/access')).json());
      assert.equal(list.includes(code), false); assert.equal(list.includes('code_hash'), false);
      assert.notEqual(db.prepare('SELECT code_hash FROM access_codes').get()!.code_hash, code);
    });
    await t.test('registration requires a live code and consumes exactly one account, with server-assigned role', async () => {
      assert.equal((await request('/api/register', 'POST', { ...registration, code: 'DG-000000-000000-000000-000000-000000-000000' }, 'anonymous')).status, 403);
      const response = await request('/api/register', 'POST', { ...registration, code, role: 'reviewer' }, 'anonymous');
      assert.equal(response.status, 201); remember('recipient', response);
      const body = await response.json(); recipientId = body.user.id; assert.equal(body.user.role, 'recipient');
      assert.equal((await request('/api/register', 'POST', { ...registration, login: 'third-user', code }, 'anonymous')).status, 409);
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM users').get()!.n, 2);
      assert.equal((await request('/api/admin/access', 'GET', undefined, 'recipient')).status, 403);
      assert.equal((await request('/api/admin/codes', 'POST', {}, 'recipient')).status, 403);
    });
    await t.test('the same claimed code resets only its bound account and revokes old sessions', async () => {
      const oldCookie = cookies.recipient;
      const response = await request('/api/recover', 'POST', { code, password: 'fictional-recovered-password' }, 'anonymous');
      assert.equal(response.status, 200); remember('recovered', response);
      const body = await response.json(); assert.equal(body.user.id, recipientId); assert.equal(body.user.role, 'recipient');
      assert.equal(cookies.recipient, oldCookie);
      assert.equal((await request('/api/bootstrap', 'GET', undefined, 'recipient')).status, 401);
      assert.equal((await request('/api/bootstrap', 'GET', undefined, 'recovered')).status, 200);
      assert.equal((await request('/api/login', 'POST', { login: registration.login, password: registration.password }, 'anonymous')).status, 401);
      assert.equal((await request('/api/recover', 'POST', { code, password: 'fictional-second-recovery' }, 'anonymous')).status, 200);
      assert.equal((await request('/api/bootstrap', 'GET', undefined, 'owner')).status, 200);
    });
    await t.test('revocation and code rotation stop recovery without creating additional users', async () => {
      const response = await request('/api/admin/codes', 'POST', { userId: recipientId });
      assert.equal(response.status, 201); const next = await response.json();
      assert.equal((await request('/api/recover', 'POST', { code, password: 'fictional-rejected-password' }, 'anonymous')).status, 403);
      assert.ok(db.prepare('SELECT revoked_at FROM access_codes WHERE id = ?').get(codeId)!.revoked_at);
      assert.equal((await request(`/api/admin/codes/${next.id}/revoke`, 'POST', {})).status, 200);
      assert.equal((await request('/api/recover', 'POST', { code: next.code, password: 'fictional-rejected-password' }, 'anonymous')).status, 403);
      assert.equal((await request('/api/admin/codes', 'POST', {})).status, 409);
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM users').get()!.n, 2);
    });
    await t.test('admin password changes revoke that user sessions; recipients cannot change other accounts', async () => {
      const login = await request('/api/login', 'POST', { login: registration.login, password: 'fictional-second-recovery' }, 'anonymous'); remember('recipient', login);
      assert.equal((await request('/api/admin/users/1/password', 'POST', { password: 'fictional-hijack-password' }, 'recipient')).status, 403);
      assert.equal((await request(`/api/admin/users/${recipientId}/password`, 'POST', { password: 'fictional-admin-reset-password' })).status, 200);
      assert.equal((await request('/api/bootstrap', 'GET', undefined, 'recipient')).status, 401);
      assert.equal((await request('/api/login', 'POST', { login: registration.login, password: 'fictional-admin-reset-password' }, 'anonymous')).status, 200);
      assert.equal((await request('/api/admin/users/1/password', 'POST', { password: 'fictional-new-owner-password' })).status, 400);
    });
    await t.test('active PWA sessions renew and sensitive admin mutations require the correct origin', async () => {
      db.prepare("UPDATE sessions SET expires_at = ? WHERE user_id = 1").run(Date.now() + 24 * 60 * 60_000);
      const response = await request('/api/bootstrap');
      assert.equal(response.status, 200); assert.match(response.headers.get('set-cookie')!, /HttpOnly/);
      assert.ok(Number(db.prepare('SELECT expires_at FROM sessions WHERE user_id = 1').get()!.expires_at) > Date.now() + sessionDuration - 60_000);
      assert.equal((await request('/api/admin/codes', 'POST', { userId: 1 }, 'owner', 'https://untrusted.example')).status, 403);
    });
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve())); db.close(); await rm(directory, { recursive: true, force: true });
  }
});
