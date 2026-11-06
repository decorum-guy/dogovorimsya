import { randomBytes, randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { hashPassword } from './auth.js';
import { transaction, type DB } from './db.js';

// Fictional fixtures. This function is never called in the private/production app.
export async function seedDemo(db: DB) {
  const registeredAt = new Date(Date.now() - 6 * 86_400_000).toISOString();
  if (db.prepare('SELECT 1 FROM users').get()) {
    db.prepare('UPDATE users SET registered_at = ? WHERE registered_at IS NULL').run(registeredAt);
    return;
  }
  const password = await hashPassword(randomBytes(32).toString('hex'));
  const imageId = randomUUID();
  const directory = String(db.prepare('PRAGMA database_list').get()!.file).replace(/app\.db$/, '');
  const coffee = `<svg width="1100" height="650" viewBox="0 0 1100 650" xmlns="http://www.w3.org/2000/svg">
    <defs><linearGradient id="bg" x2="1" y2="1"><stop stop-color="#d5bfa6"/><stop offset="1" stop-color="#a4846a"/></linearGradient><radialGradient id="c"><stop stop-color="#bb7c4d"/><stop offset="1" stop-color="#794b32"/></radialGradient><filter id="s"><feDropShadow dx="0" dy="16" stdDeviation="16" flood-opacity=".16"/></filter></defs>
    <path fill="url(#bg)" d="M0 0h1100v650H0z"/>
    <path d="M0 130L1100 0M0 340L1100 210M0 550L1100 420" stroke="#ebd9c4" stroke-width="3" opacity=".25"/>
    <g transform="rotate(-14 520 300)"><rect x="300" y="55" width="520" height="570" rx="6" fill="#ece0cf" filter="url(#s)"/><path d="M335 125h450M335 160h450M335 195h450M335 230h450M335 265h450M335 300h450M335 335h450M335 370h450M335 405h450M335 440h450M335 475h450M335 510h450M335 545h450" stroke="#d7c7b3"/></g>
    <g filter="url(#s)"><ellipse cx="578" cy="327" rx="168" ry="160" fill="#e6d6bf"/><ellipse cx="578" cy="320" rx="153" ry="147" fill="#f7eddd"/><path d="M695 273c113-35 126 106 16 99" fill="none" stroke="#f8efdf" stroke-width="30"/><circle cx="574" cy="311" r="122" fill="#fcf5e9"/><circle cx="574" cy="311" r="107" fill="url(#c)"/>
    <path d="M574 365c-96-58-75-111-34-92 19 9 29 27 34 40 8-17 16-32 37-40 46-17 60 37-37 92" fill="#efd7b3"/><path d="M574 349c-52-38-53-64-28-57 13 4 23 15 28 27 7-13 17-24 30-27 22-6 22 21-30 57" fill="#c89567"/></g>
    <g transform="translate(115 410) rotate(-18)"><path d="M0 0c25-58 147-60 187 0l-17 70C122 39 48 40 12 73z" fill="#9f5f32"/><path d="M5 3c42-38 135-38 176 0l-19 42C115 23 57 23 22 47z" fill="#d59c55"/><path d="M34-12l16 43m25-56 9 48m27-49 1 49m28-40-8 45" stroke="#b2793c" stroke-width="9"/></g>
    <path d="M938 460c-35-30-65 18-5 47 71-48 21-74 5-47" fill="#b54b58"/><path d="M140 110l12 24 26 4-19 18 4 27-23-13-23 13 4-27-19-18 26-4z" fill="#e8c98c"/>
  </svg>`;
  await writeFile(join(directory, 'uploads', `${imageId}.webp`), await sharp(Buffer.from(coffee)).webp({ quality: 90 }).toBuffer(), { mode: 0o600 });
  transaction(db, () => {
    db.prepare('INSERT INTO users (id, login, password_hash, name, role, registered_at) VALUES (1, ?, ?, ?, ?, ?)').run('demo-author', password, 'Он', 'reviewer', registeredAt);
    db.prepare('INSERT INTO users (id, login, password_hash, name, role, registered_at) VALUES (2, ?, ?, ?, ?, ?)').run('demo-recipient', password, 'Она', 'recipient', registeredAt);
    db.prepare('INSERT INTO media VALUES (?, 1, ?, ?)').run(imageId, 'photo', new Date().toISOString());
    const fixtures = [
      { rating: 50, title: 'Завтрак, который всё решил', body: 'Проснулся от запаха кофе. На столе — завтрак, рядом — ты в моей футболке. У комиссии нет замечаний. Только предложение повторить.', photos: [imageId], day: 0 },
      { rating: 49, title: 'Почти идеальное свидание', body: 'Всё было прекрасно. Но «пять минут, и я готова» оказались отдельным часовым поясом. Одну десятую оставляю на следующие переговоры.', photos: [], day: 1 },
      { rating: 10, title: 'Последняя картошка фри', body: 'Ты посмотрела мне в глаза. Улыбнулась. И съела последнюю картошку. Дело передано в отдел особо вкусных преступлений.', photos: [], day: 2 },
      { rating: 50, title: 'Лучший план — никакого плана', body: 'Отменили все дела, завернулись в плед и весь вечер смотрели дурацкое кино. Оказалось, это был самый важный план.', photos: [], day: 3, original: 49 },
      { rating: 37, title: 'Плед общего пользования', body: 'По документам плед наш. По факту — твой. Мне достался уголок и очень убедительный аргумент: «зато я рядом».', photos: [], day: 4 },
      { rating: 45, title: 'Прогулка с небольшим крюком', body: 'Вышли за хлебом, вернулись через два часа с цветами. Хлеб забыли. Считаю, что приоритеты расставлены почти идеально.', photos: [], day: 5 },
    ];
    for (const f of fixtures) {
      const date = new Date(); date.setDate(date.getDate() - f.day);
      const stamp = date.toISOString(), event = stamp.slice(0, 10), photos = JSON.stringify(f.photos);
      const result = db.prepare('INSERT INTO reviews (author_id, rating, title, body, event_date, photo_ids, created_at, updated_at, revision) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)').run(f.rating, f.title, f.body, event, photos, stamp, stamp, f.original ? 2 : 1);
      const id = Number(result.lastInsertRowid);
      db.prepare('UPDATE reviews SET design_variant = ? WHERE id = ?').run((id - 1) % 5, id);
      db.prepare('INSERT INTO revisions (review_id, user_id, rating, title, body, event_date, photo_ids, note, created_at) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?)').run(id, f.original || f.rating, f.title, f.body, event, photos, '', stamp);
      if (f.original) db.prepare('INSERT INTO revisions (review_id, user_id, rating, title, body, event_date, photo_ids, note, created_at) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?)').run(id, f.rating, f.title, f.body, event, photos, 'Перечитал отзыв. Такой вечер заслуживает честной пятёрки.', stamp);
    }
    const now = new Date().toISOString();
    db.prepare('INSERT INTO comments (review_id, user_id, body, created_at, updated_at) VALUES (2, 2, ?, ?, ?)').run('Это были очень красивые пять минут 😌', now, now);
    db.prepare("INSERT INTO reactions VALUES (1, 2, '❤️'), (2, 1, '😂'), (3, 2, '🔥'), (4, 2, '❤️')").run();
    db.prepare('INSERT INTO favorites VALUES (1, 1), (4, 1), (1, 2), (2, 2), (4, 2)').run();
  });
}
