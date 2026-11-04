// API админ-панели: вход, дашборд, расписание, записи, мастера, услуги.
import express from 'express';
import { daySlots } from '../domain/availability.js';
import { createBooking, getBooking, listBookings, setStatus, updateNotes } from '../domain/bookings.js';
import {
  createMaster, createService, deleteMaster, deleteService, getMaster, listMasters, listServices,
  updateMaster, updateService,
} from '../domain/catalog.js';
import { dashboardStats } from '../domain/stats.js';
import { badRequest } from '../errors.js';
import { nowInTz, weekdayOf } from '../time.js';
import {
  COOKIE_NAME, createSessionToken, passwordMatches, requireAdmin, sessionCookie,
} from './auth.js';
import { adminMasterDto, bookingDto, serviceDto, slotDto } from './dto.js';
import { rateLimit } from './rateLimit.js';
import {
  bookingBody, bookingPatch, bookingsQuery, dashboardQuery, dayQuery, idParam, loginBody,
  masterBody, serviceBody, slotsQuery,
} from './schemas.js';

const ok = (data = null) => ({ success: true, data });

function assertServicesExist(ctx, ids) {
  const known = new Set(listServices(ctx).map((s) => s.id));
  if (ids.some((id) => !known.has(id))) throw badRequest('Выбрана несуществующая услуга');
}

export function adminRoutes({ ctx, events }) {
  const router = express.Router();
  const { cfg } = ctx;
  const maxAgeSec = cfg.admin.sessionHours * 3600;
  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, max: 10, message: 'Слишком много попыток входа. Подождите 15 минут.',
  });

  router.post('/login', loginLimiter, (req, res) => {
    const { password } = loginBody.parse(req.body);
    if (!passwordMatches(password, cfg.admin.password)) {
      return res.status(401).json({ success: false, error: 'Неверный пароль', code: 'bad_credentials' });
    }
    req.refundRateLimit?.();
    const token = createSessionToken(cfg.admin.sessionSecret, maxAgeSec * 1000);
    res.set('Set-Cookie', sessionCookie(token, { maxAgeSec, secure: cfg.admin.cookieSecure }));
    return res.json(ok({ authenticated: true }));
  });

  router.post('/logout', (req, res) => {
    res.set('Set-Cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`);
    res.json(ok());
  });

  router.use(requireAdmin(cfg));

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
    const bookings = listBookings(ctx, { from: date, to: date }).filter((b) => b.status !== 'cancelled');
    const masters = listMasters(ctx)
      .filter((m) => m.active || bookings.some((b) => b.masterId === m.id))
      .map((m) => {
        const row = m.schedule.find((s) => s.weekday === weekdayOf(date)) ?? null;
        const dayOff = m.daysOff.some((d) => d.from <= date && date <= d.to);
        return {
          id: m.id, name: m.name, title: m.title, color: m.color,
          shift: row && !dayOff ? row : null,
          dayOff,
          bookings: bookings.filter((b) => b.masterId === m.id).map(bookingDto),
        };
      });
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

  router.get('/services', (req, res) => res.json(ok(listServices(ctx).map(serviceDto))));

  router.post('/services', (req, res) => {
    res.status(201).json(ok(serviceDto(createService(ctx, serviceBody.parse(req.body)))));
  });

  router.put('/services/:id', (req, res) => {
    const { id } = idParam.parse(req.params);
    res.json(ok(serviceDto(updateService(ctx, id, serviceBody.parse(req.body)))));
  });

  router.delete('/services/:id', (req, res) => {
    deleteService(ctx, idParam.parse(req.params).id);
    res.json(ok());
  });

  router.get('/masters', (req, res) => res.json(ok(listMasters(ctx).map(adminMasterDto))));

  router.post('/masters', (req, res) => {
    const data = masterBody.parse(req.body);
    assertServicesExist(ctx, data.serviceIds);
    res.status(201).json(ok(adminMasterDto(createMaster(ctx, data))));
  });

  router.put('/masters/:id', (req, res) => {
    const { id } = idParam.parse(req.params);
    const data = masterBody.parse(req.body);
    assertServicesExist(ctx, data.serviceIds);
    res.json(ok(adminMasterDto(updateMaster(ctx, id, data))));
  });

  router.delete('/masters/:id', (req, res) => {
    deleteMaster(ctx, idParam.parse(req.params).id);
    res.json(ok());
  });

  router.get('/masters/:id', (req, res) => {
    res.json(ok(adminMasterDto(getMaster(ctx, idParam.parse(req.params).id))));
  });

  return router;
}
