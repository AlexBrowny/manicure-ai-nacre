// Служебные маршруты для работы на Vercel: webhook Telegram и запуск напоминаний по расписанию.
import express from 'express';
import { passwordMatches } from './auth.js';
import { fail, ok } from './respond.js';

const bearer = (req) => (req.get('authorization') ?? '').replace(/^Bearer\s+/i, '');

/**
 * @param {{ cfg: object, telegram?: { webhookHandler: Function, sendReminders: Function } | null, logger: object }} deps
 */
export function serviceRoutes({ cfg, telegram, logger }) {
  const router = express.Router();

  // Telegram присылает обновления сюда и подписывает их секретом из setWebhook.
  if (telegram && cfg.telegram.webhookSecret) {
    router.post('/telegram/webhook', telegram.webhookHandler(cfg.telegram.webhookSecret));
  }

  // Cron-функция Neon стучится раз в минуту; без верного секрета ничего не отправляем.
  router.post('/api/cron/reminders', async (req, res) => {
    if (!cfg.cronSecret || !passwordMatches(bearer(req), cfg.cronSecret)) {
      return res.status(401).json(fail('Нет доступа', 'unauthorized'));
    }
    if (!telegram) return res.status(409).json(fail('Telegram-бот не настроен', 'bot_offline'));
    const sent = await telegram.sendReminders();
    if (sent > 0) logger.info(`Напоминаний отправлено: ${sent}`);
    return res.json(ok({ sent }));
  });

  return router;
}
