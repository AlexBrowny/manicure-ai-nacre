import { openMemoryDb } from '../src/db.js';
import { createMaster, createService } from '../src/domain/catalog.js';

const TABLES = 'bookings, master_days_off, master_schedule, master_services, masters, services, tg_profiles, tg_drafts';
let shared; // PGlite стартует несколько секунд — одна база на файл тестов, очищаем перед каждым makeCtx

async function freshDb() {
  shared ??= openMemoryDb();
  const db = await shared;
  await db.run(`TRUNCATE ${TABLES} RESTART IDENTITY CASCADE`);
  return db;
}

/** Контекст с in-memory Postgres (PGlite) и управляемыми часами. 2026-11-02 — понедельник, зона UTC. */
export async function makeCtx({ now = '2026-11-02T07:00:00Z', overrides = {} } = {}) {
  const db = await freshDb();
  const clock = { current: new Date(now) };
  const cfg = {
    timeZone: 'UTC',
    slotStepMin: 30,
    leadMin: 60,
    horizonDays: 60,
    cancelMinHours: 3,
    currency: 'сум',
    studio: { name: 'Test Studio' },
    ...overrides,
  };
  return { db, cfg, clock, now: () => clock.current };
}

const weekdays = (days, startMin, endMin, extra = {}) =>
  days.map((weekday) => ({ weekday, startMin, endMin, breakStartMin: null, breakEndMin: null, ...extra }));

export function addService(ctx, patch = {}) {
  return createService(ctx, {
    name: 'Маникюр', category: 'Маникюр', description: '', durationMin: 60, price: 1500, active: true, ...patch,
  });
}

/** По умолчанию: Пн–Пт 10:00–19:00, перерыв 14:00–15:00. */
export function addMaster(ctx, { serviceIds, schedule, ...patch } = {}) {
  return createMaster(ctx, {
    name: 'Алина', title: 'Мастер', bio: '', color: '#8E7CC3', photoUrl: '', active: true,
    serviceIds: serviceIds ?? [],
    schedule: schedule ?? weekdays([0, 1, 2, 3, 4], 600, 1140, { breakStartMin: 840, breakEndMin: 900 }),
    daysOff: [],
    ...patch,
  });
}

export { weekdays };
