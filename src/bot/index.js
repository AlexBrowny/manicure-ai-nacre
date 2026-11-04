// Telegram-бот: сборка grammY, уведомления администраторов, напоминания клиентам.
import { Bot } from 'grammy';
import { dueReminders, markReminded } from '../domain/bookings.js';
import { AppError } from '../errors.js';
import { logger as defaultLogger } from '../logger.js';
import { createFlow } from './flow.js';
import { getDraft } from './store.js';
import { adminCancelText, adminNewBookingText, reminderText } from './texts.js';

const HTML = { parse_mode: 'HTML', link_preview_options: { is_disabled: true } };
const REMINDER_INTERVAL_MS = 60_000;

const COMMANDS = [
  { command: 'start', description: 'Главное меню' },
  { command: 'book', description: 'Записаться' },
  { command: 'my', description: 'Мои записи' },
  { command: 'prices', description: 'Услуги и цены' },
  { command: 'contacts', description: 'Контакты студии' },
];

/**
 * @param {{ ctx: object, events: import('node:events').EventEmitter, token: string, botInfo?: object,
 *           logger?: object, runtime?: { botUsername?: string } }} deps
 */
export function createBot({ ctx: dctx, events, token, botInfo, logger = defaultLogger, runtime = {} }) {
  const bot = new Bot(token, botInfo ? { botInfo } : {});
  const flow = createFlow({ dctx, events });
  const { cfg } = dctx;

  // Любая ошибка сценария превращается в понятное сообщение, а не в «молчание» бота.
  bot.use(async (ctx, next) => {
    try {
      await next();
    } catch (err) {
      const known = err instanceof AppError;
      if (!known) logger.error('Ошибка бота:', err);
      await ctx.reply(known ? err.message : 'Что-то пошло не так. Попробуйте ещё раз: /start').catch(() => {});
    }
  });

  // Бот работает только в личных чатах; /id доступен везде, чтобы настроить чат администраторов.
  bot.command('id', (ctx) => ctx.reply(`Chat ID: <code>${ctx.chat.id}</code>`, HTML));
  bot.use(async (ctx, next) => {
    if (ctx.chat?.type === 'private') await next();
  });

  // Закрываем «часики» на кнопке после любого обработчика.
  bot.on('callback_query:data', async (ctx, next) => {
    await next();
    await ctx.answerCallbackQuery().catch(() => {});
  });

  bot.command('start', flow.start);
  bot.command('book', flow.chooseService);
  bot.command('my', flow.myBookings);
  bot.command('prices', flow.prices);
  bot.command('contacts', flow.info);

  bot.callbackQuery('menu', flow.menu);
  bot.callbackQuery('book', flow.chooseService);
  bot.callbackQuery('my', flow.myBookings);
  bot.callbackQuery('prices', flow.prices);
  bot.callbackQuery('info', flow.info);
  bot.callbackQuery('noop', () => {});
  bot.callbackQuery('b:mst', (c) => flow.chooseMaster(c));
  bot.callbackQuery('b:slots', (c) => {
    const date = getDraft(dctx.db, c.chat.id)?.date;
    return date ? flow.chooseTime(c, date) : flow.chooseService(c);
  });
  bot.callbackQuery(/^s:(\d+)$/, (c) => flow.chooseMaster(c, Number(c.match[1])));
  bot.callbackQuery(/^mst:(\d+)$/, (c) => flow.pickMaster(c, Number(c.match[1])));
  bot.callbackQuery(/^cal:(\d{4}-\d{2})$/, (c) => flow.chooseDate(c, c.match[1]));
  bot.callbackQuery(/^day:(\d{4}-\d{2}-\d{2})$/, (c) => flow.chooseTime(c, c.match[1]));
  bot.callbackQuery(/^t:(\d{4})$/, (c) => flow.pickTime(c, c.match[1]));
  bot.callbackQuery('ok', flow.confirm);
  bot.callbackQuery('edit:name', flow.askName);
  bot.callbackQuery('edit:phone', flow.askPhone);
  bot.callbackQuery(/^cx:(\d+)$/, (c) => flow.askCancel(c, Number(c.match[1])));
  bot.callbackQuery(/^cxy:(\d+)$/, (c) => flow.doCancel(c, Number(c.match[1])));

  bot.on('message:contact', flow.onContact);
  bot.on('message:text', flow.onText);

  bot.catch((err) => logger.error('Необработанная ошибка grammY:', err.error ?? err));

  // ---- Уведомления --------------------------------------------------------------------------
  async function notifyAdmins(text) {
    for (const chatId of cfg.telegram.adminChatIds) {
      try {
        await bot.api.sendMessage(chatId, text, HTML);
      } catch (err) {
        logger.error(`Не удалось уведомить администратора ${chatId}:`, err.message);
      }
    }
  }

  events.on('booking:created', (booking) => {
    notifyAdmins(adminNewBookingText(booking, cfg.currency));
  });

  events.on('booking:status', async ({ booking, previous, by }) => {
    if (booking.status !== 'cancelled' || previous === 'cancelled') return;
    if (by === 'client') {
      await notifyAdmins(adminCancelText(booking, cfg.currency, by));
    } else if (booking.tgChatId != null) {
      const text = `К сожалению, студия отменила вашу запись.\n\n💅 ${booking.serviceName}\nПозвоните нам, чтобы выбрать другое время: ${cfg.studio.phone}`;
      await bot.api.sendMessage(booking.tgChatId, text).catch((err) => logger.error('Не удалось уведомить клиента:', err.message));
    }
  });

  /** Отправляет все созданные к текущему моменту напоминания. Возвращает их число. */
  async function sendReminders() {
    const due = dueReminders(dctx);
    for (const { booking, kind } of due) {
      try {
        await bot.api.sendMessage(booking.tgChatId, reminderText(booking, cfg.currency, kind), HTML);
      } catch (err) {
        logger.error(`Напоминание по записи ${booking.id} не доставлено:`, err.message);
      }
      markReminded(dctx, booking.id, kind); // даже при ошибке — иначе будем стучаться бесконечно
    }
    return due.length;
  }

  let timer = null;

  return {
    bot,
    notifyAdmins,
    sendReminders,
    /** Запускает long polling и цикл напоминаний. Не блокирует. */
    async start() {
      const me = await bot.api.getMe();
      runtime.botUsername = me.username;
      await bot.api.setMyCommands(COMMANDS);
      bot.start({ drop_pending_updates: false }).catch((err) => logger.error('Бот остановлен:', err.message));
      timer = setInterval(() => sendReminders().catch((err) => logger.error('Ошибка напоминаний:', err)), REMINDER_INTERVAL_MS);
      timer.unref();
      return me;
    },
    async stop() {
      if (timer) clearInterval(timer);
      await bot.stop().catch(() => {});
    },
  };
}
