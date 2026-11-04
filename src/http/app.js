import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { ZodError } from 'zod';
import { AppError } from '../errors.js';
import { logger as defaultLogger } from '../logger.js';
import { sameOriginGuard } from './auth.js';
import { adminRoutes } from './adminRoutes.js';
import { publicRoutes } from './publicRoutes.js';

const PUBLIC_DIR = fileURLToPath(new URL('../../public', import.meta.url));

const CSP = [
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

function securityHeaders(req, res, next) {
  res.set({
    'Content-Security-Policy': CSP,
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
      return res.status(400).json({
        success: false,
        error: field ? `Проверьте поле «${field}»: ${issue.message}` : issue.message,
        code: 'validation_error',
      });
    }
    if (err instanceof AppError) {
      return res.status(err.status).json({ success: false, error: err.message, code: err.code });
    }
    if (err.type === 'entity.parse.failed') {
      return res.status(400).json({ success: false, error: 'Некорректный JSON', code: 'bad_json' });
    }
    if (err.type === 'entity.too.large') {
      return res.status(413).json({ success: false, error: 'Слишком большой запрос', code: 'too_large' });
    }
    logger.error(`${req.method} ${req.path}:`, err);
    return res.status(500).json({ success: false, error: 'Внутренняя ошибка сервера', code: 'internal' });
  };
}

/**
 * @param {{ ctx: object, events?: EventEmitter, runtime?: { botUsername?: string }, logger?: object }} deps
 */
export function createApp({ ctx, events = new EventEmitter(), runtime = {}, logger = defaultLogger }) {
  const app = express();
  app.disable('x-powered-by');
  if (ctx.cfg.trustProxy) app.set('trust proxy', 1);

  app.use(securityHeaders);
  app.use(express.json({ limit: '50kb' }));

  app.use('/api', noStore);
  app.use('/api/public', publicRoutes({ ctx, events, runtime }));
  app.use('/api/admin', sameOriginGuard, adminRoutes({ ctx, events }));
  app.use('/api', (req, res) => res.status(404).json({ success: false, error: 'Не найдено', code: 'not_found' }));

  app.use(express.static(PUBLIC_DIR, { extensions: ['html'] }));
  app.use(errorHandler(logger));
  return app;
}
