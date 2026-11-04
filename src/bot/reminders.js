// Напоминания клиентам за сутки и за 2 часа до визита.
import { dueReminders, markReminded } from '../domain/bookings.js';
import { HTML } from './notifications.js';
import { reminderText } from './texts.js';

const REMINDER_INTERVAL_MS = 60_000;

export function createReminders({ api, dctx, logger }) {
  let timer = null;

  /** Отправляет все созданные к текущему моменту напоминания. Возвращает их число. */
  async function sendReminders() {
    const due = dueReminders(dctx);
    for (const { booking, kind } of due) {
      try {
        await api.sendMessage(booking.tgChatId, reminderText(booking, dctx.cfg.currency, kind), HTML);
      } catch (err) {
        logger.error(`Напоминание по записи ${booking.id} не доставлено:`, err.message);
      }
      markReminded(dctx, booking.id, kind); // даже при ошибке — иначе будем стучаться бесконечно
    }
    return due.length;
  }

  return {
    sendReminders,
    start() {
      timer = setInterval(() => sendReminders().catch((err) => logger.error('Ошибка напоминаний:', err)), REMINDER_INTERVAL_MS);
      timer.unref();
    },
    stop() {
      if (timer) clearInterval(timer);
    },
  };
}
