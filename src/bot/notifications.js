// Уведомления: администраторам — о новых записях и отменах клиентом, клиенту — об отмене студией.
import { adminCancelText, adminNewBookingText } from './texts.js';

export const HTML = { parse_mode: 'HTML', link_preview_options: { is_disabled: true } };

/**
 * Подписывается на события записей и возвращает notifyAdmins(text).
 * defer(promise) продлевает жизнь отправки после ответа HTTP — нужно на Vercel (waitUntil); локально ничего не делает.
 * @param {{ api: object, events: import('node:events').EventEmitter, cfg: object, logger: object, defer?: (p: Promise) => void }} deps
 */
export function setupNotifications({ api, events, cfg, logger, defer = () => {} }) {
  async function notifyAdmins(text) {
    for (const chatId of cfg.telegram.adminChatIds) {
      try {
        await api.sendMessage(chatId, text, HTML);
      } catch (err) {
        logger.error(`Не удалось уведомить администратора ${chatId}:`, err.message);
      }
    }
  }

  async function notifyClientCancelled(booking) {
    const text = `К сожалению, студия отменила вашу запись.\n\n💅 ${booking.serviceName}\nПозвоните нам, чтобы выбрать другое время: ${cfg.studio.phone}`;
    await api.sendMessage(booking.tgChatId, text).catch((err) => logger.error('Не удалось уведомить клиента:', err.message));
  }

  events.on('booking:created', (booking) => {
    defer(notifyAdmins(adminNewBookingText(booking, cfg.currency)));
  });

  events.on('booking:status', ({ booking, previous, by }) => {
    if (booking.status !== 'cancelled' || previous === 'cancelled') return;
    if (by === 'client') defer(notifyAdmins(adminCancelText(booking, cfg.currency, by)));
    else if (booking.tgChatId != null) defer(notifyClientCancelled(booking));
  });

  return { notifyAdmins };
}
