// Проверка initData мини-приложения Telegram (https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app).
// Подпись: HMAC-SHA256(data_check_string, key = HMAC-SHA256(bot_token, key = "WebAppData")).
import { createHmac, timingSafeEqual } from 'node:crypto';
import { AppError } from '../errors.js';

const unauthorized = (message = 'Откройте запись из Telegram-бота') => new AppError(401, 'bad_init_data', message);

/** Строка для подписи: пары key=value кроме hash, отсортированные по ключу, через перевод строки. */
export function dataCheckString(params) {
  return [...params.entries()]
    .filter(([key]) => key !== 'hash')
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
}

export function signInitData(params, botToken) {
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  return createHmac('sha256', secret).update(dataCheckString(params)).digest('hex');
}

/**
 * Проверяет подпись и свежесть initData. Возвращает пользователя Telegram.
 * @returns {{ id: number, first_name?: string, last_name?: string, username?: string }}
 */
export function verifyInitData(initData, botToken, { maxAgeSec = 24 * 3600, now = Date.now() } = {}) {
  if (!botToken) throw new AppError(503, 'bot_offline', 'Telegram-бот не настроен');
  if (typeof initData !== 'string' || initData.length === 0 || initData.length > 4096) throw unauthorized();
  const params = new URLSearchParams(initData);
  const hash = params.get('hash') ?? '';
  const expected = Buffer.from(signInitData(params, botToken), 'hex');
  const actual = Buffer.from(hash, 'hex');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw unauthorized();

  const authDate = Number(params.get('auth_date'));
  if (!Number.isFinite(authDate) || now / 1000 - authDate > maxAgeSec) {
    throw unauthorized('Сессия устарела — закройте и откройте запись заново');
  }
  let user;
  try { user = JSON.parse(params.get('user') ?? ''); } catch { throw unauthorized(); }
  if (!Number.isSafeInteger(user?.id)) throw unauthorized();
  return user;
}
