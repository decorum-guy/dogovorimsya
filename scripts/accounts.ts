import 'dotenv/config';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { resolve } from 'node:path';
import { openDatabase, transaction } from '../server/db.js';
import { hashPassword } from '../server/auth.js';
import { makeAccessCode } from '../server/codes.js';
import { randomBytes, randomUUID } from 'node:crypto';

function secret(prompt: string): Promise<string> {
  if (!stdin.isTTY) throw new Error('Запусти команду в интерактивном терминале.');
  stdout.write(prompt);
  stdin.setRawMode(true); stdin.resume();
  return new Promise((accept, reject) => {
    let value = '';
    const end = () => { stdin.setRawMode(false); stdin.pause(); stdin.off('data', onData); stdout.write('\n'); };
    const onData = (chunk: Buffer) => {
      for (const char of chunk.toString()) {
        if (char === '\u0003') { end(); reject(new Error('Отменено.')); return; }
        if (char === '\r' || char === '\n') { end(); accept(value); return; }
        if (char === '\u007f' || char === '\b') value = value.slice(0, -1);
        else if (char >= ' ') value += char;
      }
    };
    stdin.on('data', onData);
  });
}
async function password() {
  const value = await secret('Пароль (не отображается, минимум 12 символов): ');
  if (value.length < 12 || value.length > 256) throw new Error('Пароль должен содержать от 12 до 256 символов.');
  if (await secret('Повтори пароль: ') !== value) throw new Error('Пароли не совпали.');
  return hashPassword(value);
}
const db = openDatabase(resolve(process.env.DATA_DIR || './data/private'));
try {
  const [command = 'setup', role] = process.argv.slice(2);
  if (command === 'bootstrap') {
    if (db.prepare('SELECT 1 FROM users').get()) throw new Error('Первый аккаунт уже создан. Bootstrap не меняет существующие аккаунты.');
    const secret = makeAccessCode();
    const hash = await hashPassword(randomBytes(64).toString('base64url'));
    const now = new Date().toISOString();
    transaction(db, () => {
      const id = Number(db.prepare("INSERT INTO users (login, password_hash, name, role, registered_at, is_admin) VALUES ('owner', ?, 'Автор', 'reviewer', ?, 1)").run(hash, now).lastInsertRowid);
      db.prepare("INSERT INTO access_codes (id, code_hash, role, user_id, created_by, created_at) VALUES (?, ?, 'reviewer', ?, ?, ?)").run(randomUUID(), secret.hash, id, id, now);
    });
    // The secret is emitted once, only to the invoking SSH/terminal session.
    console.log(JSON.stringify({ login: 'owner', code: secret.code, purpose: 'recovery' }));
  } else if (command === 'reset' && ['reviewer', 'recipient'].includes(role)) {
    if (!db.prepare('SELECT id FROM users WHERE role = ?').get(role)) throw new Error('Такого аккаунта пока нет. Первый создаётся командой npm run accounts, второй — по приглашению.');
    const hash = await password();
    transaction(db, () => {
      db.prepare('UPDATE users SET password_hash = ? WHERE role = ?').run(hash, role);
      db.prepare('DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE role = ?)').run(role);
    });
    console.log('Пароль изменён. Предыдущие сессии завершены.');
  } else if (command === 'setup') {
    if (db.prepare('SELECT 1 FROM users').get()) throw new Error('Аккаунты уже созданы. Для сброса: npm run accounts -- reset reviewer (или recipient).');
    const accounts: { role: string; login: string; name: string; hash: string }[] = [];
    for (const role of ['reviewer']) {
      console.log('\nПервый аккаунт: автор оценок и администратор');
      const rl = createInterface({ input: stdin, output: stdout });
      const login = (await rl.question('Логин: ')).trim().toLowerCase();
      const name = (await rl.question('Имя в приложении: ')).trim();
      rl.close();
      if (!/^[a-z0-9_.-]{3,40}$/.test(login) || !name || name.length > 50) throw new Error('Логин: 3–40 латинских букв/цифр, точка, дефис, подчёркивание. Имя: 1–50 символов.');
      accounts.push({ role, login, name, hash: await password() });
    }
    transaction(db, () => { for (const a of accounts) db.prepare('INSERT INTO users (login, password_hash, name, role, registered_at, is_admin) VALUES (?, ?, ?, ?, ?, 1)').run(a.login, a.hash, a.name, a.role, new Date().toISOString()); });
    console.log('\nАккаунт администратора создан. Войди и выдай приглашение в разделе «Доступ».');
  } else throw new Error('Использование: npm run accounts [-- bootstrap|reset reviewer|recipient]');
} catch (error) { console.error(error instanceof Error ? error.message : 'Ошибка'); process.exitCode = 1; }
finally { db.close(); }
