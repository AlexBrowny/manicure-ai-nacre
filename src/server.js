import { EventEmitter } from 'node:events';
import { createBot } from './bot/index.js';
import { loadConfig } from './config.js';
import { openDb } from './db.js';
import { createApp } from './http/app.js';
import { logger } from './logger.js';
import { seedDefaults } from './seed.js';

const cfg = loadConfig();
for (const warning of cfg.warnings) logger.warn(warning);
if (cfg.admin.generatedPassword) logger.warn(`Временный пароль админ-панели: ${cfg.admin.password}`);

const db = await openDb({ url: cfg.databaseUrl, migrationUrl: cfg.databaseUrlDirect });
logger.info('База данных: Lakebase Postgres (Neon) подключена.');
const ctx = { db, cfg, now: () => new Date() };
if (await seedDefaults(ctx)) logger.info('База пуста — добавлены примерные услуги и мастера (их можно изменить в админ-панели).');

const events = new EventEmitter();
const runtime = {};
const app = createApp({ ctx, events, runtime });
const server = app.listen(cfg.port, () => {
  logger.info(`Сайт:         http://localhost:${cfg.port}/`);
  logger.info(`Админ-панель: http://localhost:${cfg.port}/admin/`);
});

let telegram = null;
if (cfg.telegram.token) {
  telegram = createBot({ ctx, events, token: cfg.telegram.token, runtime });
  telegram.start()
    .then((me) => logger.info(`Telegram-бот запущен: @${me.username}`))
    .catch((err) => logger.error(`Бот не запущен (проверьте TELEGRAM_BOT_TOKEN): ${err.message}`));
} else {
  logger.warn('TELEGRAM_BOT_TOKEN не задан — сайт и админка работают, бот выключен.');
}

function shutdown(signal) {
  logger.info(`${signal}: останавливаюсь…`);
  Promise.resolve(telegram?.stop()).finally(() => {
    server.close(() => {
      db.close().finally(() => process.exit(0));
    });
  });
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (reason) => logger.error('Необработанное отклонение промиса:', reason));
