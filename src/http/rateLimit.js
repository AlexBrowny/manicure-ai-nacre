import { fail } from './respond.js';

// Простой ограничитель частоты в памяти: не более `max` запросов за `windowMs` с одного IP.
export function rateLimit({ windowMs, max, message = 'Слишком много запросов. Попробуйте позже.' }) {
  const hits = new Map(); // ip → { count, resetAt }

  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of hits) if (entry.resetAt <= now) hits.delete(key);
  }, Math.min(windowMs, 60_000));
  sweep.unref();

  return function limiter(req, res, next) {
    const now = Date.now();
    const key = req.ip ?? 'unknown';
    let entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(key, entry);
    }
    entry.count += 1;
    // Обработчик может «вернуть» попытку (например, успешный вход не считается подбором пароля).
    req.refundRateLimit = () => { entry.count = Math.max(0, entry.count - 1); };
    if (entry.count > max) {
      res.set('Retry-After', String(Math.ceil((entry.resetAt - now) / 1000)));
      return res.status(429).json(fail(message, 'rate_limited'));
    }
    return next();
  };
}
