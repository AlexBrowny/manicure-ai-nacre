// Telegram-бот: сборка grammY и маршрутизация команд/кнопок. Уведомления и напоминания — в соседних модулях.
import { Bot } from 'grammy';
import { AppError } from '../errors.js';
import { logger as defaultLogger } from '../logger.js';
import { createFlow } from './flow.js';
import { HTML, setupNotifications } from './notifications.js';
import { createReminders } from './reminders.js';
import { getDraft } from './store.js';

const COMMANDS = [
  { command: 'start', description: 'Главное меню' },
  { command: 'book', description: 'Записаться' },
  { command: 'my', description: 'Мои записи' },
  { command: 'prices', description: 'Услуги и цены' },
  { command: 'contacts', description: 'Контакты студии' },
];

/** Кнопка «Записаться» слева от поля ввода открывает мини-приложение (или обычное меню команд). */
async function setupMenuButton(api, webAppUrl, logger) {
  const menuButton = webAppUrl
    ? { type: 'web_app', text: 'Записаться', web_app: { url: webAppUrl } }
    : { type: 'commands' };
  await api.setChatMenuButton({ menu_button: menuButton }).catch((err) => logger.error('Кнопка меню не настроена:', err.message));
}

/** Middleware и маршруты: команды, кнопки (callback_data) и текстовые сообщения. */
function registerHandlers(bot, flow, { dctx, logger }) {
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
}

/**
 * @param {{ ctx: object, events: import('node:events').EventEmitter, token: string, botInfo?: object,
 *           logger?: object, runtime?: { botUsername?: string } }} deps
 */
export function createBot({ ctx: dctx, events, token, botInfo, logger = defaultLogger, runtime = {} }) {
  const bot = new Bot(token, botInfo ? { botInfo } : {});
  const flow = createFlow({ dctx, events });
  const { cfg } = dctx;

  registerHandlers(bot, flow, { dctx, logger });

  const { notifyAdmins } = setupNotifications({ api: bot.api, events, cfg, logger });
  const reminders = createReminders({ api: bot.api, dctx, logger });
  runtime.sendReminder = reminders.sendManualReminder; // кнопка «Напомнить» в админке

  return {
    bot,
    notifyAdmins,
    sendReminders: reminders.sendReminders,
    sendManualReminder: reminders.sendManualReminder,
    /** Запускает long polling и цикл напоминаний. Не блокирует. */
    async start() {
      const me = await bot.api.getMe();
      runtime.botUsername = me.username;
      await bot.api.setMyCommands(COMMANDS);
      await setupMenuButton(bot.api, dctx.cfg.telegram.webAppUrl, logger);
      bot.start({ drop_pending_updates: false }).catch((err) => logger.error('Бот остановлен:', err.message));
      reminders.start();
      return me;
    },
    async stop() {
      reminders.stop();
      await bot.stop().catch(() => {});
    },
  };
}
