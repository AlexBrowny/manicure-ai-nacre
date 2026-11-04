// Работа со временем в админке: профиль, дашборд, расписание дня, свободные слоты, записи.
import express from 'express';
import { daySlots } from '../../domain/availability.js';
import { createBooking, getBooking, listBookings, setStatus, updateNotes } from '../../domain/bookings.js';
import { daySchedule } from '../../domain/schedule.js';
import { dashboardStats } from '../../domain/stats.js';
import { nowInTz } from '../../time.js';
import { bookingDto, slotDto } from '../dto.js';
import { ok } from '../respond.js';
import {
  bookingBody, bookingPatch, bookingsQuery, dashboardQuery, dayQuery, idParam, slotsQuery,
} from '../schemas.js';

export function adminBookingRoutes({ ctx, events }) {
  const router = express.Router();
  const { cfg } = ctx;

  router.get('/me', (req, res) => {
    res.json(ok({
      authenticated: true, studio: cfg.studio, currency: cfg.currency, timeZone: cfg.timeZone,
      today: nowInTz(cfg.timeZone, ctx.now()).date,
      telegramEnabled: Boolean(cfg.telegram.token),
    }));
  });

  router.get('/dashboard', (req, res) => {
    res.json(ok(dashboardStats(ctx, dashboardQuery.parse(req.query))));
  });

  router.get('/schedule', (req, res) => {
    const { date } = dayQuery.parse(req.query);
    const masters = daySchedule(ctx, date).map((m) => ({ ...m, bookings: m.bookings.map(bookingDto) }));
    res.json(ok({ date, masters }));
  });

  router.get('/slots', (req, res) => {
    const q = slotsQuery.parse(req.query);
    const slots = daySlots(ctx, { serviceId: q.serviceId, masterId: q.masterId ?? null, date: q.date, ignoreLead: true });
    res.json(ok({ date: q.date, slots: slots.map(slotDto) }));
  });

  router.get('/bookings', (req, res) => {
    res.json(ok(listBookings(ctx, bookingsQuery.parse(req.query)).map(bookingDto)));
  });

  router.post('/bookings', (req, res) => {
    const body = bookingBody.parse(req.body);
    const booking = createBooking(ctx, {
      serviceId: body.serviceId, masterId: body.masterId ?? null, date: body.date, startMin: body.time,
      name: body.name, phone: body.phone, notes: body.notes, source: 'admin', ignoreLead: true,
    });
    events.emit('booking:created', booking);
    res.status(201).json(ok(bookingDto(getBooking(ctx, booking.id))));
  });

  router.patch('/bookings/:id', (req, res) => {
    const { id } = idParam.parse(req.params);
    const patch = bookingPatch.parse(req.body);
    const before = getBooking(ctx, id);
    if (patch.notes !== undefined) updateNotes(ctx, id, patch.notes);
    const after = patch.status ? setStatus(ctx, id, patch.status) : getBooking(ctx, id);
    if (patch.status && patch.status !== before.status) {
      events.emit('booking:status', { booking: after, previous: before.status, by: 'admin' });
    }
    res.json(ok(bookingDto(after)));
  });

  return router;
}
