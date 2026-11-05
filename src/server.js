// Локальный запуск: сайт + админка + бот в режиме long polling + цикл напоминаний.
import { bootstrap } from './bootstrap.js';
import { logger } from './logger.js';

const { cfg, db, storage, telegram, app } = await bootstrap();
logger.info('База данных: Lakebase Postgres (Neon) подключена.');
logger.info(storage ? `Фото мастеров: бакет Neon «${cfg.storage.bucket}».` : 'Бакет Neon не настроен (нет AWS_* в .env) — загрузка фото мастеров выключена.');

const server = app.listen(cfg.port, () => {
  logger.info(`Сайт:         http://localhost:${cfg.port}/`);
  logger.info(`Админ-панель: http://localhost:${cfg.port}/admin/`);
});

/** Если бот уже работает на Vercel (webhook), локальный long polling его бы «украл» — не запускаем. */
async function startBot() {
  if (!telegram) {
    logger.warn('TELEGRAM_BOT_TOKEN не задан — сайт и админка работают, бот выключен.');
    return false;
  }
  const hook = await telegram.bot.api.getWebhookInfo();
  if (hook.url && process.env.FORCE_POLLING !== '1') {
    logger.warn(`Бот работает через webhook (${new URL(hook.url).host}) — локально бот не запущен. FORCE_POLLING=1 заберёт бота сюда.`);
    return false;
  }
  const me = await telegram.start();
  logger.info(`Telegram-бот запущен: @${me.username}`);
  return true;
}

let botRunning = false;
startBot()
  .then((running) => { botRunning = running; })
  .catch((err) => logger.error(`Бот не запущен (проверьте TELEGRAM_BOT_TOKEN): ${err.message}`));

function shutdown(signal) {
  logger.info(`${signal}: останавливаюсь…`);
  Promise.resolve(botRunning ? telegram.stop() : null).finally(() => {
    server.close(() => {
      db.close().finally(() => process.exit(0));
    });
  });
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (reason) => logger.error('Необработанное отклонение промиса:', reason));
