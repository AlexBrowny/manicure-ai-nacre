// Админ-сессия: подписанная HMAC cookie без хранения на сервере.
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export const COOKIE_NAME = 'nacre_admin';

const sha256 = (text) => createHash('sha256').update(text).digest();
const sign = (secret, payload) => createHmac('sha256', secret).update(payload).digest('base64url');

/** Сравнение паролей за постоянное время (через хэши одинаковой длины). */
export function passwordMatches(input, expected) {
  return timingSafeEqual(sha256(String(input ?? '')), sha256(expected));
}

export function createSessionToken(secret, ttlMs, now = Date.now()) {
  const expires = String(now + ttlMs);
  return `${expires}.${sign(secret, expires)}`;
}

export function verifySessionToken(secret, token, now = Date.now()) {
  if (typeof token !== 'string') return false;
  const [expires, signature, ...rest] = token.split('.');
  if (!expires || !signature || rest.length > 0 || !/^\d+$/.test(expires)) return false;
  const expected = Buffer.from(sign(secret, expires));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return false;
  return Number(expires) > now;
}

export function readCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index > 0 && part.slice(0, index).trim() === name) return decodeURIComponent(part.slice(index + 1).trim());
  }
  return null;
}

export function sessionCookie(token, { maxAgeSec, secure }) {
  const parts = [`${COOKIE_NAME}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Strict', `Max-Age=${maxAgeSec}`];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function requireAdmin(cfg) {
  return (req, res, next) => {
    if (verifySessionToken(cfg.admin.sessionSecret, readCookie(req, COOKIE_NAME))) return next();
    return res.status(401).json({ success: false, error: 'Требуется вход', code: 'unauthorized' });
  };
}

/** Защита от CSRF: запросы, меняющие данные, должны приходить с нашего же origin. */
export function sameOriginGuard(req, res, next) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  const origin = req.get('origin');
  if (origin && hostOf(origin) !== req.get('host')) {
    return res.status(403).json({ success: false, error: 'Запрещено', code: 'bad_origin' });
  }
  return next();
}

/** Origin бывает «null» (песочница) или мусором — тогда хоста нет, и запрос отклоняется. */
function hostOf(origin) {
  try {
    return new URL(origin).host;
  } catch {
    return null;
  }
}
