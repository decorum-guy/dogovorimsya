import 'dotenv/config';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import express from 'express';
import type { ViteDevServer } from 'vite';
import { createApp } from './app.js';

const production = process.env.NODE_ENV === 'production';
const demo = process.env.APP_MODE === 'demo';
const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 3000);
if (demo && (production || !['127.0.0.1', 'localhost', '::1'].includes(host))) throw new Error('Demo must run locally, outside production');
const origin = process.env.APP_ORIGIN || `http://localhost:${port}`;
const secure = process.env.COOKIE_SECURE === 'true';
if (production && (!secure || !origin.startsWith('https://'))) throw new Error('Production requires APP_ORIGIN=https://… and COOKIE_SECURE=true');
const dataDir = resolve(demo ? './data/demo' : process.env.DATA_DIR || './data/private');
const { app, db, notifications } = createApp({ dataDir, origin, secure, demo, trustProxy: process.env.TRUST_PROXY === '1' });
if (demo) { const { seedDemo } = await import('./demo.js'); await seedDemo(db); }
const server = createServer(app);
let devServer: ViteDevServer | undefined;
if (!production) {
  const { createServer: createViteServer } = await import('vite');
  devServer = await createViteServer({ server: { middlewareMode: true, hmr: { server } }, appType: 'spa' });
  app.use(devServer.middlewares);
} else {
  app.use(express.static(resolve('dist'), { index: false }));
  app.get('/{*path}', (_req, res) => { res.set('Cache-Control', 'no-store').sendFile(resolve('dist/index.html')); });
}
server.listen(port, host, () => console.log(`Договоримся${demo ? ' · демо' : ''}: ${origin}`));
const pushTimer = setInterval(() => { void notifications.drain().catch(() => console.warn('Push worker will retry on the next tick.')); }, 5000);
pushTimer.unref();
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  clearInterval(pushTimer);
  setTimeout(() => { server.closeAllConnections(); db.close(); process.exit(1); }, 10_000).unref();
  await devServer?.close();
  await notifications.stop();
  server.close(() => { db.close(); process.exit(0); });
}
process.on('SIGTERM', close);
process.on('SIGINT', close);
