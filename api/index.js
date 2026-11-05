// Точка входа на Vercel: всё приложение — одна функция. Статика из public/ отдаётся CDN Vercel.
// Бот работает через webhook (/telegram/webhook), напоминания — POST /api/cron/reminders от cron-функции Neon.
import { attachDatabasePool, waitUntil } from '@vercel/functions';
import { bootstrap } from '../src/bootstrap.js';

const { app, db } = await bootstrap({ defer: (promise) => waitUntil(promise.catch(() => {})) });
attachDatabasePool(db.pool); // Vercel закрывает простаивающие соединения перед заморозкой функции

export default app;
