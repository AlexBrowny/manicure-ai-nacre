import { test } from 'node:test';
import assert from 'node:assert/strict';
import { daySlots, monthAvailability, nextFreeSlot } from '../src/domain/availability.js';
import { addMaster, addService, makeCtx, weekdays } from './helpers.js';

const starts = (slots) => slots.map((s) => s.start);

function setup(overrides) {
  const ctx = makeCtx(overrides);
  const service = addService(ctx);
  const master = addMaster(ctx, { serviceIds: [service.id] });
  return { ctx, service, master };
}

function book(ctx, masterId, serviceId, date, startMin, endMin, status = 'confirmed') {
  ctx.db
    .prepare(
      `INSERT INTO bookings (master_id, service_id, service_name, price, date, start_min, end_min,
                             client_name, client_phone, source, status)
       VALUES (?, ?, 'x', 0, ?, ?, ?, 'Тест', '+79000000000', 'admin', ?)`,
    )
    .run(masterId, serviceId, date, startMin, endMin, status);
}

test('daySlots lists grid slots inside shift and around the break', () => {
  const { ctx, service, master } = setup();
  // Вторник 2026-11-03, смена 10–19, перерыв 14–15, услуга 60 мин
  const slots = daySlots(ctx, { serviceId: service.id, masterId: master.id, date: '2026-11-03' });
  const morning = [600, 630, 660, 690, 720, 750, 780]; // 10:00 … 13:00 (последняя заканчивается в 14:00)
  const afternoon = [900, 930, 960, 990, 1020, 1050, 1080]; // 15:00 … 18:00
  assert.deepEqual(starts(slots), [...morning, ...afternoon]);
});

test('daySlots returns nothing on a non-working weekday', () => {
  const { ctx, service, master } = setup();
  assert.deepEqual(daySlots(ctx, { serviceId: service.id, masterId: master.id, date: '2026-11-07' }), []); // суббота
});

test('daySlots excludes time taken by active bookings but not by cancelled ones', () => {
  const { ctx, service, master } = setup();
  book(ctx, master.id, service.id, '2026-11-03', 660, 720); // 11:00–12:00
  book(ctx, master.id, service.id, '2026-11-03', 900, 960, 'cancelled'); // отмена не блокирует
  const result = starts(daySlots(ctx, { serviceId: service.id, masterId: master.id, date: '2026-11-03' }));
  assert.ok(!result.includes(660) && !result.includes(690), '11:00 и 11:30 заняты');
  assert.ok(!result.includes(630), '10:30 + 60 мин пересекается с записью в 11:00');
  assert.ok(result.includes(600) && result.includes(720));
  assert.ok(result.includes(900), 'отменённая запись освобождает время');
});

test('daySlots drops slots earlier than now + lead time on the current day', () => {
  const { ctx, service, master } = setup({ now: '2026-11-02T10:10:00Z' }); // Пн 10:10, lead 60 → с 11:10
  const result = starts(daySlots(ctx, { serviceId: service.id, masterId: master.id, date: '2026-11-02' }));
  assert.equal(result[0], 690); // 11:30 — первая клетка сетки после 11:10
});

test('daySlots returns nothing for past days and for days beyond the booking horizon', () => {
  const { ctx, service, master } = setup({ overrides: { horizonDays: 7 } });
  assert.deepEqual(daySlots(ctx, { serviceId: service.id, masterId: master.id, date: '2026-11-01' }), []);
  assert.deepEqual(daySlots(ctx, { serviceId: service.id, masterId: master.id, date: '2026-11-10' }), []);
  assert.ok(daySlots(ctx, { serviceId: service.id, masterId: master.id, date: '2026-11-09' }).length > 0);
});

test('daySlots with ignoreLead allows past dates (used by the admin)', () => {
  const { ctx, service, master } = setup();
  const slots = daySlots(ctx, { serviceId: service.id, masterId: master.id, date: '2026-10-28', ignoreLead: true });
  assert.ok(slots.length > 0);
});

test('daySlots respects master days off', () => {
  const ctx = makeCtx();
  const service = addService(ctx);
  const master = addMaster(ctx, {
    serviceIds: [service.id],
    daysOff: [{ from: '2026-11-03', to: '2026-11-04', note: 'отпуск' }],
  });
  assert.deepEqual(daySlots(ctx, { serviceId: service.id, masterId: master.id, date: '2026-11-04' }), []);
  assert.ok(daySlots(ctx, { serviceId: service.id, masterId: master.id, date: '2026-11-05' }).length > 0);
});

test('daySlots ignores inactive masters and masters who do not offer the service', () => {
  const ctx = makeCtx();
  const manicure = addService(ctx);
  const pedicure = addService(ctx, { name: 'Педикюр' });
  const inactive = addMaster(ctx, { serviceIds: [manicure.id], active: false });
  const onlyPedicure = addMaster(ctx, { serviceIds: [pedicure.id] });
  assert.deepEqual(daySlots(ctx, { serviceId: manicure.id, masterId: inactive.id, date: '2026-11-03' }), []);
  assert.deepEqual(daySlots(ctx, { serviceId: manicure.id, masterId: onlyPedicure.id, date: '2026-11-03' }), []);
  assert.deepEqual(daySlots(ctx, { serviceId: manicure.id, date: '2026-11-03' }), []);
});

test('daySlots for "any master" merges masters and lists who is free at each time', () => {
  const ctx = makeCtx();
  const service = addService(ctx);
  const a = addMaster(ctx, { name: 'А', serviceIds: [service.id], schedule: weekdays([1], 600, 720) });
  const b = addMaster(ctx, { name: 'Б', serviceIds: [service.id], schedule: weekdays([1], 660, 780) });
  const slots = daySlots(ctx, { serviceId: service.id, date: '2026-11-03' });
  assert.deepEqual(slots.map((s) => [s.start, s.masterIds]), [
    [600, [a.id]],
    [630, [a.id]],
    [660, [a.id, b.id]],
    [690, [b.id]],
    [720, [b.id]],
  ]);
});

test('longer services need longer free windows', () => {
  const ctx = makeCtx();
  const long = addService(ctx, { name: 'Наращивание', durationMin: 180 });
  const master = addMaster(ctx, { serviceIds: [long.id], schedule: weekdays([1], 600, 840) }); // 10–14
  assert.deepEqual(starts(daySlots(ctx, { serviceId: long.id, masterId: master.id, date: '2026-11-03' })), [600, 630, 660]);
});

test('monthAvailability counts slots per day for the whole month', () => {
  const { ctx, service, master } = setup();
  const days = monthAvailability(ctx, { serviceId: service.id, masterId: master.id, month: '2026-11' });
  assert.equal(days.length, 30);
  assert.equal(days[0].date, '2026-11-01');
  assert.equal(days[0].count, 0); // воскресенье и прошлое
  assert.ok(days.find((d) => d.date === '2026-11-03').count > 0);
  assert.equal(days.find((d) => d.date === '2026-11-07').count, 0); // суббота — выходной
});

test('nextFreeSlot finds the earliest bookable slot', () => {
  const { ctx, service, master } = setup({ now: '2026-11-06T17:30:00Z' }); // Пт 17:30 → сегодня уже поздно
  const next = nextFreeSlot(ctx, { serviceId: service.id, masterId: master.id });
  assert.deepEqual(next, { date: '2026-11-09', start: 600 }); // следующий понедельник
});

test('nextFreeSlot returns null when the master never works', () => {
  const ctx = makeCtx();
  const service = addService(ctx);
  const master = addMaster(ctx, { serviceIds: [service.id], schedule: [] });
  assert.equal(nextFreeSlot(ctx, { serviceId: service.id, masterId: master.id }), null);
});
