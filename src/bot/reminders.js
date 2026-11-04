// Напоминания клиентам: автоматические (REMINDER_MINUTES, по умолчанию за 2 ч и за 10 мин) и ручные из админки.
import { dueReminders, markReminded } from '../domain/bookings.js';
import { AppError } from '../errors.js';
import { HTML } from './notifications.js';
import { reminderText } from './texts.js';

const REMINDER_INTERVAL_MS = 60_000;

export function createReminders({ api, dctx, logger }) {
  let timer = null;

  /** Отправляет все автоматические напоминания, которым пришло время. Возвращает их число. */
  async function sendReminders() {
    const due = dueReminders(dctx);
    for (const { booking, offset } of due) {
      try {
        await api.sendMessage(booking.tgChatId, reminderText(booking, dctx.cfg.currency, offset), HTML);
      } catch (err) {
        logger.error(`Напоминание по записи ${booking.id} не доставлено:`, err.message);
      }
      markReminded(dctx, booking.id, offset); // даже при ошибке — иначе будем стучаться бесконечно
    }
    return due.length;
  }

  /** Ручное напоминание из админки. Ошибку Telegram отдаём наверх, чтобы администратор её увидел. */
  async function sendManualReminder(booking) {
    try {
      await api.sendMessage(booking.tgChatId, reminderText(booking, dctx.cfg.currency), HTML);
    } catch (err) {
      logger.error(`Ручное напоминание по записи ${booking.id} не доставлено:`, err.message);
      throw new AppError(502, 'send_failed', 'Telegram не принял сообщение — возможно, клиент заблокировал бота.');
    }
  }

  return {
    sendReminders,
    sendManualReminder,
    start() {
      timer = setInterval(() => sendReminders().catch((err) => logger.error('Ошибка напоминаний:', err)), REMINDER_INTERVAL_MS);
      timer.unref();
    },
    stop() {
      if (timer) clearInterval(timer);
    },
  };
}
