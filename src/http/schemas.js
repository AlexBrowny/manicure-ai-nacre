// Схемы валидации входящих данных (zod). Время приходит как 'HH:MM', внутри — минуты.
import { z } from 'zod';
import { hhmmToMin, isISODate, isMonth } from '../time.js';
import { STATUSES } from '../domain/bookings.js';

const id = z.coerce.number().int().positive();
const date = z.string().refine(isISODate, 'Некорректная дата');
const hhmm = z.string().regex(/^([01]?\d|2[0-3]):[0-5]\d$/, 'Время в формате ЧЧ:ММ').transform(hhmmToMin);
const optionalHhmm = z.preprocess((v) => (v === '' || v === undefined ? null : v), hhmm.nullable());
const text = (max) => z.string().trim().max(max);

export const idParam = z.object({ id });

export const monthQuery = z.object({
  serviceId: id,
  masterId: id.optional(),
  month: z.string().refine(isMonth, 'Месяц в формате ГГГГ-ММ'),
});

export const slotsQuery = z.object({ serviceId: id, masterId: id.optional(), date });
export const mastersQuery = z.object({ serviceId: id.optional() });

export const bookingBody = z.object({
  serviceId: id,
  masterId: id.nullish(),
  date,
  time: hhmm,
  name: z.string().max(100),
  phone: z.string().max(40),
  notes: text(500).optional(),
  website: z.string().max(200).optional(), // honeypot — человек это поле не видит
});

export const dashboardQuery = z.object({ from: date, to: date }).refine(
  (q) => q.from <= q.to && q.to <= addDaysLimit(q.from), 'Период не длиннее 93 дней',
);
function addDaysLimit(from) {
  const d = new Date(`${from}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 92);
  return d.toISOString().slice(0, 10);
}

export const dayQuery = z.object({ date });

export const bookingsQuery = z.object({
  from: date.optional(),
  to: date.optional(),
  masterId: id.optional(),
  status: z.enum(STATUSES).optional(),
  q: text(60).optional(),
});

export const bookingPatch = z.object({
  status: z.enum(STATUSES).optional(),
  notes: text(500).optional(),
}).refine((b) => b.status !== undefined || b.notes !== undefined, 'Нечего менять');

export const loginBody = z.object({ password: z.string().min(1).max(200) });

export const serviceBody = z.object({
  name: text(80).min(2),
  category: text(40).min(1),
  description: text(300).default(''),
  durationMin: z.number().int().min(15).max(480),
  price: z.number().int().min(0).max(10_000_000),
  active: z.boolean().default(true),
});

const scheduleDay = z.object({
  weekday: z.number().int().min(0).max(6),
  start: hhmm,
  end: hhmm,
  breakStart: optionalHhmm,
  breakEnd: optionalHhmm,
}).superRefine((d, ctx) => {
  if (d.start >= d.end) ctx.addIssue({ code: 'custom', message: 'Начало смены должно быть раньше конца' });
  const hasBreak = d.breakStart != null || d.breakEnd != null;
  if (hasBreak && !(d.breakStart != null && d.breakEnd != null && d.breakStart < d.breakEnd
    && d.breakStart > d.start && d.breakEnd < d.end)) {
    ctx.addIssue({ code: 'custom', message: 'Перерыв должен быть внутри смены' });
  }
}).transform((d) => ({
  weekday: d.weekday, startMin: d.start, endMin: d.end, breakStartMin: d.breakStart, breakEndMin: d.breakEnd,
}));

const dayOff = z.object({ from: date, to: date, note: text(100).default('') })
  .refine((d) => d.from <= d.to, 'Дата начала позже даты окончания');

export const masterBody = z.object({
  name: text(60).min(2),
  title: text(80).default(''),
  bio: text(400).default(''),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Цвет в формате #RRGGBB').default('#8E7CC3'),
  photoUrl: z.string().max(500).refine((v) => v === '' || /^https:\/\/\S+$/.test(v), 'Ссылка должна начинаться с https://').default(''),
  active: z.boolean().default(true),
  serviceIds: z.array(id).max(100).default([]),
  schedule: z.array(scheduleDay).max(7).default([]).refine(
    (days) => new Set(days.map((d) => d.weekday)).size === days.length, 'День недели указан дважды',
  ),
  daysOff: z.array(dayOff).max(100).default([]),
});
