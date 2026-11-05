// Сборка приложения: конфиг, база Neon, хранилище фото, бот и Express. Общая для локального сервера и Vercel.
import { EventEmitter } from 'node:events';
import { createBot } from './bot/index.js';
import { loadConfig } from './config.js';
import { openDb } from './db.js';
import { createApp } from './http/app.js';
import { logger } from './logger.js';
import { seedDefaults } from './seed.js';
import { storageFromConfig } from './storage.js';

/**
 * @param {{ defer?: (p: Promise) => void }} options defer — продлить фоновые отправки после ответа (Vercel waitUntil)
 */
export async function bootstrap({ defer } = {}) {
  const cfg = loadConfig();
  for (const warning of cfg.warnings) logger.warn(warning);
  if (cfg.admin.generatedPassword) logger.warn(`Временный пароль админ-панели: ${cfg.admin.password}`);

  const db = await openDb({ url: cfg.databaseUrl, migrationUrl: cfg.databaseUrlDirect });
  const storage = storageFromConfig(cfg);
  const ctx = { db, cfg, storage, now: () => new Date() };
  if (await seedDefaults(ctx)) logger.info('База пуста — добавлены примерные услуги и мастера (их можно изменить в админ-панели).');

  const events = new EventEmitter();
  const runtime = {};
  const telegram = cfg.telegram.token
    ? createBot({ ctx, events, token: cfg.telegram.token, runtime, defer })
    : null;
  const app = createApp({ ctx, events, runtime, telegram });
  return { cfg, db, storage, ctx, events, runtime, telegram, app };
}
