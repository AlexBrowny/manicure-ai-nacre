// API мини-приложения Telegram: клиент опознаётся по подписанному initData, запись сразу привязана к его чату.
import express from 'express';
import { getProfile, saveProfile } from '../bot/store.js';
import { createBooking } from '../domain/bookings.js';
import { describeOffsets, reminderOffsets } from '../domain/reminderRules.js';
import { publicBookingDto } from './dto.js';
import { rateLimit } from './rateLimit.js';
import { ok } from './respond.js';
import { bookingBody } from './schemas.js';
import { verifyInitData } from './telegramAuth.js';

export function miniappRoutes({ ctx, events }) {
  const router = express.Router();
  const { cfg, db } = ctx;

  router.use(rateLimit({ windowMs: 60 * 1000, max: 120 }));
  router.use(async (req, res, next) => {
    req.tgUser = verifyInitData(req.get('x-telegram-init-data'), cfg.telegram.token, { now: ctx.now().getTime() });
    next();
  });

  /** Что уже известно о клиенте: имя из Telegram и телефон из прошлых записей. */
  router.get('/me', async (req, res) => {
    const profile = await getProfile(db, req.tgUser.id);
    const telegramName = [req.tgUser.first_name, req.tgUser.last_name].filter(Boolean).join(' ');
    res.json(ok({ name: profile.name || telegramName, phone: profile.phone || '' }));
  });

  router.post('/bookings', rateLimit({ windowMs: 60 * 60 * 1000, max: 15 }), async (req, res) => {
    const body = bookingBody.parse(req.body);
    const booking = await createBooking(ctx, {
      serviceId: body.serviceId, masterId: body.masterId ?? null, date: body.date, startMin: body.time,
      name: body.name, phone: body.phone, notes: body.notes, source: 'telegram', tgChatId: req.tgUser.id,
    });
    await saveProfile(db, req.tgUser.id, { name: booking.clientName, phone: booking.clientPhone });
    events.emit('booking:created', booking);
    res.status(201).json(ok({ booking: publicBookingDto(booking), reminders: describeOffsets(reminderOffsets(cfg)) }));
  });

  return router;
}
