import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../server/db.js';
import { hashAccessCode } from '../server/codes.js';

test('SSH bootstrap emits one recovery code and cannot replace an existing owner', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dogovorimsya-bootstrap-'));
  const run = () => spawnSync(process.execPath, ['--import', 'tsx', 'scripts/accounts.ts', 'bootstrap'], { env: { ...process.env, DATA_DIR: directory }, encoding: 'utf8' });
  try {
    const first = run(); assert.equal(first.status, 0, first.stderr);
    const setup = JSON.parse(first.stdout.trim()); assert.equal(setup.login, 'owner');
    const db = openDatabase(directory);
    const user = db.prepare('SELECT * FROM users').get()!;
    assert.equal(user.role, 'reviewer');
    const record = db.prepare('SELECT * FROM access_codes').get()!;
    assert.equal(record.user_id, user.id); assert.equal(record.code_hash, hashAccessCode(setup.code));
    assert.equal(record.expires_at, null); db.close();
    const second = run(); assert.equal(second.status, 1); assert.equal(second.stdout.includes('DG-'), false);
    const check = openDatabase(directory);
    assert.equal(check.prepare('SELECT COUNT(*) AS n FROM users').get()!.n, 1);
    assert.equal(check.prepare('SELECT COUNT(*) AS n FROM access_codes').get()!.n, 1); check.close();
  } finally { await rm(directory, { recursive: true, force: true }); }
});
