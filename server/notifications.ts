import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Express, RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';
import webpush from 'web-push';
import { z } from 'zod';
import { defaultNotificationPreferences, notificationKinds, type NotificationKind, type NotificationPreferences } from '../shared/notifications.js';
import { transaction, type DB } from './db.js';
import { sessionCookie, tokenHash } from './auth.js';
import { HttpError } from './errors.js';

const hour = 60 * 60_000;
const eventSchema = z.object({ review_created: z.boolean(), rating_changed: z.boolean(), comment: z.boolean(), favorite: z.boolean(), reaction: z.boolean() });
const preferencesSchema = z.object({ enabled: z.boolean(), events: eventSchema, mutedUntil: z.number().int().positive().nullable(), silent: z.boolean() });
// Accept browser push services only, never a user-supplied LAN or arbitrary HTTPS target.
export function isPushEndpoint(input: string) {
  try {
    const url = new URL(input), host = url.hostname;
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && !url.hash && url.pathname !== '/'
      && (host === 'fcm.googleapis.com' || host.endsWith('.push.apple.com')
        || host === 'updates.push.services.mozilla.com' || host.endsWith('.notify.windows.com'));
  } catch { return false; }
}
const endpointSchema = z.string().max(3000).refine(isPushEndpoint);
const encoded = (size: number) => z.string().regex(/^[A-Za-z0-9_-]+={0,2}$/).refine(value => Buffer.from(value, 'base64url').length === size);
const subscriptionSchema = z.object({ endpoint: endpointSchema, keys: z.object({ p256dh: encoded(65), auth: encoded(16) }) });
export type PushSender = (subscription: webpush.PushSubscription, payload: string, options: webpush.RequestOptions) => Promise<unknown>;

export function createNotifications(db: DB, options: { dataDir: string; origin: string; demo: boolean; send?: PushSender }) {
  const available = !options.demo && options.origin.startsWith('https://');
  let keys: webpush.VapidKeys | undefined;
  if (available) {
    const path = join(options.dataDir, 'push-vapid.json');
    try { keys = z.object({ publicKey: encoded(65), privateKey: encoded(32) }).parse(JSON.parse(readFileSync(path, 'utf8'))); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('Cannot read saved push keys; restore the private data backup.');
      keys = webpush.generateVAPIDKeys();
      writeFileSync(path, JSON.stringify(keys), { mode: 0o600, flag: 'wx' });
    }
  }
  const send = options.send || webpush.sendNotification.bind(webpush);
  function preferences(userId: number): NotificationPreferences {
    const row = db.prepare('SELECT * FROM notification_preferences WHERE user_id = ?').get(userId);
    return row ? { enabled: Boolean(row.enabled), events: eventSchema.parse(JSON.parse(String(row.events))), mutedUntil: row.muted_until === null ? null : Number(row.muted_until), silent: Boolean(row.silent) } : defaultNotificationPreferences();
  }
  const allowed = (prefs: NotificationPreferences, kind: NotificationKind, now: number) => prefs.enabled && prefs.events[kind] && (!prefs.mutedUntil || prefs.mutedUntil <= now);
  function enqueue(kind: NotificationKind, actorId: number, reviewId: number) {
    if (!available) return;
    const now = Date.now();
    const targets = db.prepare(`SELECT p.endpoint, p.user_id FROM push_subscriptions p JOIN sessions s ON s.token_hash = p.session_hash
      WHERE p.user_id != ? AND s.expires_at > ?`).all(actorId, now);
    for (const target of targets) {
      if (!allowed(preferences(Number(target.user_id)), kind, now)) continue;
      db.prepare('INSERT INTO push_outbox (id, endpoint, user_id, kind, review_id, created_at, next_attempt) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(randomUUID(), String(target.endpoint), Number(target.user_id), kind, reviewId, now, now);
    }
  }
  let draining = false, stopped = false;
  async function drain() {
    if (draining || stopped || !available || !keys) return;
    draining = true;
    try {
      const now = Date.now();
      db.prepare('DELETE FROM push_subscriptions WHERE session_hash IN (SELECT token_hash FROM sessions WHERE expires_at <= ?)').run(now);
      db.prepare('DELETE FROM push_outbox WHERE created_at < ?').run(now - 24 * hour);
      const jobs = db.prepare(`SELECT o.*, p.subscription, s.expires_at FROM push_outbox o
        JOIN push_subscriptions p ON p.endpoint = o.endpoint JOIN sessions s ON s.token_hash = p.session_hash
        WHERE o.next_attempt <= ? ORDER BY o.created_at LIMIT 20`).all(now);
      for (const job of jobs) {
        if (stopped) break;
        // Re-read preferences and binding: a mute/logout/account switch cancels pending jobs.
        const current = db.prepare(`SELECT p.user_id FROM push_outbox o JOIN push_subscriptions p ON p.endpoint = o.endpoint
          JOIN sessions s ON s.token_hash = p.session_hash WHERE o.id = ? AND s.expires_at > ?`).get(String(job.id), Date.now());
        if (!current || current.user_id !== job.user_id) continue;
        const prefs = preferences(Number(job.user_id)), kind = job.kind as NotificationKind | 'test';
        if ((!prefs.enabled || prefs.mutedUntil && prefs.mutedUntil > Date.now()) || kind !== 'test' && !allowed(prefs, kind, Date.now())) { db.prepare('DELETE FROM push_outbox WHERE id = ?').run(String(job.id)); continue; }
        const messages: Record<string, [string, string]> = {
          review_created: ['Звёздочки прилетели ✨', 'Новый отзыв в вашей книжке. Милота или пожар? Заходи.'],
          rating_changed: ['Сюжетный поворот 🔥', 'Оценка изменилась. Новая версия уже в книжке.'],
          comment: ['Переговоры ожили 💬', 'Тебе оставили комментарий. Есть что обсудить.'],
          favorite: ['Попало в самое сердечко ⭐', 'Твой человек добавил отзыв в избранное.'],
          reaction: ['Космос подал знак ♡', 'Твой человек отреагировал на отзыв.'],
          test: ['Связь с вашей галактикой есть 🪐', 'Это проверка. Сердечко на месте, доставка работает.'],
        };
        const [title, body] = messages[String(job.kind)] || ['Договоримся', 'В вашей книжке что-то новое.'];
        const payload = JSON.stringify({ title, body, tag: `dogovorimsya-${job.id}`, reviewId: job.review_id, userId: job.user_id, silent: prefs.silent });
        try {
          await send(JSON.parse(String(job.subscription)), payload, { TTL: 3600, urgency: 'normal', timeout: 8000, vapidDetails: { subject: options.origin, ...keys } });
          db.prepare('DELETE FROM push_outbox WHERE id = ?').run(String(job.id));
        } catch (error) {
          const status = Number((error as { statusCode?: number }).statusCode);
          if (status === 404 || status === 410) db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(String(job.endpoint));
          else if (Number(job.attempts) >= 4 || status >= 400 && status < 500 && status !== 429) db.prepare('DELETE FROM push_outbox WHERE id = ?').run(String(job.id));
          else db.prepare('UPDATE push_outbox SET attempts = attempts + 1, next_attempt = ? WHERE id = ?').run(Date.now() + Math.min(hour, 30_000 * 2 ** Number(job.attempts)), String(job.id));
          // Endpoint URLs, encryption keys and message bodies must never enter logs.
          console.warn('Push delivery deferred or discarded:', Number.isFinite(status) ? status : 'network');
        }
      }
    } finally { draining = false; }
  }
  function install(app: Express, authenticated: RequestHandler) {
    const limiter = rateLimit({ windowMs: 60_000, limit: 20, message: { error: 'Центр связи занят. Подожди минутку.' } });
    app.get('/api/notifications', authenticated, (req, res) => res.json({
      available, publicKey: keys?.publicKey || null, preferences: preferences(req.user!.id),
      deviceCount: Number(db.prepare('SELECT COUNT(*) AS n FROM push_subscriptions p JOIN sessions s ON s.token_hash = p.session_hash WHERE p.user_id = ? AND s.expires_at > ?').get(req.user!.id, Date.now())!.n),
    }));
    const updatePreferences: RequestHandler = (req, res) => {
      const patch = req.method === 'PATCH'
        ? preferencesSchema.partial().extend({ events: eventSchema.partial().optional() }).parse(req.body)
        : preferencesSchema.parse(req.body);
      const prefs = transaction(db, () => {
      const current = preferences(req.user!.id);
      const prefs = { ...current, ...patch, events: { ...current.events, ...patch.events } };
      if (prefs.mutedUntil && prefs.mutedUntil > Date.now() + 31 * 24 * hour) throw new HttpError(400, 'Паузу можно поставить максимум на месяц.');
      db.prepare(`INSERT INTO notification_preferences VALUES (?, ?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET
        enabled = excluded.enabled, events = excluded.events, muted_until = excluded.muted_until, silent = excluded.silent`)
        .run(req.user!.id, Number(prefs.enabled), JSON.stringify(prefs.events), prefs.mutedUntil, Number(prefs.silent));
      // Muting discards queued events; resuming must not replay a backlog.
      for (const kind of [...notificationKinds, 'test'] as const) {
        if (!prefs.enabled || prefs.mutedUntil && prefs.mutedUntil > Date.now() || kind !== 'test' && !prefs.events[kind]) db.prepare('DELETE FROM push_outbox WHERE user_id = ? AND kind = ?').run(req.user!.id, kind);
      }
      return prefs;
      });
      res.json({ ok: true, preferences: prefs });
    };
    app.put('/api/notifications/preferences', authenticated, updatePreferences);
    app.patch('/api/notifications/preferences', authenticated, updatePreferences);
    app.post('/api/notifications/subscriptions', authenticated, limiter, (req, res) => {
      if (!available) throw new HttpError(503, 'Уведомления доступны в основном приложении по HTTPS.');
      const subscription = subscriptionSchema.parse(req.body);
      const session = tokenHash(req.cookies[sessionCookie]);
      const existing = db.prepare('SELECT user_id, session_hash FROM push_subscriptions WHERE endpoint = ?').get(subscription.endpoint);
      if ((!existing || existing.user_id !== req.user!.id) && Number(db.prepare('SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id = ?').get(req.user!.id)!.n) >= 10) throw new HttpError(400, 'Уже подключено десять устройств. Отключи одно из них.');
      if (existing && (existing.user_id !== req.user!.id || existing.session_hash !== session)) db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(subscription.endpoint);
      db.prepare(`INSERT INTO push_subscriptions VALUES (?, ?, ?, ?, ?) ON CONFLICT(endpoint) DO UPDATE SET subscription = excluded.subscription, session_hash = excluded.session_hash`)
        .run(subscription.endpoint, req.user!.id, session, JSON.stringify(subscription), Date.now());
      res.status(201).json({ ok: true });
    });
    app.delete('/api/notifications/subscriptions', authenticated, (req, res) => {
      const { endpoint } = z.object({ endpoint: endpointSchema }).parse(req.body);
      db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?').run(endpoint, req.user!.id);
      res.json({ ok: true });
    });
    app.post('/api/notifications/device', authenticated, (req, res) => {
      const { endpoint } = z.object({ endpoint: endpointSchema }).parse(req.body);
      const connected = Boolean(db.prepare('SELECT 1 FROM push_subscriptions WHERE endpoint = ? AND user_id = ? AND session_hash = ?')
        .get(endpoint, req.user!.id, tokenHash(req.cookies[sessionCookie])));
      res.json({ connected });
    });
    app.delete('/api/notifications/device', authenticated, (req, res) => {
      db.prepare('DELETE FROM push_subscriptions WHERE user_id = ? AND session_hash = ?').run(req.user!.id, tokenHash(req.cookies[sessionCookie]));
      res.json({ ok: true });
    });
    app.post('/api/notifications/test', authenticated, rateLimit({ windowMs: 60_000, limit: 3, message: { error: 'Проверка уже улетела. Подожди минутку.' } }), (req, res) => {
      const prefs = preferences(req.user!.id);
      if (!prefs.enabled || prefs.mutedUntil && prefs.mutedUntil > Date.now()) throw new HttpError(409, 'Сначала сними паузу и включи уведомления.');
      const { endpoint } = z.object({ endpoint: endpointSchema }).parse(req.body);
      if (!db.prepare('SELECT endpoint FROM push_subscriptions WHERE endpoint = ? AND user_id = ? AND session_hash = ?').get(endpoint, req.user!.id, tokenHash(req.cookies[sessionCookie]))) throw new HttpError(400, 'Сначала подключи это устройство.');
      const now = Date.now();
      db.prepare('INSERT INTO push_outbox (id, endpoint, user_id, kind, review_id, created_at, next_attempt) VALUES (?, ?, ?, ?, NULL, ?, ?)').run(randomUUID(), endpoint, req.user!.id, 'test', now, now);
      res.status(202).json({ ok: true });
    });
  }
  async function stop() { stopped = true; while (draining) await new Promise(resolve => setTimeout(resolve, 25)); }
  return { preferences, enqueue, drain, stop, install, publicKey: keys?.publicKey };
}
