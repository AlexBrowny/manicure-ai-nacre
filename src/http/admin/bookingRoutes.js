// Работа со временем в админке: профиль, дашборд, расписание дня, свободные слоты, записи.
import express from 'express';
import { daySlots } from '../../domain/availability.js';
import {
  assertCanRemind, createBooking, getBooking, listBookings, markManualReminder, setStatus, updateNotes,
} from '../../domain/bookings.js';
import { daySchedule } from '../../domain/schedule.js';
import { dashboardStats } from '../../domain/stats.js';
import { conflict } from '../../errors.js';
import { nowInTz } from '../../time.js';
import { bookingDto, slotDto } from '../dto.js';
import { ok } from '../respond.js';
import {
  bookingBody, bookingPatch, bookingsQuery, dashboardQuery, dayQuery, idParam, slotsQuery,
} from '../schemas.js';

export function adminBookingRoutes({ ctx, events, runtime = {} }) {
  const router = express.Router();
  const { cfg } = ctx;

  router.get('/me', async (req, res) => {
    res.json(ok({
      authenticated: true, studio: cfg.studio, currency: cfg.currency, timeZone: cfg.timeZone,
      today: nowInTz(cfg.timeZone, ctx.now()).date,
      telegramEnabled: Boolean(cfg.telegram.token),
    }));
  });

  router.get('/dashboard', async (req, res) => {
    res.json(ok(await dashboardStats(ctx, dashboardQuery.parse(req.query))));
  });

  router.get('/schedule', async (req, res) => {
    const { date } = dayQuery.parse(req.query);
    const masters = (await daySchedule(ctx, date)).map((m) => ({ ...m, bookings: m.bookings.map(bookingDto) }));
    res.json(ok({ date, masters }));
  });

  router.get('/slots', async (req, res) => {
    const q = slotsQuery.parse(req.query);
    const slots = await daySlots(ctx, { serviceId: q.serviceId, masterId: q.masterId ?? null, date: q.date, ignoreLead: true });
    res.json(ok({ date: q.date, slots: slots.map(slotDto) }));
  });

  router.get('/bookings', async (req, res) => {
    res.json(ok((await listBookings(ctx, bookingsQuery.parse(req.query))).map(bookingDto)));
  });

  router.post('/bookings', async (req, res) => {
    const body = bookingBody.parse(req.body);
    const booking = await createBooking(ctx, {
      serviceId: body.serviceId, masterId: body.masterId ?? null, date: body.date, startMin: body.time,
      name: body.name, phone: body.phone, notes: body.notes, source: 'admin', ignoreLead: true,
    });
    events.emit('booking:created', booking);
    res.status(201).json(ok(bookingDto(await getBooking(ctx, booking.id))));
  });

  router.patch('/bookings/:id', async (req, res) => {
    const { id } = idParam.parse(req.params);
    const patch = bookingPatch.parse(req.body);
    const before = await getBooking(ctx, id);
    if (patch.notes !== undefined) await updateNotes(ctx, id, patch.notes);
    const after = patch.status ? await setStatus(ctx, id, patch.status) : await getBooking(ctx, id);
    if (patch.status && patch.status !== before.status) {
      events.emit('booking:status', { booking: after, previous: before.status, by: 'admin' });
    }
    res.json(ok(bookingDto(after)));
  });

  // Кнопка «Напомнить в Telegram» в карточке записи.
  router.post('/bookings/:id/remind', async (req, res) => {
    const booking = await getBooking(ctx, idParam.parse(req.params).id);
    assertCanRemind(ctx, booking);
    if (!runtime.sendReminder) throw conflict('Telegram-бот сейчас не запущен — напоминание отправить нельзя.', 'bot_offline');
    await runtime.sendReminder(booking);
    await markManualReminder(ctx, booking.id);
    res.json(ok(bookingDto(await getBooking(ctx, booking.id))));
  });

  return router;
}
