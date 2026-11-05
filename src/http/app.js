import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { ZodError } from 'zod';
import { readMedia } from '../domain/photos.js';
import { AppError } from '../errors.js';
import { logger as defaultLogger } from '../logger.js';
import { sameOriginGuard } from './auth.js';
import { fail } from './respond.js';
import { adminRoutes } from './adminRoutes.js';
import { miniappRoutes } from './miniappRoutes.js';
import { publicRoutes } from './publicRoutes.js';
import { serviceRoutes } from './serviceRoutes.js';

const PUBLIC_DIR = fileURLToPath(new URL('../../public', import.meta.url));

export const CSP = [
  "default-src 'self'",
  "script-src 'self' https://www.youtube.com", // IFrame API фонового видео hero
  "frame-src https://www.youtube-nocookie.com https://www.youtube.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com",
  "img-src 'self' data: https:",
  "media-src 'self' https:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

// Мини-приложение грузит SDK Telegram и открывается во фрейме Telegram Web — ему нужна своя политика.
export const MINIAPP_CSP = CSP
  .replace("script-src 'self' https://www.youtube.com", "script-src 'self' https://telegram.org")
  .replace("frame-ancestors 'none'", 'frame-ancestors https://web.telegram.org https://*.telegram.org');

function securityHeaders(req, res, next) {
  res.set({
    'Content-Security-Policy': req.path.startsWith('/app') ? MINIAPP_CSP : CSP,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  });
  next();
}

const noStore = (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
};

function errorHandler(logger) {
  // eslint-disable-next-line no-unused-vars
  return (err, req, res, next) => {
    if (err instanceof ZodError) {
      const issue = err.issues[0];
      const field = issue.path.join('.');
      const message = field ? `Проверьте поле «${field}»: ${issue.message}` : issue.message;
      return res.status(400).json(fail(message, 'validation_error'));
    }
    if (err instanceof AppError) {
      return res.status(err.status).json(fail(err.message, err.code));
    }
    if (err.type === 'entity.parse.failed') {
      return res.status(400).json(fail('Некорректный JSON', 'bad_json'));
    }
    if (err.type === 'entity.too.large') {
      return res.status(413).json(fail('Слишком большой запрос', 'too_large'));
    }
    logger.error(`${req.method} ${req.path}:`, err);
    return res.status(500).json(fail('Внутренняя ошибка сервера', 'internal'));
  };
}

/**
 * @param {{ ctx: object, events?: EventEmitter, runtime?: { botUsername?: string }, logger?: object,
 *           telegram?: object | null }} deps  telegram — бот для webhook и cron (режим Vercel)
 */
export function createApp({ ctx, events = new EventEmitter(), runtime = {}, logger = defaultLogger, telegram = null }) {
  const app = express();
  app.disable('x-powered-by');
  if (ctx.cfg.trustProxy) app.set('trust proxy', 1);

  app.use(securityHeaders);
  app.use(express.json({ limit: '50kb' }));

  app.use('/api', noStore);
  app.use(serviceRoutes({ cfg: ctx.cfg, telegram, logger }));
  app.use('/api/public', publicRoutes({ ctx, events, runtime }));
  app.use('/api/admin', sameOriginGuard, adminRoutes({ ctx, events, runtime }));
  app.use('/api/miniapp', miniappRoutes({ ctx, events }));
  app.use('/api', (req, res) => res.status(404).json(fail('Не найдено', 'not_found')));

  // Фото из бакета Neon отдаём со своего домена: CSP остаётся 'self', ключи бакета не покидают сервер.
  app.get('/media/*key', async (req, res) => {
    const file = await readMedia(ctx, req.params.key.join('/'));
    if (!file) return res.status(404).type('text/plain').send('Не найдено');
    res.set({ 'Content-Type': file.contentType || 'application/octet-stream', 'Cache-Control': 'public, max-age=31536000, immutable' });
    return res.send(file.bytes);
  });

  app.use(express.static(PUBLIC_DIR, { extensions: ['html'] }));
  app.use(errorHandler(logger));
  return app;
}
