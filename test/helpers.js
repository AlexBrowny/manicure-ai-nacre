import { openDb } from '../src/db.js';
import { createMaster, createService } from '../src/domain/catalog.js';

/** Контекст с in-memory БД и управляемыми часами. 2026-11-02 — понедельник, зона UTC. */
export function makeCtx({ now = '2026-11-02T07:00:00Z', overrides = {} } = {}) {
  const db = openDb(':memory:');
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
