// Публичное API сайта: каталог, свободное время, создание записи.
import express from 'express';
import { daySlots, monthAvailability, nextFreeSlots } from '../domain/availability.js';
import { createBooking } from '../domain/bookings.js';
import { listMasters, listServices } from '../domain/catalog.js';
import { describeOffsets, reminderOffsets } from '../domain/reminderRules.js';
import { nowInTz } from '../time.js';
import { publicBookingDto, publicMasterDto, serviceDto, slotDto } from './dto.js';
import { rateLimit } from './rateLimit.js';
import { ok } from './respond.js';
import { bookingBody, mastersQuery, monthQuery, slotsQuery } from './schemas.js';

export function publicRoutes({ ctx, events, runtime }) {
  const router = express.Router();
  const { cfg } = ctx;
  const bookingLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 15,
    message: 'Слишком много попыток записи. Попробуйте позже или позвоните нам.',
  });

  const botUsername = () => cfg.telegram.botUsername || runtime.botUsername || '';

  // Расчёт календаря не бесплатен — общий потолок на IP, помимо строгого лимита на запись.
  router.use(rateLimit({ windowMs: 60 * 1000, max: 300 }));

  router.get('/config', (req, res) => {
    res.json(ok({
      studio: cfg.studio,
      currency: cfg.currency,
      horizonDays: cfg.horizonDays,
      today: nowInTz(cfg.timeZone, ctx.now()).date,
      botUsername: botUsername(),
      reminders: describeOffsets(reminderOffsets(cfg)),
    }));
  });

  router.get('/services', (req, res) => {
    res.json(ok(listServices(ctx, { activeOnly: true }).map(serviceDto)));
  });

  router.get('/masters', (req, res) => {
    const { serviceId } = mastersQuery.parse(req.query);
    const masters = listMasters(ctx, { activeOnly: true, serviceId: serviceId ?? null });
    const next = serviceId ? nextFreeSlots(ctx, { serviceId }) : null;
    res.json(ok(masters.map((m) => publicMasterDto(m, next ? next.get(m.id) ?? null : undefined))));
  });

  router.get('/availability', (req, res) => {
    const q = monthQuery.parse(req.query);
    const days = monthAvailability(ctx, { serviceId: q.serviceId, masterId: q.masterId ?? null, month: q.month });
    res.json(ok({ month: q.month, days }));
  });

  router.get('/slots', (req, res) => {
    const q = slotsQuery.parse(req.query);
    const slots = daySlots(ctx, { serviceId: q.serviceId, masterId: q.masterId ?? null, date: q.date });
    res.json(ok({ date: q.date, slots: slots.map(slotDto) }));
  });

  router.post('/bookings', bookingLimiter, (req, res) => {
    const body = bookingBody.parse(req.body);
    if (body.website) return res.status(201).json(ok({ booking: null, telegramLink: null })); // бот-ловушка

    const booking = createBooking(ctx, {
      serviceId: body.serviceId, masterId: body.masterId ?? null, date: body.date, startMin: body.time,
      name: body.name, phone: body.phone, notes: body.notes, source: 'web',
    });
    events.emit('booking:created', booking);

    const username = botUsername();
    return res.status(201).json(ok({
      booking: publicBookingDto(booking),
      telegramLink: username ? `https://t.me/${username}?start=b_${booking.linkToken}` : null,
    }));
  });

  return router;
}
