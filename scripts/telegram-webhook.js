// Переключение бота между Vercel (webhook) и локальным запуском (long polling).
// npm run webhook -- set https://<проект>.vercel.app   — Telegram шлёт обновления на Vercel, ставит кнопку мини-приложения
// npm run webhook -- info                              — куда сейчас идут обновления
// npm run webhook -- delete                            — вернуть бота локальному серверу (npm start)
import { Bot } from 'grammy';
import { loadConfig } from '../src/config.js';

const [command = 'info', urlArg] = process.argv.slice(2);
const cfg = loadConfig();
const log = (msg) => process.stdout.write(`${msg}\n`);
if (!cfg.telegram.token) throw new Error('TELEGRAM_BOT_TOKEN не задан');
const api = new Bot(cfg.telegram.token).api;

async function info() {
  const hook = await api.getWebhookInfo();
  log(hook.url ? `webhook: ${hook.url}` : 'webhook не задан — бот работает через локальный сервер (long polling)');
  log(`ожидают доставки: ${hook.pending_update_count}`);
  if (hook.last_error_message) log(`последняя ошибка: ${hook.last_error_message} (${new Date(hook.last_error_date * 1000).toISOString()})`);
  const button = await api.getChatMenuButton();
  log(`кнопка меню: ${button.type === 'web_app' ? `мини-приложение ${button.web_app.url}` : button.type}`);
}

if (command === 'set') {
  const base = (urlArg || cfg.publicUrl).replace(/\/+$/, '');
  if (!/^https:\/\//.test(base)) throw new Error('Нужен https-адрес сайта: npm run webhook -- set https://…vercel.app');
  if (!cfg.telegram.webhookSecret) throw new Error('TELEGRAM_WEBHOOK_SECRET не задан');
  await api.setWebhook(`${base}/telegram/webhook`, {
    secret_token: cfg.telegram.webhookSecret,
    allowed_updates: ['message', 'callback_query'],
    drop_pending_updates: false,
  });
  await api.setChatMenuButton({ menu_button: { type: 'web_app', text: 'Записаться', web_app: { url: `${base}/app/` } } });
  log('Готово: бот переключён на Vercel.');
} else if (command === 'delete') {
  await api.deleteWebhook({ drop_pending_updates: false });
  log('Webhook снят: запустите локальный сервер (npm start), чтобы бот отвечал.');
}
await info();
