// Вход и выход администратора. Открыты без сессии; всё остальное в /api/admin требует входа.
import express from 'express';
import { COOKIE_NAME, createSessionToken, passwordMatches, sessionCookie } from '../auth.js';
import { rateLimit } from '../rateLimit.js';
import { fail, ok } from '../respond.js';
import { loginBody } from '../schemas.js';

export function adminAuthRoutes({ cfg }) {
  const router = express.Router();
  const maxAgeSec = cfg.admin.sessionHours * 3600;
  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, max: 10, message: 'Слишком много попыток входа. Подождите 15 минут.',
  });

  router.post('/login', loginLimiter, (req, res) => {
    const { password } = loginBody.parse(req.body);
    if (!passwordMatches(password, cfg.admin.password)) {
      return res.status(401).json(fail('Неверный пароль', 'bad_credentials'));
    }
    req.refundRateLimit?.(); // успешный вход не считается подбором пароля
    const token = createSessionToken(cfg.admin.sessionSecret, maxAgeSec * 1000);
    res.set('Set-Cookie', sessionCookie(token, { maxAgeSec, secure: cfg.admin.cookieSecure }));
    return res.json(ok({ authenticated: true }));
  });

  router.post('/logout', (req, res) => {
    res.set('Set-Cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`);
    res.json(ok());
  });

  return router;
}
